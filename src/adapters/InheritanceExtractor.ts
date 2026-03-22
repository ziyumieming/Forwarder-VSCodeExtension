import * as vscode from 'vscode';
import { EdgeData, IRNode } from '../models/GraphDefinition';
import { PythonInheritanceExtractor } from './inheriance/PythonInheritanceExtractor';

import { DocumentSymbolIndex } from '../services/AdapterServices';

export class InheritanceExtractor {
    public static async extractEdges(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string,
        languageId: string  // 从 document.languageId 传进来
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        switch (languageId) {
            // case 'go':
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