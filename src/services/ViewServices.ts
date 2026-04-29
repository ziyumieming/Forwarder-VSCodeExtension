import { ProjectGraph } from '../models/GraphManager';
import { IRNode, EdgeData, EdgeRelation, GraphViewData } from '../models/GraphDefinition';
import { logger } from '../utils/logger';

export type CallGraphDirection = 'incoming' | 'outgoing' | 'both';

export interface FunctionCallGraphOptions {
    direction?: CallGraphDirection;
    depth?: number;
    includeExternal?: boolean;
    maxNodes?: number;
    maxEdges?: number;
}

export interface FunctionCallPathOptions {
    direction?: CallGraphDirection;
    includeExternal?: boolean;
    maxDepth?: number;
    maxDepthPerSegment?: number;
    maxNodes?: number;
}


export class ViewQueryService {
    /**
     * 获取全项目中特定关系（如 'extends', 'implements' 等）的全局边和节点
     * @param graph 内存图缓存
     * @param relations 要过滤获取的关系列表
     * @param includeExternal 是否包含工作区外的节点
     * @returns 返回符合前端需要的 { nodes, edges } 数据集合
     */
    public static queryGlobalRelation(graph: ProjectGraph, relations: EdgeRelation[], includeExternal?: boolean): GraphViewData {
        //logger.info(`[ViewQueryService.queryGlobalRelation] 查询开始，relations=${JSON.stringify(relations)}, includeExternal=${includeExternal}`);
        const edges = graph.getAllEdgesByRelations(relations);
        //logger.info(`[ViewQueryService.queryGlobalRelation] 从图中获取到 ${edges.length} 条边，详情: ${edges.slice(0, 5).map(e => `${e.relation}(${e.sourceId}→${e.targetId})`).join(', ')}${edges.length > 5 ? '...' : ''}`);

        // 使用 Set 去重收集所有关联的节点ID
        const nodeIds = new Set<string>();
        for (const edge of edges) {
            nodeIds.add(edge.sourceId);
            nodeIds.add(edge.targetId);
        }

        // 从图中实体出完整的 IRNode 信息
        let nodes = graph.getNodes(nodeIds);
        //logger.info(`[ViewQueryService.queryGlobalRelation] 从关联边中收集得 ${nodeIds.size} 个节点，实际检索 ${nodes.length} 个节点`);

        // 如果不包含外部节点，则过滤出非 library 节点，同时将一端受限的边剔除
        if (!includeExternal) {
            const beforeFilterNodes = nodes.length;
            const beforeFilterEdges = edges.length;
            nodes = nodes.filter(n => !n.isLibrary);
            const validNodeIds = new Set(nodes.map(n => n.id));
            const filteredEdges = edges.filter(e => validNodeIds.has(e.sourceId) && validNodeIds.has(e.targetId));
            //logger.info(`[ViewQueryService.queryGlobalRelation] 过滤库节点后: ${beforeFilterNodes}→${nodes.length} 个节点, ${beforeFilterEdges}→${filteredEdges.length} 条边`);
            return { nodes, edges: filteredEdges };
        }

        //logger.info(`[ViewQueryService.queryGlobalRelation] 返回完整结果: ${nodes.length} 个节点，${edges.length} 条边`);

        // 边界情况防护：验证并记录悬空边
        this._verifyEdgesAndNodes(edges, nodes, '[queryGlobalRelation]');

        return { nodes, edges };
    }

    /**
     * 探索指定节点的邻接网络（常用于查看一个类的属性、继承、实现关系或方法调用）
     * @param graph 内存图缓存
     * @param nodeId 中心节点ID
     * @param allowedRelations 需要过滤的边类型列表（为空由默认全量查询，不加过滤）
     * @param includeExternal 是否包含工作区外的节点
     * @returns 返回该节点 1 层直接邻居的网络数据
     */
    public static queryNodeDependencies(graph: ProjectGraph, nodeId: string, allowedRelations?: EdgeRelation[], includeExternal?: boolean): GraphViewData {
        //logger.info(`[ViewQueryService.queryNodeDependencies] 查询开始，nodeId=${nodeId}, allowedRelations=${JSON.stringify(allowedRelations)}, includeExternal=${includeExternal}`);

        // 请求图层提供的相关边双向聚合
        const edges = graph.getRelatedEdges(nodeId, allowedRelations);
        //logger.info(`[ViewQueryService.queryNodeDependencies] 为节点 ${nodeId} 获取到 ${edges.length} 条关联边`);
        // edges.slice(0, 10).forEach(e => logger.info(`  - ${e.relation}: ${e.sourceId} → ${e.targetId}`));
        // if (edges.length > 10) { logger.info(`  ... 共 ${edges.length} 条边`); }

        const nodeIds = new Set<string>();
        nodeIds.add(nodeId); // 即便是孤立节点，也要保证能作为中心返回

        for (const edge of edges) {
            nodeIds.add(edge.sourceId);
            nodeIds.add(edge.targetId);
        }

        let nodes = graph.getNodes(nodeIds);
        //logger.info(`[ViewQueryService.queryNodeDependencies] 从关联边中收集得 ${nodeIds.size} 个节点，实际检索 ${nodes.length} 个节点`);

        const centerNode = nodes.find(n => n.id === nodeId);
        let centerDetails: GraphViewData['centerDetails'] | undefined;
        if (centerNode && (centerNode.type === 'class' || centerNode.type === 'interface')) {
            const containsEdges = graph.getRelatedEdges(nodeId, ['contains']).filter(e => e.sourceId === nodeId);
            const functionNodeIds = new Set(containsEdges.map(e => e.targetId));
            const containsNodes = graph.getNodes(containsEdges.map(e => e.targetId));
            const methods = containsNodes.filter(n => functionNodeIds.has(n.id)).map(n => ({ id: n.id, name: n.name }));

            centerDetails = {
                nodeId,
                name: centerNode.name,
                type: centerNode.type,
                fields: centerNode.fields,
                methods
            };
        }
        // logger.info(`[ViewQueryService.queryNodeDependencies] 中心节点详情: ${centerDetails ? JSON.stringify(centerDetails) : '无'}`);

        // 如果不包含外部节点，则过滤非 library 节点，同时剔除关联被过滤节点的边
        if (!includeExternal) {
            const beforeFilterNodes = nodes.length;
            const beforeFilterEdges = edges.length;
            nodes = nodes.filter(n => !n.isLibrary || n.id === nodeId); // 始终保留中心节点，即便它是 library
            const validNodeIds = new Set(nodes.map(n => n.id));
            const filteredEdges = edges.filter(e => validNodeIds.has(e.sourceId) && validNodeIds.has(e.targetId));
            //logger.info(`[ViewQueryService.queryNodeDependencies] 过滤库节点后: ${beforeFilterNodes}→${nodes.length} 个节点, ${beforeFilterEdges}→${filteredEdges.length} 条边`);
            return { nodes, edges: filteredEdges, centerDetails };
        }

        //logger.info(`[ViewQueryService.queryNodeDependencies] 返回完整结果: ${nodes.length} 个节点，${edges.length} 条边`);

        // 边界情况防护：验证并记录悬空边
        this._verifyEdgesAndNodes(edges, nodes, '[queryNodeDependencies]');

        return { nodes, edges, centerDetails };
    }

    public static queryFunctionCallGraph(
        graph: ProjectGraph,
        nodeId: string,
        options: FunctionCallGraphOptions = {}
    ): GraphViewData {
        const direction = this.normalizeDirection(options.direction, 'both');
        const depth = this.normalizePositiveInteger(options.depth, 2, 0, 20);
        const maxNodes = this.normalizePositiveInteger(options.maxNodes, 100, 1, 5000);
        const maxEdges = this.normalizePositiveInteger(options.maxEdges, 300, 1, 10000);
        const includeExternal = options.includeExternal === true;

        const visited = new Set<string>([nodeId]);
        const edgeMap = new Map<string, EdgeData>();
        const queue: { id: string; depth: number }[] = [{ id: nodeId, depth: 0 }];
        let truncated = false;

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (current.depth >= depth) {
                continue;
            }

            const nextEdges = graph.getCallEdges(current.id, direction);
            for (const edge of nextEdges) {
                const source = graph.getNode(edge.sourceId);
                const target = graph.getNode(edge.targetId);
                if (!source || !target) {
                    continue;
                }

                if (!includeExternal && (source.isLibrary || target.isLibrary) && edge.sourceId !== nodeId && edge.targetId !== nodeId) {
                    continue;
                }

                const edgeKey = this.getEdgeKey(edge);
                if (!edgeMap.has(edgeKey)) {
                    if (edgeMap.size >= maxEdges) {
                        truncated = true;
                        continue;
                    }
                    edgeMap.set(edgeKey, edge);
                }

                const nextNodeId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
                if (!visited.has(nextNodeId)) {
                    if (visited.size >= maxNodes) {
                        truncated = true;
                        continue;
                    }

                    visited.add(nextNodeId);
                    queue.push({ id: nextNodeId, depth: current.depth + 1 });
                }
            }
        }

        const nodes = this.filterNodesForExternal(graph.getNodes(visited), nodeId, includeExternal);
        const validNodeIds = new Set(nodes.map(n => n.id));
        const edges = Array.from(edgeMap.values()).filter(e => validNodeIds.has(e.sourceId) && validNodeIds.has(e.targetId));

        return {
            nodes,
            edges,
            meta: {
                truncated,
                depth,
                direction
            }
        };
    }

    public static queryFunctionCallPath(
        graph: ProjectGraph,
        sourceId: string,
        targetId: string,
        options: FunctionCallPathOptions = {}
    ): GraphViewData {
        const direction = this.normalizeDirection(options.direction, 'outgoing');
        const maxDepth = this.normalizePositiveInteger(options.maxDepth, 8, 0, 50);
        const maxNodes = this.normalizePositiveInteger(options.maxNodes, 1000, 1, 10000);
        const includeExternal = options.includeExternal === true;

        const sourceNode = graph.getNode(sourceId);
        const targetNode = graph.getNode(targetId);
        if (!sourceNode || !targetNode) {
            return {
                nodes: graph.getNodes([sourceId, targetId]),
                edges: [],
                meta: {
                    pathFound: false,
                    direction,
                    depth: maxDepth,
                    reason: 'missing-endpoint'
                }
            };
        }

        if (sourceId === targetId) {
            return {
                nodes: [sourceNode],
                edges: [],
                meta: {
                    pathFound: true,
                    direction,
                    depth: 0
                }
            };
        }

        const visited = new Set<string>([sourceId]);
        const queue: { id: string; depth: number }[] = [{ id: sourceId, depth: 0 }];
        const predecessor = new Map<string, { previousId: string; edge: EdgeData }>();
        let truncated = false;
        let found = false;

        while (queue.length > 0 && !found) {
            const current = queue.shift()!;
            if (current.depth >= maxDepth) {
                continue;
            }

            const nextEdges = graph.getCallEdges(current.id, direction);
            for (const edge of nextEdges) {
                const nextNodeId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
                const nextNode = graph.getNode(nextNodeId);
                if (!nextNode) {
                    continue;
                }

                if (!includeExternal && nextNode.isLibrary && nextNodeId !== targetId) {
                    continue;
                }

                if (visited.has(nextNodeId)) {
                    continue;
                }

                if (visited.size >= maxNodes) {
                    truncated = true;
                    continue;
                }

                visited.add(nextNodeId);
                predecessor.set(nextNodeId, { previousId: current.id, edge });

                if (nextNodeId === targetId) {
                    found = true;
                    break;
                }

                queue.push({ id: nextNodeId, depth: current.depth + 1 });
            }
        }

        if (!found) {
            const nodes = this.filterNodesForExternal(graph.getNodes([sourceId, targetId]), sourceId, includeExternal);
            return {
                nodes,
                edges: [],
                meta: {
                    pathFound: false,
                    truncated,
                    direction,
                    depth: maxDepth
                }
            };
        }

        const pathNodeIds = new Set<string>([targetId]);
        const pathEdges: EdgeData[] = [];
        let cursor = targetId;
        while (cursor !== sourceId) {
            const step = predecessor.get(cursor);
            if (!step) {
                break;
            }
            pathEdges.unshift(step.edge);
            pathNodeIds.add(step.previousId);
            cursor = step.previousId;
        }

        const nodes = this.filterNodesForExternal(graph.getNodes(pathNodeIds), sourceId, includeExternal);
        const validNodeIds = new Set(nodes.map(n => n.id));
        const edges = pathEdges.filter(e => validNodeIds.has(e.sourceId) && validNodeIds.has(e.targetId));

        return {
            nodes,
            edges,
            meta: {
                pathFound: true,
                truncated,
                direction,
                depth: edges.length
            }
        };
    }

    public static queryFunctionCallWaypointPath(
        graph: ProjectGraph,
        nodeIds: string[],
        options: FunctionCallPathOptions = {}
    ): GraphViewData {
        const direction = this.normalizeDirection(options.direction, 'outgoing');
        const maxDepthPerSegment = this.normalizePositiveInteger(
            options.maxDepthPerSegment ?? options.maxDepth,
            8,
            0,
            50
        );
        const includeExternal = options.includeExternal === true;
        const waypointIds = Array.isArray(nodeIds)
            ? nodeIds.map(id => String(id)).filter(id => id.length > 0)
            : [];

        if (waypointIds.length < 2) {
            const nodes = graph.getNodes(waypointIds);
            return {
                nodes,
                edges: [],
                meta: {
                    pathFound: false,
                    direction,
                    depth: 0,
                    waypointIds,
                    segments: [],
                    reason: 'insufficient-waypoints'
                }
            };
        }

        const nodeMap = new Map<string, IRNode>();
        const edgeMap = new Map<string, EdgeData>();
        const segments: NonNullable<GraphViewData['meta']>['segments'] = [];
        let pathFound = true;
        let truncated = false;
        let failedSegmentIndex: number | undefined;

        for (const waypointId of waypointIds) {
            const node = graph.getNode(waypointId);
            if (node) {
                nodeMap.set(node.id, node);
            }
        }

        for (let index = 0; index < waypointIds.length - 1; index += 1) {
            const sourceId = waypointIds[index];
            const targetId = waypointIds[index + 1];
            const segmentResult = this.queryFunctionCallPath(graph, sourceId, targetId, {
                direction,
                maxDepth: maxDepthPerSegment,
                includeExternal,
                maxNodes: options.maxNodes
            });

            for (const node of segmentResult.nodes) {
                nodeMap.set(node.id, node);
            }
            for (const edge of segmentResult.edges) {
                edgeMap.set(this.getEdgeKey(edge), edge);
            }

            const segmentFound = segmentResult.meta?.pathFound === true;
            const segmentDepth = Number(segmentResult.meta?.depth ?? segmentResult.edges.length);
            const segmentReason = segmentResult.meta?.reason;
            segments.push({
                sourceId,
                targetId,
                pathFound: segmentFound,
                depth: Number.isFinite(segmentDepth) ? segmentDepth : segmentResult.edges.length,
                ...(segmentReason ? { reason: segmentReason } : {})
            });

            if (segmentResult.meta?.truncated) {
                truncated = true;
            }

            if (!segmentFound) {
                pathFound = false;
                failedSegmentIndex = index;
                break;
            }
        }

        const nodes = this.filterNodesForExternal(Array.from(nodeMap.values()), waypointIds[0], includeExternal);
        const validNodeIds = new Set(nodes.map(node => node.id));
        const edges = Array.from(edgeMap.values()).filter(edge => validNodeIds.has(edge.sourceId) && validNodeIds.has(edge.targetId));

        return {
            nodes,
            edges,
            meta: {
                pathFound,
                truncated,
                direction,
                depth: edges.length,
                waypointIds,
                segments,
                ...(failedSegmentIndex !== undefined ? { failedSegmentIndex } : {})
            }
        };
    }

    /**
     * 检验提取出的 Nodes 中是否完整的包含了 Edges 的源/目标端点。如果缺失则输出警告。
     */
    private static _verifyEdgesAndNodes(edges: EdgeData[], nodes: IRNode[], contextTag: string): void {
        const retrievedNodeIds = new Set(nodes.map(n => n.id));
        let hangingEdgesCount = 0;
        for (const edge of edges) {
            let isHanging = false;
            if (!retrievedNodeIds.has(edge.sourceId)) {
                logger.warn(`[ViewQueryService] ${contextTag} 边中预期的源节点不存在于节点列表中: ${edge.sourceId}. Edge详情: ${JSON.stringify(edge)}`);
                isHanging = true;
            }
            if (!retrievedNodeIds.has(edge.targetId)) {
                logger.warn(`[ViewQueryService] ${contextTag} 边中预期的目标节点不存在于节点列表中: ${edge.targetId}. Edge详情: ${JSON.stringify(edge)}`);
                isHanging = true;
            }
            if (isHanging) { hangingEdgesCount++; }
        }
        if (hangingEdgesCount > 0) {
            logger.warn(`[ViewQueryService] ${contextTag} 发现 ${hangingEdgesCount} 条悬空边（缺少源或目标节点）`);
        }
    }

    private static filterNodesForExternal(nodes: IRNode[], centerNodeId: string, includeExternal: boolean): IRNode[] {
        if (includeExternal) {
            return nodes;
        }

        return nodes.filter(node => !node.isLibrary || node.id === centerNodeId);
    }

    private static getEdgeKey(edge: EdgeData): string {
        return `${edge.sourceId}->${edge.targetId}#${edge.relation}`;
    }

    private static normalizeDirection(value: unknown, fallback: CallGraphDirection): CallGraphDirection {
        if (value === 'incoming' || value === 'outgoing' || value === 'both') {
            return value;
        }

        return fallback;
    }

    private static normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, Math.floor(parsed)));
    }
}
