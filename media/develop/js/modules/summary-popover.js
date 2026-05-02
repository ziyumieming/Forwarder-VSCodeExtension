(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.SummaryPopover) {
        return;
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderMarkdownSubset(markdown) {
        var lines = String(markdown || '').split(/\r?\n/);
        var html = [];
        var inList = false;

        function closeList() {
            if (inList) {
                html.push('</ul>');
                inList = false;
            }
        }

        lines.forEach(function (line) {
            var trimmed = line.trim();
            if (!trimmed) {
                closeList();
                return;
            }

            if (/^#{1,4}\s+/.test(trimmed)) {
                closeList();
                html.push('<div class="summary-popover-heading">' + escapeHtml(trimmed.replace(/^#{1,4}\s+/, '')) + '</div>');
                return;
            }

            if (/^[-*]\s+/.test(trimmed)) {
                if (!inList) {
                    html.push('<ul>');
                    inList = true;
                }
                html.push('<li>' + escapeHtml(trimmed.replace(/^[-*]\s+/, '')) + '</li>');
                return;
            }

            closeList();
            html.push('<p>' + escapeHtml(trimmed) + '</p>');
        });

        closeList();
        return html.join('');
    }

    function create(context) {
        var safeContext = context || {};
        var log = typeof safeContext.log === 'function' ? safeContext.log : function () { };
        var store = safeContext.summaryStore || null;
        var onRefresh = typeof safeContext.onRefresh === 'function' ? safeContext.onRefresh : function () { };
        var root = document.getElementById('summary-popover');
        var hideTimer = null;
        var currentRecord = null;

        if (!root) {
            root = document.createElement('div');
            root.id = 'summary-popover';
            root.className = 'summary-popover';
            root.hidden = true;
            document.body.appendChild(root);
        }

        function positionAt(clientX, clientY) {
            var margin = 12;
            var width = root.offsetWidth || 320;
            var height = root.offsetHeight || 180;
            var left = Math.min(window.innerWidth - width - margin, Math.max(margin, clientX + 14));
            var top = Math.min(window.innerHeight - height - margin, Math.max(margin, clientY + 14));
            root.style.left = Math.round(left) + 'px';
            root.style.top = Math.round(top) + 'px';
        }

        function show(record, point) {
            if (!record || !record.summary) {
                return false;
            }
            currentRecord = record;

            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }

            root.innerHTML = [
                '<div class="summary-popover-head">',
                '<button class="summary-popover-nav" type="button" data-summary-action="prev-model" title="Previous model cache">&lt;</button>',
                '<div class="summary-popover-title">' + escapeHtml(record.label || record.nodeId) + '</div>',
                record.stale ? '<span class="summary-stale-badge" title="Source changed after this summary was generated">STALE</span>' : '',
                '<button class="summary-popover-nav" type="button" data-summary-action="next-model" title="Next model cache">&gt;</button>',
                '</div>',
                '<div class="summary-popover-body">' + renderMarkdownSubset(record.summary) + '</div>',
                '<div class="summary-popover-controls">',
                '<button class="summary-popover-nav" type="button" data-summary-action="prev-history" title="Previous summary history">&lt;</button>',
                '<span class="summary-popover-history">' + escapeHtml('History ' + ((record.historyIndex || 0) + 1) + '/' + (record.historyCount || 1)) + '</span>',
                '<button class="summary-popover-nav" type="button" data-summary-action="next-history" title="Next summary history">&gt;</button>',
                '<button class="summary-popover-refresh" type="button" data-summary-action="refresh">Refresh</button>',
                '</div>',
                record.modelId || record.generatedAt
                    ? '<div class="summary-popover-meta">' + escapeHtml([record.modelName, record.modelId, record.cacheStatus, record.generatedAt].filter(Boolean).join(' - ')) + '</div>'
                    : ''
            ].join('');
            root.hidden = false;
            positionAt(point && Number.isFinite(point.x) ? point.x : 80, point && Number.isFinite(point.y) ? point.y : 80);

            log('state', 'verbose', 'summary popover shown', {
                nodeId: record.nodeId
            });
            return true;
        }

        function hide(delayMs) {
            var delay = Number(delayMs || 0);
            if (hideTimer) {
                clearTimeout(hideTimer);
            }
            hideTimer = setTimeout(function () {
                root.hidden = true;
                hideTimer = null;
            }, Math.max(0, delay));
        }

        root.addEventListener('mouseenter', function () {
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
        });
        root.addEventListener('mouseleave', function () {
            hide(80);
        });
        root.addEventListener('click', function (event) {
            var action = event.target && event.target.dataset ? event.target.dataset.summaryAction : null;
            if (!action || !currentRecord) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            var nextRecord = null;
            if (action === 'prev-model' && store && typeof store.setModel === 'function') {
                nextRecord = store.setModel(currentRecord.nodeId, -1);
            } else if (action === 'next-model' && store && typeof store.setModel === 'function') {
                nextRecord = store.setModel(currentRecord.nodeId, 1);
            } else if (action === 'prev-history' && store && typeof store.setHistory === 'function') {
                nextRecord = store.setHistory(currentRecord.nodeId, -1);
            } else if (action === 'next-history' && store && typeof store.setHistory === 'function') {
                nextRecord = store.setHistory(currentRecord.nodeId, 1);
            } else if (action === 'refresh') {
                onRefresh(currentRecord);
            }

            if (nextRecord) {
                show(nextRecord, {
                    x: root.getBoundingClientRect().left,
                    y: root.getBoundingClientRect().top
                });
            }
        });

        return {
            show: show,
            hide: hide
        };
    }

    modules.SummaryPopover = {
        create: create
    };
})();
