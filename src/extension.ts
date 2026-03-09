import * as vscode from 'vscode';
import { ForwarderWebviewProvider } from './providers/summaryview';
import { SummaryController } from './controllers/summarycontroller';
import { AnalysisController } from './controllers/analysiscontroller';
import { DebugController } from './controllers/debugcontroller';
import { logger } from './utils/logger';


export function activate(context: vscode.ExtensionContext) {

	logger.info("I'm here testing the extension's availability.");

	const provider = new ForwarderWebviewProvider(context.extensionUri);
	const summaryController = new SummaryController(provider);
	const analysisController = new AnalysisController();

	context.subscriptions.push(vscode.window.registerWebviewViewProvider('forwarder-view', provider));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.getFunction', () => summaryController.handleGetFunctionCommand()));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.analyzeActiveFile', () => analysisController.handleAnalyzeActiveFileCommand()));

	// Debug commands
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.analyzeFile', () => DebugController.debugAnalyzeCurrentFile()));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.showChannel', () => logger.show()));

	// 在插件激活时自动运行一次分析（如果有活跃编辑器）
	logger.info('[Extension] 在插件激活时自动运行分析...');
	analysisController.analyzeActiveFile().catch(error => {
		logger.warn(`[Extension] 自动分析失败: ${error}`);
	});
}

export function deactivate() { }
