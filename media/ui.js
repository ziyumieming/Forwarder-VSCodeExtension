// ==================== Global State ==================== //
const state = {
    currentFunction: 'myFunction',
    isAnalyzing: false,
    summary: '加载中，请稍候...',
    codeLocation: '第 42 - 65 行'
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