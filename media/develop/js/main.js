(function () {
    const vscode = acquireVsCodeApi();
    let currentCenterNodeId = null;
    let pendingCenterDetailsNodeId = null;
    const centerDetailsCache = new Map();
    const classCardModelCache = new Map();
    let htmlNodePluginReady = false;
    let lastRequestMode = 'global';
    let lastCenterNodeId = null;
    let centerCardEnabled = false;
    const collapsedCardSections = new Set();
    let suppressNodeTapNodeId = null;
    let suppressNodeTapUntil = 0;
    const CENTER_LOCK_ZOOM = 1;
    const CENTER_OVERVIEW_ZOOM = 0.5;
    let latestGraphSnapshot = {
        nodes: new Map(),
        edges: new Map()
    };
    let layoutAnimationToken = 0;

    const DEBUG_LEVELS = {
        off: 0,
        error: 1,
        info: 2,
        verbose: 3
    };

    const loggerModule = window.AnalysisModules?.Logger;
    const pluginManagerModule = window.AnalysisModules?.PluginManager;
    const cardMarkupModule = window.AnalysisModules?.CardMarkup;
    const cardRenderModule = window.AnalysisModules?.CardRender;
    const cardEventsModule = window.AnalysisModules?.CardEvents;
    const viewportAnimationModule = window.AnalysisModules?.ViewportAnimation;
    const centerStateModule = window.AnalysisModules?.CenterState;
    const queryServiceModule = window.AnalysisModules?.QueryService;
    const graphIncrementalModule = window.AnalysisModules?.GraphIncremental;
    const graphPipelineModule = window.AnalysisModules?.GraphPipeline;
    const layoutManagerModule = window.AnalysisModules?.LayoutManager;
    const graphFocusModule = window.AnalysisModules?.GraphFocus;
    const centerPresentationModule = window.AnalysisModules?.CenterPresentation;

    if (graphIncrementalModule && typeof graphIncrementalModule.createEmptyGraphSnapshot === 'function') {
        latestGraphSnapshot = graphIncrementalModule.createEmptyGraphSnapshot();
    }

    if (centerStateModule && typeof centerStateModule.syncState === 'function') {
        centerStateModule.syncState({
            currentCenterNodeId,
            lastCenterNodeId,
            pendingCenterDetailsNodeId,
            centerCardEnabled
        });
    }

    const loggerOptions = {
        levels: DEBUG_LEVELS,
        fallbackLevel: 'info'
    };

    const log = (channel, level, message, payload) => {
        if (loggerModule && typeof loggerModule.log === 'function') {
            loggerModule.log(channel, level, message, payload, loggerOptions);
            return;
        }

        const debugLevel = (window.__analysisDebugLevel || 'info').toString().toLowerCase();
        const normalizedDebugLevel = Object.prototype.hasOwnProperty.call(DEBUG_LEVELS, debugLevel)
            ? debugLevel
            : 'info';
        const current = DEBUG_LEVELS[normalizedDebugLevel];
        const required = DEBUG_LEVELS[level] ?? DEBUG_LEVELS.info;

        if (current < required) {
            return;
        }

        const event = {
            ts: Date.now(),
            channel,
            level,
            message,
            ...payload
        };

        if (level === 'error') {
            console.error('[AnalysisView][ClassCard]', event);
            return;
        }

        if (level === 'verbose') {
            console.debug('[AnalysisView][ClassCard]', event);
            return;
        }

        console.info('[AnalysisView][ClassCard]', event);
    };

    const debug = (...args) => {
        if (loggerModule && typeof loggerModule.debug === 'function') {
            loggerModule.debug(args[0], args[1], loggerOptions);
            return;
        }

        log('general', 'info', args[0], { details: args[1] });
    };

    const debugWarn = (...args) => {
        if (loggerModule && typeof loggerModule.debugWarn === 'function') {
            loggerModule.debugWarn(args[0], args[1], loggerOptions);
            return;
        }

        log('general', 'error', args[0], { details: args[1] });
    };

    function createCyInstance() {
        return cytoscape({
            container: document.getElementById('cy'),
            elements: [],
            style: window.AnalysisStyle.getCytoscapeStyle(),
            layout: window.AnalysisStyle.getDefaultLayout()
        });
    }

    const cy = createCyInstance();
    window.__analysisDebug = { cy };

    log('state', 'info', 'bootstrap', {
        cyReady: !!cy,
        pluginMode: pluginManagerModule && typeof pluginManagerModule.getMode === 'function'
            ? pluginManagerModule.getMode(cy)
            : null,
        scriptCount: document.querySelectorAll('script[src]').length,
        debugLevel: loggerModule && typeof loggerModule.getDebugLevelName === 'function'
            ? loggerModule.getDebugLevelName({ levels: DEBUG_LEVELS, fallbackLevel: 'info' })
            : 'info'
    });

    const getClassCardOptions = () => {
        if (typeof window.AnalysisUI?.getClassCardOptions === 'function') {
            return window.AnalysisUI.getClassCardOptions();
        }

        return {
            showFields: true,
            showMethods: true,
            collapsedSections: []
        };
    };

    const isCardSectionCollapsed = (sectionName) => collapsedCardSections.has(sectionName);

    const buildHtmlClassCard = (nodeId, classCard) => {
        if (cardMarkupModule && typeof cardMarkupModule.buildHtmlClassCard === 'function') {
            return cardMarkupModule.buildHtmlClassCard(nodeId, classCard, {
                getClassCardOptions,
                markSectionCollapsed: (sectionName) => {
                    collapsedCardSections.add(String(sectionName));
                },
                isSectionCollapsed: isCardSectionCollapsed
            });
        }

        return '';
    };

    function dispatchCardCommand(command, payload) {
        vscode.postMessage({
            command,
            ...payload
        });
    }

    function replayLastQuery(source) {
        const rememberedQuery = queryServiceModule && typeof queryServiceModule.getLastQueryRequest === 'function'
            ? queryServiceModule.getLastQueryRequest()
            : null;

        if (!rememberedQuery) {
            log('query', 'info', 'replay last query fallback to global', { source });
            requestGlobalRelation(source);
            return;
        }

        log('query', 'info', 'replay last query', {
            source,
            lastCommand: rememberedQuery.command,
            lastPayload: rememberedQuery.payload,
            lastSource: rememberedQuery.source
        });

        if (rememberedQuery.command === 'queryNodeDependencies') {
            const replayNodeId = String(
                rememberedQuery.payload?.nodeId || currentCenterNodeId || pendingCenterDetailsNodeId || ''
            );

            if (!replayNodeId) {
                requestGlobalRelation(`${source}:node-replay-fallback`);
                return;
            }

            centerCardEnabled = false;
            if (centerStateModule && typeof centerStateModule.setCenterCardEnabled === 'function') {
                centerStateModule.setCenterCardEnabled(centerCardEnabled);
            }
            if (centerPresentationModule && typeof centerPresentationModule.applyCenterCardPresentation === 'function') {
                centerPresentationModule.applyCenterCardPresentation({
                    cy,
                    currentCenterNodeId,
                    lastCenterNodeId,
                    centerCardEnabled,
                    htmlNodePluginReady,
                    log,
                    renderHtmlNodeCards,
                    clearNodeBypassSize: (node) => {
                        centerPresentationModule.clearNodeBypassSize({ node, log, debugWarn });
                    }
                });
            }
            if (graphFocusModule && typeof graphFocusModule.resetFocus === 'function') {
                graphFocusModule.resetFocus(cy);
            } else {
                cy.elements().removeClass('faded focus');
                cy.fit(undefined, 70);
            }

            requestNodeDependencies(replayNodeId, source, {
                payloadOverride: {
                    ...rememberedQuery.payload,
                    nodeId: replayNodeId
                },
                enableCenterCard: false,
                setAsCenterNode: true
            });
            return;
        }

        requestGlobalRelation(source, {
            payloadOverride: { ...rememberedQuery.payload }
        });
        if (graphFocusModule && typeof graphFocusModule.resetFocus === 'function') {
            graphFocusModule.resetFocus(cy);
        } else {
            cy.elements().removeClass('faded focus');
            cy.fit(undefined, 70);
        }
    }

    const lockCenterNodeViewport = (reason, options = {}) => {
        if (!viewportAnimationModule || typeof viewportAnimationModule.lockCenterNodeViewport !== 'function') {
            return false;
        }

        return viewportAnimationModule.lockCenterNodeViewport({
            ...options,
            reason,
            cy,
            log,
            currentCenterNodeId,
            lastRequestMode,
            centerCardEnabled,
            centerLockZoom: CENTER_LOCK_ZOOM,
            centerOverviewZoom: CENTER_OVERVIEW_ZOOM
        });
    };

    const animateCenterNodeViewport = (reason, options = {}) => {
        if (!viewportAnimationModule || typeof viewportAnimationModule.animateCenterNodeViewport !== 'function') {
            return false;
        }

        return viewportAnimationModule.animateCenterNodeViewport({
            ...options,
            reason,
            cy,
            log,
            currentCenterNodeId,
            lastRequestMode,
            centerCardEnabled,
            centerLockZoom: CENTER_LOCK_ZOOM,
            centerOverviewZoom: CENTER_OVERVIEW_ZOOM,
            layoutAnimationToken
        });
    };

    const setCenterNode = (nodeId, reason) => {
        const normalizedId = nodeId ? String(nodeId) : null;
        let changed = currentCenterNodeId !== normalizedId;

        if (centerStateModule && typeof centerStateModule.setCenter === 'function') {
            const centerState = centerStateModule.setCenter(normalizedId);
            changed = !!centerState.changed;
            lastCenterNodeId = centerState.lastCenterNodeId;
            currentCenterNodeId = centerState.currentCenterNodeId;
        } else if (changed) {
            lastCenterNodeId = currentCenterNodeId;
            currentCenterNodeId = normalizedId;
        }

        log('state', 'info', 'center node set', {
            reason,
            previousCenterNodeId: lastCenterNodeId,
            currentCenterNodeId,
            changed
        });

        return changed;
    };

    const bindClassCardEvents = () => {
        if (!cardEventsModule || typeof cardEventsModule.bind !== 'function') {
            return;
        }

        debug('bind class card delegated events');

        cardEventsModule.bind({
            documentRef: document,
            onIgnoreClick: (target) => {
                log('state', 'verbose', `ignore ${target} click after drag`, {});
            },
            onHeaderAction: (nodeId) => {
                suppressNodeTapNodeId = String(nodeId);
                suppressNodeTapUntil = Date.now() + 300;

                requestNodeDependencies(nodeId, 'card-header-refresh', {
                    enableCenterCard: true,
                    setAsCenterNode: true
                });
            },
            onSectionToggle: (sectionToggle) => {
                const sectionName = sectionToggle.dataset.cardSection;
                if (!sectionName) {
                    return;
                }

                const sectionRoot = sectionToggle.closest('.analysis-class-card-section');
                if (!sectionRoot) {
                    return;
                }

                const willCollapse = !sectionRoot.classList.contains('is-collapsed');
                sectionRoot.classList.toggle('is-collapsed', willCollapse);
                sectionToggle.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');

                const caret = sectionToggle.querySelector('.analysis-class-card-caret');
                if (caret) {
                    caret.innerHTML = willCollapse ? '&#9656;' : '&#9662;';
                }

                if (willCollapse) {
                    collapsedCardSections.add(sectionName);
                } else {
                    collapsedCardSections.delete(sectionName);
                }
            },
            onMemberHover: (item, phase) => {
                dispatchCardCommand('classCardMemberHover', {
                    nodeId: item.dataset.nodeId,
                    memberKind: item.dataset.memberKind,
                    memberId: item.dataset.memberId,
                    memberLabel: item.dataset.memberLabel,
                    phase
                });
            },
            onMemberClick: (item) => {
                dispatchCardCommand('classCardMemberClick', {
                    nodeId: item.dataset.nodeId,
                    memberKind: item.dataset.memberKind,
                    memberId: item.dataset.memberId,
                    memberLabel: item.dataset.memberLabel
                });
            }
        });
    };

    const renderHtmlNodeCards = () => {
        if (cardRenderModule && typeof cardRenderModule.renderHtmlNodeCards === 'function') {
            return cardRenderModule.renderHtmlNodeCards({
                isPluginReady: htmlNodePluginReady,
                currentCenterNodeId,
                centerCardEnabled,
                nodeCount: cy.nodes().length,
                cachedCenterDetails: centerDetailsCache.size,
                cy,
                log,
                debugWarn,
                debug,
                centerDetailsCache,
                classCardModelCache,
                createLoadingClassCard: (nodeId) => {
                    if (graphPipelineModule && typeof graphPipelineModule.createLoadingClassCard === 'function') {
                        return graphPipelineModule.createLoadingClassCard(nodeId);
                    }

                    return {
                        nodeId,
                        title: nodeId,
                        fields: ['loading fields...'],
                        methods: ['loading methods...']
                    };
                },
                buildHtmlClassCard,
                clearNodeBypassSize: (node) => {
                    if (centerPresentationModule && typeof centerPresentationModule.clearNodeBypassSize === 'function') {
                        centerPresentationModule.clearNodeBypassSize({
                            node,
                            log,
                            debugWarn
                        });
                    }
                },
                bindClassCardEvents
            });
        }

        return false;
    };

    function renderGraphData(graphData) {
        const animationToken = ++layoutAnimationToken;
        const normalized = graphPipelineModule && typeof graphPipelineModule.normalizeGraphData === 'function'
            ? graphPipelineModule.normalizeGraphData({
                graphData,
                state: {
                    currentCenterNodeId,
                    centerCardEnabled,
                    htmlNodePluginReady,
                    pendingCenterDetailsNodeId
                },
                centerDetailsCache,
                classCardModelCache,
                getClassCardOptions,
                buildHtmlClassCard,
                createEmptyGraphSnapshot: graphIncrementalModule
                    && typeof graphIncrementalModule.createEmptyGraphSnapshot === 'function'
                    ? graphIncrementalModule.createEmptyGraphSnapshot
                    : null,
                addElementToSnapshot: graphIncrementalModule
                    && typeof graphIncrementalModule.addElementToSnapshot === 'function'
                    ? graphIncrementalModule.addElementToSnapshot
                    : null,
                setPendingCenterDetailsNodeId: (nodeId) => {
                    pendingCenterDetailsNodeId = nodeId ? String(nodeId) : null;
                    if (centerStateModule && typeof centerStateModule.setPendingCenterDetailsNodeId === 'function') {
                        centerStateModule.setPendingCenterDetailsNodeId(pendingCenterDetailsNodeId);
                    }
                },
                log,
                debug,
                debugWarn
            })
            : null;
        if (!normalized) {
            debugWarn('normalize skipped: graph pipeline module unavailable', {
                hasGraphPipelineModule: !!graphPipelineModule
            });
            return;
        }

        const { elements, snapshot } = normalized;

        log('state', 'info', 'render graph data', {
            elementCount: elements.length,
            currentCenterNodeId,
            incomingNodes: Array.isArray(graphData?.nodes) ? graphData.nodes.length : -1,
            incomingEdges: Array.isArray(graphData?.edges) ? graphData.edges.length : -1,
            hasCenterDetails: !!graphData?.centerDetails
        });

        let incrementalResult = null;
        if (lastRequestMode === 'node') {
            if (graphIncrementalModule && typeof graphIncrementalModule.applyIncremental === 'function') {
                incrementalResult = graphIncrementalModule.applyIncremental({
                    previousSnapshot: latestGraphSnapshot,
                    nextSnapshot: snapshot,
                    fallbackElements: elements,
                    cy,
                    log
                });
                latestGraphSnapshot = incrementalResult?.nextSnapshot || snapshot;
            } else {
                cy.elements().remove();
                cy.add(elements);
                latestGraphSnapshot = snapshot;
                incrementalResult = {
                    mode: 'full-fallback',
                    structuralChange: true,
                    diff: null,
                    addedNodeIds: [],
                    replacedNodeIds: []
                };
            }
        } else {
            cy.elements().remove();
            cy.add(elements);
            latestGraphSnapshot = snapshot;
        }

        if (lastRequestMode === 'global') {
            setCenterNode(null, 'render:global');
            pendingCenterDetailsNodeId = null;
            if (centerStateModule && typeof centerStateModule.setPendingCenterDetailsNodeId === 'function') {
                centerStateModule.setPendingCenterDetailsNodeId(pendingCenterDetailsNodeId);
            }
        }

        if (graphFocusModule && typeof graphFocusModule.clearTransientInteractionClasses === 'function') {
            graphFocusModule.clearTransientInteractionClasses({
                cy,
                reason: 'renderGraphData',
                log
            });
        } else {
            const fadedCount = cy.elements('.faded').length;
            const focusCount = cy.elements('.focus').length;
            if (fadedCount > 0 || focusCount > 0) {
                cy.elements().removeClass('faded focus');
                log('state', 'verbose', 'clear transient interaction classes', {
                    reason: 'renderGraphData',
                    fadedCount,
                    focusCount
                });
            }
        }
        if (centerPresentationModule && typeof centerPresentationModule.applyCenterCardPresentation === 'function') {
            centerPresentationModule.applyCenterCardPresentation({
                cy,
                currentCenterNodeId,
                lastCenterNodeId,
                centerCardEnabled,
                htmlNodePluginReady,
                log,
                renderHtmlNodeCards,
                clearNodeBypassSize: (node) => {
                    centerPresentationModule.clearNodeBypassSize({ node, log, debugWarn });
                }
            });
        }

        const layoutOptions = {
            ...window.AnalysisStyle.getDefaultLayout()
        };

        const shouldRunLayout =
            lastRequestMode !== 'node'
            || !incrementalResult
            || incrementalResult.structuralChange;

        if (lastRequestMode === 'node') {
            const nodeModeLayoutOptions = layoutManagerModule && typeof layoutManagerModule.getNodeModeLayoutOptions === 'function'
                ? layoutManagerModule.getNodeModeLayoutOptions({
                    fit: false,
                    animate: layoutOptions.animate,
                    currentCenterNodeId,
                    getDefaultLayout: () => window.AnalysisStyle.getDefaultLayout()
                })
                : {
                    ...window.AnalysisStyle.getDefaultLayout(),
                    fit: false,
                    animate: layoutOptions.animate
                };
            Object.assign(layoutOptions, nodeModeLayoutOptions);
        }

        if (!shouldRunLayout) {
            if (!animateCenterNodeViewport('skip-layout:no-structural-change', {
                duration: 260,
                animationToken
            })) {
                lockCenterNodeViewport('skip-layout:no-structural-change');
            }
            return;
        }

        if (lastRequestMode === 'global') {
            const usedGlobalSmoothLayout = layoutManagerModule
                && typeof layoutManagerModule.runGlobalSmoothLayout === 'function'
                && layoutManagerModule.runGlobalSmoothLayout({
                    cy,
                    animationToken,
                    layoutAnimationToken,
                    getDefaultLayout: () => window.AnalysisStyle.getDefaultLayout(),
                    log,
                    debugWarn
                });
            if (usedGlobalSmoothLayout) {
                return;
            }
        }

        if (lastRequestMode === 'node' && incrementalResult?.mode === 'incremental') {
            const usedStagger = layoutManagerModule
                && typeof layoutManagerModule.runNodeStaggerEnterLayout === 'function'
                && layoutManagerModule.runNodeStaggerEnterLayout({
                    cy,
                    animationToken,
                    layoutAnimationToken,
                    incrementalResult,
                    currentCenterNodeId,
                    lastRequestMode,
                    getDefaultLayout: () => window.AnalysisStyle.getDefaultLayout(),
                    log,
                    debugWarn,
                    animateCenterNodeViewport: (reason, options = {}) => animateCenterNodeViewport(reason, options)
                });
            if (usedStagger) {
                return;
            }
        }

        cy.one('layoutstop', () => {
            if (animationToken !== layoutAnimationToken) {
                return;
            }

            if (!animateCenterNodeViewport('layoutstop', {
                duration: 320,
                animationToken
            })) {
                lockCenterNodeViewport('layoutstop');
            }
        });

        cy.layout(layoutOptions).run();
    }

    function requestGlobalRelation(source = 'toolbar-button', options = {}) {
        const queryOptions = options.queryOptionsOverride || window.AnalysisUI.getQueryOptions();
        const payload = options.payloadOverride || {
            relations: queryOptions.relations,
            includeExternal: queryOptions.includeExternal
        };

        lastRequestMode = 'global';
        centerCardEnabled = false;
        if (centerStateModule && typeof centerStateModule.setCenterCardEnabled === 'function') {
            centerStateModule.setCenterCardEnabled(centerCardEnabled);
        }
        if (queryServiceModule && typeof queryServiceModule.rememberLastQuery === 'function') {
            queryServiceModule.rememberLastQuery('queryGlobalRelation', payload, source, log);
        }

        log('query', 'info', 'request global relation', {
            source,
            queryOptions,
            payload
        });
        if (queryServiceModule && typeof queryServiceModule.sendQuery === 'function') {
            queryServiceModule.sendQuery({
                command: 'queryGlobalRelation',
                payload,
                meta: {
                    requestMode: 'global'
                },
                log,
                postMessage: (message) => {
                    vscode.postMessage(message);
                }
            });
        }

        // 发送查询后再做本地状态复位，避免复位异常阻断通信。
        if (centerPresentationModule && typeof centerPresentationModule.clearCenterCardState === 'function') {
            centerPresentationModule.clearCenterCardState({
                reason: 'global-query',
                refreshCards: false,
                cy,
                log,
                setCenterNode,
                setPendingCenterDetailsNodeId: (nodeId) => {
                    pendingCenterDetailsNodeId = nodeId ? String(nodeId) : null;
                    if (centerStateModule && typeof centerStateModule.setPendingCenterDetailsNodeId === 'function') {
                        centerStateModule.setPendingCenterDetailsNodeId(pendingCenterDetailsNodeId);
                    }
                },
                renderHtmlNodeCards,
                clearNodeBypassSize: (node) => {
                    centerPresentationModule.clearNodeBypassSize({ node, log, debugWarn });
                }
            });
        }
    }

    function requestNodeDependencies(nodeId, source = 'node-tap', options = {}) {
        const queryOptions = options.queryOptionsOverride || window.AnalysisUI.getQueryOptions();
        const normalizedNodeId = String(nodeId);
        const payload = options.payloadOverride || {
            nodeId: normalizedNodeId,
            allowedRelations: queryOptions.relations,
            includeExternal: queryOptions.includeExternal
        };

        lastRequestMode = 'node';
        pendingCenterDetailsNodeId = String(payload.nodeId || normalizedNodeId);
        if (centerStateModule && typeof centerStateModule.setPendingCenterDetailsNodeId === 'function') {
            centerStateModule.setPendingCenterDetailsNodeId(pendingCenterDetailsNodeId);
        }

        centerCardEnabled = options.enableCenterCard === true;
        if (centerStateModule && typeof centerStateModule.setCenterCardEnabled === 'function') {
            centerStateModule.setCenterCardEnabled(centerCardEnabled);
        }

        if (options.setAsCenterNode !== false) {
            setCenterNode(payload.nodeId || normalizedNodeId, `request-node:${source}`);
        }

        const centerStateVersion = centerStateModule && typeof centerStateModule.getCenterVersion === 'function'
            ? centerStateModule.getCenterVersion()
            : 0;

        if (queryServiceModule && typeof queryServiceModule.rememberLastQuery === 'function') {
            queryServiceModule.rememberLastQuery('queryNodeDependencies', payload, source, log);
        }

        log('query', 'info', 'request node dependencies', {
            source,
            nodeId: payload.nodeId || normalizedNodeId,
            queryOptions,
            centerStateVersion,
            pendingCenterDetailsNodeId,
            centerCardEnabled,
            payload
        });

        if (queryServiceModule && typeof queryServiceModule.sendQuery === 'function') {
            queryServiceModule.sendQuery({
                command: 'queryNodeDependencies',
                payload,
                meta: {
                    requestMode: 'node',
                    centerStateVersion,
                    centerNodeId: String(payload.nodeId || normalizedNodeId)
                },
                log,
                postMessage: (message) => {
                    vscode.postMessage(message);
                }
            });
        }
    }

    window.AnalysisGraphEvents.register(cy, {
        onNodeTap: (node) => {
            const tappedNodeId = String(node.id());

            if (suppressNodeTapNodeId === tappedNodeId && Date.now() <= suppressNodeTapUntil) {
                log('state', 'verbose', 'suppress node tap after card action', {
                    nodeId: tappedNodeId,
                    suppressNodeTapUntil
                });
                return;
            }

            if (currentCenterNodeId && tappedNodeId === String(currentCenterNodeId) && centerCardEnabled) {
                log('state', 'info', 'ignore repeated center node tap', {
                    nodeId: tappedNodeId,
                    reason: 'center-refresh-only-via-header-action'
                });
                return;
            }

            const previousCenter = currentCenterNodeId;
            const isRepeatCenterTap = !!previousCenter && previousCenter === tappedNodeId;

            log('state', 'info', 'node tap', {
                nodeId: tappedNodeId,
                hasCachedCenterDetails: centerDetailsCache.has(tappedNodeId),
                isRepeatCenterTap,
                transitionPath: `${previousCenter || 'null'} -> ${tappedNodeId}`
            });

            centerCardEnabled = true;
            if (centerStateModule && typeof centerStateModule.setCenterCardEnabled === 'function') {
                centerStateModule.setCenterCardEnabled(centerCardEnabled);
            }
            setCenterNode(tappedNodeId, 'tap-node');
            if (centerPresentationModule && typeof centerPresentationModule.applyCenterCardPresentation === 'function') {
                centerPresentationModule.applyCenterCardPresentation({
                    cy,
                    currentCenterNodeId,
                    lastCenterNodeId,
                    centerCardEnabled,
                    htmlNodePluginReady,
                    skipHtmlRender: true,
                    log,
                    renderHtmlNodeCards,
                    clearNodeBypassSize: (nodeRef) => {
                        centerPresentationModule.clearNodeBypassSize({ node: nodeRef, log, debugWarn });
                    }
                });
            }

            const neighborhood = node.closedNeighborhood();
            cy.elements().addClass('faded').removeClass('focus');
            neighborhood.removeClass('faded');
            node.addClass('focus');

            requestNodeDependencies(tappedNodeId, 'node-tap', {
                enableCenterCard: true,
                setAsCenterNode: false
            });
        },
        onNodeContextTap: (node) => {
            const tappedNodeId = String(node.id());
            if (!currentCenterNodeId || tappedNodeId !== String(currentCenterNodeId)) {
                return;
            }

            if (centerPresentationModule
                && typeof centerPresentationModule.toggleCenterNodePresentation === 'function'
                && centerPresentationModule.toggleCenterNodePresentation({
                    source: 'node-context',
                    cy,
                    lastRequestMode,
                    currentCenterNodeId,
                    centerCardEnabled,
                    centerLockZoom: CENTER_LOCK_ZOOM,
                    centerOverviewZoom: CENTER_OVERVIEW_ZOOM,
                    setCenterCardEnabled: (nextValue) => {
                        centerCardEnabled = !!nextValue;
                        if (centerStateModule && typeof centerStateModule.setCenterCardEnabled === 'function') {
                            centerStateModule.setCenterCardEnabled(centerCardEnabled);
                        }
                    },
                    getCenterCardEnabled: () => centerCardEnabled,
                    getCurrentCenterNodeId: () => currentCenterNodeId,
                    applyCenterCardPresentation: (options = {}) => {
                        centerPresentationModule.applyCenterCardPresentation({
                            ...options,
                            cy,
                            currentCenterNodeId,
                            lastCenterNodeId,
                            centerCardEnabled,
                            htmlNodePluginReady,
                            log,
                            renderHtmlNodeCards,
                            clearNodeBypassSize: (nodeRef) => {
                                centerPresentationModule.clearNodeBypassSize({ node: nodeRef, log, debugWarn });
                            }
                        });
                    },
                    clearNodeBypassSize: (nodeRef) => {
                        centerPresentationModule.clearNodeBypassSize({ node: nodeRef, log, debugWarn });
                    },
                    animateCenterNodeViewport,
                    lockCenterNodeViewport,
                    log
                })) {
                return;
            }
        },
        onBackgroundContextTap: () => {
            if (centerPresentationModule
                && typeof centerPresentationModule.toggleCenterNodePresentation === 'function'
                && centerPresentationModule.toggleCenterNodePresentation({
                    source: 'background-context',
                    cy,
                    lastRequestMode,
                    currentCenterNodeId,
                    centerCardEnabled,
                    centerLockZoom: CENTER_LOCK_ZOOM,
                    centerOverviewZoom: CENTER_OVERVIEW_ZOOM,
                    setCenterCardEnabled: (nextValue) => {
                        centerCardEnabled = !!nextValue;
                        if (centerStateModule && typeof centerStateModule.setCenterCardEnabled === 'function') {
                            centerStateModule.setCenterCardEnabled(centerCardEnabled);
                        }
                    },
                    getCenterCardEnabled: () => centerCardEnabled,
                    getCurrentCenterNodeId: () => currentCenterNodeId,
                    applyCenterCardPresentation: (options = {}) => {
                        centerPresentationModule.applyCenterCardPresentation({
                            ...options,
                            cy,
                            currentCenterNodeId,
                            lastCenterNodeId,
                            centerCardEnabled,
                            htmlNodePluginReady,
                            log,
                            renderHtmlNodeCards,
                            clearNodeBypassSize: (nodeRef) => {
                                centerPresentationModule.clearNodeBypassSize({ node: nodeRef, log, debugWarn });
                            }
                        });
                    },
                    clearNodeBypassSize: (nodeRef) => {
                        centerPresentationModule.clearNodeBypassSize({ node: nodeRef, log, debugWarn });
                    },
                    animateCenterNodeViewport,
                    lockCenterNodeViewport,
                    log
                })) {
                return;
            }

            log('state', 'info', 'background context tap -> replay last query', {});
            replayLastQuery('background-reset');
        }
    });

    window.AnalysisUI.register({
        onFit: () => cy.fit(undefined, 70),
        onLayout: () => cy.layout(window.AnalysisStyle.getAltLayout()).run(),
        onReset: () => replayLastQuery('manual-reset'),
        onQueryGlobalRelation: () => requestGlobalRelation('toolbar-button')
    });

    // 监听来自后端的消息
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || !data.command) {
            return;
        }

        const response = queryServiceModule && typeof queryServiceModule.consumePendingResponse === 'function'
            ? queryServiceModule.consumePendingResponse(data)
            : {
                responseQueryId: data?.data?.__queryId || data?.__queryId || null,
                responseMeta: null
            };

        const { responseQueryId, responseMeta } = response;

        log('query', 'info', 'receive backend message', {
            command: data.command,
            hasData: !!data.data,
            hasCenterDetails: !!data?.data?.centerDetails,
            responseQueryId,
            matchedRequestCommand: responseMeta?.command || null,
            requestMode: responseMeta?.meta?.requestMode || null
        });

        if (data.command === 'renderGraphData') {
            if (responseMeta?.command === 'queryNodeDependencies') {
                const responseVersion = Number(responseMeta?.meta?.centerStateVersion);
                const currentVersion = Number(
                    centerStateModule && typeof centerStateModule.getCenterVersion === 'function'
                        ? centerStateModule.getCenterVersion()
                        : 0
                );
                const responseCenterNodeId = responseMeta?.meta?.centerNodeId ? String(responseMeta.meta.centerNodeId) : null;
                const currentCenterId = currentCenterNodeId ? String(currentCenterNodeId) : null;
                const hasVersion = Number.isFinite(responseVersion);

                if ((hasVersion && responseVersion !== currentVersion)
                    || (responseCenterNodeId && currentCenterId && responseCenterNodeId !== currentCenterId)) {
                    log('query', 'info', 'drop stale node query response', {
                        responseQueryId,
                        responseVersion,
                        currentVersion,
                        responseCenterNodeId,
                        currentCenterId
                    });
                    return;
                }
            }

            renderGraphData(data.data);
        }
    });

    // 页面启动后直接拉取后端数据，不再使用 mock 内容。
    if (pluginManagerModule && typeof pluginManagerModule.loadPlugin === 'function') {
        htmlNodePluginReady = !!pluginManagerModule.loadPlugin({
            cy,
            debug,
            debugWarn,
            onReadyChange: (ready) => {
                htmlNodePluginReady = !!ready;
            }
        });
    }

    debug('plugin load finalized', {
        htmlNodePluginReady,
        pluginMode: pluginManagerModule && typeof pluginManagerModule.getMode === 'function'
            ? pluginManagerModule.getMode(cy)
            : null
    });
    if (centerPresentationModule && typeof centerPresentationModule.applyCenterCardPresentation === 'function') {
        centerPresentationModule.applyCenterCardPresentation({
            cy,
            currentCenterNodeId,
            lastCenterNodeId,
            centerCardEnabled,
            htmlNodePluginReady,
            log,
            renderHtmlNodeCards,
            clearNodeBypassSize: (nodeRef) => {
                centerPresentationModule.clearNodeBypassSize({ node: nodeRef, log, debugWarn });
            }
        });
    }

    requestGlobalRelation('startup-auto');
})();


