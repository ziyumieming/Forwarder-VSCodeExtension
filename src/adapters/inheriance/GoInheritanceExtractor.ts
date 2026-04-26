import * as vscode from 'vscode';
import { EdgeData, IRNode, NodeType } from '../../models/GraphDefinition';
import { LSPService } from '../../services/LSPServices';
import { DocumentSymbolIndex } from '../../services/AdapterServices';
import { SymbolRule } from '../../models/SymbolRule';
import { logger } from '../../utils/logger';
import { ExtractorUtils } from '../ExtractorUtils';

export class GoInheritanceExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        logger.info(`[GoInheritanceExtractor.analyze] 开始分析文件: ${uriString}`);
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];

        // 缓存已经解析过的 URI 对应的符号列表
        const cache = new Map<string, vscode.DocumentSymbol[]>();

        // Go 中使用 typeof (Struct/Interface) 的 Symbol 作为层级起点
        // 在 index.classes (structs 将映射到 class) 和 index.interfaces 中寻找
        const targetNodes = [...index.classes, ...index.interfaces];
        logger.info(`[GoInheritanceExtractor.analyze] 检查 ${index.classes.length} 个 classes 和 ${index.interfaces.length} 个 interfaces`);

        for (const nodeItem of targetNodes) {
            logger.info(`[GoInheritanceExtractor.analyze] 处理节点: ${nodeItem.id}, kind: ${nodeItem.symbol.kind}`);
            // 获取该结构体/接口实现的父级接口或嵌入接口
            const supertypes = await LSPService.getTypeHierarchySupertypes(document.uri, nodeItem.symbol.selectionRange.start);
            if (supertypes && supertypes.length > 0) {
                logger.info(`[GoInheritanceExtractor.analyze] 节点 ${nodeItem.id} 获取到 ${supertypes.length} 个 supertypes`);
                for (const superTypeItem of supertypes) {
                    const targetUri = superTypeItem.uri;
                    const targetRange = superTypeItem.selectionRange;

                    const targetInfo = await ExtractorUtils.resolveSymbolInfo(targetUri, targetRange.start, cache);
                    logger.info(`[GoInheritanceExtractor.analyze] 解析 supertype (${targetUri.fsPath}:${targetRange.start.line}): targetInfo = ${targetInfo ? JSON.stringify(targetInfo) : 'undefined'}`);
                    if (targetInfo) {
                        // 确定 relation: Go 的 Struct (class) -> Interface 是 implements
                        // Interface -> Interface 是 extends (嵌入)
                        let relation: 'implements' | 'extends' = 'implements';
                        logger.info(`[GoInheritanceExtractor.analyze] 判断关系前: src_kind=${nodeItem.symbol.kind}, target_type=${targetInfo.type}`);
                        if (nodeItem.symbol.kind === vscode.SymbolKind.Interface && targetInfo.type === 'interface') {
                            relation = 'extends';
                        }
                        logger.info(`[GoInheritanceExtractor.analyze] 创建关系 ${relation}: ${nodeItem.id} -> ${targetInfo.id}`);

                        edges.push({
                            sourceId: nodeItem.id,
                            targetId: targetInfo.id,
                            relation: relation
                        });

                        // 判断是否属于工作区外的依赖/库
                        const isLibrary = !vscode.workspace.getWorkspaceFolder(targetUri);

                        placeholderNodes.push({
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
                            placeHolder: true,
                            isLibrary: isLibrary
                        });
                    }
                }
            } else {
                logger.info(`[GoInheritanceExtractor.analyze] 节点 ${nodeItem.id} 没有获取到 supertypes`);
            }
        }

        logger.info(`[GoInheritanceExtractor.analyze] 分析完成: 返回 ${edges.length} 条边, ${placeholderNodes.length} 个占位符节点`);
        const edgesByRelation: { [key: string]: number } = {};
        for (const edge of edges) {
            edgesByRelation[edge.relation] = (edgesByRelation[edge.relation] || 0) + 1;
        }
        logger.info(`[GoInheritanceExtractor.analyze] 边统计: ${JSON.stringify(edgesByRelation)}`);

        return { edges, placeholderNodes };
    }

    private static async _resolveSymbolInfo(
        uri: vscode.Uri,
        position: vscode.Position,
        cache: Map<string, vscode.DocumentSymbol[]>
    ): Promise<{ id: string, type: NodeType, name: string, namespace: string } | undefined> {
        const uriStr = uri.toString();
        let symbols = cache.get(uriStr);
        if (!symbols) {
            symbols = await LSPService.getDocumentSymbols(uri);
            if (symbols) {
                cache.set(uriStr, symbols);
            }
        }
        if (!symbols) { return undefined; }

        return this._findSymbolByPosition(symbols, uriStr, position, '');
    }

    private static _findSymbolByPosition(
        symbols: vscode.DocumentSymbol[],
        uriString: string,
        pos: vscode.Position,
        namespace: string
    ): any {
        for (const sym of symbols) {
            if (sym.range.contains(pos)) {
                let childNamespace = namespace;
                const nodeType = SymbolRule.mapSymbolKindToNodeType(sym.kind);

                if (nodeType || SymbolRule.isContainerSymbol(sym.kind)) {
                    childNamespace = SymbolRule.extendNamespace(namespace, sym.name);
                }

                if (sym.children && sym.children.length > 0) {
                    const childRes = this._findSymbolByPosition(sym.children, uriString, pos, childNamespace);
                    if (childRes) { return childRes; }
                }

                if (nodeType) {
                    return {
                        id: SymbolRule.generateNodeId(uriString, nodeType, namespace, sym.name),
                        type: nodeType,
                        name: sym.name,
                        namespace: namespace
                    };
                }
            }
        }
        return undefined;
    }
}