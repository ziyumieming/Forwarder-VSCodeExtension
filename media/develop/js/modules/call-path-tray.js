(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CallPathTray) {
        return;
    }

    function noop() { }

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

    function create(context) {
        var safeContext = context || {};
        var selectionStore = safeContext.selectionStore;
        var getActiveTabId = typeof safeContext.getActiveTabId === 'function'
            ? safeContext.getActiveTabId
            : function () { return null; };
        var log = typeof safeContext.log === 'function' ? safeContext.log : noop;

        var refs = {};
        var draggingSlotIndex = null;
        var lastSnapshot = {
            functions: [],
            functionIds: []
        };

        function readRefs() {
            refs.tray = document.getElementById('call-path-tray');
            refs.chipList = document.getElementById('call-path-chip-list');
            refs.pathHint = document.getElementById('call-path-hint');
        }

        function shouldShowTray(snapshot) {
            var activeTabId = getActiveTabId();
            if (activeTabId !== 'relationGraph' && activeTabId !== 'callGraph') {
                return false;
            }

            return Array.isArray(snapshot.functions) && snapshot.functions.length > 0;
        }

        function getFunctions(snapshot) {
            if (Array.isArray(snapshot?.functions)) {
                return snapshot.functions;
            }
            if (Array.isArray(snapshot?.functionRefs)) {
                return snapshot.functionRefs;
            }
            if (Array.isArray(snapshot?.functionIds)) {
                return snapshot.functionIds.map(function (id) {
                    return {
                        id: String(id),
                        label: labelFromId(id),
                        meta: ''
                    };
                });
            }
            return [];
        }

        function renderChips(functions) {
            if (!refs.chipList) {
                return;
            }

            refs.chipList.textContent = '';
            functions.forEach(function (slot, index) {
                var chip = document.createElement('span');
                chip.className = 'call-path-chip';
                chip.draggable = true;
                chip.dataset.slotIndex = String(index);
                chip.title = [slot.id, slot.meta].filter(Boolean).join('\n');

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
                    draggingSlotIndex = index;
                    chip.classList.add('is-dragging');
                    if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', slot.id);
                    }
                });
                chip.addEventListener('dragend', function () {
                    chip.classList.remove('is-dragging');
                    draggingSlotIndex = null;
                });
                chip.addEventListener('dragover', function (event) {
                    event.preventDefault();
                    if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = 'move';
                    }
                });
                chip.addEventListener('drop', function (event) {
                    event.preventDefault();
                    if (Number.isInteger(draggingSlotIndex)
                        && selectionStore
                        && typeof selectionStore.move === 'function') {
                        selectionStore.move(draggingSlotIndex, index, 'tray-drag');
                    }
                });

                refs.chipList.appendChild(chip);
            });
        }

        function render(snapshot, reason) {
            if (!refs.tray) {
                readRefs();
            }

            lastSnapshot = snapshot || lastSnapshot;
            var functions = getFunctions(lastSnapshot);
            if (refs.tray) {
                refs.tray.hidden = !shouldShowTray({ functions: functions });
            }
            if (refs.pathHint) {
                refs.pathHint.textContent = functions.length > 0
                    ? functions.length + ' waypoint' + (functions.length === 1 ? '' : 's') + ' selected. Drag to reorder.'
                    : 'Add functions to define waypoint order.';
            }

            renderChips(functions);
            log('state', 'verbose', 'call path tray rendered', {
                reason: reason || 'render',
                functionCount: functions.length
            });
        }

        function bind() {
            readRefs();
            if (refs.chipList) {
                refs.chipList.addEventListener('click', function (event) {
                    var target = event.target;
                    var rawIndex = target && target.dataset ? target.dataset.slotRemoveIndex : null;
                    if (rawIndex === undefined || rawIndex === null) {
                        return;
                    }

                    var index = Number(rawIndex);
                    var functions = getFunctions(lastSnapshot);
                    if (Number.isInteger(index)
                        && functions[index]
                        && selectionStore
                        && typeof selectionStore.remove === 'function') {
                        selectionStore.remove(functions[index].id, 'tray-remove');
                    }
                });
            }

            if (selectionStore && typeof selectionStore.subscribe === 'function') {
                selectionStore.subscribe(function (snapshot, reason) {
                    render(snapshot, reason);
                });
            } else {
                render(lastSnapshot, 'bind-no-store');
            }
        }

        return {
            bind: bind,
            refresh: function () {
                render(selectionStore && typeof selectionStore.getSnapshot === 'function'
                    ? selectionStore.getSnapshot()
                    : lastSnapshot, 'refresh');
            }
        };
    }

    modules.CallPathTray = {
        create: create
    };
})();
