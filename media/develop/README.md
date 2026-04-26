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

## Frontend Architecture (Tab Shell Refactor)

The Webview frontend keeps non-ESM script loading and now uses a tab shell around one shared Cytoscape canvas.
`main.js` owns bootstrap and shared rendering services; tab-specific behavior lives in tab modules.

### View Model

- `relationGraph`: the current class/relation graph. It owns relation queries, node dependency queries, center-card behavior, and graph interaction replay.
- `callGraph`: function call graph page shell. It owns call-specific parameter state, empty state, simple-node interactions, and the ordered path tag tray. Backend queries are intentionally not wired in this phase.
- Both tabs reuse the same `#cy` Cytoscape instance. Switching tabs changes toolbar visibility and active controller, not the canvas element.

### Script Load Order

1. cytoscape library scripts
2. base scripts: style.js -> event.js -> ui.js
3. shared state modules: center-state.js -> tab-manager.js -> selection-store.js
4. query/render/layout/card modules under media/develop/js/modules
5. tab modules such as relation-graph-tab.js
6. main.js bootstrap

The injection mapping is defined in src/providers/AnalysisView.ts and consumed by media/develop/html/view.html.

### Module Responsibilities

- modules/logger.js: debug-level routing and structured logs
- modules/plugin-manager.js: html-node plugin detection and dynamic load
- modules/card-markup.js: class-card HTML builders
- modules/center-state.js: center-node state + version tracking
- modules/tab-manager.js: tab registration, activation, toolbar visibility, active tab lifecycle
- modules/selection-store.js: cross-tab selected function id store
- modules/query-service.js: query send/remember/pending response consume
- modules/graph-incremental.js: snapshot, diff, incremental apply + fallback
- modules/graph-pipeline.js: backend graph data -> Cytoscape elements, with `presentationMode` support
- modules/card-events.js: delegated card interaction events with idempotent bind/unbind
- modules/card-render.js: card render orchestration
- modules/viewport-animation.js: center viewport lock/animate helpers
- modules/relation-graph-tab.js: relation graph queries, node interactions, replay, and stale node-response checks
- modules/call-graph-tab.js: call graph UI state, simple-node click/context interactions, and ordered path tag tray
- main.js: bootstrap, dependency wiring, shared render pipeline, backend message dispatch

### Request Modes

`query-service.js` tracks pending/latest responses by explicit request mode:

- `relation-global`: relation graph global query
- `relation-node`: relation graph node dependency query
- `call-graph`: reserved for function call graph query
- `call-path`: reserved for function call path query

Tab code should pass `meta.requestMode` explicitly when sending queries.

The Call Graph tab currently does not send `queryFunctionCallGraph` or `queryFunctionCallPath`; it only prepares UI state and local interactions. The intended next integration point is `call-graph-tab.js`, using `query-service.js` with `requestMode='call-graph'` or `requestMode='call-path'`.

### Graph Presentation Modes

`GraphPipeline.normalizeGraphData` supports presentation options:

- `class-card`: current relation graph behavior with center class-card data.
- `simple-node`: function call graph behavior without class-card data. It preserves circular nodes and adds call-specific classes such as center, incoming, outgoing, library, recursive edge, and path edge.

### Call Graph UI Shell

- The toolbar exposes only query parameters and controls: depth, direction, external-scope toggle, and Query/Fit/Layout/Clear actions.
- The canvas shows an empty overlay until a center function is selected; no fake graph is rendered.
- The bottom tray exposes a compact ordered list of function tags. Tags can be removed and reordered by drag-and-drop.
- Node left-click in Call Graph mode sets the local center function. Node right-click opens actions for adding a function to the ordered path tray or selecting it as center.
- Ordered path tags are a frontend representation of future waypoint path queries. The current backend only supports two-endpoint shortest paths; a later backend step can query adjacent waypoints pairwise and stitch the resulting path segments.
- Class graph member actions, editor context menu entry, shortcuts, and backend path validation are deferred to the next integration phase.

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
