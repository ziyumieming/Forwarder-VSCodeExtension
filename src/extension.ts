import * as vscode from 'vscode';
import { ForwarderWebviewProvider } from './providers/summaryview';
import { SummaryController } from './controllers/summarycontroller';
import { DebugController } from './controllers/debugcontroller';
import { logger } from './utils/logger';


export function activate(context: vscode.ExtensionContext) {

	logger.info("I'm here testing the extension's availability.");

	const provider = new ForwarderWebviewProvider(context.extensionUri);
	const controller = new SummaryController(provider);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('forwarder-view', provider));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.getFunction', () => controller.handleGetFunctionCommand()));

	// Debug commands
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.debug.analyzeFile', () => DebugController.debugAnalyzeCurrentFile()));
}

export function deactivate() { }
