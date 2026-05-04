import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export class LSPService {
    public static async getDocumentSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[] | undefined> {
        try {
            return await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );
        } catch (err) {
            logger.info(`[LSPService] 获取文档符号失败: ${uri.toString()}`);
            return undefined;
        }
    }

    public static async getTypeHierarchySupertypes(uri: vscode.Uri, position: vscode.Position): Promise<vscode.TypeHierarchyItem[] | undefined> {
        try {
            const items = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
                'vscode.prepareTypeHierarchy',
                uri,
                position
            );

            if (!items || items.length === 0) {
                return undefined;
            }

            return await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
                'vscode.provideSupertypes',
                items[0]
            );
        } catch (err) {
            logger.info(`[LSPService] 获取类型层次结构失败: ${uri.toString()}`);
            return undefined;
        }
    }

    public static async prepareCallHierarchy(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem[] | undefined> {
        try {
            const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[] | vscode.CallHierarchyItem | undefined>(
                'vscode.prepareCallHierarchy',
                uri,
                position
            );

            if (!items) {
                return undefined;
            }

            return Array.isArray(items) ? items : [items];
        } catch (err) {
            logger.info(`[LSPService] 准备调用层次结构失败: ${uri.toString()}`);
            return undefined;
        }
    }

    public static async getOutgoingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[] | undefined> {
        try {
            return await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
                'vscode.provideOutgoingCalls',
                item
            );
        } catch (err) {
            logger.info(`[LSPService] 获取下游调用失败: ${item.uri.toString()}#${item.name}`);
            return undefined;
        }
    }

    public static async getIncomingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[] | undefined> {
        try {
            return await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
                'vscode.provideIncomingCalls',
                item
            );
        } catch (err) {
            logger.info(`[LSPService] 获取上游调用失败: ${item.uri.toString()}#${item.name}`);
            return undefined;
        }
    }

    public static async getTypeDefinition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[] | vscode.LocationLink[] | undefined> {
        try {
            return await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeTypeDefinitionProvider',
                uri,
                position
            );
        } catch (err) {
            logger.info(`[LSPService] 获取类型定义失败: ${uri.toString()}`);
            return undefined;
        }
    }

    public static async getDefinition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[] | vscode.LocationLink[] | undefined> {
        try {
            return await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeDefinitionProvider',
                uri,
                position
            );
        } catch (err) {
            logger.info(`[LSPService] 获取普通定义失败: ${uri.toString()}`);
            return undefined;
        }
    }
}
