# poc-06-frost-engine-middleware — frost-engine-api + nuna-middleware, three.js viewer

Same Lua/XML orchestration model as
[poc-05-frost-engine-api](../poc-05-frost-engine-api), but the C++
runtime now also statically links **nuna-middleware** (vendored as a git
submodule under `vendor/nuna-middleware`), and the browser shell uses
**three.js** instead of Canvas2D.

```
runtime.xml  ──┐
scene.xml    ──┼─→  C++ engine.cpp ──┐
*.tick.lua   ──┘    (Lua 5.4)        │
                                     ├─→  single .wasm  ─→  three.js scene
                  nuna-middleware ───┘     (engine_*  +
                  (vendor submodule)        nuna_middleware_*)
```

## Why this POC exists

poc-05 showed that the `frost.*` Lua surface really is the boundary
between the engine and its renderer (retargeted Vulkan → Canvas2D
without touching XML/Lua). poc-06 adds two more independent
demonstrations:

1. **nuna-middleware coexists in the same wasm without coupling.**
   Both ABIs are exported side-by-side (`engine_*` for the Lua/XML
   orchestration story, `nuna_middleware_*` for the ADR-029
   every-frame compute story). Neither calls into the other.
2. **The renderer is swappable again.** Canvas2D in poc-05, three.js
   here. The XML and Lua files are byte-identical to poc-05's except
   for the `<api type="…"/>` attribute, which is informational.

## What gets rendered

| Layer              | Source                                      | Renders to                                |
| ------------------ | ------------------------------------------- | ----------------------------------------- |
| Orbital scene      | `engine_*` + `*.tick.lua`                   | three.js `CircleGeometry` per entity      |
| Middleware triangle | `nuna_middleware_produce_frame_flat`        | three.js `BufferGeometry` in top-right overlay |

The middleware triangle is rendered into a small "minimap" overlay
(top-right corner) so it's visually distinct from the frost orbital
scene. They share the same `THREE.Scene` and `OrthographicCamera`.

## Files

| Path                                       | Role                                                |
| ------------------------------------------ | --------------------------------------------------- |
| [src/engine.cpp](src/engine.cpp)           | frost runtime: XML + Lua + frame loop (poc-05 port) |
| [src/assets/](src/assets/)                 | runtime.xml, scene.xml, `*.tick.lua` (≡ poc-05)     |
| [vendor/nuna-middleware/](vendor/nuna-middleware/) | git submodule — built into the same wasm     |
| [web/index.html](web/index.html)           | browser shell + three.js renderer                   |
| [build.sh](build.sh)                       | fetches Lua + tinyxml2, runs `emcc`                 |

## Build

Requires Emscripten on `PATH` (`emcc --version`).

```sh
git submodule update --init --recursive
./build.sh
python3 -m http.server -d web 8080
open http://localhost:8080
```

`build.sh` will refuse to run if the submodule hasn't been checked out.
First run also pulls Lua 5.4.7 and tinyxml2 10.0.0 into `vendor/`
(gitignored).

## Exported wasm symbols

Both ABIs are visible at runtime — JS can pick either or both:

```js
// frost-engine-api (poc-05 surface)
engine_init, engine_tick,
engine_get_entity_count, engine_get_entity_id,
engine_get_entity_x, engine_get_entity_y,
engine_get_entity_size, engine_get_entity_color

// nuna-middleware (ADR-029 surface)
nuna_middleware_produce_frame_flat, nuna_middleware_version
```

See [`vendor/nuna-middleware/include/nuna/middleware/middleware.h`](vendor/nuna-middleware/include/nuna/middleware/middleware.h)
for the middleware ABI and
[`vendor/nuna-middleware/include/nuna/middleware/scene_frame.h`](vendor/nuna-middleware/include/nuna/middleware/scene_frame.h)
for the flat-buffer layout.

## Relationship to other POCs

| POC                                       | Orchestration | Renderer  | Middleware |
| ----------------------------------------- | ------------- | --------- | ---------- |
| [poc-05](../poc-05-frost-engine-api)      | Lua + XML     | Canvas2D  | —          |
| poc-06 (this)                             | Lua + XML     | three.js  | linked in  |
| [poc-07-cryolite](../poc-07-cryolite) | Lua + XML  | three.js  | linked in  |

poc-07 packages the same wasm + a three.js viewer class as an npm
library, so any browser or node consumer can `npm install` it and get
the engine + a working viewer without touching Emscripten or build.sh.
