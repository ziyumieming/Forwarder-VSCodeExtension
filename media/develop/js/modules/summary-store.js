(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.SummaryStore) {
        return;
    }

    var summaries = new Map();
    var listeners = new Set();

    function normalizeRecord(record) {
        if (!record || !record.nodeId || !record.summary) {
            return null;
        }

        return {
            nodeId: String(record.nodeId),
            label: String(record.label || record.nodeId),
            summary: String(record.summary),
            modelId: record.modelId ? String(record.modelId) : '',
            generatedAt: record.generatedAt ? String(record.generatedAt) : new Date().toISOString()
        };
    }

    function notify(record, reason) {
        listeners.forEach(function (listener) {
            try {
                listener(record, reason || 'summary-store');
            } catch (error) {
                console.error('[SummaryStore] listener failed', error);
            }
        });
    }

    function set(record, reason) {
        var normalized = normalizeRecord(record);
        if (!normalized) {
            return null;
        }

        summaries.set(normalized.nodeId, normalized);
        notify({ ...normalized }, reason || 'set');
        return { ...normalized };
    }

    function get(nodeId) {
        var key = nodeId ? String(nodeId) : '';
        var record = key ? summaries.get(key) : null;
        return record ? { ...record } : null;
    }

    function has(nodeId) {
        return !!get(nodeId);
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return function () { };
        }

        listeners.add(listener);
        return function () {
            listeners.delete(listener);
        };
    }

    modules.SummaryStore = {
        set: set,
        get: get,
        has: has,
        subscribe: subscribe
    };
})();
