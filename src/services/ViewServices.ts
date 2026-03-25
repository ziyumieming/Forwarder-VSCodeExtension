import { ProjectGraph } from '../models/GraphManager';
import { IRNode, EdgeData, EdgeRelation, GraphViewData } from '../models/GraphDefinition';
import { logger } from '../utils/logger';


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
        logger.info(`[ViewQueryService.queryNodeDependencies] 中心节点详情: ${centerDetails ? JSON.stringify(centerDetails) : '无'}`);

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
}