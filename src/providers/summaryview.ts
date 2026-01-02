import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export class ForwarderWebviewProvider implements vscode.WebviewViewProvider {
    // 单例，方便我们在外面通过这个变量发消息给 Webview
    private _view?: vscode.WebviewView;
    private _messageHandler?: (data: any) => void;//消息回调，将 resolveWebviewView 监听到的消息转发给上层controller

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public setMessageHandler(handler: (data: any) => void) {
        this._messageHandler = handler;
    }

    // 当用户点开侧边栏时，VSCode 会调用这个方法
    resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]//防止 Webview 载入外部资源的安全问题
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // 监听来自 Webview 的按钮点击
        webviewView.webview.onDidReceiveMessage(async data => {
            logger.info(`[Webview] 收到消息: ${JSON.stringify(data)}`);
            this._messageHandler?.(data);
        })
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const useMock = false;
        // 获取本地资源的路径
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'view.html');
        const uiScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'ui.js'));
        const mockScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'mock.js'));
        const markdownScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'marked.min.js'));
        // 读取 HTML 文件内容
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // 动态替换占位符
        html = html
            .replace(/{{ useMock }}/g, useMock ? 'true' : 'false')
            .replace(/{{cspSource}}/g, webview.cspSource)
            .replace(/{{styleUri}}/g, styleUri.toString())
            .replace(/{{scriptUri}}/g, scriptUri.toString())
            .replace(/{{uiScriptUri}}/g, uiScriptUri.toString())
            .replace(/{{mockScriptUri}}/g, mockScriptUri.toString())
            .replace(/{{markdownScriptUri}}/g, markdownScriptUri.toString());

        return html;
    }


    public updateState(partial: { status?: string; functionName?: string; summary?: string }) {
        this._view?.webview.postMessage({
            command: 'updateState',
            content: partial
        });
    }

}