import * as vscode from 'vscode';
import { ForwarderWebviewProvider } from '../providers/summaryview';

export class SummaryController {
    // 依赖通过构造函数注入
    constructor(
        private readonly provider: ForwarderWebviewProvider,
        private readonly channel: vscode.OutputChannel
    ) { }

    handleGetFunctionCommand() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);
        if (!text) {
            vscode.window.showWarningMessage("请先选择一些文本！");
            return;
        }

        // 下面这部分如果将来变复杂，可以再继续拆小函数/服务
        vscode.window.showInformationMessage(`选中的代码长度为 ${text.length} 个字符。`);
        this.channel.appendLine(`选中的代码内容为 ${text} `);

        vscode.commands.executeCommand('forwarder-view.focus');
        this.provider.updateSummary(`选中的代码长度为 ${text.length} 个字符。`);
    }
}