import * as vscode from 'vscode';
import { PythonInheritanceExtractor } from './inheritance/PythonInheritanceExtractor';
import { GoInheritanceExtractor } from './inheritance/GoInheritanceExtractor';

import { DocumentSymbolIndex } from '../services/AdapterServices';
import { ExtractionResult } from './ExtractorUtils';




export class InheritanceExtractor {
    public static async extractEdges(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string,
        languageId: string  // 从 document.languageId 传进来
    ): Promise<ExtractionResult> {
        switch (languageId) {
            case 'go':
                return await GoInheritanceExtractor.analyze(document, index, uriString);
            case 'python':
                return await PythonInheritanceExtractor.analyze(document, index, uriString);
            // case 'typescript':
            // case 'javascript':
            // case 'java':
            default:
                return { edges: [], placeholderNodes: [] };
        }
    }
}
