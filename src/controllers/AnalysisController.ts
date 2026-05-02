import * as vscode from 'vscode';
import { AnalysisViewProvider } from '../providers/AnalysisView';
import { AnalysisRuntime } from '../services/AnalysisRuntime';
import { SummaryCacheMissError } from '../services/SummaryArrangeServices';
import { logger } from '../utils/logger';

export class AnalysisController {
    private runtime: AnalysisRuntime;
    private cursorCandidateTimer?: ReturnType<typeof setTimeout>;
    private cursorCandidateRequestSeq = 0;
    private indexStatusSubscription: vscode.Disposable;
    private configSubscription: vscode.Disposable;

    constructor(private readonly provider: AnalysisViewProvider, runtime?: AnalysisRuntime) {
        this.runtime = runtime || AnalysisRuntime.getInstance();
        this.provider.setMessageHandler(this.handleWebviewMessage.bind(this));
        this.indexStatusSubscription = this.runtime.onIndexStatusChanged(status => {
            this.provider.postMessage({
                command: 'analysisIndexStatusChanged',
                status
            });

            if (status.snapshotReady && !status.isUpdating && status.suggestRequery) {
                this.handleEditorSelectionChanged(vscode.window.activeTextEditor);
            }
        });
        this.configSubscription = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('forwarder.llm.longPressMs') ||
                event.affectsConfiguration('forwarder.llm.summaryHoverDelayMs')) {
                this.postSummaryUiConfig();
            }
        });
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

            case 'revealSourceLocation': {
                logger.info(`[AnalysisController] revealSourceLocation target=${JSON.stringify(data.target)}`);
                try {
                    const revealed = await this.runtime.revealSourceLocation(data.target);
                    if (!revealed) {
                        vscode.window.showWarningMessage('Unable to locate the requested source item.');
                    }
                } catch (error) {
                    logger.info(`[AnalysisController] revealSourceLocation failed: ${error}`);
                    vscode.window.showWarningMessage('Unable to locate the requested source item.');
                }
                break;
            }

            case 'listLLMModels': {
                const result = await this.runtime.listLLMModels();
                this.provider.postMessage({
                    command: 'llmModelsChanged',
                    ...result
                });
                break;
            }

            case 'setLLMModel': {
                const result = await this.runtime.setLLMModel(String(data.modelName || ''));
                this.provider.postMessage({
                    command: 'llmModelsChanged',
                    ...result
                });
                break;
            }

            case 'queryFunctionSummary': {
                const allowGenerate = data.allowGenerate !== false;
                const reason = String(data.reason || 'unknown');
                logger.info(`[SummaryBackend] backend-cache-query controller nodeId=${data.nodeId}, forceRefresh=${data.forceRefresh === true}, allowGenerate=${allowGenerate}, reason=${reason}`);
                try {
                    const summary = await this.runtime.queryFunctionSummary(
                        String(data.nodeId || ''),
                        data.forceRefresh === true,
                        allowGenerate,
                        reason
                    );
                    logger.info(`[SummaryBackend] backend-cache-hit controller-result nodeId=${summary.nodeId}, status=${summary.cacheStatus}, stale=${summary.stale === true}, reason=${reason}, summaryType=${typeof summary.summary}, summaryLength=${String(summary.summary || '').length}`);
                    this.provider.postMessage({
                        command: 'functionSummaryData',
                        reason,
                        ...summary
                    });
                } catch (error: any) {
                    if (error instanceof SummaryCacheMissError) {
                        logger.info(`[SummaryBackend] backend-cache-miss controller-result nodeId=${data.nodeId}, reason=${reason}, allowGenerate=${allowGenerate}`);
                        this.provider.postMessage({
                            command: 'functionSummaryMiss',
                            nodeId: data.nodeId,
                            reason,
                            allowGenerate,
                            forceRefresh: data.forceRefresh === true
                        });
                        break;
                    }
                    logger.info(`[SummaryBackend] backend-cache-query failed nodeId=${data.nodeId}, reason=${reason}: ${error?.message || error}`);
                    this.provider.postMessage({
                        command: 'functionSummaryError',
                        nodeId: data.nodeId,
                        reason,
                        message: error?.message || String(error)
                    });
                }
                break;
            }

            case 'getFunctionSummaryHistory': {
                try {
                    logger.info(`[AnalysisController] getFunctionSummaryHistory nodeId=${data.nodeId}, modelName=${data.modelName || '*'}`);
                    const history = await this.runtime.getFunctionSummaryHistory(
                        String(data.nodeId || ''),
                        data.modelName ? String(data.modelName) : undefined
                    );
                    this.provider.postMessage({
                        command: 'functionSummaryHistory',
                        ...history
                    });
                } catch (error: any) {
                    this.provider.postMessage({
                        command: 'functionSummaryError',
                        nodeId: data.nodeId,
                        message: error?.message || String(error)
                    });
                }
                break;
            }

            case 'requestSummaryUiConfig': {
                this.postSummaryUiConfig();
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

    private postSummaryUiConfig(): void {
        const configuration = vscode.workspace.getConfiguration('forwarder.llm');
        this.provider.postMessage({
            command: 'summaryUiConfigChanged',
            hoverDelayMs: this.normalizeMs(configuration.get('summaryHoverDelayMs', 1000), 1000, 0, 5000),
            longPressMs: this.normalizeMs(configuration.get('longPressMs', 650), 650, 250, 2000)
        });
    }

    private normalizeMs(value: unknown, fallback: number, min: number, max: number): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, Math.round(numeric)));
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

    public async handleSetActiveFunctionAsCallCenterCommand(): Promise<void> {
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
                command: 'setCallGraphCenter',
                functionRef
            });
            vscode.window.showInformationMessage(`Set call graph center: ${functionRef.label}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to set call graph center: ${error}`);
        }
    }

    public async handleSummarizeActiveFunctionCommand(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }

        try {
            await vscode.commands.executeCommand('workbench.view.extension.forwarder-sidebar');
            const summaryData = await this.runtime.summarizeFunctionAtEditorPosition(editor.document.uri, editor.selection.active);
            if (!summaryData) {
                vscode.window.showWarningMessage('No indexed function or method found at the current cursor position.');
                this.provider.postMessage({
                    command: 'functionSummaryError',
                    message: 'No indexed function or method found at the current cursor position.'
                });
                return;
            }

            this.provider.postMessage({
                command: 'functionSummaryData',
                reason: 'debug-command',
                ...summaryData
            });
            vscode.window.showInformationMessage(`Summary ready: ${summaryData.label}`);
        } catch (error: any) {
            const message = error?.message || String(error);
            this.provider.postMessage({
                command: 'functionSummaryError',
                message
            });
            vscode.window.showErrorMessage(`Failed to summarize active function: ${message}`);
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
            this.provider.postMessage({
                command: 'cursorGraphNodeCandidateChanged',
                graphNodeRef: undefined
            });
            return;
        }

        const [functionRef, graphNodeRefs] = await Promise.all([
            this.runtime.resolveFunctionAtEditorPosition(editor.document.uri, editor.selection.active),
            this.runtime.resolveGraphNodesAtEditorPosition(editor.document.uri, editor.selection.active)
        ]);
        if (requestSeq !== this.cursorCandidateRequestSeq) {
            return;
        }

        this.provider.postMessage({
            command: 'cursorFunctionCandidateChanged',
            functionRef
        });
        this.provider.postMessage({
            command: 'cursorGraphNodeCandidateChanged',
            graphNodeRef: graphNodeRefs[0],
            graphNodeRefs
        });
    }

    public dispose(): void {
        this.indexStatusSubscription.dispose();
        this.configSubscription.dispose();
        if (this.cursorCandidateTimer) {
            clearTimeout(this.cursorCandidateTimer);
        }
    }
}
