import * as vscode from 'vscode';
import { AdapterService } from '../services/AdapterServices';
import { LSPService } from '../services/LSPServices';
import { ViewQueryService } from '../services/ViewServices';
import { ProjectGraph } from '../models/GraphManager';
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

            // 步骤 2: 调用AdapterService解析
            logger.info(`\n[Step 2] AdapterService 解析文件符号...`);
            const payload = await AdapterService.extractFileSymbols(uri);

            if (!payload) {
                logger.error('AdapterService returned undefined payload');
                logger.show();
                return;
            }

            logger.info(`AdapterService 解析结果:`, {
                uri: payload.uri,
                nodeCount: payload.nodes.length,
                edgeCount: payload.edges.length
            });

            // 步骤 3: 详细输出节点
            // logger.info(`\n[Step 3] 详细节点信息 (共 ${payload.nodes.length} 个):`, payload.nodes);

            // 步骤 4: 详细输出边关系
            logger.info(`\n[Step 4] 详细边关系 (共 ${payload.edges.length} 条):`);
            // this._logEdges(payload.edges, payload.nodes);

            // 步骤 5: 统计节点类型和跨文件关系
            logger.info(`\n[Step 5] 统计信息:`);
            this._logStatistics(payload.nodes, payload.edges);

            // 步骤 6: 通过ViewQueryService进行图查询验证
            logger.info(`\n[Step 6] 图查询验证:`);
            const graph = new ProjectGraph();
            graph.updateFileSymbols(payload);
            await this._logGraphQueries(graph, payload.nodes);

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
            if (node.placeHolder) { placeholderCount++; }
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
     * 通过ViewQueryService进行图查询验证
     */
    private static async _logGraphQueries(graph: ProjectGraph, nodes: any[]): Promise<void> {
        logger.info(`  使用 ViewQueryService 进行全局和局部查询:`);

        // 查询 1: extends 关系
        const extendsData = ViewQueryService.queryGlobalRelation(graph, ['extends'], true);
        logger.info(`\n  ├─ Extends 关系查询结果:`);
        logger.info(`    节点数: ${extendsData.nodes.length}, 边数: ${extendsData.edges.length}`);
        if (extendsData.edges.length > 0) {
            const nodeMap = new Map(extendsData.nodes.map(n => [n.id, n]));
            extendsData.edges.forEach(edge => {
                const source = nodeMap.get(edge.sourceId);
                const target = nodeMap.get(edge.targetId);
                logger.info(`      ${source?.name || '?'} extends ${target?.name || '?'}`);
            });
        }

        // 查询 2: implements 关系
        const implementsData = ViewQueryService.queryGlobalRelation(graph, ['implements'], true);
        logger.info(`\n  ├─ Implements 关系查询结果:`);
        logger.info(`    节点数: ${implementsData.nodes.length}, 边数: ${implementsData.edges.length}`);
        if (implementsData.edges.length > 0) {
            const nodeMap = new Map(implementsData.nodes.map(n => [n.id, n]));
            implementsData.edges.forEach(edge => {
                const source = nodeMap.get(edge.sourceId);
                const target = nodeMap.get(edge.targetId);
                logger.info(`      ${source?.name || '?'} implements ${target?.name || '?'}`);
            });
        }

        // 查询 3: contains 关系
        const containsData = ViewQueryService.queryGlobalRelation(graph, ['contains'], true);
        logger.info(`\n  ├─ Contains 关系查询结果:`);
        logger.info(`    节点数: ${containsData.nodes.length}, 边数: ${containsData.edges.length}`);
        if (containsData.edges.length > 0) {
            const nodeMap = new Map(containsData.nodes.map(n => [n.id, n]));
            containsData.edges.slice(0, 5).forEach(edge => {
                const source = nodeMap.get(edge.sourceId);
                const target = nodeMap.get(edge.targetId);
                logger.info(`      ${source?.name || '?'} contains ${target?.name || '?'}`);
            });
            if (containsData.edges.length > 5) {
                logger.info(`      ... 以及 ${containsData.edges.length - 5} 条边（省略）`);
            }
        }

        // 查询 4: 节点邻接网络 - 找出第一个class或interface节点作为示例
        const targetNode = nodes.find(n => n.type === 'class' || n.type === 'interface');
        if (targetNode) {
            logger.info(`\n  └─ 节点邻接网络查询示例 (节点: ${targetNode.name}):`);
            const dependencyData = ViewQueryService.queryNodeDependencies(graph, targetNode.id);
            logger.info(`    相关节点数: ${dependencyData.nodes.length}, 边数: ${dependencyData.edges.length}`);

            if (dependencyData.edges.length > 0) {
                const nodeMap = new Map(dependencyData.nodes.map(n => [n.id, n]));
                const hasCenter = dependencyData.nodes.some(n => n.id === targetNode.id);
                logger.info(`    中心节点: ${targetNode.name} (${hasCenter ? '✓' : '✗'})`);

                dependencyData.edges.forEach(edge => {
                    const source = nodeMap.get(edge.sourceId);
                    const target = nodeMap.get(edge.targetId);
                    logger.info(`      ${source?.name || '?'} [${edge.relation}] ${target?.name || '?'}`);
                });
            }
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

    /**
     * 诊断 LSP 类型层级查询
     * 提取所有类/接口/结构体，调用 getTypeHierarchySupertypes，输出父类信息及其声明源代码
     */
    public static async debugLSPTypeHierarchy(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            logger.warn('No active editor');
            logger.show();
            return;
        }

        const uri = editor.document.uri;
        const document = editor.document;
        const languageId = document.languageId;

        logger.info(`\n========== Type Hierarchy: ${languageId} ==========`);
        logger.info(`File: ${uri.fsPath}\n`);

        try {
            const symbols = await LSPService.getDocumentSymbols(uri);
            if (!symbols || symbols.length === 0) {
                logger.info('No symbols found\n');
                logger.show();
                return;
            }

            // 收集所有 class/interface/struct
            const isGoLanguage = languageId === 'go';
            const targetSymbols = isGoLanguage
                ? this._collectClassesAndInterfaces(symbols)
                : this._collectClassSymbols(symbols);

            if (targetSymbols.length === 0) {
                logger.info('No classes/interfaces found\n');
                logger.show();
                return;
            }

            // 对每个类/接口获取 supertypes
            for (const sym of targetSymbols) {
                const symKind = vscode.SymbolKind[sym.kind];
                logger.info(`► ${sym.name} [${symKind}]`);

                const supertypes = await LSPService.getTypeHierarchySupertypes(uri, sym.selectionRange.start);

                if (!supertypes || supertypes.length === 0) {
                    logger.info(`  (no supertypes)\n`);
                    continue;
                }

                // 输出每个 supertype 及其源代码
                for (const st of supertypes) {
                    logger.info(`  └─ ${st.name}`);
                    logger.info(`     at ${st.uri.fsPath}:${st.selectionRange.start.line + 1}`);

                    try {
                        // 读取父类声明所在的源代码
                        const stDoc = await vscode.workspace.openTextDocument(st.uri);
                        const line = st.selectionRange.start.line;
                        const sourceCode = stDoc.lineAt(line).text.trim();
                        logger.info(`     ${sourceCode}`);
                    } catch (e) {
                        logger.info(`     (unable to read source)`);
                    }
                }

                logger.info('');
            }

            logger.info(`========== End ==========\n`);
            logger.show();

        } catch (error) {
            logger.error(`Error: ${error}`);
            logger.show();
        }
    }

    /**
     * 递归收集所有 class、struct 和 interface 符号
     * 用于 Go 语言等支持 interface 和 struct 的语言的诊断
     */
    private static _collectClassesAndInterfaces(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
        const result: vscode.DocumentSymbol[] = [];

        for (const sym of symbols) {
            if (sym.kind === vscode.SymbolKind.Class ||
                sym.kind === vscode.SymbolKind.Interface ||
                sym.kind === vscode.SymbolKind.Struct) {
                result.push(sym);
            }
            if (sym.children && sym.children.length > 0) {
                result.push(...this._collectClassesAndInterfaces(sym.children));
            }
        }

        return result;
    }

    /**
     * 递归收集文件中所有的class符号（不包括interface）
     * 用于 Python 等传统的类继承语言的诊断
     */
    private static _collectClassSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
        const result: vscode.DocumentSymbol[] = [];

        for (const sym of symbols) {
            if (sym.kind === vscode.SymbolKind.Class) {
                result.push(sym);
            }
            if (sym.children && sym.children.length > 0) {
                result.push(...this._collectClassSymbols(sym.children));
            }
        }

        return result;
    }
}
