import { FunctionSummaryData } from '../models/GraphDefinition';
import { ProjectGraph } from '../models/GraphManager';
import { LLMPromptResult, LLMService } from './LLMServices';
import { FunctionSummaryContext, SummaryContextService } from './SummaryContextServices';

export interface SummaryLLMClient {
    sendPrompt(prompt: string): Promise<LLMPromptResult>;
}

export class SummaryService {
    public static async summarizeFunction(
        graph: ProjectGraph,
        nodeId: string,
        llmClient: SummaryLLMClient = LLMService
    ): Promise<FunctionSummaryData> {
        const context = await SummaryContextService.buildFunctionContext(graph, nodeId);
        const prompt = this.buildFunctionSummaryPrompt(context);
        const response = await llmClient.sendPrompt(prompt);

        return {
            nodeId: context.nodeId,
            label: context.label,
            summary: response.text.trim(),
            modelId: response.modelId,
            generatedAt: new Date().toISOString()
        };
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
