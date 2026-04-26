import * as vscode from 'vscode';
import { EdgeData, EdgeRelation, IRNode, NodeType } from '../models/GraphDefinition';
import { LSPService } from '../services/LSPServices';
import { SymbolRule } from '../models/SymbolRule';

export interface ResolvedSymbolInfo {
    id: string;
    type: NodeType;
    name: string;
    namespace: string;
    uri: vscode.Uri;
    range: vscode.Range;
}

export type SymbolCache = Map<string, vscode.DocumentSymbol[]>;

export interface ExtractionResult {
    edges: EdgeData[];
    placeholderNodes: IRNode[];
}

export class ExtractorUtils {
    public static async resolveSymbolInfo(
        uri: vscode.Uri,
        position: vscode.Position,
        cache: SymbolCache
    ): Promise<ResolvedSymbolInfo | undefined> {
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

    public static async resolveDefinitionSymbolInfo(
        uri: vscode.Uri,
        position: vscode.Position,
        cache: SymbolCache
    ): Promise<ResolvedSymbolInfo | undefined> {
        let definitions = await LSPService.getDefinition(uri, position);
        if (!definitions || definitions.length === 0) {
            definitions = await LSPService.getTypeDefinition(uri, position);
        }

        if (!definitions || definitions.length === 0) {
            return undefined;
        }

        for (const def of definitions) {
            const targetUri = 'uri' in def ? def.uri : def.targetUri;
            const targetRange = 'range' in def ? def.range : (def.targetSelectionRange || def.targetRange);
            if (!targetRange) {
                continue;
            }

            const targetInfo = await this.resolveSymbolInfo(targetUri, targetRange.start, cache);
            if (targetInfo && (targetInfo.type === 'class' || targetInfo.type === 'interface')) {
                return targetInfo;
            }
        }

        return undefined;
    }

    public static addEdgeOnce(edges: EdgeData[], sourceId: string, targetId: string, relation: EdgeRelation): boolean {
        const exists = edges.some(e => e.sourceId === sourceId && e.targetId === targetId && e.relation === relation);
        if (exists) {
            return false;
        }

        edges.push({ sourceId, targetId, relation });
        return true;
    }

    public static addPlaceholderOnce(placeholderNodes: IRNode[], info: ResolvedSymbolInfo): void {
        if (placeholderNodes.some(n => n.id === info.id)) {
            return;
        }

        const isLibrary = !vscode.workspace.getWorkspaceFolder(info.uri);
        placeholderNodes.push({
            id: info.id,
            name: this.getFallbackName(info),
            type: info.type,
            namespace: info.namespace || undefined,
            location: {
                uri: info.uri.toString(),
                range: {
                    start: { line: info.range.start.line, character: info.range.start.character },
                    end: { line: info.range.end.line, character: info.range.end.character }
                }
            },
            placeHolder: true,
            isLibrary
        });
    }

    public static addResolvedRelation(
        edges: EdgeData[],
        placeholderNodes: IRNode[],
        sourceId: string,
        targetInfo: ResolvedSymbolInfo,
        relation: EdgeRelation
    ): boolean {
        const added = this.addEdgeOnce(edges, sourceId, targetInfo.id, relation);
        if (added) {
            this.addPlaceholderOnce(placeholderNodes, targetInfo);
        }
        return added;
    }

    public static async addRelationsFromPositions(
        document: vscode.TextDocument,
        sourceId: string,
        positions: vscode.Position[],
        relation: EdgeRelation,
        edges: EdgeData[],
        placeholderNodes: IRNode[],
        cache: SymbolCache
    ): Promise<void> {
        for (const pos of positions) {
            const targetInfo = await this.resolveDefinitionSymbolInfo(document.uri, pos, cache);
            if (!targetInfo || sourceId === targetInfo.id) {
                continue;
            }

            this.addResolvedRelation(edges, placeholderNodes, sourceId, targetInfo, relation);
        }
    }

    private static getFallbackName(info: ResolvedSymbolInfo): string {
        const name = String(info.name || '').trim();
        if (name.length > 0) {
            return name;
        }

        const idParts = info.id.split('#').filter(part => part.trim().length > 0);
        const tail = idParts.length > 0 ? idParts[idParts.length - 1].trim() : '';
        return tail || 'Unknown';
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
                        namespace: namespace,
                        uri: vscode.Uri.parse(uriString),
                        range: sym.range
                    };
                }
            }
        }
        return undefined;
    }
}
