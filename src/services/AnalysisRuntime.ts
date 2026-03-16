import * as vscode from 'vscode';
import { ProjectGraph } from '../models/GraphManager';
import { AdapterService } from './AdapterServices';
import { ViewQueryService } from './ViewServices';
import { SynchronizationService } from './SynchronizationServices';
import { EdgeRelation, GraphViewData } from '../models/GraphDefinition';
import { logger } from '../utils/logger';

export class AnalysisRuntime {
    private static instance: AnalysisRuntime;

    // 维护整个项目的内存图结构缓存
    public readonly projectGraph: ProjectGraph;

    // 增加数据同步持久化服务
    private syncService?: SynchronizationService;
    // 监听器注册销毁句柄
    private configChangeListener?: vscode.Disposable;
    private renameListener?: vscode.Disposable;

    private constructor() {
        this.projectGraph = new ProjectGraph();
    }

    public static getInstance(): AnalysisRuntime {
        if (!AnalysisRuntime.instance) {
            AnalysisRuntime.instance = new AnalysisRuntime();
        }
        return AnalysisRuntime.instance;
    }

    /**
     * 运行时初始化：传入持久化路径（如 context.globalStorageUri 或者 workspaceStorageUri）
     */
    public initialize(storagePath: string) {
        this.syncService = new SynchronizationService(storagePath);

        // 注册设置修改监听器
        if (this.configChangeListener) {
            this.configChangeListener.dispose();
        }
        this.configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('forwarder.analysis.includePattern') ||
                e.affectsConfiguration('forwarder.analysis.excludePattern')) {
                logger.info('[AnalysisRuntime] 检测到扫描过滤规则修改，正在重置索引并重新发起全量扫描...');
                this.syncService?.clearIndex();
                this.runIncrementalSync().catch(err => {
                    logger.info(`[AnalysisRuntime] 重新扫描失败: ${err}`);
                });
            }
        });

        // 注册重命名事件监听器
        if (this.renameListener) {
            this.renameListener.dispose();
        }
        this.renameListener = vscode.workspace.onDidRenameFiles(async e => {
            for (const file of e.files) {
                logger.info(`[AnalysisRuntime] 检测到文件重命名: ${file.oldUri.fsPath} -> ${file.newUri.fsPath}`);
                this.projectGraph.renameFile(file.oldUri.toString(), file.newUri.toString());
                if (this.syncService) {
                    this.syncService.removeFileFromIndex(file.oldUri);
                    // 重新解析被重命名的文件，更新索引及节点信息
                    await this.analyzeFile(file.newUri);
                    this.syncService.saveSnapshot(this.projectGraph);
                }
            }
        });
    }

    /**
     * 自动增量加载核心：从本地快照恢复数据，并对增减的文件进行追办
     */
    public async runIncrementalSync(): Promise<void> {
        if (!this.syncService) {
            throw new Error('[AnalysisRuntime] 尚未初始化 storagePath，无法运行增量扫描。');
        }

        logger.info('[AnalysisRuntime] 开始启动增量同步...');

        // 1. 加载本地持久化快照
        await this.syncService.loadSnapshot(this.projectGraph);

        // 2. 将快照中的索引与当前工作区真实文件对比
        const changes = await this.syncService.scanWorkspaceChanges();
        logger.info(`[AnalysisRuntime] 扫描完毕。发现重命名文件: ${changes.renamed?.length || 0}个, 需分析文件: ${changes.addedOrModified.length}个, 被删除文件: ${changes.deleted.length}个.`);

        if (changes.renamed && changes.renamed.length > 0) {
            for (const rename of changes.renamed) {
                logger.info(`[AnalysisRuntime] 处理文件重命名 (增量同步): ${rename.oldUri.fsPath} -> ${rename.newUri.fsPath}`);
                this.projectGraph.renameFile(rename.oldUri.toString(), rename.newUri.toString());
                this.syncService.removeFileFromIndex(rename.oldUri);
            }
        }

        // 3. 处理新增或被修改的文件
        for (const uri of changes.addedOrModified) {
            try {
                await this.analyzeFile(uri);
            } catch (err: any) {
                logger.info(`[AnalysisRuntime] 忽略增量解析失败的文件 ${uri.fsPath}: ${err.message}`);
                // TODO: 如果解析失败，您可以选择清除索引以期下次补录
            }
        }

        // 4. 处理被删除的文件 
        // TODO: 目前暂不从图中清理对应节点
        for (const uri of changes.deleted) {
            logger.info(`[AnalysisRuntime] 文件已删除 (图中历史边与节点保留待后续功能清理): ${uri.fsPath}`);
            this.syncService.removeFileFromIndex(uri);
        }

        // 5. 将这批最新图数据转存
        await this.syncService.saveSnapshot(this.projectGraph);
        logger.info('[AnalysisRuntime] 增量同步完成！图缓存已最新并固化至本地。');
    }

    /**
     * 控制流: 分析并将单个文件及其内部关系存入图数据结构
     * @param uri 目标文件的 Uri
     */
    public async analyzeFile(uri: vscode.Uri): Promise<void> {
        logger.info(`[AnalysisRuntime] 开始分析文件: ${uri.fsPath}`);

        try {
            // 1. 调用适配器服务，从LSP提取并组装指定文件的 IRNode 与内部关系边界
            const payload = await AdapterService.extractFileSymbols(uri);

            if (!payload || payload.nodes.length === 0) {
                logger.info(`[AnalysisRuntime] 未能从 ${uri.fsPath} 提取到结构信息或文件为空。`);
                return;
            }

            // 2. 数据下沉，将得到的当前文件的节点与内部边指令交给图控制模块更新数据结构
            this.projectGraph.updateFileSymbols(payload);

            logger.info(`[AnalysisRuntime] 成功更新文件至图缓存，新增节点 ${payload.nodes.length} 个，关系边 ${payload.edges.length} 条。`);
        } catch (error: any) {
            logger.info(`[AnalysisRuntime] 分析文件 ${uri.fsPath} 时发生错误: ${error.message}`);
            throw error; // 抛出异常给上层处理
        }
    }

    // 编排调用: 查询全局视图
    public queryGlobalRelation(relation: EdgeRelation): GraphViewData {
        return ViewQueryService.queryGlobalRelation(this.projectGraph, relation);
    }

    // 编排调用: 查询节点依赖
    public queryNodeDependencies(nodeId: string, allowedRelations?: EdgeRelation[]): GraphViewData {
        return ViewQueryService.queryNodeDependencies(this.projectGraph, nodeId, allowedRelations);
    }

    /**
     * 释放运行时注册的资源（如事件监听器）
     */
    public dispose(): void {
        if (this.configChangeListener) {
            this.configChangeListener.dispose();
        }
        if (this.renameListener) {
            this.renameListener.dispose();
        }
    }
}