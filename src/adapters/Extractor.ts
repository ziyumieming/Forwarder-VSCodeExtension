import * as vscode from 'vscode';
import { EdgeData, IRNode, NodeType } from '../models/GraphDefinition';
import { PythonInheritanceExtractor } from './inheriance/PythonInheritanceExtractor';
import { GoInheritanceExtractor } from './inheriance/GoInheritanceExtractor';
import { LSPService } from '../services/LSPServices';
import { SymbolRule } from '../models/SymbolRule';
import { DocumentSymbolIndex } from '../services/AdapterServices';

export class ExtractorUtils {
    public static async resolveSymbolInfo(
        uri: vscode.Uri,
        position: vscode.Position,
        cache: Map<string, vscode.DocumentSymbol[]>
    ): Promise<{ id: string, type: NodeType, name: string, namespace: string } | undefined> {
        const uriStr = uri.toString();
        let symbols = cache.get(uriStr);
        if (!symbols) {
            symbols = await LSPService.getDocumentSymbols(uri);
            if (symbols) {
                cache.set(uriStr, symbols);
            }
        }
        if (!symbols) { return undefined; }

        return this.findSymbolByPosition(symbols, uriStr, position, '');
    }

    private static findSymbolByPosition(
        symbols: vscode.DocumentSymbol[],
        uriString: string,
        pos: vscode.Position,
        namespace: string
    ): any {
        for (const sym of symbols) {
            if (sym.range.contains(pos)) {
                let childNamespace = namespace;
                const nodeType = SymbolRule.mapSymbolKindToNodeType(sym.kind);

                if (nodeType || SymbolRule.isContainerSymbol(sym.kind)) {
                    childNamespace = SymbolRule.extendNamespace(namespace, sym.name);
                }

                if (sym.children && sym.children.length > 0) {
                    const childRes = this.findSymbolByPosition(sym.children, uriString, pos, childNamespace);
                    if (childRes) { return childRes; }
                }

                if (nodeType) {
                    return {
                        id: SymbolRule.generateNodeId(uriString, nodeType, namespace, sym.name),
                        type: nodeType,
                        name: sym.name,
                        namespace: namespace
                    };
                }
            }
        }
        return undefined;
    }
}



export class InheritanceExtractor {
    public static async extractEdges(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string,
        languageId: string  // 从 document.languageId 传进来
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        switch (languageId) {
            case 'go':
                return await GoInheritanceExtractor.analyze(document, index, uriString);
            case 'python':
                return await PythonInheritanceExtractor.analyze(document, index, uriString);
            // case 'typescript':
            // case 'javascript':
            // case 'java':
            default:
                return { edges: [], placeholderNodes: [] };
        }
    }
}

export class CompositionExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];
        const cache = new Map<string, vscode.DocumentSymbol[]>();

        const targetNodes = [...index.classes, ...index.interfaces];

        for (const clsItem of targetNodes) {
            if (!clsItem.symbol.children) { continue; }

            for (const child of clsItem.symbol.children) {
                if (
                    child.kind === vscode.SymbolKind.Field ||
                    child.kind === vscode.SymbolKind.Property ||
                    child.kind === vscode.SymbolKind.Variable
                ) {
                    const definitions = await LSPService.getTypeDefinition(document.uri, child.selectionRange.end);
                    if (!definitions || definitions.length === 0) { continue; }

                    for (const def of definitions) {
                        const targetUri = 'uri' in def ? def.uri : def.targetUri;
                        const targetRange = 'range' in def ? def.range : (def.targetSelectionRange || def.targetRange);

                        if (!targetRange) { continue; }

                        const targetInfo = await ExtractorUtils.resolveSymbolInfo(targetUri, targetRange.start, cache);
                        if (targetInfo && (targetInfo.type === 'class' || targetInfo.type === 'interface')) {
                            // 跳过自己引用自己
                            if (clsItem.id === targetInfo.id) {
                                continue;
                            }

                            edges.push({
                                sourceId: clsItem.id,
                                targetId: targetInfo.id,
                                relation: 'composes'
                            });

                            const isLibrary = !vscode.workspace.getWorkspaceFolder(targetUri);
                            placeholderNodes.push({
                                id: targetInfo.id,
                                name: targetInfo.name,
                                type: targetInfo.type,
                                namespace: targetInfo.namespace || undefined,
                                location: {
                                    uri: targetUri.toString(),
                                    range: {
                                        start: { line: targetRange.start.line, character: targetRange.start.character },
                                        end: { line: targetRange.end.line, character: targetRange.end.character }
                                    }
                                },
                                placeHolder: true,
                                isLibrary: isLibrary
                            });
                        }
                    }
                }
            }
        }

        return { edges, placeholderNodes };
    }
}

export class DependencyExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string,
        languageId: string
    ): Promise<{ edges: EdgeData[], placeholderNodes: IRNode[] }> {
        const edges: EdgeData[] = [];
        const placeholderNodes: IRNode[] = [];
        const cache = new Map<string, vscode.DocumentSymbol[]>();

        const targetNodes = [...index.classes, ...index.interfaces];

        for (const clsItem of targetNodes) {
            if (!clsItem.symbol.children) { continue; }

            for (const child of clsItem.symbol.children) {
                // 仅从方法或函数中提取依赖关系（如参数、返回值等）
                if (child.kind === vscode.SymbolKind.Method || child.kind === vscode.SymbolKind.Function) {

                    const positionsToQuery: vscode.Position[] = this.extractTypesPositionsFromMethod(document, child, languageId);

                    for (const pos of positionsToQuery) {
                        // 尝试获取符号的定义，若失败则回退尝试类型定义
                        let definitions = await LSPService.getDefinition(document.uri, pos);
                        if (!definitions || definitions.length === 0) {
                            definitions = await LSPService.getTypeDefinition(document.uri, pos);
                        }

                        if (!definitions || definitions.length === 0) { continue; }

                        for (const def of definitions) {
                            const targetUri = 'uri' in def ? def.uri : def.targetUri;
                            const targetRange = 'range' in def ? def.range : (def.targetSelectionRange || def.targetRange);

                            if (!targetRange) { continue; }

                            const targetInfo = await ExtractorUtils.resolveSymbolInfo(targetUri, targetRange.start, cache);

                            // 仅构建指向类或接口的依赖（uses）关系
                            if (targetInfo && (targetInfo.type === 'class' || targetInfo.type === 'interface')) {
                                // 跳过自引用
                                if (clsItem.id === targetInfo.id) {
                                    continue;
                                }

                                // 避免重复添加相同的依赖边
                                const edgeExists = edges.some(e => e.sourceId === clsItem.id && e.targetId === targetInfo.id && e.relation === 'uses');
                                if (edgeExists) {
                                    continue;
                                }

                                edges.push({
                                    sourceId: clsItem.id,
                                    targetId: targetInfo.id,
                                    relation: 'uses'
                                });

                                const isLibrary = !vscode.workspace.getWorkspaceFolder(targetUri);
                                placeholderNodes.push({
                                    id: targetInfo.id,
                                    name: targetInfo.name,
                                    type: targetInfo.type,
                                    namespace: targetInfo.namespace || undefined,
                                    location: {
                                        uri: targetUri.toString(),
                                        range: {
                                            start: { line: targetRange.start.line, character: targetRange.start.character },
                                            end: { line: targetRange.end.line, character: targetRange.end.character }
                                        }
                                    },
                                    placeHolder: true,
                                    isLibrary: isLibrary
                                });
                            }
                        }
                    }
                }
            }
        }

        return { edges, placeholderNodes };
    }

    /**
     * 从方法签名中提取可能对应的类型标识符位置，支持多种语言处理
     */
    private static extractTypesPositionsFromMethod(
        document: vscode.TextDocument,
        methodSymbol: vscode.DocumentSymbol,
        languageId: string
    ): vscode.Position[] {
        const positions: vscode.Position[] = [];

        const startPos = methodSymbol.selectionRange.start;
        const endPos = methodSymbol.range.end;

        // 提取前5行作为签名搜索范围
        const signatureEndLine = Math.min(startPos.line + 5, endPos.line);
        const signatureEndPos = new vscode.Position(signatureEndLine, document.lineAt(signatureEndLine).text.length);

        const rawText = document.getText(new vscode.Range(startPos, signatureEndPos));

        // 截断方法体
        let signatureText = rawText;
        const braceIdx = rawText.indexOf('{');
        if (braceIdx !== -1) {
            signatureText = rawText.substring(0, braceIdx);
        } else if (languageId === 'python') {
            const colonIdx = rawText.indexOf(':');
            if (colonIdx !== -1) {
                signatureText = rawText.substring(0, colonIdx);
            }
        }

        // 语言特定关键字过滤
        const skipWords = new Set<string>();
        if (languageId === 'python') {
            ['def', 'self', 'cls', 'None', 'int', 'str', 'bool', 'float', 'list', 'dict', 'set', 'tuple', 'Any', 'Callable'].forEach(w => skipWords.add(w));
        } else if (languageId === 'go') {
            ['func', 'error', 'int', 'int32', 'int64', 'string', 'bool', 'byte', 'rune', 'float32', 'float64'].forEach(w => skipWords.add(w));
        } else if (languageId === 'typescript' || languageId === 'javascript') {
            ['public', 'private', 'protected', 'static', 'async', 'get', 'set', 'function', 'void', 'any', 'string', 'number', 'boolean', 'Promise', 'Array'].forEach(w => skipWords.add(w));
        }

        // 匹配可能的类型标识符并计算其绝对位置
        const wordRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
        let match;
        while ((match = wordRegex.exec(signatureText)) !== null) {
            const word = match[0];
            if (word === methodSymbol.name || skipWords.has(word)) {
                continue;
            }

            const offset = match.index;
            const textBeforeMatch = signatureText.substring(0, offset);
            const newLinesCount = (textBeforeMatch.match(/\n/g) || []).length;

            let absLine = startPos.line + newLinesCount;
            let absChar = 0;

            if (newLinesCount === 0) {
                absChar = startPos.character + offset;
            } else {
                const lastNewLineIdx = textBeforeMatch.lastIndexOf('\n');
                absChar = textBeforeMatch.length - lastNewLineIdx - 1;
            }

            // 取单词中间位置以供 LSP 查询
            const targetChar = absChar + Math.floor(word.length / 2);
            positions.push(new vscode.Position(absLine, targetChar));
        }

        return positions;
    }
}
