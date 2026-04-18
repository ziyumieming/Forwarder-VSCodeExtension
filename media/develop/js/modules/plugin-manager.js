(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.PluginManager) {
        return;
    }

    var pluginReady = false;

    function noop() { }

    function getMode(cy) {
        if (!cy) {
            return null;
        }

        if (typeof cy.htmlnode === 'function') {
            return 'htmlnode';
        }

        return null;
    }

    function loadPlugin(options) {
        var cy = options && options.cy;
        var debug = (options && options.debug) ? options.debug : noop;
        var debugWarn = (options && options.debugWarn) ? options.debugWarn : noop;
        var onReadyChange = (options && options.onReadyChange) ? options.onReadyChange : noop;

        if (!cy) {
            onReadyChange(false);
            return false;
        }

        var mode = getMode(cy);
        pluginReady = !!mode;
        onReadyChange(pluginReady);

        if (pluginReady) {
            debug('plugin ready from static injection', {
                pluginMode: mode
            });
        } else {
            debugWarn('htmlnode plugin unavailable, fallback to text card mode');
        }

        return pluginReady;
    }

    modules.PluginManager = {
        getMode: getMode,
        loadPlugin: loadPlugin,
        isReady: function () {
            return pluginReady;
        },
        reset: function () {
            pluginReady = false;
        }
    };
})();
