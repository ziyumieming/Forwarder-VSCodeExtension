import * as vscode from 'vscode';
import { AnalysisRuntime } from '../services/AnalysisRuntime';
import { AnalysisViewProvider } from '../providers/AnalysisView';
import { logger } from '../utils/logger';

export class AnalysisController {
    // 我们在这个控制器里持有 Runtime 的引用
    private runtime: AnalysisRuntime;

    constructor(private readonly provider: AnalysisViewProvider, runtime?: AnalysisRuntime) {
        this.runtime = runtime || AnalysisRuntime.getInstance();

        // 注册来自Webview的消息回调处理
        this.provider.setMessageHandler(this.handleWebviewMessage.bind(this));
    }

    /**
     * 处理从前端 AnalysisView Webview 传来的交互指令
     */
    private async handleWebviewMessage(data: any) {
        //TODO: 这里的指令和数据格式需要和前端约定好，目前是示例占位
        switch (data.command) {
            case 'queryGlobalRelation': {
                // 前端请求如：{ command: 'queryGlobalRelation', relations: ['extends'], includeExternal: true, __queryId: '...', __queryMode: 'global', __querySignature: '...' }
                logger.info(`[AnalysisController] 响应全局关系查询: relations=${data.relations}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryGlobalRelation(data.relations, data.includeExternal);

                // 将查询到的 {nodes, edges} 异步推回前端绘制，并携带查询标识字段供前端去重
                this.provider.postMessage({
                    command: 'renderGraphData',
                    data: result,
                    __queryId: data.__queryId,
                    __queryMode: data.__queryMode,
                    __querySignature: data.__querySignature
                });
                break;
            }

            case 'queryNodeDependencies': {
                // 前端请求如：{ command: 'queryNodeDependencies', nodeId: 'Uri#class##MyClass', allowedRelations: ['extends', 'implements'], includeExternal: true, __queryId: '...', __queryMode: 'node', __querySignature: '...' }
                logger.info(`[AnalysisController] 响应节点局部依赖查询: ${data.nodeId}, relations=${data.allowedRelations}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryNodeDependencies(data.nodeId, data.allowedRelations, data.includeExternal);

                // 将查询到的 {nodes, edges} 异步推回前端绘制，并携带查询标识字段供前端去重
                this.provider.postMessage({
                    command: 'renderGraphData',
                    data: result,
                    __queryId: data.__queryId,
                    __queryMode: data.__queryMode,
                    __querySignature: data.__querySignature
                });
                break;
            }

            case 'queryFunctionCallGraph': {
                logger.info(`[AnalysisController] 响应函数调用图查询: nodeId=${data.nodeId}, direction=${data.direction}, depth=${data.depth}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryFunctionCallGraph(
                    data.nodeId,
                    data.direction,
                    data.depth,
                    data.includeExternal,
                    data.maxNodes,
                    data.maxEdges
                );

                this.provider.postMessage({
                    command: 'renderGraphData',
                    data: result,
                    __queryId: data.__queryId,
                    __queryMode: data.__queryMode,
                    __querySignature: data.__querySignature
                });
                break;
            }

            case 'queryFunctionCallPath': {
                logger.info(`[AnalysisController] 响应函数调用链查询: sourceId=${data.sourceId}, targetId=${data.targetId}, direction=${data.direction}, maxDepth=${data.maxDepth}, includeExternal=${data.includeExternal}, queryId=${data.__queryId}`);
                const result = await this.runtime.queryFunctionCallPath(
                    data.sourceId,
                    data.targetId,
                    data.direction,
                    data.maxDepth,
                    data.includeExternal
                );

                this.provider.postMessage({
                    command: 'renderGraphData',
                    data: result,
                    __queryId: data.__queryId,
                    __queryMode: data.__queryMode,
                    __querySignature: data.__querySignature
                });
                break;
            }

            default:
                logger.info(`[AnalysisController] 未知的前端指令: ${data.command}`);
                break;
        }
    }

    /**
     * TODO: 入口：对用户当前打开/激活的文件执行图分析收集
     */
    public async handleAnalyzeActiveFileCommand(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            try {
                await this.runtime.analyzeFile(editor.document.uri);
                vscode.window.showInformationMessage("当前文件代码结构分析完成，已存入缓存图中。");
            } catch (error) {
                vscode.window.showErrorMessage(`分析文件出错: ${editor.document.uri.fsPath}`);
            }
        } else {
            vscode.window.showWarningMessage("未检测到活跃的编辑器文件。");
        }
    }
}
