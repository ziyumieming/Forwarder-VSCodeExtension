const useMock = document.body.dataset.useMock === 'true';


// ==================== Event Handlers ==================== //
elements.jumpBtn.addEventListener('click', () => {
    console.log('Jump to source code:', state.currentFunction);
    vscode.postMessage({ command: 'jumpToSource', functionName: state.currentFunction });
    showNotification('已定位到源代码位置', 'success');
});

elements.regenerateBtn.addEventListener('click', () => {
    if (!state.isAnalyzing) {
        console.log('Regenerate summary for:', state.currentFunction);
        if (useMock)
            startMockAnalysis();
        else
            startRealAnalysis();
    }
});


let copyBtnResetTimer = null;
elements.copyBtn.addEventListener('click', () => {
    // 获取纯文本内容（去除HTML标签）
    const textContent = elements.summaryContent.innerText;

    navigator.clipboard.writeText(textContent).then(() => {
        console.log('Summary copied to clipboard');
        showNotification('已复制到剪贴板', 'success');
        elements.copyBtn.innerHTML = copyBtnCopiedText;
        if (copyBtnResetTimer !== null)
            clearTimeout(copyBtnResetTimer);
        copyBtnResetTimer = setTimeout(() => {
            elements.copyBtn.innerHTML = copyBtnOriginalText;
            copyBtnResetTimer = null;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        showNotification('复制失败，请重试', 'error');
    });
});



// ==================== Initialize ==================== //
function initializeUI() {
    console.log('UI Initialized');
    updateStatus('success');
    updateFunctionName('Forwarder');
    updateSummary(initialSummary);
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUI);
} else {
    initializeUI();
}

// ==================== VSCode Message Handler ==================== //
// 监听来自VSCode的消息
window.addEventListener('message', event => {
    const message = event.data;
    const content = message.content;
    switch (message.command) {
        case 'updateState': {
            const { status, functionName, summary } = message.content || {};
            if (status) updateStatus(status);
            if (functionName && summary) updateSummary(functionName, summary);
            break;
        }
    }
});

// ==================== Others ==================== //
function showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // 3秒后移除通知
    setTimeout(() => {
        notification.classList.add('notification-hide');
        notification.addEventListener('animationend', () => notification.remove(), { once: true });
    }, 3000);
}

