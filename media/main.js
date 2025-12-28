// ==================== Global State ==================== //
const state = {
    currentFunction: 'myFunction',
    isAnalyzing: false,
    summary: '加载中，请稍候...',
    codeLocation: '第 42 - 65 行',
    complexity: '中等',
    lastModified: '今天 14:30'
};

// ==================== DOM Elements ==================== //
const elements = {
    statusIcon: document.getElementById('status-icon'),
    statusText: document.getElementById('status-text'),
    funcName: document.getElementById('func-name'),
    summaryContent: document.getElementById('summary-content'),
    codeLocation: document.getElementById('code-location'),
    complexity: document.getElementById('complexity'),
    lastModified: document.getElementById('last-modified'),
    jumpBtn: document.getElementById('jump-btn'),
    regenerateBtn: document.getElementById('regenerate-btn'),
    copyBtn: document.getElementById('copy-btn'),
    loadingOverlay: document.getElementById('loading-overlay')
};

// ==================== Status Icon Mapping ==================== //
const statusIcons = {
    analyzing: '🔍',
    success: '✅',
    error: '❌',
    loading: '⏳'
};

const statusTexts = {
    analyzing: '正在分析...',
    success: '分析完成',
    error: '分析失败',
    loading: '加载中...'
};

// ==================== Update Functions ==================== //
function updateStatus(newStatus) {
    state.isAnalyzing = newStatus === 'analyzing';
    elements.statusIcon.textContent = statusIcons[newStatus];
    elements.statusText.textContent = statusTexts[newStatus];

    if (newStatus === 'analyzing') {
        elements.statusIcon.style.animation = 'pulse 1.5s ease-in-out infinite';
    } else {
        elements.statusIcon.style.animation = 'none';
    }
}

function updateFunctionName(name) {
    state.currentFunction = name;
    elements.funcName.textContent = name;
}

function updateSummary(summary) {
    state.summary = summary;
    elements.summaryContent.innerHTML = summary;
}

function updateMetadata(metadata) {
    if (metadata.location) {
        state.codeLocation = metadata.location;
        elements.codeLocation.textContent = metadata.location;
    }
    if (metadata.complexity) {
        state.complexity = metadata.complexity;
        elements.complexity.textContent = metadata.complexity;
    }
    if (metadata.lastModified) {
        state.lastModified = metadata.lastModified;
        elements.lastModified.textContent = metadata.lastModified;
    }
}

function showLoadingOverlay(show = true) {
    if (show) {
        elements.loadingOverlay.classList.remove('hidden');
    } else {
        elements.loadingOverlay.classList.add('hidden');
    }
}

function setButtonsDisabled(disabled) {
    elements.jumpBtn.disabled = disabled;
    elements.regenerateBtn.disabled = disabled;
    elements.copyBtn.disabled = disabled;
}

// ==================== Event Handlers ==================== //
elements.jumpBtn.addEventListener('click', () => {
    console.log('Jump to source code:', state.currentFunction);
    // TODO: 调用VSCode API跳转到源代码
    // 示例: vscode.postMessage({ command: 'jumpToSource', functionName: state.currentFunction });

    // 演示效果
    showNotification('已定位到源代码位置', 'success');
});

elements.regenerateBtn.addEventListener('click', () => {
    if (!state.isAnalyzing) {
        console.log('Regenerate summary for:', state.currentFunction);
        // TODO: 调用API重新生成总结
        // 示例: vscode.postMessage({ command: 'regenerate', functionName: state.currentFunction });

        // 演示效果：开始分析
        startAnalysis();
    }
});

elements.copyBtn.addEventListener('click', () => {
    // 获取纯文本内容（去除HTML标签）
    const textContent = elements.summaryContent.innerText;

    navigator.clipboard.writeText(textContent).then(() => {
        console.log('Summary copied to clipboard');
        showNotification('已复制到剪贴板', 'success');

        // 改变按钮文本以提示用户
        const originalText = elements.copyBtn.innerHTML;
        elements.copyBtn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">已复制</span>';
        setTimeout(() => {
            elements.copyBtn.innerHTML = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        showNotification('复制失败，请重试', 'error');
    });
});

// ==================== Mock Functions for Demo ==================== //
function startAnalysis() {
    updateStatus('analyzing');
    setButtonsDisabled(true);
    showLoadingOverlay(true);

    // 演示：3秒后完成分析
    setTimeout(() => {
        const mockSummary = `
            <p>这是一个<strong>用户身份验证</strong>函数，主要用于验证用户提供的凭证。</p>
            
            <p><strong>主要功能：</strong></p>
            <ul>
                <li>接收用户名和密码作为参数</li>
                <li>与数据库中的记录进行比较</li>
                <li>返回验证结果和用户信息</li>
            </ul>
            
            <p><strong>关键实现：</strong></p>
            <ul>
                <li>使用bcrypt进行密码加密比对</li>
                <li>包含错误处理和日志记录</li>
                <li>支持多种身份验证方式</li>
            </ul>
            
            <p>该函数的<strong>时间复杂度</strong>为 O(1)，<strong>空间复杂度</strong>为 O(1)。</p>
        `;

        updateSummary(mockSummary);
        updateMetadata({
            location: '第 42 - 65 行',
            complexity: '中等',
            lastModified: '今天 14:30'
        });
        updateStatus('success');
        setButtonsDisabled(false);
        showLoadingOverlay(false);
    }, 3000);
}

function showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 6px;
        background-color: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
        color: white;
        font-weight: 600;
        font-size: 13px;
        z-index: 2000;
        animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    // 3秒后移除通知
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ==================== CSS Animations for Notifications ==================== //
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// ==================== Initialize ==================== //
function initializeUI() {
    console.log('UI Initialized');

    // 设置初始状态
    updateStatus('success');
    updateFunctionName('myFunction');

    // 设置初始总结内容
    const initialSummary = `
        <p>欢迎使用函数总结分析工具！</p>
        <p>点击 <strong>"重新生成"</strong> 按钮开始分析当前选中的函数。</p>
    `;
    updateSummary(initialSummary);
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUI);
} else {
    initializeUI();
}

// ==================== VSCode Message Handler ==================== //
// 监听来自VSCode的消息（可选）
window.addEventListener('message', event => {
    const message = event.data;

    switch (message.command) {
        case 'updateFunctionName':
            updateFunctionName(message.functionName);
            break;
        case 'updateSummary':
            updateSummary(message.summary);
            break;
        case 'updateMetadata':
            updateMetadata(message.metadata);
            break;
        case 'setStatus':
            updateStatus(message.status);
            break;
    }
});
