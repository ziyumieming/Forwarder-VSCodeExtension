import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export class GatingService {
    // 常用语言对应的官方/推荐 LSP 插件 ID 映射表
    private static readonly LANGUAGE_LSP_MAP: Record<string, string> = {
        'python': 'ms-python.python',
        'typescript': 'vscode.typescript-language-features',
        'javascript': 'vscode.typescript-language-features',
        'typescriptreact': 'vscode.typescript-language-features',
        'javascriptreact': 'vscode.typescript-language-features',
        'go': 'golang.Go',
        'java': 'redhat.java',
        'c': 'ms-vscode.cpptools',
        'cpp': 'ms-vscode.cpptools',
        'csharp': 'ms-dotnettools.csharp',
        'rust': 'rust-lang.rust-analyzer',
        'php': 'bmewburn.vscode-intelephense-client'
    };

    private static activeExtensions: Set<string> = new Set();

    // 记录已经成功完成真实能力验证的插件缓存（用于确保后台 Server 也启动完成）
    private static validatedLsp: Set<string> = new Set();

    /**
     * 确保文件关联的 LSP 扩展既被激活也完成启动，否则可能陷入提前调用导致无数据
     * @param uri 待处理的文件
     */
    public static async waitAndCheckLSPForFile(uri: vscode.Uri): Promise<boolean> {
        try {
            // 确保文档被打开或知道其 LanguageId
            // openTextDocument 会把文档拉入内存，这是许多 LSP 提供服务的先决条件
            const document = await vscode.workspace.openTextDocument(uri);
            const languageId = document.languageId;

            const extensionId = this.LANGUAGE_LSP_MAP[languageId];
            if (!extensionId) {
                // TODO：如果在映射外，直接信任它并放行？
                return true;
            }

            const extension = vscode.extensions.getExtension(extensionId);
            if (!extension) {
                logger.info(`[GatingService] 未安装或找不到语言 ${languageId} 推荐的 LSP 插件 (${extensionId})，将降级尝试直接解析。`);
                return true;
            }

            if (!extension.isActive) {
                logger.info(`[GatingService] 正在激活 ${languageId} 的语言服务扩展: ${extensionId}...`);
                await extension.activate();
                this.activeExtensions.add(extensionId);
            }

            // --- 此处添加 LSP 是否真正 Ready 的探针机制 ---
            // 因为 extension.activate() 只代表扩展激活，并不代表底层的 Language Server 进程已经建立和索引首个文件完毕。
            // 我们可以通过反复探测 documentSymbol 接口直至有返回，来验证其就绪情况。
            if (!this.validatedLsp.has(extensionId)) {
                const isReady = await this.probeLspReadiness(uri);
                if (isReady) {
                    this.validatedLsp.add(extensionId);
                    logger.info(`[GatingService] 语言服务插件 ${extensionId} 探针通过，已完全就绪。`);
                } else {
                    logger.info(`[GatingService] LSP 插件 ${extensionId} 激活后未能建立后台服务或探测超时，可能引发后续分析空转。`);
                    // 即使探测超时失败，也勉强放行避免死锁，由下游 Adapter 应对可能的空数据。
                }
            }

            return true;
        } catch (err: any) {
            logger.info(`[GatingService] 检查或激活 LSP 环境失败 (文档可能丢失或损坏): ${err.message}`);
            // 当确实遭遇阻断级异常（比如由于重命名导致 URI 直接失效），返回 false 阻断解析
            return false;
        }
    }

    /**
     * 对特定的 URI 实行短暂的心跳探测，等待 LSP 具备提供 AST 能力
     */
    private static async probeLspReadiness(uri: vscode.Uri, maxRetries: number = 10, intervalMs: number = 2000): Promise<boolean> {
        logger.info(`[GatingService] 正在对 LSP 执行能力探针: ${uri.fsPath}`);
        for (let i = 0; i < maxRetries; i++) {
            try {
                // 使用文档符号提供程序作为探针
                // 注意：即使文件很空没有 symbols 时会返回 []
                // 但如果 LSP 完全没准备好或者 Provider 没注册，会抛出拒绝/undefined
                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
                    'vscode.executeDocumentSymbolProvider',
                    uri
                );

                // 如果没报错并且得到了明确的返回值，即可认为能够响应该语言的请求。
                if (symbols !== undefined) {
                    return true;
                }
            } catch (err) {
                // 如果抛出错误通常意味着 "provider not found"
            }

            // 等待一段时间后再试
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

        return false;
    }
}