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
        var root = document.getElementById('summary-popover');
        var hideTimer = null;

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

            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }

            root.innerHTML = [
                '<div class="summary-popover-title">' + escapeHtml(record.label || record.nodeId) + '</div>',
                '<div class="summary-popover-body">' + renderMarkdownSubset(record.summary) + '</div>',
                record.modelId || record.generatedAt
                    ? '<div class="summary-popover-meta">' + escapeHtml([record.modelId, record.generatedAt].filter(Boolean).join(' - ')) + '</div>'
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

        return {
            show: show,
            hide: hide
        };
    }

    modules.SummaryPopover = {
        create: create
    };
})();
