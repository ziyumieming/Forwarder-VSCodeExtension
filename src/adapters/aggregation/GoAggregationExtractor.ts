import * as vscode from 'vscode';
import { EdgeData, IRNode } from '../../models/GraphDefinition';
import { DocumentSymbolIndex, IndexedSymbol } from '../../services/AdapterServices';
import { ExtractorUtils, ResolvedSymbolInfo } from '../ExtractorUtils';

interface NamedTypePosition {
    name: string;
    typePosition: vscode.Position;
}

interface GoHeaderInfo {
    headerRange: vscode.Range;
    ownerTypeName?: string;
    receiverName?: string;
    returnTypeName?: string;
}

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
            const header = this.parseGoFunctionHeader(document, candidate.symbol);
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
            const header = this.parseGoFunctionHeader(document, fn.symbol);
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
        const params = this.parseGoParameters(document, headerRange);

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

    private static parseGoFunctionHeader(document: vscode.TextDocument, symbol: vscode.DocumentSymbol): GoHeaderInfo {
        const text = document.getText(symbol.range);
        const rangeStartOffset = document.offsetAt(symbol.range.start);
        const funcIndex = this.findGoKeyword(text, 'func', 0);
        if (funcIndex < 0) {
            return { headerRange: symbol.range };
        }

        let cursor = this.skipWhitespace(text, funcIndex + 'func'.length);
        let ownerTypeName: string | undefined;
        let receiverName: string | undefined;

        if (text[cursor] === '(') {
            const receiverClose = this.findMatchingDelimiter(text, cursor, '(', ')');
            if (receiverClose >= 0) {
                const receiver = this.parseReceiver(text.substring(cursor + 1, receiverClose));
                ownerTypeName = receiver.ownerTypeName;
                receiverName = receiver.receiverName;
                cursor = this.skipWhitespace(text, receiverClose + 1);
            }
        }

        if (!this.isIdentifierStart(text[cursor])) {
            return { headerRange: symbol.range, ownerTypeName, receiverName };
        }

        cursor = this.readIdentifierEnd(text, cursor);
        cursor = this.skipWhitespace(text, cursor);
        if (text[cursor] !== '(') {
            return { headerRange: symbol.range, ownerTypeName, receiverName };
        }

        const paramsClose = this.findMatchingDelimiter(text, cursor, '(', ')');
        if (paramsClose < 0) {
            return { headerRange: symbol.range, ownerTypeName, receiverName };
        }

        const bodyBrace = this.findGoBodyBrace(text, paramsClose + 1);
        const headerEnd = bodyBrace >= 0 ? bodyBrace : text.length;
        const returnTypeName = this.parseReturnTypeName(text.substring(paramsClose + 1, headerEnd));

        return {
            headerRange: new vscode.Range(
                document.positionAt(rangeStartOffset + funcIndex),
                document.positionAt(rangeStartOffset + headerEnd)
            ),
            ownerTypeName,
            receiverName,
            returnTypeName
        };
    }

    private static parseGoParameters(document: vscode.TextDocument, headerRange: vscode.Range): NamedTypePosition[] {
        const headerText = document.getText(headerRange);
        const headerStartOffset = document.offsetAt(headerRange.start);
        let cursor = this.findGoKeyword(headerText, 'func', 0);
        if (cursor < 0) {
            return [];
        }

        cursor = this.skipWhitespace(headerText, cursor + 'func'.length);
        if (headerText[cursor] === '(') {
            const receiverClose = this.findMatchingDelimiter(headerText, cursor, '(', ')');
            if (receiverClose < 0) {
                return [];
            }
            cursor = this.skipWhitespace(headerText, receiverClose + 1);
        }

        if (!this.isIdentifierStart(headerText[cursor])) {
            return [];
        }

        cursor = this.readIdentifierEnd(headerText, cursor);
        cursor = this.skipWhitespace(headerText, cursor);
        if (headerText[cursor] !== '(') {
            return [];
        }

        const paramsClose = this.findMatchingDelimiter(headerText, cursor, '(', ')');
        if (paramsClose < 0) {
            return [];
        }

        return this.parseGoFieldList(
            headerText.substring(cursor + 1, paramsClose),
            headerStartOffset + cursor + 1,
            document
        );
    }

    private static parseGoFieldList(text: string, absoluteStartOffset: number, document: vscode.TextDocument): NamedTypePosition[] {
        const result: NamedTypePosition[] = [];
        const fields = this.splitTopLevel(text, ',');

        for (const field of fields) {
            const trimmed = field.text.trim();
            if (!trimmed) {
                continue;
            }

            const tokens = Array.from(trimmed.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g));
            if (tokens.length < 2) {
                continue;
            }

            const typeToken = tokens[tokens.length - 1];
            const typeName = typeToken[0];
            const typeOffsetInField = field.text.indexOf(typeName, field.text.lastIndexOf(typeName));
            const typePosition = document.positionAt(
                absoluteStartOffset + field.start + typeOffsetInField + Math.floor(typeName.length / 2)
            );

            for (let i = 0; i < tokens.length - 1; i++) {
                result.push({
                    name: tokens[i][0],
                    typePosition
                });
            }
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

    private static parseReceiver(receiverText: string): { receiverName?: string, ownerTypeName?: string } {
        const tokens = Array.from(receiverText.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)).map(m => m[0]);
        if (tokens.length === 0) {
            return {};
        }

        return {
            receiverName: tokens.length > 1 ? tokens[0] : undefined,
            ownerTypeName: tokens[tokens.length - 1]
        };
    }

    private static parseReturnTypeName(text: string): string | undefined {
        const trimmed = text.trim();
        if (!trimmed) {
            return undefined;
        }

        const withoutPointer = trimmed.replace(/^[*&\s]+/, '');
        const match = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(withoutPointer);
        return match ? match[1] : undefined;
    }

    private static splitTopLevel(text: string, delimiter: string): { text: string, start: number }[] {
        const result: { text: string, start: number }[] = [];
        let start = 0;
        let parenDepth = 0;
        let bracketDepth = 0;
        let braceDepth = 0;

        for (let i = 0; i <= text.length; i++) {
            const ch = text[i] || delimiter;
            if (ch === '(') {
                parenDepth++;
            } else if (ch === ')') {
                parenDepth = Math.max(0, parenDepth - 1);
            } else if (ch === '[') {
                bracketDepth++;
            } else if (ch === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
            } else if (ch === '{') {
                braceDepth++;
            } else if (ch === '}') {
                braceDepth = Math.max(0, braceDepth - 1);
            }

            if (ch === delimiter && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
                result.push({ text: text.substring(start, i), start });
                start = i + 1;
            }
        }

        return result;
    }

    private static findGoKeyword(text: string, keyword: string, start: number): number {
        let cursor = start;
        while (cursor < text.length) {
            const index = text.indexOf(keyword, cursor);
            if (index < 0) { return -1; }

            const before = index > 0 ? text[index - 1] : '';
            const after = text[index + keyword.length] || '';
            if (!this.isIdentifierPart(before) && !this.isIdentifierPart(after)) {
                return index;
            }

            cursor = index + keyword.length;
        }

        return -1;
    }

    private static findGoBodyBrace(text: string, start: number): number {
        let parenDepth = 0;
        let bracketDepth = 0;

        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (ch === '(') {
                parenDepth++;
            } else if (ch === ')') {
                parenDepth = Math.max(0, parenDepth - 1);
            } else if (ch === '[') {
                bracketDepth++;
            } else if (ch === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
            } else if (ch === '{' && parenDepth === 0 && bracketDepth === 0) {
                return i;
            }
        }

        return -1;
    }

    private static findMatchingDelimiter(text: string, openIndex: number, open: string, close: string): number {
        let depth = 0;
        for (let i = openIndex; i < text.length; i++) {
            if (text[i] === open) {
                depth++;
            } else if (text[i] === close) {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }

        return -1;
    }

    private static skipWhitespace(text: string, start: number): number {
        let cursor = start;
        while (cursor < text.length && /\s/.test(text[cursor])) {
            cursor++;
        }
        return cursor;
    }

    private static isIdentifierStart(ch: string | undefined): boolean {
        return !!ch && (ch === '_' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z'));
    }

    private static isIdentifierPart(ch: string | undefined): boolean {
        return !!ch && (this.isIdentifierStart(ch) || (ch >= '0' && ch <= '9'));
    }

    private static readIdentifierEnd(text: string, start: number): number {
        let cursor = start;
        while (cursor < text.length && this.isIdentifierPart(text[cursor])) {
            cursor++;
        }
        return cursor;
    }
}
