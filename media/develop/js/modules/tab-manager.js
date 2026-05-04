(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.TabManager) {
        return;
    }

    var tabs = new Map();
    var activeTabId = null;
    var subscribers = [];

    function noop() { }

    function notify(previousTabId, nextTabId) {
        subscribers.slice().forEach(function (subscriber) {
            subscriber({
                previousTabId: previousTabId,
                activeTabId: nextTabId
            });
        });
    }

    function setToolbarVisibility(tabId, visible) {
        var toolbar = document.querySelector('[data-tab-toolbar="' + tabId + '"]');
        if (!toolbar) {
            return;
        }

        toolbar.hidden = !visible;
        toolbar.classList.toggle('is-active', !!visible);
    }

    function setTabButtonState(tabId, active) {
        var button = document.querySelector('[data-analysis-tab="' + tabId + '"]');
        if (!button) {
            return;
        }

        button.classList.toggle('is-active', !!active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
    }

    function register(tabId, controller) {
        if (!tabId) {
            return null;
        }

        var normalizedId = String(tabId);
        tabs.set(normalizedId, {
            id: normalizedId,
            controller: controller || {}
        });

        var button = document.querySelector('[data-analysis-tab="' + normalizedId + '"]');
        if (button) {
            button.addEventListener('click', function () {
                activate(normalizedId, 'tab-button');
            });
        }

        setToolbarVisibility(normalizedId, activeTabId === normalizedId);
        setTabButtonState(normalizedId, activeTabId === normalizedId);

        return tabs.get(normalizedId);
    }

    function activate(tabId, source) {
        var normalizedId = String(tabId || '');
        var nextTab = tabs.get(normalizedId);
        if (!nextTab) {
            return false;
        }

        if (activeTabId === normalizedId) {
            if (typeof nextTab.controller.onReactivate === 'function') {
                nextTab.controller.onReactivate({ source: source || 'activate' });
            }
            return true;
        }

        var previousTabId = activeTabId;
        var previousTab = previousTabId ? tabs.get(previousTabId) : null;

        if (previousTab && typeof previousTab.controller.onBeforeDeactivate === 'function') {
            previousTab.controller.onBeforeDeactivate({
                source: source || 'activate',
                nextTabId: normalizedId
            });
        }

        if (previousTab && typeof previousTab.controller.onDeactivate === 'function') {
            previousTab.controller.onDeactivate({
                source: source || 'activate',
                nextTabId: normalizedId
            });
        }

        activeTabId = normalizedId;

        tabs.forEach(function (_tab, id) {
            var isActive = id === activeTabId;
            setToolbarVisibility(id, isActive);
            setTabButtonState(id, isActive);
        });

        var restoredView = false;
        if (typeof nextTab.controller.onBeforeActivate === 'function') {
            restoredView = nextTab.controller.onBeforeActivate({
                source: source || 'activate',
                previousTabId: previousTabId
            }) === true;
        }

        if (typeof nextTab.controller.onActivate === 'function') {
            nextTab.controller.onActivate({
                source: source || 'activate',
                previousTabId: previousTabId,
                restoredView: restoredView
            });
        }

        notify(previousTabId, activeTabId);
        return true;
    }

    function getActiveTabId() {
        return activeTabId;
    }

    function getActiveController() {
        var activeTab = activeTabId ? tabs.get(activeTabId) : null;
        return activeTab ? activeTab.controller : null;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return noop;
        }

        subscribers.push(listener);
        return function () {
            subscribers = subscribers.filter(function (candidate) {
                return candidate !== listener;
            });
        };
    }

    modules.TabManager = {
        register: register,
        activate: activate,
        getActiveTabId: getActiveTabId,
        getActiveController: getActiveController,
        subscribe: subscribe,
        reset: function () {
            tabs.clear();
            activeTabId = null;
            subscribers = [];
        }
    };
})();
