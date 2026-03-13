(function () {
    const AnalysisGraphEvents = {
        register(cy, handlers) {
            const onNodeTap = handlers?.onNodeTap;
            const onBackgroundContextTap = handlers?.onBackgroundContextTap;

            cy.on('tap', 'node', (evt) => {
                const node = evt.target;
                onNodeTap?.(node, cy);
            });

            cy.on('cxttap', (evt) => {
                if (evt.target === cy) {
                    onBackgroundContextTap?.(cy);
                }
            });
        }
    };

    window.AnalysisGraphEvents = AnalysisGraphEvents;
})();
