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
        const moduleLoggerScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'logger.js'));
        const modulePluginManagerScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'plugin-manager.js'));
        const moduleCardMarkupScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'card-markup.js'));
        const moduleCenterStateScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'center-state.js'));
        const moduleTabManagerScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'tab-manager.js'));
        const moduleSelectionStoreScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'selection-store.js'));
        const moduleQueryServiceScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'query-service.js'));
        const moduleGraphIncrementalScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'graph-incremental.js'));
        const moduleGraphPipelineScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'graph-pipeline.js'));
        const moduleLayoutManagerScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'layout-manager.js'));
        const moduleCardRenderScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'card-render.js'));
        const moduleCardEventsScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'card-events.js'));
        const moduleViewportAnimationScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'viewport-animation.js'));
        const moduleGraphFocusScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'graph-focus.js'));
        const moduleCenterPresentationScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'center-presentation.js'));
        const moduleRelationGraphTabScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'js', 'modules', 'relation-graph-tab.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'develop', 'css', 'main.css'));
        const cytoscapeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'public', 'cytoscape.min.js'));
        const cytoscapeHtmlNodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'public', 'cytoscape-html-node.js'));
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
                .replace(/{{moduleLoggerScriptUri}}/g, moduleLoggerScriptUri.toString())
                .replace(/{{modulePluginManagerScriptUri}}/g, modulePluginManagerScriptUri.toString())
                .replace(/{{moduleCardMarkupScriptUri}}/g, moduleCardMarkupScriptUri.toString())
                .replace(/{{moduleCenterStateScriptUri}}/g, moduleCenterStateScriptUri.toString())
                .replace(/{{moduleTabManagerScriptUri}}/g, moduleTabManagerScriptUri.toString())
                .replace(/{{moduleSelectionStoreScriptUri}}/g, moduleSelectionStoreScriptUri.toString())
                .replace(/{{moduleQueryServiceScriptUri}}/g, moduleQueryServiceScriptUri.toString())
                .replace(/{{moduleGraphIncrementalScriptUri}}/g, moduleGraphIncrementalScriptUri.toString())
                .replace(/{{moduleGraphPipelineScriptUri}}/g, moduleGraphPipelineScriptUri.toString())
                .replace(/{{moduleLayoutManagerScriptUri}}/g, moduleLayoutManagerScriptUri.toString())
                .replace(/{{moduleCardRenderScriptUri}}/g, moduleCardRenderScriptUri.toString())
                .replace(/{{moduleCardEventsScriptUri}}/g, moduleCardEventsScriptUri.toString())
                .replace(/{{moduleViewportAnimationScriptUri}}/g, moduleViewportAnimationScriptUri.toString())
                .replace(/{{moduleGraphFocusScriptUri}}/g, moduleGraphFocusScriptUri.toString())
                .replace(/{{moduleCenterPresentationScriptUri}}/g, moduleCenterPresentationScriptUri.toString())
                .replace(/{{moduleRelationGraphTabScriptUri}}/g, moduleRelationGraphTabScriptUri.toString())
                .replace(/{{cytoscapeUri}}/g, cytoscapeUri.toString())
                .replace(/{{cytoscapeHtmlNodeUri}}/g, cytoscapeHtmlNodeUri.toString())
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
