# poc-06-frost-engine-middleware — `.cryo` + synth-xml + Lua + three.js

Pure web renderer that stitches the four layers of the Frost / nuna
runtime model together:

```
   project.cryo           ─►  cryolite-style manifest parser (JS)
        │
        ▼
   runtime.frost          ─►  picks renderer api + scene uri
        │
        ▼
   scene.synth.xml        ─►  synth-xml parser (browser DOMParser)
   + component.synth.xml      with componentRef composition
        │
        ▼
   *.tick.lua sources     ─►  uploaded to engine.wasm (Lua 5.4)
        │
        ▼
   engine_tick(dt)        ─►  per-entity Lua runs, mutates transforms
        │
        ▼
   transforms flat table  ─►  three.js (frost-engine-api implementation)
```

The wasm module owns **scene state + Lua execution** only. XML parsing
lives in JS where it belongs; rendering is three.js. Engine and
renderer talk through a per-entity transform table.

`nuna-middleware` is linked into the **same wasm** and exposes its
ABI side-by-side; it produces a 19-float `scene_frame` per frame that
the renderer paints as a small overlay — same flat layout as
`poc-12`, demonstrating that ADR-029's compute layer can coexist
with the Lua/XML orchestration in a single module without coupling.

## Architecture vs sibling POCs

| | poc-05 | poc-12 | **poc-06** |
| --- | --- | --- | --- |
| Engine | C++ → WASM | – | **C++ → WASM** |
| Renderer | Canvas2D | three.js | **three.js (3D)** |
| Middleware | – | C++ → WASM (triangle) | **linked into same wasm** |
| Scripts | Lua per entity | – | **Lua per entity (3D API)** |
| XML parsing | tinyxml2 in WASM | – | **DOMParser in JS** |
| Scene format | poc-local flat XML | hardcoded | **synth-xml + componentRef** |
| Entry point | none | none | **`.cryo` manifest** |

This is the first POC in the family that consumes the **real** asset
shape used in `synth-playground/synth-game/` and `nuna/nuna/games/*`:
project manifest + runtime config + scene-xml with `componentRef` +
Lua tick scripts.

## Files

| Path | Role |
| --- | --- |
| [src/engine.cpp](src/engine.cpp) | WASM engine: entity table + Lua state per entity + `frost.*` API |
| [build.sh](build.sh) | fetches Lua 5.4, builds `web/engine.mjs` + `engine.wasm` via emcc |
| [vendor/nuna-middleware/](vendor/nuna-middleware/) | git submodule — built into the same wasm |
| [web/index.html](web/index.html) | three.js from CDN, canvas, mounts main.js |
| [web/main.js](web/main.js) | bootstrap: `.cryo` → runtime → scene → engine → renderer → frame loop |
| [web/cryo.js](web/cryo.js) | `.cryo` manifest parser (DOMParser) |
| [web/synth-xml.js](web/synth-xml.js) | scene + component + runtime parser with `componentRef` composition |
| [web/renderer.js](web/renderer.js) | three.js scene builder + per-frame transform sync |
| [web/assets/project.cryo](web/assets/project.cryo) | entry manifest |
| [web/assets/runtime.frost](web/assets/runtime.frost) | runtime config — `<renderer>` api + `<scene uri="…"/>` |
| [web/assets/scenes/orbital.synth.xml](web/assets/scenes/orbital.synth.xml) | scene: center + 3 orbiters + sun + ambient |
| [web/assets/components/orbiter.synth.xml](web/assets/components/orbiter.synth.xml) | reusable component: script ref + radius/speed/phase/tilt |
| [web/assets/scripts/center.tick.lua](web/assets/scripts/center.tick.lua) | pulsing-sphere tick |
| [web/assets/scripts/orbiter.tick.lua](web/assets/scripts/orbiter.tick.lua) | orbital motion tick |

## The `frost.*` Lua API

3D-capable evolution of poc-05's surface:

| Lua call                                  | Effect |
| ----------------------------------------- | ------ |
| `frost.log(msg)`                          | writes to console |
| `frost.getTime()`                         | seconds since `engine_init` |
| `frost.self.id`                           | id of the currently-ticking entity |
| `frost.self.props.<name>`                 | properties from component / entity XML |
| `frost.getPosition(id)`                   | returns `x, y, z` |
| `frost.setPosition(id, x, y, z)`          | move an entity |
| `frost.getScale(id)`                      | returns `sx, sy, sz` |
| `frost.setScale(id, sx, sy, sz)`          | resize an entity |
| `frost.setColor(id, "#rgb")`              | recolour an entity |

## Build & run

Requires Emscripten on `PATH` (`emcc --version`).

```sh
git submodule update --init --recursive
./build.sh
python3 -m http.server -d web 8080
open http://localhost:8080
```

`build.sh` will refuse to run if the `nuna-middleware` submodule is not
checked out. First run also pulls Lua 5.4.7 from `lua.org` into
`vendor/` (gitignored).

## How this maps to the bigger picture

| nuna / Frost runtime model               | this POC |
| ---------------------------------------- | -------- |
| `.cryo` project manifest                 | `web/assets/project.cryo` |
| `runtime-*.synth` / `runtime-*.frost`    | `web/assets/runtime.frost` |
| `scene.synth.xml` + `componentRef`       | same |
| `nuna-middleware` (per-frame compute)    | `vendor/nuna-middleware`, linked into wasm |
| `frost-engine-api`                       | `web/renderer.js` (three.js impl) |
| Vulkan renderer                          | three.js WebGL |
| `*.tick.lua`                             | same |

The XML attribute names and Lua API names match the spec in
`nuna/nuna/context/specs/frost-engine/frost-engine-api.schema.json`,
so scripts authored against this POC should lift cleanly into the
native runtime and vice versa.

## What's deliberately stubbed

- **No real `nuna-middleware` ABI for scene compute.** This POC keeps
  the middleware's `produce_frame_flat` triangle alongside the engine
  to demonstrate coexistence; the engine still owns the per-entity
  state. Swapping the engine's inner loop for a middleware call once
  the middleware grows beyond a single triangle is a one-function
  change in `engine_tick`.
- **No backend.** `.cryo` declares a `<backend>` slot but this POC
  runs the renderer alone.
- **Placeholder geometry.** `<mesh shape="sphere"/>` makes a
  `THREE.SphereGeometry`. Swapping in `gltf` is a one-import change
  to `renderer.js`.
- **Lua source uploaded as strings.** No compile step, no Lua bytecode
  caching. Fine for POC; for production, pre-compile to bytecode and
  upload via `engine_attach_bytecode`.
