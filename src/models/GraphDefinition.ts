
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
    fields?: { name: string; type?: string; signature?: string }[]; // 类的字段列表

    sourceCode?: string;    // 该节点的源码片段 (按需填充供 LLM 使用)
    semanticData?: {        // 语义模块填充位
        summary?: string;     // AI 生成的描述
        tags?: string[];      // 如 ["Entry", "Deprecated", "Utility"]
    };
}

export type EdgeRelation = 'contains' | 'extends' | 'implements' | 'calls' | 'references';


export interface EdgeData {
    sourceId: string;
    targetId: string;
    relation: EdgeRelation;
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
        fields?: { name: string; type?: string; signature?: string }[];
        methods: { id: string; name: string }[];
    };
}

export interface FileSymbolsPayload {
    uri: string;
    nodes: IRNode[];
    edges: EdgeData[];
    unchanged?: boolean;
    fingerprint?: string;
}