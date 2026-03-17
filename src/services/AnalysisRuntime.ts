import * as vscode from 'vscode';
import { ProjectGraph } from '../models/GraphManager';
import { AdapterService } from './AdapterServices';
import { ViewQueryService } from './ViewServices';
import { SynchronizationService } from './SynchronizationServices';
import { EdgeRelation, GraphViewData } from '../models/GraphDefinition';
import { logger } from '../utils/logger';

export interface AnalysisTask {
    uri: vscode.Uri;
    reason: string;
    cascade: boolean;
}

export class AnalysisRuntime {
    private static instance: AnalysisRuntime;

    // 维护整个项目的内存图结构缓存
    public readonly projectGraph: ProjectGraph;

    // 增加数据同步持久化服务
    private syncService?: SynchronizationService;
    // 监听器注册销毁句柄
    private configChangeListener?: vscode.Disposable;
    private renameListener?: vscode.Disposable;
    private deleteListener?: vscode.Disposable;
    private saveListener?: vscode.Disposable;

    // 分析调度队列
    private taskQueue: AnalysisTask[] = [];
    private isProcessing: boolean = false;
    private pendingDeletions: Map<string, NodeJS.Timeout> = new Map();

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
                    this.enqueueTask(file.newUri, '重命名修正重查', true);
                }
            }
        });

        // 注册删除事件监听器
        if (this.deleteListener) {
            this.deleteListener.dispose();
        }
        this.deleteListener = vscode.workspace.onDidDeleteFiles(e => {
            for (const file of e.files) {
                this.scheduleDeletion(file);
            }
        });

        // 注册保存事件监听器
        if (this.saveListener) {
            this.saveListener.dispose();
        }
        this.saveListener = vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.uri.scheme === 'file') {
                logger.info(`[AnalysisRuntime] 文件保存触发重扫: ${doc.uri.fsPath}`);
                this.enqueueTask(doc.uri, '文件保存后触发重新同步解析', true);
            }
        });
    }

    private scheduleDeletion(uri: vscode.Uri): void {
        const uriStr = uri.toString();
        // 清理此前排队的相同删除任务（如果有）
        if (this.pendingDeletions.has(uriStr)) {
            clearTimeout(this.pendingDeletions.get(uriStr));
        }

        logger.info(`[AnalysisRuntime] 调度文件删除防抖延迟 (5秒): ${uri.fsPath}`);
        // 5秒防抖延迟
        const timer = setTimeout(() => {
            this.pendingDeletions.delete(uriStr);
            this.executeDeletion(uri);
        }, 5000);

        this.pendingDeletions.set(uriStr, timer);
    }

    private executeDeletion(uri: vscode.Uri): void {
        logger.info(`[AnalysisRuntime] 执行文件图结构删除与级联清理: ${uri.fsPath}`);

        // 1. 将删除事实同步给图管理器，得到被影响的文件
        const affectedUris = this.projectGraph.deleteFileSymbols(uri.toString());

        // 2. 从本地缓存索引中移除该文件
        if (this.syncService) {
            this.syncService.removeFileFromIndex(uri);
        }

        // 3. 处理受影响文件的级联调度
        if (affectedUris.length > 0) {
            for (const affectedUriStr of affectedUris) {
                const affectedUri = vscode.Uri.parse(affectedUriStr);
                this.enqueueTask(affectedUri, `引用的源文件 ${uri.fsPath} 被删除引起的级联更新`, false);
            }
        }

        // 如果当前队列是空的(不需要查其他人)，也顺手存个快照。是偶发的删除事件触发，仅在编辑器内删除时触发
        //TODO:这里是同步的，是否会出问题？
        if (this.taskQueue.length === 0 && this.syncService) {
            this.syncService.saveSnapshot(this.projectGraph, this.getSerializableTasks());
        }
    }

    /**
     * 获取支持JSON序列化的任务队列结构
     */
    private getSerializableTasks(): { uri: string, reason: string, cascade: boolean }[] {
        return this.taskQueue.map(t => ({
            uri: t.uri.toString(),
            reason: t.reason,
            cascade: t.cascade
        }));
    }

    /**
     * 自动增量加载核心：从本地快照恢复数据，并对增减的文件进行追办
     */
    public async runIncrementalSync(): Promise<void> {
        if (!this.syncService) {
            throw new Error('[AnalysisRuntime] 尚未初始化 storagePath，无法运行增量扫描。');
        }

        logger.info('[AnalysisRuntime] 开始启动增量同步...');

        // 1. 加载本地持久化快照与积压队列
        const savedQueue = await this.syncService.loadSnapshot(this.projectGraph);

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

        // 3. 处理按需更新文件 (入队)
        for (const uri of changes.addedOrModified) {
            this.enqueueTask(uri, '增量扫描发现文件修改/新增', true);
        }

        // 4. 处理被删除的文件 （直接执行，脱机删除不需要防抖）
        for (const uri of changes.deleted) {
            logger.info(`[AnalysisRuntime] 增量发现文件已删除: ${uri.fsPath}`);
            this.executeDeletion(uri);
        }

        // 5. 恢复由于关机等原因中断的任务队列 (必须在执行完增减判定后恢复，以防试图恢复已删除的文件)
        const deletedUriStrs = new Set(changes.deleted.map(u => u.toString()));
        for (const task of savedQueue) {
            // 确保任务对应的文件既没有在此次离线期间被删除，并且也能被 VS Code 文件系统读取到
            if (!deletedUriStrs.has(task.uri)) {
                try {
                    const targetUri = vscode.Uri.parse(task.uri);
                    await vscode.workspace.fs.stat(targetUri);
                    this.enqueueTask(targetUri, task.reason + ' (从上一次历史会话恢复)', task.cascade);
                } catch (err) {
                    logger.info(`[AnalysisRuntime] 无法恢复任务对应的文件 ${task.uri}，可能已被删除或无法访问，已跳过恢复。`);
                    //TODO：是否有必要处理该异常？
                }
            }
        }

        // 若队列中没有任务，直接保存快照；否则通过队列后续保存
        if (this.taskQueue.length === 0) {
            await this.syncService.saveSnapshot(this.projectGraph, this.getSerializableTasks());
            logger.info('[AnalysisRuntime] 增量同步完成！无新增更新项。');
        }
    }

    /**
     * 将文件分析任务推入调度队列
     */
    public enqueueTask(uri: vscode.Uri, reason: string, cascade: boolean = true): void {
        const uriStr = uri.toString();

        // 当文件被加入分析队列（创建/更新）时，取消它可能正在倒计时的假删除/撤回删除
        if (this.pendingDeletions.has(uriStr)) {
            clearTimeout(this.pendingDeletions.get(uriStr));
            this.pendingDeletions.delete(uriStr);
            logger.info(`[AnalysisRuntime] 文件 ${uri.fsPath} 在删除防抖期内发生了更新或撤回，已取消图结构的删除操作`);
            //TODO: 无修改入队会发生什么？
        }

        const existingIndex = this.taskQueue.findIndex(t => t.uri.toString() === uriStr);

        if (existingIndex >= 0) {
            // 如果已在队列中，提权其级联属性。发生于波及文件被修改时
            if (cascade && !this.taskQueue[existingIndex].cascade) {
                this.taskQueue[existingIndex].cascade = true;
                this.taskQueue[existingIndex].reason = reason;
            }
        } else {
            this.taskQueue.push({ uri, reason, cascade });
        }

        // 尝试启动异步消费
        this._processTaskQueue().catch(err => {
            logger.info(`[AnalysisRuntime] 队列处理异常: ${err.message}`);
        });
    }

    /**
     * 消费队列的任务循环
     */
    private async _processTaskQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;

        try {
            while (this.taskQueue.length > 0) {
                const task = this.taskQueue.shift()!;
                logger.info(`[AnalysisRuntime] 分析队列执行文件: ${task.uri.fsPath} (原因: ${task.reason})`);

                try {
                    const affectedUris = await this.doAnalyzeFile(task.uri);

                    // 5. 如果开启了级联发现相关被波及文件，需要入队重新扫描它，但它的结果不再级联
                    if (task.cascade && affectedUris && affectedUris.length > 0) {
                        for (const affectedUriStr of affectedUris) {
                            const affectedUri = vscode.Uri.parse(affectedUriStr);
                            this.enqueueTask(affectedUri, `依赖的源文件 ${task.uri.fsPath} 结构变更的级联更新`, false);
                        }
                    }
                } catch (err: any) {
                    logger.info(`[AnalysisRuntime] 忽略解析失败的文件 ${task.uri.fsPath}: ${err.message}`);
                }
            }

            // 队列全部消费完毕后，固化保存最新的全图一次
            if (this.syncService) {
                await this.syncService.saveSnapshot(this.projectGraph);
                logger.info('[AnalysisRuntime] 调度队列全部处理完成，数据流更新并固化本地完毕！');
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * 兼容旧版外部直接调用接口（直接推入主重查队列）
     */
    public async analyzeFile(uri: vscode.Uri): Promise<void> {
        this.enqueueTask(uri, '外部显式调用主解析', true);
    }

    /**
     * 真正的内部控制流: 分析并将单个文件及其内部关系存入图数据结构
     * @param uri 目标文件的 Uri
     */
    private async doAnalyzeFile(uri: vscode.Uri): Promise<string[]> {
        logger.info(`[AnalysisRuntime] 正在进行文件实质性解析: ${uri.fsPath}`);

        // 从缓存中获取之前的结构指纹
        const oldFingerprint = this.projectGraph.fileFingerprints.get(uri.toString());

        // 1. 调用适配器服务，从LSP提取并组装指定文件的 IRNode 与内部关系边界
        const payload = await AdapterService.extractFileSymbols(uri, oldFingerprint);

        if (!payload || payload.nodes.length === 0) {
            logger.info(`[AnalysisRuntime] 未能从 ${uri.fsPath} 提取到结构信息或文件为空。`);
            return [];
        }

        // 提前阻断: 结构语义未发生本质改变
        if (payload.unchanged) {
            logger.info(`[AnalysisRuntime] 文件结构指纹未变，已跳过关系重计算并通过增量 Diff 刷新物理游标: ${uri.fsPath}`);
            this.projectGraph.updateFileSymbols(payload);
            return [];
        }

        // 2. 数据下沉，返回可能受影响的依赖此文件的其他文档的 URI
        const affectedUris = this.projectGraph.updateFileSymbols(payload);

        logger.info(`[AnalysisRuntime] 更新图缓存成功，新增/更新节点 ${payload.nodes.length} 个，关系边 ${payload.edges.length} 条，影响旁支文件 ${affectedUris.length} 个。`);
        return affectedUris;
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
        if (this.deleteListener) {
            this.deleteListener.dispose();
        }
        for (const timer of this.pendingDeletions.values()) {
            clearTimeout(timer);
        }
        this.pendingDeletions.clear();
    }
}