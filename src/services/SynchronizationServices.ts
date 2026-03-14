import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectGraph } from '../models/GraphManager';
import { logger } from '../utils/logger';
import { EdgeRelation, IRNode } from '../models/GraphDefinition';

export interface FileIndexSnapshot {
    [uriString: string]: number; // mtimeMs
}

export interface WorkspaceChanges {
    addedOrModified: vscode.Uri[];
    deleted: vscode.Uri[];
}

export class SynchronizationService {
    private storagePath: string;
    private fileIndex: FileIndexSnapshot = {};

    constructor(storagePath: string) {
        this.storagePath = storagePath;
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

            // 序列化 inEdges
            // TODO: 目前 outEdges 和 inEdges 是冗余存储的，理论上只需要存储其中一个，另一个可以通过遍历构建。但为了简化实现和查询效率，这里暂时都存储。未来可以考虑优化为只存储 outEdges。
            const inEdgesArray = Array.from(graph.inEdges.entries()).map(([target, relations]) => {
                const relArray = Array.from(relations.entries()).map(([rel, sources]) => [rel, Array.from(sources)]);
                return [target, relArray];
            });

            const data = {
                graph: {
                    nodes: nodesArray,
                    outEdges: outEdgesArray,
                    inEdges: inEdgesArray
                },
                index: this.fileIndex
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

            this.fileIndex = data.index || {};

            if (data.graph) {
                // 还原 nodes
                if (data.graph.nodes) {
                    graph.nodes = new Map<string, IRNode>(data.graph.nodes);
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
        } catch (error: any) {
            logger.info(`[SyncService] 读取或解析快照出错: ${error.message}，将视为无缓存启动。`);
            this.fileIndex = {};
        }
    }

    /**
     * 比较工作区当前文件修改时间和现有索引，计算出增量更新队列
     */
    public async scanWorkspaceChanges(): Promise<WorkspaceChanges> {
        const changes: WorkspaceChanges = {
            addedOrModified: [],
            deleted: []
        };

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return changes;
        }

        const currentFiles = new Set<string>();

        // 仅作为范例，扫描主流编程语言源码文件，排除第三方库和编译产物
        const includePattern = '**/*.{ts,js,py,java,cpp,c,cs}';
        const excludePattern = '**/{node_modules,.git,out,dist,build}/**';

        for (const folder of workspaceFolders) {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, includePattern),
                excludePattern
            );

            for (const fileUri of files) {
                const fsPath = fileUri.fsPath;
                const uriString = fileUri.toString();
                currentFiles.add(uriString);

                try {
                    const stat = await fs.promises.stat(fsPath);
                    const mtimeMs = stat.mtimeMs;

                    if (!this.fileIndex[uriString] || this.fileIndex[uriString] < mtimeMs) {
                        changes.addedOrModified.push(fileUri);
                        // 更新索引状态
                        this.fileIndex[uriString] = mtimeMs;
                    }
                } catch (err: any) {
                    // 若文件权限等问题导致 stat 失败则忽略
                    logger.info(`[SyncService] 无法读取文件状态: ${err.message}`);
                }
            }
        }

        // 推断出已删除文件（存在于原快照中但已被移除的工作区文件）
        for (const uriString in this.fileIndex) {
            if (!currentFiles.has(uriString)) {
                changes.deleted.push(vscode.Uri.parse(uriString));
            }
        }

        return changes;
    }

    /**
     * 手动从快照索引中移除该文件
     */
    public removeFileFromIndex(uri: vscode.Uri): void {
        delete this.fileIndex[uri.toString()];
    }
}