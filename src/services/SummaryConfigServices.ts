export interface SummaryFunctionBatchLimits {
    maxFunctions: number;
    maxFunctionLines: number;
    maxFunctionChars: number;
    maxTotalChars: number;
}

export interface SummaryRuntimeConfig {
    queue: {
        concurrency: number;
    };
    batch: SummaryFunctionBatchLimits;
    classContext: {
        relationBriefTopK: number;
    };
    history: {
        limit: number;
    };
    ui: {
        longPressMs: number;
        hoverDelayMs: number;
    };
}

export interface SummaryConfigurationSource {
    get<T>(key: string, defaultValue: T): T;
}

export class SummaryConfigService {
    public static readonly DEFAULTS: SummaryRuntimeConfig = {
        queue: {
            concurrency: 2
        },
        batch: {
            maxFunctions: 8,
            maxFunctionLines: 120,
            maxFunctionChars: 6000,
            maxTotalChars: 24000
        },
        classContext: {
            relationBriefTopK: 3
        },
        history: {
            limit: 3
        },
        ui: {
            longPressMs: 650,
            hoverDelayMs: 1000
        }
    };

    public static read(configuration: SummaryConfigurationSource): SummaryRuntimeConfig {
        return {
            queue: {
                concurrency: this.readInteger(configuration, 'summaryConcurrency', this.DEFAULTS.queue.concurrency, 1, 4)
            },
            batch: {
                maxFunctions: this.readInteger(configuration, 'functionBatchMaxFunctions', this.DEFAULTS.batch.maxFunctions, 1, 20),
                maxFunctionLines: this.readInteger(configuration, 'functionBatchMaxFunctionLines', this.DEFAULTS.batch.maxFunctionLines, 10, 500),
                maxFunctionChars: this.readInteger(configuration, 'functionBatchMaxFunctionChars', this.DEFAULTS.batch.maxFunctionChars, 500, 30000),
                maxTotalChars: this.readInteger(configuration, 'functionBatchMaxTotalChars', this.DEFAULTS.batch.maxTotalChars, 1000, 100000)
            },
            classContext: {
                relationBriefTopK: this.readInteger(configuration, 'classRelationBriefTopK', this.DEFAULTS.classContext.relationBriefTopK, 0, 10)
            },
            history: {
                limit: this.readInteger(configuration, 'summaryHistoryLimit', this.DEFAULTS.history.limit, 1, 10)
            },
            ui: {
                longPressMs: this.readInteger(configuration, 'longPressMs', this.DEFAULTS.ui.longPressMs, 250, 2000),
                hoverDelayMs: this.readInteger(configuration, 'summaryHoverDelayMs', this.DEFAULTS.ui.hoverDelayMs, 0, 5000)
            }
        };
    }

    private static readInteger(
        configuration: SummaryConfigurationSource,
        key: string,
        fallback: number,
        min: number,
        max: number
    ): number {
        const rawValue = configuration.get(key, fallback);
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, Math.round(numeric)));
    }
}
