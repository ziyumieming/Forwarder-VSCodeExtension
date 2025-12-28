import * as vscode from 'vscode';

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
    }


    public updateSummary(summary: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'update', text: summary });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <body>
                <h3 id="status">等待分析...</h3>
                <div id="content"></div>
                <button id="locate-btn" style="display:none;">定位到函数</button>
                <script>
                    const vscode = acquireVsCodeApi();
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'update') {
                            document.getElementById('status').innerText = '功能总结：';
                            document.getElementById('content').innerText = message.text;
                            document.getElementById('locate-btn').style.display = 'block';
                        }
                    });

                    document.getElementById('locate-btn').onclick = () => {
                        vscode.postMessage({ command: 'reFocus' });
                    };
                </script>
            </body>
            </html>`;
    }
}