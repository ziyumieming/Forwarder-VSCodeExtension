import * as vscode from 'vscode';
import { IRNode } from '../models/GraphDefinition';
import { ProjectGraph } from '../models/GraphManager';
import { SourceLocationService } from './SourceLocationServices';

export interface FunctionSummaryContext {
    nodeId: string;
    label: string;
    name: string;
    signature: string;
    namespace?: string;
    fileName: string;
    languageId: string;
    sourceCode: string;
}

export class SummaryContextService {
    public static async buildFunctionContext(graph: ProjectGraph, nodeId: string): Promise<FunctionSummaryContext> {
        const node = graph.getNode(nodeId);
        if (!node) {
            throw new Error(`Function node not found: ${nodeId}`);
        }

        if (node.type !== 'function' && node.type !== 'method') {
            throw new Error(`Summary target must be a function or method: ${nodeId}`);
        }

        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(node.location.uri));
        const sourceCode = document.getText(this.toVscodeRange(node.location.range)).trim();
        const signature = this.resolveSignature(node, sourceCode);

        return {
            nodeId: node.id,
            label: signature || node.name,
            name: node.name,
            signature,
            namespace: node.namespace,
            fileName: SourceLocationService.summarizeUri(node.location.uri),
            languageId: document.languageId,
            sourceCode
        };
    }

    private static resolveSignature(node: IRNode, sourceCode: string): string {
        if (node.signature && node.signature.trim().length > 0) {
            return node.signature.trim();
        }

        const firstLine = sourceCode.split(/\r?\n/, 1)[0]?.trim();
        return firstLine && firstLine.length > 0 ? firstLine : node.name;
    }

    private static toVscodeRange(range: IRNode['location']['range']): vscode.Range {
        return new vscode.Range(
            new vscode.Position(range.start.line, range.start.character),
            new vscode.Position(range.end.line, range.end.character)
        );
    }
}
