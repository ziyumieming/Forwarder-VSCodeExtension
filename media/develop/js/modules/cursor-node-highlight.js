(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CursorNodeHighlight) {
        return;
    }

    function create(context) {
        var safeContext = context || {};
        var cy = safeContext.cy;
        var log = typeof safeContext.log === 'function' ? safeContext.log : function () { };
        var highlightClass = 'editor-cursor-highlight';
        var candidates = [];

        function normalizeCandidate(nextCandidate) {
            if (!nextCandidate || !nextCandidate.id) {
                return null;
            }

            return {
                id: String(nextCandidate.id),
                label: nextCandidate.label ? String(nextCandidate.label) : String(nextCandidate.id),
                type: nextCandidate.type ? String(nextCandidate.type) : 'node',
                meta: nextCandidate.meta ? String(nextCandidate.meta) : '',
                pendingGraphNode: nextCandidate.pendingGraphNode === true
            };
        }

        function normalizeCandidates(nextCandidates) {
            var source = Array.isArray(nextCandidates) ? nextCandidates : [nextCandidates];
            return source
                .map(normalizeCandidate)
                .filter(function (candidate) {
                    return !!candidate;
                });
        }

        function clear() {
            if (!cy) {
                return;
            }

            cy.nodes('.' + highlightClass).removeClass(highlightClass);
        }

        function shouldSkipNode(node) {
            if (!node || node.length === 0 || !node.isNode || !node.isNode()) {
                return true;
            }

            if (node.hasClass('center-class-card') || Number(node.data('isCenterClassCard')) === 1) {
                return true;
            }

            return false;
        }

        function apply() {
            clear();
            if (!cy || candidates.length === 0) {
                return false;
            }

            for (var i = 0; i < candidates.length; i += 1) {
                var candidate = candidates[i];
                if (candidate.pendingGraphNode) {
                    continue;
                }

                var node = cy.getElementById(candidate.id);
                if (shouldSkipNode(node)) {
                    continue;
                }

                node.addClass(highlightClass);
                log('state', 'verbose', 'cursor graph node highlighted', {
                    nodeId: candidate.id,
                    type: candidate.type,
                    candidateIndex: i
                });
                return true;
            }

            var primaryCandidate = candidates[0] || null;
            if (primaryCandidate) {
                log('state', 'verbose', 'cursor graph node highlight skipped', {
                    nodeId: primaryCandidate.id,
                    candidateCount: candidates.length,
                    reason: 'no-visible-candidate'
                });
            }

            return false;
        }

        function setCandidate(nextCandidateOrCandidates) {
            candidates = normalizeCandidates(nextCandidateOrCandidates);
            return apply();
        }

        function getCandidate() {
            return candidates.length > 0 ? { ...candidates[0] } : null;
        }

        function getCandidates() {
            return candidates.map(function (candidate) {
                return { ...candidate };
            });
        }

        return {
            setCandidate: setCandidate,
            apply: apply,
            clear: clear,
            getCandidate: getCandidate,
            getCandidates: getCandidates,
            highlightClass: highlightClass
        };
    }

    modules.CursorNodeHighlight = {
        create: create
    };
})();
