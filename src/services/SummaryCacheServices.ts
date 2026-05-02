import { FunctionSummaryData } from '../models/GraphDefinition';
import { logger } from '../utils/logger';
import { SummaryIndexRecord, SummaryStorageService, SummaryStoredRecord } from './SummaryStorageServices';
import * as crypto from 'crypto';

export interface SummaryLookupRequest {
    nodeId: string;
    modelName?: string;
    promptVersion: string;
    currentBodyHash: string;
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

export class SummaryCacheService {
    private readonly bodyCache = new Map<string, string>();

    constructor(private readonly storage: SummaryStorageService) { }

    public async lookupFunctionSummary(request: SummaryLookupRequest): Promise<FunctionSummaryData | undefined> {
        const records = this.findMatchingRecords(request);
        const latest = records[0];
        if (!latest) {
            logger.info(`[SummaryCacheService] Cache miss: function=${request.nodeId}, model=${request.modelName || '*'}, prompt=${request.promptVersion}`);
            return undefined;
        }

        const loaded = await this.loadSummary(latest);
        logger.info(`[SummaryCacheService] Cache hit: function=${request.nodeId}, model=${latest.modelName}, stale=${latest.bodyHash !== request.currentBodyHash}, status=${loaded.cacheStatus}`);
        return this.toFunctionSummaryData(latest, loaded.summary, request.currentBodyHash, {
            cacheStatus: loaded.cacheStatus,
            historyIndex: 0,
            historyCount: records.length
        });
    }

    public async storeGeneratedFunctionSummary(record: GeneratedFunctionSummaryRecord): Promise<FunctionSummaryData> {
        const recordKey = this.createRecordKey(record);
        const stored: SummaryStoredRecord = {
            recordKey,
            targetKind: 'function',
            targetId: record.nodeId,
            label: record.label,
            modelName: record.modelName,
            modelId: record.modelId,
            promptVersion: record.promptVersion,
            bodyHash: record.bodyHash,
            generatedAt: record.generatedAt,
            summary: record.summary
        };

        await this.storage.writeRecord(stored);
        this.bodyCache.set(recordKey, record.summary);
        await this.pruneHistory(record.nodeId, record.modelName, record.promptVersion);
        logger.info(`[SummaryCacheService] Stored generated function summary: function=${record.nodeId}, model=${record.modelName}, bodyHash=${record.bodyHash.slice(0, 12)}, status=${record.cacheStatus || 'generated'}`);

        const history = this.findMatchingRecords({
            nodeId: record.nodeId,
            modelName: record.modelName,
            promptVersion: record.promptVersion,
            currentBodyHash: record.bodyHash
        });

        return {
            ...record,
            cacheStatus: record.cacheStatus || 'generated',
            stale: false,
            historyIndex: 0,
            historyCount: history.length
        };
    }

    public async getFunctionSummaryHistory(request: SummaryLookupRequest): Promise<SummaryHistoryResult> {
        const records = this.findMatchingRecords(request);
        logger.info(`[SummaryCacheService] Loading summary history: function=${request.nodeId}, model=${request.modelName || '*'}, count=${records.length}`);
        const summaries = await Promise.all(records.map(async (record, index) => {
            const loaded = await this.loadSummary(record);
            return this.toFunctionSummaryData(record, loaded.summary, request.currentBodyHash, {
                cacheStatus: loaded.cacheStatus,
                historyIndex: index,
                historyCount: records.length
            });
        }));

        return {
            nodeId: request.nodeId,
            records: summaries
        };
    }

    private findMatchingRecords(request: SummaryLookupRequest): SummaryIndexRecord[] {
        return this.storage.getIndexRecords('function', request.nodeId)
            .filter(record => (!request.modelName || record.modelName === request.modelName) && record.promptVersion === request.promptVersion)
            .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
    }

    private async loadSummary(record: SummaryIndexRecord): Promise<{ summary: string; cacheStatus: 'memory-hit' | 'index-disk-hit' }> {
        const cached = this.bodyCache.get(record.recordKey);
        if (cached !== undefined) {
            return {
                summary: cached,
                cacheStatus: 'memory-hit'
            };
        }

        const body = await this.storage.readBody(record.recordKey);
        this.bodyCache.set(record.recordKey, body.summary);
        return {
            summary: body.summary,
            cacheStatus: 'index-disk-hit'
        };
    }

    private toFunctionSummaryData(
        record: SummaryIndexRecord,
        summary: string,
        currentBodyHash: string,
        options: Pick<FunctionSummaryData, 'cacheStatus' | 'historyIndex' | 'historyCount'>
    ): FunctionSummaryData {
        return {
            nodeId: record.targetId,
            label: record.label,
            summary,
            modelName: record.modelName,
            modelId: record.modelId,
            generatedAt: record.generatedAt,
            bodyHash: record.bodyHash,
            promptVersion: record.promptVersion,
            stale: record.bodyHash !== currentBodyHash,
            ...options
        };
    }

    private createRecordKey(record: GeneratedFunctionSummaryRecord): string {
        const seed = [
            record.nodeId,
            record.modelName,
            record.promptVersion,
            record.generatedAt,
            Math.random().toString(36).slice(2)
        ].join('|');
        return crypto.createHash('sha256').update(seed, 'utf8').digest('hex');
    }

    private async pruneHistory(nodeId: string, modelName: string, promptVersion: string): Promise<void> {
        const records = this.storage.getIndexRecords('function', nodeId)
            .filter(record => record.modelName === modelName && record.promptVersion === promptVersion)
            .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
        const stale = records.slice(3);
        if (stale.length > 0) {
            stale.forEach(record => this.bodyCache.delete(record.recordKey));
            await this.storage.removeRecords(stale.map(record => record.recordKey));
        }
    }
}
