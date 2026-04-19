(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.QueryService) {
        return;
    }

    var querySequence = 0;
    var pendingQueryMap = new Map();
    var latestQueryIdByMode = new Map();
    var inFlightQueryIdByMode = new Map();
    var lastDispatchByMode = new Map();
    var lastQueryRequest = null;

    var DEFAULT_DEBOUNCE_WINDOW_MS = 80;
    var DEFAULT_DUPLICATE_WINDOW_MS = 200;

    function normalizeRequestMode(command, meta) {
        if (meta && typeof meta.requestMode === 'string' && meta.requestMode.length > 0) {
            return meta.requestMode;
        }

        if (command === 'queryNodeDependencies') {
            return 'node';
        }

        if (command === 'queryGlobalRelation') {
            return 'global';
        }

        return 'unknown';
    }

    function stableSerialize(value) {
        if (value === null || typeof value !== 'object') {
            return JSON.stringify(value);
        }

        if (Array.isArray(value)) {
            return '[' + value.map(function (item) {
                return stableSerialize(item);
            }).join(',') + ']';
        }

        var keys = Object.keys(value).sort();
        return '{' + keys.map(function (key) {
            return JSON.stringify(key) + ':' + stableSerialize(value[key]);
        }).join(',') + '}';
    }

    function buildRequestSignature(command, payload, meta) {
        return [
            String(command || ''),
            String(normalizeRequestMode(command, meta)),
            stableSerialize(payload || {})
        ].join('|');
    }

    function resolveWindowValue(rawValue, defaultValue) {
        var numeric = Number(rawValue);
        if (Number.isFinite(numeric) && numeric >= 0) {
            return numeric;
        }

        return defaultValue;
    }

    function sendQuery(options) {
        var safeOptions = options || {};
        var command = safeOptions.command;
        var payload = safeOptions.payload || {};
        var postMessage = safeOptions.postMessage;
        var log = safeOptions.log;
        var meta = safeOptions.meta || null;
        var requestMode = normalizeRequestMode(command, meta);
        var now = Date.now();
        var debounceWindowMs = resolveWindowValue(safeOptions.debounceWindowMs, DEFAULT_DEBOUNCE_WINDOW_MS);
        var duplicateWindowMs = resolveWindowValue(safeOptions.duplicateWindowMs, DEFAULT_DUPLICATE_WINDOW_MS);
        var signature = buildRequestSignature(command, payload, meta);

        if (!command || typeof postMessage !== 'function') {
            return null;
        }

        var lastDispatch = lastDispatchByMode.get(requestMode);
        if (lastDispatch) {
            var elapsedMs = now - Number(lastDispatch.ts || 0);
            var isSameSignature = lastDispatch.signature === signature;

            if (isSameSignature && elapsedMs <= debounceWindowMs) {
                if (typeof log === 'function') {
                    log('query', 'info', 'query dropped by debounce', {
                        command: command,
                        requestMode: requestMode,
                        elapsedMs: elapsedMs,
                        debounceWindowMs: debounceWindowMs,
                        signature: signature
                    });
                }
                return null;
            }

            if (isSameSignature && elapsedMs <= duplicateWindowMs) {
                if (typeof log === 'function') {
                    log('query', 'info', 'query dropped by duplicate signature', {
                        command: command,
                        requestMode: requestMode,
                        elapsedMs: elapsedMs,
                        duplicateWindowMs: duplicateWindowMs,
                        signature: signature
                    });
                }
                return null;
            }
        }

        var previousInFlightId = inFlightQueryIdByMode.get(requestMode);
        if (previousInFlightId && pendingQueryMap.has(previousInFlightId)) {
            var previousEntry = pendingQueryMap.get(previousInFlightId);
            previousEntry.superseded = true;
            previousEntry.supersededBy = null;
        }

        var queryId = now + '-' + (++querySequence);
        pendingQueryMap.set(queryId, {
            command: command,
            payload: payload,
            meta: meta,
            ts: now,
            requestMode: requestMode,
            signature: signature,
            superseded: false,
            supersededBy: null
        });

        if (previousInFlightId && pendingQueryMap.has(previousInFlightId)) {
            pendingQueryMap.get(previousInFlightId).supersededBy = queryId;
        }

        latestQueryIdByMode.set(requestMode, queryId);
        inFlightQueryIdByMode.set(requestMode, queryId);
        lastDispatchByMode.set(requestMode, {
            ts: now,
            signature: signature,
            queryId: queryId,
            command: command
        });

        postMessage({
            command: command,
            ...payload,
            __queryId: queryId,
            __queryMode: requestMode,
            __querySignature: signature
        });

        if (typeof log === 'function') {
            log('query', 'info', 'query sent', {
                queryId: queryId,
                command: command,
                payload: payload,
                meta: meta,
                requestMode: requestMode,
                signature: signature,
                previousInFlightId: previousInFlightId || null
            });
        }

        return queryId;
    }

    function rememberLastQuery(command, payload, source, log) {
        lastQueryRequest = {
            command: command,
            payload: { ...(payload || {}) },
            source: source,
            ts: Date.now()
        };

        if (typeof log === 'function') {
            log('query', 'verbose', 'remember last query', {
                command: command,
                source: source,
                payload: payload
            });
        }

        return { ...lastQueryRequest };
    }

    function consumePendingResponse(data) {
        var responseQueryId = data && data.data && data.data.__queryId
            ? data.data.__queryId
            : (data && data.__queryId ? data.__queryId : null);
        var responseMeta = responseQueryId ? pendingQueryMap.get(responseQueryId) : null;
        var responseRequestMode = responseMeta && responseMeta.requestMode
            ? responseMeta.requestMode
            : (data && data.data && data.data.__queryMode ? data.data.__queryMode : (data && data.__queryMode ? data.__queryMode : null));
        var latestQueryIdForMode = responseRequestMode ? latestQueryIdByMode.get(responseRequestMode) : null;
        var isLatestForMode = !responseRequestMode || !responseQueryId
            ? true
            : latestQueryIdForMode === responseQueryId;
        var droppedByLatestWin = !!(responseMeta && responseMeta.superseded) || !isLatestForMode;
        var dropReason = null;

        if (responseMeta && responseMeta.superseded) {
            dropReason = 'superseded-inflight';
        } else if (!isLatestForMode) {
            dropReason = 'not-latest-for-mode';
        }

        if (responseQueryId) {
            pendingQueryMap.delete(responseQueryId);
        }

        if (responseRequestMode && inFlightQueryIdByMode.get(responseRequestMode) === responseQueryId) {
            inFlightQueryIdByMode.delete(responseRequestMode);
        }

        return {
            responseQueryId: responseQueryId,
            responseMeta: responseMeta,
            responseRequestMode: responseRequestMode,
            latestQueryIdForMode: latestQueryIdForMode || null,
            droppedByLatestWin: droppedByLatestWin,
            dropReason: dropReason
        };
    }

    modules.QueryService = {
        sendQuery: sendQuery,
        rememberLastQuery: rememberLastQuery,
        consumePendingResponse: consumePendingResponse,
        getLastQueryRequest: function () {
            return lastQueryRequest ? { ...lastQueryRequest, payload: { ...(lastQueryRequest.payload || {}) } } : null;
        },
        getPendingQueryCount: function () {
            return pendingQueryMap.size;
        },
        getLatestQueryId: function (requestMode) {
            if (!requestMode) {
                return null;
            }

            return latestQueryIdByMode.get(String(requestMode)) || null;
        },
        reset: function () {
            querySequence = 0;
            pendingQueryMap.clear();
            latestQueryIdByMode.clear();
            inFlightQueryIdByMode.clear();
            lastDispatchByMode.clear();
            lastQueryRequest = null;
        }
    };
})();
