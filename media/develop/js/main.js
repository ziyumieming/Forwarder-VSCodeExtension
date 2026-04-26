(function () {
    const vscode = acquireVsCodeApi();
    let currentCenterNodeId = null;
    let pendingCenterDetailsNodeId = null;
    const centerDetailsCache = new Map();
    const classCardModelCache = new Map();
    let htmlNodePluginReady = false;
    let lastRequestMode = 'relation-global';
    let lastCenterNodeId = null;
    let centerCardEnabled = false;
    const collapsedCardSections = new Set();
    let pendingGlobalToNodeTransition = null;
    const CENTER_LOCK_ZOOM = 1;
    const CENTER_OVERVIEW_ZOOM = 0.5;
    const QUERY_DEBOUNCE_WINDOW_MS = 80;
    const QUERY_DUPLICATE_WINDOW_MS = 220;
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
    const tabManagerModule = window.AnalysisModules?.TabManager;
    const selectionStoreModule = window.AnalysisModules?.SelectionStore;
    const queryServiceModule = window.AnalysisModules?.QueryService;
    const graphIncrementalModule = window.AnalysisModules?.GraphIncremental;
    const graphPipelineModule = window.AnalysisModules?.GraphPipeline;
    const layoutManagerModule = window.AnalysisModules?.LayoutManager;
    const graphFocusModule = window.AnalysisModules?.GraphFocus;
    const centerPresentationModule = window.AnalysisModules?.CenterPresentation;
    const relationGraphTabModule = window.AnalysisModules?.RelationGraphTab;
    const callGraphTabModule = window.AnalysisModules?.CallGraphTab;
    let relationGraphTab = null;
    let callGraphTab = null;

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
            animationDurationScale: getAnimationDurationScale(),
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

    const panCenterNodeToViewport = (reason, options = {}) => {
        if (!viewportAnimationModule || typeof viewportAnimationModule.panCenterNodeToViewport !== 'function') {
            return false;
        }

        return viewportAnimationModule.panCenterNodeToViewport({
            ...options,
            animationDurationScale: getAnimationDurationScale(),
            reason,
            cy,
            log,
            currentCenterNodeId
        });
    };

    const animateCenterNodeZoomOnly = (reason, options = {}) => {
        if (!viewportAnimationModule || typeof viewportAnimationModule.animateCenterNodeZoomOnly !== 'function') {
            return false;
        }

        return viewportAnimationModule.animateCenterNodeZoomOnly({
            ...options,
            animationDurationScale: getAnimationDurationScale(),
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

    const getAnimationDurationScale = () => {
        const fromGlobal = Number(window.__analysisAnimationDurationScale);
        if (Number.isFinite(fromGlobal) && fromGlobal > 0) {
            return fromGlobal;
        }

        return 1;
    };

    const scaleAnimationDuration = (duration) => {
        const scale = getAnimationDurationScale();
        const ms = Number(duration);
        if (!Number.isFinite(ms) || ms < 0) {
            return 0;
        }

        return Math.max(0, Math.round(ms * scale));
    };

    const getQueryDebounceWindowMs = () => {
        const fromGlobal = Number(window.__analysisQueryDebounceWindowMs);
        if (Number.isFinite(fromGlobal) && fromGlobal >= 0) {
            return fromGlobal;
        }

        return QUERY_DEBOUNCE_WINDOW_MS;
    };

    const getQueryDuplicateWindowMs = () => {
        const fromGlobal = Number(window.__analysisQueryDuplicateWindowMs);
        if (Number.isFinite(fromGlobal) && fromGlobal >= 0) {
            return fromGlobal;
        }

        return QUERY_DUPLICATE_WINDOW_MS;
    };

    const computeGlobalToNodeZoomTarget = () => {
        const nodeCount = Math.max(1, cy.nodes().length);
        const rawZoom = 1.05 - 0.12 * Math.log2(nodeCount + 1);
        return Math.min(0.95, Math.max(0.42, rawZoom));
    };

    const clearGlobalToNodeTransitionMask = (reason) => {
        const hiddenElements = cy.elements('.transition-hidden');
        if (!hiddenElements || hiddenElements.length === 0) {
            return;
        }

        hiddenElements.removeClass('transition-hidden');
        log('state', 'verbose', 'clear global-to-node transition mask', {
            reason,
            hiddenCount: hiddenElements.length
        });
    };

    const applyGlobalToNodeTransitionMask = (centerNodeId) => {
        const normalizedCenterId = centerNodeId ? String(centerNodeId) : null;
        if (!normalizedCenterId) {
            return;
        }

        const centerNode = cy.getElementById(normalizedCenterId);
        if (!centerNode || centerNode.length === 0 || !centerNode.isNode()) {
            return;
        }

        cy.elements().addClass('transition-hidden');
        centerNode.removeClass('transition-hidden');

        log('state', 'verbose', 'apply global-to-node transition mask', {
            centerNodeId: normalizedCenterId,
            hiddenCount: cy.elements('.transition-hidden').length
        });
    };

    const finalizeGlobalToNodeViewport = (reason, options = {}) => {
        const targetZoom = computeGlobalToNodeZoomTarget();
        clearGlobalToNodeTransitionMask(reason + ':finalize');
        pendingGlobalToNodeTransition = null;

        if (animateCenterNodeZoomOnly(reason, {
            ...options,
            targetZoom,
            duration: options.duration !== null ? options.duration : 320
        })) {
            return true;
        }

        if (animateCenterNodeViewport(reason, {
            ...options,
            targetZoom,
            duration: options.duration !== null ? options.duration : 320
        })) {
            return true;
        }

        return lockCenterNodeViewport(reason, { targetZoom });
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
                if (relationGraphTab && typeof relationGraphTab.onHeaderAction === 'function') {
                    relationGraphTab.onHeaderAction(nodeId);
                }
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

    function clearCanvas(reason = 'clear-canvas') {
        layoutAnimationToken += 1;
        cy.elements().remove();
        latestGraphSnapshot = graphIncrementalModule && typeof graphIncrementalModule.createEmptyGraphSnapshot === 'function'
            ? graphIncrementalModule.createEmptyGraphSnapshot()
            : {
                nodes: new Map(),
                edges: new Map()
            };
        clearGlobalToNodeTransitionMask(reason);
        log('renderer', 'info', 'canvas cleared', { reason });
    }

    function renderGraphData(graphData, options = {}) {
        const animationToken = ++layoutAnimationToken;
        const renderRequestMode = options.requestMode || lastRequestMode;
        const presentationMode = options.presentationMode || 'class-card';
        const renderCenterNodeId = options.currentCenterNodeId !== undefined
            ? (options.currentCenterNodeId ? String(options.currentCenterNodeId) : null)
            : currentCenterNodeId;
        const renderCenterCardEnabled = presentationMode === 'class-card' && centerCardEnabled;
        const normalized = graphPipelineModule && typeof graphPipelineModule.normalizeGraphData === 'function'
            ? graphPipelineModule.normalizeGraphData({
                graphData,
                state: {
                    currentCenterNodeId: renderCenterNodeId,
                    centerCardEnabled: renderCenterCardEnabled,
                    htmlNodePluginReady: presentationMode === 'class-card' && htmlNodePluginReady,
                    pendingCenterDetailsNodeId: presentationMode === 'class-card' ? pendingCenterDetailsNodeId : null
                },
                presentationMode,
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
        const isGlobalToNodeTransition = !!pendingGlobalToNodeTransition
            && renderRequestMode === 'relation-node'
            && !!renderCenterNodeId
            && pendingGlobalToNodeTransition.centerNodeId === String(renderCenterNodeId);

        log('state', 'info', 'render graph data', {
            elementCount: elements.length,
            currentCenterNodeId: renderCenterNodeId,
            presentationMode,
            requestMode: renderRequestMode,
            incomingNodes: Array.isArray(graphData?.nodes) ? graphData.nodes.length : -1,
            incomingEdges: Array.isArray(graphData?.edges) ? graphData.edges.length : -1,
            hasCenterDetails: !!graphData?.centerDetails
        });

        let incrementalResult = null;
        if (renderRequestMode === 'relation-node') {
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

        if (renderRequestMode === 'relation-global') {
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
        if (presentationMode === 'class-card'
            && centerPresentationModule
            && typeof centerPresentationModule.applyCenterCardPresentation === 'function') {
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

        if (!isGlobalToNodeTransition) {
            clearGlobalToNodeTransitionMask('renderGraphData:normal');
        }

        const layoutOptions = {
            ...window.AnalysisStyle.getDefaultLayout()
        };

        const shouldRunLayout =
            options.skipLayout !== true
            && (renderRequestMode !== 'relation-node'
            || !incrementalResult
            || incrementalResult.structuralChange);

        if (renderRequestMode === 'relation-node') {
            const nodeModeLayoutOptions = layoutManagerModule && typeof layoutManagerModule.getNodeModeLayoutOptions === 'function'
                ? layoutManagerModule.getNodeModeLayoutOptions({
                    fit: false,
                    animate: layoutOptions.animate,
                    animationDurationScale: getAnimationDurationScale(),
                    currentCenterNodeId: renderCenterNodeId,
                    getDefaultLayout: () => window.AnalysisStyle.getDefaultLayout()
                })
                : {
                    ...window.AnalysisStyle.getDefaultLayout(),
                    fit: false,
                    animate: layoutOptions.animate
                };
            Object.assign(layoutOptions, nodeModeLayoutOptions);
        }

        if (renderRequestMode === 'call-graph') {
            Object.assign(layoutOptions, window.AnalysisStyle.getAltLayout(), {
                directed: true,
                fit: true,
                padding: 90
            });
        }

        if (layoutOptions.animate) {
            const baseDuration = Number(layoutOptions.animationDuration);
            const normalizedDuration = Number.isFinite(baseDuration) && baseDuration > 0 ? baseDuration : 500;
            layoutOptions.animationDuration = scaleAnimationDuration(normalizedDuration);
        }

        if (!shouldRunLayout) {
            if (isGlobalToNodeTransition) {
                finalizeGlobalToNodeViewport('skip-layout:no-structural-change:global-to-node', {
                    animationToken,
                    duration: 260
                });
                return;
            }

            if (!animateCenterNodeViewport('skip-layout:no-structural-change', {
                duration: 260,
                animationToken
            })) {
                lockCenterNodeViewport('skip-layout:no-structural-change');
            }
            return;
        }

        if (renderRequestMode === 'relation-global') {
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

        if (renderRequestMode === 'relation-node' && incrementalResult?.mode === 'incremental') {
            const usedStagger = layoutManagerModule
                && typeof layoutManagerModule.runNodeStaggerEnterLayout === 'function'
                && layoutManagerModule.runNodeStaggerEnterLayout({
                    cy,
                    animationToken,
                    layoutAnimationToken,
                    incrementalResult,
                    currentCenterNodeId: renderCenterNodeId,
                    lastRequestMode: renderRequestMode,
                    animationDurationScale: getAnimationDurationScale(),
                    getDefaultLayout: () => window.AnalysisStyle.getDefaultLayout(),
                    log,
                    debugWarn,
                    includeAllNonCenterNodes: isGlobalToNodeTransition,
                    animateCenterNodeViewport: (reason, options = {}) => animateCenterNodeViewport(reason, options),
                    onBeforeEnterAnimation: isGlobalToNodeTransition
                        ? ({ animationToken: startedAnimationToken }) => {
                            if (startedAnimationToken !== layoutAnimationToken) {
                                return;
                            }

                            clearGlobalToNodeTransitionMask('node-stagger-enter-start:global-to-node');
                        }
                        : null,
                    onAfterLayout: isGlobalToNodeTransition
                        ? ({ animationToken: completedAnimationToken }) => {
                            finalizeGlobalToNodeViewport('node-stagger-enter-complete:global-to-node', {
                                animationToken: completedAnimationToken,
                                duration: 360
                            });
                            return true;
                        }
                        : null
                });
            if (usedStagger) {
                return;
            }
        }

        let lockedCenterNodeForTransitionLayout = null;
        if (isGlobalToNodeTransition && renderCenterNodeId) {
            const centerNodeForTransitionLayout = cy.getElementById(String(renderCenterNodeId));
            if (centerNodeForTransitionLayout
                && centerNodeForTransitionLayout.length > 0
                && centerNodeForTransitionLayout.isNode()) {
                centerNodeForTransitionLayout.lock();
                lockedCenterNodeForTransitionLayout = centerNodeForTransitionLayout;
            }
        }

        cy.one('layoutstop', () => {
            if (lockedCenterNodeForTransitionLayout) {
                lockedCenterNodeForTransitionLayout.unlock();
            }

            if (animationToken !== layoutAnimationToken) {
                return;
            }

            if (isGlobalToNodeTransition) {
                finalizeGlobalToNodeViewport('layoutstop:global-to-node', {
                    animationToken,
                    duration: 320
                });
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
        if (relationGraphTab && typeof relationGraphTab.requestGlobalRelation === 'function') {
            relationGraphTab.requestGlobalRelation(source, options);
        }
    }

    function requestNodeDependencies(nodeId, source = 'node-tap', options = {}) {
        if (relationGraphTab && typeof relationGraphTab.requestNodeDependencies === 'function') {
            relationGraphTab.requestNodeDependencies(nodeId, source, options);
        }
    }

    if (relationGraphTabModule && typeof relationGraphTabModule.create === 'function') {
        relationGraphTab = relationGraphTabModule.create({
            cy,
            queryService: queryServiceModule,
            graphFocus: graphFocusModule,
            centerPresentation: centerPresentationModule,
            centerState: centerStateModule,
            graphEvents: window.AnalysisGraphEvents,
            ui: window.AnalysisUI,
            log,
            postMessage: (message) => vscode.postMessage(message),
            getQueryOptions: () => window.AnalysisUI.getQueryOptions(),
            setLastRequestMode: (mode) => { lastRequestMode = mode; },
            getLastRequestMode: () => lastRequestMode,
            getCurrentCenterNodeId: () => currentCenterNodeId,
            getLastCenterNodeId: () => lastCenterNodeId,
            setCenterNode,
            getCenterCardEnabled: () => centerCardEnabled,
            setCenterCardEnabled: (enabled) => { centerCardEnabled = !!enabled; },
            getPendingCenterDetailsNodeId: () => pendingCenterDetailsNodeId,
            setPendingCenterDetailsNodeId: (nodeId) => {
                pendingCenterDetailsNodeId = nodeId ? String(nodeId) : null;
                if (centerStateModule && typeof centerStateModule.setPendingCenterDetailsNodeId === 'function') {
                    centerStateModule.setPendingCenterDetailsNodeId(pendingCenterDetailsNodeId);
                }
            },
            getHtmlNodePluginReady: () => htmlNodePluginReady,
            getCenterDetailsCache: () => centerDetailsCache,
            renderHtmlNodeCards,
            clearNodeBypassSize: (nodeRef) => {
                if (centerPresentationModule && typeof centerPresentationModule.clearNodeBypassSize === 'function') {
                    centerPresentationModule.clearNodeBypassSize({ node: nodeRef, log, debugWarn });
                }
            },
            clearGlobalToNodeTransitionMask,
            applyGlobalToNodeTransitionMask,
            panCenterNodeToViewport,
            setPendingGlobalToNodeTransition: (transition) => {
                pendingGlobalToNodeTransition = transition;
            },
            getQueryDebounceWindowMs,
            getQueryDuplicateWindowMs,
            animateCenterNodeViewport,
            lockCenterNodeViewport,
            centerLockZoom: CENTER_LOCK_ZOOM,
            centerOverviewZoom: CENTER_OVERVIEW_ZOOM,
            isActiveTab: () => !tabManagerModule
                || typeof tabManagerModule.getActiveTabId !== 'function'
                || tabManagerModule.getActiveTabId() === 'relationGraph'
        });

        relationGraphTab.bindGraphEvents();
        relationGraphTab.bindToolbar();
    }

    if (callGraphTabModule && typeof callGraphTabModule.create === 'function') {
        callGraphTab = callGraphTabModule.create({
            cy,
            selectionStore: selectionStoreModule,
            log,
            clearCanvas,
            renderGraphData: (graphData, options = {}) => renderGraphData(graphData, {
                ...options,
                presentationMode: 'simple-node',
                requestMode: 'call-graph'
            }),
            isActiveTab: () => tabManagerModule
                && typeof tabManagerModule.getActiveTabId === 'function'
                && tabManagerModule.getActiveTabId() === 'callGraph'
        });

        if (typeof callGraphTab.bindToolbar === 'function') {
            callGraphTab.bindToolbar();
        }
        if (typeof callGraphTab.bindGraphEvents === 'function') {
            callGraphTab.bindGraphEvents();
        }
    }

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
                responseMeta: null,
                responseRequestMode: null,
                latestQueryIdForMode: null,
                droppedByLatestWin: false,
                dropReason: null
            };

        const {
            responseQueryId,
            responseMeta,
            responseRequestMode,
            latestQueryIdForMode,
            droppedByLatestWin,
            dropReason
        } = response;

        log('query', 'info', 'receive backend message', {
            command: data.command,
            hasData: !!data.data,
            hasCenterDetails: !!data?.data?.centerDetails,
            responseQueryId,
            matchedRequestCommand: responseMeta?.command || null,
            requestMode: responseRequestMode || responseMeta?.meta?.requestMode || null,
            droppedByLatestWin,
            dropReason,
            latestQueryIdForMode
        });

        if (data.command === 'renderGraphData') {
            if (droppedByLatestWin) {
                log('query', 'info', 'drop stale response by latest-win', {
                    responseQueryId,
                    responseRequestMode,
                    latestQueryIdForMode,
                    dropReason,
                    matchedRequestCommand: responseMeta?.command || null
                });
                return;
            }

            if (responseRequestMode === 'call-graph'
                && callGraphTab
                && typeof callGraphTab.renderGraphData === 'function') {
                callGraphTab.renderGraphData(data.data);
                return;
            }

            if (relationGraphTab
                && typeof relationGraphTab.handleBackendMessage === 'function'
                && !relationGraphTab.handleBackendMessage(data, responseMeta)) {
                return;
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

    if (tabManagerModule && typeof tabManagerModule.register === 'function') {
        tabManagerModule.register('relationGraph', relationGraphTab || {});
        tabManagerModule.register('callGraph', callGraphTab || {});
        tabManagerModule.activate('relationGraph', 'startup');
    }

    requestGlobalRelation('startup-auto');
})();


