import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ProjectGraph } from '../models/GraphManager';
import { logger } from '../utils/logger';
import { EdgeRelation, IRNode } from '../models/GraphDefinition';

export interface PendingTaskData {
    uriStr: string;
    reason: string;
    cascade: boolean;
}

export interface FileIndexSnapshot {
    [uriString: string]: {
        mtimeMs: number;
        hash: string;
    };
}

export interface WorkspaceChanges {
    addedOrModified: vscode.Uri[];
    deleted: vscode.Uri[];
    renamed: { oldUri: vscode.Uri; newUri: vscode.Uri }[];
}

export class SynchronizationService {
    private storagePath: string;
    private indexPath: string;
    private fileIndex: FileIndexSnapshot = {};

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.indexPath = storagePath.replace('graph_snapshot.json', 'workspace_index.json');
    }

    /**
     * 加载独立的文件索引
     */
    public async loadFileIndex(): Promise<void> {
        if (!fs.existsSync(this.indexPath)) {
            this.fileIndex = {};
            return;
        }
        try {
            const content = await fs.promises.readFile(this.indexPath, 'utf8');
            this.fileIndex = JSON.parse(content);
        } catch (error: any) {
            logger.info(`[SyncService] 读取文件索引失败: ${error.message}，将重建索引。`);
            this.fileIndex = {};
        }
    }

    /**
     * 保存独立的文件索引
     */
    public async saveFileIndex(): Promise<void> {
        try {
            await fs.promises.writeFile(this.indexPath, JSON.stringify(this.fileIndex, null, 2), 'utf8');
        } catch (error: any) {
            logger.info(`[SyncService] 保存文件索引失败: ${error.message}`);
        }
    }

    /**
     * 将当前图数据结构和文件修改时间索引序列化到本地存储
     */
    public async saveSnapshot(graph: ProjectGraph): Promise<void> {
        try {
            // 序列化 nodes (Map -> Array)
            const nodesArray = Array.from(graph.nodes.entries());

            // 序列化 outEdges (Map<string, Map<EdgeRelation, Set<string>>> -> Array)
            const outEdgesArray = Array.from(graph.outEdges.entries()).map(([source, relations]) => {
                const relArray = Array.from(relations.entries()).map(([rel, targets]) => [rel, Array.from(targets)]);
                return [source, relArray];
            });

            // 序列化 inEdges：outEdges 和 inEdges 是冗余存储的，理论上只需要存储其中一个，另一个可以通过遍历构建。为了简化实现和查询效率，这里都存储。
            const inEdgesArray = Array.from(graph.inEdges.entries()).map(([target, relations]) => {
                const relArray = Array.from(relations.entries()).map(([rel, sources]) => [rel, Array.from(sources)]);
                return [target, relArray];
            });

            const data = {
                graph: {
                    nodes: nodesArray,
                    outEdges: outEdgesArray,
                    inEdges: inEdgesArray,
                    // 注意：这里保存的是 LSP 语义指纹，用于对比分析阶段的 AST 提取是否改变。与 workspace_index 中的物理文件 MD5 哈希互相独立。
                    fileFingerprints: Array.from(graph.fileFingerprints.entries())
                }
            };

            const dir = path.dirname(this.storagePath);
            if (!fs.existsSync(dir)) {
                await fs.promises.mkdir(dir, { recursive: true });
            }

            await fs.promises.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
            logger.info(`[SyncService] 快照已保存至: ${this.storagePath}`);
        } catch (err: any) {
            logger.info(`[SyncService] 保存快照失败: ${err.message}`);
        }
    }

    /**
     * 从本地存储反序列化并还原图数据结构和文件索引
     */
    public async loadSnapshot(graph: ProjectGraph): Promise<void> {
        if (!fs.existsSync(this.storagePath)) {
            logger.info(`[SyncService] 未找到本地快照，将从零开始构建图数据。`);
            return;
        }

        try {
            const fileContent = await fs.promises.readFile(this.storagePath, 'utf8');
            const data = JSON.parse(fileContent);

            if (data.graph) {
                // 还原 nodes 及 fileNodes 关联索引
                if (data.graph.nodes) {
                    graph.nodes = new Map<string, IRNode>(data.graph.nodes);
                    graph.fileNodes = new Map();
                    for (const [id, node] of graph.nodes.entries()) {
                        if (node.location && node.location.uri) {
                            const uri = node.location.uri;
                            if (!graph.fileNodes.has(uri)) {
                                graph.fileNodes.set(uri, new Set());
                            }
                            graph.fileNodes.get(uri)!.add(id);
                        }
                    }
                }

                // 还原 fileFingerprints
                if (data.graph.fileFingerprints) {
                    graph.fileFingerprints = new Map(data.graph.fileFingerprints);
                }

                // 还原 outEdges
                if (data.graph.outEdges) {
                    graph.outEdges = new Map();
                    for (const [source, relArray] of data.graph.outEdges) {
                        const relMap = new Map<EdgeRelation, Set<string>>();
                        for (const [rel, targets] of relArray) {
                            relMap.set(rel as EdgeRelation, new Set(targets));
                        }
                        graph.outEdges.set(source, relMap);
                    }
                }

                // 还原 inEdges
                if (data.graph.inEdges) {
                    graph.inEdges = new Map();
                    for (const [target, relArray] of data.graph.inEdges) {
                        const relMap = new Map<EdgeRelation, Set<string>>();
                        for (const [rel, sources] of relArray) {
                            relMap.set(rel as EdgeRelation, new Set(sources));
                        }
                        graph.inEdges.set(target, relMap);
                    }
                }
            }
            logger.info(`[SyncService] 本地快照加载成功。`);
            return;
        } catch (error: any) {
            logger.info(`[SyncService] 读取或解析快照出错: ${error.message}，将视为无缓存启动。`);
            return;
        }
    }

    /**
     * 计算文件的哈希值，现使用更为轻量且高效的 md5 算法
     */
    private async computeFileHash(fsPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(fsPath);
            stream.on('error', err => reject(err));
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }

    /**
     * 同步保存尚未处理完毕的队列内容
     */
    public savePendingTasksSync(tasks: PendingTaskData[]): void {
        const pendingPath = this.storagePath.replace('graph_snapshot.json', 'pending_tasks.json');//保证相同文件夹
        try {
            fs.writeFileSync(pendingPath, JSON.stringify(tasks, null, 2), 'utf8');
            logger.info(`[SyncService] 未完成队列表已同步保存至: ${pendingPath}`);
        } catch (e: any) {
            logger.info(`[SyncService] 保存未完成队列失败: ${e.message}`);
        }
    }

    /**
     * 同步加载上次关闭时未处理完毕的队列，读取后即刻将其删除
     */
    public loadPendingTasksSync(): PendingTaskData[] {
        const pendingPath = this.storagePath.replace('graph_snapshot.json', 'pending_tasks.json');
        if (fs.existsSync(pendingPath)) {
            try {
                const content = fs.readFileSync(pendingPath, 'utf8');
                fs.unlinkSync(pendingPath); // 恢复即删除，防止后续重复读取污染
                return JSON.parse(content) as PendingTaskData[];
            } catch (e: any) {
                logger.info(`[SyncService] 读取未完成队列失败: ${e.message}`);
            }
        }
        return [];
    }

    /**
     * 比较工作区当前文件修改时间和现有索引，计算出增量更新队列
     */
    public async scanWorkspaceChanges(): Promise<WorkspaceChanges> {
        const changes: WorkspaceChanges = {
            addedOrModified: [],
            deleted: [],
            renamed: []
        };

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return changes;
        }

        const currentFiles = new Map<string, { uri: vscode.Uri, fsPath: string, hash: string, mtimeMs: number }>();
        const potentialAdditions: { uri: vscode.Uri, fsPath: string, hash: string, mtimeMs: number }[] = [];

        // 从工作区设置中读取包含与排除模式，若无则使用默认的回退配置
        const config = vscode.workspace.getConfiguration('forwarder.analysis');
        const includePattern = config.get<string>('includePattern') || '**/*.{ts,js,py,java,cpp,c,cs,go,rs,rb,php}';
        const excludePattern = config.get<string>('excludePattern') || '**/{node_modules,.git,.svn,out,dist,build,bin,obj,vendor,target,.vscode,.idea}/**';

        for (const folder of workspaceFolders) {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, includePattern),
                excludePattern
            );

            for (const fileUri of files) {
                const fsPath = fileUri.fsPath;
                const uriString = fileUri.toString();

                try {
                    const stat = await fs.promises.stat(fsPath);
                    const mtimeMs = stat.mtimeMs;//逐个扫描修改时间应该已经是最快的了

                    const indexEntry = this.fileIndex[uriString];
                    if (!indexEntry || indexEntry.mtimeMs < mtimeMs) {
                        // 文件是新增的或者已经被修改
                        const fileHash = await this.computeFileHash(fsPath);
                        potentialAdditions.push({ uri: fileUri, fsPath, hash: fileHash, mtimeMs });
                    } else {
                        // 未被修改
                        currentFiles.set(uriString, { uri: fileUri, fsPath, hash: indexEntry.hash, mtimeMs });
                    }
                } catch (err: any) {
                    logger.info(`[SyncService] 无法读取文件状态: ${err.message}`);
                }
            }
        }

        // 推断出已删除文件（存在于原快照中但已被移除的工作区文件）的 URI 列表
        const potentialDeletions: { uri: vscode.Uri, uriString: string, hash: string }[] = [];
        for (const uriString in this.fileIndex) {
            if (!currentFiles.has(uriString) && !potentialAdditions.find(p => p.uri.toString() === uriString)) {
                potentialDeletions.push({
                    uri: vscode.Uri.parse(uriString),
                    uriString,
                    hash: this.fileIndex[uriString].hash
                });
            }
        }

        // 检测重命名
        // 如果有一个被标记为"新增"的文件和一个被标记为"删除"的文件哈希值相同，视为重命名
        const additionMatched = new Set<string>();
        const deletionMatched = new Set<string>();

        for (const addition of potentialAdditions) {
            // 在被删除文件中寻找 hash 相同的
            const matchedDeletion = potentialDeletions.find(
                d => d.hash === addition.hash && !deletionMatched.has(d.uriString)
            );

            if (matchedDeletion) {
                // 是重命名
                changes.renamed.push({ oldUri: matchedDeletion.uri, newUri: addition.uri });
                additionMatched.add(addition.uri.toString());
                deletionMatched.add(matchedDeletion.uriString);

                // 更新索引
                this.fileIndex[addition.uri.toString()] = { mtimeMs: addition.mtimeMs, hash: addition.hash };
            }
        }

        // 剩余的是确定的新增或修改
        for (const addition of potentialAdditions) {
            if (!additionMatched.has(addition.uri.toString())) {
                changes.addedOrModified.push(addition.uri);
                this.fileIndex[addition.uri.toString()] = { mtimeMs: addition.mtimeMs, hash: addition.hash };
            }
        }

        // 剩余的是确定的删除
        for (const deletion of potentialDeletions) {
            if (!deletionMatched.has(deletion.uriString)) {
                changes.deleted.push(deletion.uri);
            }
        }

        // 统一保存一次索引
        await this.saveFileIndex();

        return changes;
    }

    /**
     * 重置缓存以强制下一次实行全量重新扫描
     */
    public async clearIndex(): Promise<void> {
        this.fileIndex = {};
        await this.saveFileIndex();
    }

    /**
     * 新增或更新文件在快照索引中的状态并保存
     */
    public async addOrUpdateFileInIndex(uri: vscode.Uri): Promise<void> {
        const fsPath = uri.fsPath;
        try {
            const stat = await fs.promises.stat(fsPath);
            const mtimeMs = stat.mtimeMs;
            const hash = await this.computeFileHash(fsPath);
            this.fileIndex[uri.toString()] = { mtimeMs, hash };
            await this.saveFileIndex();
        } catch (err: any) {
            logger.info(`[SyncService] 更新文件索引失败: ${err.message}`);
        }
    }

    /**
     * 手动从快照索引中移除该文件并保存
     */
    public async removeFileFromIndex(uri: vscode.Uri): Promise<void> {
        delete this.fileIndex[uri.toString()];
        await this.saveFileIndex();
    }

    /**
     * 更新被重命名文件在快照索引中的键名并保存
     */
    public async renameFileInIndex(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
        const entry = this.fileIndex[oldUri.toString()];
        if (entry) {
            this.fileIndex[newUri.toString()] = entry;
            delete this.fileIndex[oldUri.toString()];
            await this.saveFileIndex();
        }
    }
}