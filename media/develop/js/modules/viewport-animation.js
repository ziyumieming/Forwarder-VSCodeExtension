(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.ViewportAnimation) {
        return;
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
            duration: safeOptions.duration != null ? safeOptions.duration : 320,
            easing: safeOptions.easing || 'ease-out-cubic'
        });
        animation.play();

        if (log) {
            log('state', 'verbose', 'animate center viewport', {
                reason: safeOptions.reason,
                currentCenterNodeId: currentCenterNodeId,
                zoom: zoom,
                pan: pan,
                duration: safeOptions.duration != null ? safeOptions.duration : 320
            });
        }

        return true;
    }

    modules.ViewportAnimation = {
        resolveCenterViewportZoom: resolveCenterViewportZoom,
        lockCenterNodeViewport: lockCenterNodeViewport,
        animateCenterNodeViewport: animateCenterNodeViewport
    };
})();
