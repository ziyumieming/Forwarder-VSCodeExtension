import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export interface LLMModelDescriptor {
    id: string;
    vendor?: string;
    family?: string;
    version?: string;
    model?: vscode.LanguageModelChat;
}

export interface LLMModelInfo {
    modelName: string;
    id: string;
    vendor?: string;
    family?: string;
    version?: string;
}

export interface LLMModelServiceOptions {
    storageDir?: string;
    configuredDefaultModelName?: string;
    modelProvider?: () => Promise<LLMModelDescriptor[]>;
}

export class LLMModelService {
    private models: LLMModelDescriptor[] = [];
    private selectedModelName = '';
    private readonly manifestPath?: string;
    private readonly configuredDefaultModelName?: string;
    private readonly modelProvider: () => Promise<LLMModelDescriptor[]>;

    constructor(options: LLMModelServiceOptions = {}) {
        this.manifestPath = options.storageDir
            ? path.join(options.storageDir, 'llm_models_manifest.json')
            : undefined;
        this.configuredDefaultModelName = options.configuredDefaultModelName;
        this.modelProvider = options.modelProvider || this.defaultModelProvider;
    }

    public async initialize(): Promise<{ models: LLMModelInfo[]; selectedModelName: string }> {
        this.models = await this.modelProvider();
        this.selectedModelName = this.resolveInitialModelName();
        await this.saveManifest();
        logger.info(`[LLMModelService] Initialized models=${this.models.length}, selected=${this.selectedModelName || '<none>'}, manifest=${this.manifestPath || '<none>'}`);

        return {
            models: this.listModels(),
            selectedModelName: this.selectedModelName
        };
    }

    public listModels(): LLMModelInfo[] {
        return this.models.map(model => ({
            modelName: this.getModelName(model),
            id: model.id,
            vendor: model.vendor,
            family: model.family,
            version: model.version
        }));
    }

    public getSelectedModelName(): string {
        return this.selectedModelName;
    }

    public getSelectedModel(): LLMModelDescriptor | undefined {
        return this.models.find(model => this.getModelName(model) === this.selectedModelName)
            || this.models[0];
    }

    public async setSelectedModelName(modelName: string): Promise<LLMModelInfo | undefined> {
        const target = this.models.find(model => this.getModelName(model) === modelName);
        this.selectedModelName = target ? this.getModelName(target) : (this.models[0] ? this.getModelName(this.models[0]) : '');
        await this.saveManifest();
        logger.info(`[LLMModelService] Selected model changed: requested=${modelName}, selected=${this.selectedModelName || '<none>'}`);
        const selected = this.getSelectedModel();
        return selected ? this.toModelInfo(selected) : undefined;
    }

    public getModelName(model: LLMModelDescriptor): string {
        return [model.vendor, model.family, model.id]
            .map(value => String(value || '').trim())
            .filter(value => value.length > 0)
            .join('/');
    }

    private resolveInitialModelName(): string {
        if (this.models.length === 0) {
            return '';
        }

        const configured = this.configuredDefaultModelName?.trim();
        if (configured && this.models.some(model => this.getModelName(model) === configured)) {
            return configured;
        }

        const manifestName = this.loadManifestSelectedModelName();
        if (manifestName && this.models.some(model => this.getModelName(model) === manifestName)) {
            return manifestName;
        }

        return this.getModelName(this.models[0]);
    }

    private toModelInfo(model: LLMModelDescriptor): LLMModelInfo {
        return {
            modelName: this.getModelName(model),
            id: model.id,
            vendor: model.vendor,
            family: model.family,
            version: model.version
        };
    }

    private loadManifestSelectedModelName(): string | undefined {
        if (!this.manifestPath || !fs.existsSync(this.manifestPath)) {
            return undefined;
        }

        try {
            const data = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
            return typeof data.selectedModelName === 'string' ? data.selectedModelName : undefined;
        } catch (error: any) {
            logger.warn(`[LLMModelService] Failed to read model manifest: ${error.message}`);
            return undefined;
        }
    }

    private async saveManifest(): Promise<void> {
        if (!this.manifestPath) {
            return;
        }

        await fs.promises.mkdir(path.dirname(this.manifestPath), { recursive: true });
        await fs.promises.writeFile(this.manifestPath, JSON.stringify({
            selectedModelName: this.selectedModelName,
            models: this.listModels()
        }, null, 2), 'utf8');
    }

    private async defaultModelProvider(): Promise<LLMModelDescriptor[]> {
        const models = await vscode.lm.selectChatModels({});
        return models.map(model => ({
            id: model.id,
            vendor: model.vendor,
            family: model.family,
            version: model.version,
            model
        }));
    }
}
