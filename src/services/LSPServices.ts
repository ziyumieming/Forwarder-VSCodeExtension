import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export interface FunctionInfo {
    name: string;
    code: string;// 函数的完整代码文本
    range: vscode.Range;
    uri: vscode.Uri;
}

export class LSPService {

    // 获取整个文档的符号树
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

    // 获取类型的父级结构信息（用于继承、实现扫描）
    public static async getTypeHierarchySupertypes(uri: vscode.Uri, position: vscode.Position): Promise<vscode.TypeHierarchyItem[] | undefined> {
        try {
            // 1. 根据位置准备类型层次结构
            const items = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
                'vscode.prepareTypeHierarchy',
                uri,
                position
            );

            if (!items || items.length === 0) {
                return undefined;
            }

            // 2. 提供其父级类型
            const supertypes = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
                'vscode.provideSupertypes',
                items[0]
            );

            return supertypes;
        } catch (err) {
            logger.info(`[LSPService] 获取类型层次结构失败: ${uri.toString()}`);
            return undefined;
        }
    }

    // 准备调用层次结构入口（用于函数/方法调用图）
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

    // 获取指定 CallHierarchyItem 的下游调用
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

    // 获取指定 CallHierarchyItem 的上游调用
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

    // 获取特定位置的定义信息（用于组合关系扫描）
    public static async getTypeDefinition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[] | vscode.LocationLink[] | undefined> {
        try {
            const definitions = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeTypeDefinitionProvider',
                uri,
                position
            );
            return definitions;
        } catch (err) {
            logger.info(`[LSPService] 获取类型定义失败: ${uri.toString()}`);
            return undefined;
        }
    }

    // 获取特定位置的普通定义信息（用于依赖关系分析中的参数/返回值跳转）
    public static async getDefinition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[] | vscode.LocationLink[] | undefined> {
        try {
            const definitions = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeDefinitionProvider',
                uri,
                position
            );
            return definitions;
        } catch (err) {
            logger.info(`[LSPService] 获取普通定义失败: ${uri.toString()}`);
            return undefined;
        }
    }

    // 根据当前光标位置自动寻找并获取函数信息
    public static async getActiveFunction(): Promise<FunctionInfo | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            logger.info('[LSPService] 没有 activeTextEditor');
            return undefined;
        }
        logger.info(`[LSPService] 当前文档: ${editor.document.uri.toString()}`);

        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            editor.document.uri
        );
        if (!symbols) {
            logger.info('[LSPService] executeDocumentSymbolProvider 返回空');
            return undefined;
        }
        // 递归寻找包含当前光标的最深层符号（通常就是函数/方法）
        const cursor = editor.selection.active;
        logger.info(`[LSPService] 光标位置: (${cursor.line}, ${cursor.character})`);
        const targetSymbol = this._findSymbolAtPosition(symbols, cursor);
        logger.info('[LSPService] 命中的符号: ' + (targetSymbol
            ? `${targetSymbol.name} [${vscode.SymbolKind[targetSymbol.kind]}] ${targetSymbol.range.start.line}-${targetSymbol.range.end.line}`
            : '无'));
        if (targetSymbol && (targetSymbol.kind === vscode.SymbolKind.Function || targetSymbol.kind === vscode.SymbolKind.Method)) {
            return {
                name: targetSymbol.name,
                code: editor.document.getText(targetSymbol.range),
                range: targetSymbol.range,
                uri: editor.document.uri
            };
        }
        logger.info('[LSPService] 找到的符号不是函数/方法，返回 undefined');
        return undefined;
    }

    // 在符号树中搜索包含特定位置的符号
    private static _findSymbolAtPosition(symbols: vscode.DocumentSymbol[], pos: vscode.Position): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.range.contains(pos)) {
                // 如果该符号有子符号，递归向深层找（例如类里的方法）
                if (symbol.children && symbol.children.length > 0) {
                    const child = this._findSymbolAtPosition(symbol.children, pos);
                    if (child) { return child; }
                }
                return symbol;
            }
        }
        return undefined;
    }
}
