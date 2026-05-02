(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.RelationGraphTab) {
        return;
    }

    function noop() { }

    function create(context) {
        var safeContext = context || {};
        var cy = safeContext.cy;
        var queryService = safeContext.queryService;
        var graphFocus = safeContext.graphFocus;
        var centerPresentation = safeContext.centerPresentation;
        var centerState = safeContext.centerState;
        var graphEvents = safeContext.graphEvents;
        var ui = safeContext.ui;
        var log = typeof safeContext.log === 'function' ? safeContext.log : noop;
        var postMessage = typeof safeContext.postMessage === 'function' ? safeContext.postMessage : noop;
        var getQueryOptions = typeof safeContext.getQueryOptions === 'function' ? safeContext.getQueryOptions : function () {
            return { relations: [], includeExternal: false };
        };
        var setLastRequestMode = typeof safeContext.setLastRequestMode === 'function' ? safeContext.setLastRequestMode : noop;
        var getLastRequestMode = typeof safeContext.getLastRequestMode === 'function' ? safeContext.getLastRequestMode : function () { return 'relation-global'; };
        var getCurrentCenterNodeId = typeof safeContext.getCurrentCenterNodeId === 'function' ? safeContext.getCurrentCenterNodeId : function () { return null; };
        var getLastCenterNodeId = typeof safeContext.getLastCenterNodeId === 'function' ? safeContext.getLastCenterNodeId : function () { return null; };
        var setCenterNode = typeof safeContext.setCenterNode === 'function' ? safeContext.setCenterNode : noop;
        var getCenterCardEnabled = typeof safeContext.getCenterCardEnabled === 'function' ? safeContext.getCenterCardEnabled : function () { return false; };
        var setCenterCardEnabled = typeof safeContext.setCenterCardEnabled === 'function' ? safeContext.setCenterCardEnabled : noop;
        var getPendingCenterDetailsNodeId = typeof safeContext.getPendingCenterDetailsNodeId === 'function' ? safeContext.getPendingCenterDetailsNodeId : function () { return null; };
        var setPendingCenterDetailsNodeId = typeof safeContext.setPendingCenterDetailsNodeId === 'function' ? safeContext.setPendingCenterDetailsNodeId : noop;
        var getHtmlNodePluginReady = typeof safeContext.getHtmlNodePluginReady === 'function' ? safeContext.getHtmlNodePluginReady : function () { return false; };
        var getCenterDetailsCache = typeof safeContext.getCenterDetailsCache === 'function' ? safeContext.getCenterDetailsCache : function () { return new Map(); };
        var renderHtmlNodeCards = typeof safeContext.renderHtmlNodeCards === 'function' ? safeContext.renderHtmlNodeCards : noop;
        var clearNodeBypassSize = typeof safeContext.clearNodeBypassSize === 'function' ? safeContext.clearNodeBypassSize : noop;
        var clearGlobalToNodeTransitionMask = typeof safeContext.clearGlobalToNodeTransitionMask === 'function' ? safeContext.clearGlobalToNodeTransitionMask : noop;
        var applyGlobalToNodeTransitionMask = typeof safeContext.applyGlobalToNodeTransitionMask === 'function' ? safeContext.applyGlobalToNodeTransitionMask : noop;
        var panCenterNodeToViewport = typeof safeContext.panCenterNodeToViewport === 'function' ? safeContext.panCenterNodeToViewport : noop;
        var setPendingGlobalToNodeTransition = typeof safeContext.setPendingGlobalToNodeTransition === 'function' ? safeContext.setPendingGlobalToNodeTransition : noop;
        var getQueryDebounceWindowMs = typeof safeContext.getQueryDebounceWindowMs === 'function' ? safeContext.getQueryDebounceWindowMs : function () { return 80; };
        var getQueryDuplicateWindowMs = typeof safeContext.getQueryDuplicateWindowMs === 'function' ? safeContext.getQueryDuplicateWindowMs : function () { return 220; };
        var shouldSuppressContextTap = typeof safeContext.shouldSuppressContextTap === 'function' ? safeContext.shouldSuppressContextTap : function () { return false; };
        var shouldSuppressNodeTap = typeof safeContext.shouldSuppressNodeTap === 'function' ? safeContext.shouldSuppressNodeTap : function () { return false; };
        var animateCenterNodeViewport = typeof safeContext.animateCenterNodeViewport === 'function' ? safeContext.animateCenterNodeViewport : noop;
        var lockCenterNodeViewport = typeof safeContext.lockCenterNodeViewport === 'function' ? safeContext.lockCenterNodeViewport : noop;
        var isActiveTab = typeof safeContext.isActiveTab === 'function' ? safeContext.isActiveTab : function () { return true; };
        var captureGraphView = typeof safeContext.captureGraphView === 'function' ? safeContext.captureGraphView : noop;
        var restoreGraphView = typeof safeContext.restoreGraphView === 'function' ? safeContext.restoreGraphView : function () { return false; };
        var suppressNodeTapNodeId = null;
        var suppressNodeTapUntil = 0;

        function applyCenterCardPresentation(options) {
            if (!centerPresentation || typeof centerPresentation.applyCenterCardPresentation !== 'function') {
                return false;
            }

            centerPresentation.applyCenterCardPresentation({
                ...(options || {}),
                cy: cy,
                currentCenterNodeId: getCurrentCenterNodeId(),
                lastCenterNodeId: getLastCenterNodeId(),
                centerCardEnabled: getCenterCardEnabled(),
                htmlNodePluginReady: getHtmlNodePluginReady(),
                log: log,
                renderHtmlNodeCards: renderHtmlNodeCards,
                clearNodeBypassSize: clearNodeBypassSize
            });
            return true;
        }

        function resetFocus() {
            if (graphFocus && typeof graphFocus.resetFocus === 'function') {
                graphFocus.resetFocus(cy);
                return;
            }

            cy.elements().removeClass('faded focus');
            cy.fit(undefined, 70);
        }

        function sendQuery(command, payload, meta) {
            if (!queryService || typeof queryService.sendQuery !== 'function') {
                return null;
            }

            return queryService.sendQuery({
                command: command,
                payload: payload,
                meta: meta,
                debounceWindowMs: getQueryDebounceWindowMs(),
                duplicateWindowMs: getQueryDuplicateWindowMs(),
                log: log,
                postMessage: postMessage
            });
        }

        function requestGlobalRelation(source, options) {
            var safeOptions = options || {};
            var queryOptions = safeOptions.queryOptionsOverride || getQueryOptions();
            var payload = safeOptions.payloadOverride || {
                relations: queryOptions.relations,
                includeExternal: queryOptions.includeExternal
            };

            setPendingGlobalToNodeTransition(null);
            clearGlobalToNodeTransitionMask('requestGlobalRelation');
            setLastRequestMode('relation-global');
            setCenterCardEnabled(false);
            if (centerState && typeof centerState.setCenterCardEnabled === 'function') {
                centerState.setCenterCardEnabled(false);
            }

            if (queryService && typeof queryService.rememberLastQuery === 'function') {
                queryService.rememberLastQuery('queryGlobalRelation', payload, source || 'toolbar-button', log);
            }

            log('query', 'info', 'request global relation', {
                source: source || 'toolbar-button',
                queryOptions: queryOptions,
                payload: payload
            });

            sendQuery('queryGlobalRelation', payload, {
                requestMode: 'relation-global'
            });

            if (centerPresentation && typeof centerPresentation.clearCenterCardState === 'function') {
                centerPresentation.clearCenterCardState({
                    reason: 'global-query',
                    refreshCards: false,
                    cy: cy,
                    log: log,
                    setCenterNode: setCenterNode,
                    setPendingCenterDetailsNodeId: setPendingCenterDetailsNodeId,
                    renderHtmlNodeCards: renderHtmlNodeCards,
                    clearNodeBypassSize: clearNodeBypassSize
                });
            }
        }

        function requestNodeDependencies(nodeId, source, options) {
            var safeOptions = options || {};
            var queryOptions = safeOptions.queryOptionsOverride || getQueryOptions();
            var normalizedNodeId = String(nodeId);
            var payload = safeOptions.payloadOverride || {
                nodeId: normalizedNodeId,
                allowedRelations: queryOptions.relations,
                includeExternal: queryOptions.includeExternal
            };

            setLastRequestMode('relation-node');
            setPendingCenterDetailsNodeId(String(payload.nodeId || normalizedNodeId));

            var nextCenterCardEnabled = safeOptions.enableCenterCard === true;
            setCenterCardEnabled(nextCenterCardEnabled);
            if (centerState && typeof centerState.setCenterCardEnabled === 'function') {
                centerState.setCenterCardEnabled(nextCenterCardEnabled);
            }

            if (safeOptions.setAsCenterNode !== false) {
                setCenterNode(payload.nodeId || normalizedNodeId, 'request-node:' + (source || 'node-tap'));
            }

            var centerStateVersion = centerState && typeof centerState.getCenterVersion === 'function'
                ? centerState.getCenterVersion()
                : 0;

            if (queryService && typeof queryService.rememberLastQuery === 'function') {
                queryService.rememberLastQuery('queryNodeDependencies', payload, source || 'node-tap', log);
            }

            log('query', 'info', 'request node dependencies', {
                source: source || 'node-tap',
                nodeId: payload.nodeId || normalizedNodeId,
                queryOptions: queryOptions,
                centerStateVersion: centerStateVersion,
                pendingCenterDetailsNodeId: getPendingCenterDetailsNodeId(),
                centerCardEnabled: getCenterCardEnabled(),
                payload: payload
            });

            sendQuery('queryNodeDependencies', payload, {
                requestMode: 'relation-node',
                centerStateVersion: centerStateVersion,
                centerNodeId: String(payload.nodeId || normalizedNodeId)
            });
        }

        function replayLastQuery(source) {
            var rememberedQuery = queryService && typeof queryService.getLastQueryRequest === 'function'
                ? queryService.getLastQueryRequest()
                : null;

            if (!rememberedQuery) {
                log('query', 'info', 'replay last query fallback to global', { source: source });
                requestGlobalRelation(source || 'replay-fallback');
                return;
            }

            log('query', 'info', 'replay last query', {
                source: source,
                lastCommand: rememberedQuery.command,
                lastPayload: rememberedQuery.payload,
                lastSource: rememberedQuery.source
            });

            if (rememberedQuery.command === 'queryNodeDependencies') {
                var replayNodeId = String(
                    rememberedQuery.payload?.nodeId || getCurrentCenterNodeId() || getPendingCenterDetailsNodeId() || ''
                );

                if (!replayNodeId) {
                    requestGlobalRelation((source || 'replay') + ':node-replay-fallback');
                    return;
                }

                setCenterCardEnabled(false);
                if (centerState && typeof centerState.setCenterCardEnabled === 'function') {
                    centerState.setCenterCardEnabled(false);
                }
                applyCenterCardPresentation();
                resetFocus();

                requestNodeDependencies(replayNodeId, source || 'replay-node', {
                    payloadOverride: {
                        ...rememberedQuery.payload,
                        nodeId: replayNodeId
                    },
                    enableCenterCard: false,
                    setAsCenterNode: true
                });
                return;
            }

            requestGlobalRelation(source || 'replay-global', {
                payloadOverride: { ...(rememberedQuery.payload || {}) }
            });
            resetFocus();
        }

        function onNodeTap(node) {
            if (!isActiveTab()) {
                return;
            }

            var tappedNodeId = String(node.id());

            if (shouldSuppressNodeTap(tappedNodeId)) {
                log('summary', 'verbose', '[SummaryUI] tap-suppressed', {
                    nodeId: tappedNodeId
                });
                return;
            }

            if (suppressNodeTapNodeId === tappedNodeId && Date.now() <= suppressNodeTapUntil) {
                log('state', 'verbose', 'suppress node tap after card action', {
                    nodeId: tappedNodeId,
                    suppressNodeTapUntil: suppressNodeTapUntil
                });
                return;
            }

            if (getCurrentCenterNodeId() && tappedNodeId === String(getCurrentCenterNodeId()) && getCenterCardEnabled()) {
                log('state', 'info', 'ignore repeated center node tap', {
                    nodeId: tappedNodeId,
                    reason: 'center-refresh-only-via-header-action'
                });
                return;
            }

            var previousCenter = getCurrentCenterNodeId();
            var isRepeatCenterTap = !!previousCenter && previousCenter === tappedNodeId;
            var isGlobalToNodeTransition = getLastRequestMode() === 'relation-global';

            log('state', 'info', 'node tap', {
                nodeId: tappedNodeId,
                hasCachedCenterDetails: getCenterDetailsCache().has(tappedNodeId),
                isRepeatCenterTap: isRepeatCenterTap,
                transitionPath: (previousCenter || 'null') + ' -> ' + tappedNodeId
            });

            setCenterCardEnabled(true);
            if (centerState && typeof centerState.setCenterCardEnabled === 'function') {
                centerState.setCenterCardEnabled(true);
            }
            setCenterNode(tappedNodeId, 'tap-node');
            applyCenterCardPresentation({ skipHtmlRender: true });

            if (isGlobalToNodeTransition) {
                setPendingGlobalToNodeTransition({
                    centerNodeId: tappedNodeId,
                    ts: Date.now()
                });
                applyGlobalToNodeTransitionMask(tappedNodeId);
                panCenterNodeToViewport('global-to-node:tap-anchor');
            } else {
                setPendingGlobalToNodeTransition(null);
                clearGlobalToNodeTransitionMask('node-tap:non-global-transition');
            }

            var neighborhood = node.closedNeighborhood();
            cy.elements().addClass('faded').removeClass('focus');
            neighborhood.removeClass('faded');
            node.addClass('focus');

            requestNodeDependencies(tappedNodeId, 'node-tap', {
                enableCenterCard: true,
                setAsCenterNode: false
            });
        }

        function toggleCenterPresentation(source) {
            if (!centerPresentation || typeof centerPresentation.toggleCenterNodePresentation !== 'function') {
                return false;
            }

            return centerPresentation.toggleCenterNodePresentation({
                source: source,
                cy: cy,
                lastRequestMode: getLastRequestMode(),
                currentCenterNodeId: getCurrentCenterNodeId(),
                centerCardEnabled: getCenterCardEnabled(),
                centerLockZoom: safeContext.centerLockZoom,
                centerOverviewZoom: safeContext.centerOverviewZoom,
                setCenterCardEnabled: function (nextValue) {
                    setCenterCardEnabled(!!nextValue);
                    if (centerState && typeof centerState.setCenterCardEnabled === 'function') {
                        centerState.setCenterCardEnabled(!!nextValue);
                    }
                },
                getCenterCardEnabled: getCenterCardEnabled,
                getCurrentCenterNodeId: getCurrentCenterNodeId,
                applyCenterCardPresentation: applyCenterCardPresentation,
                clearNodeBypassSize: clearNodeBypassSize,
                animateCenterNodeViewport: animateCenterNodeViewport,
                lockCenterNodeViewport: lockCenterNodeViewport,
                log: log
            });
        }

        function onNodeContextTap(node) {
            if (!isActiveTab()) {
                return;
            }

            if (shouldSuppressContextTap()) {
                log('state', 'verbose', 'suppress node context tap', {
                    nodeId: node ? String(node.id()) : null
                });
                return;
            }

            var tappedNodeId = String(node.id());
            if (!getCurrentCenterNodeId() || tappedNodeId !== String(getCurrentCenterNodeId())) {
                return;
            }

            toggleCenterPresentation('node-context');
        }

        function onBackgroundContextTap() {
            if (!isActiveTab()) {
                return;
            }

            if (shouldSuppressContextTap()) {
                log('state', 'verbose', 'suppress background context tap', {});
                return;
            }

            if (toggleCenterPresentation('background-context')) {
                return;
            }

            log('state', 'info', 'background context tap -> replay last query', {});
            replayLastQuery('background-reset');
        }

        function bindGraphEvents() {
            if (!graphEvents || typeof graphEvents.register !== 'function') {
                return;
            }

            graphEvents.register(cy, {
                onNodeTap: onNodeTap,
                onNodeContextTap: onNodeContextTap,
                onBackgroundContextTap: onBackgroundContextTap
            });
        }

        function bindToolbar() {
            if (!ui || typeof ui.register !== 'function') {
                return;
            }

            ui.register({
                onFit: function () { cy.fit(undefined, 70); },
                onLayout: function () { cy.layout(window.AnalysisStyle.getAltLayout()).run(); },
                onReset: function () { replayLastQuery('manual-reset'); },
                onQueryGlobalRelation: function () { requestGlobalRelation('toolbar-button'); }
            });
        }

        function onHeaderAction(nodeId) {
            suppressNodeTapNodeId = String(nodeId);
            suppressNodeTapUntil = Date.now() + 300;

            requestNodeDependencies(nodeId, 'card-header-refresh', {
                enableCenterCard: true,
                setAsCenterNode: true
            });
        }

        function handleBackendMessage(data, responseMeta) {
            if (responseMeta?.command === 'queryNodeDependencies') {
                var responseVersion = Number(responseMeta?.meta?.centerStateVersion);
                var currentVersion = Number(
                    centerState && typeof centerState.getCenterVersion === 'function'
                        ? centerState.getCenterVersion()
                        : 0
                );
                var responseCenterNodeId = responseMeta?.meta?.centerNodeId ? String(responseMeta.meta.centerNodeId) : null;
                var currentCenterId = getCurrentCenterNodeId() ? String(getCurrentCenterNodeId()) : null;
                var hasVersion = Number.isFinite(responseVersion);

                if ((hasVersion && responseVersion !== currentVersion)
                    || (responseCenterNodeId && currentCenterId && responseCenterNodeId !== currentCenterId)) {
                    log('query', 'info', 'drop stale node query response', {
                        responseQueryId: data?.__queryId || null,
                        responseVersion: responseVersion,
                        currentVersion: currentVersion,
                        responseCenterNodeId: responseCenterNodeId,
                        currentCenterId: currentCenterId
                    });
                    return false;
                }
            }

            return true;
        }

        return {
            id: 'relationGraph',
            bindGraphEvents: bindGraphEvents,
            bindToolbar: bindToolbar,
            requestGlobalRelation: requestGlobalRelation,
            requestNodeDependencies: requestNodeDependencies,
            replayLastQuery: replayLastQuery,
            onHeaderAction: onHeaderAction,
            handleBackendMessage: handleBackendMessage,
            onBeforeDeactivate: function () {
                captureGraphView('relationGraph');
            },
            onBeforeActivate: function () {
                return restoreGraphView('relationGraph') === true;
            },
            onActivate: function (event) {
                log('state', 'info', 'activate relation graph tab', event || {});
                if (event && event.restoredView) {
                    return;
                }
                if (event && event.source !== 'startup' && cy && cy.elements().length === 0) {
                    requestGlobalRelation('tab-activate');
                }
            },
            onDeactivate: function (event) {
                log('state', 'info', 'deactivate relation graph tab', event || {});
            }
        };
    }

    modules.RelationGraphTab = {
        create: create
    };
})();
