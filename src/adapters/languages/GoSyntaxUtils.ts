import * as vscode from 'vscode';

export interface NamedTypePosition {
    name: string;
    typePosition: vscode.Position;
}

export interface GoHeaderInfo {
    headerRange: vscode.Range;
    ownerTypeName?: string;
    receiverName?: string;
    returnTypeName?: string;
}

export class GoSyntaxUtils {
    public static parseFunctionHeader(document: vscode.TextDocument, symbol: vscode.DocumentSymbol): GoHeaderInfo {
        const text = document.getText(symbol.range);
        const rangeStartOffset = document.offsetAt(symbol.range.start);
        const funcIndex = this.findKeyword(text, 'func', 0);
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

        const bodyBrace = this.findBodyBrace(text, paramsClose + 1);
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

    public static parseParameters(document: vscode.TextDocument, headerRange: vscode.Range): NamedTypePosition[] {
        const headerText = document.getText(headerRange);
        const headerStartOffset = document.offsetAt(headerRange.start);
        let cursor = this.findKeyword(headerText, 'func', 0);
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

        return this.parseFieldList(
            headerText.substring(cursor + 1, paramsClose),
            headerStartOffset + cursor + 1,
            document
        );
    }

    public static splitTopLevel(text: string, delimiter: string): { text: string, start: number }[] {
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

    public static findMatchingDelimiter(text: string, openIndex: number, open: string, close: string): number {
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

    private static parseFieldList(text: string, absoluteStartOffset: number, document: vscode.TextDocument): NamedTypePosition[] {
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

    private static findKeyword(text: string, keyword: string, start: number): number {
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

    private static findBodyBrace(text: string, start: number): number {
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
