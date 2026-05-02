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
    promptVersion?: string;
}

export class SummaryService {
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

        logger.info(`[SummaryService] Function summary requested: nodeId=${context.nodeId}, label=${context.label}, model=${modelName}, selectedModelId=${modelId || '<fallback>'}, forceRefresh=${options.forceRefresh === true}, bodyHash=${context.bodyHash.slice(0, 12)}`);
        if (options.cacheService && !options.forceRefresh) {
            const cached = await options.cacheService.lookupFunctionSummary({
                nodeId: context.nodeId,
                modelName,
                promptVersion,
                currentBodyHash: context.bodyHash
            });
            if (cached) {
                logger.info(`[SummaryService] Returning cached function summary: nodeId=${context.nodeId}, stale=${cached.stale === true}, status=${cached.cacheStatus}`);
                return cached;
            }
        }

        const queueKey = [
            'function',
            context.nodeId,
            modelName,
            context.bodyHash,
            options.forceRefresh === true ? 'force' : 'normal'
        ].join('|');

        const generate = async () => {
            logger.info(`[SummaryService] Generating function summary via LLM: nodeId=${context.nodeId}, model=${modelName}, selectedModelId=${modelId || '<fallback>'}`);
            const prompt = this.buildFunctionSummaryPrompt(context);
            const response = selectedModel?.model
                ? await LLMService.sendPromptWithModel(selectedModel.model, prompt)
                : await llmClient.sendPrompt(prompt);

            const generated: FunctionSummaryData = {
                nodeId: context.nodeId,
                label: context.label,
                summary: response.text.trim(),
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
                logger.info(`[SummaryService] Generated function summary stored: nodeId=${context.nodeId}, model=${modelName}, status=${stored.cacheStatus}, history=${stored.historyCount || 1}`);
                return stored;
            }

            logger.info(`[SummaryService] Generated function summary without persistent cache: nodeId=${context.nodeId}, model=${modelName}`);
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
