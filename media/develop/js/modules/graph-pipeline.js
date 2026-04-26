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

    function firstNonBlank() {
        for (var i = 0; i < arguments.length; i++) {
            var value = arguments[i];
            if (value === undefined || value === null) {
                continue;
            }

            var text = String(value).trim();
            if (text.length > 0) {
                return text;
            }
        }

        return '';
    }

    function labelFromNodeId(nodeId) {
        var id = String(nodeId || '').trim();
        if (!id) {
            return 'Unknown';
        }

        var hashParts = id.split('#').filter(function (part) {
            return String(part).trim().length > 0;
        });
        var tail = hashParts.length > 0 ? hashParts[hashParts.length - 1] : id;

        return firstNonBlank(tail, id, 'Unknown');
    }

    function getNodeDisplayLabel(node) {
        var safeNode = node || {};
        return firstNonBlank(
            safeNode.displayName,
            safeNode.name,
            safeNode.label,
            labelFromNodeId(safeNode.id)
        );
    }

    var RELATION_LABEL_ORDER = {
        extends: 10,
        implements: 20,
        composes: 30,
        aggregates: 40,
        uses: 50,
        calls: 60,
        references: 70,
        contains: 80
    };

    function normalizeRelationLabel(relation) {
        return firstNonBlank(relation, 'relation');
    }

    function sortRelationLabels(left, right) {
        var leftOrder = RELATION_LABEL_ORDER[left] || 999;
        var rightOrder = RELATION_LABEL_ORDER[right] || 999;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }

        return left.localeCompare(right);
    }

    function readClassCardFromNode(node) {
        var safeNode = node || {};
        var classCard = safeNode.classCard || {};
        var title = firstNonBlank(classCard.title, getNodeDisplayLabel(safeNode));

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
            title: firstNonBlank(centerDetails.name, centerDetails.displayName, labelFromNodeId(centerDetails.nodeId)),
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
        var title = firstNonBlank(safeClassCard.title, 'Unknown');
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
                var baseLabel = getNodeDisplayLabel(node);
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

        var edgeMap = new Map();
        graphData.edges.forEach(function (edge) {
            if (!edge) {
                return;
            }

            var source = edge.source || edge.sourceId || edge.from;
            var target = edge.target || edge.targetId || edge.to;

            if (!source || !target) {
                return;
            }

            var normalizedSource = String(source);
            var normalizedTarget = String(target);
            var edgeKey = normalizedSource + '->' + normalizedTarget;
            var relation = normalizeRelationLabel(edge.relation || edge.type);
            var entry = edgeMap.get(edgeKey);

            if (!entry) {
                entry = {
                    source: normalizedSource,
                    target: normalizedTarget,
                    relations: new Set()
                };
                edgeMap.set(edgeKey, entry);
            }

            entry.relations.add(relation);
        });

        var edgeElements = Array.from(edgeMap.values())
            .map(function (entry) {
                var relations = Array.from(entry.relations).sort(sortRelationLabels);
                var relationLabel = relations.join(' / ');

                return {
                    data: {
                        id: entry.source + '-' + entry.target + '-' + relationLabel,
                        source: entry.source,
                        target: entry.target,
                        type: relationLabel,
                        relations: relations
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
