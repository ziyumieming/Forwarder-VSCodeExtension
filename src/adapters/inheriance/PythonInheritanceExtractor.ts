import * as vscode from 'vscode';
import { EdgeData, IRNode, NodeType } from '../../models/GraphDefinition';
import { LSPService } from '../../services/LSPServices';
import { DocumentSymbolIndex } from '../../services/AdapterServices';
import { SymbolRule } from '../../models/SymbolRule';

export class PythonInheritanceExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];

        // 用于解决可能的跨文件引用内部调用的临时缓存
        const cache = new Map<string, vscode.DocumentSymbol[]>();

        // 利用 AdapterService 生成的索引直接遍历需要处理的 class
        for (const clsItem of index.classes) {
            // 通过 LSP 获取精确的类型层级（父类）
            const supertypes = await LSPService.getTypeHierarchySupertypes(document.uri, clsItem.symbol.selectionRange.start);
            if (supertypes && supertypes.length > 0) {
                for (const superTypeItem of supertypes) {
                    const targetUri = superTypeItem.uri;
                    const targetRange = superTypeItem.selectionRange;

                    const targetInfo = await this._resolveSymbolInfo(targetUri, targetRange.start, cache);
                    if (targetInfo && targetInfo.type === 'class') {
                        edges.push({
                            sourceId: clsItem.id,
                            targetId: targetInfo.id,
                            relation: 'extends'
                        });

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
                            placeHolder: true
                        });
                    }
                }
            }
        }

        return { edges, placeholderNodes };
    }

    private static async _resolveSymbolInfo(uri: vscode.Uri, position: vscode.Position, cache: Map<string, vscode.DocumentSymbol[]>): Promise<{ id: string, type: NodeType, name: string, namespace: string } | undefined> {
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

    private static _findSymbolByPosition(symbols: vscode.DocumentSymbol[], uriString: string, pos: vscode.Position, namespace: string): any {
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