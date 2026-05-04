
export interface LineCol {
    line: number;
    character: number;
}

export type NodeType = 'file' | 'class' | 'interface' | 'method' | 'function';

export interface IRNode {
    id: string;             // 唯一标识 (例如: Uri#Type#Namespace#Name)
    name: string;           // 显示名称
    type: NodeType;
    location: {             // 用于点击跳转和源码提取
        uri: string;
        range: { start: LineCol; end: LineCol };
    };
    placeHolder?: boolean;    // 是否为占位节点（外部文件临时添加）
    isLibrary?: boolean;      // 是否来源于标准库或第三方库

    // 节点类型特定的补充信息
    namespace?: string;     // 如类/接口的命名空间
    signature?: string;     // 如函数/方法的签名（参数列表等）
    fields?: { name: string; type?: string; signature?: string; range?: { start: LineCol; end: LineCol } }[]; // 类的字段列表

    sourceCode?: string;    // 该节点的源码片段 (按需填充供 LLM 使用)
    semanticData?: {        // 语义模块填充位
        summary?: string;     // AI 生成的描述
        tags?: string[];      // 如 ["Entry", "Deprecated", "Utility"]
    };
}

export type EdgeRelation = 'contains' | 'extends' | 'implements' | 'calls' | 'references' | 'composes' | 'uses' | 'aggregates';


export interface EdgeData {
    sourceId: string;
    targetId: string;
    relation: EdgeRelation;
}

export interface FunctionRef {
    id: string;
    label: string;
    meta?: string;
    source?: 'editor' | 'class-card' | 'call-graph';
    pendingGraphNode?: boolean;
}

export interface FunctionSummaryData {
    nodeId: string;
    label: string;
    summary: string;
    summaryLanguage?: 'en' | 'zh-CN';
    modelId?: string;
    modelName?: string;
    generatedAt: string;
    bodyHash?: string;
    stale?: boolean;
    cacheStatus?: 'memory-hit' | 'index-disk-hit' | 'generated' | 'force-regenerated' | 'error';
    historyIndex?: number;
    historyCount?: number;
    promptVersion?: string;
}

export interface SummaryContextCoverage {
    totalRelatedNodes: number;
    summarizedRelatedNodes: number;
    briefRelatedNodes: number;
    unsummarizedRelatedNodes: number;
    methodSummaryCount?: number;
    methodCount?: number;
}

export interface ClassSummaryData extends FunctionSummaryData {
    ownStale?: boolean;
    relationContextStale?: boolean;
    relationContextHash?: string;
    contextCoverage?: SummaryContextCoverage;
    usedContextNodeIds?: string[];
    missingContextNodeIds?: string[];
}

export interface CallPathStepContext {
    order: number;
    nodeId: string;
    label: string;
    signature?: string;
    fileName?: string;
    summary?: string;
    stale?: boolean;
}

export interface CallPathSummaryContext {
    waypointIds: string[];
    waypointLabels: string[];
    steps: CallPathStepContext[];
    direction?: 'incoming' | 'outgoing' | 'both';
    depth?: number;
    truncated?: boolean;
    segments?: {
        sourceLabel: string;
        targetLabel: string;
        pathFound: boolean;
        depth: number;
        reason?: string;
    }[];
    missingSummaryNodeIds: string[];
    staleSummaryNodeIds: string[];
}

export interface CallPathSummaryResult {
    requestId: string;
    summary: string;
    summaryLanguage?: 'en' | 'zh-CN';
    generatedAt: string;
    modelName?: string;
    modelId?: string;
    missingSummaryNodeIds?: string[];
    staleSummaryNodeIds?: string[];
    deterministic?: boolean;
}

export interface GraphNodeRef {
    id: string;
    label: string;
    type: NodeType;
    meta?: string;
    source: 'editor';
    pendingGraphNode?: boolean;
}

export interface SourceLocationTarget {
    kind: 'node' | 'member' | 'location';
    nodeId?: string;
    ownerNodeId?: string;
    memberKind?: 'method' | 'field';
    memberId?: string;
    memberIndex?: number;
    uri?: string;
    range?: { start: LineCol; end: LineCol };
}

export interface ResolvedSourceLocation {
    uri: string;
    range: { start: LineCol; end: LineCol };
}

export interface AnalysisIndexStatus {
    snapshotReady: boolean;
    isUpdating: boolean;
    queueLength: number;
    activeTask?: string;
    generation: number;
    stale?: boolean;
    suggestRequery?: boolean;
}

// 多维邻接表别名；边的定义被嵌入Map数据结构中。
export type AdjacencyMap = Map<string, Map<EdgeRelation, Set<string>>>;

export interface GraphViewData {
    nodes: IRNode[];
    edges: EdgeData[];
    centerDetails?: {
        nodeId: string;
        name: string;
        type: NodeType;
        fields?: { name: string; type?: string; signature?: string; range?: { start: LineCol; end: LineCol } }[];
        methods: { id: string; name: string; signature?: string; location?: IRNode['location'] }[];
    };
    meta?: {
        truncated?: boolean;
        depth?: number;
        direction?: 'incoming' | 'outgoing' | 'both';
        pathFound?: boolean;
        reason?: string;
        indexStatus?: AnalysisIndexStatus;
        waypointIds?: string[];
        segments?: {
            sourceId: string;
            targetId: string;
            pathFound: boolean;
            depth: number;
            reason?: string;
        }[];
        failedSegmentIndex?: number;
    };
}

export interface FileSymbolsPayload {
    uri: string;
    nodes: IRNode[];
    edges: EdgeData[];
    unchanged?: boolean;
    fingerprint?: string;
}
