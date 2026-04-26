(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.SelectionStore) {
        return;
    }

    var selectedFunctionIds = new Set();
    var subscribers = [];

    function noop() { }

    function normalizeId(nodeId) {
        var normalized = nodeId === undefined || nodeId === null ? '' : String(nodeId).trim();
        return normalized || null;
    }

    function getSnapshot() {
        return {
            functionIds: Array.from(selectedFunctionIds)
        };
    }

    function notify(reason) {
        var snapshot = getSnapshot();
        subscribers.slice().forEach(function (subscriber) {
            subscriber(snapshot, reason || 'update');
        });
        return snapshot;
    }

    function add(nodeId, reason) {
        var normalized = normalizeId(nodeId);
        if (!normalized) {
            return getSnapshot();
        }

        selectedFunctionIds.add(normalized);
        return notify(reason || 'add');
    }

    function remove(nodeId, reason) {
        var normalized = normalizeId(nodeId);
        if (!normalized) {
            return getSnapshot();
        }

        selectedFunctionIds.delete(normalized);
        return notify(reason || 'remove');
    }

    function toggle(nodeId, reason) {
        var normalized = normalizeId(nodeId);
        if (!normalized) {
            return getSnapshot();
        }

        if (selectedFunctionIds.has(normalized)) {
            selectedFunctionIds.delete(normalized);
        } else {
            selectedFunctionIds.add(normalized);
        }

        return notify(reason || 'toggle');
    }

    function clear(reason) {
        if (selectedFunctionIds.size === 0) {
            return getSnapshot();
        }

        selectedFunctionIds.clear();
        return notify(reason || 'clear');
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return noop;
        }

        subscribers.push(listener);
        listener(getSnapshot(), 'subscribe');

        return function () {
            subscribers = subscribers.filter(function (candidate) {
                return candidate !== listener;
            });
        };
    }

    modules.SelectionStore = {
        add: add,
        remove: remove,
        toggle: toggle,
        clear: clear,
        getSnapshot: getSnapshot,
        subscribe: subscribe,
        has: function (nodeId) {
            var normalized = normalizeId(nodeId);
            return !!normalized && selectedFunctionIds.has(normalized);
        },
        reset: function () {
            selectedFunctionIds.clear();
            subscribers = [];
        }
    };
})();
