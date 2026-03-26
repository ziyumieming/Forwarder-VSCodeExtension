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
    let htmlCardGeneration = 0;
    let lastRequestMode = 'global';
    let lastCenterNodeId = null;
    let debugEventId = 0;
    let querySequence = 0;
    const pendingQueryMap = new Map();
    let nodeHtmlLabelRenderCount = 0;

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

    function logStateSnapshot(reason, level = 'verbose') {
        log('state', level, 'snapshot', {
            reason,
            currentCenterNodeId,
            lastCenterNodeId,
            pendingCenterDetailsNodeId,
            lastRequestMode,
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

    function buildHtmlClassCard(nodeId, classCard) {
        const title = escapeHtml(classCard.title || nodeId);
        const fields = classCard.fields || [];
        const methods = classCard.methods || [];

        const fieldRows = fields.length > 0
            ? fields.map((field, index) => buildClassMemberRow(nodeId, 'field', field, index)).join('')
            : '<div class="analysis-class-card-empty">No fields</div>';

        const methodRows = methods.length > 0
            ? methods.map((method, index) => buildClassMemberRow(nodeId, 'method', method, index)).join('')
            : '<div class="analysis-class-card-empty">No methods</div>';

        return `<div id="htmlLabel:${escapeAttr(nodeId)}" class="analysis-class-card" data-node-id="${escapeAttr(nodeId)}"><div class="analysis-class-card-header">${title}</div><div class="analysis-class-card-section"><div class="analysis-class-card-section-title">Fields</div><div class="analysis-class-card-section-body">${fieldRows}</div></div><div class="analysis-class-card-section"><div class="analysis-class-card-section-title">Methods</div><div class="analysis-class-card-section-body">${methodRows}</div></div></div>`;
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

    function buildHtmlDataByNodeId() {
        const htmlDataByNodeId = new Map();

        cy.nodes().forEach((node) => {
            const nodeId = String(node.id());

            if (!currentCenterNodeId || nodeId !== currentCenterNodeId) {
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

    function refreshHtmlCards(pluginMode) {
        const htmlDataByNodeId = buildHtmlDataByNodeId();
        applyHtmlMarkupToNodes(htmlDataByNodeId);
        htmlCardGeneration += 1;

        log('renderer', 'verbose', 'refresh html cards', {
            pluginMode,
            htmlCardGeneration,
            currentCenterNodeId,
            markupNodeCount: htmlDataByNodeId.size
        });

        if (pluginMode === 'nodeHtmlLabel') {
            if (!currentCenterNodeId) {
                log('renderer', 'verbose', 'skip nodeHtmlLabel render without center node', {
                    htmlCardGeneration,
                    nodeHtmlLabelRenderCount
                });
                return true;
            }

            cy.nodeHtmlLabel(
                [
                    {
                        query: 'node.center-class-card[useHtmlCard = 1]',
                        halign: 'center',
                        valign: 'center',
                        halignBox: 'center',
                        valignBox: 'center',
                        cssClass: 'analysis-html-node-wrapper',
                        tpl: (nodeData) => {
                            const nodeId = String(nodeData.id || '');
                            return htmlDataByNodeId.get(nodeId) || '';
                        }
                    }
                ],
                [{ staticZoomLevel: 1 }],
                { enablePointerEvents: true }
            );

            nodeHtmlLabelRenderCount += 1;
            debug('html cards refreshed (nodeHtmlLabel)', {
                generation: htmlCardGeneration,
                nodeHtmlLabelRenderCount,
                currentCenterNodeId,
                wrappers: document.querySelectorAll('.analysis-html-node-wrapper').length
            });
            return true;
        }

        if (!currentCenterNodeId) {
            cy.emit('zoom');
            debug('html cards refreshed (htmlnode): no center node, cleaned up renderer');
            return true;
        }

        if (!initHtmlNodeRenderer()) {
            return false;
        }

        // htmlnode 插件通过 zoom 事件更新模板内容，这里主动触发一次刷新。
        cy.emit('zoom');
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
            const item = event.target.closest('.analysis-class-card-member');
            if (!item) {
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
        const titleLength = classCard.title.length;
        const fieldLength = classCard.fields.reduce((maxLen, item) => Math.max(maxLen, item.length), 0);
        const methodLength = classCard.methods.reduce((maxLen, item) => Math.max(maxLen, item.length), 0);

        const maxLineLength = Math.max(titleLength, fieldLength + 2, methodLength + 2, 18);
        const lineCount = Math.max(classCard.fields.length + classCard.methods.length + 4, 8);

        return {
            width: Math.min(Math.max(maxLineLength * 7.2, 220), 360),
            height: Math.min(Math.max(lineCount * 15, 140), 360)
        };
    }

    function applyCenterCardPresentation() {
        let centerCount = 0;
        let htmlCardCount = 0;

        cy.nodes().forEach((node) => {
            const isCenterCard = !!currentCenterNodeId && node.id() === currentCenterNodeId;
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
            centerCount,
            htmlCardCount,
            htmlNodePluginReady
        });

        logVisibilitySample('applyCenterCardPresentation');

        renderHtmlNodeCards();
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

        const elements = [
            ...graphData.nodes
                .filter((node) => !!node?.id)
                .map((node) => {
                    const id = String(node.id);
                    const baseLabel = node.displayName || node.name || node.label || id;
                    const classCard = resolveClassCardForNode(node, incomingCenterDetails);
                    const classCardLabel = buildClassCardLabel(classCard);
                    const isCenterClassCard = !!currentCenterNodeId && currentCenterNodeId === id;
                    const cardSize = estimateCardSize(classCard);
                    classCardModelCache.set(id, classCard);

                    return {
                        data: {
                            id,
                            baseLabel,
                            classCardLabel,
                            label: isCenterClassCard ? classCardLabel : baseLabel,
                            isCenterClassCard: isCenterClassCard ? 1 : 0,
                            useHtmlCard: 0,
                            cardWidth: cardSize.width,
                            cardHeight: cardSize.height,
                            nodeKind: node.type || 'node'
                        },
                        classes: isCenterClassCard ? 'center-class-card' : ''
                    };
                }),
            ...graphData.edges
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
                .filter((edge) => !!edge)
        ];

        return elements;
    }

    function renderGraphData(graphData) {
        const elements = normalizeGraphData(graphData);
        if (!elements) {
            return;
        }

        log('state', 'info', 'render graph data', {
            elementCount: elements.length,
            currentCenterNodeId,
            incomingNodes: Array.isArray(graphData?.nodes) ? graphData.nodes.length : -1,
            incomingEdges: Array.isArray(graphData?.edges) ? graphData.edges.length : -1,
            hasCenterDetails: !!graphData?.centerDetails
        });

        cy.elements().remove();
        cy.add(elements);

        if (lastRequestMode === 'global') {
            setCenterNode(null, 'render:global');
            pendingCenterDetailsNodeId = null;
        }

        applyCenterCardPresentation();

        logStateSnapshot('renderGraphData:post-apply', 'info');

        cy.layout(window.AnalysisStyle.getDefaultLayout()).run();
    }

    function requestGlobalRelation(source = 'toolbar-button') {
        const queryOptions = window.AnalysisUI.getQueryOptions();
        lastRequestMode = 'global';
        log('query', 'info', 'request global relation', {
            source,
            queryOptions
        });
        sendQuery('queryGlobalRelation', {
            relations: queryOptions.relations,
            includeExternal: queryOptions.includeExternal
        });

        // 发送查询后再做本地状态复位，避免复位异常阻断通信。
        clearCenterCardState('global-query', { refreshCards: false });
    }

    function requestNodeDependencies(nodeId, source = 'node-tap') {
        const queryOptions = window.AnalysisUI.getQueryOptions();
        lastRequestMode = 'node';
        pendingCenterDetailsNodeId = String(nodeId);

        log('query', 'info', 'request node dependencies', {
            source,
            nodeId,
            queryOptions,
            pendingCenterDetailsNodeId
        });

        sendQuery('queryNodeDependencies', {
            nodeId,
            allowedRelations: queryOptions.relations,
            includeExternal: queryOptions.includeExternal
        });
    }

    window.AnalysisGraphEvents.register(cy, {
        onNodeTap: (node) => {
            const tappedNodeId = String(node.id());
            const previousCenter = currentCenterNodeId;
            const isRepeatCenterTap = !!previousCenter && previousCenter === tappedNodeId;

            log('state', 'info', 'node tap', {
                nodeId: tappedNodeId,
                hasCachedCenterDetails: centerDetailsCache.has(tappedNodeId),
                isRepeatCenterTap,
                transitionPath: `${previousCenter || 'null'} -> ${tappedNodeId}`
            });

            setCenterNode(tappedNodeId, 'tap-node');
            applyCenterCardPresentation();

            const neighborhood = node.closedNeighborhood();
            cy.elements().addClass('faded').removeClass('focus');
            neighborhood.removeClass('faded');
            node.addClass('focus');

            requestNodeDependencies(tappedNodeId, 'node-tap');
        },
        onBackgroundContextTap: () => {
            log('state', 'info', 'background context tap -> requery global graph', {});
            requestGlobalRelation('background-reset');
        }
    });

    window.AnalysisUI.register({
        onFit: () => cy.fit(undefined, 70),
        onLayout: () => cy.layout(window.AnalysisStyle.getAltLayout()).run(),
        onReset: () => requestGlobalRelation('manual-reset'),
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


