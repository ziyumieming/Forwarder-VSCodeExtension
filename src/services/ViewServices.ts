import { ProjectGraph } from '../models/GraphManager';
import { IRNode, EdgeData, EdgeRelation, GraphViewData } from '../models/GraphDefinition';
import { logger } from '../utils/logger';


export class ViewQueryService {
    /**
     * 获取全项目中特定关系（如 'extends', 'implements' 等）的全局边和节点
     * @param graph 内存图缓存
     * @param relation 要过滤获取的单一关系
     * @returns 返回符合前端需要的 { nodes, edges } 数据集合
     */
    public static queryGlobalRelation(graph: ProjectGraph, relation: EdgeRelation): GraphViewData {
        const edges = graph.getAllEdgesByRelation(relation);

        // 使用 Set 去重收集所有关联的节点ID
        const nodeIds = new Set<string>();
        for (const edge of edges) {
            nodeIds.add(edge.sourceId);
            nodeIds.add(edge.targetId);
        }

        // 从图中实体出完整的 IRNode 信息
        const nodes = graph.getNodes(nodeIds);

        // 边界情况防护：验证并记录悬空边
        this._verifyEdgesAndNodes(edges, nodes, '[queryGlobalRelation]');

        return { nodes, edges };
    }

    /**
     * 探索指定节点的邻接网络（常用于查看一个类的属性、继承、实现关系或方法调用）
     * @param graph 内存图缓存
     * @param nodeId 中心节点ID
     * @param allowedRelations 需要过滤的边类型列表（为空由默认全量查询，不加过滤）
     * @returns 返回该节点 1 层直接邻居的网络数据
     */
    public static queryNodeDependencies(graph: ProjectGraph, nodeId: string, allowedRelations?: EdgeRelation[]): GraphViewData {
        // 请求图层提供的相关边双向聚合
        const edges = graph.getRelatedEdges(nodeId, allowedRelations);

        const nodeIds = new Set<string>();
        nodeIds.add(nodeId); // 即便是孤立节点，也要保证能作为中心返回

        for (const edge of edges) {
            nodeIds.add(edge.sourceId);
            nodeIds.add(edge.targetId);
        }

        const nodes = graph.getNodes(nodeIds);

        // 边界情况防护：验证并记录悬空边
        this._verifyEdgesAndNodes(edges, nodes, '[queryNodeDependencies]');

        return { nodes, edges };
    }

    /**
     * 检验提取出的 Nodes 中是否完整的包含了 Edges 的源/目标端点。如果缺失则输出警告。
     */
    private static _verifyEdgesAndNodes(edges: EdgeData[], nodes: IRNode[], contextTag: string): void {
        const retrievedNodeIds = new Set(nodes.map(n => n.id));
        for (const edge of edges) {
            if (!retrievedNodeIds.has(edge.sourceId)) {
                logger.warn(`[ViewQueryService] ${contextTag} 边中预期的源节点不存在于节点列表中: ${edge.sourceId}. Edge详情: ${JSON.stringify(edge)}`);
            }
            if (!retrievedNodeIds.has(edge.targetId)) {
                logger.warn(`[ViewQueryService] ${contextTag} 边中预期的目标节点不存在于节点列表中: ${edge.targetId}. Edge详情: ${JSON.stringify(edge)}`);
            }
        }
    }
}