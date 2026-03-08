import { IRNode, EdgeRelation, AdjacencyMap, EdgeData } from "./graphdefinition";

export interface FileSymbolsPayload {
    uri: string;
    nodes: IRNode[];
    edges: EdgeData[];
}

export class ProjectGraph {
    // 节点池 (ID -> IRNode)
    public nodes: Map<string, IRNode> = new Map();

    // 出边表: sourceId -> (relation -> Set<targetId>)
    public outEdges: AdjacencyMap = new Map();

    // 入边表: targetId -> (relation -> Set<sourceId>)
    public inEdges: AdjacencyMap = new Map();

    /**
     * 供数据适配层调用的接口：处理单文件的节点和关系更新指令
     * @param payload 包含文件URI及其内部结构解析结果（节点与边）
     */
    public updateFileSymbols(payload: FileSymbolsPayload): void {
        // 当前侧重于新增逻辑，未来为了支持“更新”，可以在此处先根据 payload.uri 查出并清理旧节点和边

        // 1. 添加/更新节点
        for (const node of payload.nodes) {
            this._addNode(node);
        }

        // 2. 添加关系边
        for (const edge of payload.edges) {
            this._addEdge(edge.sourceId, edge.targetId, edge.relation);
        }
    }

    // ==========================================
    // 图数据结构原子操作：内部原子方法
    // ==========================================

    /**
     * 添加或覆盖节点
     */
    private _addNode(node: IRNode): void {
        this.nodes.set(node.id, node);// TODO: 此处为全量覆盖，未来可改为增量更新（仅当节点已存在时才覆盖特定字段）
    }

    /**
     * 添加有向边（维护多维邻接表）
     */
    private _addEdge(sourceId: string, targetId: string, relation: EdgeRelation): void {
        // 更新出边表 (Out-Edges)
        if (!this.outEdges.has(sourceId)) {
            this.outEdges.set(sourceId, new Map());
        }
        const sourceRelations = this.outEdges.get(sourceId)!;
        if (!sourceRelations.has(relation)) {
            sourceRelations.set(relation, new Set());
        }
        sourceRelations.get(relation)!.add(targetId);// ! 断言非空，因为前面已经初始化了

        // 更新入边表 (In-Edges)
        if (!this.inEdges.has(targetId)) {
            this.inEdges.set(targetId, new Map());
        }
        const targetRelations = this.inEdges.get(targetId)!;
        if (!targetRelations.has(relation)) {
            targetRelations.set(relation, new Set());
        }
        targetRelations.get(relation)!.add(sourceId);
    }
}