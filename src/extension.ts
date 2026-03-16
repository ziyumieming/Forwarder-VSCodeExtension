import * as vscode from 'vscode';
import { SummaryViewProvider } from './deprecated/SummaryView';
import { AnalysisViewProvider } from './providers/AnalysisView';
import { SummaryController } from './deprecated/SummaryController';
import { AnalysisController } from './controllers/AnalysisController';
import { DebugController } from './controllers/DebugController';
import { AnalysisRuntime } from './services/AnalysisRuntime';
import { logger } from './utils/logger';


export function activate(context: vscode.ExtensionContext) {

	logger.info("I'm here testing the extension's availability.");

	// 初始化顶层服务运行时单例
	const runtime = AnalysisRuntime.getInstance();

	// 设置持久化位置，并在此时启动异步增量扫描（非阻塞主体激活任务）
	const storagePath = vscode.Uri.joinPath(context.globalStorageUri, 'graph_snapshot.json').fsPath;
	runtime.initialize(storagePath);
	runtime.runIncrementalSync().catch(err => {
		logger.info(`后台增量同步启动失败：${err}`);
	});

	const analysisProvider = new AnalysisViewProvider(context.extensionUri);
	const analysisController = new AnalysisController(analysisProvider, runtime);

	context.subscriptions.push(vscode.window.registerWebviewViewProvider('forwarder-view', analysisProvider));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.analyze', () => analysisController.handleAnalyzeActiveFileCommand()));

	// Debug commands
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.analyze', () => DebugController.debugAnalyzeCurrentFile()));

	// 将 runtime 也加入销毁队列，保证退出时解除设置监听
	context.subscriptions.push({ dispose: () => runtime.dispose() });
}

export function deactivate() { }
