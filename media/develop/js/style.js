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
                        'text-margin-x': 0,
                        'text-margin-y': 0,
                        width: 'label',
                        height: 'label',
                        padding: '12px'
                    }
                },
                {
                    selector: 'node.center-class-card',
                    style: {
                        shape: 'round-rectangle',
                        'background-color': '#193147',
                        'border-width': 2,
                        'border-color': '#b9d8ef',
                        width: 'data(cardWidth)',
                        height: 'data(cardHeight)',
                        padding: 0,
                        'text-wrap': 'wrap',
                        'text-max-width': 300,
                        'font-size': 10,
                        'line-height': 1.18,
                        'text-halign': 'center',
                        'text-valign': 'center',
                        'text-justification': 'left',
                        'text-margin-x': 0,
                        'text-margin-y': 0,
                        color: '#e6f2fb'
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
                },
                {
                    selector: 'node.center-class-card.focus',
                    style: {
                        'background-color': '#224869',
                        'border-color': '#ffd794',
                        color: '#f4fbff'
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
