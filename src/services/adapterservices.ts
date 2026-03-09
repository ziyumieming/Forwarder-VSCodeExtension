import * as vscode from 'vscode';
import { IRNode, NodeType, EdgeRelation, EdgeData } from '../models/graphdefinition';
import { FileSymbolsPayload } from '../models/graphmanager';
import { LSPService } from './LSPservices';

export class AdapterService {
    /**
     * 提取和转换指定文件的结构数据，生成给统一图数据结构的IR及其包含关系边
     */
    public static async extractFileSymbols(uri: vscode.Uri): Promise<FileSymbolsPayload | undefined> {
        const document = await vscode.workspace.openTextDocument(uri);
        const symbols = await LSPService.getDocumentSymbols(uri);
        if (!symbols) {
            return undefined;
        }

        const nodes: IRNode[] = [];
        const edges: EdgeData[] = [];
        const uriString = uri.toString();

        // 用于缓存外部文件的符号树，避免重复请求 LSP
        const symbolCache: Map<string, vscode.DocumentSymbol[]> = new Map();
        symbolCache.set(uriString, symbols);

        await this._processSymbols(document, symbols, uriString, '', nodes, edges, symbolCache);

        return {
            uri: uriString,
            nodes,
            edges
        };
    }

    private static async _processSymbols(
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[],
        uriString: string,
        namespace: string,
        nodes: IRNode[],
        edges: EdgeData[],
        symbolCache: Map<string, vscode.DocumentSymbol[]>,
        parentId?: string
    ): Promise<void> {
        for (const sym of symbols) {
            const nodeType = this._mapSymbolKindToNodeType(sym.kind);
            if (!nodeType) {
                // 忽略非目标类型，但可能其内部包含我们要的类型实体，因此继续向内遍历
                if (sym.children && sym.children.length > 0) {
                    await this._processSymbols(document, sym.children, uriString, namespace, nodes, edges, symbolCache, parentId);
                }
                continue;
            }

            // 通过层级关系拼接唯一的ID
            const id = `${uriString}#${nodeType}#${namespace}#${sym.name}`;

            const node: IRNode = {
                id,
                name: sym.name,
                type: nodeType,
                namespace: namespace || undefined,
                location: {
                    uri: uriString,
                    range: {
                        start: { line: sym.range.start.line, character: sym.range.start.character },
                        end: { line: sym.range.end.line, character: sym.range.end.character }
                    }
                },
                placeHolder: false
            };
            nodes.push(node);

            // 如果有父节点，建立包含关系
            if (parentId) {
                edges.push({
                    sourceId: parentId,
                    targetId: id,
                    relation: 'contains'
                });
            }

            // 提取类的继承 (extends) 和接口实现 (implements) 关系
            if (nodeType === 'class' || nodeType === 'interface') {
                // 获取当前符号声明部分的文本。为防止解析到内部语句，只截取到 "{" 为止的头行
                const sigRange = new vscode.Range(sym.selectionRange.end, sym.range.end);
                let sigText = document.getText(sigRange);
                const braceIndex = sigText.indexOf('{');
                if (braceIndex !== -1) {
                    sigText = sigText.substring(0, braceIndex);
                }

                // 简单的基于正则词法的启发式查找：选取非关键字的标识符调用定义跳转
                const regex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
                let match;
                // 要忽略的常用关键字
                const ignoreKeywords = new Set([
                    'extends', 'implements', 'class', 'interface', 'export', 'default', 'type',
                    'public', 'private', 'protected', 'readonly'
                ]);

                while ((match = regex.exec(sigText)) !== null) {
                    const word = match[0];
                    if (ignoreKeywords.has(word)) continue;

                    // 计算目标词汇在当前文档中的绝对位置以调用 LSP
                    const wordOffset = document.offsetAt(sigRange.start) + match.index;
                    const wordPos = document.positionAt(wordOffset);

                    try {
                        const defs = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                            'vscode.executeDefinitionProvider',
                            document.uri,
                            wordPos
                        );

                        if (defs && defs.length > 0) {
                            const def = defs[0];
                            const targetUri = 'uri' in def ? def.uri : def.targetUri;
                            const targetRange = 'range' in def ? def.range : def.targetSelectionRange;

                            // 检查targetRange是否有效
                            if (!targetRange) {
                                continue;
                            }

                            // 进一步解析跳转目标的具体 SymbolKind 和嵌套层级，以构造正确的 ID 和关系
                            const targetInfo = await this._resolveSymbolInfo(targetUri, targetRange.start, symbolCache);
                            if (targetInfo) {
                                let relation: EdgeRelation = 'references';
                                if (nodeType === 'class') {
                                    if (targetInfo.type === 'class') relation = 'extends';
                                    else if (targetInfo.type === 'interface') relation = 'implements';
                                } else if (nodeType === 'interface') {
                                    relation = 'extends';
                                }

                                // 构建并在节点列表中加入外部/上下文文件的“占位节点”
                                const targetNode: IRNode = {
                                    id: targetInfo.id,
                                    name: targetInfo.name,
                                    type: targetInfo.type,
                                    namespace: targetInfo.namespace || undefined,
                                    location: {
                                        uri: targetUri.toString(),
                                        range: {
                                            start: { line: targetRange.start.line, character: targetRange.start.character },
                                            end: { line: targetRange.end.line, character: targetRange.end.character }
                                        }
                                    },
                                    placeHolder: true
                                };
                                nodes.push(targetNode);

                                // 构建扩展/实现关系边
                                edges.push({ sourceId: id, targetId: targetInfo.id, relation });
                            }
                        }
                    } catch (e) {
                        // 忽略由于解析失败或无定义导致的错报
                    }
                }
            }

            // 递归处理子节点，当前节点将作为子节点的命名空间前缀
            if (sym.children && sym.children.length > 0) {
                const childNamespace = namespace ? `${namespace}.${sym.name}` : sym.name;
                await this._processSymbols(document, sym.children, uriString, childNamespace, nodes, edges, symbolCache, id);
            }
        }
    }

    /**
     * 根据目标的 uri 和起始位置，在对应的文件中查找到精确匹配的文档符号对象，进而组装统一 ID 和提取类型
     */
    private static async _resolveSymbolInfo(uri: vscode.Uri, position: vscode.Position, cache: Map<string, vscode.DocumentSymbol[]>): Promise<{ id: string, type: NodeType, name: string, namespace: string } | undefined> {
        const uriStr = uri.toString();
        let symbols = cache.get(uriStr);
        // 若缓存不含目标文件符号树则执行调用
        if (!symbols) {
            symbols = await LSPService.getDocumentSymbols(uri);
            if (symbols) {
                cache.set(uriStr, symbols);
            }
        }
        if (!symbols) return undefined;

        return this._findSymbolByPosition(symbols, uriStr, position, '');
    }

    /**
     * 在符号树中深度搜索涵盖指定位置的符号及其命名空间信息
     */
    private static _findSymbolByPosition(symbols: vscode.DocumentSymbol[], uriString: string, pos: vscode.Position, namespace: string): any {
        for (const sym of symbols) {
            if (sym.range.contains(pos)) {
                const childNamespace = namespace ? `${namespace}.${sym.name}` : sym.name;
                // 优先看子节点是否更精准包裹着目标位置
                if (sym.children && sym.children.length > 0) {
                    const childRes = this._findSymbolByPosition(sym.children, uriString, pos, childNamespace);
                    if (childRes) return childRes;
                }
                const nodeType = this._mapSymbolKindToNodeType(sym.kind);
                if (nodeType) {
                    return {
                        id: `${uriString}#${nodeType}#${namespace}#${sym.name}`,
                        type: nodeType,
                        name: sym.name,
                        namespace: namespace
                    };
                }
            }
        }
        return undefined;
    }

    private static _mapSymbolKindToNodeType(kind: vscode.SymbolKind): NodeType | undefined {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return 'class';
            case vscode.SymbolKind.Interface:
                return 'interface';
            case vscode.SymbolKind.Function:
                return 'function';
            case vscode.SymbolKind.Method:
                return 'method';
            case vscode.SymbolKind.File:
                return 'file';
            default:
                return undefined;
        }
    }
}
