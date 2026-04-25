import * as vscode from 'vscode';
import { AnalysisViewProvider } from './providers/AnalysisView';
import { AnalysisController } from './controllers/AnalysisController';
import { DebugController } from './controllers/DebugController';
import { AnalysisRuntime } from './services/AnalysisRuntime';
import { logger } from './utils/logger';


export function activate(context: vscode.ExtensionContext) {

	logger.info("I'm here testing the extension's availability.");

	// 初始化顶层服务运行时单例
	const runtime = AnalysisRuntime.getInstance();

	// 设置按工作区隔离的持久化位置，并在此时启动异步增量扫描
	let storageDir: string;
	let isSingleFileMode = false;
	let singleFileUriStr: string | undefined;

	if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
		// 原生支持的工作区级存储，若由于未保存工作区等原因不存在则 fallback 到 global 加上首个根目录名
		if (context.storageUri) {
			storageDir = context.storageUri.fsPath;
		} else {
			storageDir = vscode.Uri.joinPath(context.globalStorageUri, vscode.workspace.workspaceFolders[0].name).fsPath;
		}
	} else {
		// 单文件模式回退到 globalStorage 中的单独目录，并在 manifest 标识该文件
		storageDir = vscode.Uri.joinPath(context.globalStorageUri, "single_file_mode").fsPath;
		isSingleFileMode = true;
		singleFileUriStr = vscode.window.activeTextEditor?.document.uri.toString();
	}

	runtime.initialize(storageDir, isSingleFileMode, singleFileUriStr);
	runtime.runIncrementalSync().catch(err => {
		logger.info(`后台增量同步启动失败：${err}`);
	});

	const analysisProvider = new AnalysisViewProvider(context.extensionUri);
	const analysisController = new AnalysisController(analysisProvider, runtime);

	context.subscriptions.push(vscode.window.registerWebviewViewProvider('forwarder-view', analysisProvider, {
		webviewOptions: {
			retainContextWhenHidden: true
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.analyze', () => analysisController.handleAnalyzeActiveFileCommand()));
	// Debug commands
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.analyze', () => DebugController.debugAnalyzeCurrentFile()));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.lspTypeHierarchy', () => DebugController.debugLSPTypeHierarchy()));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.queryRelations', () => DebugController.debugQueryRelations()));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.clearAndRebuild', () => DebugController.debugClearAndRebuildGraph()));

	// 将 runtime 也加入销毁队列，保证退出时解除设置监听
	context.subscriptions.push({ dispose: () => runtime.dispose() });
}

export function deactivate() { }
