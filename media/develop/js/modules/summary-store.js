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
            console.debug('[SummaryStore][SummaryUI] normalize-record-rejected', {
                hasRecord: !!record,
                nodeId: record && record.nodeId ? String(record.nodeId) : null,
                hasSummaryProperty: !!(record && Object.prototype.hasOwnProperty.call(record, 'summary')),
                summaryType: record ? typeof record.summary : 'undefined',
                summaryLength: record && record.summary !== undefined && record.summary !== null
                    ? String(record.summary).length
                    : 0,
                label: record && record.label ? String(record.label) : null,
                cacheStatus: record && record.cacheStatus ? String(record.cacheStatus) : null
            });
            return null;
        }

        return {
            nodeId: String(record.nodeId),
            label: String(record.label || record.nodeId),
            summary: String(record.summary),
            modelName: record.modelName ? String(record.modelName) : (record.modelId ? String(record.modelId) : 'default'),
            modelId: record.modelId ? String(record.modelId) : '',
            generatedAt: record.generatedAt ? String(record.generatedAt) : new Date().toISOString(),
            bodyHash: record.bodyHash ? String(record.bodyHash) : '',
            stale: record.stale === true,
            cacheStatus: record.cacheStatus ? String(record.cacheStatus) : '',
            historyIndex: Number.isFinite(record.historyIndex) ? record.historyIndex : 0,
            historyCount: Number.isFinite(record.historyCount) ? record.historyCount : 1,
            promptVersion: record.promptVersion ? String(record.promptVersion) : '',
            summaryKind: record.summaryKind ? String(record.summaryKind) : (String(record.promptVersion || '').startsWith('class-') ? 'class' : 'function'),
            ownStale: record.ownStale === true,
            relationContextStale: record.relationContextStale === true,
            contextCoverage: record.contextCoverage || null,
            usedContextNodeIds: Array.isArray(record.usedContextNodeIds) ? record.usedContextNodeIds.map(String) : [],
            missingContextNodeIds: Array.isArray(record.missingContextNodeIds) ? record.missingContextNodeIds.map(String) : []
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
        console.debug('[SummaryStore][SummaryUI] set-record-received', {
            reason: reason || 'set',
            nodeId: record && record.nodeId ? String(record.nodeId) : null,
            hasSummaryProperty: !!(record && Object.prototype.hasOwnProperty.call(record, 'summary')),
            summaryType: record ? typeof record.summary : 'undefined',
            summaryLength: record && record.summary !== undefined && record.summary !== null
                ? String(record.summary).length
                : 0,
            cacheStatus: record && record.cacheStatus ? String(record.cacheStatus) : null
        });
        var normalized = normalizeRecord(record);
        if (!normalized) {
            return null;
        }

        var entry = summaries.get(normalized.nodeId);
        if (!entry) {
            entry = {
                activeModelName: normalized.modelName,
                activeHistoryIndex: 0,
                recordsByModel: new Map()
            };
            summaries.set(normalized.nodeId, entry);
        }

        var records = entry.recordsByModel.get(normalized.modelName) || [];
        records = records.filter(function (item) {
            return !(item.generatedAt === normalized.generatedAt
                && item.modelName === normalized.modelName
                && item.bodyHash === normalized.bodyHash);
        });
        records.push(normalized);
        records.sort(function (left, right) {
            return String(right.generatedAt || '').localeCompare(String(left.generatedAt || ''));
        });
        if (records.length > 3) {
            records = records.slice(0, 3);
        }
        records = records.map(function (item, index) {
            return {
                ...item,
                historyIndex: index,
                historyCount: records.length
            };
        });
        entry.recordsByModel.set(normalized.modelName, records);
        entry.activeModelName = normalized.modelName;
        entry.activeHistoryIndex = 0;

        notify({ ...normalized }, reason || 'set');
        return get(normalized.nodeId);
    }

    function get(nodeId) {
        var key = nodeId ? String(nodeId) : '';
        var entry = key ? summaries.get(key) : null;
        var records = entry ? entry.recordsByModel.get(entry.activeModelName) : null;
        var record = records ? records[Math.min(entry.activeHistoryIndex || 0, records.length - 1)] : null;
        return record ? { ...record } : null;
    }

    function setHistory(nodeId, delta) {
        var entry = summaries.get(String(nodeId || ''));
        if (!entry) {
            console.debug('[SummaryStore] setHistory ignored; no entry', nodeId);
            return null;
        }
        var records = entry.recordsByModel.get(entry.activeModelName) || [];
        if (records.length === 0) {
            return null;
        }
        entry.activeHistoryIndex = (records.length + (entry.activeHistoryIndex || 0) + delta) % records.length;
        var record = get(nodeId);
        notify(record, 'history-switch');
        return record;
    }

    function setModel(nodeId, delta) {
        var entry = summaries.get(String(nodeId || ''));
        if (!entry) {
            console.debug('[SummaryStore] setModel ignored; no entry', nodeId);
            return null;
        }
        var names = Array.from(entry.recordsByModel.keys()).sort();
        if (names.length === 0) {
            return null;
        }
        var currentIndex = Math.max(0, names.indexOf(entry.activeModelName));
        entry.activeModelName = names[(names.length + currentIndex + delta) % names.length];
        entry.activeHistoryIndex = 0;
        var record = get(nodeId);
        notify(record, 'model-switch');
        return record;
    }

    function setHistoryRecords(nodeId, records, reason) {
        if (!Array.isArray(records)) {
            return;
        }
        records.forEach(function (record) {
            set(record, reason || 'history');
        });
        console.debug('[SummaryStore] history records loaded', {
            nodeId: nodeId,
            count: records.length
        });
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
        setHistory: setHistory,
        setModel: setModel,
        setHistoryRecords: setHistoryRecords,
        subscribe: subscribe
    };
})();
