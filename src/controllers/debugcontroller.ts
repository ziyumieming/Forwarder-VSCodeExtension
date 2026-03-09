import * as vscode from 'vscode';
import { AdapterService } from '../services/adapterservices';
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
            const payload = await AdapterService.extractFileSymbols(uri);

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
            logger.info(`\n[Step 4] 详细边关系 (共 ${payload.edges.length} 条):`);
            this._logEdges(payload.edges, payload.nodes);

            // 步骤 5: 统计节点类型和跨文件关系
            logger.info(`\n[Step 5] 统计信息:`);
            this._logStatistics(payload.nodes, payload.edges);

            logger.info(`========== DEBUG: 分析完成 ==========`);
            logger.show();

        } catch (error) {
            logger.error(`Debug analysis failed: ${error}`);
            logger.show();
        }
    }

    /**
     * 格式化输出边关系，区分contains和extends/implements关系
     */
    private static _logEdges(edges: any[], nodes: any[]): void {
        const nodeMap = new Map<string, any>();
        nodes.forEach(node => nodeMap.set(node.id, node));

        // 分类边
        const containsEdges = edges.filter(e => e.relation === 'contains');
        const extendsEdges = edges.filter(e => e.relation === 'extends');
        const implementsEdges = edges.filter(e => e.relation === 'implements');
        const otherEdges = edges.filter(e => !['contains', 'extends', 'implements'].includes(e.relation));

        if (containsEdges.length > 0) {
            logger.info(`\n  ▼ Contains关系 (${containsEdges.length} 条) - 父子包含:`);
            containsEdges.forEach(edge => {
                const source = nodeMap.get(edge.sourceId);
                const target = nodeMap.get(edge.targetId);
                const sourceLabel = source ? `${source.name}` : 'unknown';
                const targetLabel = target ? `${target.name}` : 'unknown';
                logger.info(`    ├─ ${sourceLabel} contains ${targetLabel}`);
            });
        }

        if (extendsEdges.length > 0) {
            logger.info(`\n  ▼ Extends关系 (${extendsEdges.length} 条) - 类继承:`);
            extendsEdges.forEach(edge => {
                const source = nodeMap.get(edge.sourceId);
                const target = nodeMap.get(edge.targetId);
                const sourceLabel = source ? `${source.name}` : 'unknown';
                const targetLabel = target ? `${target.name}` : 'unknown';
                logger.info(`    ├─ ${sourceLabel} extends ${targetLabel}`);
            });
        }

        if (implementsEdges.length > 0) {
            logger.info(`\n  ▼ Implements关系 (${implementsEdges.length} 条) - 接口实现:`);
            implementsEdges.forEach(edge => {
                const source = nodeMap.get(edge.sourceId);
                const target = nodeMap.get(edge.targetId);
                const sourceLabel = source ? `${source.name}` : 'unknown';
                const targetLabel = target ? `${target.name}` : 'unknown';
                logger.info(`    ├─ ${sourceLabel} implements ${targetLabel}`);
            });
        }

        if (otherEdges.length > 0) {
            logger.info(`\n  ▼ 其他关系 (${otherEdges.length} 条):`);
            otherEdges.forEach(edge => {
                const source = nodeMap.get(edge.sourceId);
                const target = nodeMap.get(edge.targetId);
                const sourceLabel = source ? `${source.name}` : 'unknown';
                const targetLabel = target ? `${target.name}` : 'unknown';
                logger.info(`    ├─ ${sourceLabel} [${edge.relation}] ${targetLabel}`);
            });
        }
    }

    /**
     * 输出统计信息：节点类型分布、占位符节点、跨文件关系
     */
    private static _logStatistics(nodes: any[], edges: any[]): void {
        const typeCount = new Map<string, number>();
        let placeholderCount = 0;
        const uriSet = new Set<string>();

        nodes.forEach(node => {
            typeCount.set(node.type, (typeCount.get(node.type) || 0) + 1);
            if (node.placeHolder) placeholderCount++;
            uriSet.add(node.location.uri);
        });

        logger.info(`  节点类型分布:`);
        typeCount.forEach((count, type) => {
            logger.info(`    ├─ ${type}: ${count}`);
        });

        logger.info(`  文件范围: ${uriSet.size} 个文件`);
        logger.info(`  占位符节点: ${placeholderCount} 个（来自外部文件）`);

        const relationCount = new Map<string, number>();
        edges.forEach(edge => {
            relationCount.set(edge.relation, (relationCount.get(edge.relation) || 0) + 1);
        });

        if (relationCount.size > 0) {
            logger.info(`  关系类型分布:`);
            relationCount.forEach((count, relation) => {
                logger.info(`    ├─ ${relation}: ${count}`);
            });
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
