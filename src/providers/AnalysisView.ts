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
        const mainScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'main.js'));
        const styleScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'style.js'));
        const eventScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'event.js'));
        const uiScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'ui.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'css', 'main.css'));
        const cytoscapeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'public', 'cytoscape.min.js'));
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'html', 'view.html');
        const nonce = this._getNonce();

        try {
            let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

            html = html
                .replace(/{{cspSource}}/g, webview.cspSource)
                .replace(/{{styleUri}}/g, styleUri.toString())
                .replace(/{{mainScriptUri}}/g, mainScriptUri.toString())
                .replace(/{{styleScriptUri}}/g, styleScriptUri.toString())
                .replace(/{{eventScriptUri}}/g, eventScriptUri.toString())
                .replace(/{{uiScriptUri}}/g, uiScriptUri.toString())
                .replace(/{{cytoscapeUri}}/g, cytoscapeUri.toString())
                .replace(/{{nonce}}/g, nonce);

            return html;
        } catch (error) {
            logger.info(`[AnalysisView] 读取不到 HTML 资源: ${htmlPath.fsPath}`);
            return `<html><body><h1>无法加载视图</h1><p>请确保资源文件存在: ${htmlPath.fsPath}</p></body></html>`;
        }
    }

    private _getNonce(): string {// 生成一个随机字符串作为 nonce，增强安全性
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let i = 0; i < 32; i += 1) {
            nonce += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        return nonce;
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