(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.I18n) {
        return;
    }

    var currentLanguage = 'en';
    var listeners = [];

    var dictionaries = {
        en: {
            'app.title': 'Forwarder Analysis',
            'model.selectSummaryModel': 'Select summary model',
            'model.summaryModel': 'Summary Model',
            'model.selected': 'selected',
            'tabs.analysisViews': 'Analysis Views',
            'tabs.classGraph': 'Class Graph',
            'tabs.callGraph': 'Call Graph',
            'toolbar.relationOptions': 'Relation Options',
            'toolbar.relations': 'Relations',
            'toolbar.extends': 'Extends',
            'toolbar.implements': 'Implements',
            'toolbar.composes': 'Composes',
            'toolbar.dependencies': 'Dependencies',
            'toolbar.aggregates': 'Aggregates',
            'toolbar.workspaceScopeOptions': 'Workspace Scope Options',
            'toolbar.scope': 'Scope',
            'toolbar.includeExternalFiles': 'Include External Files',
            'toolbar.includeExternal': 'Include External',
            'toolbar.fit': 'Fit',
            'toolbar.layout': 'Layout',
            'toolbar.reset': 'Reset',
            'toolbar.query': 'Query',
            'toolbar.clear': 'Clear',
            'call.options': 'Call Graph Options',
            'call.call': 'Call',
            'call.depth': 'Depth',
            'call.depthAria': 'Call graph depth',
            'call.direction': 'Direction',
            'call.directionAria': 'Call graph direction',
            'call.direction.both': 'Both',
            'call.direction.outgoing': 'Outgoing',
            'call.direction.incoming': 'Incoming',
            'call.scope': 'Call Graph Scope',
            'call.noCenter': 'No center',
            'call.noCenterSelected': 'No center selected',
            'call.empty.title': 'Select a function to inspect calls',
            'call.empty.text': 'Move the editor cursor into a function, or choose a function node as the center.',
            'call.empty.useCursorCenter': 'Use Cursor as Center',
            'call.empty.usePathCandidate': 'Use Path Candidate',
            'call.empty.noCursorCandidate': 'No cursor function candidate',
            'call.empty.candidate': 'Candidate: {label}',
            'call.contextMenu.aria': 'Call graph node actions',
            'call.contextMenu.reveal': 'Go to Source',
            'call.contextMenu.add': 'Add to Path Slot',
            'call.contextMenu.setAsCenter': 'Set as Center',
            'index.stale': 'Index updating; graph may be stale.',
            'index.requery': 'Re-query',
            'pathTray.aria': 'Call Path Slots',
            'pathTray.title': 'Path Order',
            'pathTray.emptyHint': 'Add functions to define waypoint order.',
            'pathTray.selectedHint': '{count} {waypointWord} selected. Drag to reorder.',
            'pathTray.waypoint': 'waypoint',
            'pathTray.waypoints': 'waypoints',
            'pathTray.clear': 'Clear path order',
            'pathTray.clearDisabled': 'No functions to clear',
            'pathTray.path': 'Path',
            'pathTray.closeSummaryFirst': 'Close the current path summary before starting another query',
            'pathTray.needTwo': 'Add at least two functions to query a call path',
            'pathTray.queryOrdered': 'Query call path for ordered waypoints',
            'pathTray.orderedFunctions': 'Ordered function path',
            'pathTray.removeFunction': 'Remove {label}',
            'pathTray.unknownFunction': 'Unknown function',
            'pathSummary.aria': 'Call Path Summary',
            'pathSummary.resize': 'Drag to resize',
            'pathSummary.title': 'Path Summary',
            'pathSummary.close': 'Close path summary',
            'pathSummary.loading': 'Generating path summary...',
            'pathSummary.error': 'Unable to generate path summary.',
            'pathSummary.noCompletePath': 'No complete call path was found for the selected waypoints.',
            'pathChipMenu.aria': 'Call path chip actions',
            'pathChipMenu.remove': 'Remove',
            'classMemberMenu.aria': 'Class card member actions',
            'classCard.noFields': 'No fields',
            'classCard.noMethods': 'No methods',
            'classCard.fields': 'Fields',
            'classCard.methods': 'Methods',
            'classCard.unknownMember': '(unknown)',
            'summary.stale': 'STALE',
            'summary.staleTitle': 'Source changed after this summary was generated',
            'summary.relationStale': 'RELATION STALE',
            'summary.relationStaleTitle': 'Related class context changed after this summary was generated',
            'summary.previousModel': 'Previous model cache',
            'summary.nextModel': 'Next model cache',
            'summary.previousHistory': 'Previous summary history',
            'summary.nextHistory': 'Next summary history',
            'summary.history': 'History {current}/{total}',
            'summary.refresh': 'Refresh',
            'summary.noModel': 'No model selected'
        },
        'zh-CN': {
            'app.title': 'Forwarder 分析',
            'model.selectSummaryModel': '选择摘要模型',
            'model.summaryModel': '摘要模型',
            'model.selected': '已选',
            'tabs.analysisViews': '分析视图',
            'tabs.classGraph': '类图',
            'tabs.callGraph': '调用图',
            'toolbar.relationOptions': '关系选项',
            'toolbar.relations': '关系',
            'toolbar.extends': '继承',
            'toolbar.implements': '实现',
            'toolbar.composes': '组合',
            'toolbar.dependencies': '依赖',
            'toolbar.aggregates': '聚合',
            'toolbar.workspaceScopeOptions': '工作区范围选项',
            'toolbar.scope': '范围',
            'toolbar.includeExternalFiles': '包含外部文件',
            'toolbar.includeExternal': '包含外部',
            'toolbar.fit': '适应',
            'toolbar.layout': '布局',
            'toolbar.reset': '重置',
            'toolbar.query': '查询',
            'toolbar.clear': '清空',
            'call.options': '调用图选项',
            'call.call': '调用',
            'call.depth': '深度',
            'call.depthAria': '调用图深度',
            'call.direction': '方向',
            'call.directionAria': '调用图方向',
            'call.direction.both': '双向',
            'call.direction.outgoing': '向外',
            'call.direction.incoming': '向内',
            'call.scope': '调用图范围',
            'call.noCenter': '无中心',
            'call.noCenterSelected': '未选择中心函数',
            'call.empty.title': '选择函数以查看调用',
            'call.empty.text': '将编辑器光标移入函数，或选择一个函数节点作为中心。',
            'call.empty.useCursorCenter': '使用光标函数作为中心',
            'call.empty.usePathCandidate': '使用路径候选',
            'call.empty.noCursorCandidate': '没有光标函数候选',
            'call.empty.candidate': '候选：{label}',
            'call.contextMenu.aria': '调用图节点操作',
            'call.contextMenu.reveal': '跳转到源码',
            'call.contextMenu.add': '加入调用链槽',
            'call.contextMenu.setAsCenter': '设为中心',
            'index.stale': '索引正在更新，图数据可能已过期。',
            'index.requery': '重新查询',
            'pathTray.aria': '调用链槽',
            'pathTray.title': '路径顺序',
            'pathTray.emptyHint': '添加函数以定义途经顺序。',
            'pathTray.selectedHint': '已选择 {count} 个{waypointWord}。可拖动排序。',
            'pathTray.waypoint': '途经点',
            'pathTray.waypoints': '途经点',
            'pathTray.clear': '清空路径顺序',
            'pathTray.clearDisabled': '没有可清空的函数',
            'pathTray.path': '路径',
            'pathTray.closeSummaryFirst': '请先关闭当前路径摘要再开始新查询',
            'pathTray.needTwo': '至少添加两个函数才能查询调用路径',
            'pathTray.queryOrdered': '按当前顺序查询调用路径',
            'pathTray.orderedFunctions': '有序函数路径',
            'pathTray.removeFunction': '移除 {label}',
            'pathTray.unknownFunction': '未知函数',
            'pathSummary.aria': '调用路径摘要',
            'pathSummary.resize': '拖动以调整大小',
            'pathSummary.title': '路径摘要',
            'pathSummary.close': '关闭路径摘要',
            'pathSummary.loading': '正在生成路径摘要...',
            'pathSummary.error': '无法生成路径摘要。',
            'pathSummary.noCompletePath': '没有找到覆盖所选途经点的完整调用路径。',
            'pathChipMenu.aria': '调用链标签操作',
            'pathChipMenu.remove': '移除',
            'classMemberMenu.aria': '类卡片成员操作',
            'classCard.noFields': '无字段',
            'classCard.noMethods': '无方法',
            'classCard.fields': '字段',
            'classCard.methods': '方法',
            'classCard.unknownMember': '（未知）',
            'summary.stale': '已过期',
            'summary.staleTitle': '生成该摘要后源码已变化',
            'summary.relationStale': '关系已过期',
            'summary.relationStaleTitle': '生成该摘要后相关类上下文已变化',
            'summary.previousModel': '上一个模型缓存',
            'summary.nextModel': '下一个模型缓存',
            'summary.previousHistory': '上一条摘要历史',
            'summary.nextHistory': '下一条摘要历史',
            'summary.history': '历史 {current}/{total}',
            'summary.refresh': '刷新',
            'summary.noModel': '未选择模型'
        }
    };

    function normalizeLanguage(language) {
        return language === 'zh-CN' ? 'zh-CN' : 'en';
    }

    function interpolate(template, params) {
        var values = params || {};
        return String(template || '').replace(/\{([A-Za-z0-9_.-]+)\}/g, function (_, key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : '';
        });
    }

    function t(key, params) {
        var normalizedKey = String(key || '');
        var dictionary = dictionaries[currentLanguage] || dictionaries.en;
        var value = dictionary[normalizedKey];
        if (value === undefined) {
            value = dictionaries.en[normalizedKey];
        }
        if (value === undefined) {
            console.warn('[I18n] missing-key', { key: normalizedKey, language: currentLanguage });
            return normalizedKey;
        }
        return interpolate(value, params);
    }

    function apply(root) {
        var scope = root || document;
        if (!scope || typeof scope.querySelectorAll !== 'function') {
            return;
        }

        var textNodes = scope.querySelectorAll('[data-i18n]');
        Array.prototype.forEach.call(textNodes, function (element) {
            element.textContent = t(element.getAttribute('data-i18n'));
        });

        var titleNodes = scope.querySelectorAll('[data-i18n-title]');
        Array.prototype.forEach.call(titleNodes, function (element) {
            element.setAttribute('title', t(element.getAttribute('data-i18n-title')));
        });

        var ariaNodes = scope.querySelectorAll('[data-i18n-aria-label]');
        Array.prototype.forEach.call(ariaNodes, function (element) {
            element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label')));
        });

        var placeholderNodes = scope.querySelectorAll('[data-i18n-placeholder]');
        Array.prototype.forEach.call(placeholderNodes, function (element) {
            element.setAttribute('placeholder', t(element.getAttribute('data-i18n-placeholder')));
        });

        if (document && document.documentElement) {
            document.documentElement.lang = currentLanguage === 'zh-CN' ? 'zh-CN' : 'en';
        }
        if (document) {
            document.title = t('app.title');
        }
    }

    function notify() {
        listeners.slice().forEach(function (listener) {
            try {
                listener(currentLanguage);
            } catch (error) {
                console.error('[I18n] listener failed', error);
            }
        });
    }

    function setLanguage(language) {
        var nextLanguage = normalizeLanguage(language);
        if (nextLanguage === currentLanguage) {
            apply(document);
            return;
        }
        currentLanguage = nextLanguage;
        apply(document);
        notify();
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return function () { };
        }
        listeners.push(listener);
        return function () {
            listeners = listeners.filter(function (candidate) {
                return candidate !== listener;
            });
        };
    }

    modules.I18n = {
        setLanguage: setLanguage,
        getLanguage: function () { return currentLanguage; },
        t: t,
        apply: apply,
        subscribe: subscribe
    };
})();
