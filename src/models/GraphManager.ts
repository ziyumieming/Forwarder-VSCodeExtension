import { IRNode, EdgeRelation, AdjacencyMap, EdgeData, FileSymbolsPayload, LineCol, NodeType } from "./GraphDefinition";
import { logger } from "../utils/logger";


export class ProjectGraph {
    // 节点池 (ID -> IRNode)
    public nodes: Map<string, IRNode> = new Map();

    // 出边表: sourceId -> (relation -> Set<targetId>)
    public outEdges: AdjacencyMap = new Map();

    // 入边表: targetId -> (relation -> Set<sourceId>)
    public inEdges: AdjacencyMap = new Map();

    // 文件到节点 ID 的映射: uri -> Set<nodeId>
    public fileNodes: Map<string, Set<string>> = new Map();

    // 文件结构特征指纹缓存: uri -> fingerprint
    public fileFingerprints: Map<string, string> = new Map();

    /**
     * 清空整张图（用于过滤规则改变或存储版本不匹配时的冷启动）
     */
    public clearAll(): void {
        this.nodes.clear();
        this.outEdges.clear();
        this.inEdges.clear();
        this.fileNodes.clear();
        this.fileFingerprints.clear();
    }

    /**
     * 供持久化模块调用的接口：重命名工作区文件，更新相关的节点及其边
     */
    public renameFile(oldUri: string, newUri: string): void {
        const nodeIds = this.fileNodes.get(oldUri);
        if (!nodeIds) { return; }

        const newNodesSet = new Set<string>();
        this.fileNodes.set(newUri, newNodesSet);

        // 迁移指纹
        const fp = this.fileFingerprints.get(oldUri);
        if (fp) {
            this.fileFingerprints.set(newUri, fp);
            this.fileFingerprints.delete(oldUri);
        }

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
     * 供数据适配层调用的接口：处理单文件的节点和关系更新指令 (支持 Delta Diff 与 Fingerprint)
     * @param payload 包含文件URI及其内部结构解析结果（节点与边）
     * @returns 返回受此文件变动影响需要重新解析的其他文件 URI 列表
     */
    public updateFileSymbols(payload: FileSymbolsPayload): string[] {
        //logger.info(`[ProjectGraph.updateFileSymbols] 开始更新文件 ${payload.uri}: ${payload.nodes.length} 个节点, ${payload.edges.length} 条边`);
        const edgesByRelation: { [key: string]: number } = {};
        for (const edge of payload.edges) {
            edgesByRelation[edge.relation] = (edgesByRelation[edge.relation] || 0) + 1;
        }
        //logger.info(`[ProjectGraph.updateFileSymbols] 输入payload中的边统计: ${JSON.stringify(edgesByRelation)}`);

        if (payload.unchanged && payload.fingerprint) {
            //logger.info(`[ProjectGraph.updateFileSymbols] 结构指纹未变，仅更新节点位置信息`);
            // 指纹未变，说明结构语义未变，只需要偷偷更新已有节点的物理位置 (location) 即可
            for (const n of payload.nodes) {
                const existing = this.nodes.get(n.id);
                // 仅更新属于本文件且非占位符的真实节点
                if (existing && !existing.placeHolder) {
                    existing.location = n.location;
                }
            }
            this.fileFingerprints.set(payload.uri, payload.fingerprint);
            return []; // 无任何边结构影响，返回空级联
        }

        const affectedReferencerUris = new Set<string>();
        const oldNodeIdsList = Array.from(this.fileNodes.get(payload.uri) || []);
        const newNodeIdsList = payload.nodes.map(n => n.id);
        const newNodeIdsSet = new Set(newNodeIdsList);

        // 1. 寻找被移除节点的影响引用者，并清理它们
        const removedNodeIds = oldNodeIdsList.filter(id => !newNodeIdsSet.has(id));
        //logger.info(`[ProjectGraph.updateFileSymbols] 移除节点数: ${removedNodeIds.length}`);
        for (const oldId of removedNodeIds) {
            this._collectReferencerUris(oldId, affectedReferencerUris);
        }
        if (removedNodeIds.length > 0) {
            this._removeNodesAndEdges(removedNodeIds);
            for (const id of removedNodeIds) {
                this.fileNodes.get(payload.uri)!.delete(id);
            }
        }

        // 2. 探查新建节点是否覆盖了旧的处于"占位符"状态的节点
        // 并添加/更新所有传入的新节点
        if (!this.fileNodes.has(payload.uri)) {
            this.fileNodes.set(payload.uri, new Set());
        }
        for (const node of payload.nodes) {
            const isNew = !oldNodeIdsList.includes(node.id);
            if (isNew) {
                const existing = this.nodes.get(node.id);
                if (existing && existing.placeHolder) {
                    this._collectReferencerUris(node.id, affectedReferencerUris);
                }
                this._addNode(node);
            } else {
                // 已经存在的节点，用最新 IR 完整覆盖。尤其要允许真实节点升级此前的占位节点。
                const existing = this.nodes.get(node.id);
                if (existing) {
                    if (!existing.placeHolder && node.placeHolder) {
                        continue;
                    }
                    this.nodes.set(node.id, {
                        ...existing,
                        ...node,
                        placeHolder: node.placeHolder === true,
                        isLibrary: node.isLibrary
                    });
                }
            }
        }

        // 3. Diff 同步此文件控制的出边关系 (仅比较包含的或者从此文件内节点发出的关系)
        // 关键：只对本文件定义的节点进行出边同步！占位节点不应由此文件管理其出边
        // payload.nodes 可能包含占位节点，但它们的出边应由其真实定义所在的文件管理
        const fileOwnedNodeIds = payload.nodes
            .filter(n => n.location.uri === payload.uri) // 只保留当前文件定义的节点
            .map(n => n.id);
        //logger.info(`[ProjectGraph.updateFileSymbols] 本文件拥有的节点数: ${fileOwnedNodeIds.length}，占位符节点数: ${payload.nodes.length - fileOwnedNodeIds.length}`);
        this._syncFileOutEdges(fileOwnedNodeIds, payload.edges);

        // 更新保存最新的文件指纹
        if (payload.fingerprint) {
            this.fileFingerprints.set(payload.uri, payload.fingerprint);
        }

        // 从受影响的列表中剔除自己
        affectedReferencerUris.delete(payload.uri);
        //logger.info(`[ProjectGraph.updateFileSymbols] 完成，受影响的关联文件: ${affectedReferencerUris.size} 个`);
        return Array.from(affectedReferencerUris);
    }

    /**
     * 将某个文件应该发出的最新边列表与当前图内旧边作 Diff，只增删有差异的部分
     * 关键前提：nodeIds 必须是当前文件拥有的节点（即 node.location.uri === file.uri）
     * 占位节点的出边不应由此文件管理，而由其真实定义所在的文件管理
     */
    private _syncFileOutEdges(nodeIds: string[], expectedEdges: EdgeData[]): void {
        //logger.info(`[ProjectGraph._syncFileOutEdges] 同步出边的文件拥有的节点数: ${nodeIds.length}, 期望边数: ${expectedEdges.length}`);
        const expectedByRelation: { [key: string]: number } = {};
        for (const e of expectedEdges) {
            expectedByRelation[e.relation] = (expectedByRelation[e.relation] || 0) + 1;
        }
        //logger.info(`[ProjectGraph._syncFileOutEdges] 期望边统计: ${JSON.stringify(expectedByRelation)}`);

        const expectedMap = new Map<string, Map<EdgeRelation, Set<string>>>();
        for (const edge of expectedEdges) {
            if (!expectedMap.has(edge.sourceId)) { expectedMap.set(edge.sourceId, new Map()); }
            const relMap = expectedMap.get(edge.sourceId)!;
            if (!relMap.has(edge.relation)) { relMap.set(edge.relation, new Set()); }
            relMap.get(edge.relation)!.add(edge.targetId);
        }

        let addedCount = 0;
        let removedCount = 0;
        const addedByRelation: { [key: string]: number } = {};
        const removedByRelation: { [key: string]: number } = {};

        for (const sourceId of nodeIds) {
            const expectedRels = expectedMap.get(sourceId);
            const currentRels = this.outEdges.get(sourceId);

            if (!expectedRels && !currentRels) { continue; }

            // Compute edges to remove
            if (currentRels) {
                for (const [rel, targets] of Array.from(currentRels.entries())) {
                    for (const targetId of Array.from(targets)) {
                        if (!expectedRels?.get(rel)?.has(targetId)) {
                            //logger.info(`[ProjectGraph._syncFileOutEdges] 移除边: ${rel}(${sourceId}→${targetId})`);
                            currentRels.get(rel)!.delete(targetId);
                            this.inEdges.get(targetId)?.get(rel)?.delete(sourceId);
                            removedCount++;
                            removedByRelation[rel] = (removedByRelation[rel] || 0) + 1;
                        }
                    }
                }
            }

            // Compute edges to add
            if (expectedRels) {
                for (const [rel, targets] of expectedRels.entries()) {
                    for (const targetId of targets) {
                        if (!currentRels?.get(rel)?.has(targetId)) {
                            //logger.info(`[ProjectGraph._syncFileOutEdges] 添加边: ${rel}(${sourceId}→${targetId})`);
                            this._addEdge(sourceId, targetId, rel);
                            addedCount++;
                            addedByRelation[rel] = (addedByRelation[rel] || 0) + 1;
                        }
                    }
                }
            }
        }

        //logger.info(`[ProjectGraph._syncFileOutEdges] 完成，添加${addedCount}条边，移除${removedCount}条边`);
        //logger.info(`[ProjectGraph._syncFileOutEdges] 添加的边统计: ${JSON.stringify(addedByRelation)}`);
        //logger.info(`[ProjectGraph._syncFileOutEdges] 移除的边统计: ${JSON.stringify(removedByRelation)}`);
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
        this.fileFingerprints.delete(uri);
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

    public getNodesForFile(uri: string, allowedTypes?: NodeType[]): IRNode[] {
        const allowedTypeSet = allowedTypes ? new Set(allowedTypes) : undefined;
        const result: IRNode[] = [];

        for (const nodeId of this.fileNodes.get(uri) || []) {
            const node = this.nodes.get(nodeId);
            if (!node || node.location.uri !== uri) {
                continue;
            }

            if (allowedTypeSet && !allowedTypeSet.has(node.type)) {
                continue;
            }

            result.push(node);
        }

        return result;
    }

    public getAllEdgesByRelations(relationsList: EdgeRelation[]): EdgeData[] {
        //logger.info(`[ProjectGraph.getAllEdgesByRelations] 查询关系 ${JSON.stringify(relationsList)}`);
        const edges: EdgeData[] = [];
        for (const [sourceId, relations] of this.outEdges.entries()) {
            for (const relation of relationsList) {
                const targetSet = relations.get(relation);
                if (targetSet) {
                    for (const targetId of targetSet) {
                        edges.push({ sourceId, targetId, relation });
                    }
                }
            }
        }
        //logger.info(`[ProjectGraph.getAllEdgesByRelations] 返回 ${edges.length} 条边`);

        // 统计各关系类型的边数
        const edgesByRelation: { [key: string]: number } = {};
        for (const edge of edges) {
            edgesByRelation[edge.relation] = (edgesByRelation[edge.relation] || 0) + 1;
        }
        //logger.info(`[ProjectGraph.getAllEdgesByRelations] 各关系类型统计: ${JSON.stringify(edgesByRelation)}`);

        return edges;
    }

    public getRelatedEdges(nodeId: string, allowedRelations?: EdgeRelation[]): EdgeData[] {
        //logger.info(`[ProjectGraph.getRelatedEdges] 查询节点 ${nodeId} 的关联边，allowedRelations=${JSON.stringify(allowedRelations)}`);
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

        // 统计各关系类型的边数
        const edgesByRelation: { [key: string]: number } = {};
        for (const edge of edges) {
            edgesByRelation[edge.relation] = (edgesByRelation[edge.relation] || 0) + 1;
        }
        //logger.info(`[ProjectGraph.getRelatedEdges] 返回 ${edges.length} 条边，各关系类型统计: ${JSON.stringify(edgesByRelation)}`);

        return edges;
    }

    public getEdges(nodeId: string, relation: EdgeRelation, direction: 'incoming' | 'outgoing' | 'both' = 'both'): EdgeData[] {
        const edges: EdgeData[] = [];

        if (direction === 'outgoing' || direction === 'both') {
            const targets = this.outEdges.get(nodeId)?.get(relation);
            if (targets) {
                for (const targetId of targets) {
                    edges.push({ sourceId: nodeId, targetId, relation });
                }
            }
        }

        if (direction === 'incoming' || direction === 'both') {
            const sources = this.inEdges.get(nodeId)?.get(relation);
            if (sources) {
                for (const sourceId of sources) {
                    edges.push({ sourceId, targetId: nodeId, relation });
                }
            }
        }

        return edges;
    }

    public getCallEdges(nodeId: string, direction: 'incoming' | 'outgoing' | 'both' = 'both'): EdgeData[] {
        return this.getEdges(nodeId, 'calls', direction);
    }

    public getContainingNodes(uri: string, position: LineCol, allowedTypes?: NodeType[]): IRNode[] {
        const result: IRNode[] = [];

        for (const node of this.getNodesForFile(uri, allowedTypes)) {
            if (this.containsPosition(node.location.range, position)) {
                result.push(node);
            }
        }

        return result.sort((left, right) => {
            const leftSpan = this.rangeSpan(left.location.range);
            const rightSpan = this.rangeSpan(right.location.range);
            if (leftSpan !== rightSpan) {
                return leftSpan - rightSpan;
            }

            return left.name.localeCompare(right.name);
        });
    }

    public getNodeAtLocation(uri: string, position: LineCol, allowedTypes: NodeType[] = ['function', 'method']): IRNode | undefined {
        return this.getContainingNodes(uri, position, allowedTypes)[0];
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

    private containsPosition(range: { start: LineCol; end: LineCol }, position: LineCol): boolean {
        const afterStart = position.line > range.start.line
            || (position.line === range.start.line && position.character >= range.start.character);
        const beforeEnd = position.line < range.end.line
            || (position.line === range.end.line && position.character <= range.end.character);
        return afterStart && beforeEnd;
    }

    private rangeSpan(range: { start: LineCol; end: LineCol }): number {
        return (range.end.line - range.start.line) * 100000
            + (range.end.character - range.start.character);
    }

    /**
     * 添加有向边（维护多维邻接表）
     */
    private _addEdge(sourceId: string, targetId: string, relation: EdgeRelation): void {
        //logger.info(`[ProjectGraph._addEdge] 添加边: ${relation}(${sourceId}→${targetId})`);
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
        //logger.info(`[ProjectGraph._addEdge] 边添加完成`);
    }
}
