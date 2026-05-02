import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface SummaryIndexRecord {
    recordKey: string;
    targetKind: 'function' | 'method' | 'class' | 'path';
    targetId: string;
    label: string;
    modelName: string;
    modelId?: string;
    promptVersion: string;
    bodyHash: string;
    generatedAt: string;
}

export interface SummaryBodyRecord {
    summary: string;
}

export interface SummaryStoredRecord extends SummaryIndexRecord, SummaryBodyRecord { }

interface SummaryIndexFile {
    version: number;
    records: SummaryIndexRecord[];
}

export class SummaryStorageService {
    private readonly rootDir: string;
    private readonly indexPath: string;
    private readonly bodiesDir: string;
    private indexRecords: SummaryIndexRecord[] = [];
    private bodyReadCount = 0;

    constructor(storageDir: string) {
        this.rootDir = path.join(storageDir, 'summaries');
        this.indexPath = path.join(this.rootDir, 'summary_index.json');
        this.bodiesDir = path.join(this.rootDir, 'bodies');
    }

    public async initialize(): Promise<void> {
        await fs.promises.mkdir(this.bodiesDir, { recursive: true });
        if (!fs.existsSync(this.indexPath)) {
            this.indexRecords = [];
            await this.persistIndex();
            logger.info(`[SummaryStorageService] Initialized empty summary index: ${this.indexPath}`);
            return;
        }

        const raw = await fs.promises.readFile(this.indexPath, 'utf8');
        const parsed = JSON.parse(raw) as SummaryIndexFile;
        this.indexRecords = Array.isArray(parsed.records) ? parsed.records : [];
        logger.info(`[SummaryStorageService] Loaded summary index: ${this.indexPath}, records=${this.indexRecords.length}`);
    }

    public getIndexRecords(targetKind: SummaryIndexRecord['targetKind'], targetId: string): SummaryIndexRecord[] {
        return this.indexRecords
            .filter(record => record.targetKind === targetKind && record.targetId === targetId)
            .map(record => ({ ...record }));
    }

    public getAllIndexRecords(): SummaryIndexRecord[] {
        return this.indexRecords.map(record => ({ ...record }));
    }

    public async writeRecord(record: SummaryStoredRecord): Promise<void> {
        const indexRecord = this.toIndexRecord(record);
        const nextIndexRecords = this.indexRecords.filter(existing => existing.recordKey !== record.recordKey);
        nextIndexRecords.push(indexRecord);

        try {
            await fs.promises.mkdir(this.bodiesDir, { recursive: true });
            await fs.promises.writeFile(this.bodyPath(record.recordKey), JSON.stringify({
                summary: record.summary
            }, null, 2), 'utf8');
            this.indexRecords = nextIndexRecords;
            await this.persistIndex();
            logger.info(`[SummaryStorageService] Wrote summary record: key=${record.recordKey}, target=${record.targetKind}:${record.targetId}, model=${record.modelName}, index=${this.indexPath}`);
        } catch (error: any) {
            logger.error(`[SummaryStorageService] Failed to write summary record: key=${record.recordKey}, bodyPath=${this.bodyPath(record.recordKey)}, index=${this.indexPath}, error=${error?.message || error}`);
            throw error;
        }
    }

    public async removeRecords(recordKeys: string[]): Promise<void> {
        if (recordKeys.length === 0) {
            return;
        }

        const keySet = new Set(recordKeys);
        this.indexRecords = this.indexRecords.filter(record => !keySet.has(record.recordKey));
        await Promise.all(recordKeys.map(async key => {
            const bodyPath = this.bodyPath(key);
            try {
                if (fs.existsSync(bodyPath)) {
                    await fs.promises.unlink(bodyPath);
                }
            } catch (error: any) {
                if (error?.code !== 'ENOENT') {
                    logger.warn(`[SummaryStorageService] Failed to remove summary body: key=${key}, path=${bodyPath}, error=${error?.message || error}`);
                }
            }
        }));
        await this.persistIndex();
    }

    public async readBody(recordKey: string): Promise<SummaryBodyRecord> {
        this.bodyReadCount += 1;
        try {
            const raw = await fs.promises.readFile(this.bodyPath(recordKey), 'utf8');
            const parsed = JSON.parse(raw);
            logger.info(`[SummaryStorageService] Lazy-loaded summary body: key=${recordKey}, path=${this.bodyPath(recordKey)}`);
            return {
                summary: String(parsed.summary || '')
            };
        } catch (error: any) {
            logger.error(`[SummaryStorageService] Failed to read summary body: key=${recordKey}, path=${this.bodyPath(recordKey)}, error=${error?.message || error}`);
            throw error;
        }
    }

    public getBodyReadCount(): number {
        return this.bodyReadCount;
    }

    public getIndexPath(): string {
        return this.indexPath;
    }

    private toIndexRecord(record: SummaryStoredRecord): SummaryIndexRecord {
        return {
            recordKey: record.recordKey,
            targetKind: record.targetKind,
            targetId: record.targetId,
            label: record.label,
            modelName: record.modelName,
            modelId: record.modelId,
            promptVersion: record.promptVersion,
            bodyHash: record.bodyHash,
            generatedAt: record.generatedAt
        };
    }

    private bodyPath(recordKey: string): string {
        return path.join(this.bodiesDir, `${encodeURIComponent(recordKey)}.json`);
    }

    private async persistIndex(): Promise<void> {
        await fs.promises.mkdir(this.rootDir, { recursive: true });
        await fs.promises.writeFile(this.indexPath, JSON.stringify({
            version: 1,
            records: this.indexRecords
        }, null, 2), 'utf8');
    }
}
