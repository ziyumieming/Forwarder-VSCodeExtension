(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CardEvents) {
        return;
    }

    var bound = false;
    var cleanupHandlers = [];
    var cardPointerState = null;
    var ignoreCardClickUntil = 0;

    function shouldIgnoreCardClick() {
        return Date.now() <= ignoreCardClickUntil;
    }

    function noop() { }

    function getClosest(target, selector) {
        if (!target || typeof target.closest !== 'function') {
            return null;
        }

        return target.closest(selector);
    }

    function addListener(documentRef, eventName, handler, options) {
        documentRef.addEventListener(eventName, handler, options);
        cleanupHandlers.push(function () {
            documentRef.removeEventListener(eventName, handler, options);
        });
    }

    function bind(options) {
        if (bound) {
            return false;
        }

        var safeOptions = options || {};
        var documentRef = safeOptions.documentRef || document;
        var onHeaderAction = typeof safeOptions.onHeaderAction === 'function' ? safeOptions.onHeaderAction : noop;
        var onSectionToggle = typeof safeOptions.onSectionToggle === 'function' ? safeOptions.onSectionToggle : noop;
        var onMemberClick = typeof safeOptions.onMemberClick === 'function' ? safeOptions.onMemberClick : noop;
        var onMemberHover = typeof safeOptions.onMemberHover === 'function' ? safeOptions.onMemberHover : noop;
        var onIgnoreClick = typeof safeOptions.onIgnoreClick === 'function' ? safeOptions.onIgnoreClick : noop;

        addListener(documentRef, 'pointerdown', function (event) {
            var cardRoot = getClosest(event.target, '.analysis-class-card');
            if (!cardRoot) {
                return;
            }

            cardPointerState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                moved: false
            };
        });

        addListener(documentRef, 'pointermove', function (event) {
            if (!cardPointerState || cardPointerState.pointerId !== event.pointerId) {
                return;
            }

            var dx = Math.abs(event.clientX - cardPointerState.startX);
            var dy = Math.abs(event.clientY - cardPointerState.startY);
            if (dx > 6 || dy > 6) {
                cardPointerState.moved = true;
            }
        });

        addListener(documentRef, 'pointerup', function (event) {
            if (!cardPointerState || cardPointerState.pointerId !== event.pointerId) {
                return;
            }

            if (cardPointerState.moved) {
                ignoreCardClickUntil = Date.now() + 220;
            }

            cardPointerState = null;
        });

        addListener(documentRef, 'pointercancel', function () {
            cardPointerState = null;
        });

        addListener(documentRef, 'wheel', function (event) {
            var sectionBody = getClosest(event.target, '.analysis-class-card-section-body');
            if (!sectionBody) {
                return;
            }

            var maxScrollTop = sectionBody.scrollHeight - sectionBody.clientHeight;
            if (maxScrollTop <= 0) {
                return;
            }

            var deltaY = event.deltaY || 0;
            var atTop = sectionBody.scrollTop <= 0;
            var atBottom = sectionBody.scrollTop >= maxScrollTop - 1;
            var canConsume = (deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom);

            if (!canConsume) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            sectionBody.scrollTop += deltaY;
        }, { passive: false });

        addListener(documentRef, 'mouseover', function (event) {
            var item = getClosest(event.target, '.analysis-class-card-member');
            if (!item) {
                return;
            }

            var related = event.relatedTarget;
            if (related && item.contains(related)) {
                return;
            }

            item.classList.add('is-hover');
            onMemberHover(item, 'enter', event);
        });

        addListener(documentRef, 'mouseout', function (event) {
            var item = getClosest(event.target, '.analysis-class-card-member');
            if (!item) {
                return;
            }

            var related = event.relatedTarget;
            if (related && item.contains(related)) {
                return;
            }

            item.classList.remove('is-hover');
            onMemberHover(item, 'leave', event);
        });

        addListener(documentRef, 'click', function (event) {
            var headerAction = getClosest(event.target, '.analysis-class-card-header-action');
            if (headerAction) {
                event.preventDefault();
                event.stopPropagation();

                if (shouldIgnoreCardClick()) {
                    onIgnoreClick('header', event);
                    return;
                }

                var headerNodeId = headerAction.dataset.nodeId;
                if (!headerNodeId) {
                    return;
                }

                onHeaderAction(headerNodeId, event);
                return;
            }

            var sectionToggle = getClosest(event.target, '.analysis-class-card-section-toggle');
            if (sectionToggle) {
                event.preventDefault();
                event.stopPropagation();

                if (shouldIgnoreCardClick()) {
                    onIgnoreClick('section', event);
                    return;
                }

                onSectionToggle(sectionToggle, event);
                return;
            }

            var item = getClosest(event.target, '.analysis-class-card-member');
            if (!item) {
                return;
            }

            if (shouldIgnoreCardClick()) {
                onIgnoreClick('member', event);
                return;
            }

            onMemberClick(item, event);
        });

        bound = true;
        return true;
    }

    function unbind() {
        if (!bound) {
            return false;
        }

        cleanupHandlers.forEach(function (cleanup) {
            cleanup();
        });

        cleanupHandlers = [];
        cardPointerState = null;
        ignoreCardClickUntil = 0;
        bound = false;
        return true;
    }

    modules.CardEvents = {
        bind: bind,
        unbind: unbind,
        isBound: function () {
            return bound;
        },
        shouldIgnoreCardClick: shouldIgnoreCardClick
    };
})();
