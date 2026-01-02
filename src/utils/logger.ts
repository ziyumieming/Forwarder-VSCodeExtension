import * as vscode from 'vscode';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export class Logger {
    private static instance: Logger;
    private channel: vscode.OutputChannel;

    private constructor() {
        this.channel = vscode.window.createOutputChannel("Forwarder");
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private write(level: LogLevel, message: string, data?: any) {
        const timestamp = new Date().toLocaleTimeString();
        const fullMessage = `[${timestamp}] [${level}] ${message}`;
        this.channel.appendLine(fullMessage);
        if (data !== undefined) {
            this.channel.appendLine(JSON.stringify(data, null, 2));
        }
    }

    public info(message: string, data?: any) { this.write('INFO', message, data); }
    public warn(message: string, data?: any) { this.write('WARN', message, data); }
    public error(message: string, data?: any) { this.write('ERROR', message, data); }
    public debug(message: string, data?: any) { this.write('DEBUG', message, data); }

    public show() {
        this.channel.show(true);
    }
}

export const logger = Logger.getInstance();