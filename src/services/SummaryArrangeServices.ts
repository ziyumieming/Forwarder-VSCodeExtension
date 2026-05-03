import { CallPathSummaryContext, CallPathSummaryResult, ClassSummaryData, FunctionSummaryData, GraphViewData } from '../models/GraphDefinition';
import { ProjectGraph } from '../models/GraphManager';
import { LLMPromptResult, LLMService } from './LLMServices';
import { LLMModelService } from './LLMModelServices';
import { SummaryCacheService } from './SummaryCacheServices';
import { FunctionSummaryContext, RelatedClassContext, SummaryContextService } from './SummaryContextServices';
import { SummaryJsonSchemaService } from './SummarySchemaServices';
import { SummaryQueueService } from './SummaryQueueServices';
import { logger } from '../utils/logger';
import { PromptLanguageService, SummaryLanguage } from './UiLanguageServices';
import { SummaryConfigService, SummaryRuntimeConfig } from './SummaryConfigServices';

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
    summaryLanguage?: SummaryLanguage;
    summaryConfig?: SummaryRuntimeConfig;
}

export interface FunctionSummaryBatchResult {
    generated: FunctionSummaryData[];
    missingNodeIds: string[];
    invalidNodeIds: string[];
    promptVersion: string;
    modelName: string;
    summaryLanguage: SummaryLanguage;
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

export class SummaryDependencySummaryError extends Error {
    constructor(
        public readonly targetId: string,
        public readonly missingNodeIds: string[],
        public readonly staleNodeIds: string[]
    ) {
        super(`Unable to prepare fresh function summaries for ${targetId}: missing=${missingNodeIds.length}, stale=${staleNodeIds.length}.`);
        this.name = 'SummaryDependencySummaryError';
    }
}

export class SummaryArrangeService {
    public static readonly FUNCTION_PROMPT_VERSION = 'function-summary:v1';
    public static readonly FUNCTION_BATCH_PROMPT_VERSION = 'function-summary-batch:v1';
    public static readonly CLASS_PROMPT_VERSION = 'class-summary:v1';
    public static readonly CLASS_RELATION_BRIEF_PROMPT_VERSION = 'class-relation-brief:v1';
    public static readonly CALL_PATH_PROMPT_VERSION = 'call-path-summary:v1';
    private static resolveSummaryLanguage(options: SummaryServiceOptions = {}): SummaryLanguage {
        return PromptLanguageService.normalize(options.summaryLanguage);
    }

    private static resolveSummaryConfig(options: SummaryServiceOptions = {}): SummaryRuntimeConfig {
        return options.summaryConfig || SummaryConfigService.DEFAULTS;
    }

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
        const summaryLanguage = this.resolveSummaryLanguage(options);

        const allowGenerate = options.allowGenerate !== false;

        logger.info(`[SummaryBackend] backend-cache-query nodeId=${context.nodeId}, label=${context.label}, language=${summaryLanguage}, model=${modelName}, selectedModelId=${modelId || '<fallback>'}, forceRefresh=${options.forceRefresh === true}, allowGenerate=${allowGenerate}, bodyHash=${context.bodyHash.slice(0, 12)}`);
        if (options.cacheService && (!options.forceRefresh || !allowGenerate)) {
            const cached = await options.cacheService.lookupFunctionSummary({
                nodeId: context.nodeId,
                modelName,
                promptVersion,
                summaryLanguage,
                currentBodyHash: context.bodyHash
            });
            if (cached) {
                logger.info(`[SummaryBackend] backend-cache-hit nodeId=${context.nodeId}, stale=${cached.stale === true}, status=${cached.cacheStatus}, allowGenerate=${allowGenerate}, summaryType=${typeof cached.summary}, summaryLength=${String(cached.summary || '').length}`);
                return cached;
            }
        }

        if (!allowGenerate) {
            logger.info(`[SummaryBackend] backend-cache-miss nodeId=${context.nodeId}, language=${summaryLanguage}, model=${modelName}, prompt=${promptVersion}, allowGenerate=false`);
            throw new SummaryCacheMissError(context.nodeId, modelName, promptVersion);
        }

        const queueKey = [
            'function',
            context.nodeId,
            modelName,
            summaryLanguage,
            context.bodyHash,
            options.forceRefresh === true ? 'force' : 'normal'
        ].join('|');

        const generate = async () => {
            logger.info(`[SummaryBackend] llm-generate-start nodeId=${context.nodeId}, language=${summaryLanguage}, model=${modelName}, selectedModelId=${modelId || '<fallback>'}, forceRefresh=${options.forceRefresh === true}`);
            const prompt = PromptLanguageService.buildFunctionSummaryPrompt(context, summaryLanguage);
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
                summaryLanguage,
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
                    summaryLanguage,
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
        const summaryConfig = this.resolveSummaryConfig(options);
        const context = await SummaryContextService.buildFunctionBatchContext(graph, nodeIds, summaryConfig.batch);
        const promptVersion = options.promptVersion || this.FUNCTION_BATCH_PROMPT_VERSION;
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        const modelId = selectedModel?.id;
        const summaryLanguage = this.resolveSummaryLanguage(options);
        const batchNodeIds = context.functions.map(fn => fn.nodeId);
        const excludedNodeIds = nodeIds.filter(nodeId => !batchNodeIds.includes(nodeId));

        if (context.functions.length === 0) {
            return {
                generated: [],
                missingNodeIds: Array.from(new Set(nodeIds)),
                invalidNodeIds: [],
                promptVersion,
                modelName,
                summaryLanguage
            };
        }

        const queueKey = [
            'function-batch',
            batchNodeIds.slice().sort().join(','),
            modelName,
            summaryLanguage,
            context.functions.map(fn => fn.bodyHash).sort().join(','),
            promptVersion
        ].join('|');

        const generate = async (): Promise<FunctionSummaryBatchResult> => {
            const prompt = PromptLanguageService.buildFunctionBatchSummaryPrompt(
                context,
                summaryLanguage,
                SummaryJsonSchemaService.getFunctionBatchSchemaPrompt()
            );
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
                    summaryLanguage,
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
                        summaryLanguage,
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
                modelName,
                summaryLanguage
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
        const summaryLanguage = this.resolveSummaryLanguage(options);
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
                summaryLanguage,
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
        const summaryLanguage = this.resolveSummaryLanguage(options);
        const context = await SummaryContextService.buildClassContext(graph, nodeId);
        const promptVersion = options.promptVersion || this.CLASS_RELATION_BRIEF_PROMPT_VERSION;

        if (options.cacheService && !options.forceRefresh) {
            const cached = await options.cacheService.lookupSummary({
                nodeId,
                targetKind: 'class',
                modelName,
                promptVersion,
                summaryLanguage,
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
            const prompt = PromptLanguageService.buildClassRelationBriefPrompt(context, summaryLanguage);
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
                summaryLanguage,
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
                    summaryLanguage,
                    bodyHash: context.ownContextHash
                }) as ClassSummaryData
                : generated;
        };

        const queueKey = ['class-brief', nodeId, modelName, summaryLanguage, context.ownContextHash, context.relationContextHash, promptVersion].join('|');
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
        const summaryLanguage = this.resolveSummaryLanguage(options);
        const baseContext = await SummaryContextService.buildClassContext(graph, nodeId);
        const methodSummaries = await this.ensureFreshFunctionSummariesForDependencies(
            graph,
            baseContext.methods.map(method => method.id),
            llmClient,
            options,
            nodeId
        );
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
                summaryLanguage,
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
            const prompt = PromptLanguageService.buildClassSummaryPrompt(context, summaryLanguage);
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
                summaryLanguage,
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
                    summaryLanguage,
                    bodyHash: context.ownContextHash,
                    relationContextHash: context.relationContextHash
                }) as ClassSummaryData
                : generated;
        };

        const queueKey = ['class-summary', nodeId, modelName, summaryLanguage, context.ownContextHash, context.relationContextHash, promptVersion].join('|');
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
        const summaryLanguage = this.resolveSummaryLanguage(options);
        const failure = PromptLanguageService.buildDeterministicCallPathFailure(graph, graphData, requestId, summaryLanguage);
        if (failure) {
            return failure;
        }

        const pathNodeIds = await this.collectCallPathFunctionNodeIds(graph, graphData, options.waypointIds || graphData.meta?.waypointIds || []);
        const summaries = await this.ensureFreshFunctionSummariesForDependencies(graph, pathNodeIds, llmClient, options, 'call-path');
        const context = await SummaryContextService.buildCallPathSummaryContext(graph, graphData, options.waypointIds, {
            functionSummaries: summaries,
            missingSummaryNodeIds: [],
            staleSummaryNodeIds: []
        });
        const prompt = PromptLanguageService.buildCallPathSummaryPrompt(context, summaryLanguage);
        const queueKey = [
            'call-path-summary',
            pathNodeIds.join(','),
            modelName,
            summaryLanguage,
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
                summaryLanguage,
                generatedAt: new Date().toISOString(),
                modelName,
                modelId: response.modelId || modelId,
                missingSummaryNodeIds: context.missingSummaryNodeIds,
                staleSummaryNodeIds: context.staleSummaryNodeIds
            };
        };

        return options.queueService ? options.queueService.enqueue(queueKey, generate) : generate();
    }

    private static async collectCallPathFunctionNodeIds(graph: ProjectGraph, graphData: GraphViewData, waypointIds: string[]): Promise<string[]> {
        const context = await SummaryContextService.buildCallPathSummaryContext(graph, graphData, waypointIds);
        return context.steps.map(step => step.nodeId);
    }

    private static async ensureFreshFunctionSummariesForDependencies(
        graph: ProjectGraph,
        nodeIds: string[],
        llmClient: SummaryLLMClient,
        options: SummaryServiceOptions,
        targetId: string
    ): Promise<Map<string, FunctionSummaryData>> {
        const uniqueNodeIds = Array.from(new Set(nodeIds));
        const dependencyResult = await this.ensureFunctionSummariesForDependencies(graph, uniqueNodeIds, llmClient, options);
        const summaries = new Map<string, FunctionSummaryData>();
        for (const summary of dependencyResult.summaries) {
            summaries.set(summary.nodeId, summary);
        }

        if (options.allowGenerate !== false && dependencyResult.staleNodeIds.length > 0) {
            const refreshed = await this.refreshStaleCallPathSummaries(graph, dependencyResult.staleNodeIds, llmClient, options);
            for (const summary of refreshed) {
                summaries.set(summary.nodeId, summary);
            }
        }

        const missingNodeIds = uniqueNodeIds.filter(nodeId => !summaries.has(nodeId));
        const staleNodeIds = uniqueNodeIds.filter(nodeId => summaries.get(nodeId)?.stale === true);
        if (missingNodeIds.length > 0 || staleNodeIds.length > 0) {
            throw new SummaryDependencySummaryError(targetId, missingNodeIds, staleNodeIds);
        }

        return summaries;
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
        const summaryConfig = this.resolveSummaryConfig(options);
        const selected = relatedClasses.slice(0, summaryConfig.classContext.relationBriefTopK);
        const selectedModel = options.modelService?.getSelectedModel();
        const modelName = options.modelService?.getSelectedModelName() || selectedModel?.id || 'default';
        const summaryLanguage = this.resolveSummaryLanguage(options);
        for (const related of selected) {
            const relatedContext = await SummaryContextService.buildClassContext(graph, related.nodeId);
            const existing = options.cacheService
                ? await options.cacheService.lookupSummary({
                    nodeId: related.nodeId,
                    targetKind: 'class',
                    modelName,
                    promptVersion: this.CLASS_RELATION_BRIEF_PROMPT_VERSION,
                    summaryLanguage,
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
}
