(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.GraphIncremental) {
        return;
    }

    function createEmptyGraphSnapshot() {
        return {
            nodes: new Map(),
            edges: new Map()
        };
    }

    function cloneElementDefinition(elementDef) {
        var cloned = {
            data: { ...((elementDef && elementDef.data) || {}) }
        };

        if (elementDef && typeof elementDef.classes === 'string') {
            cloned.classes = elementDef.classes;
        }

        return cloned;
    }

    function createElementSignature(elementDef) {
        var sourceData = (elementDef && elementDef.data) || {};
        var sortedData = {};

        Object.keys(sourceData)
            .sort()
            .forEach(function (key) {
                sortedData[key] = sourceData[key];
            });

        return JSON.stringify({
            data: sortedData,
            classes: (elementDef && typeof elementDef.classes === 'string') ? elementDef.classes : ''
        });
    }

    function addElementToSnapshot(snapshotMap, elementDef) {
        var id = String((elementDef && elementDef.data && elementDef.data.id) || '');
        if (!id) {
            return;
        }

        var cloned = cloneElementDefinition(elementDef);
        snapshotMap.set(id, {
            element: cloned,
            signature: createElementSignature(cloned)
        });
    }

    function computeGraphSnapshotDiff(previousSnapshot, nextSnapshot) {
        var diff = {
            nodeIdsToAdd: [],
            nodeIdsToRemove: [],
            nodeIdsToUpdate: [],
            edgeIdsToAdd: [],
            edgeIdsToRemove: [],
            edgeIdsToUpdate: []
        };

        previousSnapshot.nodes.forEach(function (_entry, nodeId) {
            if (!nextSnapshot.nodes.has(nodeId)) {
                diff.nodeIdsToRemove.push(nodeId);
            }
        });

        nextSnapshot.nodes.forEach(function (entry, nodeId) {
            var prevEntry = previousSnapshot.nodes.get(nodeId);
            if (!prevEntry) {
                diff.nodeIdsToAdd.push(nodeId);
                return;
            }

            if (prevEntry.signature !== entry.signature) {
                diff.nodeIdsToUpdate.push(nodeId);
            }
        });

        previousSnapshot.edges.forEach(function (_entry, edgeId) {
            if (!nextSnapshot.edges.has(edgeId)) {
                diff.edgeIdsToRemove.push(edgeId);
            }
        });

        nextSnapshot.edges.forEach(function (entry, edgeId) {
            var prevEntry = previousSnapshot.edges.get(edgeId);
            if (!prevEntry) {
                diff.edgeIdsToAdd.push(edgeId);
                return;
            }

            if (prevEntry.signature !== entry.signature) {
                diff.edgeIdsToUpdate.push(edgeId);
            }
        });

        return diff;
    }

    function isCenterNodeElement(entry) {
        if (!entry || !entry.element) {
            return false;
        }

        var classes = String(entry.element.classes || '');
        var fromClass = classes.split(/\s+/).includes('center-class-card');
        var fromData = Number((entry.element.data || {}).isCenterClassCard) === 1;
        return fromClass || fromData;
    }

    function shouldReplaceUpdatedNode(previousEntry, nextEntry) {
        var previousCenter = isCenterNodeElement(previousEntry);
        var nextCenter = isCenterNodeElement(nextEntry);
        return previousCenter !== nextCenter;
    }

    function buildReplaceEdgeIds(nextSnapshot, nodeIdsToReplace) {
        var replaceNodeIdSet = new Set(nodeIdsToReplace.map(function (nodeId) {
            return String(nodeId);
        }));
        var edgeIds = new Set();

        nextSnapshot.edges.forEach(function (entry, edgeId) {
            var source = String((entry && entry.element && entry.element.data && entry.element.data.source) || '');
            var target = String((entry && entry.element && entry.element.data && entry.element.data.target) || '');

            if (!source || !target) {
                return;
            }

            if (replaceNodeIdSet.has(source) || replaceNodeIdSet.has(target)) {
                edgeIds.add(edgeId);
            }
        });

        return edgeIds;
    }

    function applyElementDefinition(element, elementDef) {
        if (!element || element.length === 0 || !elementDef || !elementDef.data) {
            return;
        }

        var nextData = elementDef.data;
        var currentData = element.data();

        var removeDataKeys = Object.keys(currentData).filter(function (key) {
            return !Object.prototype.hasOwnProperty.call(nextData, key);
        });

        if (removeDataKeys.length > 0) {
            element.removeData(removeDataKeys.join(' '));
        }

        Object.keys(nextData).forEach(function (key) {
            if (element.data(key) !== nextData[key]) {
                element.data(key, nextData[key]);
            }
        });

        if (typeof elementDef.classes === 'string') {
            element.classes(elementDef.classes);
        }
    }

    function applyIncremental(options) {
        var safeOptions = options || {};
        var previousSnapshot = safeOptions.previousSnapshot || createEmptyGraphSnapshot();
        var nextSnapshot = safeOptions.nextSnapshot || createEmptyGraphSnapshot();
        var fallbackElements = Array.isArray(safeOptions.fallbackElements) ? safeOptions.fallbackElements : [];
        var cy = safeOptions.cy;
        var log = typeof safeOptions.log === 'function' ? safeOptions.log : null;

        if (!cy) {
            return {
                mode: 'full-fallback',
                structuralChange: true,
                diff: null,
                addedNodeIds: [],
                replacedNodeIds: [],
                nextSnapshot: nextSnapshot
            };
        }

        var expectedCount = previousSnapshot.nodes.size + previousSnapshot.edges.size;
        var actualCount = cy.elements().length;

        if (expectedCount !== actualCount) {
            if (log) {
                log('state', 'error', 'incremental snapshot mismatch, fallback to full rebuild', {
                    expectedCount: expectedCount,
                    actualCount: actualCount,
                    previousNodeCount: previousSnapshot.nodes.size,
                    previousEdgeCount: previousSnapshot.edges.size
                });
            }

            cy.elements().remove();
            cy.add(fallbackElements);

            return {
                mode: 'full-fallback',
                structuralChange: true,
                diff: null,
                addedNodeIds: [],
                replacedNodeIds: [],
                nextSnapshot: nextSnapshot
            };
        }

        var diff = computeGraphSnapshotDiff(previousSnapshot, nextSnapshot);

        var replaceNodeIds = [];
        var normalNodeUpdateIds = [];
        diff.nodeIdsToUpdate.forEach(function (nodeId) {
            var previousEntry = previousSnapshot.nodes.get(nodeId);
            var nextEntry = nextSnapshot.nodes.get(nodeId);

            if (shouldReplaceUpdatedNode(previousEntry, nextEntry)) {
                replaceNodeIds.push(nodeId);
                return;
            }

            normalNodeUpdateIds.push(nodeId);
        });

        var replaceEdgeIds = buildReplaceEdgeIds(nextSnapshot, replaceNodeIds);
        var replaceNodePreviousPositions = new Map();
        replaceNodeIds.forEach(function (nodeId) {
            var existingNode = cy.getElementById(nodeId);
            if (!existingNode || existingNode.length === 0 || !existingNode.isNode()) {
                return;
            }

            replaceNodePreviousPositions.set(String(nodeId), {
                x: existingNode.position('x'),
                y: existingNode.position('y')
            });
        });

        var nodesToAdd = diff.nodeIdsToAdd
            .map(function (nodeId) {
                var entry = nextSnapshot.nodes.get(nodeId);
                return entry ? entry.element : null;
            })
            .filter(function (entry) {
                return !!entry;
            })
            .map(function (entry) {
                return cloneElementDefinition(entry);
            });

        var nodesToReplace = replaceNodeIds
            .map(function (nodeId) {
                var entry = nextSnapshot.nodes.get(nodeId);
                return entry ? entry.element : null;
            })
            .filter(function (entry) {
                return !!entry;
            })
            .map(function (entry) {
                return cloneElementDefinition(entry);
            });

        var edgeIdsToAddSet = new Set(diff.edgeIdsToAdd.map(function (edgeId) {
            return String(edgeId);
        }));
        replaceEdgeIds.forEach(function (edgeId) {
            edgeIdsToAddSet.add(String(edgeId));
        });

        var edgesToAdd = Array.from(edgeIdsToAddSet)
            .map(function (edgeId) {
                var entry = nextSnapshot.edges.get(edgeId);
                return entry ? entry.element : null;
            })
            .filter(function (entry) {
                return !!entry;
            })
            .map(function (entry) {
                return cloneElementDefinition(entry);
            });

        var edgesToRemove = cy.collection();
        diff.edgeIdsToRemove.forEach(function (edgeId) {
            var edge = cy.getElementById(edgeId);
            if (edge && edge.length > 0 && edge.isEdge()) {
                edgesToRemove.merge(edge);
            }
        });
        replaceEdgeIds.forEach(function (edgeId) {
            var edge = cy.getElementById(edgeId);
            if (edge && edge.length > 0 && edge.isEdge()) {
                edgesToRemove.merge(edge);
            }
        });
        if (edgesToRemove.length > 0) {
            edgesToRemove.remove();
        }

        var nodesToRemove = cy.collection();
        diff.nodeIdsToRemove.forEach(function (nodeId) {
            var node = cy.getElementById(nodeId);
            if (node && node.length > 0 && node.isNode()) {
                nodesToRemove.merge(node);
            }
        });
        replaceNodeIds.forEach(function (nodeId) {
            var node = cy.getElementById(nodeId);
            if (node && node.length > 0 && node.isNode()) {
                nodesToRemove.merge(node);
            }
        });
        if (nodesToRemove.length > 0) {
            nodesToRemove.remove();
        }

        if (nodesToAdd.length > 0) {
            cy.add(nodesToAdd);
        }
        if (nodesToReplace.length > 0) {
            cy.add(nodesToReplace);

            replaceNodeIds.forEach(function (nodeId) {
                var previousPosition = replaceNodePreviousPositions.get(String(nodeId));
                if (!previousPosition) {
                    return;
                }

                var replacedNode = cy.getElementById(nodeId);
                if (!replacedNode || replacedNode.length === 0 || !replacedNode.isNode()) {
                    return;
                }

                replacedNode.position(previousPosition);
            });
        }
        if (edgesToAdd.length > 0) {
            cy.add(edgesToAdd);
        }

        normalNodeUpdateIds.forEach(function (nodeId) {
            var nextNodeEntry = nextSnapshot.nodes.get(nodeId);
            if (!nextNodeEntry) {
                return;
            }

            var node = cy.getElementById(nodeId);
            if (!node || node.length === 0 || !node.isNode()) {
                return;
            }

            applyElementDefinition(node, nextNodeEntry.element);
        });

        diff.edgeIdsToUpdate.forEach(function (edgeId) {
            if (replaceEdgeIds.has(String(edgeId))) {
                return;
            }

            var nextEdgeEntry = nextSnapshot.edges.get(edgeId);
            if (!nextEdgeEntry) {
                return;
            }

            var edge = cy.getElementById(edgeId);
            if (!edge || edge.length === 0 || !edge.isEdge()) {
                return;
            }

            applyElementDefinition(edge, nextEdgeEntry.element);
        });

        var structuralChange =
            diff.nodeIdsToAdd.length > 0
            || diff.nodeIdsToRemove.length > 0
            || diff.edgeIdsToAdd.length > 0
            || diff.edgeIdsToRemove.length > 0
            || replaceNodeIds.length > 0
            || replaceEdgeIds.size > 0;

        if (log) {
            log('state', 'info', 'incremental diff applied', {
                nodeAdd: diff.nodeIdsToAdd.length,
                nodeRemove: diff.nodeIdsToRemove.length,
                nodeUpdate: normalNodeUpdateIds.length,
                nodeReplace: replaceNodeIds.length,
                edgeAdd: diff.edgeIdsToAdd.length,
                edgeRemove: diff.edgeIdsToRemove.length,
                edgeUpdate: diff.edgeIdsToUpdate.length,
                edgeReplace: replaceEdgeIds.size,
                structuralChange: structuralChange
            });
        }

        return {
            mode: 'incremental',
            structuralChange: structuralChange,
            diff: diff,
            addedNodeIds: [].concat(diff.nodeIdsToAdd),
            replacedNodeIds: [].concat(replaceNodeIds),
            nextSnapshot: nextSnapshot
        };
    }

    modules.GraphIncremental = {
        createEmptyGraphSnapshot: createEmptyGraphSnapshot,
        cloneElementDefinition: cloneElementDefinition,
        addElementToSnapshot: addElementToSnapshot,
        computeGraphSnapshotDiff: computeGraphSnapshotDiff,
        applyElementDefinition: applyElementDefinition,
        applyIncremental: applyIncremental
    };
})();
