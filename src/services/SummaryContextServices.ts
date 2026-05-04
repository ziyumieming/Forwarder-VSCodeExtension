import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CallPathSummaryContext, EdgeData, EdgeRelation, FunctionSummaryData, GraphViewData, IRNode, SummaryContextCoverage } from '../models/GraphDefinition';
import { ProjectGraph } from '../models/GraphManager';
import { SourceLocationService } from './SourceLocationServices';
import { SummaryConfigService, SummaryFunctionBatchLimits } from './SummaryConfigServices';

export interface FunctionSummaryContext {
    nodeId: string;
    label: string;
    name: string;
    signature: string;
    namespace?: string;
    fileName: string;
    languageId: string;
    sourceCode: string;
    bodyHash: string;
}

export interface FunctionBatchSummaryContext {
    fileUri: string;
    fileName: string;
    languageId: string;
    functions: FunctionSummaryContext[];
}

export interface ClassMethodSummaryContext {
    id: string;
    name: string;
    signature?: string;
    summary?: string;
    summaryBodyHash?: string;
    summaryPromptVersion?: string;
    summaryGeneratedAt?: string;
}

export interface RelatedClassContext {
    nodeId: string;
    label: string;
    relationTypes: EdgeRelation[];
    summary?: string;
    brief?: string;
    confidence: 'summary' | 'brief' | 'name-only';
}

export interface ClassSummaryContext {
    nodeId: string;
    label: string;
    name: string;
    namespace?: string;
    fileName: string;
    fileUri: string;
    languageId: string;
    fields: NonNullable<IRNode['fields']>;
    methods: ClassMethodSummaryContext[];
    relatedClasses: RelatedClassContext[];
    summarizedRelatedClasses: RelatedClassContext[];
    unsummarizedRelatedClasses: RelatedClassContext[];
    relationBriefs: RelatedClassContext[];
    ownContextHash: string;
    relationContextHash: string;
    contextCoverage: SummaryContextCoverage;
}

export class SummaryContextService {
    public static readonly BATCH_MAX_FUNCTIONS = 8;
    public static readonly BATCH_MAX_FUNCTION_LINES = 120;
    public static readonly BATCH_MAX_FUNCTION_CHARS = 6000;
    public static readonly BATCH_MAX_TOTAL_CHARS = 24000;

    public static async buildFunctionContext(graph: ProjectGraph, nodeId: string): Promise<FunctionSummaryContext> {
        const node = graph.getNode(nodeId);
        if (!node) {
            throw new Error(`Function node not found: ${nodeId}`);
        }

        if (node.type !== 'function' && node.type !== 'method') {
            throw new Error(`Summary target must be a function or method: ${nodeId}`);
        }

        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(node.location.uri));
        const sourceCode = document.getText(this.toVscodeRange(node.location.range)).trim();
        const signature = this.resolveSignature(node, sourceCode);

        return {
            nodeId: node.id,
            label: signature || node.name,
            name: node.name,
            signature,
            namespace: node.namespace,
            fileName: SourceLocationService.summarizeUri(node.location.uri),
            languageId: document.languageId,
            sourceCode,
            bodyHash: this.hashSource(sourceCode)
        };
    }

    public static async buildFunctionBatchContext(
        graph: ProjectGraph,
        nodeIds: string[],
        limits: SummaryFunctionBatchLimits = SummaryConfigService.DEFAULTS.batch
    ): Promise<FunctionBatchSummaryContext> {
        const functions: FunctionSummaryContext[] = [];
        let fileUri = '';
        let languageId = '';
        let totalChars = 0;

        for (const nodeId of nodeIds) {
            const node = graph.getNode(nodeId);
            if (!node || (node.type !== 'function' && node.type !== 'method') || node.isLibrary || node.placeHolder) {
                continue;
            }
            if (fileUri && node.location.uri !== fileUri) {
                continue;
            }
            if (functions.length >= limits.maxFunctions) {
                continue;
            }

            const context = await this.buildFunctionContext(graph, nodeId);
            if (!context.sourceCode.trim()) {
                continue;
            }
            const lineCount = context.sourceCode.split(/\r?\n/).length;
            if (lineCount > limits.maxFunctionLines || context.sourceCode.length > limits.maxFunctionChars) {
                continue;
            }
            if (totalChars + context.sourceCode.length > limits.maxTotalChars) {
                continue;
            }

            fileUri = node.location.uri;
            languageId = context.languageId;
            totalChars += context.sourceCode.length;
            functions.push(context);
        }

        return {
            fileUri,
            fileName: fileUri ? SourceLocationService.summarizeUri(fileUri) : '',
            languageId,
            functions
        };
    }

    public static async buildClassContext(
        graph: ProjectGraph,
        nodeId: string,
        options: {
            methodSummaries?: Map<string, FunctionSummaryData>;
            relatedSummaries?: Map<string, FunctionSummaryData>;
            relatedBriefs?: Map<string, FunctionSummaryData>;
        } = {}
    ): Promise<ClassSummaryContext> {
        const node = graph.getNode(nodeId);
        if (!node) {
            throw new Error(`Class node not found: ${nodeId}`);
        }
        if (node.type !== 'class' && node.type !== 'interface') {
            throw new Error(`Summary target must be a class or interface: ${nodeId}`);
        }

        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(node.location.uri));
        const methodNodes = this.getContainedMethods(graph, nodeId);
        const methods = methodNodes.map(method => {
            const summary = options.methodSummaries?.get(method.id);
            return {
                id: method.id,
                name: method.name,
                signature: method.signature,
                summary: summary?.summary,
                summaryBodyHash: summary?.bodyHash,
                summaryPromptVersion: summary?.promptVersion,
                summaryGeneratedAt: summary?.generatedAt
            };
        });
        const relatedClasses = this.getRelatedClasses(graph, nodeId, node.location.uri)
            .map(related => {
                const summary = options.relatedSummaries?.get(related.nodeId);
                const brief = options.relatedBriefs?.get(related.nodeId);
                return {
                    ...related,
                    summary: summary?.summary,
                    brief: brief?.summary,
                    confidence: summary ? 'summary' as const : brief ? 'brief' as const : 'name-only' as const
                };
            });
        const summarizedRelatedClasses = relatedClasses.filter(related => related.confidence === 'summary');
        const relationBriefs = relatedClasses.filter(related => related.confidence === 'brief');
        const unsummarizedRelatedClasses = relatedClasses.filter(related => related.confidence === 'name-only');
        const fields = node.fields || [];
        const ownDigest = {
            nodeId: node.id,
            name: node.name,
            namespace: node.namespace,
            fields: fields.map(field => ({
                name: field.name,
                type: field.type,
                signature: field.signature
            })),
            methods: methods.map(method => ({
                id: method.id,
                signature: method.signature,
                summaryBodyHash: method.summaryBodyHash,
                summaryPromptVersion: method.summaryPromptVersion,
                summaryGeneratedAt: method.summaryGeneratedAt
            }))
        };
        const relationDigest = relatedClasses.map(related => ({
            nodeId: related.nodeId,
            label: related.label,
            relationTypes: related.relationTypes,
            confidence: related.confidence,
            summary: related.summary,
            brief: related.brief
        }));

        return {
            nodeId: node.id,
            label: node.name,
            name: node.name,
            namespace: node.namespace,
            fileName: SourceLocationService.summarizeUri(node.location.uri),
            fileUri: node.location.uri,
            languageId: document.languageId,
            fields,
            methods,
            relatedClasses,
            summarizedRelatedClasses,
            unsummarizedRelatedClasses,
            relationBriefs,
            ownContextHash: this.hashSource(JSON.stringify(ownDigest)),
            relationContextHash: this.hashSource(JSON.stringify(relationDigest)),
            contextCoverage: {
                totalRelatedNodes: relatedClasses.length,
                summarizedRelatedNodes: summarizedRelatedClasses.length,
                briefRelatedNodes: relationBriefs.length,
                unsummarizedRelatedNodes: unsummarizedRelatedClasses.length,
                methodCount: methods.length,
                methodSummaryCount: methods.filter(method => !!method.summary).length
            }
        };
    }

    public static async buildCallPathSummaryContext(
        graph: ProjectGraph,
        graphData: GraphViewData,
        waypointIds: string[] = [],
        options: {
            functionSummaries?: Map<string, FunctionSummaryData>;
            missingSummaryNodeIds?: string[];
            staleSummaryNodeIds?: string[];
        } = {}
    ): Promise<CallPathSummaryContext> {
        const nodeMap = new Map(graphData.nodes.map(node => [node.id, node]));
        const normalizedWaypointIds = (waypointIds.length > 0 ? waypointIds : graphData.meta?.waypointIds || [])
            .map(id => String(id))
            .filter(id => id.length > 0);
        const pathNodeIds = this.orderCallPathNodeIds(graphData, normalizedWaypointIds);
        const steps = [];

        for (let index = 0; index < pathNodeIds.length; index += 1) {
            const nodeId = pathNodeIds[index];
            const node = nodeMap.get(nodeId) || graph.getNode(nodeId);
            if (!node || (node.type !== 'function' && node.type !== 'method')) {
                continue;
            }
            let signature = node.signature;
            let fileName = SourceLocationService.summarizeUri(node.location.uri);
            try {
                const context = await this.buildFunctionContext(graph, nodeId);
                signature = context.signature;
                fileName = context.fileName;
            } catch {
                // Use graph metadata when the source file is unavailable.
            }
            const summary = options.functionSummaries?.get(nodeId);
            steps.push({
                order: steps.length + 1,
                nodeId,
                label: node.name,
                signature,
                fileName,
                summary: summary?.summary,
                stale: summary?.stale === true
            });
        }

        const waypointLabels = normalizedWaypointIds.map(nodeId => {
            const node = nodeMap.get(nodeId) || graph.getNode(nodeId);
            return node?.name || nodeId;
        });

        return {
            waypointIds: normalizedWaypointIds,
            waypointLabels,
            steps,
            direction: graphData.meta?.direction,
            depth: graphData.meta?.depth,
            truncated: graphData.meta?.truncated === true,
            segments: graphData.meta?.segments?.map(segment => ({
                sourceLabel: (nodeMap.get(segment.sourceId) || graph.getNode(segment.sourceId))?.name || segment.sourceId,
                targetLabel: (nodeMap.get(segment.targetId) || graph.getNode(segment.targetId))?.name || segment.targetId,
                pathFound: segment.pathFound,
                depth: segment.depth,
                reason: segment.reason
            })),
            missingSummaryNodeIds: options.missingSummaryNodeIds || [],
            staleSummaryNodeIds: options.staleSummaryNodeIds || []
        };
    }

    private static orderCallPathNodeIds(graphData: GraphViewData, waypointIds: string[]): string[] {
        const nodes = graphData.nodes.filter(node => node.type === 'function' || node.type === 'method');
        const nodeIds = new Set(nodes.map(node => node.id));
        if (nodeIds.size === 0) {
            return [];
        }

        const direction = graphData.meta?.direction || 'outgoing';
        const starts = waypointIds.filter(id => nodeIds.has(id));
        const segments = graphData.meta?.segments || [];
        const ordered: string[] = [];
        const used = new Set<string>();

        const append = (id: string) => {
            if (nodeIds.has(id) && !used.has(id)) {
                ordered.push(id);
                used.add(id);
            }
        };

        if (segments.length > 0) {
            for (const segment of segments) {
                const segmentIds = this.walkCallPathSegment(graphData.edges, segment.sourceId, segment.targetId, direction, nodeIds);
                for (const id of segmentIds) {
                    append(id);
                }
            }
        } else if (starts.length >= 2) {
            const segmentIds = this.walkCallPathSegment(graphData.edges, starts[0], starts[starts.length - 1], direction, nodeIds);
            for (const id of segmentIds) {
                append(id);
            }
        } else if (starts.length === 1) {
            const segmentIds = this.walkCallPathSegment(graphData.edges, starts[0], undefined, direction, nodeIds);
            for (const id of segmentIds) {
                append(id);
            }
        }

        if (ordered.length === 0 && graphData.edges.length > 0) {
            const sourceCounts = new Map<string, number>();
            const targetCounts = new Map<string, number>();
            for (const edge of graphData.edges) {
                sourceCounts.set(edge.sourceId, (sourceCounts.get(edge.sourceId) || 0) + 1);
                targetCounts.set(edge.targetId, (targetCounts.get(edge.targetId) || 0) + 1);
            }
            const start = nodes.find(node => !targetCounts.has(node.id))?.id || nodes[0]?.id;
            if (start) {
                for (const id of this.walkCallPathSegment(graphData.edges, start, undefined, 'outgoing', nodeIds)) {
                    append(id);
                }
            }
        }

        for (const node of nodes) {
            append(node.id);
        }
        return ordered;
    }

    private static walkCallPathSegment(
        edges: EdgeData[],
        sourceId: string,
        targetId: string | undefined,
        direction: 'incoming' | 'outgoing' | 'both',
        allowedNodeIds: Set<string>
    ): string[] {
        if (!allowedNodeIds.has(sourceId)) {
            return [];
        }
        const result = [sourceId];
        const visited = new Set<string>([sourceId]);
        let cursor = sourceId;
        while (targetId ? cursor !== targetId : true) {
            const next = this.findNextCallPathNode(edges, cursor, direction, allowedNodeIds, visited);
            if (!next) {
                break;
            }
            result.push(next);
            visited.add(next);
            cursor = next;
        }
        return result;
    }

    private static findNextCallPathNode(
        edges: EdgeData[],
        currentId: string,
        direction: 'incoming' | 'outgoing' | 'both',
        allowedNodeIds: Set<string>,
        visited: Set<string>
    ): string | undefined {
        const candidates: string[] = [];
        for (const edge of edges) {
            if (direction !== 'incoming' && edge.sourceId === currentId && allowedNodeIds.has(edge.targetId)) {
                candidates.push(edge.targetId);
            }
            if (direction !== 'outgoing' && edge.targetId === currentId && allowedNodeIds.has(edge.sourceId)) {
                candidates.push(edge.sourceId);
            }
            if (direction === 'both') {
                if (edge.sourceId === currentId && allowedNodeIds.has(edge.targetId)) {
                    candidates.push(edge.targetId);
                }
                if (edge.targetId === currentId && allowedNodeIds.has(edge.sourceId)) {
                    candidates.push(edge.sourceId);
                }
            }
        }
        return candidates.find(id => !visited.has(id));
    }

    private static getContainedMethods(graph: ProjectGraph, nodeId: string): IRNode[] {
        const containsEdges = graph.getEdges(nodeId, 'contains', 'outgoing');
        return graph.getNodes(containsEdges.map(edge => edge.targetId))
            .filter(node => node.type === 'function' || node.type === 'method');
    }

    private static getRelatedClasses(graph: ProjectGraph, nodeId: string, fileUri: string): RelatedClassContext[] {
        const relationPriority: EdgeRelation[] = ['extends', 'implements', 'composes', 'aggregates', 'uses', 'calls'];
        const relationMap = new Map<string, Set<EdgeRelation>>();
        for (const relation of relationPriority) {
            for (const edge of graph.getEdges(nodeId, relation, 'both')) {
                const otherId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
                const other = graph.getNode(otherId);
                if (!other || other.id === nodeId || (other.type !== 'class' && other.type !== 'interface') || other.isLibrary || other.placeHolder) {
                    continue;
                }
                if (!relationMap.has(other.id)) {
                    relationMap.set(other.id, new Set());
                }
                relationMap.get(other.id)!.add(relation);
            }
        }

        return Array.from(relationMap.entries())
            .map(([relatedId, relations]) => {
                const related = graph.getNode(relatedId)!;
                return {
                    nodeId: related.id,
                    label: related.name,
                    relationTypes: relationPriority.filter(relation => relations.has(relation)),
                    confidence: 'name-only' as const,
                    sameFile: related.location.uri === fileUri
                };
            })
            .sort((left, right) => {
                const leftPriority = this.relationScore(left.relationTypes);
                const rightPriority = this.relationScore(right.relationTypes);
                if (leftPriority !== rightPriority) {
                    return rightPriority - leftPriority;
                }
                if ((left as any).sameFile !== (right as any).sameFile) {
                    return (left as any).sameFile ? -1 : 1;
                }
                return left.label.localeCompare(right.label);
            })
            .map(({ nodeId, label, relationTypes, confidence }) => ({ nodeId, label, relationTypes, confidence }));
    }

    private static relationScore(relations: EdgeRelation[]): number {
        if (relations.some(relation => relation === 'extends' || relation === 'implements')) {
            return 30;
        }
        if (relations.some(relation => relation === 'composes' || relation === 'aggregates')) {
            return 20;
        }
        if (relations.some(relation => relation === 'uses' || relation === 'calls')) {
            return 10;
        }
        return 0;
    }

    private static resolveSignature(node: IRNode, sourceCode: string): string {
        if (node.signature && node.signature.trim().length > 0) {
            return node.signature.trim();
        }

        const firstLine = sourceCode.split(/\r?\n/, 1)[0]?.trim();
        return firstLine && firstLine.length > 0 ? firstLine : node.name;
    }

    private static toVscodeRange(range: IRNode['location']['range']): vscode.Range {
        return new vscode.Range(
            new vscode.Position(range.start.line, range.start.character),
            new vscode.Position(range.end.line, range.end.character)
        );
    }

    private static hashSource(sourceCode: string): string {
        return crypto.createHash('sha256').update(sourceCode, 'utf8').digest('hex');
    }
}
