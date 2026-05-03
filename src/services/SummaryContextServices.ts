import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { EdgeRelation, FunctionSummaryData, IRNode, SummaryContextCoverage } from '../models/GraphDefinition';
import { ProjectGraph } from '../models/GraphManager';
import { SourceLocationService } from './SourceLocationServices';

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

    public static async buildFunctionBatchContext(graph: ProjectGraph, nodeIds: string[]): Promise<FunctionBatchSummaryContext> {
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
            if (functions.length >= this.BATCH_MAX_FUNCTIONS) {
                continue;
            }

            const context = await this.buildFunctionContext(graph, nodeId);
            if (!context.sourceCode.trim()) {
                continue;
            }
            const lineCount = context.sourceCode.split(/\r?\n/).length;
            if (lineCount > this.BATCH_MAX_FUNCTION_LINES || context.sourceCode.length > this.BATCH_MAX_FUNCTION_CHARS) {
                continue;
            }
            if (totalChars + context.sourceCode.length > this.BATCH_MAX_TOTAL_CHARS) {
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
