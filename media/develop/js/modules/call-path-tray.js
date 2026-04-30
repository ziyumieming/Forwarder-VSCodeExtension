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
        var onQueryPath = typeof safeContext.onQueryPath === 'function' ? safeContext.onQueryPath : noop;
        var onSetCenter = typeof safeContext.onSetCenter === 'function' ? safeContext.onSetCenter : noop;
        var log = typeof safeContext.log === 'function' ? safeContext.log : noop;

        var refs = {};
        var draggingSlotIndex = null;
        var contextSlotIndex = null;
        var lastSnapshot = {
            functions: [],
            functionIds: []
        };

        function readRefs() {
            refs.tray = document.getElementById('call-path-tray');
            refs.chipList = document.getElementById('call-path-chip-list');
            refs.pathHint = document.getElementById('call-path-hint');
            refs.pathQuery = document.getElementById('btn-call-tray-path-query');
            refs.clear = document.getElementById('btn-call-tray-clear');
            refs.chipMenu = document.getElementById('call-path-chip-menu');
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

        function hideChipMenu() {
            if (refs.chipMenu) {
                refs.chipMenu.hidden = true;
            }
            contextSlotIndex = null;
        }

        function showChipMenu(index, event) {
            if (!refs.chipMenu) {
                readRefs();
            }
            if (!refs.chipMenu) {
                return;
            }

            contextSlotIndex = index;
            refs.chipMenu.style.left = Math.max(12, Math.round(event.clientX || 120)) + 'px';
            refs.chipMenu.style.top = Math.max(72, Math.round(event.clientY || 120)) + 'px';
            refs.chipMenu.hidden = false;
        }

        function getDropIndex(event, functionsLength) {
            if (!refs.chipList) {
                return functionsLength - 1;
            }

            var chips = Array.prototype.slice.call(refs.chipList.querySelectorAll('.call-path-chip'));
            for (var i = 0; i < chips.length; i += 1) {
                var rect = chips[i].getBoundingClientRect();
                var midpoint = rect.left + rect.width / 2;
                if (event.clientY < rect.bottom && event.clientY > rect.top && event.clientX < midpoint) {
                    return i;
                }
            }

            return Math.max(0, functionsLength - 1);
        }

        function moveDraggingSlot(targetIndex, reason) {
            var functions = getFunctions(lastSnapshot);
            if (!Number.isInteger(draggingSlotIndex)
                || !Number.isInteger(targetIndex)
                || draggingSlotIndex === targetIndex
                || !functions[draggingSlotIndex]
                || !functions[targetIndex]
                || !selectionStore
                || typeof selectionStore.move !== 'function') {
                return;
            }

            selectionStore.move(draggingSlotIndex, targetIndex, reason || 'tray-drag');
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
                    document.body.classList.add('is-call-chip-dragging');
                    if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', slot.id);
                        try {
                            event.dataTransfer.setDragImage(chip, Math.min(24, chip.offsetWidth / 2), Math.min(12, chip.offsetHeight / 2));
                        } catch (error) {
                            // Some webview hosts ignore custom drag images.
                        }
                    }
                });
                chip.addEventListener('dragend', function () {
                    chip.classList.remove('is-dragging');
                    document.body.classList.remove('is-call-chip-dragging');
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
                    event.stopPropagation();
                    moveDraggingSlot(index, 'tray-chip-drop');
                });
                chip.addEventListener('contextmenu', function (event) {
                    event.preventDefault();
                    showChipMenu(index, event);
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
            if (refs.pathQuery) {
                refs.pathQuery.disabled = functions.length < 2;
                refs.pathQuery.title = functions.length < 2
                    ? 'Add at least two functions to query a call path'
                    : 'Query call path for ordered waypoints';
            }
            if (refs.clear) {
                refs.clear.disabled = functions.length === 0;
                refs.clear.title = functions.length === 0
                    ? 'No functions to clear'
                    : 'Clear path order';
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

            refs.chipList?.addEventListener('dragover', function (event) {
                event.preventDefault();
                refs.chipList.classList.add('is-drag-over');
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'move';
                }
            });
            refs.chipList?.addEventListener('dragleave', function (event) {
                if (!refs.chipList.contains(event.relatedTarget)) {
                    refs.chipList.classList.remove('is-drag-over');
                }
            });
            refs.chipList?.addEventListener('drop', function (event) {
                event.preventDefault();
                refs.chipList.classList.remove('is-drag-over');
                moveDraggingSlot(getDropIndex(event, getFunctions(lastSnapshot).length), 'tray-list-drop');
            });
            refs.pathQuery?.addEventListener('click', function () {
                onQueryPath('path-tray');
            });
            refs.clear?.addEventListener('click', function () {
                if (selectionStore && typeof selectionStore.clear === 'function') {
                    selectionStore.clear('tray-clear');
                }
            });
            refs.chipMenu?.addEventListener('click', function (event) {
                var action = event.target && event.target.dataset ? event.target.dataset.pathChipAction : null;
                var functions = getFunctions(lastSnapshot);
                var slot = Number.isInteger(contextSlotIndex) ? functions[contextSlotIndex] : null;
                hideChipMenu();
                if (!action || !slot) {
                    return;
                }

                if (action === 'center') {
                    onSetCenter(slot, 'path-tray-menu');
                    return;
                }

                if (action === 'remove'
                    && selectionStore
                    && typeof selectionStore.remove === 'function') {
                    selectionStore.remove(slot.id, 'tray-context-remove');
                }
            });
            document.addEventListener('click', function (event) {
                if (!refs.chipMenu || refs.chipMenu.hidden || refs.chipMenu.contains(event.target)) {
                    return;
                }
                hideChipMenu();
            });

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
