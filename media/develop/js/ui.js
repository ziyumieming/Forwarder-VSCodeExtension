(function () {
    const AnalysisUI = {
        register(handlers) {
            const fitBtn = document.getElementById('btn-fit');
            const layoutBtn = document.getElementById('btn-layout');
            const resetBtn = document.getElementById('btn-reset');
            const queryBtn = document.getElementById('btn-query');

            fitBtn?.addEventListener('click', handlers?.onFit);
            layoutBtn?.addEventListener('click', handlers?.onLayout);
            resetBtn?.addEventListener('click', handlers?.onReset);
            queryBtn?.addEventListener('click', handlers?.onQueryGlobalRelation);
        }
    };

    window.AnalysisUI = AnalysisUI;
})();
