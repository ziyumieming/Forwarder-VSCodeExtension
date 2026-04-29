import * as vscode from 'vscode';
import { AnalysisViewProvider } from '../providers/AnalysisView';
import { AnalysisRuntime } from '../services/AnalysisRuntime';
import { logger } from '../utils/logger';

export class AnalysisController {
    private runtime: AnalysisRuntime;
    private cursorCandidateTimer?: ReturnType<typeof setTimeout>;
    private cursorCandidateRequestSeq = 0;

    constructor(private readonly provider: AnalysisViewProvider, runtime?: AnalysisRuntime) {
        this.runtime = runtime || AnalysisRuntime.getInstance();
        this.provider.setMessageHandler(this.handleWebviewMessage.bind(this));
    }

    private async handleWebviewMessage(data: any): Promise<void> {
        switch (data.command) {
            case 'queryGlobalRelation': {
                logger.info(`[AnalysisController] queryGlobalRelation relations=${data.relations}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryGlobalRelation(data.relations, data.includeExternal);
                this.postRenderGraphData(data, result);
                break;
            }

            case 'queryNodeDependencies': {
                logger.info(`[AnalysisController] queryNodeDependencies nodeId=${data.nodeId}, relations=${data.allowedRelations}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryNodeDependencies(data.nodeId, data.allowedRelations, data.includeExternal);
                this.postRenderGraphData(data, result);
                break;
            }

            case 'queryFunctionCallGraph': {
                logger.info(`[AnalysisController] queryFunctionCallGraph nodeId=${data.nodeId}, direction=${data.direction}, depth=${data.depth}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryFunctionCallGraph(
                    data.nodeId,
                    data.direction,
                    data.depth,
                    data.includeExternal,
                    data.maxNodes,
                    data.maxEdges
                );
                this.postRenderGraphData(data, result);
                break;
            }

            case 'queryFunctionCallPath': {
                logger.info(`[AnalysisController] queryFunctionCallPath sourceId=${data.sourceId}, targetId=${data.targetId}, direction=${data.direction}, maxDepth=${data.maxDepth}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryFunctionCallPath(
                    data.sourceId,
                    data.targetId,
                    data.direction,
                    data.maxDepth,
                    data.includeExternal
                );
                this.postRenderGraphData(data, result);
                break;
            }

            case 'queryFunctionCallWaypointPath': {
                logger.info(`[AnalysisController] queryFunctionCallWaypointPath nodeIds=${JSON.stringify(data.nodeIds)}, direction=${data.direction}, maxDepthPerSegment=${data.maxDepthPerSegment}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryFunctionCallWaypointPath(
                    Array.isArray(data.nodeIds) ? data.nodeIds : [],
                    data.direction,
                    data.maxDepthPerSegment,
                    data.includeExternal
                );
                this.postRenderGraphData(data, result);
                break;
            }

            default:
                logger.info(`[AnalysisController] unknown webview command: ${data.command}`);
                break;
        }
    }

    private postRenderGraphData(request: any, result: unknown): void {
        this.provider.postMessage({
            command: 'renderGraphData',
            data: result,
            __queryId: request.__queryId,
            __queryMode: request.__queryMode,
            __querySignature: request.__querySignature
        });
    }

    public async handleAnalyzeActiveFileCommand(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor to analyze.');
            return;
        }

        try {
            await this.runtime.analyzeFile(editor.document.uri);
            vscode.window.showInformationMessage('Analyzed active file.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to analyze active file: ${error}`);
        }
    }

    public async handleAddActiveFunctionToCallPathCommand(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }

        try {
            const functionRef = await this.runtime.resolveFunctionAtEditorPosition(editor.document.uri, editor.selection.active);
            if (!functionRef) {
                vscode.window.showWarningMessage('No function or method found at the current cursor position.');
                return;
            }

            await vscode.commands.executeCommand('workbench.view.extension.forwarder-sidebar');
            this.provider.postMessage({
                command: 'addFunctionToCallPath',
                functionRef
            });
            vscode.window.showInformationMessage(`Added to call path: ${functionRef.label}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add function to call path: ${error}`);
        }
    }

    public handleEditorSelectionChanged(editor: vscode.TextEditor | undefined): void {
        if (this.cursorCandidateTimer) {
            clearTimeout(this.cursorCandidateTimer);
        }

        const requestSeq = ++this.cursorCandidateRequestSeq;
        this.cursorCandidateTimer = setTimeout(() => {
            this.postCursorFunctionCandidate(editor, requestSeq).catch(error => {
                logger.info(`[AnalysisController] cursor function candidate failed: ${error}`);
            });
        }, 180);
    }

    private async postCursorFunctionCandidate(editor: vscode.TextEditor | undefined, requestSeq: number): Promise<void> {
        if (requestSeq !== this.cursorCandidateRequestSeq) {
            return;
        }

        if (!editor) {
            this.provider.postMessage({
                command: 'cursorFunctionCandidateChanged',
                functionRef: undefined
            });
            return;
        }

        const functionRef = await this.runtime.resolveFunctionAtEditorPosition(editor.document.uri, editor.selection.active);
        if (requestSeq !== this.cursorCandidateRequestSeq) {
            return;
        }

        this.provider.postMessage({
            command: 'cursorFunctionCandidateChanged',
            functionRef
        });
    }
}
