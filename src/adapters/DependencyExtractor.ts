import * as vscode from 'vscode';
import { DocumentSymbolIndex } from '../services/AdapterServices';
import { ExtractionResult } from './ExtractorUtils';
import { GoDependencyExtractor } from './dependency/GoDependencyExtractor';
import { PythonDependencyExtractor } from './dependency/PythonDependencyExtractor';
import { TypeScriptDependencyExtractor } from './dependency/TypeScriptDependencyExtractor';

export class DependencyExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string,
        languageId: string
    ): Promise<ExtractionResult> {
        switch (languageId) {
            case 'typescript':
            case 'typescriptreact':
            case 'javascript':
            case 'javascriptreact':
                return TypeScriptDependencyExtractor.analyze(document, index, uriString);
            case 'python':
                return PythonDependencyExtractor.analyze(document, index, uriString);
            case 'go':
                return GoDependencyExtractor.analyze(document, index, uriString);
            default:
                return { edges: [], placeholderNodes: [] };
        }
    }
}
