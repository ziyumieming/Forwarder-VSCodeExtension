import * as vscode from 'vscode';
import { EdgeData, EdgeRelation, IRNode, NodeType } from '../models/GraphDefinition';
import { ResolvedSymbolInfo, SourceLocationService, SymbolCache } from '../services/SourceLocationServices';

export type { ResolvedSymbolInfo, SymbolCache };

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
        return SourceLocationService.resolveSymbolInfo(uri, position, cache);
    }

    public static async resolveDefinitionSymbolInfo(
        uri: vscode.Uri,
        position: vscode.Position,
        cache: SymbolCache
    ): Promise<ResolvedSymbolInfo | undefined> {
        return SourceLocationService.resolveDefinitionSymbolInfo(uri, position, cache);
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

}
