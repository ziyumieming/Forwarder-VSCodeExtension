export type UiLanguageSetting = 'auto' | 'en' | 'zh-CN';
export type ResolvedUiLanguage = 'en' | 'zh-CN';

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
