# Forwarder

Forwarder is a VS Code extension for code-structure analysis and interactive graph visualization.

## Features

- Analyze code relations and render graph views in a Webview.
- Support global relation queries and node-centric dependency queries.
- Support center-card presentation mode with interactive class member actions.
- Keep graph rendering performant with incremental node-mode updates.

## Relation Semantics

- `composes`: a class owns a field whose type resolves to another class or interface.
- `uses`: a method signature references another class or interface through parameters or return values.
- `aggregates`: an external parameter is assigned into a field of the same resolved type, such as `this.repo = repo`, `self.repo = repo`, or `receiver.repo = repo`.

The Webview relation filter exposes Aggregates as a default-enabled option alongside Extends, Implements, Composes, and Dependencies.

## Frontend Architecture (After Refactor)

The Webview frontend keeps non-ESM script loading and uses a thin orchestration layer in main.js.

### Script Load Order

1. cytoscape library scripts
2. base scripts: style.js -> event.js -> ui.js
3. modules scripts under media/develop/js/modules
4. main.js orchestration

The injection mapping is defined in src/providers/AnalysisView.ts and consumed by media/develop/html/view.html.

### Module Responsibilities

- modules/logger.js: debug-level routing and structured logs
- modules/plugin-manager.js: html-node plugin detection and dynamic load
- modules/card-markup.js: class-card HTML builders
- modules/center-state.js: center-node state + version tracking
- modules/query-service.js: query send/remember/pending response consume
- modules/graph-incremental.js: snapshot, diff, incremental apply + fallback
- modules/card-events.js: delegated card interaction events with idempotent bind/unbind
- modules/card-render.js: card render orchestration
- modules/viewport-animation.js: center viewport lock/animate helpers
- main.js: flow composition, message dispatch, and lifecycle orchestration

## Consistency Guardrails

The frontend includes DOM/Cytoscape consistency checks for center-card rendering.

- Active center-card nodes are derived from useHtmlCard=1 on graph nodes.
- Wrapper DOM nodes (.analysis-html-node-wrapper) are validated against active nodes.
- Orphan wrappers are removed when strict consistency is enabled.

### Feature Flag

- window.__analysisFeatureFlags.strictHtmlCardConsistency
	- true or undefined: enable strict orphan-wrapper cleanup
	- false: only report mismatch, do not remove wrappers

## Build and Validation

Core checks:

- pnpm run check-types
- pnpm run lint
- pnpm run compile

Suggested interaction regression checks after frontend changes:

1. Node center switch and repeated switch
2. Right-click local presentation toggle
3. Background replay reset
4. Card header/member actions (single-trigger behavior)

## Rollback Strategy

If a high-risk frontend refactor introduces regressions:

1. Revert the latest card/module changes first.
2. Keep script injection skeleton intact unless the issue is load-order related.
3. Restore previous stable main.js orchestration behavior.
4. Re-run compile and interaction regression checklist.

## Troubleshooting

- Symptom: center card duplicates or stale wrappers
	- Check renderer logs for "html card consistency checked" and mismatch counts.
	- Temporarily set strictHtmlCardConsistency=false to observe behavior without auto-cleanup.

- Symptom: stale node query result overrides latest center
	- Check logs for "drop stale node query response".
	- Verify center-state version increments on center transitions.

- Symptom: card actions trigger multiple times
	- Confirm CardEvents.bind is called once (idempotent binding expected).

## Notes

- This project intentionally keeps non-ESM Webview script loading for incremental migration safety.
- Backend protocol and command payload contracts are preserved during frontend refactor.
