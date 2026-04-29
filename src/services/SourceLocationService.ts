import * as vscode from 'vscode';
import { FunctionRef, IRNode, LineCol, NodeType } from '../models/GraphDefinition';
import { ProjectGraph } from '../models/GraphManager';
import { SymbolRule } from '../models/SymbolRule';
import { LSPService } from './LSPServices';

export interface ResolvedSymbolInfo {
    id: string;
    type: NodeType;
    name: string;
    namespace: string;
    uri: vscode.Uri;
    range: vscode.Range;
}

export type SymbolCache = Map<string, vscode.DocumentSymbol[]>;

export interface FindSymbolAtPositionOptions {
    allowedKinds?: vscode.SymbolKind[];
    includeContainers?: boolean;
}

export class SourceLocationService {
    public static findSymbolAtPosition(
        symbols: vscode.DocumentSymbol[],
        position: vscode.Position,
        options: FindSymbolAtPositionOptions = {}
    ): vscode.DocumentSymbol | undefined {
        const allowedKinds = options.allowedKinds ? new Set(options.allowedKinds) : undefined;

        for (const symbol of symbols) {
            if (!symbol.range.contains(position)) {
                continue;
            }

            const child = symbol.children && symbol.children.length > 0
                ? this.findSymbolAtPosition(symbol.children, position, options)
                : undefined;
            if (child) {
                return child;
            }

            if (!allowedKinds || allowedKinds.has(symbol.kind)) {
                return symbol;
            }
        }

        return undefined;
    }

    public static async resolveSymbolInfo(
        uri: vscode.Uri,
        position: vscode.Position,
        cache?: SymbolCache
    ): Promise<ResolvedSymbolInfo | undefined> {
        const uriString = uri.toString();
        let symbols = cache?.get(uriString);
        if (!symbols) {
            symbols = await LSPService.getDocumentSymbols(uri);
            if (symbols && cache) {
                cache.set(uriString, symbols);
            }
        }
        if (!symbols) {
            return undefined;
        }

        return this.findResolvedSymbolByPosition(symbols, uriString, position, '');
    }

    public static async resolveDefinitionSymbolInfo(
        uri: vscode.Uri,
        position: vscode.Position,
        cache?: SymbolCache
    ): Promise<ResolvedSymbolInfo | undefined> {
        let definitions = await LSPService.getDefinition(uri, position);
        if (!definitions || definitions.length === 0) {
            definitions = await LSPService.getTypeDefinition(uri, position);
        }

        if (!definitions || definitions.length === 0) {
            return undefined;
        }

        for (const definition of definitions) {
            const targetUri = 'uri' in definition ? definition.uri : definition.targetUri;
            const targetRange = 'range' in definition ? definition.range : (definition.targetSelectionRange || definition.targetRange);
            if (!targetRange) {
                continue;
            }

            const targetInfo = await this.resolveSymbolInfo(targetUri, targetRange.start, cache);
            if (targetInfo && (targetInfo.type === 'class' || targetInfo.type === 'interface')) {
                return targetInfo;
            }
        }

        return undefined;
    }

    public static findGraphNodesContainingPosition(
        graph: ProjectGraph,
        uri: string,
        position: LineCol,
        allowedTypes?: NodeType[]
    ): IRNode[] {
        const result: IRNode[] = [];

        for (const node of graph.getNodesForFile(uri, allowedTypes)) {
            if (this.containsPosition(node.location.range, position)) {
                result.push(node);
            }
        }

        return result.sort((left, right) => {
            const leftSpan = this.rangeSpan(left.location.range);
            const rightSpan = this.rangeSpan(right.location.range);
            if (leftSpan !== rightSpan) {
                return leftSpan - rightSpan;
            }

            return left.name.localeCompare(right.name);
        });
    }

    public static async resolveFunctionRefAtPosition(
        graph: ProjectGraph,
        uri: vscode.Uri,
        position: vscode.Position,
        source: FunctionRef['source'] = 'editor'
    ): Promise<FunctionRef | undefined> {
        const uriString = uri.toString();
        const lineCol: LineCol = { line: position.line, character: position.character };
        const graphNode = this.findGraphNodesContainingPosition(graph, uriString, lineCol, ['function', 'method'])[0];
        if (graphNode) {
            return this.toFunctionRef(graphNode, source);
        }

        const symbols = await LSPService.getDocumentSymbols(uri);
        const callable = symbols ? this.findSymbolAtPosition(symbols, position, {
            allowedKinds: [vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor]
        }) : undefined;
        if (!callable) {
            return undefined;
        }

        const matchingGraphNode = graph
            .getNodesForFile(uriString, ['function', 'method'])
            .find(node => node.name === callable.name
                && node.location.range.start.line === callable.range.start.line
                && node.location.range.start.character === callable.range.start.character);

        return matchingGraphNode ? this.toFunctionRef(matchingGraphNode, source) : undefined;
    }

    public static toFunctionRef(node: IRNode, source: FunctionRef['source']): FunctionRef {
        return {
            id: node.id,
            label: node.signature || node.name,
            meta: node.namespace || this.summarizeUri(node.location.uri),
            source
        };
    }

    public static summarizeUri(uri: string): string {
        const parts = uri.replace(/\\/g, '/').split('/').filter(part => part.length > 0);
        return parts.length > 0 ? parts[parts.length - 1] : uri;
    }

    private static findResolvedSymbolByPosition(
        symbols: vscode.DocumentSymbol[],
        uriString: string,
        position: vscode.Position,
        namespace: string
    ): ResolvedSymbolInfo | undefined {
        for (const symbol of symbols) {
            if (!symbol.range.contains(position)) {
                continue;
            }

            let childNamespace = namespace;
            const nodeType = SymbolRule.mapSymbolKindToNodeType(symbol.kind);

            if (nodeType || SymbolRule.isContainerSymbol(symbol.kind)) {
                childNamespace = SymbolRule.extendNamespace(namespace, symbol.name);
            }

            const child = symbol.children && symbol.children.length > 0
                ? this.findResolvedSymbolByPosition(symbol.children, uriString, position, childNamespace)
                : undefined;
            if (child) {
                return child;
            }

            if (nodeType) {
                return {
                    id: SymbolRule.generateNodeId(uriString, nodeType, namespace, symbol.name),
                    type: nodeType,
                    name: symbol.name,
                    namespace,
                    uri: vscode.Uri.parse(uriString),
                    range: symbol.range
                };
            }
        }

        return undefined;
    }

    private static containsPosition(range: { start: LineCol; end: LineCol }, position: LineCol): boolean {
        const afterStart = position.line > range.start.line
            || (position.line === range.start.line && position.character >= range.start.character);
        const beforeEnd = position.line < range.end.line
            || (position.line === range.end.line && position.character <= range.end.character);
        return afterStart && beforeEnd;
    }

    private static rangeSpan(range: { start: LineCol; end: LineCol }): number {
        return (range.end.line - range.start.line) * 100000
            + (range.end.character - range.start.character);
    }
}
