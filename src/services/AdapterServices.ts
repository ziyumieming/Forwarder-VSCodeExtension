import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { IRNode, NodeType, EdgeRelation, EdgeData } from '../models/GraphDefinition';
import { FileSymbolsPayload } from '../models/GraphManager';
import { LSPService } from './LSPServices';

export class AdapterService {
    /**
     * 提取和转换指定文件的结构数据，生成给统一图数据结构的IR及其包含关系边
     */
    public static async extractFileSymbols(uri: vscode.Uri, oldFingerprint?: string): Promise<FileSymbolsPayload | undefined> {
        const document = await vscode.workspace.openTextDocument(uri);
        const symbols = await LSPService.getDocumentSymbols(uri);
        if (!symbols) {
            return undefined;
        }

        const uriString = uri.toString();
        const fingerprint = this._computeFingerprint(document, symbols);

        if (fingerprint === oldFingerprint) {
            // 结构指纹未变，无需进行高昂成本的定义跳转和关系重建
            const nodes: IRNode[] = [];
            this._extractBasicNodes(document, symbols, uriString, '', nodes);
            return {
                uri: uriString,
                nodes,
                edges: [],
                unchanged: true,
                fingerprint
            };
        }

        // --- 以下为全量解析逻辑 ---
        const nodes: IRNode[] = [];
        const edges: EdgeData[] = [];


        // 用于缓存外部文件的符号树，避免重复请求 LSP
        const symbolCache: Map<string, vscode.DocumentSymbol[]> = new Map();
        symbolCache.set(uriString, symbols);

        await this._processSymbols(document, symbols, uriString, '', nodes, edges, symbolCache);

        return {
            uri: uriString,
            nodes,
            edges,
            unchanged: false,
            fingerprint
        };
    }

    /**
     * 计算文档语义结构指纹
     * 提取影响图拓扑的关键特征：符号类型、名称、内部层级以及类/接口的声明头（包含 extends/implements 语句）
     */
    private static _computeFingerprint(document: vscode.TextDocument, symbols: vscode.DocumentSymbol[]): string {
        const hashStr = this._hashSymbols(document, symbols);
        return crypto.createHash('md5').update(hashStr).digest('hex');
    }

    private static _hashSymbols(document: vscode.TextDocument, symbols: vscode.DocumentSymbol[]): string {
        let str = '';
        for (const sym of symbols) {
            const type = this._mapSymbolKindToNodeType(sym.kind);
            if (type) {
                str += `${type}:${sym.name}:`;
                if (type === 'class' || type === 'interface') {
                    const sigRange = new vscode.Range(sym.selectionRange.end, sym.range.end);
                    let sigText = document.getText(sigRange);
                    const braceIndex = sigText.indexOf('{');
                    if (braceIndex !== -1) {
                        sigText = sigText.substring(0, braceIndex);
                    }
                    // 收录声明头，因为里面包含改变被扫描对象之间横向关系的extends/implements短语
                    str += `${sigText};`;
                }
            }
            if (sym.children && sym.children.length > 0) {
                str += '[' + this._hashSymbols(document, sym.children) + ']';
            }
        }
        return str;
    }

    /**
     * 仅快速提取单文档本地域节点基本信息，不发起外部跳转，用于局部物理信息覆盖
     */
    //TODO:查证这个函数的作用和效率
    private static _extractBasicNodes(
        document: vscode.TextDocument,
        symbols: vscode.DocumentSymbol[],
        uriString: string,
        namespace: string,
        nodes: IRNode[]
    ): void {
        for (const sym of symbols) {
            const nodeType = this._mapSymbolKindToNodeType(sym.kind);
            if (!nodeType) {
                if (sym.children) { this._extractBasicNodes(document, sym.children, uriString, namespace, nodes); }
                continue;
            }
            const id = `${uriString}#${nodeType}#${namespace}#${sym.name}`;
            nodes.push({
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
            });
            if (sym.children) {
                const childNamespace = namespace ? `${namespace}.${sym.name}` : sym.name;
                this._extractBasicNodes(document, sym.children, uriString, childNamespace, nodes);
            }
        }
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

                // 通过 LSP 获取精确的类型层级（父类与接口）
                const supertypes = await LSPService.getTypeHierarchySupertypes(document.uri, sym.selectionRange.start);
                if (supertypes && supertypes.length > 0) {
                    // 解析关键字帮助确定是 extends 还是 implements
                    const extendsMatch = sigText.match(/extends\s+([^{]+)/);
                    const implementsMatch = sigText.match(/implements\s+([^{]+)/);

                    const extendsText = extendsMatch ? extendsMatch[1] : '';
                    const implementsText = implementsMatch ? implementsMatch[1] : '';

                    for (const superTypeItem of supertypes) {
                        const targetUri = superTypeItem.uri;
                        const targetRange = superTypeItem.selectionRange;

                        const targetInfo = await this._resolveSymbolInfo(targetUri, targetRange.start, symbolCache);
                        if (targetInfo) {
                            let relation: EdgeRelation = 'references';
                            const superName = superTypeItem.name;

                            // 判断在哪个关键字区域包含了该父节点名字
                            if (extendsText.includes(superName)) {
                                relation = 'extends';
                            } else if (implementsText.includes(superName)) {
                                relation = 'implements';
                            } else {
                                // 兜底策略：根据类型降级推断
                                if (nodeType === 'class') {
                                    if (targetInfo.type === 'class') { relation = 'extends'; }
                                    else if (targetInfo.type === 'interface') { relation = 'implements'; }
                                } else if (nodeType === 'interface') {
                                    relation = 'extends';
                                }
                            }

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

                            edges.push({ sourceId: id, targetId: targetInfo.id, relation });
                        }
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
        if (!symbols) { return undefined; }

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
                    if (childRes) { return childRes; }
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
