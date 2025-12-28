import * as vscode from 'vscode';
import { ForwarderWebviewProvider } from './providers/summaryview';
import { SummaryController } from './controllers/summarycontroller';

export function activate(context: vscode.ExtensionContext) {

	const soleChannel = vscode.window.createOutputChannel("Forwarder");
	soleChannel.appendLine("I'm here testing the extension's availability.");

	const provider = new ForwarderWebviewProvider(context.extensionUri);
	const controller = new SummaryController(provider, soleChannel);

	context.subscriptions.push(vscode.window.registerWebviewViewProvider('forwarder-view', provider));
	context.subscriptions.push(vscode.commands.registerCommand('forwarder.getFunction', () => controller.handleGetFunctionCommand()));
}

export function deactivate() { }
