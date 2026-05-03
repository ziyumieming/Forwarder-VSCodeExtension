import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { SummaryLanguage } from './UiLanguageServices';

export type SummaryTargetKind = 'function' | 'method' | 'class' | 'path';

export interface SummaryIndexRecord {
    recordKey: string;
    targetKind?: SummaryTargetKind;
    targetId: string;
    label: string;
    modelName: string;
    modelId?: string;
    promptVersion: string;
    summaryLanguage?: SummaryLanguage;
    bodyHash: string;
    generatedAt: string;
    relationContextHash?: string;
    contextCoverage?: any;
    usedContextNodeIds?: string[];
    missingContextNodeIds?: string[];
}

export interface SummaryBodyRecord {
    recordKey: string;
    label: string;
    modelName: string;
    promptVersion: string;
    summaryLanguage?: SummaryLanguage;
    bodyHash: string;
    generatedAt: string;
    summary: string;
    relationContextHash?: string;
    contextCoverage?: any;
    usedContextNodeIds?: string[];
    missingContextNodeIds?: string[];
}

export interface SummaryTargetBody {
    targetId: string;
    records: SummaryBodyRecord[];
}

export interface SummaryStoredRecord extends SummaryIndexRecord {
    summary: string;
}

export interface SummaryTargetIndexRecord {
    targetId: string;
    summaryLanguage?: SummaryLanguage;
    bodyKey: string;
    updatedAt: string;
    recordCount: number;
}

interface SummaryIndexFile {
    version: number;
    targets?: SummaryTargetIndexRecord[];
}

export class SummaryStorageService {
    private readonly rootDir: string;
    private readonly indexPath: string;
    private readonly bodiesDir: string;
    private targetIndex: SummaryTargetIndexRecord[] = [];
    private bodyReadCount = 0;

    constructor(storageDir: string) {
        this.rootDir = path.join(storageDir, 'summaries');
        this.indexPath = path.join(this.rootDir, 'summary_index.json');
        this.bodiesDir = path.join(this.rootDir, 'bodies');
    }

    public async initialize(): Promise<void> {
        await fs.promises.mkdir(this.bodiesDir, { recursive: true });
        if (!fs.existsSync(this.indexPath)) {
            this.targetIndex = [];
            await this.persistIndex();
            await this.cleanupOrphanBodies();
            logger.info(`[SummaryStorageService] Initialized empty summary index: ${this.indexPath}`);
            return;
        }

        const raw = await fs.promises.readFile(this.indexPath, 'utf8');
        const parsed = JSON.parse(raw) as SummaryIndexFile;
        this.targetIndex = (parsed.version === 2 || parsed.version === 3) && Array.isArray(parsed.targets)
            ? parsed.targets.map(record => ({
                ...record,
                summaryLanguage: this.normalizeSummaryLanguage(record.summaryLanguage)
            }))
            : [];
        await this.cleanupOrphanBodies();
        logger.info(`[SummaryStorageService] Loaded summary index: ${this.indexPath}, targets=${this.targetIndex.length}`);
    }

    public getIndexRecords(_targetKind: SummaryTargetKind, targetId: string, summaryLanguage?: SummaryLanguage): SummaryIndexRecord[] {
        const bodies = summaryLanguage
            ? [this.readTargetBodySync(targetId, summaryLanguage)]
            : this.findTargets(targetId).map(target => this.readTargetBodySync(targetId, target.summaryLanguage));
        return bodies.flatMap(body => body.records.map(record => this.toIndexRecord(targetId, record)));
    }

    public getAllIndexRecords(): SummaryTargetIndexRecord[] {
        return this.targetIndex.map(record => ({ ...record }));
    }

    public async readTargetBody(targetId: string, summaryLanguage?: SummaryLanguage): Promise<SummaryTargetBody> {
        this.bodyReadCount += 1;
        if (!summaryLanguage) {
            const targets = this.findTargets(targetId);
            if (targets.length === 0) {
                return { targetId, records: [] };
            }
            const bodies = await Promise.all(targets.map(target => this.readIndexedTargetBody(target)));
            return {
                targetId,
                records: bodies.flatMap(body => body.records)
            };
        }

        const target = this.findTarget(targetId, summaryLanguage);
        if (!target) {
            return { targetId, records: [] };
        }

        const bodyPath = this.bodyPath(target.bodyKey);
        try {
            const raw = await fs.promises.readFile(bodyPath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                targetId,
                records: Array.isArray(parsed.records) ? parsed.records.map((record: any) => this.normalizeBodyRecord(record)) : []
            };
        } catch (error: any) {
            logger.error(`[SummaryStorageService] Failed to read target summary body: target=${targetId}, path=${bodyPath}, error=${error?.message || error}`);
            throw error;
        }
    }

    public async writeTargetBody(targetId: string, records: SummaryBodyRecord[], summaryLanguage?: SummaryLanguage): Promise<void> {
        const bodyKey = this.createBodyKey(targetId, summaryLanguage);
        const normalizedRecords = records.map(record => this.normalizeBodyRecord(record));
        const bodyPath = this.bodyPath(bodyKey);

        this.targetIndex = this.targetIndex.filter(record => !(record.targetId === targetId && record.summaryLanguage === summaryLanguage));
        if (normalizedRecords.length > 0) {
            await fs.promises.mkdir(path.dirname(bodyPath), { recursive: true });
            await fs.promises.writeFile(bodyPath, JSON.stringify({
                targetId,
                records: normalizedRecords
            }, null, 2), 'utf8');

            this.targetIndex.push({
                targetId,
                summaryLanguage,
                bodyKey,
                updatedAt: new Date().toISOString(),
                recordCount: normalizedRecords.length
            });
        } else if (fs.existsSync(bodyPath)) {
            await fs.promises.unlink(bodyPath);
        }
        await this.persistIndex();
    }

    public async writeRecord(record: SummaryStoredRecord): Promise<void> {
        const body = await this.readTargetBody(record.targetId, record.summaryLanguage);
        const nextRecord = this.toBodyRecord(record);
        const nextRecords = body.records.filter(existing => existing.recordKey !== nextRecord.recordKey);
        nextRecords.push(nextRecord);
        await this.writeTargetBody(record.targetId, nextRecords, record.summaryLanguage);
        logger.info(`[SummaryStorageService] Wrote summary record: key=${record.recordKey}, target=${record.targetId}, language=${record.summaryLanguage || '<legacy>'}, model=${record.modelName}, index=${this.indexPath}`);
    }

    public async removeRecords(recordKeys: string[]): Promise<{ removedRecords: number }> {
        if (recordKeys.length === 0) {
            return { removedRecords: 0 };
        }

        const keySet = new Set(recordKeys);
        let removedRecords = 0;
        const targets = this.getAllIndexRecords();
        for (const target of targets) {
            const body = await this.readTargetBody(target.targetId, target.summaryLanguage);
            const nextRecords = body.records.filter(record => {
                const remove = keySet.has(record.recordKey);
                if (remove) {
                    removedRecords += 1;
                }
                return !remove;
            });
            if (nextRecords.length !== body.records.length) {
                await this.writeTargetBody(target.targetId, nextRecords, target.summaryLanguage);
            }
        }

        return { removedRecords };
    }

    public async removeRecordsForTargets(_targetKind: SummaryTargetKind, targetIds: string[]): Promise<{ removedRecords: number }> {
        return this.removeTargets(targetIds);
    }

    public async removeTargets(targetIds: string[]): Promise<{ removedRecords: number }> {
        if (targetIds.length === 0) {
            return { removedRecords: 0 };
        }

        let removedRecords = 0;
        for (const targetId of Array.from(new Set(targetIds))) {
            const targets = this.findTargets(targetId);
            if (targets.length === 0) {
                continue;
            }

            for (const target of targets) {
                removedRecords += target.recordCount;
                const bodyPath = this.bodyPath(target.bodyKey);
                try {
                    if (fs.existsSync(bodyPath)) {
                        await fs.promises.unlink(bodyPath);
                    }
                } catch (error: any) {
                    if (error?.code !== 'ENOENT') {
                        logger.warn(`[SummaryStorageService] Failed to remove summary body: target=${targetId}, path=${bodyPath}, error=${error?.message || error}`);
                    }
                }
            }
            this.targetIndex = this.targetIndex.filter(record => record.targetId !== targetId);
        }

        await this.persistIndex();
        return { removedRecords };
    }

    public async renameTargets(idMap: Map<string, string>): Promise<{ renamedTargets: number; mergedRecords: number }> {
        let renamedTargets = 0;
        let mergedRecords = 0;

        for (const [oldTargetId, newTargetId] of idMap.entries()) {
            if (oldTargetId === newTargetId) {
                continue;
            }

            const oldTargets = this.findTargets(oldTargetId);
            if (oldTargets.length === 0) {
                continue;
            }

            for (const oldTarget of oldTargets) {
                const oldBody = await this.readTargetBody(oldTargetId, oldTarget.summaryLanguage);
                const newBody = await this.readTargetBody(newTargetId, oldTarget.summaryLanguage);
                const recordsByKey = new Map<string, SummaryBodyRecord>();

                for (const record of newBody.records) {
                    recordsByKey.set(record.recordKey, record);
                }
                for (const record of oldBody.records) {
                    if (!recordsByKey.has(record.recordKey)) {
                        recordsByKey.set(record.recordKey, record);
                        mergedRecords += 1;
                    }
                }

                await this.writeTargetBody(newTargetId, Array.from(recordsByKey.values()), oldTarget.summaryLanguage);
            }

            await this.removeTargets([oldTargetId]);
            renamedTargets += 1;
        }

        return { renamedTargets, mergedRecords };
    }

    public async cleanupOrphanBodies(): Promise<{ removedBodies: number }> {
        if (!fs.existsSync(this.bodiesDir)) {
            return { removedBodies: 0 };
        }

        const indexedBodyKeys = new Set(this.targetIndex.map(record => record.bodyKey));
        const bodyFiles = await this.collectBodyFiles(this.bodiesDir);
        let removedBodies = 0;

        await Promise.all(bodyFiles.map(async bodyFile => {
            const bodyKey = path.basename(bodyFile, '.json');
            if (indexedBodyKeys.has(bodyKey)) {
                return;
            }

            try {
                await fs.promises.unlink(bodyFile);
                removedBodies += 1;
            } catch (error: any) {
                if (error?.code !== 'ENOENT') {
                    logger.warn(`[SummaryStorageService] Failed to remove orphan summary body: path=${bodyFile}, error=${error?.message || error}`);
                }
            }
        }));

        if (removedBodies > 0) {
            logger.info(`[SummaryStorageService] Removed orphan summary bodies: count=${removedBodies}`);
        }
        return { removedBodies };
    }

    public async removeBrokenTargetIndex(targetId: string, summaryLanguage?: SummaryLanguage): Promise<void> {
        this.targetIndex = this.targetIndex.filter(record => !(record.targetId === targetId && record.summaryLanguage === summaryLanguage));
        await this.persistIndex();
    }

    public getBodyReadCount(): number {
        return this.bodyReadCount;
    }

    public getIndexPath(): string {
        return this.indexPath;
    }

    private readTargetBodySync(targetId: string, summaryLanguage?: SummaryLanguage): SummaryTargetBody {
        if (!summaryLanguage) {
            return {
                targetId,
                records: this.findTargets(targetId).flatMap(target => this.readIndexedTargetBodySync(target).records)
            };
        }

        const target = this.findTarget(targetId, summaryLanguage);
        if (!target) {
            return { targetId, records: [] };
        }

        try {
            const raw = fs.readFileSync(this.bodyPath(target.bodyKey), 'utf8');
            const parsed = JSON.parse(raw);
            return {
                targetId,
                records: Array.isArray(parsed.records) ? parsed.records.map((record: any) => this.normalizeBodyRecord(record)) : []
            };
        } catch {
            return { targetId, records: [] };
        }
    }

    private findTarget(targetId: string, summaryLanguage?: SummaryLanguage): SummaryTargetIndexRecord | undefined {
        return this.targetIndex.find(record => record.targetId === targetId && record.summaryLanguage === summaryLanguage);
    }

    private findTargets(targetId: string): SummaryTargetIndexRecord[] {
        return this.targetIndex.filter(record => record.targetId === targetId);
    }

    private async readIndexedTargetBody(target: SummaryTargetIndexRecord): Promise<SummaryTargetBody> {
        const bodyPath = this.bodyPath(target.bodyKey);
        try {
            const raw = await fs.promises.readFile(bodyPath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                targetId: target.targetId,
                records: Array.isArray(parsed.records) ? parsed.records.map((record: any) => this.normalizeBodyRecord(record)) : []
            };
        } catch (error: any) {
            logger.error(`[SummaryStorageService] Failed to read target summary body: target=${target.targetId}, language=${target.summaryLanguage || '<legacy>'}, path=${bodyPath}, error=${error?.message || error}`);
            throw error;
        }
    }

    private readIndexedTargetBodySync(target: SummaryTargetIndexRecord): SummaryTargetBody {
        try {
            const raw = fs.readFileSync(this.bodyPath(target.bodyKey), 'utf8');
            const parsed = JSON.parse(raw);
            return {
                targetId: target.targetId,
                records: Array.isArray(parsed.records) ? parsed.records.map((record: any) => this.normalizeBodyRecord(record)) : []
            };
        } catch {
            return { targetId: target.targetId, records: [] };
        }
    }

    private toIndexRecord(targetId: string, record: SummaryBodyRecord): SummaryIndexRecord {
        return {
            recordKey: record.recordKey,
            targetId,
            label: record.label,
            modelName: record.modelName,
            promptVersion: record.promptVersion,
            summaryLanguage: record.summaryLanguage,
            bodyHash: record.bodyHash,
            generatedAt: record.generatedAt,
            relationContextHash: record.relationContextHash,
            contextCoverage: record.contextCoverage,
            usedContextNodeIds: record.usedContextNodeIds,
            missingContextNodeIds: record.missingContextNodeIds
        };
    }

    private toBodyRecord(record: SummaryStoredRecord): SummaryBodyRecord {
        return {
            recordKey: record.recordKey,
            label: record.label,
            modelName: record.modelName,
            promptVersion: record.promptVersion,
            summaryLanguage: record.summaryLanguage,
            bodyHash: record.bodyHash,
            generatedAt: record.generatedAt,
            summary: record.summary,
            relationContextHash: record.relationContextHash,
            contextCoverage: record.contextCoverage,
            usedContextNodeIds: record.usedContextNodeIds,
            missingContextNodeIds: record.missingContextNodeIds
        };
    }

    private normalizeBodyRecord(record: any): SummaryBodyRecord {
        return {
            recordKey: String(record.recordKey || ''),
            label: String(record.label || ''),
            modelName: String(record.modelName || ''),
            promptVersion: String(record.promptVersion || ''),
            summaryLanguage: this.normalizeSummaryLanguage(record.summaryLanguage),
            bodyHash: String(record.bodyHash || ''),
            generatedAt: String(record.generatedAt || ''),
            summary: String(record.summary || ''),
            relationContextHash: record.relationContextHash ? String(record.relationContextHash) : undefined,
            contextCoverage: record.contextCoverage,
            usedContextNodeIds: Array.isArray(record.usedContextNodeIds) ? record.usedContextNodeIds.map(String) : undefined,
            missingContextNodeIds: Array.isArray(record.missingContextNodeIds) ? record.missingContextNodeIds.map(String) : undefined
        };
    }

    private createBodyKey(targetId: string, summaryLanguage?: SummaryLanguage): string {
        const base = crypto.createHash('sha256').update(targetId, 'utf8').digest('hex');
        return summaryLanguage ? `${base}.${summaryLanguage}` : base;
    }

    private bodyPath(bodyKey: string): string {
        const bucket = bodyKey.slice(0, 2) || '__';
        return path.join(this.bodiesDir, bucket, `${bodyKey}.json`);
    }

    private async persistIndex(): Promise<void> {
        await fs.promises.mkdir(this.rootDir, { recursive: true });
        await fs.promises.writeFile(this.indexPath, JSON.stringify({
            version: 3,
            targets: this.targetIndex
        }, null, 2), 'utf8');
    }

    private normalizeSummaryLanguage(value: unknown): SummaryLanguage | undefined {
        return value === 'en' || value === 'zh-CN' ? value : undefined;
    }

    private async collectBodyFiles(dir: string): Promise<string[]> {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const files: string[] = [];

        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.collectBodyFiles(entryPath));
            } else if (entry.isFile() && entry.name.endsWith('.json')) {
                files.push(entryPath);
            }
        }

        return files;
    }
}
