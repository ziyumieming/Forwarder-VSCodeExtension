(function () {
    const AnalysisStyle = {
        getCytoscapeStyle() {
            return [
                {
                    selector: 'node',
                    style: {
                        'background-color': '#5aa2d5',
                        'border-width': 1,
                        'border-color': '#c9dff0',
                        label: 'data(label)',
                        color: '#e6f2fb',
                        'text-wrap': 'wrap',
                        'text-max-width': 140,
                        'font-size': 11,
                        'text-valign': 'center',
                        'text-halign': 'center',
                        width: 'label',
                        height: 'label',
                        padding: '12px'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        width: 1.6,
                        'line-color': '#86aecd',
                        'target-arrow-color': '#86aecd',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        label: 'data(type)',
                        color: '#9bbad4',
                        'font-size': 9,
                        'text-background-color': '#0a1a2a',
                        'text-background-opacity': 0.7,
                        'text-background-padding': '2px'
                    }
                },
                {
                    selector: '.faded',
                    style: {
                        opacity: 0.2
                    }
                },
                {
                    selector: '.focus',
                    style: {
                        'background-color': '#f3b23a',
                        'border-color': '#ffe3ad',
                        color: '#241808'
                    }
                }
            ];
        },

        getDefaultLayout() {
            return {
                name: 'cose',
                animate: true,
                fit: true,
                padding: 70
            };
        },

        getAltLayout() {
            return {
                name: 'breadthfirst',
                directed: true,
                animate: true,
                fit: true,
                padding: 70
            };
        }
    };

    window.AnalysisStyle = AnalysisStyle;
})();
