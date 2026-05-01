import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export interface LLMPromptResult {
    text: string;
    modelId?: string;
}

export class LLMService {

    /**
     * 获取可用模型并进行详细诊断
     */
    public static async getAvailableModels(): Promise<{ models: vscode.LanguageModelChat[], diagnosticInfo: string }> {
        let info = "";
        try {
            const copilotChat = vscode.extensions.getExtension('github.copilot-chat');
            info += `[Diagnostic] Copilot Chat Extension: ${copilotChat ? 'Installed' : 'NOT Installed'}\n`;
            if (copilotChat) {
                info += `[Diagnostic] Copilot Chat Active: ${copilotChat.isActive}\n`;
                if (!copilotChat.isActive) {
                    info += `[Diagnostic] Attempting to activate Copilot Chat...\n`;
                    await copilotChat.activate();
                    info += `[Diagnostic] Copilot Chat Active after activation: ${copilotChat.isActive}\n`;
                }
            }

            const models = await vscode.lm.selectChatModels({});
            info += `[Diagnostic] models.length = ${models.length}\n`;

            if (models.length > 0) {
                models.forEach((m, i) => {
                    info += `[Diagnostic] Model ${i}: id=${m.id}, vendor=${m.vendor}, family=${m.family}\n`;
                });
            } else {
                info += `[Diagnostic] No models returned from selectChatModels({}).\n`;
            }

            return { models, diagnosticInfo: info };
        } catch (err: any) {
            info += `[Diagnostic] ERROR: ${err.message}\n`;
            return { models: [], diagnosticInfo: info };
        }
    }

    public static async sendPrompt(prompt: string, token?: vscode.CancellationToken): Promise<LLMPromptResult> {
        try {
            const { models, diagnosticInfo } = await this.getAvailableModels();
            logger.info(diagnosticInfo);

            const model = models[0];
            if (!model) {
                throw new Error(`未找到可用的 AI 模型。\n\n诊断信息：\n${diagnosticInfo}\n请确保已安装并登录 GitHub Copilot Chat 插件。`);
            }

            const messages = [
                vscode.LanguageModelChatMessage.User(prompt)
            ];

            const fallbackTokenSource = token ? undefined : new vscode.CancellationTokenSource();
            try {
                const response = await model.sendRequest(messages, {}, token || fallbackTokenSource!.token);

                let fullResponse = "";
                for await (const fragment of response.text) {
                    fullResponse += fragment;
                }

                return {
                    text: fullResponse,
                    modelId: model.id
                };
            } finally {
                fallbackTokenSource?.dispose();
            }

        } catch (err: any) {
            logger.error(`[LLMService] AI request failed: ${err?.message || err}`);
            throw err;
        }
    }
}
