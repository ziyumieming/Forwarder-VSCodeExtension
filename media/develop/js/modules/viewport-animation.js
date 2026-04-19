(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.ViewportAnimation) {
        return;
    }

    function resolveAnimationDurationScale(options) {
        var safeOptions = options || {};
        var fromOption = Number(safeOptions.animationDurationScale);
        if (Number.isFinite(fromOption) && fromOption > 0) {
            return fromOption;
        }

        var fromGlobal = Number(globalScope.__analysisAnimationDurationScale);
        if (Number.isFinite(fromGlobal) && fromGlobal > 0) {
            return fromGlobal;
        }

        return 1;
    }

    function scaleDuration(duration, options) {
        var ms = Number(duration);
        if (!Number.isFinite(ms) || ms < 0) {
            return 0;
        }

        return Math.max(0, Math.round(ms * resolveAnimationDurationScale(options)));
    }

    function resolveCenterViewportZoom(options) {
        var safeOptions = options || {};
        var requestedZoom = Number(safeOptions.targetZoom);
        if (Number.isFinite(requestedZoom) && requestedZoom > 0) {
            return requestedZoom;
        }

        return safeOptions.centerCardEnabled
            ? Number(safeOptions.centerLockZoom)
            : Number(safeOptions.centerOverviewZoom);
    }

    function panCenterNodeToViewport(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : null;

        if (!cy || !currentCenterNodeId) {
            return false;
        }

        var centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0) {
            return false;
        }

        var centerPos = centerNode.position();
        var currentZoom = Number(cy.zoom());
        var pan = {
            x: cy.width() / 2 - centerPos.x * currentZoom,
            y: cy.height() / 2 - centerPos.y * currentZoom
        };

        cy.pan(pan);

        if (log) {
            log('state', 'verbose', 'pan center node to viewport', {
                reason: safeOptions.reason,
                currentCenterNodeId: currentCenterNodeId,
                zoom: currentZoom,
                pan: pan
            });
        }

        return true;
    }

    function lockCenterNodeViewport(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var lastRequestMode = safeOptions.lastRequestMode;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : null;

        if (!cy || !currentCenterNodeId || lastRequestMode !== 'node') {
            return false;
        }

        var centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0) {
            return false;
        }

        var centerPos = centerNode.position();
        var zoom = resolveCenterViewportZoom(safeOptions);
        var pan = {
            x: cy.width() / 2 - centerPos.x * zoom,
            y: cy.height() / 2 - centerPos.y * zoom
        };

        cy.zoom(zoom);
        cy.pan(pan);

        if (log) {
            log('state', 'verbose', 'lock center viewport', {
                reason: safeOptions.reason,
                currentCenterNodeId: currentCenterNodeId,
                zoom: zoom,
                pan: pan
            });
        }

        return true;
    }

    function animateCenterNodeViewport(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var lastRequestMode = safeOptions.lastRequestMode;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : null;
        var animationToken = safeOptions.animationToken;
        var layoutAnimationToken = safeOptions.layoutAnimationToken;

        if (!cy || !currentCenterNodeId || lastRequestMode !== 'node') {
            return false;
        }

        if (typeof animationToken === 'number'
            && typeof layoutAnimationToken === 'number'
            && animationToken !== layoutAnimationToken) {
            return false;
        }

        var centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0) {
            return false;
        }

        var zoom = resolveCenterViewportZoom(safeOptions);
        var centerPos = centerNode.position();
        var pan = {
            x: cy.width() / 2 - centerPos.x * zoom,
            y: cy.height() / 2 - centerPos.y * zoom
        };

        var animation = cy.animation({
            zoom: zoom,
            pan: pan,
            duration: scaleDuration(safeOptions.duration != null ? safeOptions.duration : 320, safeOptions),
            easing: safeOptions.easing || 'ease-out-cubic'
        });
        animation.play();

        if (log) {
            log('state', 'verbose', 'animate center viewport', {
                reason: safeOptions.reason,
                currentCenterNodeId: currentCenterNodeId,
                zoom: zoom,
                pan: pan,
                duration: scaleDuration(safeOptions.duration != null ? safeOptions.duration : 320, safeOptions)
            });
        }

        return true;
    }

    function animateCenterNodeZoomOnly(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var lastRequestMode = safeOptions.lastRequestMode;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : null;
        var animationToken = safeOptions.animationToken;
        var layoutAnimationToken = safeOptions.layoutAnimationToken;

        if (!cy || !currentCenterNodeId || lastRequestMode !== 'node') {
            return false;
        }

        if (typeof animationToken === 'number'
            && typeof layoutAnimationToken === 'number'
            && animationToken !== layoutAnimationToken) {
            return false;
        }

        var centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0) {
            return false;
        }

        var targetZoom = resolveCenterViewportZoom(safeOptions);
        var animation = cy.animation({
            center: {
                eles: centerNode
            },
            zoom: targetZoom,
            duration: scaleDuration(safeOptions.duration != null ? safeOptions.duration : 320, safeOptions),
            easing: safeOptions.easing || 'ease-out-cubic'
        });
        animation.play();

        if (log) {
            log('state', 'verbose', 'animate center viewport zoom only', {
                reason: safeOptions.reason,
                currentCenterNodeId: currentCenterNodeId,
                targetZoom: targetZoom,
                duration: scaleDuration(safeOptions.duration != null ? safeOptions.duration : 320, safeOptions)
            });
        }

        return true;
    }

    modules.ViewportAnimation = {
        resolveCenterViewportZoom: resolveCenterViewportZoom,
        panCenterNodeToViewport: panCenterNodeToViewport,
        lockCenterNodeViewport: lockCenterNodeViewport,
        animateCenterNodeViewport: animateCenterNodeViewport,
        animateCenterNodeZoomOnly: animateCenterNodeZoomOnly
    };
})();
