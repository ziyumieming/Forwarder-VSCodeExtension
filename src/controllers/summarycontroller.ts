import * as vscode from 'vscode';
import { ForwarderWebviewProvider } from '../providers/summaryview';
import { LSPService, FunctionInfo } from '../services/LSPservices';
import { logger } from '../utils/logger';
import { LLMService } from '../services/LLMservices';

export class SummaryController {
    private lastFuncInfo?: FunctionInfo; // 记录上次分析的函数信息

    constructor(private readonly provider: ForwarderWebviewProvider) {
        this.provider.setMessageHandler(this.handleWebviewMessage.bind(this));
    }

    private async runAnalysisForActiveFunction() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        /*  
        //   将选中的文本进行字数统计
               const selection = editor.selection;
                const text = editor.document.getText(selection);
                if (!text) {
                    vscode.window.showWarningMessage("请先选择一些文本！");
                    return;
                }  
                vscode.window.showInformationMessage(`选中的代码长度为 ${text.length} 个字符。`);
                this.channel.appendLine(`选中的代码内容为 ${text} `);
        
                vscode.commands.executeCommand('forwarder-view.focus');
                this.provider.updateSummary(`选中的代码长度为 ${text.length} 个字符。`);
            */
        const funcInfo = await LSPService.getActiveFunction();

        if (!funcInfo) {
            vscode.window.showWarningMessage("未能识别当前光标所在的函数。");
            this.provider.updateState({
                status: 'error',
                functionName: '',
                summary: '未能识别当前光标所在的函数。'
            });
            return;
        }
        await vscode.commands.executeCommand('forwarder-view.focus');

        this.lastFuncInfo = funcInfo;
        vscode.window.showInformationMessage(`识别到函数: ${funcInfo.name}`);
        logger.info(`[Controller] 识别到函数: ${funcInfo.name}`);
        // logger.info(`函数 ${funcInfo.name} 的代码内容为:\n${funcInfo.code} `);

        const summary = await LLMService.summarizeFunction(funcInfo.name, funcInfo.code);

        this.provider.updateState({
            status: 'success',
            functionName: funcInfo.name,
            // summary: `#### 函数 ${funcInfo.name} 的代码内容为: \n${funcInfo.code}\n`
            summary: summary
        });
    }

    private async jumpToLastFunction() {
        if (!this.lastFuncInfo) {
            vscode.window.showWarningMessage("当前没有可跳转的函数信息，请先运行一次分析。");
            return;
        }

        const doc = await vscode.workspace.openTextDocument(this.lastFuncInfo.uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });

        editor.revealRange(this.lastFuncInfo.range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(
            this.lastFuncInfo.range.start,
            this.lastFuncInfo.range.start
        );
    }

    public handleGetFunctionCommand() {
        this.runAnalysisForActiveFunction();
    }

    private async handleWebviewMessage(data: any) {
        switch (data.command) {
            case 'regenerate':
                logger.info('[Controller] 收到 Webview regenerate 请求');
                await this.runAnalysisForActiveFunction();
                break;

            case 'jumpToSource':
                logger.info(`[Controller] 收到 jumpToSource，函数名: ${data.functionName}`);
                await this.jumpToLastFunction();
                break;
        }
    }
}