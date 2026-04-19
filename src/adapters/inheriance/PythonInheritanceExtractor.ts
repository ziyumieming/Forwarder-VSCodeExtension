import * as vscode from 'vscode';
import { EdgeData, IRNode, NodeType } from '../../models/GraphDefinition';
import { LSPService } from '../../services/LSPServices';
import { DocumentSymbolIndex } from '../../services/AdapterServices';
import { ExtractorUtils } from '../Extractor';

export class PythonInheritanceExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];

        const cache = new Map<string, vscode.DocumentSymbol[]>();

        for (const clsItem of index.classes) {
            const supertypes = await LSPService.getTypeHierarchySupertypes(document.uri, clsItem.symbol.selectionRange.start);
            if (supertypes && supertypes.length > 0) {
                for (const superTypeItem of supertypes) {
                    const targetUri = superTypeItem.uri;
                    const targetRange = superTypeItem.selectionRange;

                    const targetInfo = await ExtractorUtils.resolveSymbolInfo(targetUri, targetRange.start, cache);
                    if (targetInfo && targetInfo.type === 'class') {
                        edges.push({
                            sourceId: clsItem.id,
                            targetId: targetInfo.id,
                            relation: 'extends'
                        });

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
                            placeHolder: true
                        });
                    }
                }
            }
        }
        return { edges, placeholderNodes };
    }
}
