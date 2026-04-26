import * as vscode from 'vscode';
import { DocumentSymbolIndex } from '../../services/AdapterServices';
import { ExtractionResult, ExtractorUtils, SymbolCache } from '../ExtractorUtils';

export class TypeScriptDependencyExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        _uriString: string
    ): Promise<ExtractionResult> {
        const edges: ExtractionResult['edges'] = [];
        const placeholderNodes: ExtractionResult['placeholderNodes'] = [];
        const cache: SymbolCache = new Map();

        for (const clsItem of [...index.classes, ...index.interfaces]) {
            if (!clsItem.symbol.children) {
                continue;
            }

            for (const child of clsItem.symbol.children) {
                if (!this.isMethodLike(child.kind)) {
                    continue;
                }

                const positions = this.extractSignatureTypePositions(document, child);
                await ExtractorUtils.addRelationsFromPositions(
                    document,
                    clsItem.id,
                    positions,
                    'uses',
                    edges,
                    placeholderNodes,
                    cache
                );
            }
        }

        return { edges, placeholderNodes };
    }

    private static extractSignatureTypePositions(document: vscode.TextDocument, symbol: vscode.DocumentSymbol): vscode.Position[] {
        const text = document.getText(symbol.range);
        const baseOffset = document.offsetAt(symbol.range.start);
        const firstParen = text.indexOf('(');
        if (firstParen < 0) {
            return [];
        }

        const paramsClose = this.findMatchingDelimiter(text, firstParen, '(', ')');
        if (paramsClose < 0) {
            return [];
        }

        const positions: vscode.Position[] = [];
        const paramsText = text.substring(firstParen + 1, paramsClose);
        this.collectTypeAnnotationPositions(document, paramsText, baseOffset + firstParen + 1, positions);

        const braceIndex = text.indexOf('{', paramsClose + 1);
        const arrowIndex = text.indexOf('=>', paramsClose + 1);
        const signatureEnd = [braceIndex, arrowIndex]
            .filter(i => i >= 0)
            .reduce((min, i) => Math.min(min, i), text.length);
        const afterParams = text.substring(paramsClose + 1, signatureEnd);
        this.collectReturnTypePositions(document, afterParams, baseOffset + paramsClose + 1, positions);

        return positions;
    }

    private static collectTypeAnnotationPositions(
        document: vscode.TextDocument,
        text: string,
        absoluteStartOffset: number,
        output: vscode.Position[]
    ): void {
        const annotationRegex = /:\s*([^=,)]*)/g;
        let match: RegExpExecArray | null;

        while ((match = annotationRegex.exec(text)) !== null) {
            const typeText = match[1];
            const typeStart = absoluteStartOffset + match.index + match[0].indexOf(typeText);
            this.collectIdentifierPositions(document, typeText, typeStart, output);
        }
    }

    private static collectReturnTypePositions(
        document: vscode.TextDocument,
        text: string,
        absoluteStartOffset: number,
        output: vscode.Position[]
    ): void {
        const match = /:\s*([\s\S]*)/.exec(text);
        if (!match) {
            return;
        }

        const typeText = match[1];
        const typeStart = absoluteStartOffset + match.index + match[0].indexOf(typeText);
        this.collectIdentifierPositions(document, typeText, typeStart, output);
    }

    private static collectIdentifierPositions(
        document: vscode.TextDocument,
        typeText: string,
        absoluteStartOffset: number,
        output: vscode.Position[]
    ): void {
        const skipWords = new Set([
            'string', 'number', 'boolean', 'bigint', 'symbol', 'undefined', 'null',
            'void', 'never', 'unknown', 'any', 'object', 'Array', 'Promise', 'ReadonlyArray',
            'Record', 'Partial', 'Required', 'Pick', 'Omit'
        ]);
        const wordRegex = /[A-Za-z_$][\w$]*/g;
        let match: RegExpExecArray | null;

        while ((match = wordRegex.exec(typeText)) !== null) {
            const word = match[0];
            if (skipWords.has(word)) {
                continue;
            }

            output.push(document.positionAt(absoluteStartOffset + match.index + Math.floor(word.length / 2)));
        }
    }

    private static isMethodLike(kind: vscode.SymbolKind): boolean {
        return kind === vscode.SymbolKind.Method ||
            kind === vscode.SymbolKind.Function ||
            kind === vscode.SymbolKind.Constructor;
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
}
