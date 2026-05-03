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

    public static instruction(language: SummaryLanguage): string {
        if (language === 'en') {
            return 'Output language: English. Use English for every natural-language explanation, Markdown heading, and JSON summary field value.';
        }
        return '输出语言：简体中文。所有自然语言解释、Markdown 标题和 JSON summary 字段内容都必须使用简体中文。';
    }

    public static functionSections(language: SummaryLanguage): { overview: string; behavior: string } {
        return language === 'en'
            ? { overview: '### Overview', behavior: '### Key Behavior' }
            : { overview: '### 功能概述', behavior: '### 关键行为' };
    }

    public static classSections(language: SummaryLanguage): string[] {
        return language === 'en'
            ? ['### Role', '### Core State', '### Main Behavior', '### Collaboration']
            : ['### 职责定位', '### 核心状态', '### 主要行为', '### 协作关系'];
    }

    public static callPathSections(language: SummaryLanguage): { intent: string; steps: string } {
        return language === 'en'
            ? { intent: '### Execution Intent', steps: '### Path Steps' }
            : { intent: '### 执行意图', steps: '### 路径步骤' };
    }

    public static normalize(language: unknown): SummaryLanguage {
        return language === 'en' ? 'en' : 'zh-CN';
    }
}
