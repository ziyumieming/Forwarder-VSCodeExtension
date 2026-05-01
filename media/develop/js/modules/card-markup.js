(function () {
    var globalScope = window;
    var modules = globalScope.AnalysisModules || (globalScope.AnalysisModules = {});

    if (modules.CardMarkup) {
        return;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(text) {
        return escapeHtml(text).replace(/\s+/g, ' ').trim();
    }

    function buildClassMemberRow(nodeId, memberKind, member, index) {
        var rawText = typeof member === 'string'
            ? member
            : (member && (member.signature || member.displayName || member.name || member.label || ''));

        var memberLabel = String(rawText).trim();
        var memberId = String((member && member.id) || (nodeId + ':' + memberKind + ':' + index));
        var memberRange = member && member.range ? JSON.stringify(member.range) : '';

        return '<button class="analysis-class-card-member" data-node-id="' + escapeAttr(nodeId)
            + '" data-member-kind="' + escapeAttr(memberKind)
            + '" data-member-id="' + escapeAttr(memberId)
            + '" data-member-index="' + escapeAttr(index)
            + '" data-member-range="' + escapeAttr(memberRange)
            + '" data-member-label="' + escapeAttr(memberLabel)
            + '">' + escapeHtml(memberLabel || '(unknown)') + '</button>';
    }

    function buildCardSection(nodeId, sectionName, title, rowsHtml, isSectionCollapsed) {
        var collapsed = isSectionCollapsed(sectionName);
        var collapsedClass = collapsed ? ' is-collapsed' : '';
        var expandedText = collapsed ? 'false' : 'true';
        var caret = collapsed ? '&#9656;' : '&#9662;';

        return '<div class="analysis-class-card-section' + collapsedClass + '" data-card-section="' + escapeAttr(sectionName)
            + '"><button type="button" class="analysis-class-card-section-title analysis-class-card-section-toggle" data-node-id="'
            + escapeAttr(nodeId)
            + '" data-card-section="' + escapeAttr(sectionName)
            + '" aria-expanded="' + expandedText
            + '"><span class="analysis-class-card-caret" aria-hidden="true">' + caret
            + '</span><span class="analysis-class-card-title-text">' + escapeHtml(title)
            + '</span></button><div class="analysis-class-card-section-body">' + rowsHtml + '</div></div>';
    }

    function buildHtmlClassCard(nodeId, classCard, options) {
        var safeOptions = options || {};
        var getClassCardOptions = typeof safeOptions.getClassCardOptions === 'function'
            ? safeOptions.getClassCardOptions
            : function () {
                return {
                    collapsedSections: []
                };
            };
        var markSectionCollapsed = typeof safeOptions.markSectionCollapsed === 'function'
            ? safeOptions.markSectionCollapsed
            : function () { };
        var isSectionCollapsed = typeof safeOptions.isSectionCollapsed === 'function'
            ? safeOptions.isSectionCollapsed
            : function () {
                return false;
            };

        var cardOptions = getClassCardOptions() || {};
        var collapsedSections = Array.isArray(cardOptions.collapsedSections)
            ? cardOptions.collapsedSections
            : [];

        collapsedSections.forEach(function (section) {
            markSectionCollapsed(String(section));
        });

        var normalizedCard = classCard || {};
        var title = escapeHtml(normalizedCard.title || nodeId);
        var fields = Array.isArray(normalizedCard.fields) ? normalizedCard.fields : [];
        var methods = Array.isArray(normalizedCard.methods) ? normalizedCard.methods : [];

        var fieldRows = fields.length > 0
            ? fields.map(function (field, index) {
                return buildClassMemberRow(nodeId, 'field', field, index);
            }).join('')
            : '<div class="analysis-class-card-empty">No fields</div>';

        var methodRows = methods.length > 0
            ? methods.map(function (method, index) {
                return buildClassMemberRow(nodeId, 'method', method, index);
            }).join('')
            : '<div class="analysis-class-card-empty">No methods</div>';

        var fieldSection = buildCardSection(nodeId, 'fields', 'Fields', fieldRows, isSectionCollapsed);
        var methodSection = buildCardSection(nodeId, 'methods', 'Methods', methodRows, isSectionCollapsed);

        return '<div id="htmlLabel:' + escapeAttr(nodeId)
            + '" class="analysis-class-card" data-node-id="' + escapeAttr(nodeId)
            + '"><div class="analysis-class-card-header"><button type="button" class="analysis-class-card-header-action" data-card-action="refresh-center" data-node-id="'
            + escapeAttr(nodeId)
            + '">' + title
            + '</button></div>' + fieldSection + methodSection + '</div>';
    }

    modules.CardMarkup = {
        escapeHtml: escapeHtml,
        escapeAttr: escapeAttr,
        buildClassMemberRow: buildClassMemberRow,
        buildCardSection: buildCardSection,
        buildHtmlClassCard: buildHtmlClassCard
    };
})();
