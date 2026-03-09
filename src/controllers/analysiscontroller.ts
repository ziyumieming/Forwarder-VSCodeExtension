import * as vscode from 'vscode';
import { ProjectGraph } from '../models/GraphManager';
import { AdapterService } from '../services/AdapterServices';
import { ViewQueryService } from '../services/ViewServices';
import { AnalysisViewProvider } from '../providers/AnalysisView';
import { logger } from '../utils/logger';

export class AnalysisController {
    // 维护整个项目的内存图结构缓存
    public projectGraph: ProjectGraph;

    constructor(private readonly provider: AnalysisViewProvider) {
        this.projectGraph = new ProjectGraph();

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
                // 前端请求如：{ command: 'queryGlobalRelation', relation: 'extends' }
                logger.info(`[AnalysisController] 响应全局关系查询: ${data.relation}`);
                const result = ViewQueryService.queryGlobalRelation(this.projectGraph, data.relation);

                // 将查询到的 {nodes, edges} 异步推回前端绘制
                this.provider.postMessage({
                    command: 'renderGraphData',
                    data: result
                });
                break;
            }

            case 'queryNodeDependencies': {
                // 前端请求如：{ command: 'queryNodeDependencies', nodeId: 'Uri#class##MyClass', allowedRelations: ['extends', 'implements'] }
                logger.info(`[AnalysisController] 响应节点局部依赖查询: ${data.nodeId}`);
                const result = ViewQueryService.queryNodeDependencies(this.projectGraph, data.nodeId, data.allowedRelations);

                this.provider.postMessage({
                    command: 'renderGraphData',
                    data: result
                });
                break;
            }

            default:
                logger.info(`[AnalysisController] 未知的前端指令: ${data.command}`);
                break;
        }
    }

    /**
     * 控制流: 分析并将单个文件及其内部关系存入图数据结构
     * @param uri 目标文件的 Uri
     */
    public async analyzeFile(uri: vscode.Uri): Promise<void> {
        logger.info(`[AnalysisController] 开始分析文件: ${uri.toString()}`);

        try {
            // 1. 调用图服务，从LSP提取并组装指定文件的 IRNode 与内部关系边界
            const payload = await AdapterService.extractFileSymbols(uri);

            if (!payload || payload.nodes.length === 0) {
                logger.info(`[AnalysisController] 未能从 ${uri.fsPath} 提取到结构信息或文件为空。`);
                return;
            }

            // 2. 数据下沉，将得到的当前文件的节点与内部边指令交给图控制模块更新数据结构
            this.projectGraph.updateFileSymbols(payload);

            logger.info(`[AnalysisController] 成功更新文件至图缓存，新增节点 ${payload.nodes.length} 个，关系边 ${payload.edges.length} 条。`);
        } catch (error) {
            logger.info(`[AnalysisController] 分析文件 ${uri.fsPath} 时发生错误: ${error}`);
            vscode.window.showErrorMessage(`分析文件出错: ${uri.fsPath}`);
        }
    }

    /**
     * TODO: 入口：对用户当前打开/激活的文件执行图分析收集
     */
    public async handleAnalyzeActiveFileCommand(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await this.analyzeFile(editor.document.uri);
            vscode.window.showInformationMessage("当前文件代码结构分析完成，已存入缓存图中。");
        } else {
            vscode.window.showWarningMessage("未检测到活跃的编辑器文件。");
        }
    }
}
