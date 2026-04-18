(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.GraphFocus) {
        return;
    }

    function countNodesBy(cy, predicate) {
        if (!cy || typeof predicate !== 'function') {
            return 0;
        }

        var count = 0;
        cy.nodes().forEach(function (node) {
            if (predicate(node)) {
                count += 1;
            }
        });
        return count;
    }

    function resetFocus(cy) {
        if (!cy) {
            return false;
        }

        cy.elements().removeClass('faded focus');
        cy.fit(undefined, 70);
        return true;
    }

    function clearTransientInteractionClasses(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var reason = safeOptions.reason;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : function () { };

        if (!cy) {
            return {
                cleared: false,
                fadedCount: 0,
                focusCount: 0
            };
        }

        var fadedCount = cy.elements('.faded').length;
        var focusCount = cy.elements('.focus').length;

        if (fadedCount === 0 && focusCount === 0) {
            return {
                cleared: false,
                fadedCount: fadedCount,
                focusCount: focusCount
            };
        }

        cy.elements().removeClass('faded focus');
        log('state', 'verbose', 'clear transient interaction classes', {
            reason: reason,
            fadedCount: fadedCount,
            focusCount: focusCount
        });

        return {
            cleared: true,
            fadedCount: fadedCount,
            focusCount: focusCount
        };
    }

    modules.GraphFocus = {
        countNodesBy: countNodesBy,
        resetFocus: resetFocus,
        clearTransientInteractionClasses: clearTransientInteractionClasses
    };
})();
