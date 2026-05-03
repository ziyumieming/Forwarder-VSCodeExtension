import type { CallPathSummaryContext, CallPathSummaryResult, GraphViewData } from '../models/GraphDefinition';
import type { ProjectGraph } from '../models/GraphManager';
import type { ClassSummaryContext, FunctionBatchSummaryContext, FunctionSummaryContext } from './SummaryContextServices';

export type UiLanguageSetting = 'auto' | 'en' | 'zh-CN';
export type ResolvedUiLanguage = 'en' | 'zh-CN';
export type SummaryLanguage = ResolvedUiLanguage;

export interface UiLanguageResolution {
    configuredLanguage: UiLanguageSetting;
    resolvedLanguage: ResolvedUiLanguage;
}

export class UiLanguageService {
    public static normalizeConfiguredLanguage(value: unknown): UiLanguageSetting {
        const normalized = String(value || 'auto').trim();
        if (normalized === 'en' || normalized === 'zh-CN' || normalized === 'auto') {
            return normalized;
        }
        return 'auto';
    }

    public static resolveLanguage(configuredValue: unknown, vscodeLanguage: string | undefined): UiLanguageResolution {
        const rawConfiguredLanguage = String(configuredValue || 'auto').trim();
        if (rawConfiguredLanguage && rawConfiguredLanguage !== 'auto' && rawConfiguredLanguage !== 'en' && rawConfiguredLanguage !== 'zh-CN') {
            return {
                configuredLanguage: 'auto',
                resolvedLanguage: 'en'
            };
        }

        const configuredLanguage = this.normalizeConfiguredLanguage(configuredValue);
        if (configuredLanguage === 'en' || configuredLanguage === 'zh-CN') {
            return {
                configuredLanguage,
                resolvedLanguage: configuredLanguage
            };
        }

        const normalizedLocale = String(vscodeLanguage || '').trim().toLowerCase();
        return {
            configuredLanguage,
            resolvedLanguage: normalizedLocale.startsWith('zh') ? 'zh-CN' : 'en'
        };
    }
}

export class PromptLanguageService {
    public static resolveSummaryLanguage(configuredValue: unknown, vscodeLanguage: string | undefined): SummaryLanguage {
        return UiLanguageService.resolveLanguage(configuredValue, vscodeLanguage).resolvedLanguage;
    }

    public static normalize(language: unknown): SummaryLanguage {
        return language === 'en' ? 'en' : 'zh-CN';
    }

    public static buildFunctionSummaryPrompt(context: FunctionSummaryContext, language: SummaryLanguage = 'zh-CN'): string {
        const fenceLanguage = this.markdownFenceLanguage(context.languageId);
        if (language === 'en') {
            return this.joinLines([
                'You are a senior code reading assistant. Generate a concise Markdown summary from the given function or method signature and source code.',
                '',
                'The summary must contain these two sections:',
                '### Overview',
                '### Key Behavior',
                '',
                'Reading guidance:',
                '- Use only the current function or method signature and source code to infer its responsibility.',
                '- Prefer summarizing control flow, state changes, return values, and key side effects. Avoid line-by-line narration.',
                '',
                `Function: ${context.name}`,
                `Signature: ${context.signature}`,
                context.namespace ? `Namespace: ${context.namespace}` : '',
                `File: ${context.fileName}`,
                `Code language: ${context.languageId}`,
                '',
                'Source:',
                '```' + fenceLanguage,
                context.sourceCode,
                '```'
            ]);
        }

        return this.joinLines([
            '你是资深代码阅读助手。请根据给定函数或方法的签名和源码生成简洁的 Markdown 摘要。',
            '',
            '摘要必须包含这两个小节：',
            '### 功能概述',
            '### 关键行为',
            '',
            '阅读依据：',
            '- 只使用当前函数或方法的签名与源码判断它的职责。',
            '- 优先概括控制流、状态变化、返回值和关键副作用，避免逐行复述。',
            '',
            `函数名：${context.name}`,
            `签名：${context.signature}`,
            context.namespace ? `命名空间：${context.namespace}` : '',
            `文件：${context.fileName}`,
            `代码语言：${context.languageId}`,
            '',
            '源码：',
            '```' + fenceLanguage,
            context.sourceCode,
            '```'
        ]);
    }

    public static buildFunctionBatchSummaryPrompt(
        context: FunctionBatchSummaryContext,
        language: SummaryLanguage = 'zh-CN',
        schemaPrompt: string
    ): string {
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

        if (language === 'en') {
            return [
                'You are a senior code reading assistant. Generate concise Markdown summaries for the listed functions.',
                'Return only valid JSON matching this schema:',
                schemaPrompt,
                '',
                'Extraction guidance:',
                '- Include exactly one object per function you can summarize.',
                '- Use the exact FUNCTION_NODE_ID as nodeId.',
                '- Make each summary a non-empty concise Markdown string focused on responsibility, control flow, state changes, and return value.',
                '- Do not add text outside JSON.',
                '',
                `File: ${context.fileName}`,
                `Language: ${context.languageId}`,
                '',
                ...sections
            ].join('\n');
        }

        return [
            '你是资深代码阅读助手。请为下面列出的函数生成简洁的 Markdown 摘要。',
            '只返回符合以下 schema 的有效 JSON：',
            schemaPrompt,
            '',
            '提取规则：',
            '- 对每个能够总结的函数恰好返回一个对象。',
            '- 使用准确的 FUNCTION_NODE_ID 作为 nodeId。',
            '- 每个 summary 必须是非空的简洁 Markdown 字符串，重点说明职责、控制流、状态变化和返回值。',
            '- 不要在 JSON 之外添加任何文本。',
            '',
            `文件：${context.fileName}`,
            `代码语言：${context.languageId}`,
            '',
            ...sections
        ].join('\n');
    }

    public static buildClassRelationBriefPrompt(context: ClassSummaryContext, language: SummaryLanguage = 'zh-CN'): string {
        if (language === 'en') {
            return this.joinLines([
                'Summarize this class briefly so another class summary can understand its likely collaboration role.',
                'Return 1-3 concise sentences. Do not use Markdown headings.',
                '',
                'Evidence guidance:',
                '- Method signatures and existing method summary coverage are the strongest local signals.',
                '- Fields describe likely state or dependencies, but their names are weaker evidence than method behavior.',
                '- Related class names only provide rough structural hints.',
                '',
                `Class: ${context.name}`,
                context.namespace ? `Namespace: ${context.namespace}` : '',
                `File: ${context.fileName}`,
                '',
                'Fields:',
                ...this.formatClassFields(context, 'en'),
                '',
                'Methods:',
                ...this.formatClassMethods(context, 'en', false),
                '',
                `Existing method summary coverage: ${context.contextCoverage.methodSummaryCount || 0}/${context.contextCoverage.methodCount || 0}`,
                '',
                'Related class names are low-confidence structure hints only:',
                ...this.formatRelatedClasses(context.relatedClasses, 'en')
            ]);
        }

        return this.joinLines([
            '请简要总结这个类，使其他类摘要能够理解它可能承担的协作角色。',
            '返回 1 到 3 个简洁句子。不要使用 Markdown 标题。',
            '',
            '证据使用规则：',
            '- 方法签名和已有方法摘要覆盖情况是最强的本地信号。',
            '- 字段可说明状态或依赖，但字段名的可信度弱于方法行为。',
            '- 相关类名称只提供粗略结构线索。',
            '',
            `类：${context.name}`,
            context.namespace ? `命名空间：${context.namespace}` : '',
            `文件：${context.fileName}`,
            '',
            '字段：',
            ...this.formatClassFields(context, 'zh-CN'),
            '',
            '方法：',
            ...this.formatClassMethods(context, 'zh-CN', false),
            '',
            `已有方法摘要覆盖：${context.contextCoverage.methodSummaryCount || 0}/${context.contextCoverage.methodCount || 0}`,
            '',
            '相关类名称仅作为低可信度结构线索：',
            ...this.formatRelatedClasses(context.relatedClasses, 'zh-CN')
        ]);
    }

    public static buildClassSummaryPrompt(context: ClassSummaryContext, language: SummaryLanguage = 'zh-CN'): string {
        if (language === 'en') {
            return this.joinLines([
                'You are a senior code reading assistant. Generate a class summary that explains the role of this class in the project.',
                '',
                'Output exactly these Markdown sections:',
                '### Role',
                '### Core State',
                '### Main Behavior',
                '### Collaboration',
                '',
                'Evidence guidance:',
                '- Use method summaries as the primary signal for behavior and responsibility.',
                '- Use fields as weaker evidence for state, dependencies, and configuration.',
                '- Use typed relations and related class summaries or briefs to explain collaboration.',
                '- Only explain key collaborations. Class names without summaries or briefs are low-confidence hints and should not be mentioned directly.',
                '',
                `Class: ${context.name}`,
                context.namespace ? `Namespace: ${context.namespace}` : '',
                `File: ${context.fileName}`,
                '',
                'Fields:',
                ...this.formatClassFields(context, 'en'),
                '',
                'Methods and summaries:',
                ...this.formatClassMethods(context, 'en', true),
                '',
                'Related classes with summaries:',
                ...this.formatRelatedClasses(context.summarizedRelatedClasses, 'en', true),
                '',
                'Related class briefs:',
                ...this.formatRelatedClasses(context.relationBriefs, 'en', true, 'brief'),
                '',
                'Unsummarized related classes (low confidence names only):',
                ...this.formatRelatedClasses(context.unsummarizedRelatedClasses, 'en')
            ]);
        }

        return this.joinLines([
            '你是资深代码阅读助手。请生成类摘要，说明这个类在项目中的职责。',
            '',
            '严格输出以下 Markdown 小节：',
            '### 职责定位',
            '### 核心状态',
            '### 主要行为',
            '### 协作关系',
            '',
            '证据使用规则：',
            '- 方法摘要是判断行为和职责的主要信号。',
            '- 字段是判断状态、依赖和配置的辅助信号。',
            '- 使用带类型的关系、相关类摘要或相关类简述解释协作关系。',
            '- 只解释关键协作。缺少摘要或简述的类名可信度较低，不要直接写入输出。',
            '',
            `类：${context.name}`,
            context.namespace ? `命名空间：${context.namespace}` : '',
            `文件：${context.fileName}`,
            '',
            '字段：',
            ...this.formatClassFields(context, 'zh-CN'),
            '',
            '方法及摘要：',
            ...this.formatClassMethods(context, 'zh-CN', true),
            '',
            '带摘要的相关类：',
            ...this.formatRelatedClasses(context.summarizedRelatedClasses, 'zh-CN', true),
            '',
            '相关类简述：',
            ...this.formatRelatedClasses(context.relationBriefs, 'zh-CN', true, 'brief'),
            '',
            '未总结的相关类（仅低可信度名称）：',
            ...this.formatRelatedClasses(context.unsummarizedRelatedClasses, 'zh-CN')
        ]);
    }

    public static buildCallPathSummaryPrompt(context: CallPathSummaryContext, language: SummaryLanguage = 'zh-CN'): string {
        const stepBlocks = this.formatCallPathSteps(context, language);
        if (language === 'en') {
            return this.joinLines([
                'You are a senior code reading assistant. Explain what the following function call path accomplishes semantically.',
                '',
                'Output two Markdown sections:',
                '### Execution Intent',
                '### Path Steps',
                '',
                'Reading guidance:',
                '- First use each function summary to infer whether the step is responsible for business behavior, control flow, or data processing.',
                '- Then use signatures, file names, and neighboring step names to infer how control, data, or state moves forward.',
                '- In "Execution Intent", summarize the action, trigger conditions, and key data or state propagation.',
                '- In "Path Steps", explain each function in order using its summary and signature.',
                '',
                'Call path steps:',
                ...stepBlocks
            ]);
        }

        return this.joinLines([
            '你是资深代码阅读助手。请解释下面这条函数调用链在语义上完成了什么。',
            '',
            '输出两个 Markdown 小节：',
            '### 执行意图',
            '### 路径步骤',
            '',
            '阅读依据：',
            '- 先根据每个函数摘要判断该步骤承担的是业务行为、控制流还是数据处理。',
            '- 再使用签名、文件名和相邻步骤名称辅助判断控制、数据或状态如何向下传递。',
            '- 在“执行意图”中概括整条链路试图完成的动作、触发条件，以及关键数据或状态如何传递。',
            '- 在“路径步骤”中结合函数摘要和签名按顺序解释每个函数的作用及其在链路中的位置。',
            '',
            '调用链步骤：',
            ...stepBlocks
        ]);
    }

    public static buildDeterministicCallPathFailure(
        graph: ProjectGraph,
        graphData: GraphViewData,
        requestId: string,
        language: SummaryLanguage
    ): CallPathSummaryResult | undefined {
        const failedSegment = graphData.meta?.segments?.find(segment => segment.pathFound === false);
        if (graphData.meta?.pathFound === true && !failedSegment) {
            return undefined;
        }

        const formatNode = (nodeId: string) => graph.getNode(nodeId)?.name || nodeId;
        const reason = failedSegment
            ? language === 'en'
                ? `Segment ${formatNode(failedSegment.sourceId)} -> ${formatNode(failedSegment.targetId)} failed${failedSegment.reason ? `: ${failedSegment.reason}` : '.'}`
                : `片段 ${formatNode(failedSegment.sourceId)} -> ${formatNode(failedSegment.targetId)} 未能连通${failedSegment.reason ? `：${failedSegment.reason}` : '。'}`
            : graphData.meta?.reason || (language === 'en'
                ? 'No call path was found for the selected waypoints.'
                : '没有找到所选途经点之间的完整调用链。');

        return {
            requestId,
            summary: language === 'en'
                ? ['### Execution Intent', reason, '', '### Path Steps', 'No complete path is available.'].join('\n')
                : ['### 执行意图', reason, '', '### 路径步骤', '没有可用的完整路径。'].join('\n'),
            summaryLanguage: language,
            generatedAt: new Date().toISOString(),
            deterministic: true
        };
    }

    private static joinLines(lines: string[]): string {
        return lines.filter(line => line !== '').join('\n');
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

    private static formatClassFields(context: ClassSummaryContext, language: SummaryLanguage): string[] {
        if (!context.fields.length) {
            return [language === 'en' ? '- None listed.' : '- 未列出。'];
        }
        return context.fields.map(field => `- ${field.signature || [field.name, field.type].filter(Boolean).join(': ')}`);
    }

    private static formatClassMethods(context: ClassSummaryContext, language: SummaryLanguage, includeSummary: boolean): string[] {
        if (!context.methods.length) {
            return [language === 'en' ? '- None listed.' : '- 未列出。'];
        }
        return context.methods.map(method => {
            const signature = method.signature || method.name;
            if (!includeSummary) {
                return `- ${signature}`;
            }
            return `- ${signature}: ${method.summary || (language === 'en' ? 'No summary available.' : '暂无摘要。')}`;
        });
    }

    private static formatRelatedClasses(
        relatedClasses: ClassSummaryContext['relatedClasses'],
        language: SummaryLanguage,
        includeSummary = false,
        summaryField: 'summary' | 'brief' = 'summary'
    ): string[] {
        if (!relatedClasses.length) {
            return [language === 'en' ? '- None listed.' : '- 未列出。'];
        }
        return relatedClasses.map(related => {
            const base = `- ${related.label} [${related.relationTypes.join(', ')}]`;
            const summary = summaryField === 'brief' ? related.brief : related.summary;
            return includeSummary ? `${base}: ${summary || ''}` : base;
        });
    }

    private static formatCallPathSteps(context: CallPathSummaryContext, language: SummaryLanguage): string[] {
        const waypointIds = new Set(context.waypointIds);
        return context.steps.map((step, index) => {
            const nextStep = context.steps[index + 1];
            if (language === 'en') {
                return [
                    `${step.order}. ${step.label}${waypointIds.has(step.nodeId) ? ' (user-selected waypoint)' : ''}`,
                    step.signature ? `   Signature: ${step.signature}` : '',
                    step.fileName ? `   File: ${step.fileName}` : '',
                    `   Function summary: ${step.summary || 'No summary available.'}`,
                    nextStep ? `   Next step connects to ${nextStep.label}` : '   End of path'
                ].filter(Boolean).join('\n');
            }
            return [
                `${step.order}. ${step.label}${waypointIds.has(step.nodeId) ? '（用户选中途经点）' : ''}`,
                step.signature ? `   签名：${step.signature}` : '',
                step.fileName ? `   文件：${step.fileName}` : '',
                `   函数摘要：${step.summary || '暂无摘要。'}`,
                nextStep ? `   下一步连接到 ${nextStep.label}` : '   链路终点'
            ].filter(Boolean).join('\n');
        });
    }
}
