import * as vscode from 'vscode';
import { EdgeData, IRNode, NodeType } from '../models/GraphDefinition';
import { DocumentSymbolIndex, IndexedSymbol } from '../services/AdapterServices';
import { LSPService } from '../services/LSPServices';
import { logger } from '../utils/logger';
import { ExtractionResult, ExtractorUtils, ResolvedSymbolInfo, SymbolCache } from './ExtractorUtils';

export class CallExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<ExtractionResult> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];
        const cache: SymbolCache = new Map();
        const callableSymbols = [...index.functions, ...index.methods];

        for (const callable of callableSymbols) {
            const hierarchyItems = await LSPService.prepareCallHierarchy(document.uri, callable.symbol.selectionRange.start);
            if (!hierarchyItems || hierarchyItems.length === 0) {
                continue;
            }

            const sourceItem = this.pickMatchingHierarchyItem(hierarchyItems, callable);
            if (!sourceItem) {
                continue;
            }

            const outgoingCalls = await LSPService.getOutgoingCalls(sourceItem);
            if (!outgoingCalls || outgoingCalls.length === 0) {
                continue;
            }

            for (const outgoing of outgoingCalls) {
                const targetInfo = await this.resolveCallableItem(outgoing.to, cache);
                if (!targetInfo) {
                    continue;
                }

                ExtractorUtils.addResolvedRelation(edges, placeholderNodes, callable.id, targetInfo, 'calls');
            }
        }

        logger.info(`[CallExtractor] 调用关系提取完成: ${uriString}, calls=${edges.length}, placeholders=${placeholderNodes.length}`);
        return { edges, placeholderNodes };
    }

    private static pickMatchingHierarchyItem(
        items: vscode.CallHierarchyItem[],
        callable: IndexedSymbol
    ): vscode.CallHierarchyItem | undefined {
        return items.find(item => item.selectionRange.contains(callable.symbol.selectionRange.start)) || items[0];
    }

    private static async resolveCallableItem(
        item: vscode.CallHierarchyItem,
        cache: SymbolCache
    ): Promise<ResolvedSymbolInfo | undefined> {
        const resolved = await ExtractorUtils.resolveSymbolInfo(item.uri, item.selectionRange.start, cache);
        if (resolved && this.isCallableType(resolved.type)) {
            return resolved;
        }

        const fallbackType = this.mapCallHierarchyKindToCallableNodeType(item.kind);
        if (!fallbackType) {
            return undefined;
        }

        return {
            id: this.buildFallbackId(item, fallbackType),
            type: fallbackType,
            name: item.name,
            namespace: '',// 兜底，非函数或方法，回退时拿不到可靠信息
            uri: item.uri,
            range: item.range
        };
    }

    private static isCallableType(type: NodeType): boolean {
        return type === 'function' || type === 'method';
    }

    private static mapCallHierarchyKindToCallableNodeType(kind: vscode.SymbolKind): NodeType | undefined {
        if (kind === vscode.SymbolKind.Method || kind === vscode.SymbolKind.Constructor) {
            return 'method';
        }

        if (kind === vscode.SymbolKind.Function) {
            return 'function';
        }

        return undefined;
    }

    private static buildFallbackId(item: vscode.CallHierarchyItem, type: NodeType): string {
        const uriString = item.uri.toString();
        const normalizedName = item.name || 'Unknown';
        return `${uriString}#${type}##${normalizedName}`;
    }
}
