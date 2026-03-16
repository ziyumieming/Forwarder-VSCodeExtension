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

    // 文件到节点 ID 的映射: uri -> Set<nodeId>
    public fileNodes: Map<string, Set<string>> = new Map();

    /**
     * 供持久化模块调用的接口：重命名工作区文件，更新相关的节点及其边
     */
    public renameFile(oldUri: string, newUri: string): void {
        const nodeIds = this.fileNodes.get(oldUri);
        if (!nodeIds) { return; }

        const newNodesSet = new Set<string>();
        this.fileNodes.set(newUri, newNodesSet);

        const idMap = new Map<string, string>(); // oldId -> newId

        for (const oldId of nodeIds) {
            const node = this.nodes.get(oldId);
            if (!node) { continue; }

            const newId = oldId.replace(oldUri, newUri);
            idMap.set(oldId, newId);

            // 移除旧节点，添加新节点
            this.nodes.delete(oldId);
            node.id = newId;
            node.location.uri = newUri;
            this.nodes.set(newId, node);
            newNodesSet.add(newId);
        }

        // 清理旧文件的映射
        this.fileNodes.delete(oldUri);

        // 修复出入边
        const reconstructEdges = (edgesMap: AdjacencyMap) => {
            const tempMap = new Map(edgesMap);
            edgesMap.clear();

            for (const [key, relations] of tempMap.entries()) {
                const newKey = idMap.get(key) || key;
                const newRelationsMap = new Map<EdgeRelation, Set<string>>();

                for (const [relation, valueSet] of relations.entries()) {
                    const newValueSet = new Set<string>();
                    for (const peerId of valueSet) {
                        const newPeerId = idMap.get(peerId) || peerId;
                        newValueSet.add(newPeerId);
                    }
                    if (newValueSet.size > 0) {
                        newRelationsMap.set(relation, newValueSet);
                    }
                }

                edgesMap.set(newKey, newRelationsMap);
            }
        };

        reconstructEdges(this.outEdges);
        reconstructEdges(this.inEdges);
    }

    /**
     * 供数据适配层调用的接口：处理单文件的节点和关系更新指令
     * @param payload 包含文件URI及其内部结构解析结果（节点与边）
     * @returns 返回受此文件变动影响需要重新解析的其他文件 URI 列表
     */
    public updateFileSymbols(payload: FileSymbolsPayload): string[] {
        const affectedReferencerUris = new Set<string>();
        const oldNodeIdsList = Array.from(this.fileNodes.get(payload.uri) || []);

        const newNodeIds = new Set(payload.nodes.map(n => n.id));

        // 1. 寻找受影响的引用者 (被删除的节点或新建节点的旧占位符)
        for (const oldId of oldNodeIdsList) {
            if (!newNodeIds.has(oldId)) {
                this._collectReferencerUris(oldId, affectedReferencerUris);
            }
        }
        for (const node of payload.nodes) {
            if (!oldNodeIdsList.includes(node.id)) {
                const existing = this.nodes.get(node.id);
                if (existing && existing.placeHolder) {
                    this._collectReferencerUris(node.id, affectedReferencerUris);
                }
            }
        }

        // 2. 清理当前文件的旧出边，连带清理目标节点对此源的入边表记录
        this._removeNodesAndEdges(oldNodeIdsList, newNodeIds);

        // 3. 重置并重新填充节点与边
        this.fileNodes.set(payload.uri, new Set());

        for (const node of payload.nodes) {
            this._addNode(node);
        }

        for (const edge of payload.edges) {
            this._addEdge(edge.sourceId, edge.targetId, edge.relation);
        }

        // 从受影响的列表中剔除自己
        affectedReferencerUris.delete(payload.uri);
        return Array.from(affectedReferencerUris);
    }

    /**
     * @returns 返回受此文件删除变动影响需要重新解析的关联文件 URI 列表
     */
    public deleteFileSymbols(uri: string): string[] {
        const affectedReferencerUris = new Set<string>();
        const oldNodeIdsList = Array.from(this.fileNodes.get(uri) || []);

        for (const oldId of oldNodeIdsList) {
            this._collectReferencerUris(oldId, affectedReferencerUris);
        }

        this._removeNodesAndEdges(oldNodeIdsList);
        this.fileNodes.delete(uri);
        affectedReferencerUris.delete(uri);

        return Array.from(affectedReferencerUris);
    }

    private _removeNodesAndEdges(nodeIdsToRemove: string[], retainedNodeIds?: Set<string>): void {
        for (const oldId of nodeIdsToRemove) {
            const outRels = this.outEdges.get(oldId);
            if (outRels) {
                for (const [rel, targets] of outRels.entries()) {
                    for (const targetId of targets) {
                        const targetInRels = this.inEdges.get(targetId);
                        if (targetInRels && targetInRels.has(rel)) {
                            targetInRels.get(rel)!.delete(oldId);
                        }
                    }
                }
                this.outEdges.delete(oldId);
            }

            // 清理不再需要保留的旧节点
            if (!retainedNodeIds || !retainedNodeIds.has(oldId)) {
                this.nodes.delete(oldId);
            }
        }
    }

    /**收集引用了指定节点的所有来源URI*/
    private _collectReferencerUris(nodeId: string, outSet: Set<string>): void {
        const inRels = this.inEdges.get(nodeId);
        if (inRels) {
            for (const [rel, sources] of inRels.entries()) {
                for (const sourceId of sources) {
                    const sourceNode = this.nodes.get(sourceId);
                    if (sourceNode && sourceNode.location && sourceNode.location.uri) {
                        outSet.add(sourceNode.location.uri);
                    }
                }
            }
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

        // 更新文件-节点映射
        if (!this.fileNodes.has(node.location.uri)) {
            this.fileNodes.set(node.location.uri, new Set());
        }
        this.fileNodes.get(node.location.uri)!.add(node.id);
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