import * as vscode from 'vscode';
import { EdgeData, IRNode } from '../models/GraphDefinition';
import { DocumentSymbolIndex } from '../services/AdapterServices';
import { GoAggregationExtractor } from './aggregation/GoAggregationExtractor';
import { PythonAggregationExtractor } from './aggregation/PythonAggregationExtractor';
import { TypeScriptAggregationExtractor } from './aggregation/TypeScriptAggregationExtractor';

export class AggregationExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string,
        languageId: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        switch (languageId) {
            case 'typescript':
            case 'typescriptreact':
            case 'javascript':
            case 'javascriptreact':
                return TypeScriptAggregationExtractor.analyze(document, index, uriString);
            case 'python':
                return PythonAggregationExtractor.analyze(document, index, uriString);
            case 'go':
                return GoAggregationExtractor.analyze(document, index, uriString);
            default:
                return { edges: [], placeholderNodes: [] };
        }
    }
}
