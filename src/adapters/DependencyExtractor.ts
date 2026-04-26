import * as vscode from 'vscode';
import { EdgeData, IRNode } from '../models/GraphDefinition';
import { LSPService } from '../services/LSPServices';
import { DocumentSymbolIndex } from '../services/AdapterServices';
import { ExtractorUtils } from './ExtractorUtils';


export class DependencyExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string,
        languageId: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];
        const cache = new Map<string, vscode.DocumentSymbol[]>();

        if (languageId === 'go') {
            await this.analyzeGoReceiverDependencies(document, index, edges, placeholderNodes, cache);
            return { edges, placeholderNodes };
        }

        const targetNodes = [...index.classes, ...index.interfaces];

        for (const clsItem of targetNodes) {
            if (!clsItem.symbol.children) { continue; }

            for (const child of clsItem.symbol.children) {
                // 仅从方法或函数中提取依赖关系（如参数、返回值等）
                if (child.kind === vscode.SymbolKind.Method || child.kind === vscode.SymbolKind.Function) {

                    const positionsToQuery: vscode.Position[] = this.extractTypesPositionsFromMethod(document, child, languageId);

                    await this.addUsesEdgesFromPositions(
                        document,
                        clsItem.id,
                        positionsToQuery,
                        edges,
                        placeholderNodes,
                        cache
                    );
                }
            }
        }

        return { edges, placeholderNodes };
    }

    /**
     * 从方法签名中提取可能对应的类型标识符位置，支持多种语言处理
     */
    private static extractTypesPositionsFromMethod(
        document: vscode.TextDocument,
        methodSymbol: vscode.DocumentSymbol,
        languageId: string
    ): vscode.Position[] {
        const positions: vscode.Position[] = [];

        const startPos = methodSymbol.selectionRange.start;
        const endPos = methodSymbol.range.end;

        // 提取前5行作为签名搜索范围
        const signatureEndLine = Math.min(startPos.line + 5, endPos.line);
        const signatureEndPos = new vscode.Position(signatureEndLine, document.lineAt(signatureEndLine).text.length);

        const rawText = document.getText(new vscode.Range(startPos, signatureEndPos));

        // 截断方法体
        let signatureText = rawText;
        const braceIdx = rawText.indexOf('{');
        if (braceIdx !== -1) {
            signatureText = rawText.substring(0, braceIdx);
        } else if (languageId === 'python') {
            const colonIdx = rawText.indexOf(':');
            if (colonIdx !== -1) {
                signatureText = rawText.substring(0, colonIdx);
            }
        }

        // 语言特定关键字过滤
        const skipWords = new Set<string>();
        if (languageId === 'python') {
            ['def', 'self', 'cls', 'None', 'int', 'str', 'bool', 'float', 'list', 'dict', 'set', 'tuple', 'Any', 'Callable'].forEach(w => skipWords.add(w));
        } else if (languageId === 'go') {
            ['func', 'error', 'int', 'int32', 'int64', 'string', 'bool', 'byte', 'rune', 'float32', 'float64'].forEach(w => skipWords.add(w));
        } else if (languageId === 'typescript' || languageId === 'javascript') {
            ['public', 'private', 'protected', 'static', 'async', 'get', 'set', 'function', 'void', 'any', 'string', 'number', 'boolean', 'Promise', 'Array'].forEach(w => skipWords.add(w));
        }

        // 匹配可能的类型标识符并计算其绝对位置
        const wordRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
        let match;
        while ((match = wordRegex.exec(signatureText)) !== null) {
            const word = match[0];
            if (word === methodSymbol.name || skipWords.has(word)) {
                continue;
            }

            const offset = match.index;
            const textBeforeMatch = signatureText.substring(0, offset);
            const newLinesCount = (textBeforeMatch.match(/\n/g) || []).length;

            let absLine = startPos.line + newLinesCount;
            let absChar = 0;

            if (newLinesCount === 0) {
                absChar = startPos.character + offset;
            } else {
                const lastNewLineIdx = textBeforeMatch.lastIndexOf('\n');
                absChar = textBeforeMatch.length - lastNewLineIdx - 1;
            }

            // 取单词中间位置以供 LSP 查询
            const targetChar = absChar + Math.floor(word.length / 2);
            positions.push(new vscode.Position(absLine, targetChar));
        }

        return positions;
    }

    /**
     * Go 的接收者方法通常是文件级符号，不能依赖 LSP namespace 反推出所属类型。
     * 这里仅从函数声明头定位 receiver owner，依赖目标仍交给 LSP 定义跳转解析。
     */
    private static async analyzeGoReceiverDependencies(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        edges: EdgeData[],
        placeholderNodes: IRNode[],
        cache: Map<string, vscode.DocumentSymbol[]>
    ): Promise<void> {
        const receiverMethods = this.collectGoReceiverMethods(document, index);

        for (const item of receiverMethods) {
            const positionsToQuery = this.extractGoSignatureTypePositions(document, item.headerRange);
            await this.addUsesEdgesFromPositions(
                document,
                item.ownerId,
                positionsToQuery,
                edges,
                placeholderNodes,
                cache
            );
        }
    }

    private static collectGoReceiverMethods(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex
    ): { ownerId: string, symbol: vscode.DocumentSymbol, headerRange: vscode.Range }[] {
        const ownerIdsByTypeName = new Map<string, string>();
        for (const item of [...index.classes, ...index.interfaces]) {
            ownerIdsByTypeName.set(item.symbol.name, item.id);
        }

        const candidates = [...index.methods, ...index.functions];
        const result: { ownerId: string, symbol: vscode.DocumentSymbol, headerRange: vscode.Range }[] = [];
        const seenSymbols = new Set<string>();

        for (const candidate of candidates) {
            const parsed = this.parseGoReceiverMethodHeader(document, candidate.symbol);
            if (!parsed) { continue; }

            const ownerId = ownerIdsByTypeName.get(parsed.receiverTypeName);
            if (!ownerId) { continue; }

            const symbolKey = `${candidate.symbol.range.start.line}:${candidate.symbol.range.start.character}:${candidate.symbol.name}`;
            if (seenSymbols.has(symbolKey)) { continue; }
            seenSymbols.add(symbolKey);

            result.push({
                ownerId,
                symbol: candidate.symbol,
                headerRange: parsed.headerRange
            });
        }

        return result;
    }

    private static parseGoReceiverMethodHeader(
        document: vscode.TextDocument,
        symbol: vscode.DocumentSymbol
    ): { receiverTypeName: string, headerRange: vscode.Range } | undefined {
        const startOffset = document.offsetAt(symbol.range.start);
        const endOffset = document.offsetAt(symbol.range.end);
        const text = document.getText(new vscode.Range(symbol.range.start, symbol.range.end));

        const funcIndex = this.findGoKeyword(text, 'func', 0);
        if (funcIndex < 0) { return undefined; }

        let cursor = this.skipWhitespace(text, funcIndex + 'func'.length);
        if (text[cursor] !== '(') { return undefined; }

        const receiverClose = this.findMatchingDelimiter(text, cursor, '(', ')');
        if (receiverClose < 0) { return undefined; }

        const receiverText = text.substring(cursor + 1, receiverClose);
        const receiverTypeName = this.normalizeGoReceiverType(receiverText);
        if (!receiverTypeName) { return undefined; }

        cursor = this.skipWhitespace(text, receiverClose + 1);
        if (!this.isIdentifierStart(text[cursor])) { return undefined; }

        cursor = this.readIdentifierEnd(text, cursor);
        cursor = this.skipWhitespace(text, cursor);
        if (text[cursor] !== '(') { return undefined; }

        const paramsClose = this.findMatchingDelimiter(text, cursor, '(', ')');
        if (paramsClose < 0) { return undefined; }

        const bodyBrace = this.findGoBodyBrace(text, paramsClose + 1);
        const headerEnd = bodyBrace >= 0 ? bodyBrace : text.length;

        return {
            receiverTypeName,
            headerRange: new vscode.Range(
                document.positionAt(startOffset + funcIndex),
                document.positionAt(startOffset + headerEnd)
            )
        };
    }

    private static extractGoSignatureTypePositions(
        document: vscode.TextDocument,
        headerRange: vscode.Range
    ): vscode.Position[] {
        const positions: vscode.Position[] = [];
        const headerText = document.getText(headerRange);
        const headerStartOffset = document.offsetAt(headerRange.start);
        const skipWords = new Set([
            'func', 'error', 'int', 'int8', 'int16', 'int32', 'int64',
            'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
            'string', 'bool', 'byte', 'rune', 'float32', 'float64',
            'complex64', 'complex128', 'any', 'comparable', 'chan', 'map',
            'struct', 'interface'
        ]);

        let cursor = 0;
        while (cursor < headerText.length) {
            if (!this.isIdentifierStart(headerText[cursor])) {
                cursor++;
                continue;
            }

            const start = cursor;
            const end = this.readIdentifierEnd(headerText, cursor);
            const word = headerText.substring(start, end);

            if (!skipWords.has(word)) {
                const absoluteOffset = headerStartOffset + start + Math.floor(word.length / 2);
                positions.push(document.positionAt(absoluteOffset));
            }

            cursor = end;
        }

        return positions;
    }

    private static normalizeGoReceiverType(receiverText: string): string | undefined {
        const parts = this.splitGoFields(receiverText.trim());
        let typeText = parts.length > 1 ? parts[parts.length - 1] : parts[0];
        if (!typeText) { return undefined; }

        typeText = typeText.trim();
        while (typeText.startsWith('*') || typeText.startsWith('&')) {
            typeText = typeText.substring(1).trim();
        }

        const genericStart = typeText.indexOf('[');
        if (genericStart >= 0) {
            typeText = typeText.substring(0, genericStart);
        }

        const dotIndex = typeText.lastIndexOf('.');
        if (dotIndex >= 0) {
            typeText = typeText.substring(dotIndex + 1);
        }

        if (!typeText || !this.isIdentifierStart(typeText[0])) {
            return undefined;
        }

        const end = this.readIdentifierEnd(typeText, 0);
        return typeText.substring(0, end);
    }

    private static async addUsesEdgesFromPositions(
        document: vscode.TextDocument,
        sourceId: string,
        positionsToQuery: vscode.Position[],
        edges: EdgeData[],
        placeholderNodes: IRNode[],
        cache: Map<string, vscode.DocumentSymbol[]>
    ): Promise<void> {
        for (const pos of positionsToQuery) {
            // 尝试获取符号的定义，若失败则回退尝试类型定义
            let definitions = await LSPService.getDefinition(document.uri, pos);
            if (!definitions || definitions.length === 0) {
                definitions = await LSPService.getTypeDefinition(document.uri, pos);
            }

            if (!definitions || definitions.length === 0) { continue; }

            for (const def of definitions) {
                const targetUri = 'uri' in def ? def.uri : def.targetUri;
                const targetRange = 'range' in def ? def.range : (def.targetSelectionRange || def.targetRange);

                if (!targetRange) { continue; }

                const targetInfo = await ExtractorUtils.resolveSymbolInfo(targetUri, targetRange.start, cache);

                // 仅构建指向类或接口的依赖（uses）关系
                if (targetInfo && (targetInfo.type === 'class' || targetInfo.type === 'interface')) {
                    // 跳过自引用
                    if (sourceId === targetInfo.id) {
                        continue;
                    }

                    // 避免重复添加相同的依赖边
                    const edgeExists = edges.some(e => e.sourceId === sourceId && e.targetId === targetInfo.id && e.relation === 'uses');
                    if (edgeExists) {
                        continue;
                    }

                    edges.push({
                        sourceId,
                        targetId: targetInfo.id,
                        relation: 'uses'
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

    private static splitGoFields(text: string): string[] {
        const fields: string[] = [];
        let start = -1;
        let bracketDepth = 0;

        for (let i = 0; i <= text.length; i++) {
            const ch = text[i] || ' ';
            if (ch === '[') {
                bracketDepth++;
            } else if (ch === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
            }

            const isSeparator = bracketDepth === 0 && /\s/.test(ch);
            if (!isSeparator && start < 0) {
                start = i;
            } else if (isSeparator && start >= 0) {
                fields.push(text.substring(start, i));
                start = -1;
            }
        }

        return fields;
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
