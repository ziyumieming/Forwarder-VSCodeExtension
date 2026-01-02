import * as vscode from 'vscode';
import { ForwarderWebviewProvider } from '../providers/summaryview';
import { LSPService, FunctionInfo } from '../services/LSPservices';
import { logger } from '../utils/logger';

export class SummaryController {
    // 依赖通过构造函数注入
    constructor(
        private readonly provider: ForwarderWebviewProvider
    ) { }

    handleGetFunctionCommand() {
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
        const func = LSPService.getActiveFunction();
        func.then((funcInfo: FunctionInfo | undefined) => {
            if (!funcInfo) {
                vscode.window.showWarningMessage("未能识别当前光标所在的函数。");
                return;
            }
            vscode.window.showInformationMessage(`识别到函数: ${funcInfo.name}`);
            logger.info(`函数 ${funcInfo.name} 的代码内容为:\n${funcInfo.code} `);
            vscode.commands.executeCommand('forwarder-view.focus');
            this.provider.updateSummary(`函数 ${funcInfo.name} 的代码内容为:\n${funcInfo.code} `);
        });

    }
}