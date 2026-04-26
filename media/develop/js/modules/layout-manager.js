(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.LayoutManager) {
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

    function getNodeModeLayoutOptions(options) {
        var safeOptions = options || {};
        var getDefaultLayout = typeof safeOptions.getDefaultLayout === 'function'
            ? safeOptions.getDefaultLayout
            : function () {
                return {};
            };
        var baseOptions = Object.assign({}, getDefaultLayout(), {
            fit: safeOptions.fit !== undefined ? !!safeOptions.fit : false,
            animate: safeOptions.animate !== undefined ? !!safeOptions.animate : false
        });

        if (baseOptions.name !== 'cose') {
            return baseOptions;
        }

        var centerId = safeOptions.currentCenterNodeId ? String(safeOptions.currentCenterNodeId) : null;
        return Object.assign({}, baseOptions, {
            padding: Math.max(Number(baseOptions.padding || 0), 90),
            nodeOverlap: 26,
            componentSpacing: 120,
            gravity: 0.25,
            nodeRepulsion: function (node) {
                if (centerId && node.id() === centerId) {
                    return 2500000;
                }

                return 900000;
            },
            idealEdgeLength: function (edge) {
                var sourceId = edge.source().id();
                var targetId = edge.target().id();
                if (centerId && (sourceId === centerId || targetId === centerId)) {
                    return 240;
                }

                return 170;
            },
            edgeElasticity: function (edge) {
                var sourceId = edge.source().id();
                var targetId = edge.target().id();
                if (centerId && (sourceId === centerId || targetId === centerId)) {
                    return 48;
                }

                return 90;
            }
        });
    }

    function runNodeStaggerEnterLayout(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var currentCenterNodeId = safeOptions.currentCenterNodeId;
        var lastRequestMode = safeOptions.lastRequestMode;
        var incrementalResult = safeOptions.incrementalResult;
        var animationToken = safeOptions.animationToken;
        var layoutAnimationToken = safeOptions.layoutAnimationToken;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : function () { };
        var debugWarn = typeof safeOptions.debugWarn === 'function' ? safeOptions.debugWarn : function () { };
        var includeAllNonCenterNodes = safeOptions.includeAllNonCenterNodes === true;
        var onBeforeEnterAnimation = typeof safeOptions.onBeforeEnterAnimation === 'function'
            ? safeOptions.onBeforeEnterAnimation
            : null;
        var onAfterLayout = typeof safeOptions.onAfterLayout === 'function' ? safeOptions.onAfterLayout : null;
        var animateCenterNodeViewport = typeof safeOptions.animateCenterNodeViewport === 'function'
            ? safeOptions.animateCenterNodeViewport
            : function () {
                return false;
            };

        if (!cy || !currentCenterNodeId || (lastRequestMode !== 'node' && lastRequestMode !== 'relation-node')) {
            return false;
        }

        var centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0) {
            return false;
        }

        var enteringNodeIds = includeAllNonCenterNodes
            ? cy.nodes().toArray()
                .map(function (node) {
                    return String(node.id());
                })
                .filter(function (nodeId) {
                    return nodeId !== String(currentCenterNodeId);
                })
            : Array.from(new Set([].concat(
                (incrementalResult && incrementalResult.addedNodeIds) || [],
                (incrementalResult && incrementalResult.replacedNodeIds) || []
            )))
                .map(function (nodeId) {
                    return String(nodeId);
                })
                .filter(function (nodeId) {
                    return nodeId !== String(currentCenterNodeId);
                });

        if (enteringNodeIds.length === 0) {
            return false;
        }

        var centerPosition = {
            x: centerNode.position('x'),
            y: centerNode.position('y')
        };

        var layoutOptions = getNodeModeLayoutOptions({
            fit: false,
            animate: false,
            currentCenterNodeId: currentCenterNodeId,
            getDefaultLayout: safeOptions.getDefaultLayout
        });

        centerNode.lock();

        cy.one('layoutstop', function () {
            if (animationToken !== layoutAnimationToken) {
                centerNode.unlock();
                return;
            }

            var targets = [];
            enteringNodeIds.forEach(function (nodeId) {
                var node = cy.getElementById(nodeId);
                if (!node || node.length === 0 || !node.isNode()) {
                    return;
                }

                targets.push({
                    node: node,
                    target: {
                        x: node.position('x'),
                        y: node.position('y')
                    }
                });
            });

            if (onBeforeEnterAnimation) {
                onBeforeEnterAnimation({
                    animationToken: animationToken,
                    currentCenterNodeId: currentCenterNodeId,
                    enteringNodeCount: targets.length
                });
            }

            targets.forEach(function (entry) {
                entry.node.position(centerPosition);
                entry.node.style('opacity', 0);
            });

            var staggerDelay = scaleDuration(80, safeOptions);
            var moveDuration = scaleDuration(340, safeOptions);
            var totalDelay = (targets.length > 0 ? (targets.length - 1) * staggerDelay : 0)
                + moveDuration
                + scaleDuration(30, safeOptions);

            targets.forEach(function (entry, index) {
                setTimeout(function () {
                    if (animationToken !== layoutAnimationToken) {
                        return;
                    }

                    var animation = entry.node.animation({
                        position: entry.target,
                        style: { opacity: 1 },
                        duration: moveDuration,
                        easing: 'ease-out-cubic'
                    });

                    animation.play();
                    animation.promise('completed').then(function () {
                        try {
                            entry.node.removeStyle('opacity');
                        } catch (error) {
                            debugWarn('remove opacity style failed after stagger animation', {
                                nodeId: entry.node.id ? entry.node.id() : null,
                                error: error
                            });
                        }
                    });
                }, index * staggerDelay);
            });

            setTimeout(function () {
                if (animationToken !== layoutAnimationToken) {
                    return;
                }

                centerNode.unlock();

                var handled = false;
                if (onAfterLayout) {
                    handled = onAfterLayout({
                        animationToken: animationToken,
                        currentCenterNodeId: currentCenterNodeId,
                        enteringNodeCount: targets.length
                    }) === true;
                }

                if (!handled) {
                    animateCenterNodeViewport('node-stagger-enter-complete', {
                        duration: scaleDuration(360, safeOptions),
                        animationToken: animationToken
                    });
                }
            }, totalDelay);

            log('renderer', 'info', 'node stagger enter animation applied', {
                centerNodeId: currentCenterNodeId,
                enteringNodeCount: targets.length,
                staggerDelay: staggerDelay,
                moveDuration: moveDuration
            });
        });

        cy.layout(layoutOptions).run();
        return true;
    }

    function runGlobalSmoothLayout(options) {
        var safeOptions = options || {};
        var cy = safeOptions.cy;
        var animationToken = safeOptions.animationToken;
        var layoutAnimationToken = safeOptions.layoutAnimationToken;
        var getDefaultLayout = typeof safeOptions.getDefaultLayout === 'function'
            ? safeOptions.getDefaultLayout
            : function () {
                return {};
            };
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : function () { };
        var debugWarn = typeof safeOptions.debugWarn === 'function' ? safeOptions.debugWarn : function () { };

        if (!cy) {
            return false;
        }

        var nodes = cy.nodes();
        var edges = cy.edges();
        if (nodes.length === 0) {
            return false;
        }

        nodes.style('opacity', 0);
        edges.style('opacity', 0);

        var layoutOptions = Object.assign({}, getDefaultLayout(), {
            animate: false,
            fit: true
        });

        cy.one('layoutstop', function () {
            if (animationToken !== layoutAnimationToken) {
                return;
            }

            var viewportCenterX = cy.width() / 2;
            var viewportCenterY = cy.height() / 2;
            var orderedNodes = nodes.toArray().sort(function (left, right) {
                var leftPos = left.renderedPosition();
                var rightPos = right.renderedPosition();

                var leftDistance = Math.hypot(leftPos.x - viewportCenterX, leftPos.y - viewportCenterY);
                var rightDistance = Math.hypot(rightPos.x - viewportCenterX, rightPos.y - viewportCenterY);
                return leftDistance - rightDistance;
            });

            var staggerDelay = scaleDuration(16, safeOptions);
            var nodeDuration = scaleDuration(220, safeOptions);
            var edgeDuration = scaleDuration(200, safeOptions);
            var maxStaggerSteps = 56;

            orderedNodes.forEach(function (node, index) {
                var delay = Math.min(index, maxStaggerSteps) * staggerDelay;

                setTimeout(function () {
                    if (animationToken !== layoutAnimationToken) {
                        return;
                    }

                    var animation = node.animation({
                        style: { opacity: 1 },
                        duration: nodeDuration,
                        easing: 'ease-out-cubic'
                    });

                    animation.play();
                    animation.promise('completed').then(function () {
                        try {
                            node.removeStyle('opacity');
                        } catch (error) {
                            debugWarn('remove opacity style failed after global reveal animation', {
                                nodeId: node.id ? node.id() : null,
                                error: error
                            });
                        }
                    });
                }, delay);
            });

            var lastDelay = Math.min(orderedNodes.length, maxStaggerSteps) * staggerDelay;
            setTimeout(function () {
                if (animationToken !== layoutAnimationToken) {
                    return;
                }

                var edgeAnimation = edges.animation({
                    style: { opacity: 1 },
                    duration: edgeDuration,
                    easing: 'ease-out'
                });

                edgeAnimation.play();
                edgeAnimation.promise('completed').then(function () {
                    try {
                        edges.removeStyle('opacity');
                    } catch (error) {
                        debugWarn('remove edge opacity style failed after global reveal animation', { error: error });
                    }
                });
            }, Math.max(scaleDuration(80, safeOptions), Math.floor(lastDelay * 0.5)));

            log('renderer', 'info', 'global smooth reveal animation applied', {
                nodeCount: orderedNodes.length,
                edgeCount: edges.length,
                staggerDelay: staggerDelay,
                nodeDuration: nodeDuration,
                edgeDuration: edgeDuration
            });
        });

        cy.layout(layoutOptions).run();
        return true;
    }

    modules.LayoutManager = {
        getNodeModeLayoutOptions: getNodeModeLayoutOptions,
        runNodeStaggerEnterLayout: runNodeStaggerEnterLayout,
        runGlobalSmoothLayout: runGlobalSmoothLayout
    };
})();
