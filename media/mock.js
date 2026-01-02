// ==================== Mock Functions for Demo ==================== //
function startMockAnalysis() {
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
        updateStatus('success');
        setButtonsDisabled(false);
        showLoadingOverlay(false);
    }, 3000);
}

// ==================== Real Analysis ==================== //
function startRealAnalysis() {

}