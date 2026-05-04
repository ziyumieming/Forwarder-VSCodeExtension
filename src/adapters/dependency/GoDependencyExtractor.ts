import * as vscode from 'vscode';
import { DocumentSymbolIndex } from '../../services/AdapterServices';
import { ExtractionResult, ExtractorUtils, SymbolCache } from '../ExtractorUtils';
import { GoSyntaxUtils } from '../languages/GoSyntaxUtils';

export class GoDependencyExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        _uriString: string
    ): Promise<ExtractionResult> {
        const edges: ExtractionResult['edges'] = [];
        const placeholderNodes: ExtractionResult['placeholderNodes'] = [];
        const cache: SymbolCache = new Map();
        const ownerIdsByTypeName = new Map<string, string>();

        for (const item of [...index.classes, ...index.interfaces]) {
            ownerIdsByTypeName.set(item.symbol.name, item.id);
        }

        for (const candidate of [...index.methods, ...index.functions]) {
            const header = GoSyntaxUtils.parseFunctionHeader(document, candidate.symbol);
            if (!header.ownerTypeName) {
                continue;
            }

            const ownerId = ownerIdsByTypeName.get(header.ownerTypeName);
            if (!ownerId) {
                continue;
            }

            const positions = this.extractSignatureTypePositions(document, header.headerRange);
            await ExtractorUtils.addRelationsFromPositions(
                document,
                ownerId,
                positions,
                'uses',
                edges,
                placeholderNodes,
                cache
            );
        }

        return { edges, placeholderNodes };
    }

    private static extractSignatureTypePositions(document: vscode.TextDocument, headerRange: vscode.Range): vscode.Position[] {
        const positions: vscode.Position[] = [];
        const params = GoSyntaxUtils.parseParameters(document, headerRange);
        for (const param of params) {
            positions.push(param.typePosition);
        }

        const headerText = document.getText(headerRange);
        const headerStartOffset = document.offsetAt(headerRange.start);
        const paramsClose = headerText.lastIndexOf(')');
        if (paramsClose >= 0) {
            const returnText = headerText.substring(paramsClose + 1);
            this.collectReturnTypePositions(document, returnText, headerStartOffset + paramsClose + 1, positions);
        }

        return positions;
    }

    private static collectReturnTypePositions(
        document: vscode.TextDocument,
        text: string,
        absoluteStartOffset: number,
        output: vscode.Position[]
    ): void {
        const skipWords = new Set([
            'error', 'int', 'int8', 'int16', 'int32', 'int64',
            'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
            'string', 'bool', 'byte', 'rune', 'float32', 'float64',
            'complex64', 'complex128', 'any', 'comparable', 'chan', 'map',
            'struct', 'interface'
        ]);
        const wordRegex = /[A-Za-z_][A-Za-z0-9_]*/g;
        let match: RegExpExecArray | null;

        while ((match = wordRegex.exec(text)) !== null) {
            const word = match[0];
            if (skipWords.has(word)) {
                continue;
            }

            output.push(document.positionAt(absoluteStartOffset + match.index + Math.floor(word.length / 2)));
        }
    }
}
