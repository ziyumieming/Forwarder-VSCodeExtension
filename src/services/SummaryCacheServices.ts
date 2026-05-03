import * as crypto from 'crypto';
import { ClassSummaryData, FunctionSummaryData, SummaryContextCoverage } from '../models/GraphDefinition';
import { logger } from '../utils/logger';
import { SummaryBodyRecord, SummaryStorageService, SummaryStoredRecord, SummaryTargetKind } from './SummaryStorageServices';

export interface SummaryLookupRequest {
    nodeId: string;
    targetKind?: SummaryTargetKind;
    modelName?: string;
    promptVersion: string;
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
}

export interface GeneratedClassSummaryRecord extends ClassSummaryData {
    modelName: string;
    modelId?: string;
    promptVersion: string;
    bodyHash: string;
    relationContextHash?: string;
    contextCoverage?: SummaryContextCoverage;
    usedContextNodeIds?: string[];
    missingContextNodeIds?: string[];
}

export type GeneratedSummaryRecord = GeneratedFunctionSummaryRecord | GeneratedClassSummaryRecord;

export class SummaryCacheService {
    private readonly targetRecordCache = new Map<string, SummaryBodyRecord[]>();

    constructor(private readonly storage: SummaryStorageService) { }

    public async lookupFunctionSummary(request: SummaryLookupRequest): Promise<FunctionSummaryData | undefined> {
        const loaded = await this.findMatchingRecords(request);
        const records = loaded.records;
        for (const record of records) {
            if (!String(record.summary || '').trim()) {
                logger.warn(`[SummaryBackend] backend-cache-corrupt-empty-summary function=${request.nodeId}, model=${record.modelName}, recordKey=${record.recordKey}`);
                await this.removeRecordKeys(request.nodeId, [record.recordKey]);
                continue;
            }

            logger.info(`[SummaryBackend] backend-cache-hit function=${request.nodeId}, model=${record.modelName}, stale=${record.bodyHash !== request.currentBodyHash}, summaryType=${typeof record.summary}, summaryLength=${String(record.summary || '').length}`);
            return this.toSummaryData(request.nodeId, record, request.currentBodyHash, request.currentRelationContextHash, {
                cacheStatus: loaded.cacheStatus,
                historyIndex: 0,
                historyCount: records.length
            }) as FunctionSummaryData;
        }

        logger.info(`[SummaryBackend] backend-cache-miss function=${request.nodeId}, model=${request.modelName || '*'}, prompt=${request.promptVersion}`);
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

        const recordKey = this.createRecordKey(record);
        const stored: SummaryStoredRecord = {
            recordKey,
            targetKind,
            targetId: record.nodeId,
            label: record.label,
            modelName: record.modelName,
            promptVersion: record.promptVersion,
            bodyHash: record.bodyHash,
            generatedAt: record.generatedAt,
            summary: record.summary,
            relationContextHash: 'relationContextHash' in record ? record.relationContextHash : undefined,
            contextCoverage: 'contextCoverage' in record ? record.contextCoverage : undefined,
            usedContextNodeIds: 'usedContextNodeIds' in record ? record.usedContextNodeIds : undefined,
            missingContextNodeIds: 'missingContextNodeIds' in record ? record.missingContextNodeIds : undefined
        };

        await this.storage.writeRecord(stored);
        this.targetRecordCache.delete(record.nodeId);
        await this.pruneHistory(record.nodeId, record.modelName, record.promptVersion);
        logger.info(`[SummaryCacheService] Stored generated summary: target=${targetKind}:${record.nodeId}, model=${record.modelName}, bodyHash=${record.bodyHash.slice(0, 12)}, status=${record.cacheStatus || 'generated'}`);

        const history = await this.findMatchingRecords({
            nodeId: record.nodeId,
            modelName: record.modelName,
            promptVersion: record.promptVersion,
            currentBodyHash: record.bodyHash
        });

        return {
            ...(record as any),
            modelId: undefined,
            cacheStatus: record.cacheStatus || 'generated',
            stale: false,
            historyIndex: 0,
            historyCount: history.records.length
        } as FunctionSummaryData | ClassSummaryData;
    }

    public async getFunctionSummaryHistory(request: SummaryLookupRequest): Promise<SummaryHistoryResult> {
        const loaded = await this.findMatchingRecords(request);
        const records = loaded.records;
        logger.info(`[SummaryCacheService] Loading summary history: function=${request.nodeId}, model=${request.modelName || '*'}, count=${records.length}`);
        return {
            nodeId: request.nodeId,
            records: records.map((record, index) => this.toSummaryData(record.targetId || request.nodeId, record, request.currentBodyHash, request.currentRelationContextHash, {
                cacheStatus: loaded.cacheStatus,
                historyIndex: index,
                historyCount: records.length
            }) as FunctionSummaryData)
        };
    }

    public async removeSummariesForTargets(_targetKind: SummaryTargetKind, targetIds: string[]): Promise<{ removedRecords: number }> {
        const result = await this.storage.removeTargets(targetIds);
        for (const targetId of targetIds) {
            this.targetRecordCache.delete(targetId);
        }
        return result;
    }

    public async renameTargets(idMap: Map<string, string>): Promise<{ renamedTargets: number; mergedRecords: number }> {
        const result = await this.storage.renameTargets(idMap);
        for (const [oldTargetId, newTargetId] of idMap.entries()) {
            this.targetRecordCache.delete(oldTargetId);
            this.targetRecordCache.delete(newTargetId);
        }

        for (const newTargetId of new Set(idMap.values())) {
            const records = (await this.loadTargetRecords(newTargetId)).records;
            const groupedKeys = new Set(records.map(record => `${record.modelName}\u0000${record.promptVersion}`));
            for (const key of groupedKeys) {
                const [modelName, promptVersion] = key.split('\u0000');
                await this.pruneHistory(newTargetId, modelName, promptVersion);
            }
        }

        return result;
    }

    private async findMatchingRecords(request: SummaryLookupRequest): Promise<{ records: Array<SummaryBodyRecord & { targetId?: string }>; cacheStatus: 'memory-hit' | 'index-disk-hit' }> {
        const loaded = await this.loadTargetRecords(request.nodeId);
        return {
            records: loaded.records
                .filter(record => (!request.modelName || record.modelName === request.modelName) && record.promptVersion === request.promptVersion)
                .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt)),
            cacheStatus: loaded.cacheStatus
        };
    }

    private async loadTargetRecords(targetId: string): Promise<{ records: SummaryBodyRecord[]; cacheStatus: 'memory-hit' | 'index-disk-hit' }> {
        const cached = this.targetRecordCache.get(targetId);
        if (cached) {
            return {
                records: cached.map(record => ({ ...record })),
                cacheStatus: 'memory-hit'
            };
        }

        try {
            const body = await this.storage.readTargetBody(targetId);
            this.targetRecordCache.set(targetId, body.records);
            return {
                records: body.records.map(record => ({ ...record })),
                cacheStatus: 'index-disk-hit'
            };
        } catch (error: any) {
            logger.warn(`[SummaryBackend] backend-cache-corrupt-missing-summary function=${targetId}, error=${error?.message || error}`);
            this.targetRecordCache.delete(targetId);
            await this.storage.removeBrokenTargetIndex(targetId);
            return {
                records: [],
                cacheStatus: 'index-disk-hit'
            };
        }
    }

    private async removeRecordKeys(targetId: string, recordKeys: string[]): Promise<void> {
        const keySet = new Set(recordKeys);
        const records = (await this.loadTargetRecords(targetId)).records.filter(record => !keySet.has(record.recordKey));
        await this.storage.writeTargetBody(targetId, records);
        this.targetRecordCache.delete(targetId);
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
            record.bodyHash,
            record.generatedAt
        ].join('|');
        return crypto.createHash('sha256').update(seed, 'utf8').digest('hex');
    }

    private async pruneHistory(nodeId: string, modelName: string, promptVersion: string): Promise<void> {
        const records = (await this.loadTargetRecords(nodeId)).records;
        const matching = records
            .filter(record => record.modelName === modelName && record.promptVersion === promptVersion)
            .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
        const staleKeys = new Set(matching.slice(3).map(record => record.recordKey));
        if (staleKeys.size === 0) {
            return;
        }

        await this.storage.writeTargetBody(nodeId, records.filter(record => !staleKeys.has(record.recordKey)));
        this.targetRecordCache.delete(nodeId);
    }
}
