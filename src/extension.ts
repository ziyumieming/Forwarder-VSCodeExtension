import * as vscode from 'vscode';
import { SummaryViewProvider } from './providers/SummaryView';
import { AnalysisViewProvider } from './providers/AnalysisView';
import { SummaryController } from './controllers/SummaryController';
import { AnalysisController } from './controllers/AnalysisController';
import { DebugController } from './controllers/DebugController';
import { logger } from './utils/logger';


export function activate(context: vscode.ExtensionContext) {

	logger.info("I'm here testing the extension's availability.");

	const summaryProvider = new SummaryViewProvider(context.extensionUri);
	const analysisProvider = new AnalysisViewProvider(context.extensionUri);
	const summaryController = new SummaryController(summaryProvider);//已废弃
	const analysisController = new AnalysisController(analysisProvider);

	context.subscriptions.push(vscode.window.registerWebviewViewProvider('forwarder-view', analysisProvider));
	// context.subscriptions.push(vscode.commands.registerCommand('forwarder.getFunction', () => summaryController.handleGetFunctionCommand()));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.analyze', () => analysisController.handleAnalyzeActiveFileCommand()));

	// Debug commands
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.analyze', () => DebugController.debugAnalyzeCurrentFile()));

}

export function deactivate() { }
