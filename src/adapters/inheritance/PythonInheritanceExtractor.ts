import * as vscode from 'vscode';
import { LSPService } from '../../services/LSPServices';
import { DocumentSymbolIndex } from '../../services/AdapterServices';
import { ExtractionResult, ExtractorUtils, SymbolCache } from '../ExtractorUtils';

export class PythonInheritanceExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<ExtractionResult> {
        const edges: ExtractionResult['edges'] = [];
        const placeholderNodes: ExtractionResult['placeholderNodes'] = [];

        const cache: SymbolCache = new Map();

        for (const clsItem of index.classes) {
            const supertypes = await LSPService.getTypeHierarchySupertypes(document.uri, clsItem.symbol.selectionRange.start);
            if (supertypes && supertypes.length > 0) {
                for (const superTypeItem of supertypes) {
                    const targetUri = superTypeItem.uri;
                    const targetRange = superTypeItem.selectionRange;

                    const targetInfo = await ExtractorUtils.resolveSymbolInfo(targetUri, targetRange.start, cache);
                    if (targetInfo && targetInfo.type === 'class') {
                        ExtractorUtils.addResolvedRelation(edges, placeholderNodes, clsItem.id, targetInfo, 'extends');
                    }
                }
            }
        }
        return { edges, placeholderNodes };
    }
}
