(function () {
    const vscode = acquireVsCodeApi();

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

    // TODO:这是在做数据适配，需要查看由谁来做
    function normalizeGraphData(graphData) {
        if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
            return null;
        }

        const elements = [
            ...graphData.nodes
                .filter((node) => !!node?.id)
                .map((node) => ({
                    data: {
                        id: String(node.id),
                        label: node.displayName || node.name || node.label || String(node.id)
                    }
                })),
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

        cy.layout(window.AnalysisStyle.getDefaultLayout()).run();
    }

    function requestGlobalRelation() {
        vscode.postMessage({
            command: 'queryGlobalRelation',
            relation: 'extends'
        });
    }

    function requestNodeDependencies(nodeId) {
        vscode.postMessage({
            command: 'queryNodeDependencies',
            nodeId,
            allowedRelations: ['extends', 'implements', 'calls']
        });
    }

    window.AnalysisGraphEvents.register(cy, {
        onNodeTap: (node) => {
            const neighborhood = node.closedNeighborhood();
            cy.elements().addClass('faded').removeClass('focus');
            neighborhood.removeClass('faded');
            node.addClass('focus');

            requestNodeDependencies(node.id());
        },
        onBackgroundContextTap: () => {
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
