import * as crypto from 'crypto';
import { ClassSummaryData, FunctionSummaryData, SummaryContextCoverage } from '../models/GraphDefinition';
import { logger } from '../utils/logger';
import { SummaryBodyRecord, SummaryStorageService, SummaryStoredRecord, SummaryTargetKind } from './SummaryStorageServices';
import { SummaryConfigService } from './SummaryConfigServices';
import { SummaryLanguage } from './UiLanguageServices';

export interface SummaryLookupRequest {
    nodeId: string;
    targetKind?: SummaryTargetKind;
    modelName?: string;
    promptVersion: string;
    summaryLanguage?: SummaryLanguage;
    currentBodyHash: string;
    currentRelationContextHash?: string;
    fallbackPromptVersions?: string[];
}

export interface SummaryHistoryResult {
    nodeId: string;
    records: FunctionSummaryData[];
}

export interface GeneratedFunctionSummaryRecord extends FunctionSummaryData {
    modelName: string;
    modelId?: string;
    promptVersion: string;
    bodyHash: string;
    summaryLanguage?: SummaryLanguage;
}

export interface GeneratedClassSummaryRecord extends ClassSummaryData {
    modelName: string;
    modelId?: string;
    promptVersion: string;
    bodyHash: string;
    summaryLanguage?: SummaryLanguage;
    relationContextHash?: string;
    contextCoverage?: SummaryContextCoverage;
    usedContextNodeIds?: string[];
    missingContextNodeIds?: string[];
}

export type GeneratedSummaryRecord = GeneratedFunctionSummaryRecord | GeneratedClassSummaryRecord;

export class SummaryCacheService {
    private readonly targetRecordCache = new Map<string, SummaryBodyRecord[]>();
    private readonly historyLimit: number;

    constructor(private readonly storage: SummaryStorageService, options: { historyLimit?: number } = {}) {
        const limit = Number(options.historyLimit);
        this.historyLimit = Number.isFinite(limit)
            ? Math.min(10, Math.max(1, Math.round(limit)))
            : SummaryConfigService.DEFAULTS.history.limit;
    }

    public async lookupFunctionSummary(request: SummaryLookupRequest): Promise<FunctionSummaryData | undefined> {
        const normalizedRequest = this.normalizeLookupRequest(request);
        const loaded = await this.findMatchingRecords(normalizedRequest);
        const records = loaded.records;
        for (const record of records) {
            if (!String(record.summary || '').trim()) {
                logger.warn(`[SummaryBackend] backend-cache-corrupt-empty-summary function=${normalizedRequest.nodeId}, language=${normalizedRequest.summaryLanguage}, model=${record.modelName}, recordKey=${record.recordKey}`);
                await this.removeRecordKeys(normalizedRequest.nodeId, [record.recordKey]);
                continue;
            }

            logger.info(`[SummaryBackend] backend-cache-hit function=${normalizedRequest.nodeId}, language=${normalizedRequest.summaryLanguage}, model=${record.modelName}, stale=${record.bodyHash !== normalizedRequest.currentBodyHash}, summaryType=${typeof record.summary}, summaryLength=${String(record.summary || '').length}`);
            return this.toSummaryData(normalizedRequest.nodeId, record, normalizedRequest.currentBodyHash, normalizedRequest.currentRelationContextHash, {
                cacheStatus: loaded.cacheStatus,
                historyIndex: 0,
                historyCount: records.length
            }) as FunctionSummaryData;
        }

        logger.info(`[SummaryBackend] backend-cache-miss function=${normalizedRequest.nodeId}, language=${normalizedRequest.summaryLanguage}, model=${normalizedRequest.modelName || '*'}, prompt=${normalizedRequest.promptVersion}`);
        return undefined;
    }

    public async lookupFunctionSummaries(requests: SummaryLookupRequest[]): Promise<Map<string, FunctionSummaryData>> {
        const results = new Map<string, FunctionSummaryData>();
        for (const request of requests) {
            const promptVersions = [request.promptVersion, ...(request.fallbackPromptVersions || [])];
            for (const promptVersion of promptVersions) {
                const found = await this.lookupFunctionSummary({
                    ...request,
                    promptVersion,
                    fallbackPromptVersions: undefined
                });
                if (found) {
                    results.set(request.nodeId, found);
                    break;
                }
            }
        }
        return results;
    }

    public async lookupSummary(request: SummaryLookupRequest): Promise<FunctionSummaryData | ClassSummaryData | undefined> {
        return this.lookupFunctionSummary(request);
    }

    public async storeGeneratedFunctionSummary(record: GeneratedFunctionSummaryRecord): Promise<FunctionSummaryData> {
        return this.storeGeneratedSummary('function', record) as Promise<FunctionSummaryData>;
    }

    public async storeGeneratedSummary(targetKind: SummaryTargetKind, record: GeneratedSummaryRecord): Promise<FunctionSummaryData | ClassSummaryData> {
        if (!String(record.summary || '').trim()) {
            logger.warn(`[SummaryBackend] llm-generate-empty-store-blocked target=${targetKind}:${record.nodeId}, model=${record.modelName}, status=${record.cacheStatus || 'generated'}`);
            throw new Error(`Refusing to store empty summary for ${record.nodeId}.`);
        }

        const summaryLanguage = record.summaryLanguage || 'zh-CN';
        const recordKey = this.createRecordKey(record);
        const stored: SummaryStoredRecord = {
            recordKey,
            targetKind,
            targetId: record.nodeId,
            label: record.label,
            modelName: record.modelName,
            promptVersion: record.promptVersion,
            summaryLanguage,
            bodyHash: record.bodyHash,
            generatedAt: record.generatedAt,
            summary: record.summary,
            relationContextHash: 'relationContextHash' in record ? record.relationContextHash : undefined,
            contextCoverage: 'contextCoverage' in record ? record.contextCoverage : undefined,
            usedContextNodeIds: 'usedContextNodeIds' in record ? record.usedContextNodeIds : undefined,
            missingContextNodeIds: 'missingContextNodeIds' in record ? record.missingContextNodeIds : undefined
        };

        await this.storage.writeRecord(stored);
        this.targetRecordCache.delete(this.cacheKey(record.nodeId, summaryLanguage));
        await this.pruneHistory(record.nodeId, record.modelName, record.promptVersion, summaryLanguage);
        logger.info(`[SummaryCacheService] Stored generated summary: target=${targetKind}:${record.nodeId}, language=${summaryLanguage}, model=${record.modelName}, bodyHash=${record.bodyHash.slice(0, 12)}, status=${record.cacheStatus || 'generated'}`);

        const history = await this.findMatchingRecords({
            nodeId: record.nodeId,
            modelName: record.modelName,
            promptVersion: record.promptVersion,
            summaryLanguage,
            currentBodyHash: record.bodyHash
        });

        return {
            ...(record as any),
            modelId: undefined,
            summaryLanguage,
            cacheStatus: record.cacheStatus || 'generated',
            stale: false,
            historyIndex: 0,
            historyCount: history.records.length
        } as FunctionSummaryData | ClassSummaryData;
    }

    public async getFunctionSummaryHistory(request: SummaryLookupRequest): Promise<SummaryHistoryResult> {
        const normalizedRequest = this.normalizeLookupRequest(request);
        const loaded = await this.findMatchingRecords(normalizedRequest);
        const records = loaded.records;
        logger.info(`[SummaryCacheService] Loading summary history: function=${normalizedRequest.nodeId}, language=${normalizedRequest.summaryLanguage}, model=${normalizedRequest.modelName || '*'}, count=${records.length}`);
        return {
            nodeId: normalizedRequest.nodeId,
            records: records.map((record, index) => this.toSummaryData(record.targetId || normalizedRequest.nodeId, record, normalizedRequest.currentBodyHash, normalizedRequest.currentRelationContextHash, {
                cacheStatus: loaded.cacheStatus,
                historyIndex: index,
                historyCount: records.length
            }) as FunctionSummaryData)
        };
    }

    public async removeSummariesForTargets(_targetKind: SummaryTargetKind, targetIds: string[]): Promise<{ removedRecords: number }> {
        const result = await this.storage.removeTargets(targetIds);
        for (const targetId of targetIds) {
            this.deleteCachedTarget(targetId);
        }
        return result;
    }

    public async renameTargets(idMap: Map<string, string>): Promise<{ renamedTargets: number; mergedRecords: number }> {
        const result = await this.storage.renameTargets(idMap);
        for (const [oldTargetId, newTargetId] of idMap.entries()) {
            this.deleteCachedTarget(oldTargetId);
            this.deleteCachedTarget(newTargetId);
        }

        for (const newTargetId of new Set(idMap.values())) {
            for (const summaryLanguage of ['en', 'zh-CN'] as SummaryLanguage[]) {
                const records = (await this.loadTargetRecords(newTargetId, summaryLanguage)).records;
                const groupedKeys = new Set(records.map(record => `${record.modelName}\u0000${record.promptVersion}`));
                for (const key of groupedKeys) {
                    const [modelName, promptVersion] = key.split('\u0000');
                    await this.pruneHistory(newTargetId, modelName, promptVersion, summaryLanguage);
                }
            }
        }

        return result;
    }

    private async findMatchingRecords(request: SummaryLookupRequest): Promise<{ records: Array<SummaryBodyRecord & { targetId?: string }>; cacheStatus: 'memory-hit' | 'index-disk-hit' }> {
        const normalizedRequest = this.normalizeLookupRequest(request);
        const loaded = await this.loadTargetRecords(normalizedRequest.nodeId, normalizedRequest.summaryLanguage);
        return {
            records: loaded.records
                .filter(record => record.summaryLanguage === normalizedRequest.summaryLanguage
                    && (!normalizedRequest.modelName || record.modelName === normalizedRequest.modelName)
                    && record.promptVersion === normalizedRequest.promptVersion)
                .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt)),
            cacheStatus: loaded.cacheStatus
        };
    }

    private async loadTargetRecords(targetId: string, summaryLanguage: SummaryLanguage): Promise<{ records: SummaryBodyRecord[]; cacheStatus: 'memory-hit' | 'index-disk-hit' }> {
        const key = this.cacheKey(targetId, summaryLanguage);
        const cached = this.targetRecordCache.get(key);
        if (cached) {
            return {
                records: cached.map(record => ({ ...record })),
                cacheStatus: 'memory-hit'
            };
        }

        try {
            const body = await this.storage.readTargetBody(targetId, summaryLanguage);
            this.targetRecordCache.set(key, body.records);
            return {
                records: body.records.map(record => ({ ...record })),
                cacheStatus: 'index-disk-hit'
            };
        } catch (error: any) {
            logger.warn(`[SummaryBackend] backend-cache-corrupt-missing-summary function=${targetId}, language=${summaryLanguage}, error=${error?.message || error}`);
            this.targetRecordCache.delete(key);
            await this.storage.removeBrokenTargetIndex(targetId, summaryLanguage);
            return {
                records: [],
                cacheStatus: 'index-disk-hit'
            };
        }
    }

    private async removeRecordKeys(targetId: string, recordKeys: string[]): Promise<void> {
        const keySet = new Set(recordKeys);
        for (const summaryLanguage of ['en', 'zh-CN'] as SummaryLanguage[]) {
            const records = (await this.loadTargetRecords(targetId, summaryLanguage)).records.filter(record => !keySet.has(record.recordKey));
            await this.storage.writeTargetBody(targetId, records, summaryLanguage);
            this.targetRecordCache.delete(this.cacheKey(targetId, summaryLanguage));
        }
    }

    private toSummaryData(
        targetId: string,
        record: SummaryBodyRecord,
        currentBodyHash: string,
        currentRelationContextHash: string | undefined,
        options: Pick<FunctionSummaryData, 'cacheStatus' | 'historyIndex' | 'historyCount'>
    ): FunctionSummaryData | ClassSummaryData {
        const ownStale = record.bodyHash !== currentBodyHash;
        const relationContextStale = record.relationContextHash !== undefined
            && currentRelationContextHash !== undefined
            && record.relationContextHash !== currentRelationContextHash;
        return {
            nodeId: targetId,
            label: record.label,
            summary: record.summary,
            summaryLanguage: record.summaryLanguage,
            modelName: record.modelName,
            generatedAt: record.generatedAt,
            bodyHash: record.bodyHash,
            promptVersion: record.promptVersion,
            stale: ownStale || relationContextStale,
            ownStale,
            relationContextStale,
            relationContextHash: record.relationContextHash,
            contextCoverage: record.contextCoverage,
            usedContextNodeIds: record.usedContextNodeIds,
            missingContextNodeIds: record.missingContextNodeIds,
            ...options
        };
    }

    private createRecordKey(record: GeneratedSummaryRecord): string {
        const seed = [
            record.modelName,
            record.promptVersion,
            record.summaryLanguage || 'zh-CN',
            record.bodyHash,
            record.generatedAt
        ].join('|');
        return crypto.createHash('sha256').update(seed, 'utf8').digest('hex');
    }

    private async pruneHistory(nodeId: string, modelName: string, promptVersion: string, summaryLanguage: SummaryLanguage): Promise<void> {
        const records = (await this.loadTargetRecords(nodeId, summaryLanguage)).records;
        const matching = records
            .filter(record => record.modelName === modelName
                && record.promptVersion === promptVersion
                && record.summaryLanguage === summaryLanguage)
            .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
        const staleKeys = new Set(matching.slice(this.historyLimit).map(record => record.recordKey));
        if (staleKeys.size === 0) {
            return;
        }

        await this.storage.writeTargetBody(nodeId, records.filter(record => !staleKeys.has(record.recordKey)), summaryLanguage);
        this.targetRecordCache.delete(this.cacheKey(nodeId, summaryLanguage));
    }

    private cacheKey(targetId: string, summaryLanguage: SummaryLanguage): string {
        return `${targetId}\u0000${summaryLanguage}`;
    }

    private deleteCachedTarget(targetId: string): void {
        for (const key of Array.from(this.targetRecordCache.keys())) {
            if (key === targetId || key.startsWith(`${targetId}\u0000`)) {
                this.targetRecordCache.delete(key);
            }
        }
    }

    private normalizeLookupRequest(request: SummaryLookupRequest): SummaryLookupRequest & { summaryLanguage: SummaryLanguage } {
        return {
            ...request,
            summaryLanguage: request.summaryLanguage || 'zh-CN'
        };
    }
}
