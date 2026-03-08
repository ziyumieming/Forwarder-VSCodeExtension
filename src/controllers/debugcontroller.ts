import * as vscode from 'vscode';
import { GraphService } from '../services/graphservices';
import { LSPService } from '../services/LSPservices';
import { logger } from '../utils/logger';

export class DebugController {
    /**
     * 分析当前活跃文件，并输出LSP解析结果和GraphService处理结果到Channel
     */
    public static async debugAnalyzeCurrentFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            logger.warn('No active editor found');
            logger.show();
            return;
        }

        const uri = editor.document.uri;
        logger.info(`========== DEBUG: Analyzing File ==========`);
        logger.info(`File: ${uri.fsPath}`);

        try {
            // 步骤 1: 获取LSP符号树
            logger.info(`\n[Step 1] 获取LSP文档符号...`);
            const symbols = await LSPService.getDocumentSymbols(uri);

            if (!symbols || symbols.length === 0) {
                logger.warn('No symbols found from LSP');
                logger.show();
                return;
            }

            logger.info(`LSP 符号树 (共 ${symbols.length} 个顶级符号):`, symbols);
            this._logSymbolTree(symbols, 1);

            // 步骤 2: 调用GraphService解析
            logger.info(`\n[Step 2] GraphService 解析文件符号...`);
            const payload = await GraphService.extractFileSymbols(uri);

            if (!payload) {
                logger.error('GraphService returned undefined payload');
                logger.show();
                return;
            }

            logger.info(`GraphService 解析结果:`, {
                uri: payload.uri,
                nodeCount: payload.nodes.length,
                edgeCount: payload.edges.length
            });

            // 步骤 3: 详细输出节点
            logger.info(`\n[Step 3] 详细节点信息 (共 ${payload.nodes.length} 个):`, payload.nodes);

            // 步骤 4: 详细输出边关系
            logger.info(`\n[Step 4] 详细边关系 (共 ${payload.edges.length} 条):`, payload.edges);

            logger.info(`========== DEBUG: 分析完成 ==========`);
            logger.show();

        } catch (error) {
            logger.error(`Debug analysis failed: ${error}`);
            logger.show();
        }
    }

    /**
     * 递归输出符号树的层级结构便于人眼阅读
     */
    private static _logSymbolTree(
        symbols: vscode.DocumentSymbol[],
        depth: number
    ): void {
        for (const symbol of symbols) {
            const indent = '  '.repeat(depth);
            const kind = vscode.SymbolKind[symbol.kind];
            const lines = `${symbol.range.start.line + 1}-${symbol.range.end.line + 1}`;
            logger.info(`${indent}├─ ${symbol.name} [${kind}] (lines ${lines})`);

            if (symbol.children && symbol.children.length > 0) {
                this._logSymbolTree(symbol.children, depth + 1);
            }
        }
    }
}
