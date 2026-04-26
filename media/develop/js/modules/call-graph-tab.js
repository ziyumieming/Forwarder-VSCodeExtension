(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CallGraphTab) {
        return;
    }

    function noop() { }

    function firstNonBlank() {
        for (var i = 0; i < arguments.length; i += 1) {
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

    function labelFromId(nodeId) {
        var id = String(nodeId || '').trim();
        if (!id) {
            return 'Unknown function';
        }

        var hashParts = id.split('#').filter(function (part) {
            return String(part).trim().length > 0;
        });
        return hashParts.length > 0 ? hashParts[hashParts.length - 1] : id;
    }

    function summarizeUri(uri) {
        var text = String(uri || '').trim();
        if (!text) {
            return '';
        }

        var normalized = text.replace(/\\/g, '/');
        var parts = normalized.split('/').filter(function (part) {
            return part.length > 0;
        });
        return parts.length > 0 ? parts[parts.length - 1] : normalized;
    }

    function nodeToFunctionRef(nodeOrData) {
        var data = typeof nodeOrData?.data === 'function' ? nodeOrData.data() : (nodeOrData || {});
        var nodeKind = firstNonBlank(data.nodeKind, data.type);
        if (nodeKind && nodeKind !== 'function' && nodeKind !== 'method') {
            return null;
        }

        var id = firstNonBlank(data.id);
        if (!id) {
            return null;
        }

        return {
            id: id,
            label: firstNonBlank(data.baseLabel, data.label, data.name, labelFromId(id)),
            meta: firstNonBlank(data.namespace, summarizeUri(data.uri), nodeKind)
        };
    }

    function create(context) {
        var safeContext = context || {};
        var cy = safeContext.cy;
        var selectionStore = safeContext.selectionStore;
        var log = typeof safeContext.log === 'function' ? safeContext.log : noop;
        var clearCanvas = typeof safeContext.clearCanvas === 'function' ? safeContext.clearCanvas : noop;
        var renderGraphData = typeof safeContext.renderGraphData === 'function' ? safeContext.renderGraphData : noop;
        var isActiveTab = typeof safeContext.isActiveTab === 'function' ? safeContext.isActiveTab : function () { return false; };

        var state = {
            centerFunction: null,
            depth: 2,
            direction: 'both',
            includeExternal: false,
            pathSlots: [],
            selectionCandidates: [],
            hasRenderedCallGraph: false,
            contextNode: null,
            draggingSlotIndex: null
        };

        var refs = {};
        var unsubscribeSelection = null;

        function readRefs() {
            refs.depth = document.getElementById('call-depth');
            refs.direction = document.getElementById('call-direction');
            refs.includeExternal = document.getElementById('call-include-external');
            refs.query = document.getElementById('btn-call-query');
            refs.fit = document.getElementById('btn-call-fit');
            refs.layout = document.getElementById('btn-call-layout');
            refs.clear = document.getElementById('btn-call-clear');
            refs.emptyOverlay = document.getElementById('call-empty-overlay');
            refs.useSlotCenter = document.getElementById('btn-call-use-slot-center');
            refs.tray = document.getElementById('call-path-tray');
            refs.contextMenu = document.getElementById('call-context-menu');
            refs.chipList = document.getElementById('call-path-chip-list');
            refs.pathHint = document.getElementById('call-path-hint');
        }

        function cloneFunctionRef(functionRef) {
            if (!functionRef || !functionRef.id) {
                return null;
            }

            return {
                id: String(functionRef.id),
                label: firstNonBlank(functionRef.label, labelFromId(functionRef.id)),
                meta: firstNonBlank(functionRef.meta)
            };
        }

        function getCandidateCenter() {
            return state.pathSlots[0] || state.selectionCandidates[0] || null;
        }

        function findSlotIndex(nodeId) {
            var normalizedId = String(nodeId || '');
            for (var i = 0; i < state.pathSlots.length; i += 1) {
                if (state.pathSlots[i] && state.pathSlots[i].id === normalizedId) {
                    return i;
                }
            }
            return -1;
        }

        function setCenterFunction(functionRef, source) {
            state.centerFunction = cloneFunctionRef(functionRef);
            state.hasRenderedCallGraph = false;
            updateUi();

            log('state', 'info', 'call graph center set', {
                source: source || 'unknown',
                centerFunctionId: state.centerFunction ? state.centerFunction.id : null
            });
        }

        function addPathSlot(functionRef) {
            var normalizedRef = cloneFunctionRef(functionRef);
            if (!normalizedRef) {
                return;
            }

            var existingIndex = findSlotIndex(normalizedRef.id);
            if (existingIndex >= 0) {
                state.pathSlots.splice(existingIndex, 1);
            }
            state.pathSlots.push(normalizedRef);
            updateUi();
        }

        function removePathSlot(index) {
            if (index < 0 || index >= state.pathSlots.length) {
                return;
            }

            state.pathSlots.splice(index, 1);
            updateUi();
        }

        function movePathSlot(fromIndex, toIndex) {
            if (fromIndex === toIndex
                || fromIndex < 0
                || toIndex < 0
                || fromIndex >= state.pathSlots.length
                || toIndex >= state.pathSlots.length) {
                return;
            }

            var moved = state.pathSlots.splice(fromIndex, 1)[0];
            state.pathSlots.splice(toIndex, 0, moved);
            updateUi();
        }

        function renderPathChips() {
            if (!refs.chipList) {
                return;
            }

            refs.chipList.textContent = '';
            state.pathSlots.forEach(function (slot, index) {
                var chip = document.createElement('span');
                chip.className = 'call-path-chip';
                chip.draggable = true;
                chip.dataset.slotIndex = String(index);
                chip.title = slot.id;

                var label = document.createElement('span');
                label.className = 'call-path-chip-label';
                label.textContent = slot.label || labelFromId(slot.id);
                chip.appendChild(label);

                var removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'call-path-chip-remove';
                removeButton.dataset.slotRemoveIndex = String(index);
                removeButton.setAttribute('aria-label', 'Remove ' + (slot.label || slot.id));
                removeButton.textContent = 'x';
                chip.appendChild(removeButton);

                chip.addEventListener('dragstart', function (event) {
                    state.draggingSlotIndex = index;
                    chip.classList.add('is-dragging');
                    if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', slot.id);
                    }
                });
                chip.addEventListener('dragend', function () {
                    chip.classList.remove('is-dragging');
                    state.draggingSlotIndex = null;
                });
                chip.addEventListener('dragover', function (event) {
                    event.preventDefault();
                    if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = 'move';
                    }
                });
                chip.addEventListener('drop', function (event) {
                    event.preventDefault();
                    if (Number.isInteger(state.draggingSlotIndex)) {
                        movePathSlot(state.draggingSlotIndex, index);
                    }
                });

                refs.chipList.appendChild(chip);
            });
        }

        function updateUi() {
            if (!refs.depth) {
                readRefs();
            }

            var hasCenter = !!(state.centerFunction && state.centerFunction.id);
            var candidateCenter = getCandidateCenter();
            if (refs.depth) {
                refs.depth.value = String(state.depth);
            }
            if (refs.direction) {
                refs.direction.value = state.direction;
            }
            if (refs.includeExternal) {
                refs.includeExternal.checked = !!state.includeExternal;
            }
            if (refs.query) {
                refs.query.disabled = !hasCenter;
            }
            if (refs.useSlotCenter) {
                refs.useSlotCenter.disabled = !candidateCenter;
            }
            if (refs.emptyOverlay) {
                refs.emptyOverlay.hidden = !isActiveTab() || hasCenter || state.hasRenderedCallGraph;
            }
            if (refs.tray) {
                refs.tray.hidden = !isActiveTab();
            }
            if (refs.pathHint) {
                refs.pathHint.textContent = state.pathSlots.length > 0
                    ? state.pathSlots.length + ' waypoint' + (state.pathSlots.length === 1 ? '' : 's') + ' selected. Drag to reorder.'
                    : 'Add functions to define waypoint order.';
            }

            renderPathChips();
        }

        function hideContextMenu() {
            if (!refs.contextMenu) {
                return;
            }

            refs.contextMenu.hidden = true;
            state.contextNode = null;
        }

        function showContextMenu(node, event) {
            if (!refs.contextMenu) {
                readRefs();
            }
            if (!refs.contextMenu) {
                return;
            }

            state.contextNode = nodeToFunctionRef(node);
            if (!state.contextNode) {
                return;
            }

            var renderedPosition = event && event.renderedPosition ? event.renderedPosition : null;
            var x = renderedPosition ? renderedPosition.x : 120;
            var y = renderedPosition ? renderedPosition.y : 120;
            refs.contextMenu.style.left = Math.max(12, Math.round(x)) + 'px';
            refs.contextMenu.style.top = Math.max(72, Math.round(y)) + 'px';
            refs.contextMenu.hidden = false;
        }

        function handleContextAction(action) {
            var functionRef = state.contextNode;
            hideContextMenu();
            if (!functionRef) {
                return;
            }

            if (action === 'center') {
                setCenterFunction(functionRef, 'context-menu');
                return;
            }

            addPathSlot(functionRef);
        }

        function bindToolbar() {
            readRefs();

            refs.depth?.addEventListener('change', function () {
                var nextDepth = Number(refs.depth.value);
                state.depth = Number.isFinite(nextDepth) ? nextDepth : 2;
                updateUi();
            });
            refs.direction?.addEventListener('change', function () {
                state.direction = refs.direction.value || 'both';
                updateUi();
            });
            refs.includeExternal?.addEventListener('change', function () {
                state.includeExternal = !!refs.includeExternal.checked;
                updateUi();
            });
            refs.query?.addEventListener('click', function () {
                log('query', 'info', 'call graph query placeholder clicked', {
                    centerFunctionId: state.centerFunction ? state.centerFunction.id : null,
                    depth: state.depth,
                    direction: state.direction,
                    includeExternal: state.includeExternal,
                    waypointIds: state.pathSlots.map(function (slot) { return slot.id; })
                });
            });
            refs.fit?.addEventListener('click', function () {
                if (cy) {
                    cy.fit(undefined, 80);
                }
            });
            refs.layout?.addEventListener('click', function () {
                if (cy) {
                    cy.layout(globalScope.AnalysisStyle.getAltLayout()).run();
                }
            });
            refs.clear?.addEventListener('click', function () {
                state.centerFunction = null;
                state.hasRenderedCallGraph = false;
                clearCanvas('call-graph-clear');
                updateUi();
            });
            refs.useSlotCenter?.addEventListener('click', function () {
                var candidate = getCandidateCenter();
                if (candidate) {
                    setCenterFunction(candidate, 'empty-overlay-slot');
                }
            });
            refs.contextMenu?.addEventListener('click', function (event) {
                var action = event.target && event.target.dataset ? event.target.dataset.callAction : null;
                if (action) {
                    handleContextAction(action);
                }
            });
            refs.chipList?.addEventListener('click', function (event) {
                var rawIndex = event.target && event.target.dataset ? event.target.dataset.slotRemoveIndex : null;
                if (rawIndex === undefined || rawIndex === null) {
                    return;
                }

                var index = Number(rawIndex);
                if (Number.isInteger(index)) {
                    removePathSlot(index);
                }
            });
            document.addEventListener('click', function (event) {
                if (!refs.contextMenu || refs.contextMenu.hidden) {
                    return;
                }
                if (refs.contextMenu.contains(event.target)) {
                    return;
                }
                hideContextMenu();
            });

            if (selectionStore && typeof selectionStore.subscribe === 'function') {
                unsubscribeSelection = selectionStore.subscribe(function (snapshot) {
                    var ids = Array.isArray(snapshot?.functionIds) ? snapshot.functionIds : [];
                    state.selectionCandidates = ids.map(function (id) {
                        return {
                            id: String(id),
                            label: labelFromId(id),
                            meta: ''
                        };
                    });
                    if (state.pathSlots.length === 0 && state.selectionCandidates.length > 0) {
                        state.pathSlots = state.selectionCandidates.map(cloneFunctionRef).filter(function (slot) {
                            return !!slot;
                        });
                    }
                    updateUi();
                });
            }

            updateUi();
        }

        function bindGraphEvents() {
            if (!cy) {
                return;
            }

            cy.on('tap', 'node', function (event) {
                if (!isActiveTab()) {
                    return;
                }
                hideContextMenu();
                var functionRef = nodeToFunctionRef(event.target);
                if (functionRef) {
                    setCenterFunction(functionRef, 'node-tap');
                }
            });

            cy.on('cxttap', 'node', function (event) {
                if (!isActiveTab()) {
                    return;
                }
                showContextMenu(event.target, event);
            });

            cy.on('tap', function (event) {
                if (!isActiveTab() || event.target !== cy) {
                    return;
                }
                hideContextMenu();
            });
        }

        function activate(event) {
            log('state', 'info', 'activate call graph tab', event || {});
            if (!state.hasRenderedCallGraph) {
                clearCanvas('call-graph-activate-empty');
            }
            updateUi();
        }

        function deactivate(event) {
            log('state', 'info', 'deactivate call graph tab', event || {});
            hideContextMenu();
            if (refs.emptyOverlay) {
                refs.emptyOverlay.hidden = true;
            }
            if (refs.tray) {
                refs.tray.hidden = true;
            }
        }

        return {
            id: 'callGraph',
            bindToolbar: bindToolbar,
            bindGraphEvents: bindGraphEvents,
            onActivate: activate,
            onReactivate: activate,
            onDeactivate: deactivate,
            renderGraphData: function (graphData) {
                state.hasRenderedCallGraph = true;
                renderGraphData(graphData, {
                    currentCenterNodeId: state.centerFunction ? state.centerFunction.id : null
                });
                updateUi();
            },
            dispose: function () {
                if (typeof unsubscribeSelection === 'function') {
                    unsubscribeSelection();
                }
            },
            getState: function () {
                return {
                    centerFunction: state.centerFunction ? { ...state.centerFunction } : null,
                    depth: state.depth,
                    direction: state.direction,
                    includeExternal: state.includeExternal,
                    pathSlots: state.pathSlots.map(function (slot) { return { ...slot }; })
                };
            }
        };
    }

    modules.CallGraphTab = {
        create: create
    };
})();
