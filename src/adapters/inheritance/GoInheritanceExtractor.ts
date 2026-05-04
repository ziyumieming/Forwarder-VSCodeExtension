import * as vscode from 'vscode';
import { LSPService } from '../../services/LSPServices';
import { DocumentSymbolIndex } from '../../services/AdapterServices';
import { logger } from '../../utils/logger';
import { ExtractionResult, ExtractorUtils, SymbolCache } from '../ExtractorUtils';

export class GoInheritanceExtractor {
    public static async analyze(
        document: vscode.TextDocument,
        index: DocumentSymbolIndex,
        uriString: string
    ): Promise<ExtractionResult> {
        logger.info(`[GoInheritanceExtractor.analyze] 开始分析文件: ${uriString}`);
        const edges: ExtractionResult['edges'] = [];
        const placeholderNodes: ExtractionResult['placeholderNodes'] = [];

        // 缓存已经解析过的 URI 对应的符号列表
        const cache: SymbolCache = new Map();

        // Go 中使用 typeof (Struct/Interface) 的 Symbol 作为层级起点
        // 在 index.classes (structs 将映射到 class) 和 index.interfaces 中寻找
        const targetNodes = [...index.classes, ...index.interfaces];
        logger.info(`[GoInheritanceExtractor.analyze] 检查 ${index.classes.length} 个 classes 和 ${index.interfaces.length} 个 interfaces`);

        for (const nodeItem of targetNodes) {
            logger.info(`[GoInheritanceExtractor.analyze] 处理节点: ${nodeItem.id}, kind: ${nodeItem.symbol.kind}`);
            // 获取该结构体/接口实现的父级接口或嵌入接口
            const supertypes = await LSPService.getTypeHierarchySupertypes(document.uri, nodeItem.symbol.selectionRange.start);
            if (supertypes && supertypes.length > 0) {
                logger.info(`[GoInheritanceExtractor.analyze] 节点 ${nodeItem.id} 获取到 ${supertypes.length} 个 supertypes`);
                for (const superTypeItem of supertypes) {
                    const targetUri = superTypeItem.uri;
                    const targetRange = superTypeItem.selectionRange;

                    const targetInfo = await ExtractorUtils.resolveSymbolInfo(targetUri, targetRange.start, cache);
                    logger.info(`[GoInheritanceExtractor.analyze] 解析 supertype (${targetUri.fsPath}:${targetRange.start.line}): targetInfo = ${targetInfo ? JSON.stringify(targetInfo) : 'undefined'}`);
                    if (targetInfo) {
                        // 确定 relation: Go 的 Struct (class) -> Interface 是 implements
                        // Interface -> Interface 是 extends (嵌入)
                        let relation: 'implements' | 'extends' = 'implements';
                        logger.info(`[GoInheritanceExtractor.analyze] 判断关系前: src_kind=${nodeItem.symbol.kind}, target_type=${targetInfo.type}`);
                        if (nodeItem.symbol.kind === vscode.SymbolKind.Interface && targetInfo.type === 'interface') {
                            relation = 'extends';
                        }
                        logger.info(`[GoInheritanceExtractor.analyze] 创建关系 ${relation}: ${nodeItem.id} -> ${targetInfo.id}`);

                        ExtractorUtils.addResolvedRelation(edges, placeholderNodes, nodeItem.id, targetInfo, relation);
                    }
                }
            } else {
                logger.info(`[GoInheritanceExtractor.analyze] 节点 ${nodeItem.id} 没有获取到 supertypes`);
            }
        }

        logger.info(`[GoInheritanceExtractor.analyze] 分析完成: 返回 ${edges.length} 条边, ${placeholderNodes.length} 个占位符节点`);
        const edgesByRelation: { [key: string]: number } = {};
        for (const edge of edges) {
            edgesByRelation[edge.relation] = (edgesByRelation[edge.relation] || 0) + 1;
        }
        logger.info(`[GoInheritanceExtractor.analyze] 边统计: ${JSON.stringify(edgesByRelation)}`);

        return { edges, placeholderNodes };
    }
}
