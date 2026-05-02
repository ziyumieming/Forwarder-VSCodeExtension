import * as vscode from 'vscode';
import { PendingTaskData } from './SynchronizationServices';
import { logger } from '../utils/logger';

export interface AnalysisTask {
    uri: vscode.Uri;
    reason: string;
    cascade: boolean;
    generation: number;
}

export interface GraphAnalysisQueueStatus {
    isProcessing: boolean;
    queueLength: number;
    activeTask?: AnalysisTask;
}

export interface GraphAnalysisQueueServiceOptions {
    getGeneration: () => number;
    processTask: (task: AnalysisTask) => Promise<string[] | undefined>;
    onStatusChanged?: (status: GraphAnalysisQueueStatus) => void;
    onIdle?: (hasUncommittedTasks: boolean) => Promise<void> | void;
    onDrained?: () => void;
}

export class GraphAnalysisQueueService {
    private taskQueue: AnalysisTask[] = [];
    private uncommittedTasks: Map<string, AnalysisTask> = new Map();
    private isProcessing: boolean = false;
    private activeTask?: AnalysisTask;
    private queueIdleResolvers: (() => void)[] = [];

    constructor(private readonly options: GraphAnalysisQueueServiceOptions) { }

    public enqueue(uri: vscode.Uri, reason: string, cascade: boolean, generation: number): void {
        const uriStr = uri.toString();
        const existingIndex = this.taskQueue.findIndex(t => t.uri.toString() === uriStr);

        if (existingIndex >= 0) {
            if (cascade && !this.taskQueue[existingIndex].cascade) {
                this.taskQueue[existingIndex].cascade = true;
                this.taskQueue[existingIndex].reason = reason;
            }
        } else {
            this.taskQueue.push({ uri, reason, cascade, generation });
        }

        this.emitStatus();
        this.processTaskQueue().catch(err => {
            logger.info(`[GraphAnalysisQueueService] Queue processing failed: ${err.message}`);
        });
    }

    public clear(): void {
        this.taskQueue = [];
        this.uncommittedTasks.clear();
        this.activeTask = undefined;
        this.resolveQueueIdleWaiters();
        this.emitStatus();
    }

    public getStatus(): GraphAnalysisQueueStatus {
        return {
            isProcessing: this.isProcessing,
            queueLength: this.taskQueue.length + (this.activeTask ? 1 : 0),
            activeTask: this.activeTask
        };
    }

    public hasPendingWork(): boolean {
        return this.isProcessing || this.taskQueue.length > 0 || !!this.activeTask;
    }

    public getSerializableTasks(): PendingTaskData[] {
        const leftoverTasksMap = new Map<string, AnalysisTask>();

        for (const task of this.uncommittedTasks.values()) {
            leftoverTasksMap.set(task.uri.toString(), task);
        }

        for (const task of this.taskQueue) {
            const existing = leftoverTasksMap.get(task.uri.toString());
            if (existing && task.cascade) {
                existing.cascade = true;
            } else if (!existing) {
                leftoverTasksMap.set(task.uri.toString(), task);
            }
        }

        if (this.activeTask) {
            const key = this.activeTask.uri.toString();
            if (!leftoverTasksMap.has(key)) {
                leftoverTasksMap.set(key, this.activeTask);
            }
        }

        return Array.from(leftoverTasksMap.values()).map(t => ({
            uriStr: t.uri.toString(),
            reason: t.reason,
            cascade: t.cascade
        }));
    }

    public waitForIdle(generation: number): Promise<void> {
        if (this.isQueueIdleForGeneration(generation)) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            this.queueIdleResolvers.push(() => {
                if (this.isQueueIdleForGeneration(generation)) {
                    resolve();
                } else {
                    this.waitForIdle(generation).then(resolve);
                }
            });
        });
    }

    private async processTaskQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;
        this.emitStatus();

        try {
            while (this.taskQueue.length > 0) {
                this.activeTask = this.taskQueue.shift()!;
                this.emitStatus();
                const task = this.activeTask;
                if (task.generation !== this.options.getGeneration()) {
                    logger.info(`[GraphAnalysisQueueService] Skipped old generation task: ${task.uri.fsPath}`);
                    this.activeTask = undefined;
                    continue;
                }

                this.uncommittedTasks.set(task.uri.toString(), task);
                logger.info(`[GraphAnalysisQueueService] Processing file: ${task.uri.fsPath} (reason: ${task.reason})`);

                try {
                    const affectedUris = await this.options.processTask(task);
                    if (!affectedUris) {
                        this.uncommittedTasks.delete(task.uri.toString());
                        this.activeTask = undefined;
                        continue;
                    }

                    if (task.cascade && affectedUris.length > 0) {
                        for (const affectedUriStr of affectedUris) {
                            const affectedUri = vscode.Uri.parse(affectedUriStr);
                            this.enqueue(affectedUri, `依赖的源文件 ${task.uri.fsPath} 结构变更的级联更新`, false, task.generation);
                        }
                    }
                } catch (err: any) {
                    logger.info(`[GraphAnalysisQueueService] Ignored failed file ${task.uri.fsPath}: ${err.message}`);
                }

                this.activeTask = undefined;
            }

            if (this.uncommittedTasks.size > 0) {
                await this.options.onIdle?.(true);
                this.uncommittedTasks.clear();
                logger.info('[GraphAnalysisQueueService] Queue drained and graph snapshot persisted.');
            } else {
                await this.options.onIdle?.(false);
            }
        } finally {
            this.isProcessing = false;
            this.activeTask = undefined;

            if (this.taskQueue.length > 0) {
                this.emitStatus();
                this.processTaskQueue().catch(err => {
                    logger.info(`[GraphAnalysisQueueService] Follow-up queue processing failed: ${err.message}`);
                });
            } else {
                this.resolveQueueIdleWaiters();
                this.emitStatus();
                this.options.onDrained?.();
            }
        }
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

    private resolveQueueIdleWaiters(): void {
        const resolvers = this.queueIdleResolvers.splice(0);
        for (const resolve of resolvers) {
            resolve();
        }
    }

    private emitStatus(): void {
        this.options.onStatusChanged?.(this.getStatus());
    }
}
