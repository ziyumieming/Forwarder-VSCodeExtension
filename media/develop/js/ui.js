(function () {
    function readQueryOptions() {
        const extendsChecked = document.getElementById('rel-extends')?.checked ?? false;
        const implementsChecked = document.getElementById('rel-implements')?.checked ?? false;
        const composesChecked = document.getElementById('rel-composes')?.checked ?? false;
        const includeExternal = document.getElementById('include-external')?.checked ?? false;

        const relations = [];
        if (extendsChecked) {
            relations.push('extends');
        }
        if (implementsChecked) {
            relations.push('implements');
        }
        if (composesChecked) {
            relations.push('composes');
        }

        return {
            relations,
            includeExternal
        };
    }

    function readClassCardOptions() {
        return {
            showFields: true,
            showMethods: true,
            collapsedSections: []
        };
    }

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
        },

        getQueryOptions() {
            return readQueryOptions();
        },

        getClassCardOptions() {
            return readClassCardOptions();
        }
    };

    window.AnalysisUI = AnalysisUI;
})();
