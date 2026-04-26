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
                    selector: 'node.center-class-card[useHtmlCard = 1]',
                    style: {
                        label: 'data(baseLabel)',
                        'text-opacity': 0,
                        color: 'transparent',
                        'background-opacity': 0,
                        'border-opacity': 0
                    }
                },
                {
                    selector: 'node[isCenterClassCard = 0]',
                    style: {
                        shape: 'ellipse'
                    }
                },
                {
                    selector: 'node.call-graph-node',
                    style: {
                        shape: 'ellipse',
                        width: 58,
                        height: 58,
                        padding: '8px',
                        'background-color': '#5aa2d5',
                        'border-width': 2,
                        'border-color': '#c9dff0',
                        'font-size': 10,
                        'text-max-width': 96,
                        'line-height': 1.12
                    }
                },
                {
                    selector: 'node.call-center',
                    style: {
                        'background-color': '#f3b23a',
                        'border-color': '#ffe3ad',
                        'border-width': 3,
                        color: '#241808',
                        width: 72,
                        height: 72,
                        'font-weight': 700
                    }
                },
                {
                    selector: 'node.call-incoming',
                    style: {
                        'background-color': '#4f86d9',
                        'border-color': '#bcd6ff'
                    }
                },
                {
                    selector: 'node.call-outgoing',
                    style: {
                        'background-color': '#44a987',
                        'border-color': '#b9ead8'
                    }
                },
                {
                    selector: 'node.call-both',
                    style: {
                        'background-color': '#8f7bd9',
                        'border-color': '#ddd4ff'
                    }
                },
                {
                    selector: 'node.call-library',
                    style: {
                        'border-style': 'dashed',
                        'background-opacity': 0.78
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
                    selector: 'edge.call-edge',
                    style: {
                        width: 2.2,
                        'curve-style': 'bezier',
                        label: '',
                        'target-arrow-shape': 'triangle'
                    }
                },
                {
                    selector: 'edge.call-incoming-edge',
                    style: {
                        'line-color': '#6f9ee8',
                        'target-arrow-color': '#6f9ee8'
                    }
                },
                {
                    selector: 'edge.call-outgoing-edge',
                    style: {
                        'line-color': '#5bc69f',
                        'target-arrow-color': '#5bc69f'
                    }
                },
                {
                    selector: 'edge.call-path-edge',
                    style: {
                        width: 3.2,
                        'line-color': '#f3b23a',
                        'target-arrow-color': '#f3b23a'
                    }
                },
                {
                    selector: 'edge.call-recursive-edge',
                    style: {
                        'curve-style': 'bezier',
                        label: 'rec',
                        color: '#d7c8ff',
                        'line-color': '#9f8ee8',
                        'target-arrow-color': '#9f8ee8'
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
                },
                {
                    selector: '.transition-hidden',
                    style: {
                        opacity: 0,
                        'text-opacity': 0,
                        'overlay-opacity': 0,
                        events: 'no'
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
