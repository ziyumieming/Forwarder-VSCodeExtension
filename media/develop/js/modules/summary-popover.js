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
        var i18n = safeContext.i18n || modules.I18n || null;
        var t = function (key, params) {
            return i18n && typeof i18n.t === 'function' ? i18n.t(key, params) : String(key || '');
        };
        var onRefresh = typeof safeContext.onRefresh === 'function' ? safeContext.onRefresh : function () { };
        var root = document.getElementById('summary-popover');
        var hideTimer = null;
        var currentRecord = null;
        var currentPoint = null;

        if (!root) {
            root = document.createElement('div');
            root.id = 'summary-popover';
            root.className = 'summary-popover';
            root.hidden = true;
            document.body.appendChild(root);
        }

        function positionAt(clientX, clientY, options) {
            var safeOptions = options || {};
            var margin = 12;
            var width = root.offsetWidth || 320;
            var height = root.offsetHeight || 180;
            var offset = safeOptions.anchorMode === 'node-side' ? 0 : 14;
            var left = Math.min(window.innerWidth - width - margin, Math.max(margin, clientX + offset));
            var top = Math.min(window.innerHeight - height - margin, Math.max(margin, clientY + offset));
            root.style.left = Math.round(left) + 'px';
            root.style.top = Math.round(top) + 'px';
        }

        function show(record, point, options) {
            if (!record || !record.summary) {
                log('summary', 'error', '[SummaryUI] popover-hidden-or-empty show-rejected', {
                    hasRecord: !!record,
                    nodeId: record && record.nodeId ? record.nodeId : null,
                    hasSummaryProperty: !!(record && Object.prototype.hasOwnProperty.call(record, 'summary')),
                    summaryType: record ? typeof record.summary : 'undefined',
                    summaryLength: record && record.summary !== undefined && record.summary !== null
                        ? String(record.summary).length
                        : 0
                });
                return false;
            }
            var safeOptions = options || {};
            currentRecord = record;

            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }

            var staleBadges = [
                (record.stale || record.ownStale) ? '<span class="summary-stale-badge" title="' + escapeHtml(t('summary.staleTitle')) + '">' + escapeHtml(t('summary.stale')) + '</span>' : '',
                record.relationContextStale ? '<span class="summary-relation-stale-badge" title="' + escapeHtml(t('summary.relationStaleTitle')) + '">' + escapeHtml(t('summary.relationStale')) + '</span>' : ''
            ].join('');

            root.innerHTML = [
                '<div class="summary-popover-head">',
                '<button class="summary-popover-nav" type="button" data-summary-action="prev-model" title="' + escapeHtml(t('summary.previousModel')) + '">&lt;</button>',
                '<div class="summary-popover-title">' + escapeHtml(record.label || record.nodeId) + '</div>',
                staleBadges,
                '<button class="summary-popover-nav" type="button" data-summary-action="next-model" title="' + escapeHtml(t('summary.nextModel')) + '">&gt;</button>',
                '</div>',
                '<div class="summary-popover-body">' + renderMarkdownSubset(record.summary) + '</div>',
                '<div class="summary-popover-controls">',
                '<button class="summary-popover-nav" type="button" data-summary-action="prev-history" title="' + escapeHtml(t('summary.previousHistory')) + '">&lt;</button>',
                '<span class="summary-popover-history">' + escapeHtml(t('summary.history', { current: ((record.historyIndex || 0) + 1), total: (record.historyCount || 1) })) + '</span>',
                '<button class="summary-popover-nav" type="button" data-summary-action="next-history" title="' + escapeHtml(t('summary.nextHistory')) + '">&gt;</button>',
                '<button class="summary-popover-refresh" type="button" data-summary-action="refresh">' + escapeHtml(t('summary.refresh')) + '</button>',
                '</div>',
                record.modelId || record.generatedAt
                    ? '<div class="summary-popover-meta">' + escapeHtml([record.modelName, record.modelId, record.cacheStatus, record.generatedAt].filter(Boolean).join(' - ')) + '</div>'
                    : ''
            ].join('');
            root.hidden = false;
            if (!safeOptions.preservePosition) {
                currentPoint = {
                    x: point && Number.isFinite(point.x) ? point.x : 80,
                    y: point && Number.isFinite(point.y) ? point.y : 80
                };
                positionAt(currentPoint.x, currentPoint.y, safeOptions);
            }

            log('state', 'verbose', 'summary popover shown', {
                nodeId: record.nodeId,
                summaryLength: String(record.summary || '').length,
                left: root.style.left,
                top: root.style.top,
                hidden: root.hidden === true
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

        function hideNow() {
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
            root.hidden = true;
        }

        function getCurrentRecord() {
            return currentRecord ? { ...currentRecord } : null;
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
                show(nextRecord, currentPoint || { x: 80, y: 80 }, { preservePosition: true });
            }
        });

        return {
            show: show,
            hide: hide,
            hideNow: hideNow,
            isVisible: function () {
                return root.hidden !== true;
            },
            getCurrentRecord: getCurrentRecord
        };
    }

    modules.SummaryPopover = {
        create: create
    };
})();
