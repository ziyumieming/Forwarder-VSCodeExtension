import * as vscode from 'vscode';
import * as fs from 'fs';
import { logger } from '../utils/logger';

export class AnalysisViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _messageHandler?: (data: any) => void;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public setMessageHandler(handler: (data: any) => void) {
        this._messageHandler = handler;
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            logger.info(`[AnalysisView] 收到前端消息: ${JSON.stringify(data)}`);
            this._messageHandler?.(data);
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // TODO: 此处占位：后期你可以修改为 Analysis 专属的 HTML 和前端资源路径
        // 建议在 media 下建一个新的子文件夹比如 'analysis' 存放对应的 view.html 和 ui.js 等
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'view.html');

        try {
            let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
            // ... 动态替换路径等工作同 SummaryViewProvider
            return html;
        } catch (error) {
            logger.info(`[AnalysisView] 读取不到 HTML 资源: ${htmlPath.fsPath}`);
            return `<!DOCTYPE html>
            <html lang="en">
            <body>
                <div id="app">Analysis View Placeholder</div>
                <script>
                    const vscode = acquireVsCodeApi();
                    // 测试与后端通信
                    // vscode.postMessage({ command: 'queryGlobalRelation', relation: 'extends' });
                </script>
            </body>
            </html>`;
        }
    }

    /**
     * 封装通用的消息发送方法
     */
    public postMessage(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        } else {
            logger.info('[AnalysisView] 无法发送消息，Webview尚未初始化或已被销毁。');
        }
    }
}