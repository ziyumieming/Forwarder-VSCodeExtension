(function () {
    const vscode = acquireVsCodeApi();
    let currentCenterNodeId = null;
    let pendingCenterDetailsNodeId = null;
    const centerDetailsCache = new Map();

    function createCyInstance() {
        return cytoscape({
            container: document.getElementById('cy'),
            elements: [],
            style: window.AnalysisStyle.getCytoscapeStyle(),
            layout: window.AnalysisStyle.getDefaultLayout()
        });
    }

    const cy = createCyInstance();

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
        cy.nodes().forEach((node) => {
            const isCenterCard = !!currentCenterNodeId && node.id() === currentCenterNodeId;

            node.data('isCenterClassCard', isCenterCard ? 1 : 0);
            node.data('label', isCenterCard ? node.data('classCardLabel') : node.data('baseLabel'));

            if (isCenterCard) {
                node.addClass('center-class-card');
            } else {
                node.removeClass('center-class-card');
            }
        });
    }

    // TODO:这是在做数据适配，需要查看由谁来做
    function normalizeGraphData(graphData) {
        if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
            return null;
        }

        const incomingCenterDetails = readClassCardFromCenterDetails(graphData.centerDetails);
        if (incomingCenterDetails) {
            centerDetailsCache.set(incomingCenterDetails.nodeId, incomingCenterDetails);

            if (pendingCenterDetailsNodeId && pendingCenterDetailsNodeId === incomingCenterDetails.nodeId) {
                pendingCenterDetailsNodeId = null;
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

                    return {
                        data: {
                            id,
                            baseLabel,
                            classCardLabel,
                            label: isCenterClassCard ? classCardLabel : baseLabel,
                            isCenterClassCard: isCenterClassCard ? 1 : 0,
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

        cy.elements().remove();
        cy.add(elements);

        applyCenterCardPresentation();

        cy.layout(window.AnalysisStyle.getDefaultLayout()).run();
    }

    function requestGlobalRelation() {
        const queryOptions = window.AnalysisUI.getQueryOptions();
        vscode.postMessage({
            command: 'queryGlobalRelation',
            relations: queryOptions.relations,
            includeExternal: queryOptions.includeExternal
        });
    }

    function requestNodeDependencies(nodeId) {
        const queryOptions = window.AnalysisUI.getQueryOptions();
        pendingCenterDetailsNodeId = String(nodeId);

        vscode.postMessage({
            command: 'queryNodeDependencies',
            nodeId,
            allowedRelations: queryOptions.relations,
            includeExternal: queryOptions.includeExternal
        });
    }

    window.AnalysisGraphEvents.register(cy, {
        onNodeTap: (node) => {
            currentCenterNodeId = node.id();
            applyCenterCardPresentation();

            const neighborhood = node.closedNeighborhood();
            cy.elements().addClass('faded').removeClass('focus');
            neighborhood.removeClass('faded');
            node.addClass('focus');

            requestNodeDependencies(node.id());
        },
        onBackgroundContextTap: () => {
            currentCenterNodeId = null;
            applyCenterCardPresentation();
            resetFocus();
        }
    });

    window.AnalysisUI.register({
        onFit: () => cy.fit(undefined, 70),
        onLayout: () => cy.layout(window.AnalysisStyle.getAltLayout()).run(),
        onReset: () => resetFocus(),
        onQueryGlobalRelation: () => requestGlobalRelation()
    });

    // 监听来自后端的消息
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || !data.command) {
            return;
        }

        if (data.command === 'renderGraphData') {
            renderGraphData(data.data);
        }
    });

    // 页面启动后直接拉取后端数据，不再使用 mock 内容。
    requestGlobalRelation();
})();
