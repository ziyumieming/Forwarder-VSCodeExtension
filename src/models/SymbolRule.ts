import * as vscode from 'vscode';
import { NodeType } from './GraphDefinition';

export class SymbolRule {
    /**
     * 将 LSP 返回的 SymbolKind 映射为图节点类型
     */
    public static mapSymbolKindToNodeType(kind: vscode.SymbolKind): NodeType | undefined {
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

    /**
     * 判断符号是否为没有直接物理节点对应、但是作为命名空间/容器作用的类型
     */
    public static isContainerSymbol(kind: vscode.SymbolKind): boolean {
        return kind === vscode.SymbolKind.Namespace ||
            kind === vscode.SymbolKind.Module ||
            kind === vscode.SymbolKind.Package;
    }

    /**
     * 统一的图节点 ID 生成规则
     */
    public static generateNodeId(uriString: string, nodeType: string, namespace: string, name: string): string {
        return `${uriString}#${nodeType}#${namespace}#${name}`;
    }

    /**
     * 拼接命名空间前缀
     */
    public static extendNamespace(currentNamespace: string, name: string): string {
        return currentNamespace ? `${currentNamespace}.${name}` : name;
    }
}
