export interface FunctionSummaryBatchItem {
    nodeId: string;
    summary: string;
}

export interface FunctionSummaryBatchParseResult {
    summaries: FunctionSummaryBatchItem[];
    missingNodeIds: string[];
    invalidNodeIds: string[];
    warnings: string[];
}

export class SummaryJsonSchemaService {
    public static readonly FUNCTION_BATCH_SCHEMA = {
        type: 'object',
        required: ['summaries'],
        properties: {
            summaries: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['nodeId', 'summary'],
                    properties: {
                        nodeId: { type: 'string' },
                        summary: { type: 'string' }
                    }
                }
            }
        }
    };

    public static getFunctionBatchSchemaPrompt(): string {
        return JSON.stringify(this.FUNCTION_BATCH_SCHEMA, null, 2);
    }

    public static parseFunctionSummaryBatchResponse(rawText: string, expectedNodeIds: Set<string>): FunctionSummaryBatchParseResult {
        const warnings: string[] = [];
        const invalidNodeIds = new Set<string>();
        const summariesByNodeId = new Map<string, FunctionSummaryBatchItem>();
        const parsed = this.parseJsonObject(rawText);

        if (!parsed || !Array.isArray(parsed.summaries)) {
            return {
                summaries: [],
                missingNodeIds: Array.from(expectedNodeIds),
                invalidNodeIds: [],
                warnings: ['missing summaries array']
            };
        }

        for (const item of parsed.summaries) {
            const nodeId = String(item?.nodeId || '');
            const summary = String(item?.summary || '').trim();
            if (!expectedNodeIds.has(nodeId)) {
                if (nodeId) {
                    invalidNodeIds.add(nodeId);
                }
                continue;
            }
            if (!summary) {
                invalidNodeIds.add(nodeId);
                continue;
            }
            if (summariesByNodeId.has(nodeId)) {
                warnings.push(`duplicate nodeId ignored before last value: ${nodeId}`);
            }
            summariesByNodeId.set(nodeId, { nodeId, summary });
        }

        const missingNodeIds = Array.from(expectedNodeIds).filter(nodeId => !summariesByNodeId.has(nodeId));
        for (const nodeId of missingNodeIds) {
            if (invalidNodeIds.has(nodeId)) {
                continue;
            }
        }

        return {
            summaries: Array.from(summariesByNodeId.values()),
            missingNodeIds,
            invalidNodeIds: Array.from(invalidNodeIds),
            warnings
        };
    }

    private static parseJsonObject(rawText: string): any | undefined {
        const text = String(rawText || '').trim();
        if (!text) {
            return undefined;
        }

        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const jsonText = fenced ? fenced[1].trim() : text;
        try {
            return JSON.parse(jsonText);
        } catch {
            const start = jsonText.indexOf('{');
            const end = jsonText.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    return JSON.parse(jsonText.slice(start, end + 1));
                } catch {
                    return undefined;
                }
            }
        }
        return undefined;
    }
}
