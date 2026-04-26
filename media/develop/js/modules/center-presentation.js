(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CenterPresentation) {
        return;
    }

    function noop() { }

    function clearNodeBypassSize(options) {
        var safeOptions = options || {};
        var node = safeOptions.node;
        var debugWarn = typeof safeOptions.debugWarn === 'function' ? safeOptions.debugWarn : noop;

        if (!node) {
            return false;
        }

        var styleKeys = ['width', 'height'];
        var removedStyleKeys = [];

        styleKeys.forEach(function (styleKey) {
            try {
                node.removeStyle(styleKey);
                removedStyleKeys.push(styleKey);
            } catch (error) {
                debugWarn('removeStyle failed', {
                    styleKey: styleKey,
                    nodeId: node.id ? node.id() : null,
                    error: error
                });
            }
        });

        return true;
    }

    function applyCenterCardPresentation(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var lastCenterNodeId = safeOptions.lastCenterNodeId;
        var centerCardEnabled = !!safeOptions.centerCardEnabled;
        var htmlNodePluginReady = !!safeOptions.htmlNodePluginReady;
        var skipHtmlRender = safeOptions.skipHtmlRender === true;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : noop;
        var renderHtmlNodeCards = typeof safeOptions.renderHtmlNodeCards === 'function' ? safeOptions.renderHtmlNodeCards : noop;
        var clearNodeBypassSizeHandler = typeof safeOptions.clearNodeBypassSize === 'function' ? safeOptions.clearNodeBypassSize : noop;

        if (!cy) {
            return {
                centerCount: 0,
                htmlCardCount: 0
            };
        }

        var centerCount = 0;
        var htmlCardCount = 0;
        var shouldUseCenterCard = !!currentCenterNodeId && centerCardEnabled;

        cy.nodes().forEach(function (node) {
            var isCenterCard = shouldUseCenterCard && node.id() === currentCenterNodeId;
            var useHtmlCard = isCenterCard && htmlNodePluginReady;

            if (isCenterCard) {
                centerCount += 1;
            }
            if (useHtmlCard) {
                htmlCardCount += 1;
            }

            node.data('isCenterClassCard', isCenterCard ? 1 : 0);
            node.data('useHtmlCard', useHtmlCard ? 1 : 0);
            node.data('label', isCenterCard && !useHtmlCard ? node.data('classCardLabel') : node.data('baseLabel'));

            if (isCenterCard) {
                node.addClass('center-class-card');
            } else {
                node.removeClass('center-class-card');
                clearNodeBypassSizeHandler(node);
            }
        });

        if (lastCenterNodeId && lastCenterNodeId !== currentCenterNodeId) {
            var oldCenterNode = cy.getElementById(lastCenterNodeId);
            if (oldCenterNode && oldCenterNode.length > 0) {
                clearNodeBypassSizeHandler(oldCenterNode);
            }
        }

        log('state', 'info', 'apply center presentation', {
            currentCenterNodeId: currentCenterNodeId,
            centerCardEnabled: centerCardEnabled,
            centerCount: centerCount,
            htmlCardCount: htmlCardCount,
            htmlNodePluginReady: htmlNodePluginReady,
            skipHtmlRender: skipHtmlRender
        });

        if (!skipHtmlRender) {
            renderHtmlNodeCards();
        }

        return {
            centerCount: centerCount,
            htmlCardCount: htmlCardCount
        };
    }

    function clearCenterCardState(options) {
        var safeOptions = options || {};
        var reason = safeOptions.reason || 'unknown';
        var shouldRefreshCards = safeOptions.refreshCards !== false;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : noop;
        var setCenterNode = typeof safeOptions.setCenterNode === 'function' ? safeOptions.setCenterNode : noop;
        var setPendingCenterDetailsNodeId = typeof safeOptions.setPendingCenterDetailsNodeId === 'function'
            ? safeOptions.setPendingCenterDetailsNodeId
            : noop;
        var renderHtmlNodeCards = typeof safeOptions.renderHtmlNodeCards === 'function' ? safeOptions.renderHtmlNodeCards : noop;
        var clearNodeBypassSizeHandler = typeof safeOptions.clearNodeBypassSize === 'function' ? safeOptions.clearNodeBypassSize : noop;
        var cy = safeOptions.cy;

        if (!cy) {
            return;
        }

        log('state', 'info', 'clear center card state', {
            reason: reason,
            shouldRefreshCards: shouldRefreshCards
        });

        setCenterNode(null, 'clear:' + reason);
        setPendingCenterDetailsNodeId(null);

        cy.nodes().forEach(function (node) {
            node.data('isCenterClassCard', 0);
            node.data('useHtmlCard', 0);
            node.data('label', node.data('baseLabel'));
            node.data('htmlCardMarkup', '');
            node.removeClass('center-class-card');
            clearNodeBypassSizeHandler(node);
        });

        if (shouldRefreshCards) {
            renderHtmlNodeCards();
        }
    }

    function toggleCenterNodePresentation(options) {
        var safeOptions = options || {};
        var source = safeOptions.source || 'unknown';
        var cy = safeOptions.cy;
        var lastRequestMode = safeOptions.lastRequestMode;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var centerCardEnabled = !!safeOptions.centerCardEnabled;
        var centerLockZoom = Number(safeOptions.centerLockZoom);
        var centerOverviewZoom = Number(safeOptions.centerOverviewZoom);
        var setCenterCardEnabled = typeof safeOptions.setCenterCardEnabled === 'function' ? safeOptions.setCenterCardEnabled : noop;
        var applyCenterCardPresentation = typeof safeOptions.applyCenterCardPresentation === 'function'
            ? safeOptions.applyCenterCardPresentation
            : noop;
        var clearNodeBypassSizeHandler = typeof safeOptions.clearNodeBypassSize === 'function' ? safeOptions.clearNodeBypassSize : noop;
        var animateCenterNodeViewport = typeof safeOptions.animateCenterNodeViewport === 'function'
            ? safeOptions.animateCenterNodeViewport
            : function () { return false; };
        var lockCenterNodeViewport = typeof safeOptions.lockCenterNodeViewport === 'function'
            ? safeOptions.lockCenterNodeViewport
            : noop;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : noop;

        if (!cy || (lastRequestMode !== 'node' && lastRequestMode !== 'relation-node')) {
            return false;
        }

        if (!currentCenterNodeId) {
            return false;
        }

        var centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0 || !centerNode.isNode()) {
            return false;
        }

        var centerNodeId = String(centerNode.id());
        var nextCenterCardEnabled = !centerCardEnabled;
        setCenterCardEnabled(nextCenterCardEnabled);
        applyCenterCardPresentation();

        if (!nextCenterCardEnabled) {
            clearNodeBypassSizeHandler(centerNode);
            setTimeout(function () {
                if (safeOptions.getCenterCardEnabled && safeOptions.getCurrentCenterNodeId) {
                    if (safeOptions.getCenterCardEnabled() || safeOptions.getCurrentCenterNodeId() !== centerNodeId) {
                        return;
                    }
                }

                var centerNodeAfterToggle = cy.getElementById(centerNodeId);
                if (!centerNodeAfterToggle || centerNodeAfterToggle.length === 0 || !centerNodeAfterToggle.isNode()) {
                    return;
                }

                clearNodeBypassSizeHandler(centerNodeAfterToggle);
            }, 0);
        }

        var targetZoom = nextCenterCardEnabled ? centerLockZoom : centerOverviewZoom;
        if (!animateCenterNodeViewport('toggle-center-presentation:' + source, {
            duration: 300,
            targetZoom: targetZoom
        })) {
            lockCenterNodeViewport('toggle-center-presentation:' + source, { targetZoom: targetZoom });
        }

        log('state', 'info', 'toggle center presentation', {
            source: source,
            currentCenterNodeId: currentCenterNodeId,
            centerCardEnabled: nextCenterCardEnabled,
            targetZoom: targetZoom
        });

        return true;
    }

    modules.CenterPresentation = {
        clearNodeBypassSize: clearNodeBypassSize,
        applyCenterCardPresentation: applyCenterCardPresentation,
        clearCenterCardState: clearCenterCardState,
        toggleCenterNodePresentation: toggleCenterNodePresentation
    };
})();
