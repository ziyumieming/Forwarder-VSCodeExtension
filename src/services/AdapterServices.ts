import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { IRNode, NodeType, EdgeData } from '../models/GraphDefinition';
import { FileSymbolsPayload } from '../models/GraphManager';
import { LSPService } from './LSPServices';
import { InheritanceExtractor } from '../adapters/InheritanceExtractor';
import { SymbolRule } from '../models/SymbolRule';

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
        const document = await vscode.workspace.openTextDocument(uri);
        const symbols = await LSPService.getDocumentSymbols(uri);
        if (!symbols) {
            return undefined;
        }

        const uriString = uri.toString();
        const fingerprint = this._computeFingerprint(document, symbols);

        // 统一提取节点基本信息与包含关系边，同时建立服务于后续子Extractor分析用的扁平化语义索引
        const nodes: IRNode[] = [];
        const edges: EdgeData[] = [];
        const symbolIndex = new DocumentSymbolIndex();

        this._extractBaseStructure(symbols, uriString, '', undefined, nodes, edges, symbolIndex);

        if (fingerprint === oldFingerprint) {
            // 结构指纹未变，无需进行高昂成本的定义跳转和关系重建。包含关系也不必重建，但返回空edge数组由Manager走增量。
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
        const inheritanceResult = await InheritanceExtractor.extractEdges(document, symbolIndex, uriString, document.languageId);
        edges.push(...inheritanceResult.edges);
        nodes.push(...inheritanceResult.placeholderNodes);

        // TODO: 3. 未来在此处调用依赖组合和函数调用等Extractor分析边关系

        return {
            uri: uriString,
            nodes,
            edges,
            unchanged: false,
            fingerprint
        };
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

            // 构建节点
            nodes.push({
                id,
                name: sym.name,
                type: nodeType,
                namespace: namespace || undefined,
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
