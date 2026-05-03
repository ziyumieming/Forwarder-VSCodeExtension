import * as vscode from 'vscode';
import * as crypto from 'crypto';
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
    bodyHash: string;
}

export interface FunctionBatchSummaryContext {
    fileUri: string;
    fileName: string;
    languageId: string;
    functions: FunctionSummaryContext[];
}

export class SummaryContextService {
    public static readonly BATCH_MAX_FUNCTIONS = 8;
    public static readonly BATCH_MAX_FUNCTION_LINES = 120;
    public static readonly BATCH_MAX_FUNCTION_CHARS = 6000;
    public static readonly BATCH_MAX_TOTAL_CHARS = 24000;

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
            sourceCode,
            bodyHash: this.hashSource(sourceCode)
        };
    }

    public static async buildFunctionBatchContext(graph: ProjectGraph, nodeIds: string[]): Promise<FunctionBatchSummaryContext> {
        const functions: FunctionSummaryContext[] = [];
        let fileUri = '';
        let languageId = '';
        let totalChars = 0;

        for (const nodeId of nodeIds) {
            const node = graph.getNode(nodeId);
            if (!node || (node.type !== 'function' && node.type !== 'method') || node.isLibrary || node.placeHolder) {
                continue;
            }
            if (fileUri && node.location.uri !== fileUri) {
                continue;
            }
            if (functions.length >= this.BATCH_MAX_FUNCTIONS) {
                continue;
            }

            const context = await this.buildFunctionContext(graph, nodeId);
            if (!context.sourceCode.trim()) {
                continue;
            }
            const lineCount = context.sourceCode.split(/\r?\n/).length;
            if (lineCount > this.BATCH_MAX_FUNCTION_LINES || context.sourceCode.length > this.BATCH_MAX_FUNCTION_CHARS) {
                continue;
            }
            if (totalChars + context.sourceCode.length > this.BATCH_MAX_TOTAL_CHARS) {
                continue;
            }

            fileUri = node.location.uri;
            languageId = context.languageId;
            totalChars += context.sourceCode.length;
            functions.push(context);
        }

        return {
            fileUri,
            fileName: fileUri ? SourceLocationService.summarizeUri(fileUri) : '',
            languageId,
            functions
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

    private static hashSource(sourceCode: string): string {
        return crypto.createHash('sha256').update(sourceCode, 'utf8').digest('hex');
    }
}
