# poc-11 — Vue 3 + Monaco scene editor

Based on [poc-09/h-tabs](../poc-09-ai-scene-editor/h-tabs.html). Same
conceptual layout (chat → graph → projections), but the right pane is
now a real **Vue 3** app with **Monaco** editors and FontAwesome 6 tab
icons.

## What's new vs. h-tabs

| | h-tabs (single HTML) | poc-11 (Vue + Monaco) |
|---|---|---|
| State | imperative DOM | reactive graph + computed views |
| Code views | regex-coloured `<pre>` | Monaco editor with proper tokenizers |
| XML tab | read-only string | Monaco, `readOnly: true`, live projection |
| Lua / GLSL tabs | read-only | **editable**, bound to `node.components.source`, Save bumps `graph.version` |
| Tab icons | text "live/xml/lua/glsl" pills | FontAwesome 6 glyphs |
| Layout | inline `<script>` | multi-file ES modules |

## How to run

You need an HTTP server — Monaco's workers and the ES module imports
won't load from `file://`. Anything that serves the directory is fine:

```sh
# from web-assembly-playground/
python3 -m http.server 8088
# then visit http://localhost:8088/poc-11-vue-editor/
```

All third-party libs (Vue, Monaco, FontAwesome) load from CDN — no
`npm install`, no build step.

## File layout

```
poc-11-vue-editor/
├── index.html       — shell, CDN script tags, Vue mount point
├── app.js           — Vue root component, MonacoEditor wrapper, chat logic
├── engine.js        — MiniEngine + CanvasRenderer (FrostEngine-shaped, pure JS)
├── projection.js    — graph → synth-xml pure function
├── style.css        — full theme + layout
└── README.md
```

## Editing semantics (the ADR-034 part)

- **scene.xml** is `readOnly: true` and re-derived on every graph mutation.
  Editing the projection would be editing a derived value — the wrong
  abstraction. If you want to import an XML file as a graph, that's a
  separate Importer concern.
- **orbit.lua** and **glow.frag** are full Monaco editors. Typing
  updates `script:orbit.components.source` / `shader:glow.components.source`
  live (so the graph drawer reflects current edit state). Clicking
  **Save** bumps `graph.version` and clears the unsaved-dot.
- The canvas2d renderer doesn't execute Lua or compile GLSL — those
  edits are for the **graph state** only. The real engine (poc-07,
  f-live) would re-attach the script and re-bind the shader; this POC
  reaches the same model layer without the runtime cost.

## Out of scope (on purpose)

- Free-text composer → model + tool-calls. The composer is wired but the
  send handler just echoes "use the chip". Variant J/K.
- Multi-script / multi-shader. There's one of each, deliberately —
  the win is the *edge sharing* (three planets, one `script:orbit`,
  three `runs` edges), not file proliferation.
- Importer for hand-edited XML. The XML view is one-way.
- Splitter / dockable panes. Layout is fixed two-column.
