(function () {
    const AnalysisGraphEvents = {
        register(cy, handlers) {
            const onNodeTap = handlers?.onNodeTap;
            const onNodeContextTap = handlers?.onNodeContextTap;
            const onBackgroundContextTap = handlers?.onBackgroundContextTap;

            cy.on('tap', 'node', (evt) => {
                const node = evt.target;
                onNodeTap?.(node, cy);
            });

            cy.on('cxttap', (evt) => {
                if (evt.target === cy) {
                    onBackgroundContextTap?.(cy);
                    return;
                }

                if (typeof evt.target?.isNode === 'function' && evt.target.isNode()) {
                    onNodeContextTap?.(evt.target, cy);
                }
            });
        }
    };

    window.AnalysisGraphEvents = AnalysisGraphEvents;
})();
