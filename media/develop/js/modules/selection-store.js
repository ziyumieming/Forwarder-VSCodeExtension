(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.SelectionStore) {
        return;
    }

    var selectedFunctions = [];
    var subscribers = [];

    function noop() { }

    function normalizeId(nodeId) {
        var normalized = nodeId === undefined || nodeId === null ? '' : String(nodeId).trim();
        return normalized || null;
    }

    function labelFromId(nodeId) {
        var id = String(nodeId || '').trim();
        if (!id) {
            return 'Unknown function';
        }

        var hashParts = id.split('#').filter(function (part) {
            return String(part).trim().length > 0;
        });
        return hashParts.length > 0 ? hashParts[hashParts.length - 1] : id;
    }

    function cloneFunctionRef(functionRef) {
        if (!functionRef) {
            return null;
        }

        var normalizedId = normalizeId(functionRef.id !== undefined ? functionRef.id : functionRef);
        if (!normalizedId) {
            return null;
        }

        return {
            id: normalizedId,
            label: String(functionRef.label || labelFromId(normalizedId)),
            meta: functionRef.meta === undefined || functionRef.meta === null ? '' : String(functionRef.meta),
            source: functionRef.source ? String(functionRef.source) : undefined
        };
    }

    function findIndex(nodeId) {
        var normalized = normalizeId(nodeId);
        if (!normalized) {
            return -1;
        }

        for (var i = 0; i < selectedFunctions.length; i += 1) {
            if (selectedFunctions[i].id === normalized) {
                return i;
            }
        }
        return -1;
    }

    function getSnapshot() {
        var functions = selectedFunctions.map(function (functionRef) {
            return { ...functionRef };
        });

        return {
            functions: functions,
            functionRefs: functions,
            functionIds: functions.map(function (functionRef) {
                return functionRef.id;
            })
        };
    }

    function notify(reason) {
        var snapshot = getSnapshot();
        subscribers.slice().forEach(function (subscriber) {
            subscriber(snapshot, reason || 'update');
        });
        return snapshot;
    }

    function addFunction(functionRef, reason) {
        var normalizedRef = cloneFunctionRef(functionRef);
        if (!normalizedRef) {
            return getSnapshot();
        }

        var existingIndex = findIndex(normalizedRef.id);
        if (existingIndex >= 0) {
            selectedFunctions.splice(existingIndex, 1);
        }
        selectedFunctions.push(normalizedRef);
        return notify(reason || 'addFunction');
    }

    function add(nodeId, reason) {
        return addFunction({ id: nodeId }, reason || 'add');
    }

    function remove(nodeId, reason) {
        var normalized = normalizeId(nodeId);
        if (!normalized) {
            return getSnapshot();
        }

        var existingIndex = findIndex(normalized);
        if (existingIndex >= 0) {
            selectedFunctions.splice(existingIndex, 1);
        }
        return notify(reason || 'remove');
    }

    function toggle(nodeId, reason) {
        var normalized = normalizeId(nodeId);
        if (!normalized) {
            return getSnapshot();
        }

        if (findIndex(normalized) >= 0) {
            remove(normalized, reason || 'toggle');
        } else {
            addFunction({ id: normalized }, reason || 'toggle');
        }
        return getSnapshot();
    }

    function move(fromIndex, toIndex, reason) {
        var from = Number(fromIndex);
        var to = Number(toIndex);
        if (!Number.isInteger(from)
            || !Number.isInteger(to)
            || from === to
            || from < 0
            || to < 0
            || from >= selectedFunctions.length
            || to >= selectedFunctions.length) {
            return getSnapshot();
        }

        var moved = selectedFunctions.splice(from, 1)[0];
        selectedFunctions.splice(to, 0, moved);
        return notify(reason || 'move');
    }

    function clear(reason) {
        if (selectedFunctions.length === 0) {
            return getSnapshot();
        }

        selectedFunctions = [];
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
        addFunction: addFunction,
        remove: remove,
        toggle: toggle,
        move: move,
        clear: clear,
        getSnapshot: getSnapshot,
        subscribe: subscribe,
        has: function (nodeId) {
            return findIndex(nodeId) >= 0;
        },
        reset: function () {
            selectedFunctions = [];
            subscribers = [];
        }
    };
})();
