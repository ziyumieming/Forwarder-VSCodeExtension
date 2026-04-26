import * as vscode from 'vscode';
import { EdgeData, IRNode } from '../../models/GraphDefinition';
import { DocumentSymbolIndex, IndexedSymbol } from '../../services/AdapterServices';
import { ExtractorUtils, ResolvedSymbolInfo } from '../ExtractorUtils';
import { GoSyntaxUtils } from '../languages/GoSyntaxUtils';

export class GoAggregationExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        _uriString: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];
        const cache = new Map<string, vscode.DocumentSymbol[]>();
        const ownerByTypeName = new Map<string, IndexedSymbol>();

        for (const item of index.classes) {
            ownerByTypeName.set(item.symbol.name, item);
        }

        for (const owner of index.classes) {
            const fieldTypes = await this.collectFieldTypes(document, owner, cache, placeholderNodes);
            if (fieldTypes.size === 0) {
                continue;
            }

            await this.analyzeReceiverMethods(document, owner, fieldTypes, index, cache, placeholderNodes, edges);
            await this.analyzeConstructors(document, owner, fieldTypes, index, ownerByTypeName, cache, placeholderNodes, edges);
        }

        return { edges, placeholderNodes };
    }

    private static async collectFieldTypes(
        document: vscode.TextDocument,
        owner: IndexedSymbol,
        cache: Map<string, vscode.DocumentSymbol[]>,
        placeholderNodes: IRNode[]
    ): Promise<Map<string, ResolvedSymbolInfo>> {
        const result = new Map<string, ResolvedSymbolInfo>();
        if (!owner.symbol.children) {
            return result;
        }

        for (const child of owner.symbol.children) {
            if (
                child.kind !== vscode.SymbolKind.Field &&
                child.kind !== vscode.SymbolKind.Property &&
                child.kind !== vscode.SymbolKind.Variable
            ) {
                continue;
            }

            const info = await ExtractorUtils.resolveDefinitionSymbolInfo(document.uri, child.selectionRange.end, cache);
            if (!info) {
                continue;
            }

            result.set(child.name, info);
            ExtractorUtils.addPlaceholderOnce(placeholderNodes, info);
        }

        return result;
    }

    private static async analyzeReceiverMethods(
        document: vscode.TextDocument,
        owner: IndexedSymbol,
        fieldTypes: Map<string, ResolvedSymbolInfo>,
        index: DocumentSymbolIndex,
        cache: Map<string, vscode.DocumentSymbol[]>,
        placeholderNodes: IRNode[],
        edges: EdgeData[]
    ): Promise<void> {
        for (const candidate of [...index.methods, ...index.functions]) {
            const header = GoSyntaxUtils.parseFunctionHeader(document, candidate.symbol);
            if (!header.ownerTypeName || header.ownerTypeName !== owner.symbol.name || !header.receiverName) {
                continue;
            }

            const parameterTypes = await this.collectParameterTypes(document, header.headerRange, cache, placeholderNodes);
            if (parameterTypes.size === 0) {
                continue;
            }

            const assignments = this.collectReceiverAssignments(document, candidate.symbol, header.receiverName);
            this.addMatchingAggregateEdges(owner.id, fieldTypes, parameterTypes, assignments, placeholderNodes, edges);
        }
    }

    private static async analyzeConstructors(
        document: vscode.TextDocument,
        owner: IndexedSymbol,
        fieldTypes: Map<string, ResolvedSymbolInfo>,
        index: DocumentSymbolIndex,
        ownerByTypeName: Map<string, IndexedSymbol>,
        cache: Map<string, vscode.DocumentSymbol[]>,
        placeholderNodes: IRNode[],
        edges: EdgeData[]
    ): Promise<void> {
        for (const fn of index.functions) {
            const header = GoSyntaxUtils.parseFunctionHeader(document, fn.symbol);
            if (header.ownerTypeName || header.returnTypeName !== owner.symbol.name) {
                continue;
            }

            const returnedOwner = ownerByTypeName.get(header.returnTypeName);
            if (!returnedOwner || returnedOwner.id !== owner.id) {
                continue;
            }

            const parameterTypes = await this.collectParameterTypes(document, header.headerRange, cache, placeholderNodes);
            if (parameterTypes.size === 0) {
                continue;
            }

            const assignments = this.collectCompositeLiteralAssignments(document, fn.symbol, owner.symbol.name);
            this.addMatchingAggregateEdges(owner.id, fieldTypes, parameterTypes, assignments, placeholderNodes, edges);
        }
    }

    private static addMatchingAggregateEdges(
        ownerId: string,
        fieldTypes: Map<string, ResolvedSymbolInfo>,
        parameterTypes: Map<string, ResolvedSymbolInfo>,
        assignments: { fieldName: string, parameterName: string }[],
        placeholderNodes: IRNode[],
        edges: EdgeData[]
    ): void {
        for (const assignment of assignments) {
            const fieldInfo = fieldTypes.get(assignment.fieldName);
            const parameterInfo = parameterTypes.get(assignment.parameterName);
            if (!fieldInfo || !parameterInfo || fieldInfo.id !== parameterInfo.id) {
                continue;
            }

            if (ExtractorUtils.addEdgeOnce(edges, ownerId, fieldInfo.id, 'aggregates')) {
                ExtractorUtils.addPlaceholderOnce(placeholderNodes, fieldInfo);
            }
        }
    }

    private static async collectParameterTypes(
        document: vscode.TextDocument,
        headerRange: vscode.Range,
        cache: Map<string, vscode.DocumentSymbol[]>,
        placeholderNodes: IRNode[]
    ): Promise<Map<string, ResolvedSymbolInfo>> {
        const result = new Map<string, ResolvedSymbolInfo>();
        const params = GoSyntaxUtils.parseParameters(document, headerRange);

        for (const param of params) {
            const info = await ExtractorUtils.resolveDefinitionSymbolInfo(document.uri, param.typePosition, cache);
            if (!info) {
                continue;
            }

            result.set(param.name, info);
            ExtractorUtils.addPlaceholderOnce(placeholderNodes, info);
        }

        return result;
    }

    private static collectReceiverAssignments(
        document: vscode.TextDocument,
        symbol: vscode.DocumentSymbol,
        receiverName: string
    ): { fieldName: string, parameterName: string }[] {
        const text = document.getText(symbol.range);
        const escapedReceiver = receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedReceiver}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*([A-Za-z_][A-Za-z0-9_]*)\\b`, 'g');
        const result: { fieldName: string, parameterName: string }[] = [];
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            result.push({ fieldName: match[1], parameterName: match[2] });
        }

        return result;
    }

    private static collectCompositeLiteralAssignments(
        document: vscode.TextDocument,
        symbol: vscode.DocumentSymbol,
        ownerTypeName: string
    ): { fieldName: string, parameterName: string }[] {
        const text = document.getText(symbol.range);
        const escapedOwner = ownerTypeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const literalRegex = new RegExp(`&?${escapedOwner}\\s*\\{([\\s\\S]*?)\\}`, 'g');
        const fieldRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\b/g;
        const result: { fieldName: string, parameterName: string }[] = [];
        let literalMatch: RegExpExecArray | null;

        while ((literalMatch = literalRegex.exec(text)) !== null) {
            let fieldMatch: RegExpExecArray | null;
            const body = literalMatch[1];
            while ((fieldMatch = fieldRegex.exec(body)) !== null) {
                result.push({ fieldName: fieldMatch[1], parameterName: fieldMatch[2] });
            }
        }

        return result;
    }

}
