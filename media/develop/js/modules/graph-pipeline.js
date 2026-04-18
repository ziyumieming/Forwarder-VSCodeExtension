(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.GraphPipeline) {
        return;
    }

    function toStringList(source) {
        if (!Array.isArray(source)) {
            return [];
        }

        return source
            .map(function (item) {
                if (typeof item === 'string') {
                    return item;
                }

                if (item && typeof item === 'object') {
                    return item.signature || item.displayName || item.name || item.label || '';
                }

                return '';
            })
            .map(function (text) {
                return String(text).trim();
            })
            .filter(function (text) {
                return text.length > 0;
            });
    }

    function readClassCardFromNode(node) {
        var safeNode = node || {};
        var classCard = safeNode.classCard || {};
        var title = classCard.title || safeNode.displayName || safeNode.name || safeNode.label || String(safeNode.id || '');

        var fields = toStringList(classCard.fields || safeNode.fields || safeNode.properties || []);
        var methods = toStringList(classCard.methods || safeNode.methods || []);

        return {
            title: String(title),
            fields: fields,
            methods: methods
        };
    }

    function readClassCardFromCenterDetails(centerDetails) {
        if (!centerDetails || !centerDetails.nodeId) {
            return null;
        }

        return {
            nodeId: String(centerDetails.nodeId),
            title: String(centerDetails.name || centerDetails.displayName || centerDetails.nodeId),
            fields: toStringList(centerDetails.fields || []),
            methods: toStringList(centerDetails.methods || [])
        };
    }

    function createLoadingClassCard(nodeId) {
        var normalizedNodeId = String(nodeId);
        return {
            nodeId: normalizedNodeId,
            title: normalizedNodeId,
            fields: ['loading fields...'],
            methods: ['loading methods...']
        };
    }

    function resolveClassCardForNode(node, incomingCenterDetails, options) {
        var safeOptions = options || {};
        var nodeId = String((node && node.id) || '');
        var centerDetailsCache = safeOptions.centerDetailsCache;
        var pendingCenterDetailsNodeId = safeOptions.pendingCenterDetailsNodeId;

        if (!nodeId) {
            return createLoadingClassCard('unknown');
        }

        if (incomingCenterDetails && String(incomingCenterDetails.nodeId) === nodeId) {
            return incomingCenterDetails;
        }

        if (centerDetailsCache instanceof Map) {
            var cached = centerDetailsCache.get(nodeId);
            if (cached) {
                return cached;
            }
        }

        if (pendingCenterDetailsNodeId && String(pendingCenterDetailsNodeId) === nodeId) {
            return createLoadingClassCard(nodeId);
        }

        return readClassCardFromNode(node);
    }

    function buildClassCardLabel(classCard, options) {
        var safeOptions = options || {};
        var getClassCardOptions = typeof safeOptions.getClassCardOptions === 'function'
            ? safeOptions.getClassCardOptions
            : function () {
                return {
                    showFields: true,
                    showMethods: true,
                    collapsedSections: []
                };
            };

        var cardOptions = getClassCardOptions() || {};
        var collapsed = new Set(Array.isArray(cardOptions.collapsedSections) ? cardOptions.collapsedSections : []);
        var safeClassCard = classCard || {};
        var title = String(safeClassCard.title || 'Unknown');
        var fields = Array.isArray(safeClassCard.fields) ? safeClassCard.fields : [];
        var methods = Array.isArray(safeClassCard.methods) ? safeClassCard.methods : [];

        var lines = [title, '----------------'];

        if (cardOptions.showFields !== false && !collapsed.has('fields')) {
            if (fields.length > 0) {
                fields.forEach(function (field) {
                    lines.push('+ ' + field);
                });
            } else {
                lines.push('(no fields)');
            }
        } else {
            lines.push('(fields collapsed)');
        }

        lines.push('----------------');

        if (cardOptions.showMethods !== false && !collapsed.has('methods')) {
            if (methods.length > 0) {
                methods.forEach(function (method) {
                    lines.push('# ' + method);
                });
            } else {
                lines.push('(no methods)');
            }
        } else {
            lines.push('(methods collapsed)');
        }

        return lines.join('\n');
    }

    function estimateCardSize(classCard) {
        var safeClassCard = classCard || {};
        var fieldCount = Array.isArray(safeClassCard.fields) ? safeClassCard.fields.length : 0;
        var methodCount = Array.isArray(safeClassCard.methods) ? safeClassCard.methods.length : 0;
        var visibleFieldRows = Math.min(fieldCount, 5);
        var visibleMethodRows = Math.min(methodCount, 5);

        var fieldRows = Math.max(visibleFieldRows, 1);
        var methodRows = Math.max(visibleMethodRows, 1);

        var headerHeight = 44;
        var sectionTitleHeight = 24;
        var rowHeight = 29;
        var sectionPadding = 16;

        var estimatedHeight = headerHeight
            + sectionTitleHeight
            + sectionTitleHeight
            + fieldRows * rowHeight
            + methodRows * rowHeight
            + sectionPadding * 2;

        return {
            width: 256,
            height: Math.min(Math.max(estimatedHeight, 196), 420)
        };
    }

    function normalizeGraphData(options) {
        var safeOptions = options || {};
        var graphData = safeOptions.graphData;
        var debugWarn = typeof safeOptions.debugWarn === 'function' ? safeOptions.debugWarn : function () { };
        var debug = typeof safeOptions.debug === 'function' ? safeOptions.debug : function () { };
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : function () { };

        if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
            debugWarn('normalize skipped: invalid graph data', { graphData: graphData });
            return null;
        }

        debug('normalize graph data', {
            nodes: graphData.nodes.length,
            edges: graphData.edges.length,
            hasCenterDetails: !!graphData.centerDetails,
            centerNodeId: graphData.centerDetails ? graphData.centerDetails.nodeId || null : null
        });

        var state = safeOptions.state || {};
        var currentCenterNodeId = state.currentCenterNodeId ? String(state.currentCenterNodeId) : null;
        var centerCardEnabled = !!state.centerCardEnabled;
        var htmlNodePluginReady = !!state.htmlNodePluginReady;
        var pendingCenterDetailsNodeId = state.pendingCenterDetailsNodeId ? String(state.pendingCenterDetailsNodeId) : null;

        var centerDetailsCache = safeOptions.centerDetailsCache;
        var classCardModelCache = safeOptions.classCardModelCache;
        var buildHtmlClassCard = typeof safeOptions.buildHtmlClassCard === 'function' ? safeOptions.buildHtmlClassCard : function () { return ''; };
        var getClassCardOptions = safeOptions.getClassCardOptions;
        var createEmptyGraphSnapshot = typeof safeOptions.createEmptyGraphSnapshot === 'function'
            ? safeOptions.createEmptyGraphSnapshot
            : function () {
                return {
                    nodes: new Map(),
                    edges: new Map()
                };
            };
        var addElementToSnapshot = typeof safeOptions.addElementToSnapshot === 'function'
            ? safeOptions.addElementToSnapshot
            : function (snapshotMap, elementDef) {
                if (!snapshotMap || !elementDef || !elementDef.data || !elementDef.data.id) {
                    return;
                }

                var cloned = {
                    data: Object.assign({}, elementDef.data)
                };

                if (typeof elementDef.classes === 'string') {
                    cloned.classes = elementDef.classes;
                }

                snapshotMap.set(String(elementDef.data.id), {
                    element: cloned,
                    signature: JSON.stringify({
                        data: cloned.data || {},
                        classes: typeof cloned.classes === 'string' ? cloned.classes : ''
                    })
                });
            };
        var setPendingCenterDetailsNodeId = typeof safeOptions.setPendingCenterDetailsNodeId === 'function'
            ? safeOptions.setPendingCenterDetailsNodeId
            : function () { };

        var incomingCenterDetails = readClassCardFromCenterDetails(graphData.centerDetails);
        if (incomingCenterDetails && centerDetailsCache instanceof Map) {
            centerDetailsCache.set(incomingCenterDetails.nodeId, incomingCenterDetails);

            log('state', 'verbose', 'cache center details', {
                nodeId: incomingCenterDetails.nodeId,
                fields: incomingCenterDetails.fields.length,
                methods: incomingCenterDetails.methods.length,
                cacheSize: centerDetailsCache.size
            });

            if (pendingCenterDetailsNodeId && pendingCenterDetailsNodeId === incomingCenterDetails.nodeId) {
                setPendingCenterDetailsNodeId(null);
                log('state', 'verbose', 'clear pending center details flag', {
                    nodeId: incomingCenterDetails.nodeId
                });
            }
        }

        var nodeElements = graphData.nodes
            .filter(function (node) {
                return !!(node && node.id);
            })
            .map(function (node) {
                var id = String(node.id);
                var baseLabel = node.displayName || node.name || node.label || id;
                var classCard = resolveClassCardForNode(node, incomingCenterDetails, {
                    centerDetailsCache: centerDetailsCache,
                    pendingCenterDetailsNodeId: pendingCenterDetailsNodeId
                });
                var classCardLabel = buildClassCardLabel(classCard, {
                    getClassCardOptions: getClassCardOptions
                });
                var isCenterClassCard = !!currentCenterNodeId && centerCardEnabled && currentCenterNodeId === id;
                var useHtmlCard = isCenterClassCard && htmlNodePluginReady;
                var cardSize = estimateCardSize(classCard);

                if (classCardModelCache instanceof Map) {
                    classCardModelCache.set(id, classCard);
                }

                return {
                    data: {
                        id: id,
                        baseLabel: baseLabel,
                        classCardLabel: classCardLabel,
                        label: isCenterClassCard && !useHtmlCard ? classCardLabel : baseLabel,
                        isCenterClassCard: isCenterClassCard ? 1 : 0,
                        useHtmlCard: useHtmlCard ? 1 : 0,
                        htmlCardMarkup: useHtmlCard ? buildHtmlClassCard(id, classCard) : '',
                        cardWidth: cardSize.width,
                        cardHeight: cardSize.height,
                        nodeKind: node.type || 'node'
                    },
                    classes: isCenterClassCard ? 'center-class-card' : ''
                };
            });

        var edgeElements = graphData.edges
            .map(function (edge) {
                var source = edge.source || edge.sourceId || edge.from;
                var target = edge.target || edge.targetId || edge.to;

                if (!source || !target) {
                    return null;
                }

                return {
                    data: {
                        id: edge.id || (source + '-' + target + '-' + (edge.relation || edge.type || 'relation')),
                        source: String(source),
                        target: String(target),
                        type: edge.relation || edge.type || 'relation'
                    }
                };
            })
            .filter(function (edge) {
                return !!edge;
            });

        var snapshot = createEmptyGraphSnapshot();
        nodeElements.forEach(function (element) {
            addElementToSnapshot(snapshot.nodes, element);
        });
        edgeElements.forEach(function (element) {
            addElementToSnapshot(snapshot.edges, element);
        });

        return {
            elements: nodeElements.concat(edgeElements),
            snapshot: snapshot
        };
    }

    modules.GraphPipeline = {
        toStringList: toStringList,
        readClassCardFromNode: readClassCardFromNode,
        readClassCardFromCenterDetails: readClassCardFromCenterDetails,
        createLoadingClassCard: createLoadingClassCard,
        resolveClassCardForNode: resolveClassCardForNode,
        buildClassCardLabel: buildClassCardLabel,
        estimateCardSize: estimateCardSize,
        normalizeGraphData: normalizeGraphData
    };
})();
