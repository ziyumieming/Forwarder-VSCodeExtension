(function () {
    const vscode = acquireVsCodeApi();
    let currentCenterNodeId = null;
    let pendingCenterDetailsNodeId = null;
    const centerDetailsCache = new Map();
    const classCardModelCache = new Map();
    let htmlNodePluginReady = false;
    let htmlNodePluginLoadPromise = null;
    let cardEventsBound = false;
    let htmlRendererInitialized = false;
    let nodeHtmlLabelInitialized = false;
    let htmlCardGeneration = 0;
    let lastRequestMode = 'global';
    let lastCenterNodeId = null;
    let debugEventId = 0;
    let querySequence = 0;
    const pendingQueryMap = new Map();
    let nodeHtmlLabelRenderCount = 0;
    let centerCardEnabled = false;
    let lastQueryRequest = null;
    const collapsedCardSections = new Set();
    let suppressNodeTapNodeId = null;
    let suppressNodeTapUntil = 0;
    const CENTER_LOCK_ZOOM = 1;
    const CENTER_OVERVIEW_ZOOM = 0.5;
    let cardPointerState = null;
    let ignoreCardClickUntil = 0;
    let latestGraphSnapshot = createEmptyGraphSnapshot();
    let nodeHtmlLabelInitCount = 0;
    let layoutAnimationToken = 0;

    const DEBUG_LEVELS = {
        off: 0,
        error: 1,
        info: 2,
        verbose: 3
    };

    function getDebugLevelName() {
        const level = (window.__analysisDebugLevel || 'info').toString().toLowerCase();
        return Object.prototype.hasOwnProperty.call(DEBUG_LEVELS, level) ? level : 'info';
    }

    function shouldLog(levelName) {
        const current = DEBUG_LEVELS[getDebugLevelName()];
        const required = DEBUG_LEVELS[levelName] ?? DEBUG_LEVELS.info;
        return current >= required;
    }

    function log(channel, level, message, payload) {
        if (!shouldLog(level)) {
            return;
        }

        const event = {
            eventId: ++debugEventId,
            ts: Date.now(),
            channel,
            level,
            message,
            ...payload
        };

        if (level === 'error') {
            console.error('[AnalysisView][ClassCard]', event);
            return;
        }

        if (level === 'verbose') {
            console.debug('[AnalysisView][ClassCard]', event);
            return;
        }

        console.info('[AnalysisView][ClassCard]', event);
    }

    function debug(...args) {
        log('general', 'info', args[0], { details: args[1] });
    }

    function debugWarn(...args) {
        log('general', 'error', args[0], { details: args[1] });
    }

    function createCyInstance() {
        return cytoscape({
            container: document.getElementById('cy'),
            elements: [],
            style: window.AnalysisStyle.getCytoscapeStyle(),
            layout: window.AnalysisStyle.getDefaultLayout()
        });
    }

    const cy = createCyInstance();
    window.__analysisDebug = { cy };

    function countNodesBy(predicate) {
        let count = 0;
        cy.nodes().forEach((node) => {
            if (predicate(node)) {
                count += 1;
            }
        });
        return count;
    }

    function getNodeModeLayoutOptions(options = {}) {
        const baseOptions = {
            ...window.AnalysisStyle.getDefaultLayout(),
            fit: options.fit ?? false,
            animate: options.animate ?? false
        };

        if (baseOptions.name !== 'cose') {
            return baseOptions;
        }

        const centerId = currentCenterNodeId ? String(currentCenterNodeId) : null;
        return {
            ...baseOptions,
            padding: Math.max(Number(baseOptions.padding || 0), 90),
            nodeOverlap: 26,
            componentSpacing: 120,
            gravity: 0.25,
            nodeRepulsion: (node) => {
                if (centerId && node.id() === centerId) {
                    return 2500000;
                }

                return 900000;
            },
            idealEdgeLength: (edge) => {
                const sourceId = edge.source().id();
                const targetId = edge.target().id();
                if (centerId && (sourceId === centerId || targetId === centerId)) {
                    return 240;
                }

                return 170;
            },
            edgeElasticity: (edge) => {
                const sourceId = edge.source().id();
                const targetId = edge.target().id();
                if (centerId && (sourceId === centerId || targetId === centerId)) {
                    return 48;
                }

                return 90;
            }
        };
    }

    function logStateSnapshot(reason, level = 'verbose') {
        log('state', level, 'snapshot', {
            reason,
            currentCenterNodeId,
            lastCenterNodeId,
            pendingCenterDetailsNodeId,
            lastRequestMode,
            centerCardEnabled,
            htmlNodePluginReady,
            htmlRendererInitialized,
            htmlCardGeneration,
            totalNodes: cy.nodes().length,
            totalEdges: cy.edges().length,
            centerClassCount: countNodesBy((node) => node.hasClass('center-class-card')),
            useHtmlCardCount: countNodesBy((node) => Number(node.data('useHtmlCard')) === 1),
            fadedCount: countNodesBy((node) => node.hasClass('faded')),
            focusCount: countNodesBy((node) => node.hasClass('focus')),
            wrapperCount: document.querySelectorAll('.analysis-html-node-wrapper').length
        });
    }

    function logVisibilitySample(reason) {
        const samples = [];
        let picked = 0;

        cy.nodes().forEach((node) => {
            if (picked >= 3) {
                return;
            }

            if (currentCenterNodeId && node.id() === currentCenterNodeId) {
                return;
            }

            const box = node.renderedBoundingBox();
            samples.push({
                id: node.id(),
                hasCenterClass: node.hasClass('center-class-card'),
                useHtmlCard: node.data('useHtmlCard'),
                width: Math.round((box.w || 0) * 100) / 100,
                height: Math.round((box.h || 0) * 100) / 100
            });
            picked += 1;
        });

        log('style', 'verbose', 'visibility sample', { reason, samples });

        const invalid = samples.filter((item) => item.width === 0 || item.height === 0);
        if (invalid.length > 0) {
            log('style', 'error', 'non-center nodes collapsed to zero size', {
                reason,
                invalid
            });
        }
    }

    function getHtmlNodePluginMode() {
        if (typeof cy.nodeHtmlLabel === 'function') {
            console.log('nodeHtmlLabel plugin detected');
            return 'nodeHtmlLabel';
        } if (typeof cy.htmlnode === 'function') {
            console.log('htmlnode plugin detected');
            return 'htmlnode';
        }
        return null;
    }

    log('state', 'info', 'bootstrap', {
        cyReady: !!cy,
        hasNodeHtmlLabel: typeof cy.nodeHtmlLabel === 'function',
        hasHtmlNodeApi: typeof cy.htmlnode === 'function',
        pluginMode: getHtmlNodePluginMode(),
        scriptCount: document.querySelectorAll('script[src]').length,
        debugLevel: getDebugLevelName()
    });

    function inferHtmlNodePluginUri() {
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        const cytoscapeScript = scripts.find((script) => script.src.includes('cytoscape.min.js'));

        debug('infer plugin uri', {
            cytoscapeScript: cytoscapeScript?.src || null,
            allScripts: scripts.map((script) => script.src)
        });

        if (!cytoscapeScript?.src) {
            debugWarn('cytoscape script not found when inferring plugin uri');
            return null;
        }

        return cytoscapeScript.src.replace('cytoscape.min.js', 'cytoscape-html-node.js');
    }

    function loadHtmlNodePlugin() {
        if (getHtmlNodePluginMode()) {
            htmlNodePluginReady = true;
            debug('plugin already ready before dynamic load', {
                pluginMode: getHtmlNodePluginMode()
            });
            return Promise.resolve(true);
        }

        if (htmlNodePluginLoadPromise) {
            debug('reuse existing plugin load promise');
            return htmlNodePluginLoadPromise;
        }

        const pluginUri = inferHtmlNodePluginUri();
        if (!pluginUri) {
            debugWarn('plugin uri inference failed, fallback to text card mode');
            return Promise.resolve(false);
        }

        debug('start dynamic plugin load', { pluginUri });

        htmlNodePluginLoadPromise = new Promise((resolve) => {
            const script = document.createElement('script');
            const nonceSource = document.querySelector('script[nonce]');

            if (nonceSource?.nonce) {
                script.nonce = nonceSource.nonce;
            }

            script.src = pluginUri;
            script.onload = () => {
                htmlNodePluginReady = !!getHtmlNodePluginMode();
                debug('dynamic plugin loaded', {
                    pluginUri,
                    hasNodeHtmlLabel: typeof cy.nodeHtmlLabel === 'function',
                    hasHtmlNodeApi: typeof cy.htmlnode === 'function',
                    pluginMode: getHtmlNodePluginMode()
                });
                resolve(htmlNodePluginReady);
            };
            script.onerror = () => {
                htmlNodePluginReady = false;
                debugWarn('dynamic plugin load failed', { pluginUri });
                resolve(false);
            };

            document.body.appendChild(script);
        });

        return htmlNodePluginLoadPromise;
    }

    function resetFocus() {
        cy.elements().removeClass('faded focus');
        cy.fit(undefined, 70);
    }

    function getClassCardOptions() {
        if (typeof window.AnalysisUI?.getClassCardOptions === 'function') {
            return window.AnalysisUI.getClassCardOptions();
        }

        return {
            showFields: true,
            showMethods: true,
            collapsedSections: []
        };
    }

    function toStringList(source) {
        if (!Array.isArray(source)) {
            return [];
        }

        return source
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                if (item && typeof item === 'object') {
                    return item.signature || item.displayName || item.name || item.label || '';
                }

                return '';
            })
            .map((text) => String(text).trim())
            .filter((text) => text.length > 0);
    }

    function readClassCardFromNode(node) {
        const classCard = node?.classCard || {};
        const title = classCard.title || node.displayName || node.name || node.label || String(node.id);

        const fields = toStringList(classCard.fields || node.fields || node.properties || []);
        const methods = toStringList(classCard.methods || node.methods || []);

        return {
            title: String(title),
            fields,
            methods
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

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(text) {
        return escapeHtml(text).replace(/\s+/g, ' ').trim();
    }

    function buildClassMemberRow(nodeId, memberKind, member, index) {
        const rawText = typeof member === 'string'
            ? member
            : (member?.signature || member?.displayName || member?.name || member?.label || '');

        const memberLabel = String(rawText).trim();
        const memberId = String(member?.id || `${nodeId}:${memberKind}:${index}`);

        return `<button class="analysis-class-card-member" data-node-id="${escapeAttr(nodeId)}" data-member-kind="${escapeAttr(memberKind)}" data-member-id="${escapeAttr(memberId)}" data-member-label="${escapeAttr(memberLabel)}">${escapeHtml(memberLabel || '(unknown)')}</button>`;
    }

    function isCardSectionCollapsed(sectionName) {
        return collapsedCardSections.has(sectionName);
    }

    function buildCardSection(nodeId, sectionName, title, rowsHtml) {
        const collapsed = isCardSectionCollapsed(sectionName);
        const collapsedClass = collapsed ? ' is-collapsed' : '';
        const expandedText = collapsed ? 'false' : 'true';
        const caret = collapsed ? '&#9656;' : '&#9662;';

        return `<div class="analysis-class-card-section${collapsedClass}" data-card-section="${escapeAttr(sectionName)}"><button type="button" class="analysis-class-card-section-title analysis-class-card-section-toggle" data-node-id="${escapeAttr(nodeId)}" data-card-section="${escapeAttr(sectionName)}" aria-expanded="${expandedText}"><span class="analysis-class-card-caret" aria-hidden="true">${caret}</span><span class="analysis-class-card-title-text">${escapeHtml(title)}</span></button><div class="analysis-class-card-section-body">${rowsHtml}</div></div>`;
    }

    function buildHtmlClassCard(nodeId, classCard) {
        const options = getClassCardOptions();
        (options.collapsedSections || []).forEach((section) => {
            collapsedCardSections.add(String(section));
        });

        const title = escapeHtml(classCard.title || nodeId);
        const fields = classCard.fields || [];
        const methods = classCard.methods || [];

        const fieldRows = fields.length > 0
            ? fields.map((field, index) => buildClassMemberRow(nodeId, 'field', field, index)).join('')
            : '<div class="analysis-class-card-empty">No fields</div>';

        const methodRows = methods.length > 0
            ? methods.map((method, index) => buildClassMemberRow(nodeId, 'method', method, index)).join('')
            : '<div class="analysis-class-card-empty">No methods</div>';

        const fieldSection = buildCardSection(nodeId, 'fields', 'Fields', fieldRows);
        const methodSection = buildCardSection(nodeId, 'methods', 'Methods', methodRows);

        return `<div id="htmlLabel:${escapeAttr(nodeId)}" class="analysis-class-card" data-node-id="${escapeAttr(nodeId)}"><div class="analysis-class-card-header"><button type="button" class="analysis-class-card-header-action" data-card-action="refresh-center" data-node-id="${escapeAttr(nodeId)}">${title}</button></div>${fieldSection}${methodSection}</div>`;
    }

    function dispatchCardCommand(command, payload) {
        vscode.postMessage({
            command,
            ...payload
        });
    }

    function sendQuery(command, payload) {
        try {
            const queryId = `${Date.now()}-${++querySequence}`;
            pendingQueryMap.set(queryId, {
                command,
                payload,
                ts: Date.now()
            });

            vscode.postMessage({
                command,
                ...payload,
                __queryId: queryId
            });

            log('query', 'info', 'query sent', {
                queryId,
                command,
                payload
            });
        } catch (error) {
            log('query', 'error', 'query send failed', { command, error });
        }
    }

    function rememberLastQuery(command, payload, source) {
        lastQueryRequest = {
            command,
            payload: { ...payload },
            source,
            ts: Date.now()
        };

        log('query', 'verbose', 'remember last query', {
            command,
            source,
            payload
        });
    }

    function replayLastQuery(source) {
        if (!lastQueryRequest) {
            log('query', 'info', 'replay last query fallback to global', { source });
            requestGlobalRelation(source);
            return;
        }

        log('query', 'info', 'replay last query', {
            source,
            lastCommand: lastQueryRequest.command,
            lastPayload: lastQueryRequest.payload,
            lastSource: lastQueryRequest.source
        });

        if (lastQueryRequest.command === 'queryNodeDependencies') {
            const replayNodeId = String(
                lastQueryRequest.payload?.nodeId || currentCenterNodeId || pendingCenterDetailsNodeId || ''
            );

            if (!replayNodeId) {
                requestGlobalRelation(`${source}:node-replay-fallback`);
                return;
            }

            centerCardEnabled = false;
            applyCenterCardPresentation();
            resetFocus();

            requestNodeDependencies(replayNodeId, source, {
                payloadOverride: {
                    ...lastQueryRequest.payload,
                    nodeId: replayNodeId
                },
                enableCenterCard: false,
                setAsCenterNode: true
            });
            return;
        }

        requestGlobalRelation(source, {
            payloadOverride: { ...lastQueryRequest.payload }
        });
        resetFocus();
    }

    function buildHtmlDataByNodeId() {
        const htmlDataByNodeId = new Map();
        const shouldBuildCenterCard = !!currentCenterNodeId && centerCardEnabled;

        cy.nodes().forEach((node) => {
            const nodeId = String(node.id());

            if (!shouldBuildCenterCard || nodeId !== currentCenterNodeId) {
                return;
            }

            const classCard = centerDetailsCache.get(nodeId)
                || classCardModelCache.get(nodeId)
                || createLoadingClassCard(nodeId);

            htmlDataByNodeId.set(nodeId, buildHtmlClassCard(nodeId, classCard));
        });

        return htmlDataByNodeId;
    }

    function applyHtmlMarkupToNodes(htmlDataByNodeId) {
        cy.nodes().forEach((node) => {
            const nodeId = String(node.id());
            node.data('htmlCardMarkup', htmlDataByNodeId.get(nodeId) || '');
        });
    }

    function shouldIgnoreCardClick() {
        return Date.now() <= ignoreCardClickUntil;
    }

    function resolveCenterViewportZoom(options = {}) {
        const requestedZoom = Number(options.targetZoom);
        if (Number.isFinite(requestedZoom) && requestedZoom > 0) {
            return requestedZoom;
        }

        return centerCardEnabled ? CENTER_LOCK_ZOOM : CENTER_OVERVIEW_ZOOM;
    }

    function lockCenterNodeViewport(reason, options = {}) {
        if (!currentCenterNodeId || lastRequestMode !== 'node') {
            return;
        }

        const centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0) {
            return;
        }

        const centerPos = centerNode.position();
        const zoom = resolveCenterViewportZoom(options);
        const pan = {
            x: cy.width() / 2 - centerPos.x * zoom,
            y: cy.height() / 2 - centerPos.y * zoom
        };

        cy.zoom(zoom);
        cy.pan(pan);

        log('state', 'verbose', 'lock center viewport', {
            reason,
            currentCenterNodeId,
            zoom,
            pan
        });
    }

    function animateCenterNodeViewport(reason, options = {}) {
        if (!currentCenterNodeId || lastRequestMode !== 'node') {
            return false;
        }

        const animationToken = options.animationToken;
        if (typeof animationToken === 'number' && animationToken !== layoutAnimationToken) {
            return false;
        }

        const centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0) {
            return false;
        }

        const zoom = resolveCenterViewportZoom(options);
        const centerPos = centerNode.position();
        const pan = {
            x: cy.width() / 2 - centerPos.x * zoom,
            y: cy.height() / 2 - centerPos.y * zoom
        };

        const animation = cy.animation({
            zoom,
            pan,
            duration: options.duration ?? 320,
            easing: options.easing || 'ease-out-cubic'
        });

        animation.play();

        log('state', 'verbose', 'animate center viewport', {
            reason,
            currentCenterNodeId,
            zoom,
            pan,
            duration: options.duration ?? 320
        });

        return true;
    }

    function toggleCenterNodePresentation(source) {
        if (lastRequestMode !== 'node') {
            return false;
        }

        if (!currentCenterNodeId) {
            return false;
        }

        const centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0 || !centerNode.isNode()) {
            return false;
        }

        const centerNodeId = String(centerNode.id());
        centerCardEnabled = !centerCardEnabled;
        applyCenterCardPresentation();

        if (!centerCardEnabled) {
            clearNodeBypassSize(centerNode);
            setTimeout(() => {
                if (centerCardEnabled || currentCenterNodeId !== centerNodeId) {
                    return;
                }

                const centerNodeAfterToggle = cy.getElementById(centerNodeId);
                if (!centerNodeAfterToggle || centerNodeAfterToggle.length === 0 || !centerNodeAfterToggle.isNode()) {
                    return;
                }

                clearNodeBypassSize(centerNodeAfterToggle);
            }, 0);
        }

        const targetZoom = centerCardEnabled ? CENTER_LOCK_ZOOM : CENTER_OVERVIEW_ZOOM;
        if (!animateCenterNodeViewport(`toggle-center-presentation:${source}`, {
            duration: 300,
            targetZoom
        })) {
            lockCenterNodeViewport(`toggle-center-presentation:${source}`, { targetZoom });
        }

        log('state', 'info', 'toggle center presentation', {
            source,
            currentCenterNodeId,
            centerCardEnabled,
            targetZoom
        });

        return true;
    }

    function normalizeHtmlCardDom(reason, options = {}) {
        const cards = Array.from(document.querySelectorAll('.analysis-class-card[data-node-id]'));
        if (cards.length === 0) {
            return;
        }

        const activeNodeIds = options.activeNodeIds instanceof Set
            ? options.activeNodeIds
            : null;

        const groupByNodeId = new Map();
        cards.forEach((card) => {
            const nodeId = String(card.getAttribute('data-node-id') || '').trim();
            if (!nodeId) {
                return;
            }

            if (!groupByNodeId.has(nodeId)) {
                groupByNodeId.set(nodeId, []);
            }
            groupByNodeId.get(nodeId).push(card);
        });

        let hiddenCount = 0;
        let inactiveHiddenCount = 0;
        groupByNodeId.forEach((group) => {
            const nodeId = String(group[0]?.getAttribute('data-node-id') || '').trim();
            const shouldShowGroup = !activeNodeIds || activeNodeIds.has(nodeId);

            group.forEach((card) => {
                card.classList.remove('analysis-class-card-hidden');
            });

            if (!shouldShowGroup) {
                group.forEach((card) => {
                    card.classList.add('analysis-class-card-hidden');
                    hiddenCount += 1;
                    inactiveHiddenCount += 1;
                });
                return;
            }

            if (group.length <= 1) {
                return;
            }

            for (let index = 0; index < group.length - 1; index += 1) {
                group[index].classList.add('analysis-class-card-hidden');
                hiddenCount += 1;
            }
        });

        if (hiddenCount > 0) {
            log('renderer', 'info', 'duplicate center cards normalized', {
                reason,
                hiddenCount,
                inactiveHiddenCount,
                totalCards: cards.length,
                groupCount: groupByNodeId.size
            });
        }
    }

    function clearTransientInteractionClasses(reason) {
        const fadedCount = cy.elements('.faded').length;
        const focusCount = cy.elements('.focus').length;

        if (fadedCount === 0 && focusCount === 0) {
            return;
        }

        cy.elements().removeClass('faded focus');
        log('state', 'verbose', 'clear transient interaction classes', {
            reason,
            fadedCount,
            focusCount
        });
    }

    function runNodeStaggerEnterLayout(incrementalResult, animationToken) {
        if (lastRequestMode !== 'node' || !currentCenterNodeId) {
            return false;
        }

        const centerNode = cy.getElementById(currentCenterNodeId);
        if (!centerNode || centerNode.length === 0) {
            return false;
        }

        const enteringNodeIds = Array.from(new Set([
            ...(incrementalResult?.addedNodeIds || []),
            ...(incrementalResult?.replacedNodeIds || [])
        ]))
            .map((nodeId) => String(nodeId))
            .filter((nodeId) => nodeId !== String(currentCenterNodeId));

        if (enteringNodeIds.length === 0) {
            return false;
        }

        const centerPosition = {
            x: centerNode.position('x'),
            y: centerNode.position('y')
        };

        const layoutOptions = getNodeModeLayoutOptions({
            fit: false,
            animate: false
        });

        centerNode.lock();

        cy.one('layoutstop', () => {
            if (animationToken !== layoutAnimationToken) {
                centerNode.unlock();
                return;
            }

            const targets = [];

            enteringNodeIds.forEach((nodeId) => {
                const node = cy.getElementById(nodeId);
                if (!node || node.length === 0 || !node.isNode()) {
                    return;
                }

                targets.push({
                    node,
                    target: {
                        x: node.position('x'),
                        y: node.position('y')
                    }
                });
            });

            targets.forEach(({ node }) => {
                node.position(centerPosition);
                node.style('opacity', 0);
            });

            const staggerDelay = 80;
            const moveDuration = 340;
            const totalDelay = (targets.length > 0 ? (targets.length - 1) * staggerDelay : 0) + moveDuration + 30;

            targets.forEach(({ node, target }, index) => {
                setTimeout(() => {
                    if (animationToken !== layoutAnimationToken) {
                        return;
                    }

                    const animation = node.animation({
                        position: target,
                        style: { opacity: 1 },
                        duration: moveDuration,
                        easing: 'ease-out-cubic'
                    });

                    animation.play();
                    animation.promise('completed').then(() => {
                        try {
                            node.removeStyle('opacity');
                        } catch (error) {
                            debugWarn('remove opacity style failed after stagger animation', {
                                nodeId: node.id?.(),
                                error
                            });
                        }
                    });
                }, index * staggerDelay);
            });

            setTimeout(() => {
                if (animationToken !== layoutAnimationToken) {
                    return;
                }

                centerNode.unlock();
                animateCenterNodeViewport('node-stagger-enter-complete', {
                    duration: 360,
                    animationToken
                });
            }, totalDelay);

            log('renderer', 'info', 'node stagger enter animation applied', {
                centerNodeId: currentCenterNodeId,
                enteringNodeCount: targets.length,
                staggerDelay,
                moveDuration
            });
        });

        cy.layout(layoutOptions).run();
        return true;
    }

    function runGlobalSmoothLayout(animationToken) {
        const nodes = cy.nodes();
        const edges = cy.edges();

        if (nodes.length === 0) {
            return false;
        }

        nodes.style('opacity', 0);
        edges.style('opacity', 0);

        const layoutOptions = {
            ...window.AnalysisStyle.getDefaultLayout(),
            animate: false,
            fit: true
        };

        cy.one('layoutstop', () => {
            if (animationToken !== layoutAnimationToken) {
                return;
            }

            const viewportCenterX = cy.width() / 2;
            const viewportCenterY = cy.height() / 2;
            const orderedNodes = nodes.toArray().sort((left, right) => {
                const leftPos = left.renderedPosition();
                const rightPos = right.renderedPosition();

                const leftDistance = Math.hypot(leftPos.x - viewportCenterX, leftPos.y - viewportCenterY);
                const rightDistance = Math.hypot(rightPos.x - viewportCenterX, rightPos.y - viewportCenterY);

                return leftDistance - rightDistance;
            });

            const staggerDelay = 16;
            const nodeDuration = 220;
            const edgeDuration = 200;
            const maxStaggerSteps = 56;

            orderedNodes.forEach((node, index) => {
                const delay = Math.min(index, maxStaggerSteps) * staggerDelay;

                setTimeout(() => {
                    if (animationToken !== layoutAnimationToken) {
                        return;
                    }

                    const animation = node.animation({
                        style: { opacity: 1 },
                        duration: nodeDuration,
                        easing: 'ease-out-cubic'
                    });

                    animation.play();
                    animation.promise('completed').then(() => {
                        try {
                            node.removeStyle('opacity');
                        } catch (error) {
                            debugWarn('remove opacity style failed after global reveal animation', {
                                nodeId: node.id?.(),
                                error
                            });
                        }
                    });
                }, delay);
            });

            const lastDelay = Math.min(orderedNodes.length, maxStaggerSteps) * staggerDelay;
            setTimeout(() => {
                if (animationToken !== layoutAnimationToken) {
                    return;
                }

                const edgeAnimation = edges.animation({
                    style: { opacity: 1 },
                    duration: edgeDuration,
                    easing: 'ease-out'
                });

                edgeAnimation.play();
                edgeAnimation.promise('completed').then(() => {
                    try {
                        edges.removeStyle('opacity');
                    } catch (error) {
                        debugWarn('remove edge opacity style failed after global reveal animation', { error });
                    }
                });
            }, Math.max(80, Math.floor(lastDelay * 0.5)));

            log('renderer', 'info', 'global smooth reveal animation applied', {
                nodeCount: orderedNodes.length,
                edgeCount: edges.length,
                staggerDelay,
                nodeDuration,
                edgeDuration
            });
        });

        cy.layout(layoutOptions).run();
        return true;
    }

    function clearNodeBypassSize(node) {
        if (!node) {
            return;
        }

        const styleKeys = ['width', 'height'];
        const removedStyleKeys = [];

        styleKeys.forEach((styleKey) => {
            try {
                node.removeStyle(styleKey);
                removedStyleKeys.push(styleKey);
            } catch (error) {
                debugWarn('removeStyle failed', { styleKey, nodeId: node.id?.(), error });
            }
        });

        log('style', 'verbose', 'clear node bypass size', {
            nodeId: typeof node.id === 'function' ? node.id() : null,
            removedStyleKeys
        });
    }

    function setCenterNode(nodeId, reason) {
        const normalizedId = nodeId ? String(nodeId) : null;
        const changed = currentCenterNodeId !== normalizedId;

        if (changed) {
            lastCenterNodeId = currentCenterNodeId;
            currentCenterNodeId = normalizedId;
        }

        log('state', 'info', 'center node set', {
            reason,
            previousCenterNodeId: lastCenterNodeId,
            currentCenterNodeId,
            changed
        });

        logStateSnapshot(`setCenterNode:${reason}`);

        return changed;
    }

    function initHtmlNodeRenderer() {
        if (htmlRendererInitialized) {
            return true;
        }

        const htmlNodeApi = cy.htmlnode?.();
        if (!htmlNodeApi || typeof htmlNodeApi.createHtmlNode !== 'function') {
            debugWarn('htmlnode api unavailable during init');
            return false;
        }

        try {
            htmlNodeApi.createHtmlNode(cytoscape, cy, [
                {
                    query: 'node.center-class-card[useHtmlCard = 1]',
                    staticZoomLevel: 1,
                    template: [
                        {
                            zoomRange: [0, Number.MAX_SAFE_INTEGER],
                            template: {
                                cssClass: 'analysis-html-node-wrapper',
                                html: '#{data.htmlCardMarkup}'
                            }
                        }
                    ]
                }
            ]);

            htmlRendererInitialized = true;
            log('renderer', 'info', 'htmlnode renderer initialized', {
                querySelector: 'node.center-class-card[useHtmlCard = 1]',
                wrapperCount: document.querySelectorAll('.analysis-html-node-wrapper').length
            });
            return true;
        } catch (error) {
            debugWarn('htmlnode renderer init failed', error);
            return false;
        }
    }

    function ensureNodeHtmlLabelRenderer() {
        if (nodeHtmlLabelInitialized) {
            return true;
        }

        if (typeof cy.nodeHtmlLabel !== 'function') {
            debugWarn('nodeHtmlLabel api unavailable during init');
            return false;
        }

        try {
            cy.nodeHtmlLabel(
                [
                    {
                        query: 'node.center-class-card[useHtmlCard = 1]',
                        halign: 'center',
                        valign: 'center',
                        halignBox: 'center',
                        valignBox: 'center',
                        cssClass: 'analysis-html-node-wrapper',
                        tpl: (nodeData) => String(nodeData?.htmlCardMarkup || '')
                    }
                ],
                [{ staticZoomLevel: 1 }],
                { enablePointerEvents: true }
            );

            nodeHtmlLabelInitialized = true;
            nodeHtmlLabelInitCount += 1;

            log('renderer', 'info', 'nodeHtmlLabel renderer initialized', {
                nodeHtmlLabelInitCount,
                wrapperCount: document.querySelectorAll('.analysis-html-node-wrapper').length
            });

            return true;
        } catch (error) {
            debugWarn('nodeHtmlLabel renderer init failed', error);
            return false;
        }
    }

    function refreshHtmlCards(pluginMode) {
        const htmlDataByNodeId = buildHtmlDataByNodeId();
        const activeCardNodeIds = new Set(htmlDataByNodeId.keys());
        const hasActiveCenterCard = !!currentCenterNodeId && centerCardEnabled;
        applyHtmlMarkupToNodes(htmlDataByNodeId);
        htmlCardGeneration += 1;

        log('renderer', 'verbose', 'refresh html cards', {
            pluginMode,
            htmlCardGeneration,
            currentCenterNodeId,
            hasActiveCenterCard,
            centerCardEnabled,
            markupNodeCount: htmlDataByNodeId.size
        });

        if (pluginMode === 'nodeHtmlLabel') {
            if (!hasActiveCenterCard) {
                log('renderer', 'verbose', 'skip nodeHtmlLabel render without active center card', {
                    htmlCardGeneration,
                    nodeHtmlLabelRenderCount,
                    currentCenterNodeId,
                    centerCardEnabled
                });

                if (currentCenterNodeId) {
                    const centerNode = cy.getElementById(currentCenterNodeId);
                    if (centerNode && centerNode.length > 0 && centerNode.isNode()) {
                        clearNodeBypassSize(centerNode);
                    }
                }

                setTimeout(() => {
                    normalizeHtmlCardDom('nodeHtmlLabel-refresh:no-center', {
                        activeNodeIds: activeCardNodeIds
                    });
                }, 0);
                return true;
            }

            if (!ensureNodeHtmlLabelRenderer()) {
                return false;
            }

            nodeHtmlLabelRenderCount += 1;
            cy.emit('render');
            setTimeout(() => {
                normalizeHtmlCardDom('nodeHtmlLabel-refresh', {
                    activeNodeIds: activeCardNodeIds
                });
            }, 0);

            debug('html cards refreshed (nodeHtmlLabel)', {
                generation: htmlCardGeneration,
                nodeHtmlLabelRenderCount,
                currentCenterNodeId,
                wrappers: document.querySelectorAll('.analysis-html-node-wrapper').length
            });
            return true;
        }

        if (!hasActiveCenterCard) {
            if (currentCenterNodeId) {
                const centerNode = cy.getElementById(currentCenterNodeId);
                if (centerNode && centerNode.length > 0 && centerNode.isNode()) {
                    clearNodeBypassSize(centerNode);
                }
            }

            setTimeout(() => {
                normalizeHtmlCardDom('htmlnode-refresh:no-center', {
                    activeNodeIds: activeCardNodeIds
                });
            }, 0);
            debug('html cards refreshed (htmlnode): no active center card, cleaned up renderer');
            return true;
        }

        if (!initHtmlNodeRenderer()) {
            return false;
        }

        // htmlnode 插件通过 zoom 事件更新模板内容，这里主动触发一次刷新。
        cy.emit('zoom');
        setTimeout(() => {
            normalizeHtmlCardDom('htmlnode-refresh', {
                activeNodeIds: activeCardNodeIds
            });
        }, 0);

        debug('html cards refreshed (htmlnode)', {
            generation: htmlCardGeneration,
            wrappers: document.querySelectorAll('.analysis-html-node-wrapper').length
        });
        return true;
    }

    function bindClassCardEvents() {
        if (cardEventsBound) {
            return;
        }

        debug('bind class card delegated events');

        document.addEventListener('pointerdown', (event) => {
            const cardRoot = event.target.closest('.analysis-class-card');
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

        document.addEventListener('pointermove', (event) => {
            if (!cardPointerState || cardPointerState.pointerId !== event.pointerId) {
                return;
            }

            const dx = Math.abs(event.clientX - cardPointerState.startX);
            const dy = Math.abs(event.clientY - cardPointerState.startY);
            if (dx > 6 || dy > 6) {
                cardPointerState.moved = true;
            }
        });

        document.addEventListener('pointerup', (event) => {
            if (!cardPointerState || cardPointerState.pointerId !== event.pointerId) {
                return;
            }

            if (cardPointerState.moved) {
                ignoreCardClickUntil = Date.now() + 220;
            }

            cardPointerState = null;
        });

        document.addEventListener('pointercancel', () => {
            cardPointerState = null;
        });

        document.addEventListener('wheel', (event) => {
            const sectionBody = event.target.closest('.analysis-class-card-section-body');
            if (!sectionBody) {
                return;
            }

            const maxScrollTop = sectionBody.scrollHeight - sectionBody.clientHeight;
            if (maxScrollTop <= 0) {
                return;
            }

            const deltaY = event.deltaY || 0;
            const atTop = sectionBody.scrollTop <= 0;
            const atBottom = sectionBody.scrollTop >= maxScrollTop - 1;
            const canConsume = (deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom);

            if (!canConsume) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            sectionBody.scrollTop += deltaY;
        }, { passive: false });

        document.addEventListener('mouseover', (event) => {
            const item = event.target.closest('.analysis-class-card-member');
            if (!item) {
                return;
            }

            const related = event.relatedTarget;
            if (related && item.contains(related)) {
                return;
            }

            item.classList.add('is-hover');

            dispatchCardCommand('classCardMemberHover', {
                nodeId: item.dataset.nodeId,
                memberKind: item.dataset.memberKind,
                memberId: item.dataset.memberId,
                memberLabel: item.dataset.memberLabel,
                phase: 'enter'
            });
        });

        document.addEventListener('mouseout', (event) => {
            const item = event.target.closest('.analysis-class-card-member');
            if (!item) {
                return;
            }

            const related = event.relatedTarget;
            if (related && item.contains(related)) {
                return;
            }

            item.classList.remove('is-hover');

            dispatchCardCommand('classCardMemberHover', {
                nodeId: item.dataset.nodeId,
                memberKind: item.dataset.memberKind,
                memberId: item.dataset.memberId,
                memberLabel: item.dataset.memberLabel,
                phase: 'leave'
            });
        });

        document.addEventListener('click', (event) => {
            const headerAction = event.target.closest('.analysis-class-card-header-action');
            if (headerAction) {
                event.preventDefault();
                event.stopPropagation();

                if (shouldIgnoreCardClick()) {
                    log('state', 'verbose', 'ignore header action click after drag', {});
                    return;
                }

                const nodeId = headerAction.dataset.nodeId;
                if (!nodeId) {
                    return;
                }

                suppressNodeTapNodeId = String(nodeId);
                suppressNodeTapUntil = Date.now() + 300;

                requestNodeDependencies(nodeId, 'card-header-refresh', {
                    enableCenterCard: true,
                    setAsCenterNode: true
                });
                return;
            }

            const sectionToggle = event.target.closest('.analysis-class-card-section-toggle');
            if (sectionToggle) {
                event.preventDefault();
                event.stopPropagation();

                if (shouldIgnoreCardClick()) {
                    log('state', 'verbose', 'ignore section toggle click after drag', {});
                    return;
                }

                const sectionName = sectionToggle.dataset.cardSection;
                if (!sectionName) {
                    return;
                }

                const sectionRoot = sectionToggle.closest('.analysis-class-card-section');
                if (!sectionRoot) {
                    return;
                }

                const willCollapse = !sectionRoot.classList.contains('is-collapsed');
                sectionRoot.classList.toggle('is-collapsed', willCollapse);
                sectionToggle.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');

                const caret = sectionToggle.querySelector('.analysis-class-card-caret');
                if (caret) {
                    caret.innerHTML = willCollapse ? '&#9656;' : '&#9662;';
                }

                if (willCollapse) {
                    collapsedCardSections.add(sectionName);
                } else {
                    collapsedCardSections.delete(sectionName);
                }

                return;
            }

            const item = event.target.closest('.analysis-class-card-member');
            if (!item) {
                return;
            }

            if (shouldIgnoreCardClick()) {
                log('state', 'verbose', 'ignore member click after drag', {});
                return;
            }

            dispatchCardCommand('classCardMemberClick', {
                nodeId: item.dataset.nodeId,
                memberKind: item.dataset.memberKind,
                memberId: item.dataset.memberId,
                memberLabel: item.dataset.memberLabel
            });
        });

        cardEventsBound = true;
    }

    function renderHtmlNodeCards() {
        const pluginMode = getHtmlNodePluginMode();
        if (!htmlNodePluginReady || !pluginMode) {
            debugWarn('skip html card render, plugin unavailable', {
                htmlNodePluginReady,
                hasNodeHtmlLabel: typeof cy.nodeHtmlLabel === 'function',
                hasHtmlNodeApi: typeof cy.htmlnode === 'function',
                pluginMode
            });
            return false;
        }

        debug('render html node cards', {
            pluginMode,
            currentCenterNodeId,
            nodeCount: cy.nodes().length,
            cachedCenterDetails: centerDetailsCache.size
        });

        const refreshed = refreshHtmlCards(pluginMode);
        if (refreshed) {
            bindClassCardEvents();
        }
        return refreshed;
    }

    function createLoadingClassCard(nodeId) {
        return {
            nodeId: String(nodeId),
            title: String(nodeId),
            fields: ['loading fields...'],
            methods: ['loading methods...']
        };
    }

    function resolveClassCardForNode(node, incomingCenterDetails) {
        const nodeId = String(node.id);

        if (incomingCenterDetails && String(incomingCenterDetails.nodeId) === nodeId) {
            return incomingCenterDetails;
        }

        const cached = centerDetailsCache.get(nodeId);
        if (cached) {
            return cached;
        }

        if (pendingCenterDetailsNodeId && pendingCenterDetailsNodeId === nodeId) {
            return createLoadingClassCard(nodeId);
        }

        return readClassCardFromNode(node);
    }

    function buildClassCardLabel(classCard) {
        const options = getClassCardOptions();
        const collapsed = new Set(options.collapsedSections || []);

        const lines = [classCard.title, '----------------'];

        if (options.showFields && !collapsed.has('fields')) {
            if (classCard.fields.length > 0) {
                lines.push(...classCard.fields.map((field) => `+ ${field}`));
            } else {
                lines.push('(no fields)');
            }
        } else {
            lines.push('(fields collapsed)');
        }

        lines.push('----------------');

        if (options.showMethods && !collapsed.has('methods')) {
            if (classCard.methods.length > 0) {
                lines.push(...classCard.methods.map((method) => `# ${method}`));
            } else {
                lines.push('(no methods)');
            }
        } else {
            lines.push('(methods collapsed)');
        }

        return lines.join('\n');
    }

    function estimateCardSize(classCard) {
        const visibleFieldRows = Math.min(classCard.fields.length, 5);
        const visibleMethodRows = Math.min(classCard.methods.length, 5);

        const fieldRows = Math.max(visibleFieldRows, 1);
        const methodRows = Math.max(visibleMethodRows, 1);

        const headerHeight = 44;
        const sectionTitleHeight = 24;
        const rowHeight = 29;
        const sectionPadding = 16;

        const estimatedHeight = headerHeight
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

    function applyCenterCardPresentation(options = {}) {
        let centerCount = 0;
        let htmlCardCount = 0;
        const skipHtmlRender = options.skipHtmlRender === true;
        const shouldUseCenterCard = !!currentCenterNodeId && centerCardEnabled;

        cy.nodes().forEach((node) => {
            const isCenterCard = shouldUseCenterCard && node.id() === currentCenterNodeId;
            const useHtmlCard = isCenterCard && htmlNodePluginReady;

            if (isCenterCard) {
                centerCount += 1;
            }
            if (useHtmlCard) {
                htmlCardCount += 1;
            }

            node.data('isCenterClassCard', isCenterCard ? 1 : 0);
            node.data('useHtmlCard', useHtmlCard ? 1 : 0);
            node.data('label', isCenterCard && !useHtmlCard ? node.data('classCardLabel') : node.data('baseLabel'));

            if (isCenterCard) {
                node.addClass('center-class-card');
            } else {
                node.removeClass('center-class-card');
                clearNodeBypassSize(node);
            }
        });

        if (lastCenterNodeId && lastCenterNodeId !== currentCenterNodeId) {
            const oldCenterNode = cy.getElementById(lastCenterNodeId);
            if (oldCenterNode && oldCenterNode.length > 0) {
                clearNodeBypassSize(oldCenterNode);
            }
        }

        log('state', 'info', 'apply center presentation', {
            currentCenterNodeId,
            centerCardEnabled,
            centerCount,
            htmlCardCount,
            htmlNodePluginReady
        });

        logVisibilitySample('applyCenterCardPresentation');

        if (!skipHtmlRender) {
            renderHtmlNodeCards();
        }
    }

    function clearCenterCardState(reason, options = {}) {
        const shouldRefreshCards = options.refreshCards !== false;

        log('state', 'info', 'clear center card state', { reason, shouldRefreshCards });
        logStateSnapshot(`clearCenterCardState:before:${reason}`);

        setCenterNode(null, `clear:${reason}`);
        pendingCenterDetailsNodeId = null;

        cy.nodes().forEach((node) => {
            node.data('isCenterClassCard', 0);
            node.data('useHtmlCard', 0);
            node.data('label', node.data('baseLabel'));
            node.data('htmlCardMarkup', '');
            node.removeClass('center-class-card');
            clearNodeBypassSize(node);
        });

        if (shouldRefreshCards) {
            renderHtmlNodeCards();
        }

        logStateSnapshot(`clearCenterCardState:after:${reason}`);
        logVisibilitySample(`clearCenterCardState:${reason}`);
    }

    function createEmptyGraphSnapshot() {
        return {
            nodes: new Map(),
            edges: new Map()
        };
    }

    function cloneElementDefinition(elementDef) {
        const cloned = {
            data: { ...(elementDef?.data || {}) }
        };

        if (typeof elementDef?.classes === 'string') {
            cloned.classes = elementDef.classes;
        }

        return cloned;
    }

    function createElementSignature(elementDef) {
        const sourceData = elementDef?.data || {};
        const sortedData = {};

        Object.keys(sourceData)
            .sort()
            .forEach((key) => {
                sortedData[key] = sourceData[key];
            });

        return JSON.stringify({
            data: sortedData,
            classes: typeof elementDef?.classes === 'string' ? elementDef.classes : ''
        });
    }

    function addElementToSnapshot(snapshotMap, elementDef) {
        const id = String(elementDef?.data?.id || '');
        if (!id) {
            return;
        }

        const cloned = cloneElementDefinition(elementDef);
        snapshotMap.set(id, {
            element: cloned,
            signature: createElementSignature(cloned)
        });
    }

    function computeGraphSnapshotDiff(previousSnapshot, nextSnapshot) {
        const diff = {
            nodeIdsToAdd: [],
            nodeIdsToRemove: [],
            nodeIdsToUpdate: [],
            edgeIdsToAdd: [],
            edgeIdsToRemove: [],
            edgeIdsToUpdate: []
        };

        previousSnapshot.nodes.forEach((_entry, nodeId) => {
            if (!nextSnapshot.nodes.has(nodeId)) {
                diff.nodeIdsToRemove.push(nodeId);
            }
        });

        nextSnapshot.nodes.forEach((entry, nodeId) => {
            const prevEntry = previousSnapshot.nodes.get(nodeId);
            if (!prevEntry) {
                diff.nodeIdsToAdd.push(nodeId);
                return;
            }

            if (prevEntry.signature !== entry.signature) {
                diff.nodeIdsToUpdate.push(nodeId);
            }
        });

        previousSnapshot.edges.forEach((_entry, edgeId) => {
            if (!nextSnapshot.edges.has(edgeId)) {
                diff.edgeIdsToRemove.push(edgeId);
            }
        });

        nextSnapshot.edges.forEach((entry, edgeId) => {
            const prevEntry = previousSnapshot.edges.get(edgeId);
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
        if (!entry?.element) {
            return false;
        }

        const classes = String(entry.element.classes || '');
        const fromClass = classes.split(/\s+/).includes('center-class-card');
        const fromData = Number(entry.element.data?.isCenterClassCard) === 1;
        return fromClass || fromData;
    }

    function shouldReplaceUpdatedNode(nodeId, previousEntry, nextEntry, pluginMode) {
        if (pluginMode !== 'nodeHtmlLabel') {
            return isCenterNodeElement(previousEntry) !== isCenterNodeElement(nextEntry);
        }

        const previousCenter = isCenterNodeElement(previousEntry);
        const nextCenter = isCenterNodeElement(nextEntry);

        if (previousCenter !== nextCenter) {
            return true;
        }

        return false;
    }

    function buildReplaceEdgeIds(nextSnapshot, nodeIdsToReplace) {
        const replaceNodeIdSet = new Set(nodeIdsToReplace.map((nodeId) => String(nodeId)));
        const edgeIds = new Set();

        nextSnapshot.edges.forEach((entry, edgeId) => {
            const source = String(entry?.element?.data?.source || '');
            const target = String(entry?.element?.data?.target || '');

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
        if (!element || element.length === 0 || !elementDef?.data) {
            return;
        }

        const nextData = elementDef.data;
        const currentData = element.data();

        const removeDataKeys = Object.keys(currentData).filter(
            (key) => !Object.prototype.hasOwnProperty.call(nextData, key)
        );
        if (removeDataKeys.length > 0) {
            element.removeData(removeDataKeys.join(' '));
        }

        Object.keys(nextData).forEach((key) => {
            if (element.data(key) !== nextData[key]) {
                element.data(key, nextData[key]);
            }
        });

        if (typeof elementDef.classes === 'string') {
            element.classes(elementDef.classes);
        }
    }

    function applyIncrementalGraphData(nextSnapshot, fallbackElements) {
        const expectedCount = latestGraphSnapshot.nodes.size + latestGraphSnapshot.edges.size;
        const actualCount = cy.elements().length;

        if (expectedCount !== actualCount) {
            log('state', 'error', 'incremental snapshot mismatch, fallback to full rebuild', {
                expectedCount,
                actualCount,
                previousNodeCount: latestGraphSnapshot.nodes.size,
                previousEdgeCount: latestGraphSnapshot.edges.size
            });

            cy.elements().remove();
            cy.add(fallbackElements);
            latestGraphSnapshot = nextSnapshot;

            return {
                mode: 'full-fallback',
                structuralChange: true,
                diff: null,
                addedNodeIds: [],
                replacedNodeIds: []
            };
        }

        const diff = computeGraphSnapshotDiff(latestGraphSnapshot, nextSnapshot);
        const pluginMode = getHtmlNodePluginMode();

        const replaceNodeIds = [];
        const normalNodeUpdateIds = [];
        diff.nodeIdsToUpdate.forEach((nodeId) => {
            const previousEntry = latestGraphSnapshot.nodes.get(nodeId);
            const nextEntry = nextSnapshot.nodes.get(nodeId);

            if (shouldReplaceUpdatedNode(nodeId, previousEntry, nextEntry, pluginMode)) {
                replaceNodeIds.push(nodeId);
                return;
            }

            normalNodeUpdateIds.push(nodeId);
        });

        const replaceEdgeIds = buildReplaceEdgeIds(nextSnapshot, replaceNodeIds);
        const replaceNodePreviousPositions = new Map();
        replaceNodeIds.forEach((nodeId) => {
            const existingNode = cy.getElementById(nodeId);
            if (!existingNode || existingNode.length === 0 || !existingNode.isNode()) {
                return;
            }

            replaceNodePreviousPositions.set(String(nodeId), {
                x: existingNode.position('x'),
                y: existingNode.position('y')
            });
        });

        const nodesToAdd = diff.nodeIdsToAdd
            .map((nodeId) => nextSnapshot.nodes.get(nodeId)?.element)
            .filter((entry) => !!entry)
            .map((entry) => cloneElementDefinition(entry));

        const nodesToReplace = replaceNodeIds
            .map((nodeId) => nextSnapshot.nodes.get(nodeId)?.element)
            .filter((entry) => !!entry)
            .map((entry) => cloneElementDefinition(entry));

        const edgeIdsToAddSet = new Set(diff.edgeIdsToAdd.map((edgeId) => String(edgeId)));
        replaceEdgeIds.forEach((edgeId) => {
            edgeIdsToAddSet.add(String(edgeId));
        });

        const edgesToAdd = Array.from(edgeIdsToAddSet)
            .map((edgeId) => nextSnapshot.edges.get(edgeId)?.element)
            .filter((entry) => !!entry)
            .map((entry) => cloneElementDefinition(entry));

        const edgesToRemove = cy.collection();
        diff.edgeIdsToRemove.forEach((edgeId) => {
            const edge = cy.getElementById(edgeId);
            if (edge && edge.length > 0 && edge.isEdge()) {
                edgesToRemove.merge(edge);
            }
        });
        replaceEdgeIds.forEach((edgeId) => {
            const edge = cy.getElementById(edgeId);
            if (edge && edge.length > 0 && edge.isEdge()) {
                edgesToRemove.merge(edge);
            }
        });
        if (edgesToRemove.length > 0) {
            edgesToRemove.remove();
        }

        const nodesToRemove = cy.collection();
        diff.nodeIdsToRemove.forEach((nodeId) => {
            const node = cy.getElementById(nodeId);
            if (node && node.length > 0 && node.isNode()) {
                nodesToRemove.merge(node);
            }
        });
        replaceNodeIds.forEach((nodeId) => {
            const node = cy.getElementById(nodeId);
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

            replaceNodeIds.forEach((nodeId) => {
                const previousPosition = replaceNodePreviousPositions.get(String(nodeId));
                if (!previousPosition) {
                    return;
                }

                const replacedNode = cy.getElementById(nodeId);
                if (!replacedNode || replacedNode.length === 0 || !replacedNode.isNode()) {
                    return;
                }

                replacedNode.position(previousPosition);
            });
        }
        if (edgesToAdd.length > 0) {
            cy.add(edgesToAdd);
        }

        normalNodeUpdateIds.forEach((nodeId) => {
            const nextNodeEntry = nextSnapshot.nodes.get(nodeId);
            if (!nextNodeEntry) {
                return;
            }

            const node = cy.getElementById(nodeId);
            if (!node || node.length === 0 || !node.isNode()) {
                return;
            }

            applyElementDefinition(node, nextNodeEntry.element);
        });

        diff.edgeIdsToUpdate.forEach((edgeId) => {
            if (replaceEdgeIds.has(String(edgeId))) {
                return;
            }

            const nextEdgeEntry = nextSnapshot.edges.get(edgeId);
            if (!nextEdgeEntry) {
                return;
            }

            const edge = cy.getElementById(edgeId);
            if (!edge || edge.length === 0 || !edge.isEdge()) {
                return;
            }

            applyElementDefinition(edge, nextEdgeEntry.element);
        });

        latestGraphSnapshot = nextSnapshot;

        const structuralChange =
            diff.nodeIdsToAdd.length > 0
            || diff.nodeIdsToRemove.length > 0
            || diff.edgeIdsToAdd.length > 0
            || diff.edgeIdsToRemove.length > 0
            || replaceNodeIds.length > 0
            || replaceEdgeIds.size > 0;

        log('state', 'info', 'incremental diff applied', {
            nodeAdd: diff.nodeIdsToAdd.length,
            nodeRemove: diff.nodeIdsToRemove.length,
            nodeUpdate: normalNodeUpdateIds.length,
            nodeReplace: replaceNodeIds.length,
            edgeAdd: diff.edgeIdsToAdd.length,
            edgeRemove: diff.edgeIdsToRemove.length,
            edgeUpdate: diff.edgeIdsToUpdate.length,
            edgeReplace: replaceEdgeIds.size,
            structuralChange
        });

        return {
            mode: 'incremental',
            structuralChange,
            diff,
            addedNodeIds: [...diff.nodeIdsToAdd],
            replacedNodeIds: [...replaceNodeIds]
        };
    }

    // TODO:这是在做数据适配，需要查看由谁来做
    function normalizeGraphData(graphData) {
        if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
            debugWarn('normalize skipped: invalid graph data', { graphData });
            return null;
        }

        debug('normalize graph data', {
            nodes: graphData.nodes.length,
            edges: graphData.edges.length,
            hasCenterDetails: !!graphData.centerDetails,
            centerNodeId: graphData.centerDetails?.nodeId || null
        });

        const incomingCenterDetails = readClassCardFromCenterDetails(graphData.centerDetails);
        if (incomingCenterDetails) {
            centerDetailsCache.set(incomingCenterDetails.nodeId, incomingCenterDetails);

            log('state', 'verbose', 'cache center details', {
                nodeId: incomingCenterDetails.nodeId,
                fields: incomingCenterDetails.fields.length,
                methods: incomingCenterDetails.methods.length,
                cacheSize: centerDetailsCache.size
            });

            if (pendingCenterDetailsNodeId && pendingCenterDetailsNodeId === incomingCenterDetails.nodeId) {
                pendingCenterDetailsNodeId = null;
                log('state', 'verbose', 'clear pending center details flag', {
                    nodeId: incomingCenterDetails.nodeId
                });
            }
        }

        const nodeElements = graphData.nodes
            .filter((node) => !!node?.id)
            .map((node) => {
                const id = String(node.id);
                const baseLabel = node.displayName || node.name || node.label || id;
                const classCard = resolveClassCardForNode(node, incomingCenterDetails);
                const classCardLabel = buildClassCardLabel(classCard);
                const isCenterClassCard = !!currentCenterNodeId && centerCardEnabled && currentCenterNodeId === id;
                const useHtmlCard = isCenterClassCard && htmlNodePluginReady;
                const cardSize = estimateCardSize(classCard);
                classCardModelCache.set(id, classCard);

                return {
                    data: {
                        id,
                        baseLabel,
                        classCardLabel,
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

        const edgeElements = graphData.edges
            .map((edge) => {
                const source = edge.source || edge.sourceId || edge.from;
                const target = edge.target || edge.targetId || edge.to;

                if (!source || !target) {
                    return null;
                }

                return {
                    data: {
                        id: edge.id || `${source}-${target}-${edge.relation || edge.type || 'relation'}`,
                        source: String(source),
                        target: String(target),
                        type: edge.relation || edge.type || 'relation'
                    }
                };
            })
            .filter((edge) => !!edge);

        const snapshot = createEmptyGraphSnapshot();
        nodeElements.forEach((element) => addElementToSnapshot(snapshot.nodes, element));
        edgeElements.forEach((element) => addElementToSnapshot(snapshot.edges, element));

        return {
            elements: [...nodeElements, ...edgeElements],
            snapshot
        };
    }

    function renderGraphData(graphData) {
        const animationToken = ++layoutAnimationToken;
        const normalized = normalizeGraphData(graphData);
        if (!normalized) {
            return;
        }

        const { elements, snapshot } = normalized;

        log('state', 'info', 'render graph data', {
            elementCount: elements.length,
            currentCenterNodeId,
            incomingNodes: Array.isArray(graphData?.nodes) ? graphData.nodes.length : -1,
            incomingEdges: Array.isArray(graphData?.edges) ? graphData.edges.length : -1,
            hasCenterDetails: !!graphData?.centerDetails
        });

        let incrementalResult = null;
        if (lastRequestMode === 'node') {
            incrementalResult = applyIncrementalGraphData(snapshot, elements);
        } else {
            cy.elements().remove();
            cy.add(elements);
            latestGraphSnapshot = snapshot;
        }

        if (lastRequestMode === 'global') {
            setCenterNode(null, 'render:global');
            pendingCenterDetailsNodeId = null;
        }

        clearTransientInteractionClasses('renderGraphData');
        applyCenterCardPresentation();

        logStateSnapshot('renderGraphData:post-apply', 'info');

        const layoutOptions = {
            ...window.AnalysisStyle.getDefaultLayout()
        };

        const shouldRunLayout =
            lastRequestMode !== 'node'
            || !incrementalResult
            || incrementalResult.structuralChange;

        if (lastRequestMode === 'node') {
            Object.assign(layoutOptions, getNodeModeLayoutOptions({
                fit: false,
                animate: layoutOptions.animate
            }));
        }

        if (!shouldRunLayout) {
            if (!animateCenterNodeViewport('skip-layout:no-structural-change', {
                duration: 260,
                animationToken
            })) {
                lockCenterNodeViewport('skip-layout:no-structural-change');
            }
            return;
        }

        if (lastRequestMode === 'global') {
            runGlobalSmoothLayout(animationToken);
            return;
        }

        if (lastRequestMode === 'node' && incrementalResult?.mode === 'incremental') {
            const usedStagger = runNodeStaggerEnterLayout(incrementalResult, animationToken);
            if (usedStagger) {
                return;
            }
        }

        cy.one('layoutstop', () => {
            if (animationToken !== layoutAnimationToken) {
                return;
            }

            if (!animateCenterNodeViewport('layoutstop', {
                duration: 320,
                animationToken
            })) {
                lockCenterNodeViewport('layoutstop');
            }
        });

        cy.layout(layoutOptions).run();
    }

    function requestGlobalRelation(source = 'toolbar-button', options = {}) {
        const queryOptions = options.queryOptionsOverride || window.AnalysisUI.getQueryOptions();
        const payload = options.payloadOverride || {
            relations: queryOptions.relations,
            includeExternal: queryOptions.includeExternal
        };

        lastRequestMode = 'global';
        centerCardEnabled = false;
        rememberLastQuery('queryGlobalRelation', payload, source);

        log('query', 'info', 'request global relation', {
            source,
            queryOptions,
            payload
        });
        sendQuery('queryGlobalRelation', payload);

        // 发送查询后再做本地状态复位，避免复位异常阻断通信。
        clearCenterCardState('global-query', { refreshCards: false });
    }

    function requestNodeDependencies(nodeId, source = 'node-tap', options = {}) {
        const queryOptions = options.queryOptionsOverride || window.AnalysisUI.getQueryOptions();
        const normalizedNodeId = String(nodeId);
        const payload = options.payloadOverride || {
            nodeId: normalizedNodeId,
            allowedRelations: queryOptions.relations,
            includeExternal: queryOptions.includeExternal
        };

        lastRequestMode = 'node';
        pendingCenterDetailsNodeId = String(payload.nodeId || normalizedNodeId);
        centerCardEnabled = options.enableCenterCard === true;

        if (options.setAsCenterNode !== false) {
            setCenterNode(payload.nodeId || normalizedNodeId, `request-node:${source}`);
        }

        rememberLastQuery('queryNodeDependencies', payload, source);

        log('query', 'info', 'request node dependencies', {
            source,
            nodeId: payload.nodeId || normalizedNodeId,
            queryOptions,
            pendingCenterDetailsNodeId,
            centerCardEnabled,
            payload
        });

        sendQuery('queryNodeDependencies', payload);
    }

    window.AnalysisGraphEvents.register(cy, {
        onNodeTap: (node) => {
            const tappedNodeId = String(node.id());

            if (suppressNodeTapNodeId === tappedNodeId && Date.now() <= suppressNodeTapUntil) {
                log('state', 'verbose', 'suppress node tap after card action', {
                    nodeId: tappedNodeId,
                    suppressNodeTapUntil
                });
                return;
            }

            if (currentCenterNodeId && tappedNodeId === String(currentCenterNodeId) && centerCardEnabled) {
                log('state', 'info', 'ignore repeated center node tap', {
                    nodeId: tappedNodeId,
                    reason: 'center-refresh-only-via-header-action'
                });
                return;
            }

            const previousCenter = currentCenterNodeId;
            const isRepeatCenterTap = !!previousCenter && previousCenter === tappedNodeId;

            log('state', 'info', 'node tap', {
                nodeId: tappedNodeId,
                hasCachedCenterDetails: centerDetailsCache.has(tappedNodeId),
                isRepeatCenterTap,
                transitionPath: `${previousCenter || 'null'} -> ${tappedNodeId}`
            });

            centerCardEnabled = true;
            setCenterNode(tappedNodeId, 'tap-node');
            applyCenterCardPresentation({ skipHtmlRender: true });

            const neighborhood = node.closedNeighborhood();
            cy.elements().addClass('faded').removeClass('focus');
            neighborhood.removeClass('faded');
            node.addClass('focus');

            requestNodeDependencies(tappedNodeId, 'node-tap', {
                enableCenterCard: true,
                setAsCenterNode: false
            });
        },
        onNodeContextTap: (node) => {
            const tappedNodeId = String(node.id());
            if (!currentCenterNodeId || tappedNodeId !== String(currentCenterNodeId)) {
                return;
            }

            if (toggleCenterNodePresentation('node-context')) {
                return;
            }
        },
        onBackgroundContextTap: () => {
            if (toggleCenterNodePresentation('background-context')) {
                return;
            }

            log('state', 'info', 'background context tap -> replay last query', {});
            replayLastQuery('background-reset');
        }
    });

    window.AnalysisUI.register({
        onFit: () => cy.fit(undefined, 70),
        onLayout: () => cy.layout(window.AnalysisStyle.getAltLayout()).run(),
        onReset: () => replayLastQuery('manual-reset'),
        onQueryGlobalRelation: () => requestGlobalRelation('toolbar-button')
    });

    // 监听来自后端的消息
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || !data.command) {
            return;
        }

        const responseQueryId = data?.data?.__queryId || data?.__queryId || null;
        const responseMeta = responseQueryId ? pendingQueryMap.get(responseQueryId) : null;
        if (responseQueryId) {
            pendingQueryMap.delete(responseQueryId);
        }

        log('query', 'info', 'receive backend message', {
            command: data.command,
            hasData: !!data.data,
            hasCenterDetails: !!data?.data?.centerDetails,
            responseQueryId,
            matchedRequestCommand: responseMeta?.command || null
        });

        if (data.command === 'renderGraphData') {
            renderGraphData(data.data);
        }
    });

    // 页面启动后直接拉取后端数据，不再使用 mock 内容。
    loadHtmlNodePlugin().finally(() => {
        debug('plugin load finalized', {
            htmlNodePluginReady,
            hasNodeHtmlLabel: typeof cy.nodeHtmlLabel === 'function',
            hasHtmlNodeApi: typeof cy.htmlnode === 'function',
            pluginMode: getHtmlNodePluginMode()
        });
        applyCenterCardPresentation();
    });

    requestGlobalRelation('startup-auto');
})();


