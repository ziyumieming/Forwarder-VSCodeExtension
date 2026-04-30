(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CallGraphTab) {
        return;
    }

    function noop() { }

    function firstNonBlank() {
        for (var i = 0; i < arguments.length; i += 1) {
            var value = arguments[i];
            if (value === undefined || value === null) {
                continue;
            }

            var text = String(value).trim();
            if (text.length > 0) {
                return text;
            }
        }

        return '';
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

    function summarizeUri(uri) {
        var text = String(uri || '').trim();
        if (!text) {
            return '';
        }

        var normalized = text.replace(/\\/g, '/');
        var parts = normalized.split('/').filter(function (part) {
            return part.length > 0;
        });
        return parts.length > 0 ? parts[parts.length - 1] : normalized;
    }

    function nodeToFunctionRef(nodeOrData) {
        var data = typeof nodeOrData?.data === 'function' ? nodeOrData.data() : (nodeOrData || {});
        var nodeKind = firstNonBlank(data.nodeKind, data.type);
        if (nodeKind && nodeKind !== 'function' && nodeKind !== 'method') {
            return null;
        }

        var id = firstNonBlank(data.id);
        if (!id) {
            return null;
        }

        return {
            id: id,
            label: firstNonBlank(data.baseLabel, data.label, data.name, labelFromId(id)),
            meta: firstNonBlank(data.namespace, summarizeUri(data.uri), nodeKind),
            source: 'call-graph'
        };
    }

    function cloneFunctionRef(functionRef) {
        if (!functionRef || !functionRef.id) {
            return null;
        }

        return {
            id: String(functionRef.id),
            label: firstNonBlank(functionRef.label, labelFromId(functionRef.id)),
            meta: firstNonBlank(functionRef.meta),
            source: firstNonBlank(functionRef.source)
        };
    }

    function create(context) {
        var safeContext = context || {};
        var cy = safeContext.cy;
        var selectionStore = safeContext.selectionStore;
        var queryService = safeContext.queryService;
        var postMessage = typeof safeContext.postMessage === 'function' ? safeContext.postMessage : null;
        var log = typeof safeContext.log === 'function' ? safeContext.log : noop;
        var clearCanvas = typeof safeContext.clearCanvas === 'function' ? safeContext.clearCanvas : noop;
        var renderGraphData = typeof safeContext.renderGraphData === 'function' ? safeContext.renderGraphData : noop;
        var isActiveTab = typeof safeContext.isActiveTab === 'function' ? safeContext.isActiveTab : function () { return false; };
        var captureGraphView = typeof safeContext.captureGraphView === 'function' ? safeContext.captureGraphView : noop;
        var restoreGraphView = typeof safeContext.restoreGraphView === 'function' ? safeContext.restoreGraphView : function () { return false; };
        var hasGraphViewState = typeof safeContext.hasGraphViewState === 'function' ? safeContext.hasGraphViewState : function () { return false; };
        var hasPendingGraphRender = typeof safeContext.hasPendingGraphRender === 'function' ? safeContext.hasPendingGraphRender : function () { return false; };
        var showEmptyGraphView = typeof safeContext.showEmptyGraphView === 'function' ? safeContext.showEmptyGraphView : noop;
        var getQueryDebounceWindowMs = typeof safeContext.getQueryDebounceWindowMs === 'function'
            ? safeContext.getQueryDebounceWindowMs
            : function () { return 80; };
        var getQueryDuplicateWindowMs = typeof safeContext.getQueryDuplicateWindowMs === 'function'
            ? safeContext.getQueryDuplicateWindowMs
            : function () { return 220; };

        var state = {
            centerFunction: null,
            depth: 2,
            direction: 'both',
            includeExternal: false,
            hasRenderedCallGraph: false,
            lastQueryKind: 'center',
            contextNode: null,
            cursorFunctionCandidate: null,
            selectionSnapshot: {
                functions: [],
                functionIds: []
            }
        };

        var refs = {};
        var unsubscribeSelection = null;

        function readRefs() {
            refs.depth = document.getElementById('call-depth');
            refs.direction = document.getElementById('call-direction');
            refs.includeExternal = document.getElementById('call-include-external');
            refs.query = document.getElementById('btn-call-query');
            refs.centerPill = document.getElementById('call-center-pill');
            refs.fit = document.getElementById('btn-call-fit');
            refs.layout = document.getElementById('btn-call-layout');
            refs.clear = document.getElementById('btn-call-clear');
            refs.emptyOverlay = document.getElementById('call-empty-overlay');
            refs.emptyText = document.getElementById('call-empty-text');
            refs.useCursorCenter = document.getElementById('btn-call-use-cursor-center');
            refs.contextMenu = document.getElementById('call-context-menu');
        }

        function getPathSlots() {
            var snapshot = state.selectionSnapshot || {};
            if (Array.isArray(snapshot.functions)) {
                return snapshot.functions;
            }
            if (Array.isArray(snapshot.functionRefs)) {
                return snapshot.functionRefs;
            }
            if (Array.isArray(snapshot.functionIds)) {
                return snapshot.functionIds.map(function (id) {
                    return {
                        id: String(id),
                        label: labelFromId(id),
                        meta: ''
                    };
                });
            }
            return [];
        }

        function getCandidateCenter() {
            return state.cursorFunctionCandidate || getPathSlots()[0] || null;
        }

        function setCenterFunction(functionRef, source) {
            state.centerFunction = cloneFunctionRef(functionRef);
            state.hasRenderedCallGraph = false;
            updateUi();

            log('state', 'info', 'call graph center set', {
                source: source || 'unknown',
                centerFunctionId: state.centerFunction ? state.centerFunction.id : null
            });
        }

        function addPathSlot(functionRef) {
            var normalizedRef = cloneFunctionRef(functionRef);
            if (!normalizedRef) {
                return;
            }

            if (selectionStore && typeof selectionStore.addFunction === 'function') {
                selectionStore.addFunction({
                    ...normalizedRef,
                    source: normalizedRef.source || 'call-graph'
                }, 'call-graph-add');
                return;
            }

            log('state', 'error', 'selection store missing addFunction', {});
        }

        function sendQuery(command, payload, requestMode) {
            if (!queryService || typeof queryService.sendQuery !== 'function' || !postMessage) {
                log('query', 'error', 'call graph query service unavailable', {
                    command: command,
                    requestMode: requestMode
                });
                return null;
            }

            return queryService.sendQuery({
                command: command,
                payload: payload,
                postMessage: postMessage,
                log: log,
                debounceWindowMs: getQueryDebounceWindowMs(),
                duplicateWindowMs: getQueryDuplicateWindowMs(),
                meta: {
                    requestMode: requestMode
                }
            });
        }

        function requestCenterGraph(source) {
            if (!state.centerFunction || !state.centerFunction.id) {
                log('query', 'info', 'skip call graph query without center', { source: source || 'unknown' });
                return null;
            }

            state.lastQueryKind = 'center';
            return sendQuery('queryFunctionCallGraph', {
                nodeId: state.centerFunction.id,
                direction: state.direction || 'both',
                depth: state.depth || 2,
                includeExternal: !!state.includeExternal,
                maxNodes: 100,
                maxEdges: 300
            }, 'call-graph');
        }

        function requestPathGraph(source) {
            var pathSlots = getPathSlots();
            if (pathSlots.length < 2) {
                log('query', 'info', 'skip call path query without enough waypoints', {
                    source: source || 'unknown',
                    waypointCount: pathSlots.length
                });
                return null;
            }

            state.lastQueryKind = 'path';
            if (pathSlots.length === 2) {
                return sendQuery('queryFunctionCallPath', {
                    sourceId: pathSlots[0].id,
                    targetId: pathSlots[1].id,
                    direction: 'outgoing',
                    maxDepth: 8,
                    includeExternal: !!state.includeExternal
                }, 'call-path');
            }

            return sendQuery('queryFunctionCallWaypointPath', {
                nodeIds: pathSlots.map(function (slot) { return slot.id; }),
                direction: 'outgoing',
                maxDepthPerSegment: 8,
                includeExternal: !!state.includeExternal
            }, 'call-path');
        }

        function replayLastQuery(source) {
            if (state.lastQueryKind === 'path') {
                return requestPathGraph(source || 'replay-path');
            }
            return requestCenterGraph(source || 'replay-center');
        }

        function updateUi() {
            if (!refs.depth) {
                readRefs();
            }

            var hasCenter = !!(state.centerFunction && state.centerFunction.id);
            var candidateCenter = getCandidateCenter();
            if (refs.depth) {
                refs.depth.value = String(state.depth);
            }
            if (refs.direction) {
                refs.direction.value = state.direction;
            }
            if (refs.includeExternal) {
                refs.includeExternal.checked = !!state.includeExternal;
            }
            if (refs.query) {
                refs.query.disabled = !hasCenter;
            }
            if (refs.centerPill) {
                refs.centerPill.textContent = hasCenter
                    ? (state.centerFunction.label || labelFromId(state.centerFunction.id))
                    : 'No center';
                refs.centerPill.title = hasCenter
                    ? [state.centerFunction.id, state.centerFunction.meta].filter(Boolean).join('\n')
                    : 'No center selected';
            }
            if (refs.useCursorCenter) {
                refs.useCursorCenter.disabled = !candidateCenter;
                refs.useCursorCenter.textContent = state.cursorFunctionCandidate
                    ? 'Use Cursor as Center'
                    : 'Use Path Candidate';
                refs.useCursorCenter.title = candidateCenter
                    ? [candidateCenter.id, candidateCenter.meta].filter(Boolean).join('\n')
                    : 'No cursor function candidate';
            }
            if (refs.emptyText) {
                refs.emptyText.textContent = candidateCenter
                    ? 'Candidate: ' + (candidateCenter.label || labelFromId(candidateCenter.id))
                    : 'Move the editor cursor into a function, or choose a function node as the center.';
            }
            if (refs.emptyOverlay) {
                refs.emptyOverlay.hidden = !isActiveTab() || hasCenter || state.hasRenderedCallGraph;
            }
        }

        function hideContextMenu() {
            if (!refs.contextMenu) {
                return;
            }

            refs.contextMenu.hidden = true;
            state.contextNode = null;
        }

        function showContextMenu(node, event) {
            if (!refs.contextMenu) {
                readRefs();
            }
            if (!refs.contextMenu) {
                return;
            }

            state.contextNode = nodeToFunctionRef(node);
            if (!state.contextNode) {
                return;
            }

            var renderedPosition = event && event.renderedPosition ? event.renderedPosition : null;
            var x = renderedPosition ? renderedPosition.x : 120;
            var y = renderedPosition ? renderedPosition.y : 120;
            refs.contextMenu.style.left = Math.max(12, Math.round(x)) + 'px';
            refs.contextMenu.style.top = Math.max(72, Math.round(y)) + 'px';
            refs.contextMenu.hidden = false;
        }

        function handleContextAction(action) {
            var functionRef = state.contextNode;
            hideContextMenu();
            if (!functionRef) {
                return;
            }

            if (action === 'center') {
                setCenterFunction(functionRef, 'context-menu');
                return;
            }

            addPathSlot(functionRef);
        }

        function bindToolbar() {
            readRefs();

            refs.depth?.addEventListener('change', function () {
                var nextDepth = Number(refs.depth.value);
                state.depth = Number.isFinite(nextDepth) ? nextDepth : 2;
                updateUi();
            });
            refs.direction?.addEventListener('change', function () {
                state.direction = refs.direction.value || 'both';
                updateUi();
            });
            refs.includeExternal?.addEventListener('change', function () {
                state.includeExternal = !!refs.includeExternal.checked;
                updateUi();
            });
            refs.query?.addEventListener('click', function () {
                requestCenterGraph('toolbar');
            });
            refs.fit?.addEventListener('click', function () {
                if (cy) {
                    cy.fit(undefined, 80);
                }
            });
            refs.layout?.addEventListener('click', function () {
                if (cy) {
                    cy.layout(globalScope.AnalysisStyle.getAltLayout()).run();
                }
            });
            refs.clear?.addEventListener('click', function () {
                state.centerFunction = null;
                state.hasRenderedCallGraph = false;
                clearCanvas('call-graph-clear');
                updateUi();
            });
            refs.useCursorCenter?.addEventListener('click', function () {
                var candidate = getCandidateCenter();
                if (candidate) {
                    setCenterFunction(candidate, state.cursorFunctionCandidate ? 'empty-overlay-cursor' : 'empty-overlay-path');
                }
            });
            refs.contextMenu?.addEventListener('click', function (event) {
                var action = event.target && event.target.dataset ? event.target.dataset.callAction : null;
                if (action) {
                    handleContextAction(action);
                }
            });
            document.addEventListener('click', function (event) {
                if (!refs.contextMenu || refs.contextMenu.hidden) {
                    return;
                }
                if (refs.contextMenu.contains(event.target)) {
                    return;
                }
                hideContextMenu();
            });

            if (selectionStore && typeof selectionStore.subscribe === 'function') {
                unsubscribeSelection = selectionStore.subscribe(function (snapshot) {
                    state.selectionSnapshot = snapshot || {
                        functions: [],
                        functionIds: []
                    };
                    updateUi();
                });
            }

            updateUi();
        }

        function bindGraphEvents() {
            if (!cy) {
                return;
            }

            cy.on('tap', 'node', function (event) {
                if (!isActiveTab()) {
                    return;
                }
                hideContextMenu();
                var functionRef = nodeToFunctionRef(event.target);
                if (functionRef) {
                    setCenterFunction(functionRef, 'node-tap');
                }
            });

            cy.on('cxttap', 'node', function (event) {
                if (!isActiveTab()) {
                    return;
                }
                showContextMenu(event.target, event);
            });

            cy.on('tap', function (event) {
                if (!isActiveTab() || event.target !== cy) {
                    return;
                }
                hideContextMenu();
            });
        }

        function activate(event) {
            log('state', 'info', 'activate call graph tab', event || {});
            if (event && event.restoredView) {
                state.hasRenderedCallGraph = true;
            } else if (!hasGraphViewState('callGraph') && !hasPendingGraphRender('callGraph') && !state.hasRenderedCallGraph) {
                showEmptyGraphView('callGraph', 'call-graph');
            }
            updateUi();
        }

        function deactivate(event) {
            log('state', 'info', 'deactivate call graph tab', event || {});
            hideContextMenu();
            if (refs.emptyOverlay) {
                refs.emptyOverlay.hidden = true;
            }
        }

        return {
            id: 'callGraph',
            bindToolbar: bindToolbar,
            bindGraphEvents: bindGraphEvents,
            onBeforeDeactivate: function () {
                captureGraphView('callGraph');
            },
            onBeforeActivate: function () {
                return restoreGraphView('callGraph') === true;
            },
            onActivate: activate,
            onReactivate: activate,
            onDeactivate: deactivate,
            requestCenterGraph: requestCenterGraph,
            requestPathGraph: requestPathGraph,
            replayLastQuery: replayLastQuery,
            addPathSlot: addPathSlot,
            setCenterFunction: setCenterFunction,
            setCursorFunctionCandidate: function (functionRef) {
                state.cursorFunctionCandidate = cloneFunctionRef(functionRef);
                updateUi();
            },
            renderGraphData: function (graphData, options) {
                state.hasRenderedCallGraph = true;
                var requestMode = options && options.requestMode ? options.requestMode : 'call-graph';
                renderGraphData(graphData, {
                    ...(options || {}),
                    currentCenterNodeId: requestMode === 'call-path'
                        ? null
                        : (state.centerFunction ? state.centerFunction.id : null)
                });
                updateUi();
            },
            dispose: function () {
                if (typeof unsubscribeSelection === 'function') {
                    unsubscribeSelection();
                }
            },
            getState: function () {
                return {
                    centerFunction: state.centerFunction ? { ...state.centerFunction } : null,
                    depth: state.depth,
                    direction: state.direction,
                    includeExternal: state.includeExternal,
                    pathSlots: getPathSlots().map(function (slot) { return { ...slot }; })
                };
            }
        };
    }

    modules.CallGraphTab = {
        create: create
    };
})();
