import * as vscode from 'vscode';
import { ProjectGraph } from '../models/GraphManager';
import { AdapterService } from './AdapterServices';
import { CallGraphDirection, ViewQueryService } from './ViewServices';
import { SynchronizationService } from './SynchronizationServices';
import { GatingService } from './GatingServices';
import { AnalysisIndexStatus, EdgeRelation, FunctionRef, FunctionSummaryData, GraphNodeRef, GraphViewData, NodeType, SourceLocationTarget } from '../models/GraphDefinition';
import { SourceLocationService } from './SourceLocationServices';
import { AnalysisIndexStatusService } from './AnalysisIndexStatusServices';
import { logger } from '../utils/logger';
import { SummaryService } from './SummaryServices';

export interface AnalysisTask {
    uri: vscode.Uri;
    reason: string;
    cascade: boolean;
    generation: number;
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
    private createListener?: vscode.Disposable;

    // 分析调度队列
    private taskQueue: AnalysisTask[] = [];
    private uncommittedTasks: Map<string, AnalysisTask> = new Map();
    private isProcessing: boolean = false;
    private activeTask?: AnalysisTask;
    private pendingDeletions: Map<string, NodeJS.Timeout> = new Map();
    private analysisGeneration: number = 0;
    private queueIdleResolvers: (() => void)[] = [];

    private readonly indexStatusService = new AnalysisIndexStatusService();

    private constructor() {
        this.projectGraph = new ProjectGraph();
    }

    public static getInstance(): AnalysisRuntime {
        if (!AnalysisRuntime.instance) {
            AnalysisRuntime.instance = new AnalysisRuntime();
        }
        return AnalysisRuntime.instance;
    }

    public onIndexStatusChanged(listener: (status: AnalysisIndexStatus) => void): vscode.Disposable {
        return this.indexStatusService.onStatusChanged(listener);
    }

    public getIndexStatus(overrides: Partial<AnalysisIndexStatus> = {}): AnalysisIndexStatus {
        return this.indexStatusService.getStatus(overrides);
    }

    private emitIndexStatus(overrides: Partial<AnalysisIndexStatus> = {}): void {
        this.indexStatusService.updateQueueState({
            isUpdating: this.isProcessing || this.taskQueue.length > 0 || !!this.activeTask,
            queueLength: this.taskQueue.length + (this.activeTask ? 1 : 0),
            activeTask: this.activeTask ? this.activeTask.uri.toString() : undefined,
            generation: this.analysisGeneration
        }, overrides);
    }

    private markSnapshotReady(): void {
        this.indexStatusService.markSnapshotReady();
    }

    private attachIndexStatus(result: GraphViewData): GraphViewData {
        return this.indexStatusService.attachToGraphView(result);
    }

    /**
     * 运行时初始化：传入持久化路径（如 context.globalStorageUri 或者 workspaceStorageUri）
     */
    public initialize(storageDir: string, isSingleFileMode: boolean = false, singleFileUri?: string) {
        this.syncService = new SynchronizationService(storageDir, isSingleFileMode, singleFileUri);

        // 注册设置修改监听器
        if (this.configChangeListener) {
            this.configChangeListener.dispose();
        }
        this.configChangeListener = vscode.workspace.onDidChangeConfiguration(async e => {
            if (e.affectsConfiguration('forwarder.analysis.includePattern') ||
                e.affectsConfiguration('forwarder.analysis.excludePattern')) {
                logger.info('[AnalysisRuntime] 检测到扫描过滤规则修改，正在重置索引并重新发起全量扫描...');
                if (this.syncService) {
                    await this.syncService.clearIndex();
                }
                this.analysisGeneration++;
                this.projectGraph.clearAll();
                this.resetSnapshotReadyPromise();
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
                    await this.syncService.renameFileInIndex(file.oldUri, file.newUri);
                    // 不再需要触发此文件的重新扫描，因为仅更名未改变内容
                }
            }

            // 为保证重命名状态尽快固化，在没有任务积压时执行一遍快照
            if (this.taskQueue.length === 0 && !this.isProcessing && this.syncService) {
                this.syncService.saveSnapshot(this.projectGraph);
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

        // 注册创建事件监听器 (用于抵消删除及处理新建)
        //在工作区打开时删除一个文件后马上在防抖期内向工作区加入一个不同内容的同名文件也会触发新建，只有新建事件能接收到这个变化，所以不得不入队
        if (this.createListener) {
            this.createListener.dispose();
        }
        this.createListener = vscode.workspace.onDidCreateFiles(async e => {
            for (const file of e.files) {
                this.enqueueTask(file, '监听发现文件新增', true);//在队列的开头会取消等待的删除
            }
        });

        // 注册保存事件监听器
        if (this.saveListener) {
            this.saveListener.dispose();
        }
        this.saveListener = vscode.workspace.onDidSaveTextDocument(async doc => {
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
            this.executeDeletion(uri).catch(err => {
                logger.info(`[AnalysisRuntime] 删除调度执行失败: ${err.message}`);
            });
        }, 5000);

        this.pendingDeletions.set(uriStr, timer);
    }

    private async executeDeletion(uri: vscode.Uri): Promise<void> {
        logger.info(`[AnalysisRuntime] 执行文件图结构删除与级联清理: ${uri.fsPath}`);

        // 1. 将删除事实同步给图管理器，得到被影响的文件
        const affectedUris = this.projectGraph.deleteFileSymbols(uri.toString());

        // 2. 从本地缓存索引中移除该文件
        if (this.syncService) {
            await this.syncService.removeFileFromIndex(uri);
        }

        // 3. 处理受影响文件的级联调度
        if (affectedUris.length > 0) {
            for (const affectedUriStr of affectedUris) {
                const affectedUri = vscode.Uri.parse(affectedUriStr);
                this.enqueueTask(affectedUri, `引用的源文件 ${uri.fsPath} 被删除引起的级联更新`, false);
            }
        }

        // 如果没有波及其他文件，队列为空，我们也必须在此当即固化一次快照，以确保图节点删除得到持久化
        if (this.taskQueue.length === 0 && !this.isProcessing && this.syncService) {
            await this.syncService.saveSnapshot(this.projectGraph);
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

        const syncGeneration = this.analysisGeneration;

        try {
            logger.info('[AnalysisRuntime] 开始启动增量同步...');

            // 0. 校验持久化架构版本和单文件作用域变化，判断是否需要重置存储
            const didWipe = await this.syncService.checkAndInitManifest();
            if (didWipe) {
                logger.info('[AnalysisRuntime] 侦测到缓存已被擦除，将进行全量冷启动。');
                // 清理本身的索引并让图为空
                this.projectGraph.clearAll();
            }

            // 1. 加载本地持久化快照与积压队列
            if (!didWipe) {
                await this.syncService.loadSnapshot(this.projectGraph);
                await this.syncService.loadFileIndex();
            }

            this.markSnapshotReady();

            // 2. 将快照中的索引与当前工作区真实文件对比
            const changes = await this.syncService.scanWorkspaceChanges();
            logger.info(`[AnalysisRuntime] 扫描完毕。发现重命名文件: ${changes.renamed?.length || 0}个, 需分析文件: ${changes.addedOrModified.length}个, 被删除文件: ${changes.deleted.length}个.`);

            if (changes.renamed && changes.renamed.length > 0) {
                for (const rename of changes.renamed) {
                    logger.info(`[AnalysisRuntime] 处理文件重命名 (增量同步): ${rename.oldUri.fsPath} -> ${rename.newUri.fsPath}`);
                    this.projectGraph.renameFile(rename.oldUri.toString(), rename.newUri.toString());
                    await this.syncService.removeFileFromIndex(rename.oldUri);
                }
            }

            // 3. 加载历史遗留挂起任务与未固化任务
            const pendingTasks = this.syncService.loadPendingTasksSync();
            if (pendingTasks.length > 0) {
                logger.info(`[AnalysisRuntime] 发现上次退出时未处理完及未固化的任务，共 ${pendingTasks.length} 个，正在恢复...`);
                for (const pt of pendingTasks) {
                    let targetUriStr = pt.uriStr;
                    // 检查是否在离线期间被并且成功识别为了重命名
                    if (changes.renamed) {
                        const renameRecord = changes.renamed.find(r => r.oldUri.toString() === pt.uriStr);
                        if (renameRecord) {
                            targetUriStr = renameRecord.newUri.toString();
                            logger.info(`[AnalysisRuntime] 追回已重命名的挂起任务: ${pt.uriStr} -> ${targetUriStr}`);
                        }
                    }

                    try {
                        const uri = vscode.Uri.parse(targetUriStr);
                        // 仅当文件存在于磁盘时，才进行重检查恢复
                        await vscode.workspace.fs.stat(uri);
                        this.enqueueTask(uri, `[自动恢复未固化任务] ${pt.reason}`, pt.cascade);
                    } catch (err: any) {
                        logger.info(`[AnalysisRuntime] 挂起任务文件已丢失或不可读，跳过恢复: ${targetUriStr}`);
                    }
                }
            }

            // 4. 处理按需更新文件 (入队)
            for (const uri of changes.addedOrModified) {
                this.enqueueTask(uri, '增量扫描发现文件修改/新增', true);
            }

            // 5. 处理被删除的文件 （直接执行，脱机删除不需要防抖）
            for (const uri of changes.deleted) {
                logger.info(`[AnalysisRuntime] 增量发现文件已删除: ${uri.fsPath}`);
                await this.executeDeletion(uri);
            }

            // 若队列中没有任务，直接保存快照；否则通过队列后续保存
            if (this.taskQueue.length === 0 && !this.isProcessing) {
                await this.syncService.saveSnapshot(this.projectGraph);
                logger.info('[AnalysisRuntime] 增量同步完成！无新增更新项。');
            }
        } finally {
            this.markSnapshotReady();
            await this.waitForQueueIdle(syncGeneration);
            this.emitIndexStatus({ suggestRequery: true });
            logger.info('[AnalysisRuntime] 初始启动数据载入和分析队列处理完成。');
        }
    }

    /**
     * 将文件分析任务推入调度队列
     */
    public enqueueTask(uri: vscode.Uri, reason: string, cascade: boolean = true, generation: number = this.analysisGeneration): void {
        const uriStr = uri.toString();

        // 当文件被加入分析队列（创建/更新）时，取消它可能正在倒计时的假删除/撤回删除
        if (this.pendingDeletions.has(uriStr)) {
            clearTimeout(this.pendingDeletions.get(uriStr));
            this.pendingDeletions.delete(uriStr);
            logger.info(`[AnalysisRuntime] 文件 ${uri.fsPath} 在删除防抖期内发生了更新或撤回，已取消图结构的删除操作`);
            //TODO: 无修改入队会发生什么？是否只有创建会触发这个分支？
        }

        const existingIndex = this.taskQueue.findIndex(t => t.uri.toString() === uriStr);

        if (existingIndex >= 0) {
            // 如果已在队列中，提权其级联属性。发生于波及文件被修改时
            if (cascade && !this.taskQueue[existingIndex].cascade) {
                this.taskQueue[existingIndex].cascade = true;
                this.taskQueue[existingIndex].reason = reason;
            }
        } else {
            this.taskQueue.push({ uri, reason, cascade, generation });
        }

        this.emitIndexStatus();

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
        this.emitIndexStatus();

        try {
            while (this.taskQueue.length > 0) {
                this.activeTask = this.taskQueue.shift()!;
                this.emitIndexStatus();
                const task = this.activeTask;
                if (task.generation !== this.analysisGeneration) {
                    logger.info(`[AnalysisRuntime] 跳过旧世代分析任务: ${task.uri.fsPath}`);
                    this.activeTask = undefined;
                    continue;
                }
                // 记录到未提交集合，供突发退出时追回
                this.uncommittedTasks.set(task.uri.toString(), task);
                logger.info(`[AnalysisRuntime] 分析队列执行文件: ${task.uri.fsPath} (原因: ${task.reason})`);

                try {
                    const isReady = await GatingService.waitAndCheckLSPForFile(task.uri);
                    if (!isReady) {
                        logger.info(`[AnalysisRuntime] 无法挂载语言服务或文件被阻止，跳过此文件: ${task.uri.fsPath}`);
                        this.activeTask = undefined;
                        continue;
                    }

                    const affectedUris = await this.doAnalyzeFile(task.uri, task.generation);
                    if (!affectedUris) {
                        this.uncommittedTasks.delete(task.uri.toString());
                        this.activeTask = undefined;
                        continue;
                    }

                    if (this.syncService) {
                        await this.syncService.commitFileToIndex(task.uri);
                    }

                    // 5. 如果开启了级联发现相关被波及文件，需要入队重新扫描它，但它的结果不再级联
                    if (task.cascade && affectedUris && affectedUris.length > 0) {
                        for (const affectedUriStr of affectedUris) {
                            const affectedUri = vscode.Uri.parse(affectedUriStr);
                            this.enqueueTask(affectedUri, `依赖的源文件 ${task.uri.fsPath} 结构变更的级联更新`, false, task.generation);
                        }
                    }
                } catch (err: any) {
                    logger.info(`[AnalysisRuntime] 忽略解析失败的文件 ${task.uri.fsPath}: ${err.message}`);
                }

                this.activeTask = undefined;
            }

            // 队列全部消费完毕后，固化保存最新的全图一次
            if (this.syncService && this.uncommittedTasks.size > 0) {
                await this.syncService.saveSnapshot(this.projectGraph);
                this.uncommittedTasks.clear(); // 保存成功后清空未提交记录
                logger.info('[AnalysisRuntime] 调度队列全部处理完成，数据流更新并固化本地完毕！');
            }
        } finally {
            this.isProcessing = false;
            this.activeTask = undefined;

            // 防御性检查：如果在固化快照（await）等异步操作期间又有新任务入队，则重新启动处理
            if (this.taskQueue.length > 0) {
                this.emitIndexStatus();
                this._processTaskQueue().catch(err => {
                    logger.info(`[AnalysisRuntime] 追加队列处理异常: ${err.message}`);
                });
            } else {
                this.resolveQueueIdleWaiters();
                this.emitIndexStatus({ suggestRequery: true });
            }
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
    private async doAnalyzeFile(uri: vscode.Uri, generation: number): Promise<string[] | undefined> {
        logger.info(`[AnalysisRuntime] 正在进行文件实质性解析: ${uri.fsPath}`);

        // 从缓存中获取之前的结构指纹
        const oldFingerprint = this.projectGraph.fileFingerprints.get(uri.toString());

        // 1. 调用适配器服务，从LSP提取并组装指定文件的 IRNode 与内部关系边界
        const payload = await AdapterService.extractFileSymbols(uri, oldFingerprint);

        if (generation !== this.analysisGeneration) {
            logger.info(`[AnalysisRuntime] 丢弃旧世代解析结果: ${uri.fsPath}`);
            return undefined;
        }

        if (!payload || payload.nodes.length === 0) {
            logger.info(`[AnalysisRuntime] 未能从 ${uri.fsPath} 提取到结构信息或文件为空。`);
            return undefined;
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
    public async queryGlobalRelation(relations: EdgeRelation[], includeExternal?: boolean): Promise<GraphViewData> {
        await this.indexStatusService.waitForSnapshotReady();
        return this.attachIndexStatus(ViewQueryService.queryGlobalRelation(this.projectGraph, relations, includeExternal));
    }

    // 编排调用: 查询节点依赖
    public async queryNodeDependencies(nodeId: string, allowedRelations?: EdgeRelation[], includeExternal?: boolean): Promise<GraphViewData> {
        await this.indexStatusService.waitForSnapshotReady();
        return this.attachIndexStatus(ViewQueryService.queryNodeDependencies(this.projectGraph, nodeId, allowedRelations, includeExternal));
    }

    public async queryFunctionCallGraph(
        nodeId: string,
        direction?: CallGraphDirection,
        depth?: number,
        includeExternal?: boolean,
        maxNodes?: number,
        maxEdges?: number
    ): Promise<GraphViewData> {
        await this.indexStatusService.waitForSnapshotReady();
        return this.attachIndexStatus(ViewQueryService.queryFunctionCallGraph(this.projectGraph, nodeId, {
            direction,
            depth,
            includeExternal,
            maxNodes,
            maxEdges
        }));
    }

    public async queryFunctionCallPath(
        sourceId: string,
        targetId: string,
        direction?: CallGraphDirection,
        maxDepth?: number,
        includeExternal?: boolean
    ): Promise<GraphViewData> {
        await this.indexStatusService.waitForSnapshotReady();
        return this.attachIndexStatus(ViewQueryService.queryFunctionCallPath(this.projectGraph, sourceId, targetId, {
            direction,
            maxDepth,
            includeExternal
        }));
    }

    public async queryFunctionCallWaypointPath(
        nodeIds: string[],
        direction?: CallGraphDirection,
        maxDepthPerSegment?: number,
        includeExternal?: boolean
    ): Promise<GraphViewData> {
        await this.indexStatusService.waitForSnapshotReady();
        return this.attachIndexStatus(ViewQueryService.queryFunctionCallWaypointPath(this.projectGraph, nodeIds, {
            direction,
            maxDepthPerSegment,
            includeExternal
        }));
    }

    public async resolveFunctionAtEditorPosition(uri: vscode.Uri, position: vscode.Position): Promise<FunctionRef | undefined> {
        await this.indexStatusService.waitForSnapshotReady();

        return SourceLocationService.resolveFunctionRefAtPosition(this.projectGraph, uri, position, 'editor');
    }

    public async summarizeFunctionAtEditorPosition(uri: vscode.Uri, position: vscode.Position): Promise<FunctionSummaryData | undefined> {
        await this.indexStatusService.waitForSnapshotReady();

        const functionRef = await SourceLocationService.resolveFunctionRefAtPosition(this.projectGraph, uri, position, 'editor');
        if (!functionRef || functionRef.pendingGraphNode) {
            return undefined;
        }

        return SummaryService.summarizeFunction(this.projectGraph, functionRef.id);
    }

    public async resolveGraphNodeAtEditorPosition(
        uri: vscode.Uri,
        position: vscode.Position,
        allowedTypes: NodeType[] = ['class', 'interface', 'function', 'method']
    ): Promise<GraphNodeRef | undefined> {
        return (await this.resolveGraphNodesAtEditorPosition(uri, position, allowedTypes))[0];
    }

    public async resolveGraphNodesAtEditorPosition(
        uri: vscode.Uri,
        position: vscode.Position,
        allowedTypes: NodeType[] = ['class', 'interface', 'function', 'method']
    ): Promise<GraphNodeRef[]> {
        await this.indexStatusService.waitForSnapshotReady();

        return SourceLocationService.resolveGraphNodeRefsAtPosition(this.projectGraph, uri, position, allowedTypes);
    }

    public async revealSourceLocation(target: SourceLocationTarget): Promise<boolean> {
        await this.indexStatusService.waitForSnapshotReady();
        return SourceLocationService.revealSourceLocation(this.projectGraph, target);
    }

    /**
     * 公共接口：清空图并重建
     * 用于用户主动触发的完整图重置和重新扫描场景
     */
    public async clearAndRebuildGraph(): Promise<void> {
        logger.info('[AnalysisRuntime] 清空图并准备重建...');
        this.analysisGeneration++;

        // 1. 清空内存图结构
        this.projectGraph.clearAll();

        // 2. 清空本地持久化索引与历史图快照、遗留任务，防止旧指纹复活干扰分析
        if (this.syncService) {
            await this.syncService.clearIndex();
            await this.syncService.saveSnapshot(this.projectGraph);
            this.syncService.savePendingTasksSync([]);
            logger.info('[AnalysisRuntime] 本地索引、遗留任务及历史快照已清零');
        }

        // 3. 清空任务队列，取消待处理删除
        this.taskQueue = [];
        this.uncommittedTasks.clear();
        for (const timer of this.pendingDeletions.values()) {
            clearTimeout(timer);
        }
        this.pendingDeletions.clear();
        logger.info('[AnalysisRuntime] 任务队列已清空');

        // 4. 重新初始化快照就绪状态
        this.resetSnapshotReadyPromise();

        // 5. 触发完整重新扫描和增量同步
        logger.info('[AnalysisRuntime] 开始重新扫描工作区...');
        await this.runIncrementalSync();
        logger.info('[AnalysisRuntime] 图重建完成！');
    }

    private isQueueIdleForGeneration(generation: number): boolean {
        if (this.isProcessing) {
            return false;
        }

        if (this.activeTask && this.activeTask.generation === generation) {
            return false;
        }

        return !this.taskQueue.some(task => task.generation === generation);
    }

    private waitForQueueIdle(generation: number): Promise<void> {
        if (this.isQueueIdleForGeneration(generation)) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            this.queueIdleResolvers.push(() => {
                if (this.isQueueIdleForGeneration(generation)) {
                    resolve();
                } else {
                    this.waitForQueueIdle(generation).then(resolve);
                }
            });
        });
    }

    private resolveQueueIdleWaiters(): void {
        const resolvers = this.queueIdleResolvers.splice(0);
        for (const resolve of resolvers) {
            resolve();
        }
    }

    private resetSnapshotReadyPromise(): void {
        this.indexStatusService.resetSnapshotReady();
        this.emitIndexStatus();
    }

    /**
     * 释放运行时注册的资源（如事件监听器）
     */
    public dispose(): void {
        // 插件退出前立刻同步保存未完成及未固化的任务
        const leftoverTasksMap = new Map<string, AnalysisTask>();
        // 1. 先载入所有已处理但未固化到快照的任务
        for (const task of this.uncommittedTasks.values()) {
            leftoverTasksMap.set(task.uri.toString(), task);
        }
        // 2. 叠加上尚未处理的队列任务，若同名且新任务级联级别更高则提权
        for (const task of this.taskQueue) {
            const existing = leftoverTasksMap.get(task.uri.toString());
            if (existing && task.cascade) {
                existing.cascade = true;
            } else if (!existing) {
                leftoverTasksMap.set(task.uri.toString(), task);
            }
        }
        // 3. 加上当前刚好正在被执行的任务
        if (this.activeTask) {
            const key = this.activeTask.uri.toString();
            if (!leftoverTasksMap.has(key)) {
                leftoverTasksMap.set(key, this.activeTask);
            }
        }

        const leftoverTasks = Array.from(leftoverTasksMap.values());
        if (leftoverTasks.length > 0 && this.syncService) {
            const pendingData = leftoverTasks.map(t => ({
                uriStr: t.uri.toString(),
                reason: t.reason,
                cascade: t.cascade
            }));
            this.syncService.savePendingTasksSync(pendingData);
        }

        if (this.configChangeListener) {
            this.configChangeListener.dispose();
        }
        if (this.renameListener) {
            this.renameListener.dispose();
        }
        if (this.deleteListener) {
            this.deleteListener.dispose();
        }
        if (this.saveListener) {
            this.saveListener.dispose();
        }
        if (this.createListener) {
            this.createListener.dispose();
        }
        for (const timer of this.pendingDeletions.values()) {
            clearTimeout(timer);
        }
        this.pendingDeletions.clear();
    }
}
