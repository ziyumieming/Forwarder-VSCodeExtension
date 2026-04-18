(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.QueryService) {
        return;
    }

    var querySequence = 0;
    var pendingQueryMap = new Map();
    var lastQueryRequest = null;

    function sendQuery(options) {
        var safeOptions = options || {};
        var command = safeOptions.command;
        var payload = safeOptions.payload || {};
        var postMessage = safeOptions.postMessage;
        var log = safeOptions.log;
        var meta = safeOptions.meta || null;

        if (!command || typeof postMessage !== 'function') {
            return null;
        }

        var queryId = Date.now() + '-' + (++querySequence);
        pendingQueryMap.set(queryId, {
            command: command,
            payload: payload,
            meta: meta,
            ts: Date.now()
        });

        postMessage({
            command: command,
            ...payload,
            __queryId: queryId
        });

        if (typeof log === 'function') {
            log('query', 'info', 'query sent', {
                queryId: queryId,
                command: command,
                payload: payload,
                meta: meta
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

        if (responseQueryId) {
            pendingQueryMap.delete(responseQueryId);
        }

        return {
            responseQueryId: responseQueryId,
            responseMeta: responseMeta
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
        reset: function () {
            querySequence = 0;
            pendingQueryMap.clear();
            lastQueryRequest = null;
        }
    };
})();
