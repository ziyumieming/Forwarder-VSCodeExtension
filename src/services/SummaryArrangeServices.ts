import { FunctionSummaryData } from '../models/GraphDefinition';
import { ProjectGraph } from '../models/GraphManager';
import { LLMPromptResult, LLMService } from './LLMServices';
import { LLMModelService } from './LLMModelServices';
import { SummaryCacheService } from './SummaryCacheServices';
import { FunctionSummaryContext, SummaryContextService } from './SummaryContextServices';
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
