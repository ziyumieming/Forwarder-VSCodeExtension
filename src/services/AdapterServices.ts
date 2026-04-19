import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { IRNode, NodeType, EdgeData, FileSymbolsPayload } from '../models/GraphDefinition';
import { LSPService } from './LSPServices';
import { InheritanceExtractor, CompositionExtractor } from '../adapters/Extractor';
import { SymbolRule } from '../models/SymbolRule';
import { logger } from '../utils/logger';

export interface IndexedSymbol {
    id: string;
    symbol: vscode.DocumentSymbol;
    namespace: string;
}

export class DocumentSymbolIndex {
    classes: IndexedSymbol[] = [];
    interfaces: IndexedSymbol[] = [];
    functions: IndexedSymbol[] = [];
    methods: IndexedSymbol[] = [];
    // 未来可结合需求扩展其他的索引，如 variables
}

export class AdapterService {
    /**
     * 提取和转换指定文件的结构数据，生成给统一图数据结构的IR及其包含关系边
     */
    public static async extractFileSymbols(uri: vscode.Uri, oldFingerprint?: string): Promise<FileSymbolsPayload | undefined> {
        logger.info(`[AdapterService.extractFileSymbols] 开始提取文件: ${uri.fsPath}`);
        const document = await vscode.workspace.openTextDocument(uri);
        const symbols = await LSPService.getDocumentSymbols(uri);
        if (!symbols) {
            logger.warn(`[AdapterService.extractFileSymbols] 无法取得 LSP document symbols`);
            return undefined;
        }

        const uriString = uri.toString();
        const fingerprint = this._computeFingerprint(document, symbols);

        // 统一提取节点基本信息与包含关系边，同时建立服务于后续子Extractor分析用的扁平化语义索引
        const nodes: IRNode[] = [];
        const edges: EdgeData[] = [];
        const symbolIndex = new DocumentSymbolIndex();

        this._extractBaseStructure(symbols, uriString, '', undefined, nodes, edges, symbolIndex);

        logger.info(`[AdapterService.extractFileSymbols] 基础结构提取完毕: ${nodes.length} 个节点, ${edges.length} 条边`);
        const baseEdgesByRelation: { [key: string]: number } = {};
        for (const edge of edges) {
            baseEdgesByRelation[edge.relation] = (baseEdgesByRelation[edge.relation] || 0) + 1;
        }
        logger.info(`[AdapterService.extractFileSymbols] 基础边统计: ${JSON.stringify(baseEdgesByRelation)}`);

        if (fingerprint === oldFingerprint) {
            // 结构指纹未变，无需进行高昂成本的定义跳转和关系重建。包含关系也不必重建，但返回空edge数组由Manager走增量。
            logger.info(`[AdapterService.extractFileSymbols] 结构指纹未变，跳过继承关系重建`);
            return {
                uri: uriString,
                nodes,
                edges: [],
                unchanged: true,
                fingerprint
            };
        }

        // 2. 针对各大语言具体特性的类继承探测
        //在单文件查询时，所有在之后其他文件的扫描中会出现的节点在本次扫描是不可见的，所以它和被屏蔽的文件一样不会在本次adapter提交的内容中显示，在图数据结构中就都不会建立关系。所以有必要对边的目标节点新建占位符
        logger.info(`[AdapterService.extractFileSymbols] 开始提取继承关系（语言: ${document.languageId}）`);
        const inheritanceResult = await InheritanceExtractor.extractEdges(document, symbolIndex, uriString, document.languageId);
        logger.info(`[AdapterService.extractFileSymbols] 继承关系提取完毕: ${inheritanceResult.edges.length} 条边, ${inheritanceResult.placeholderNodes.length} 个占位符节点`);

        const inheritanceEdgesByRelation: { [key: string]: number } = {};
        for (const edge of inheritanceResult.edges) {
            inheritanceEdgesByRelation[edge.relation] = (inheritanceEdgesByRelation[edge.relation] || 0) + 1;
        }
        logger.info(`[AdapterService.extractFileSymbols] 继承边统计: ${JSON.stringify(inheritanceEdgesByRelation)}`);

        edges.push(...inheritanceResult.edges);
        nodes.push(...inheritanceResult.placeholderNodes);

        logger.info(`[AdapterService.extractFileSymbols] 合并后: ${nodes.length} 个节点总数, ${edges.length} 条边总数`);
        const finalEdgesByRelation: { [key: string]: number } = {};
        for (const edge of edges) {
            finalEdgesByRelation[edge.relation] = (finalEdgesByRelation[edge.relation] || 0) + 1;
        }
        logger.info(`[AdapterService.extractFileSymbols] 最终合并边统计: ${JSON.stringify(finalEdgesByRelation)}`);

        // 3. 组合/引用 关系抽取（成员变量提取等）
        logger.info(`[AdapterService.extractFileSymbols] 开始提取组合关系（字段引用）`);
        const compositionResult = await CompositionExtractor.analyze(document, symbolIndex, uriString);
        logger.info(`[AdapterService.extractFileSymbols] 组合关系提取完毕: ${compositionResult.edges.length} 条边, ${compositionResult.placeholderNodes.length} 个占位符节点`);

        edges.push(...compositionResult.edges);
        nodes.push(...compositionResult.placeholderNodes);

        const result: FileSymbolsPayload = {
            uri: uriString,
            nodes,
            edges,
            unchanged: false,
            fingerprint
        };

        logger.info(`[AdapterService.extractFileSymbols] 返回 payload: nodes=${result.nodes.length}, edges=${result.edges.length}, extends边=${result.edges.filter(e => e.relation === 'extends').length}`);

        return result;
    }

    /**
     * 计算文档语义结构指纹
     * 提取影响图拓扑的关键特征：符号类型、名称、内部层级以及类/接口的声明头（包含 extends/implements 语句）
     */
    private static _computeFingerprint(document: vscode.TextDocument, symbols: vscode.DocumentSymbol[]): string {
        const hashStr = this._hashSymbols(document, symbols);
        return crypto.createHash('md5').update(hashStr).digest('hex');
    }

    private static _hashSymbols(document: vscode.TextDocument, symbols: vscode.DocumentSymbol[]): string {
        let str = '';
        for (const sym of symbols) {
            const type = SymbolRule.mapSymbolKindToNodeType(sym.kind);
            if (type) {
                str += `${type}:${sym.name}:`;
                if (type === 'class' || type === 'interface') {
                    const sigRange = new vscode.Range(sym.selectionRange.end, sym.range.end);
                    let sigText = document.getText(sigRange);
                    const braceIndex = sigText.indexOf('{');
                    if (braceIndex !== -1) {
                        sigText = sigText.substring(0, braceIndex);
                    }
                    // 收录声明头，因为里面包含改变被扫描对象之间横向关系的extends/implements短语
                    str += `${sigText};`;
                }
            }
            if (sym.children && sym.children.length > 0) {
                str += '[' + this._hashSymbols(document, sym.children) + ']';
            }
        }
        return str;
    }

    /**
     * 统一提取文档本地域节点基本信息、包含关系边界并且同时生成供外部使用的分类索引
     */
    private static _extractBaseStructure(
        symbols: vscode.DocumentSymbol[],
        uriString: string,
        namespace: string,
        parentId: string | undefined,
        nodes: IRNode[],
        edges: EdgeData[],
        index: DocumentSymbolIndex
    ): void {
        for (const sym of symbols) {
            const nodeType = SymbolRule.mapSymbolKindToNodeType(sym.kind);
            if (!nodeType) {
                if (sym.children && sym.children.length > 0) {
                    const childNamespace = SymbolRule.isContainerSymbol(sym.kind)
                        ? SymbolRule.extendNamespace(namespace, sym.name)
                        : namespace;
                    this._extractBaseStructure(sym.children, uriString, childNamespace, parentId, nodes, edges, index);
                }
                continue;
            }

            const id = SymbolRule.generateNodeId(uriString, nodeType, namespace, sym.name);

            // 获取类或接口的字段信息
            let fields: { name: string; type?: string; signature?: string; range?: { start: { line: number, character: number }, end: { line: number, character: number } } }[] | undefined;
            if (nodeType === 'class' || nodeType === 'interface') {
                fields = [];
                if (sym.children) {
                    for (const child of sym.children) {
                        if (
                            child.kind === vscode.SymbolKind.Field ||
                            child.kind === vscode.SymbolKind.Property ||
                            child.kind === vscode.SymbolKind.Variable
                        ) {
                            fields.push({
                                name: child.name,
                                type: child.detail,
                                range: {
                                    start: { line: child.selectionRange.start.line, character: child.selectionRange.start.character },
                                    end: { line: child.selectionRange.end.line, character: child.selectionRange.end.character }
                                }
                            });
                        }
                    }
                }
            }

            // 构建节点
            nodes.push({
                id,
                name: sym.name,
                type: nodeType,
                namespace: namespace || undefined,
                fields: fields && fields.length > 0 ? fields : undefined,
                location: {
                    uri: uriString,
                    range: {
                        start: { line: sym.range.start.line, character: sym.range.start.character },
                        end: { line: sym.range.end.line, character: sym.range.end.character }
                    }
                },
                placeHolder: false
            });

            // 如果有父级传入，直接在此闭环注册包含关系
            if (parentId) {
                edges.push({
                    sourceId: parentId,
                    targetId: id,
                    relation: 'contains'
                });
            }

            // 更新特定分类类型的扁平语义缓存索引
            const indexedSym: IndexedSymbol = { id, symbol: sym, namespace };
            if (nodeType === 'class') {
                index.classes.push(indexedSym);
            } else if (nodeType === 'interface') {
                index.interfaces.push(indexedSym);
            } else if (nodeType === 'function') {
                index.functions.push(indexedSym);
            } else if (nodeType === 'method') {
                index.methods.push(indexedSym);
            }

            // 递归向下
            if (sym.children && sym.children.length > 0) {
                const childNamespace = SymbolRule.extendNamespace(namespace, sym.name);
                this._extractBaseStructure(sym.children, uriString, childNamespace, id, nodes, edges, index);
            }
        }
    }
}
