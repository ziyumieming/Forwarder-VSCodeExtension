import * as vscode from 'vscode';
import { EdgeData, IRNode, NodeType } from '../models/GraphDefinition';
import { PythonInheritanceExtractor } from './inheriance/PythonInheritanceExtractor';
import { GoInheritanceExtractor } from './inheriance/GoInheritanceExtractor';
import { LSPService } from '../services/LSPServices';
import { SymbolRule } from '../models/SymbolRule';
import { DocumentSymbolIndex } from '../services/AdapterServices';

export class ExtractorUtils {
    public static async resolveSymbolInfo(
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

        return this.findSymbolByPosition(symbols, uriStr, position, '');
    }

    private static findSymbolByPosition(
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
                    const childRes = this.findSymbolByPosition(sym.children, uriString, pos, childNamespace);
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



export class InheritanceExtractor {
    public static async extractEdges(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string,
        languageId: string  // 从 document.languageId 传进来
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        switch (languageId) {
            case 'go':
                return await GoInheritanceExtractor.analyze(document, index, uriString);
            case 'python':
                return await PythonInheritanceExtractor.analyze(document, index, uriString);
            // case 'typescript':
            // case 'javascript':
            // case 'java':
            default:
                return { edges: [], placeholderNodes: [] };
        }
    }
}

export class CompositionExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];
        const cache = new Map<string, vscode.DocumentSymbol[]>();

        const targetNodes = [...index.classes, ...index.interfaces];

        for (const clsItem of targetNodes) {
            if (!clsItem.symbol.children) { continue; }

            for (const child of clsItem.symbol.children) {
                if (
                    child.kind === vscode.SymbolKind.Field ||
                    child.kind === vscode.SymbolKind.Property ||
                    child.kind === vscode.SymbolKind.Variable
                ) {
                    const definitions = await LSPService.getTypeDefinition(document.uri, child.selectionRange.end);
                    if (!definitions || definitions.length === 0) { continue; }

                    for (const def of definitions) {
                        const targetUri = 'uri' in def ? def.uri : def.targetUri;
                        const targetRange = 'range' in def ? def.range : (def.targetSelectionRange || def.targetRange);

                        if (!targetRange) { continue; }

                        const targetInfo = await ExtractorUtils.resolveSymbolInfo(targetUri, targetRange.start, cache);
                        if (targetInfo && (targetInfo.type === 'class' || targetInfo.type === 'interface')) {
                            // 跳过自己引用自己
                            if (clsItem.id === targetInfo.id) {
                                continue;
                            }

                            edges.push({
                                sourceId: clsItem.id,
                                targetId: targetInfo.id,
                                relation: 'composes'
                            });

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
                }
            }
        }

        return { edges, placeholderNodes };
    }
}
