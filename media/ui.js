// ==================== Global State ==================== //
const state = {
    currentFunction: 'myFunction',
    isAnalyzing: false,
    summary: '加载中，请稍候...'
};

// ==================== DOM Elements ==================== //
const elements = {
    statusIcon: document.getElementById('status-icon'),
    statusText: document.getElementById('status-text'),
    funcName: document.getElementById('func-name'),
    summaryContent: document.getElementById('summary-content'),
    jumpBtn: document.getElementById('jump-btn'),
    regenerateBtn: document.getElementById('regenerate-btn'),
    copyBtn: document.getElementById('copy-btn'),
    loadingOverlay: document.getElementById('loading-overlay')
};

// ======================= DOM Contents ==================== //
const copyBtnOriginalText = elements.copyBtn.innerHTML;
const copyBtnCopiedText = '<!--<span class="btn-icon">✓</span> --><span class="btn-text">已复制</span>';
const initialSummary = `
        <p>欢迎使用函数总结分析工具！</p>
        <p>点击 <strong>"重新生成"</strong> 按钮开始分析当前选中的函数。</p>
    `;

// ==================== Status Icon Mapping ==================== //
const statusIcons = {
    analyzing: '🔍',
    success: '✅',
    error: '❌'
};

const statusTexts = {
    analyzing: '正在分析...',
    success: '分析完成',
    error: '分析失败'
};

// ==================== Update Functions ==================== //

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


function updateStatus(newStatus) {
    state.isAnalyzing = newStatus === 'analyzing';
    elements.statusIcon.textContent = statusIcons[newStatus];
    elements.statusText.textContent = statusTexts[newStatus];

    if (newStatus === 'analyzing') {
        elements.statusIcon.style.animation = 'pulse 1.5s ease-in-out infinite';
        showLoadingOverlay(true);
        setButtonsDisabled(true);
    } else {
        elements.statusIcon.style.animation = 'none';
        showLoadingOverlay(false);
        setButtonsDisabled(false);
    }
}


function updateSummary(name, summary) {
    state.currentFunction = name;
    elements.funcName.textContent = name;
    state.summary = summary;
    const markdown = marked.parse(summary);
    elements.summaryContent.innerHTML = markdown;
}
