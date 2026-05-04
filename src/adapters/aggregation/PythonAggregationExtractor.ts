import * as vscode from 'vscode';
import { EdgeData, IRNode } from '../../models/GraphDefinition';
import { DocumentSymbolIndex } from '../../services/AdapterServices';
import { ExtractorUtils, ResolvedSymbolInfo } from '../ExtractorUtils';

interface NamedTypePosition {
    name: string;
    typePosition: vscode.Position;
}

export class PythonAggregationExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        _uriString: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];
        const cache = new Map<string, vscode.DocumentSymbol[]>();

        for (const clsItem of index.classes) {
            if (!clsItem.symbol.children) {
                continue;
            }

            for (const method of clsItem.symbol.children) {
                if (method.kind !== vscode.SymbolKind.Method && method.kind !== vscode.SymbolKind.Function) {
                    continue;
                }

                const parameterTypes = await this.collectParameterTypes(document, method, cache, placeholderNodes);
                if (parameterTypes.size === 0) {
                    continue;
                }

                const assignments = this.collectSelfAssignments(document, method);
                for (const assignment of assignments) {
                    const parameterInfo = parameterTypes.get(assignment.parameterName);
                    if (!parameterInfo) {
                        continue;
                    }

                    if (ExtractorUtils.addEdgeOnce(edges, clsItem.id, parameterInfo.id, 'aggregates')) {
                        ExtractorUtils.addPlaceholderOnce(placeholderNodes, parameterInfo);
                    }
                }
            }
        }

        return { edges, placeholderNodes };
    }

    private static async collectParameterTypes(
        document: vscode.TextDocument,
        method: vscode.DocumentSymbol,
        cache: Map<string, vscode.DocumentSymbol[]>,
        placeholderNodes: IRNode[]
    ): Promise<Map<string, ResolvedSymbolInfo>> {
        const result = new Map<string, ResolvedSymbolInfo>();
        const params = this.parseTypedParameters(document, method);

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

    private static parseTypedParameters(document: vscode.TextDocument, method: vscode.DocumentSymbol): NamedTypePosition[] {
        const text = document.getText(method.range);
        const rangeStartOffset = document.offsetAt(method.range.start);
        const defIndex = text.indexOf('def ');
        const firstParen = text.indexOf('(', defIndex >= 0 ? defIndex : 0);
        if (firstParen < 0) {
            return [];
        }

        const closeParen = this.findMatchingDelimiter(text, firstParen, '(', ')');
        if (closeParen < 0) {
            return [];
        }

        const parameterText = text.substring(firstParen + 1, closeParen);
        const parameterStartOffset = rangeStartOffset + firstParen + 1;
        const parts = this.splitTopLevel(parameterText, ',');
        const result: NamedTypePosition[] = [];

        for (const part of parts) {
            const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(part.text);
            if (!match || match[1] === 'self' || match[1] === 'cls') {
                continue;
            }

            const typeLocalOffset = part.start + match.index + match[0].lastIndexOf(match[2]);
            result.push({
                name: match[1],
                typePosition: document.positionAt(parameterStartOffset + typeLocalOffset + Math.floor(match[2].length / 2))
            });
        }

        return result;
    }

    private static collectSelfAssignments(
        document: vscode.TextDocument,
        method: vscode.DocumentSymbol
    ): { fieldName: string, parameterName: string }[] {
        const text = document.getText(method.range);
        const assignments: { fieldName: string, parameterName: string }[] = [];
        const regex = /\bself\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\b/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            assignments.push({
                fieldName: match[1],
                parameterName: match[2]
            });
        }

        return assignments;
    }

    private static splitTopLevel(text: string, delimiter: string): { text: string, start: number }[] {
        const result: { text: string, start: number }[] = [];
        let start = 0;
        let bracketDepth = 0;
        let parenDepth = 0;

        for (let i = 0; i <= text.length; i++) {
            const ch = text[i] || delimiter;
            if (ch === '[') {
                bracketDepth++;
            } else if (ch === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
            } else if (ch === '(') {
                parenDepth++;
            } else if (ch === ')') {
                parenDepth = Math.max(0, parenDepth - 1);
            }

            if (ch === delimiter && bracketDepth === 0 && parenDepth === 0) {
                result.push({ text: text.substring(start, i), start });
                start = i + 1;
            }
        }

        return result;
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
