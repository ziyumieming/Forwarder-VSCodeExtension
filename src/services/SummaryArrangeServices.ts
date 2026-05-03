import { CallPathSummaryContext, CallPathSummaryResult, ClassSummaryData, FunctionSummaryData, GraphViewData } from '../models/GraphDefinition';
import { ProjectGraph } from '../models/GraphManager';
import { LLMPromptResult, LLMService } from './LLMServices';
import { LLMModelService } from './LLMModelServices';
import { SummaryCacheService } from './SummaryCacheServices';
import { ClassSummaryContext, FunctionSummaryContext, RelatedClassContext, SummaryContextService } from './SummaryContextServices';
import { SummaryJsonSchemaService } from './SummarySchemaServices';
import { SummaryQueueService } from './SummaryQueueServices';
import { logger } from '../utils/logger';

export interface SummaryLLMClient {
    sendPrompt(prompt: string): Promise<LLMPromptResult>;
}

export interface SummaryServiceOptions {
    cacheService?: SummaryCacheService;
    queueService?: SummaryQueueService;
    modelService?: LLMModelService;
    forceRefresh?: boolean;
    allowGenerate?: boolean;
    promptVersion?: string;
}

export interface FunctionSummaryBatchResult {
    generated: FunctionSummaryData[];
    missingNodeIds: string[];
    invalidNodeIds: string[];
    promptVersion: string;
    modelName: string;
}

export interface FunctionSummaryDependencyResult {
    summaries: FunctionSummaryData[];
    missingNodeIds: string[];
    staleNodeIds: string[];
}

export interface CallPathSummaryOptions extends SummaryServiceOptions {
    requestId?: string;
    waypointIds?: string[];
}

export class SummaryCacheMissError extends Error {
    constructor(
        public readonly nodeId: string,
        public readonly modelName: string,
        public readonly promptVersion: string
    ) {
        super(`No cached summary found for ${nodeId}.`);
        this.name = 'SummaryCacheMissError';
    }
}

export class EmptySummaryError extends Error {
    constructor(
        public readonly nodeId: string,
        public readonly modelName: string,
        public readonly rawLength: number
    ) {
        super(`LLM returned an empty summary for ${nodeId}.`);
        this.name = 'EmptySummaryError';
    }
}

export class SummaryArrangeService {
    public static readonly FUNCTION_PROMPT_VERSION = 'function-summary:v1';
    public static readonly FUNCTION_BATCH_PROMPT_VERSION = 'function-summary-batch:v1';
    public static readonly CLASS_PROMPT_VERSION = 'class-summary:v1';
    public static readonly CLASS_RELATION_BRIEF_PROMPT_VERSION = 'class-relation-brief:v1';
    public static readonly CALL_PATH_PROMPT_VERSION = 'call-path-summary:v1';
    private static readonly MAX_RELATION_BRIEFS = 3;

    public static async summarizeFunction(
        graph: ProjectGraph,
        nodeId: string,
        llmClient: SummaryLLMClient = LLMService,
        options: SummaryServiceOptions = {}
    ): Promise<FunctionSummaryData> {
        const context = await SummaryContextService.buildFunctionContext(graph, nodeId);
        const promptVersion = options.promptVersion || this.FUNCTION_PROMPT_VERSION;
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        const modelId = selectedModel?.id;

        const allowGenerate = options.allowGenerate !== false;

        logger.info(`[SummaryBackend] backend-cache-query nodeId=${context.nodeId}, label=${context.label}, model=${modelName}, selectedModelId=${modelId || '<fallback>'}, forceRefresh=${options.forceRefresh === true}, allowGenerate=${allowGenerate}, bodyHash=${context.bodyHash.slice(0, 12)}`);
        if (options.cacheService && (!options.forceRefresh || !allowGenerate)) {
            const cached = await options.cacheService.lookupFunctionSummary({
                nodeId: context.nodeId,
                modelName,
                promptVersion,
                currentBodyHash: context.bodyHash
            });
            if (cached) {
                logger.info(`[SummaryBackend] backend-cache-hit nodeId=${context.nodeId}, stale=${cached.stale === true}, status=${cached.cacheStatus}, allowGenerate=${allowGenerate}, summaryType=${typeof cached.summary}, summaryLength=${String(cached.summary || '').length}`);
                return cached;
            }
        }

        if (!allowGenerate) {
            logger.info(`[SummaryBackend] backend-cache-miss nodeId=${context.nodeId}, model=${modelName}, prompt=${promptVersion}, allowGenerate=false`);
            throw new SummaryCacheMissError(context.nodeId, modelName, promptVersion);
        }

        const queueKey = [
            'function',
            context.nodeId,
            modelName,
            context.bodyHash,
            options.forceRefresh === true ? 'force' : 'normal'
        ].join('|');

        const generate = async () => {
            logger.info(`[SummaryBackend] llm-generate-start nodeId=${context.nodeId}, model=${modelName}, selectedModelId=${modelId || '<fallback>'}, forceRefresh=${options.forceRefresh === true}`);
            const prompt = this.buildFunctionSummaryPrompt(context);
            const response = selectedModel?.model
                ? await LLMService.sendPromptWithModel(selectedModel.model, prompt)
                : await llmClient.sendPrompt(prompt);
            const summaryText = String(response.text || '').trim();
            logger.info(`[SummaryBackend] llm-generate-response nodeId=${context.nodeId}, model=${modelName}, responseModelId=${response.modelId || '<none>'}, rawLength=${String(response.text || '').length}, trimmedLength=${summaryText.length}`);
            if (!summaryText) {
                logger.warn(`[SummaryBackend] llm-generate-empty nodeId=${context.nodeId}, model=${modelName}, responseModelId=${response.modelId || '<none>'}, rawLength=${String(response.text || '').length}`);
                throw new EmptySummaryError(context.nodeId, modelName, String(response.text || '').length);
            }

            const generated: FunctionSummaryData = {
                nodeId: context.nodeId,
                label: context.label,
                summary: summaryText,
                modelName,
                modelId: response.modelId || modelId,
                generatedAt: new Date().toISOString(),
                bodyHash: context.bodyHash,
                promptVersion,
                stale: false,
                cacheStatus: options.forceRefresh ? 'force-regenerated' : 'generated'
            };

            if (options.cacheService) {
                const stored = await options.cacheService.storeGeneratedFunctionSummary({
                    ...generated,
                    modelName,
                    modelId: generated.modelId,
                    promptVersion,
                    bodyHash: context.bodyHash
                });
                logger.info(`[SummaryBackend] llm-generate-done nodeId=${context.nodeId}, model=${modelName}, status=${stored.cacheStatus}, history=${stored.historyCount || 1}`);
                return stored;
            }

            logger.info(`[SummaryBackend] llm-generate-done nodeId=${context.nodeId}, model=${modelName}, status=${generated.cacheStatus}, persistent=false`);
            return generated;
        };

        return options.queueService
            ? options.queueService.enqueue(queueKey, generate)
            : generate();
    }

    public static async summarizeFunctionsBatch(
        graph: ProjectGraph,
        nodeIds: string[],
        llmClient: SummaryLLMClient = LLMService,
        options: SummaryServiceOptions = {}
    ): Promise<FunctionSummaryBatchResult> {
        const context = await SummaryContextService.buildFunctionBatchContext(graph, nodeIds);
        const promptVersion = options.promptVersion || this.FUNCTION_BATCH_PROMPT_VERSION;
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        const modelId = selectedModel?.id;
        const batchNodeIds = context.functions.map(fn => fn.nodeId);
        const excludedNodeIds = nodeIds.filter(nodeId => !batchNodeIds.includes(nodeId));

        if (context.functions.length === 0) {
            return {
                generated: [],
                missingNodeIds: Array.from(new Set(nodeIds)),
                invalidNodeIds: [],
                promptVersion,
                modelName
            };
        }

        const queueKey = [
            'function-batch',
            batchNodeIds.slice().sort().join(','),
            modelName,
            context.functions.map(fn => fn.bodyHash).sort().join(','),
            promptVersion
        ].join('|');

        const generate = async (): Promise<FunctionSummaryBatchResult> => {
            const prompt = this.buildFunctionBatchSummaryPrompt(context);
            const response = selectedModel?.model
                ? await LLMService.sendPromptWithModel(selectedModel.model, prompt)
                : await llmClient.sendPrompt(prompt);
            const parsed = SummaryJsonSchemaService.parseFunctionSummaryBatchResponse(
                response.text,
                new Set(batchNodeIds)
            );
            const generatedAt = new Date().toISOString();
            const contextByNodeId = new Map(context.functions.map(fn => [fn.nodeId, fn]));
            const generated: FunctionSummaryData[] = [];

            for (const item of parsed.summaries) {
                const fnContext = contextByNodeId.get(item.nodeId);
                if (!fnContext) {
                    continue;
                }

                const summary: FunctionSummaryData = {
                    nodeId: fnContext.nodeId,
                    label: fnContext.label,
                    summary: item.summary,
                    modelName,
                    modelId: response.modelId || modelId,
                    generatedAt,
                    bodyHash: fnContext.bodyHash,
                    promptVersion,
                    stale: false,
                    cacheStatus: options.forceRefresh ? 'force-regenerated' : 'generated'
                };
                generated.push(options.cacheService
                    ? await options.cacheService.storeGeneratedFunctionSummary({
                        ...summary,
                        modelName,
                        modelId: summary.modelId,
                        promptVersion,
                        bodyHash: fnContext.bodyHash
                    })
                    : summary);
            }

            for (const warning of parsed.warnings) {
                logger.warn(`[SummaryBackend] batch-json-warning ${warning}`);
            }

            return {
                generated,
                missingNodeIds: Array.from(new Set([...excludedNodeIds, ...parsed.missingNodeIds])),
                invalidNodeIds: parsed.invalidNodeIds,
                promptVersion,
                modelName
            };
        };

        return options.queueService
            ? options.queueService.enqueue(queueKey, generate)
            : generate();
    }

    public static async ensureFunctionSummariesForDependencies(
        graph: ProjectGraph,
        nodeIds: string[],
        llmClient: SummaryLLMClient = LLMService,
        options: SummaryServiceOptions = {}
    ): Promise<FunctionSummaryDependencyResult> {
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        const contexts = await Promise.all(Array.from(new Set(nodeIds)).map(async nodeId => {
            try {
                return await SummaryContextService.buildFunctionContext(graph, nodeId);
            } catch {
                return undefined;
            }
        }));
        const validContexts = contexts.filter((context): context is FunctionSummaryContext => context !== undefined);
        const invalidNodeIds = Array.from(new Set(nodeIds)).filter(nodeId => !validContexts.some(context => context.nodeId === nodeId));
        const summaries: FunctionSummaryData[] = [];
        const staleNodeIds: string[] = [];
        const missingNodeIds = new Set<string>(invalidNodeIds);

        if (options.cacheService) {
            const cached = await options.cacheService.lookupFunctionSummaries(validContexts.map(context => ({
                nodeId: context.nodeId,
                modelName,
                promptVersion: this.FUNCTION_BATCH_PROMPT_VERSION,
                fallbackPromptVersions: [this.FUNCTION_PROMPT_VERSION],
                currentBodyHash: context.bodyHash
            })));
            for (const context of validContexts) {
                const summary = cached.get(context.nodeId);
                if (summary) {
                    summaries.push(summary);
                    if (summary.stale) {
                        staleNodeIds.push(context.nodeId);
                    }
                } else {
                    missingNodeIds.add(context.nodeId);
                }
            }
        } else {
            for (const context of validContexts) {
                missingNodeIds.add(context.nodeId);
            }
        }

        if (options.allowGenerate === false || missingNodeIds.size === 0) {
            return {
                summaries,
                missingNodeIds: Array.from(missingNodeIds),
                staleNodeIds
            };
        }

        const missingByUri = new Map<string, string[]>();
        for (const nodeId of missingNodeIds) {
            const node = graph.getNode(nodeId);
            if (!node || (node.type !== 'function' && node.type !== 'method')) {
                continue;
            }
            const ids = missingByUri.get(node.location.uri) || [];
            ids.push(nodeId);
            missingByUri.set(node.location.uri, ids);
        }

        for (const ids of missingByUri.values()) {
            const batch = await this.summarizeFunctionsBatch(graph, ids, llmClient, {
                ...options,
                promptVersion: this.FUNCTION_BATCH_PROMPT_VERSION
            });
            for (const summary of batch.generated) {
                summaries.push(summary);
                missingNodeIds.delete(summary.nodeId);
            }
        }

        return {
            summaries,
            missingNodeIds: Array.from(missingNodeIds),
            staleNodeIds
        };
    }

    public static async summarizeClassRelationBrief(
        graph: ProjectGraph,
        nodeId: string,
        llmClient: SummaryLLMClient = LLMService,
        options: SummaryServiceOptions = {}
    ): Promise<ClassSummaryData> {
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        const modelId = selectedModel?.id;
        const context = await SummaryContextService.buildClassContext(graph, nodeId);
        const promptVersion = options.promptVersion || this.CLASS_RELATION_BRIEF_PROMPT_VERSION;

        if (options.cacheService && !options.forceRefresh) {
            const cached = await options.cacheService.lookupSummary({
                nodeId,
                targetKind: 'class',
                modelName,
                promptVersion,
                currentBodyHash: context.ownContextHash,
                currentRelationContextHash: context.relationContextHash
            });
            if (cached) {
                return cached as ClassSummaryData;
            }
        }

        if (options.allowGenerate === false) {
            throw new SummaryCacheMissError(nodeId, modelName, promptVersion);
        }

        const generate = async (): Promise<ClassSummaryData> => {
            const prompt = this.buildClassRelationBriefPrompt(context);
            const response = selectedModel?.model
                ? await LLMService.sendPromptWithModel(selectedModel.model, prompt)
                : await llmClient.sendPrompt(prompt);
            const summaryText = String(response.text || '').trim();
            if (!summaryText) {
                throw new EmptySummaryError(nodeId, modelName, 0);
            }
            const generated: ClassSummaryData = {
                nodeId,
                label: context.label,
                summary: summaryText,
                modelName,
                modelId: response.modelId || modelId,
                generatedAt: new Date().toISOString(),
                bodyHash: context.ownContextHash,
                relationContextHash: context.relationContextHash,
                promptVersion,
                stale: false,
                ownStale: false,
                relationContextStale: false,
                contextCoverage: context.contextCoverage,
                usedContextNodeIds: [],
                missingContextNodeIds: context.relatedClasses.map(related => related.nodeId),
                cacheStatus: options.forceRefresh ? 'force-regenerated' : 'generated'
            };
            return options.cacheService
                ? await options.cacheService.storeGeneratedSummary('class', {
                    ...generated,
                    modelName,
                    promptVersion,
                    bodyHash: context.ownContextHash
                }) as ClassSummaryData
                : generated;
        };

        const queueKey = ['class-brief', nodeId, modelName, context.ownContextHash, context.relationContextHash, promptVersion].join('|');
        return options.queueService ? options.queueService.enqueue(queueKey, generate) : generate();
    }

    public static async summarizeClass(
        graph: ProjectGraph,
        nodeId: string,
        llmClient: SummaryLLMClient = LLMService,
        options: SummaryServiceOptions = {}
    ): Promise<ClassSummaryData> {
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        const modelId = selectedModel?.id;
        const baseContext = await SummaryContextService.buildClassContext(graph, nodeId);
        const methodSummaryResult = await this.ensureFunctionSummariesForDependencies(
            graph,
            baseContext.methods.map(method => method.id),
            llmClient,
            options
        );
        const methodSummaries = new Map(methodSummaryResult.summaries.map(summary => [summary.nodeId, summary]));
        const contextWithMethods = await SummaryContextService.buildClassContext(graph, nodeId, { methodSummaries });
        const relatedBriefs = await this.ensureRelationBriefs(graph, contextWithMethods.relatedClasses, llmClient, options);
        const context = await SummaryContextService.buildClassContext(graph, nodeId, {
            methodSummaries,
            relatedBriefs
        });
        const promptVersion = options.promptVersion || this.CLASS_PROMPT_VERSION;

        if (options.cacheService && !options.forceRefresh) {
            const cached = await options.cacheService.lookupSummary({
                nodeId,
                targetKind: 'class',
                modelName,
                promptVersion,
                currentBodyHash: context.ownContextHash,
                currentRelationContextHash: context.relationContextHash
            });
            if (cached) {
                return cached as ClassSummaryData;
            }
        }

        if (options.allowGenerate === false) {
            throw new SummaryCacheMissError(nodeId, modelName, promptVersion);
        }

        const generate = async (): Promise<ClassSummaryData> => {
            const prompt = this.buildClassSummaryPrompt(context);
            const response = selectedModel?.model
                ? await LLMService.sendPromptWithModel(selectedModel.model, prompt)
                : await llmClient.sendPrompt(prompt);
            const summaryText = String(response.text || '').trim();
            if (!summaryText) {
                throw new EmptySummaryError(nodeId, modelName, 0);
            }
            const usedContextNodeIds = context.relatedClasses
                .filter(related => related.confidence !== 'name-only')
                .map(related => related.nodeId);
            const missingContextNodeIds = context.relatedClasses
                .filter(related => related.confidence === 'name-only')
                .map(related => related.nodeId);
            const generated: ClassSummaryData = {
                nodeId,
                label: context.label,
                summary: summaryText,
                modelName,
                modelId: response.modelId || modelId,
                generatedAt: new Date().toISOString(),
                bodyHash: context.ownContextHash,
                relationContextHash: context.relationContextHash,
                promptVersion,
                stale: false,
                ownStale: false,
                relationContextStale: false,
                contextCoverage: context.contextCoverage,
                usedContextNodeIds,
                missingContextNodeIds,
                cacheStatus: options.forceRefresh ? 'force-regenerated' : 'generated'
            };
            return options.cacheService
                ? await options.cacheService.storeGeneratedSummary('class', {
                    ...generated,
                    modelName,
                    promptVersion,
                    bodyHash: context.ownContextHash,
                    relationContextHash: context.relationContextHash
                }) as ClassSummaryData
                : generated;
        };

        const queueKey = ['class-summary', nodeId, modelName, context.ownContextHash, context.relationContextHash, promptVersion].join('|');
        return options.queueService ? options.queueService.enqueue(queueKey, generate) : generate();
    }

    public static async summarizeCallPath(
        graph: ProjectGraph,
        graphData: GraphViewData,
        llmClient: SummaryLLMClient = LLMService,
        options: CallPathSummaryOptions = {}
    ): Promise<CallPathSummaryResult> {
        const requestId = String(options.requestId || '');
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        const modelId = selectedModel?.id;
        const failure = this.buildDeterministicCallPathFailure(graph, graphData, requestId);
        if (failure) {
            return failure;
        }

        const pathNodeIds = await this.collectCallPathFunctionNodeIds(graph, graphData, options.waypointIds || graphData.meta?.waypointIds || []);
        const dependencyResult = await this.ensureFunctionSummariesForDependencies(graph, pathNodeIds, llmClient, options);
        const refreshedStale = options.allowGenerate !== false && dependencyResult.staleNodeIds.length > 0
            ? await this.refreshStaleCallPathSummaries(graph, dependencyResult.staleNodeIds, llmClient, options)
            : [];
        const summaries = new Map<string, FunctionSummaryData>();
        for (const summary of dependencyResult.summaries) {
            summaries.set(summary.nodeId, summary);
        }
        for (const summary of refreshedStale) {
            summaries.set(summary.nodeId, summary);
        }
        const context = await SummaryContextService.buildCallPathSummaryContext(graph, graphData, options.waypointIds, {
            functionSummaries: summaries,
            missingSummaryNodeIds: dependencyResult.missingNodeIds,
            staleSummaryNodeIds: dependencyResult.staleNodeIds.filter(nodeId => !summaries.has(nodeId) || summaries.get(nodeId)?.stale)
        });
        const prompt = this.buildCallPathSummaryPrompt(context);
        const queueKey = [
            'call-path-summary',
            pathNodeIds.join(','),
            modelName,
            context.steps.map(step => summaries.get(step.nodeId)?.bodyHash || 'missing').join(','),
            graphData.meta?.direction || 'outgoing',
            graphData.meta?.depth ?? graphData.edges.length
        ].join('|');

        const generate = async (): Promise<CallPathSummaryResult> => {
            const response = selectedModel?.model
                ? await LLMService.sendPromptWithModel(selectedModel.model, prompt)
                : await llmClient.sendPrompt(prompt);
            const summaryText = String(response.text || '').trim();
            if (!summaryText) {
                throw new EmptySummaryError('call-path', modelName, 0);
            }
            return {
                requestId,
                summary: summaryText,
                generatedAt: new Date().toISOString(),
                modelName,
                modelId: response.modelId || modelId,
                missingSummaryNodeIds: context.missingSummaryNodeIds,
                staleSummaryNodeIds: context.staleSummaryNodeIds
            };
        };

        return options.queueService ? options.queueService.enqueue(queueKey, generate) : generate();
    }

    public static buildFunctionSummaryPrompt(context: FunctionSummaryContext): string {
        return [
            '你是一个资深代码阅读助手。请根据给定函数/方法的签名和源码生成简洁 Markdown 摘要。',
            '',
            '要求：',
            '- 只分析当前函数/方法本身，不推测调用图、类层次或外部上下文。',
            '- 输出包含两个小节：`功能概述` 和 `关键行为`。',
            '- 语言简洁，避免复述每一行代码。',
            '',
            `函数名：${context.name}`,
            `签名：${context.signature}`,
            context.namespace ? `命名空间：${context.namespace}` : '',
            `文件：${context.fileName}`,
            `语言：${context.languageId}`,
            '',
            '源码：',
            '```' + this.markdownFenceLanguage(context.languageId),
            context.sourceCode,
            '```'
        ].filter(line => line !== '').join('\n');
    }

    public static buildFunctionBatchSummaryPrompt(context: Awaited<ReturnType<typeof SummaryContextService.buildFunctionBatchContext>>): string {
        const sections = context.functions.flatMap(fn => [
            `FUNCTION_NODE_ID: ${fn.nodeId}`,
            `FUNCTION_NAME: ${fn.name}`,
            `SIGNATURE: ${fn.signature}`,
            'SOURCE:',
            '```' + this.markdownFenceLanguage(fn.languageId),
            fn.sourceCode,
            '```',
            ''
        ]);

        return [
            'You are a senior code reading assistant. Generate concise Markdown summaries for the listed functions.',
            'Return only valid JSON matching this schema:',
            SummaryJsonSchemaService.getFunctionBatchSchemaPrompt(),
            '',
            'Rules:',
            '- Include exactly one object per function you can summarize.',
            '- Use the exact FUNCTION_NODE_ID as nodeId.',
            '- summary must be a non-empty concise Markdown string.',
            '- Do not add text outside JSON.',
            '',
            `File: ${context.fileName}`,
            `Language: ${context.languageId}`,
            '',
            ...sections
        ].join('\n');
    }

    public static buildClassRelationBriefPrompt(context: ClassSummaryContext): string {
        return [
            'Relation brief: summarize this class for use as context in another class summary.',
            'Return 1-3 concise sentences. Do not use Markdown headings.',
            '',
            `Class: ${context.name}`,
            context.namespace ? `Namespace: ${context.namespace}` : '',
            `File: ${context.fileName}`,
            '',
            'Fields:',
            ...context.fields.map(field => `- ${field.signature || [field.name, field.type].filter(Boolean).join(': ')}`),
            '',
            'Methods:',
            ...context.methods.map(method => `- ${method.signature || method.name}`),
            '',
            `Existing method summary coverage: ${context.contextCoverage.methodSummaryCount || 0}/${context.contextCoverage.methodCount || 0}`,
            '',
            'Related class names are low-confidence structure hints only:',
            ...context.relatedClasses.map(related => `- ${related.label} [${related.relationTypes.join(', ')}]`)
        ].filter(line => line !== '').join('\n');
    }

    public static buildClassSummaryPrompt(context: ClassSummaryContext): string {
        return [
            'You are a senior code reading assistant. Generate a class summary that explains the role of this class in the project.',
            '',
            'Output exactly these Markdown sections:',
            '### 职责定位',
            '### 核心状态',
            '### 主要行为',
            '### 协作关系',
            '',
            'Rules:',
            '- Field names are weak evidence. Use them with method summaries and typed relations.',
            '- Related classes without summaries are low-confidence structural hints only.',
            '- Do not invent internals for unsummarized related classes.',
            '',
            `Class: ${context.name}`,
            context.namespace ? `Namespace: ${context.namespace}` : '',
            `File: ${context.fileName}`,
            '',
            'Fields:',
            ...context.fields.map(field => `- ${field.signature || [field.name, field.type].filter(Boolean).join(': ')}`),
            '',
            'Methods and summaries:',
            ...context.methods.map(method => `- ${method.signature || method.name}${method.summary ? ` — ${method.summary}` : ' — no summary available'}`),
            '',
            'Related classes with summaries:',
            ...context.summarizedRelatedClasses.map(related => `- ${related.label} [${related.relationTypes.join(', ')}]: ${related.summary}`),
            '',
            'Related class briefs:',
            ...context.relationBriefs.map(related => `- ${related.label} [${related.relationTypes.join(', ')}]: ${related.brief}`),
            '',
            'Unsummarized related classes (low confidence names only):',
            ...context.unsummarizedRelatedClasses.map(related => `- ${related.label} [${related.relationTypes.join(', ')}]`)
        ].filter(line => line !== '').join('\n');
    }

    public static buildCallPathSummaryPrompt(context: CallPathSummaryContext): string {
        const segmentLines = context.segments && context.segments.length > 0
            ? context.segments.map((segment, index) => `- Segment ${index + 1}: ${segment.sourceLabel} -> ${segment.targetLabel}, found=${segment.pathFound}, depth=${segment.depth}${segment.reason ? `, reason=${segment.reason}` : ''}`)
            : [];
        return [
            'You are a senior code reading assistant. Explain the current shortest function call path.',
            '',
            'Output exactly these Markdown sections:',
            '### 调用链概览',
            '### 路径步骤',
            '### 关键传递',
            '',
            'Rules:',
            '- Explain only the returned shortest path; do not claim to cover all branches.',
            '- Do not mention raw node ids or edge objects.',
            '- If summaries are missing, say the explanation is based on signatures and path structure for those steps.',
            '- Do not output a separate notes/caveats section.',
            context.truncated ? '- The returned path is truncated by depth or node limits; mention that in the relevant section.' : '',
            '',
            `Waypoints: ${context.waypointLabels.join(' -> ') || 'not specified'}`,
            `Direction: ${context.direction || 'outgoing'}`,
            `Depth: ${context.depth ?? context.steps.length - 1}`,
            '',
            ...(segmentLines.length > 0 ? ['Segments:', ...segmentLines, ''] : []),
            'Path steps:',
            ...context.steps.map(step => [
                `${step.order}. ${step.label}`,
                step.signature ? `   Signature: ${step.signature}` : '',
                step.fileName ? `   File: ${step.fileName}` : '',
                step.summary ? `   Function summary: ${step.summary}` : '   Function summary: unavailable',
                step.stale ? '   Summary status: stale' : ''
            ].filter(Boolean).join('\n')),
            '',
            context.missingSummaryNodeIds.length > 0 ? `Missing function summaries: ${context.missingSummaryNodeIds.length}` : '',
            context.staleSummaryNodeIds.length > 0 ? `Stale function summaries: ${context.staleSummaryNodeIds.length}` : ''
        ].filter(line => line !== '').join('\n');
    }

    private static buildDeterministicCallPathFailure(graph: ProjectGraph, graphData: GraphViewData, requestId: string): CallPathSummaryResult | undefined {
        const failedSegment = graphData.meta?.segments?.find(segment => segment.pathFound === false);
        if (graphData.meta?.pathFound === true && !failedSegment) {
            return undefined;
        }
        const formatNode = (nodeId: string) => graph.getNode(nodeId)?.name || nodeId;
        const reason = failedSegment
            ? `Segment ${formatNode(failedSegment.sourceId)} -> ${formatNode(failedSegment.targetId)} failed${failedSegment.reason ? `: ${failedSegment.reason}` : '.'}`
            : graphData.meta?.reason || 'No call path was found for the selected waypoints.';
        return {
            requestId,
            summary: [
                '### 调用链概览',
                reason,
                '',
                '### 路径步骤',
                'No complete path is available.',
                '',
                '### 关键传递',
                'No end-to-end transfer can be explained because path calculation did not produce a complete route.'
            ].join('\n'),
            generatedAt: new Date().toISOString(),
            deterministic: true
        };
    }

    private static async collectCallPathFunctionNodeIds(graph: ProjectGraph, graphData: GraphViewData, waypointIds: string[]): Promise<string[]> {
        const context = await SummaryContextService.buildCallPathSummaryContext(graph, graphData, waypointIds);
        return context.steps.map(step => step.nodeId);
    }

    private static async refreshStaleCallPathSummaries(
        graph: ProjectGraph,
        staleNodeIds: string[],
        llmClient: SummaryLLMClient,
        options: SummaryServiceOptions
    ): Promise<FunctionSummaryData[]> {
        const refreshed: FunctionSummaryData[] = [];
        const staleByUri = new Map<string, string[]>();
        for (const nodeId of staleNodeIds) {
            const node = graph.getNode(nodeId);
            if (!node || (node.type !== 'function' && node.type !== 'method')) {
                continue;
            }
            const ids = staleByUri.get(node.location.uri) || [];
            ids.push(nodeId);
            staleByUri.set(node.location.uri, ids);
        }
        for (const ids of staleByUri.values()) {
            const batch = await this.summarizeFunctionsBatch(graph, ids, llmClient, {
                ...options,
                promptVersion: this.FUNCTION_BATCH_PROMPT_VERSION,
                forceRefresh: true
            });
            refreshed.push(...batch.generated);
        }
        return refreshed;
    }

    private static async ensureRelationBriefs(
        graph: ProjectGraph,
        relatedClasses: RelatedClassContext[],
        llmClient: SummaryLLMClient,
        options: SummaryServiceOptions
    ): Promise<Map<string, FunctionSummaryData>> {
        const briefs = new Map<string, FunctionSummaryData>();
        const selected = relatedClasses.slice(0, this.MAX_RELATION_BRIEFS);
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        for (const related of selected) {
            const relatedContext = await SummaryContextService.buildClassContext(graph, related.nodeId);
            const existing = options.cacheService
                ? await options.cacheService.lookupSummary({
                    nodeId: related.nodeId,
                    targetKind: 'class',
                    modelName,
                    promptVersion: this.CLASS_RELATION_BRIEF_PROMPT_VERSION,
                    fallbackPromptVersions: [this.CLASS_PROMPT_VERSION],
                    currentBodyHash: relatedContext.ownContextHash,
                    currentRelationContextHash: relatedContext.relationContextHash
                })
                : undefined;
            if (existing) {
                briefs.set(related.nodeId, existing);
                continue;
            }
            if (options.allowGenerate === false) {
                continue;
            }
            const brief = await this.summarizeClassRelationBrief(graph, related.nodeId, llmClient, {
                ...options,
                promptVersion: this.CLASS_RELATION_BRIEF_PROMPT_VERSION
            });
            briefs.set(related.nodeId, brief);
        }
        return briefs;
    }

    private static markdownFenceLanguage(languageId: string): string {
        const normalized = String(languageId || '').trim();
        if (normalized === 'typescriptreact') {
            return 'tsx';
        }
        if (normalized === 'javascriptreact') {
            return 'jsx';
        }
        return normalized;
    }
}
