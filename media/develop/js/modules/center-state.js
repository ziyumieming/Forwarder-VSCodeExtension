(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CenterState) {
        return;
    }

    var currentCenterNodeId = null;
    var lastCenterNodeId = null;
    var pendingCenterDetailsNodeId = null;
    var centerCardEnabled = false;
    var centerVersion = 0;

    function normalizeNodeId(nodeId) {
        return nodeId ? String(nodeId) : null;
    }

    function getSnapshot() {
        return {
            currentCenterNodeId: currentCenterNodeId,
            lastCenterNodeId: lastCenterNodeId,
            pendingCenterDetailsNodeId: pendingCenterDetailsNodeId,
            centerCardEnabled: centerCardEnabled,
            centerVersion: centerVersion
        };
    }

    function setCenter(nodeId) {
        var normalizedId = normalizeNodeId(nodeId);
        var changed = currentCenterNodeId !== normalizedId;

        if (changed) {
            lastCenterNodeId = currentCenterNodeId;
            currentCenterNodeId = normalizedId;
            centerVersion += 1;
        }

        return {
            changed: changed,
            currentCenterNodeId: currentCenterNodeId,
            lastCenterNodeId: lastCenterNodeId,
            centerVersion: centerVersion
        };
    }

    function setCenterCardEnabled(enabled) {
        centerCardEnabled = !!enabled;
        return centerCardEnabled;
    }

    function setPendingCenterDetailsNodeId(nodeId) {
        pendingCenterDetailsNodeId = normalizeNodeId(nodeId);
        return pendingCenterDetailsNodeId;
    }

    function syncState(partialState) {
        if (!partialState || typeof partialState !== 'object') {
            return getSnapshot();
        }

        if (Object.prototype.hasOwnProperty.call(partialState, 'currentCenterNodeId')) {
            currentCenterNodeId = normalizeNodeId(partialState.currentCenterNodeId);
        }

        if (Object.prototype.hasOwnProperty.call(partialState, 'lastCenterNodeId')) {
            lastCenterNodeId = normalizeNodeId(partialState.lastCenterNodeId);
        }

        if (Object.prototype.hasOwnProperty.call(partialState, 'pendingCenterDetailsNodeId')) {
            pendingCenterDetailsNodeId = normalizeNodeId(partialState.pendingCenterDetailsNodeId);
        }

        if (Object.prototype.hasOwnProperty.call(partialState, 'centerCardEnabled')) {
            centerCardEnabled = !!partialState.centerCardEnabled;
        }

        if (Object.prototype.hasOwnProperty.call(partialState, 'centerVersion')) {
            centerVersion = Number(partialState.centerVersion) || 0;
        }

        return getSnapshot();
    }

    modules.CenterState = {
        getSnapshot: getSnapshot,
        syncState: syncState,
        setCenter: setCenter,
        setCenterCardEnabled: setCenterCardEnabled,
        setPendingCenterDetailsNodeId: setPendingCenterDetailsNodeId,
        getLastCenterNodeId: function () {
            return lastCenterNodeId;
        },
        getPendingCenterDetailsNodeId: function () {
            return pendingCenterDetailsNodeId;
        },
        isCenterCardEnabled: function () {
            return centerCardEnabled;
        },
        getCenterVersion: function () {
            return centerVersion;
        },
        getCurrentCenterNodeId: function () {
            return currentCenterNodeId;
        },
        setCurrentCenterNodeId: function (nodeId) {
            var state = setCenter(nodeId);
            return state.currentCenterNodeId;
        }
    };
})();
