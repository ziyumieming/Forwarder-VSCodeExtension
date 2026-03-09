import { IRNode, EdgeRelation, AdjacencyMap, EdgeData } from "./GraphDefinition";

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
        // TODO: 当前侧重于新增逻辑，未来为了支持“更新”，可以在此处先根据 payload.uri 查出并清理旧节点和边

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
    // 图数据结构查询操作：提供视图查询支持
    // ==========================================

    public getNode(id: string): IRNode | undefined {
        return this.nodes.get(id);
    }

    public getNodes(ids: Iterable<string>): IRNode[] {
        const result: IRNode[] = [];
        for (const id of ids) {
            const node = this.nodes.get(id);
            if (node) {
                result.push(node);
            }
        }
        return result;
    }

    public getAllEdgesByRelation(relation: EdgeRelation): EdgeData[] {
        const edges: EdgeData[] = [];
        for (const [sourceId, relations] of this.outEdges.entries()) {
            const targetSet = relations.get(relation);
            if (targetSet) {
                for (const targetId of targetSet) {
                    edges.push({ sourceId, targetId, relation });
                }
            }
        }
        return edges;
    }

    public getRelatedEdges(nodeId: string, allowedRelations?: EdgeRelation[]): EdgeData[] {
        const edges: EdgeData[] = [];

        // 查出边
        const outRels = this.outEdges.get(nodeId);
        if (outRels) {
            for (const [rel, targets] of outRels.entries()) {
                if (!allowedRelations || allowedRelations.includes(rel)) {
                    for (const targetId of targets) {
                        edges.push({ sourceId: nodeId, targetId, relation: rel });
                    }
                }
            }
        }

        // 查入边
        const inRels = this.inEdges.get(nodeId);
        if (inRels) {
            for (const [rel, sources] of inRels.entries()) {
                if (!allowedRelations || allowedRelations.includes(rel)) {
                    for (const sourceId of sources) {
                        edges.push({ sourceId, targetId: nodeId, relation: rel });
                    }
                }
            }
        }

        return edges;
    }

    // ==========================================
    // 图数据结构维护操作：供适配层调用
    // ==========================================

    /**
     * 添加或覆盖节点
     */
    private _addNode(node: IRNode): void {
        const existing = this.nodes.get(node.id);
        if (existing) {
            // 如果已存在且不是占位节点，而新传入的却是占位节点，那就不覆盖
            if (!existing.placeHolder && node.placeHolder) {
                return;
            }
        }
        this.nodes.set(node.id, node);
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