(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.Logger) {
        return;
    }

    var DEFAULT_LEVELS = {
        off: 0,
        error: 1,
        info: 2,
        verbose: 3
    };

    var eventId = 0;

    function getLevels(options) {
        if (options && options.levels && typeof options.levels === 'object') {
            return options.levels;
        }

        return DEFAULT_LEVELS;
    }

    function getDebugLevelName(options) {
        var levels = getLevels(options);
        var fallbackLevel = (options && options.fallbackLevel) ? String(options.fallbackLevel) : 'info';
        var rawLevel = (globalScope.__analysisDebugLevel || fallbackLevel).toString().toLowerCase();

        return Object.prototype.hasOwnProperty.call(levels, rawLevel)
            ? rawLevel
            : fallbackLevel;
    }

    function shouldLog(levelName, options) {
        var levels = getLevels(options);
        var current = levels[getDebugLevelName(options)];
        var required = Object.prototype.hasOwnProperty.call(levels, levelName)
            ? levels[levelName]
            : levels.info;

        return current >= required;
    }

    function log(channel, level, message, payload, options) {
        if (!shouldLog(level, options)) {
            return;
        }

        var event = {
            eventId: ++eventId,
            ts: Date.now(),
            channel: channel,
            level: level,
            message: message
        };

        if (payload && typeof payload === 'object') {
            Object.assign(event, payload);
        }

        var prefix = (options && options.prefix) ? String(options.prefix) : '[AnalysisView][ClassCard]';

        if (level === 'error') {
            console.error(prefix, event);
            return;
        }

        if (level === 'verbose') {
            console.debug(prefix, event);
            return;
        }

        console.info(prefix, event);
    }

    function debug(message, details, options) {
        log('general', 'info', message, { details: details }, options);
    }

    function debugWarn(message, details, options) {
        log('general', 'error', message, { details: details }, options);
    }

    modules.Logger = {
        getDebugLevelName: getDebugLevelName,
        shouldLog: shouldLog,
        log: log,
        debug: debug,
        debugWarn: debugWarn
    };
})();
