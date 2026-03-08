import * as vscode from 'vscode';
import { IRNode, NodeType, EdgeRelation, EdgeData } from '../models/graphdefinition';
import { FileSymbolsPayload } from '../models/graphmanager';
import { LSPService } from './LSPservices';

export class GraphService {
    /**
     * 提取和转换指定文件的结构数据，生成给统一图数据结构的IR及其包含关系边
     */
    public static async extractFileSymbols(uri: vscode.Uri): Promise<FileSymbolsPayload | undefined> {
        const symbols = await LSPService.getDocumentSymbols(uri);
        if (!symbols) {
            return undefined;
        }

        const nodes: IRNode[] = [];
        const edges: EdgeData[] = [];
        const uriString = uri.toString();

        this._processSymbols(symbols, uriString, '', nodes, edges);

        return {
            uri: uriString,
            nodes,
            edges
        };
    }

    private static _processSymbols(
        symbols: vscode.DocumentSymbol[],
        uriString: string,
        namespace: string,
        nodes: IRNode[],
        edges: EdgeData[],
        parentId?: string
    ): void {
        for (const sym of symbols) {
            const nodeType = this._mapSymbolKindToNodeType(sym.kind);
            if (!nodeType) {
                // 忽略非目标类型，但可能其内部包含我们要的类型实体，因此继续向内遍历
                if (sym.children && sym.children.length > 0) {
                    this._processSymbols(sym.children, uriString, namespace, nodes, edges, parentId);
                }
                continue;
            }

            // 通过层级关系拼接唯一的ID
            const id = `${uriString}#${nodeType}#${namespace}#${sym.name}`;

            const node: IRNode = {
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
                }
            };
            nodes.push(node);

            // 如果有父节点，建立包含关系
            if (parentId) {
                edges.push({
                    sourceId: parentId,
                    targetId: id,
                    relation: 'contains'
                });
            }

            // 递归处理子节点，当前节点将作为子节点的命名空间前缀
            if (sym.children && sym.children.length > 0) {
                const childNamespace = namespace ? `${namespace}.${sym.name}` : sym.name;
                this._processSymbols(sym.children, uriString, childNamespace, nodes, edges, id);
            }
        }
    }

    private static _mapSymbolKindToNodeType(kind: vscode.SymbolKind): NodeType | undefined {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return 'class';
            case vscode.SymbolKind.Interface:
                return 'interface';
            case vscode.SymbolKind.Function:
                return 'function';
            case vscode.SymbolKind.Method:
                return 'method';
            case vscode.SymbolKind.File:
                return 'file';
            default:
                return undefined;
        }
    }
}
