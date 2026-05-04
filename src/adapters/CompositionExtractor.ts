import * as vscode from 'vscode';
import { DocumentSymbolIndex } from '../services/AdapterServices';
import { ExtractionResult, ExtractorUtils, SymbolCache } from './ExtractorUtils';


export class CompositionExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<ExtractionResult> {
        const edges: ExtractionResult['edges'] = [];
        const placeholderNodes: ExtractionResult['placeholderNodes'] = [];
        const cache: SymbolCache = new Map();

        const targetNodes = [...index.classes, ...index.interfaces];

        for (const clsItem of targetNodes) {
            if (!clsItem.symbol.children) { continue; }

            for (const child of clsItem.symbol.children) {
                if (
                    child.kind === vscode.SymbolKind.Field ||
                    child.kind === vscode.SymbolKind.Property ||
                    child.kind === vscode.SymbolKind.Variable
                ) {
                    const targetInfo = await ExtractorUtils.resolveDefinitionSymbolInfo(document.uri, child.selectionRange.end, cache);
                    if (!targetInfo || clsItem.id === targetInfo.id) {
                        continue;
                    }

                    ExtractorUtils.addResolvedRelation(edges, placeholderNodes, clsItem.id, targetInfo, 'composes');
                }
            }
        }

        return { edges, placeholderNodes };
    }
}
