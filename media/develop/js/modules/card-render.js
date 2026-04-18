(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CardRender) {
        return;
    }

    var htmlRendererInitialized = false;
    var htmlCardGeneration = 0;

    function getRenderState() {
        return {
            htmlRendererInitialized: htmlRendererInitialized,
            htmlCardGeneration: htmlCardGeneration
        };
    }

    function initHtmlNodeRenderer(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : function () { };
        var debugWarn = typeof safeOptions.debugWarn === 'function' ? safeOptions.debugWarn : function () { };

        if (htmlRendererInitialized) {
            return true;
        }

        var htmlNodeApi = cy && cy.htmlnode ? cy.htmlnode() : null;
        if (!htmlNodeApi || typeof htmlNodeApi.createHtmlNode !== 'function') {
            debugWarn('htmlnode api unavailable during init');
            return false;
        }

        try {
            htmlNodeApi.createHtmlNode(cytoscape, cy, [
                {
                    query: 'node.center-class-card[useHtmlCard = 1]',
                    staticZoomLevel: 1,
                    template: [
                        {
                            zoomRange: [0, Number.MAX_SAFE_INTEGER],
                            template: {
                                cssClass: 'analysis-html-node-wrapper',
                                html: '#{data.htmlCardMarkup}'
                            }
                        }
                    ]
                }
            ]);

            htmlRendererInitialized = true;
            log('renderer', 'info', 'htmlnode renderer initialized', {
                querySelector: 'node.center-class-card[useHtmlCard = 1]',
                wrapperCount: document.querySelectorAll('.analysis-html-node-wrapper').length
            });
            return true;
        } catch (error) {
            debugWarn('htmlnode renderer init failed', error);
            return false;
        }
    }

    function normalizeHtmlCardDom(options) {
        var safeOptions = options || {};
        var reason = safeOptions.reason;
        var activeNodeIds = safeOptions.activeNodeIds instanceof Set ? safeOptions.activeNodeIds : null;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : function () { };
        var documentRef = safeOptions.documentRef || document;

        var cards = Array.from(documentRef.querySelectorAll('.analysis-class-card[data-node-id]'));
        if (cards.length === 0) {
            return;
        }

        var groupByNodeId = new Map();
        cards.forEach(function (card) {
            var nodeId = String(card.getAttribute('data-node-id') || '').trim();
            if (!nodeId) {
                return;
            }

            if (!groupByNodeId.has(nodeId)) {
                groupByNodeId.set(nodeId, []);
            }
            groupByNodeId.get(nodeId).push(card);
        });

        var hiddenCount = 0;
        var inactiveHiddenCount = 0;
        groupByNodeId.forEach(function (group) {
            var nodeId = String((group[0] && group[0].getAttribute('data-node-id')) || '').trim();
            var shouldShowGroup = !activeNodeIds || activeNodeIds.has(nodeId);

            group.forEach(function (card) {
                card.classList.remove('analysis-class-card-hidden');
            });

            if (!shouldShowGroup) {
                group.forEach(function (card) {
                    card.classList.add('analysis-class-card-hidden');
                    hiddenCount += 1;
                    inactiveHiddenCount += 1;
                });
                return;
            }

            if (group.length <= 1) {
                return;
            }

            for (var index = 0; index < group.length - 1; index += 1) {
                group[index].classList.add('analysis-class-card-hidden');
                hiddenCount += 1;
            }
        });

        if (hiddenCount > 0) {
            log('renderer', 'info', 'duplicate center cards normalized', {
                reason: reason,
                hiddenCount: hiddenCount,
                inactiveHiddenCount: inactiveHiddenCount,
                totalCards: cards.length,
                groupCount: groupByNodeId.size
            });
        }
    }

    function buildHtmlDataByNodeId(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var centerCardEnabled = !!safeOptions.centerCardEnabled;
        var centerDetailsCache = safeOptions.centerDetailsCache;
        var classCardModelCache = safeOptions.classCardModelCache;
        var createLoadingClassCard = typeof safeOptions.createLoadingClassCard === 'function'
            ? safeOptions.createLoadingClassCard
            : function (nodeId) {
                return {
                    nodeId: nodeId,
                    title: nodeId,
                    fields: ['loading fields...'],
                    methods: ['loading methods...']
                };
            };
        var buildHtmlClassCard = typeof safeOptions.buildHtmlClassCard === 'function'
            ? safeOptions.buildHtmlClassCard
            : function () {
                return '';
            };

        var htmlDataByNodeId = new Map();
        if (!cy) {
            return htmlDataByNodeId;
        }

        var normalizedCenterNodeId = currentCenterNodeId ? String(currentCenterNodeId) : null;
        var shouldBuildCenterCard = !!normalizedCenterNodeId && centerCardEnabled;
        cy.nodes().forEach(function (node) {
            var nodeId = String(node.id());
            if (!shouldBuildCenterCard || nodeId !== normalizedCenterNodeId) {
                return;
            }

            var classCardFromCenterDetails = centerDetailsCache instanceof Map ? centerDetailsCache.get(nodeId) : null;
            var classCardFromModelCache = classCardModelCache instanceof Map ? classCardModelCache.get(nodeId) : null;
            var classCard = classCardFromCenterDetails
                || classCardFromModelCache
                || createLoadingClassCard(nodeId);
            var markup = String(buildHtmlClassCard(nodeId, classCard) || '');

            htmlDataByNodeId.set(nodeId, markup);
        });

        return htmlDataByNodeId;
    }

    function applyHtmlMarkupToNodes(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var htmlDataByNodeId = safeOptions.htmlDataByNodeId instanceof Map
            ? safeOptions.htmlDataByNodeId
            : new Map();

        if (!cy) {
            return;
        }

        cy.nodes().forEach(function (node) {
            var nodeId = String(node.id());
            node.data('htmlCardMarkup', htmlDataByNodeId.get(nodeId) || '');
        });
    }

    function refreshHtmlCards(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var centerCardEnabled = !!safeOptions.centerCardEnabled;
        var buildHtmlDataByNodeIdHandler = typeof safeOptions.buildHtmlDataByNodeId === 'function'
            ? safeOptions.buildHtmlDataByNodeId
            : function () {
                return buildHtmlDataByNodeId({
                    cy: cy,
                    currentCenterNodeId: currentCenterNodeId,
                    centerCardEnabled: centerCardEnabled,
                    centerDetailsCache: safeOptions.centerDetailsCache,
                    classCardModelCache: safeOptions.classCardModelCache,
                    createLoadingClassCard: safeOptions.createLoadingClassCard,
                    buildHtmlClassCard: safeOptions.buildHtmlClassCard
                });
            };
        var applyHtmlMarkupToNodesHandler = typeof safeOptions.applyHtmlMarkupToNodes === 'function'
            ? safeOptions.applyHtmlMarkupToNodes
            : function (htmlDataByNodeId) {
                applyHtmlMarkupToNodes({
                    cy: cy,
                    htmlDataByNodeId: htmlDataByNodeId
                });
            };
        var clearNodeBypassSize = safeOptions.clearNodeBypassSize;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : function () { };
        var debug = typeof safeOptions.debug === 'function' ? safeOptions.debug : function () { };
        var debugWarn = typeof safeOptions.debugWarn === 'function' ? safeOptions.debugWarn : function () { };

        if (!cy) {
            return false;
        }

        var htmlDataByNodeId = buildHtmlDataByNodeIdHandler();
        var activeCardNodeIds = new Set(htmlDataByNodeId.keys());
        var hasActiveCenterCard = !!currentCenterNodeId && centerCardEnabled;
        var normalizedCenterNodeId = currentCenterNodeId ? String(currentCenterNodeId) : null;
        var centerMarkupBeforeApply = '';
        var centerUseHtmlCardBeforeApply = false;
        if (normalizedCenterNodeId) {
            var centerNodeBeforeApply = cy.getElementById(normalizedCenterNodeId);
            if (centerNodeBeforeApply && centerNodeBeforeApply.length > 0 && centerNodeBeforeApply.isNode()) {
                centerMarkupBeforeApply = String(centerNodeBeforeApply.data('htmlCardMarkup') || '');
                centerUseHtmlCardBeforeApply = Number(centerNodeBeforeApply.data('useHtmlCard')) === 1;
            }
        }

        var generatedCenterMarkup = normalizedCenterNodeId
            ? String(htmlDataByNodeId.get(normalizedCenterNodeId) || '')
            : '';
        var centerMarkupPreserved = false;

        if (normalizedCenterNodeId
            && centerCardEnabled
            && centerUseHtmlCardBeforeApply
            && generatedCenterMarkup.length === 0
            && centerMarkupBeforeApply.length > 0) {
            htmlDataByNodeId.set(normalizedCenterNodeId, centerMarkupBeforeApply);
            generatedCenterMarkup = centerMarkupBeforeApply;
            centerMarkupPreserved = true;
        }

        applyHtmlMarkupToNodesHandler(htmlDataByNodeId);

        var centerMarkupLengthAfterApply = 0;
        var centerUseHtmlCardAfterApply = false;
        if (normalizedCenterNodeId) {
            var centerNodeAfterApply = cy.getElementById(normalizedCenterNodeId);
            if (centerNodeAfterApply && centerNodeAfterApply.length > 0 && centerNodeAfterApply.isNode()) {
                centerMarkupLengthAfterApply = String(centerNodeAfterApply.data('htmlCardMarkup') || '').length;
                centerUseHtmlCardAfterApply = Number(centerNodeAfterApply.data('useHtmlCard')) === 1;
            }
        }

        htmlCardGeneration += 1;

        log('renderer', 'verbose', 'refresh html cards', {
            pluginMode: 'htmlnode',
            htmlCardGeneration: htmlCardGeneration,
            currentCenterNodeId: currentCenterNodeId,
            hasActiveCenterCard: hasActiveCenterCard,
            centerCardEnabled: centerCardEnabled,
            markupNodeCount: htmlDataByNodeId.size,
            centerMarkupLengthBeforeApply: centerMarkupBeforeApply.length,
            centerUseHtmlCardBeforeApply: centerUseHtmlCardBeforeApply,
            generatedCenterMarkupLength: generatedCenterMarkup.length,
            centerMarkupLengthAfterApply: centerMarkupLengthAfterApply,
            centerUseHtmlCardAfterApply: centerUseHtmlCardAfterApply,
            centerMarkupPreserved: centerMarkupPreserved
        });

        if (!hasActiveCenterCard) {
            if (currentCenterNodeId && typeof clearNodeBypassSize === 'function') {
                var centerNodeNoHtml = cy.getElementById(currentCenterNodeId);
                if (centerNodeNoHtml && centerNodeNoHtml.length > 0 && centerNodeNoHtml.isNode()) {
                    clearNodeBypassSize(centerNodeNoHtml);
                }
            }

            setTimeout(function () {
                normalizeHtmlCardDom({
                    reason: 'htmlnode-refresh:no-center',
                    activeNodeIds: activeCardNodeIds,
                    log: log
                });
            }, 0);
            debug('html cards refreshed (htmlnode): no active center card, cleaned up renderer');
            return true;
        }

        if (!initHtmlNodeRenderer({ cy: cy, log: log, debugWarn: debugWarn })) {
            return false;
        }

        cy.emit('zoom');
        setTimeout(function () {
            normalizeHtmlCardDom({
                reason: 'htmlnode-refresh',
                activeNodeIds: activeCardNodeIds,
                log: log
            });
        }, 0);

        debug('html cards refreshed (htmlnode)', {
            generation: htmlCardGeneration,
            wrappers: document.querySelectorAll('.analysis-html-node-wrapper').length
        });
        return true;
    }

    function renderHtmlNodeCards(options) {
        var safeOptions = options || {};
        var isPluginReady = !!safeOptions.isPluginReady;
        var debugWarn = typeof safeOptions.debugWarn === 'function' ? safeOptions.debugWarn : function () { };
        var debug = typeof safeOptions.debug === 'function' ? safeOptions.debug : function () { };
        var bindClassCardEvents = safeOptions.bindClassCardEvents;

        if (!isPluginReady) {
            debugWarn('skip html card render, plugin unavailable', {
                htmlNodePluginReady: isPluginReady,
                pluginMode: 'htmlnode'
            });
            return false;
        }

        debug('render html node cards', {
            pluginMode: 'htmlnode',
            currentCenterNodeId: safeOptions.currentCenterNodeId || null,
            nodeCount: Number(safeOptions.nodeCount || 0),
            cachedCenterDetails: Number(safeOptions.cachedCenterDetails || 0)
        });

        var refreshed = !!refreshHtmlCards({
            cy: safeOptions.cy,
            currentCenterNodeId: safeOptions.currentCenterNodeId,
            centerCardEnabled: !!safeOptions.centerCardEnabled,
            centerDetailsCache: safeOptions.centerDetailsCache,
            classCardModelCache: safeOptions.classCardModelCache,
            createLoadingClassCard: safeOptions.createLoadingClassCard,
            buildHtmlClassCard: safeOptions.buildHtmlClassCard,
            buildHtmlDataByNodeId: safeOptions.buildHtmlDataByNodeId,
            applyHtmlMarkupToNodes: safeOptions.applyHtmlMarkupToNodes,
            clearNodeBypassSize: safeOptions.clearNodeBypassSize,
            log: safeOptions.log,
            debug: debug,
            debugWarn: debugWarn
        });
        if (refreshed && typeof bindClassCardEvents === 'function') {
            bindClassCardEvents();
        }

        return refreshed;
    }

    modules.CardRender = {
        getRenderState: getRenderState,
        buildHtmlDataByNodeId: buildHtmlDataByNodeId,
        applyHtmlMarkupToNodes: applyHtmlMarkupToNodes,
        normalizeHtmlCardDom: normalizeHtmlCardDom,
        initHtmlNodeRenderer: initHtmlNodeRenderer,
        refreshHtmlCards: refreshHtmlCards,
        renderHtmlNodeCards: renderHtmlNodeCards
    };
})();
