import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ForwarderWebviewProvider implements vscode.WebviewViewProvider {
    // 单例，方便我们在外面通过这个变量发消息给 Webview
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    // 当用户点开侧边栏时，VSCode 会调用这个方法
    resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]//防止 Webview 载入外部资源的安全问题
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // 监听来自 Webview 的按钮点击
        webviewView.webview.onDidReceiveMessage(data => {
            if (data.command === 'jumpToFunction') {
                // 这里后面会调用编辑器定位逻辑
                vscode.window.showInformationMessage("准备跳回函数位置...");
            }
        });
    }


    public updateSummary(summary: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'update', text: summary });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // 获取本地资源的路径
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'view.html');

        // 读取 HTML 文件内容
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // 动态替换占位符
        html = html
            .replace('{{cspSource}}', webview.cspSource)
            .replace('{{styleUri}}', styleUri.toString())
            .replace('{{scriptUri}}', scriptUri.toString());

        return html;
    }
}