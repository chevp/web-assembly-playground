# poc-07-cryolite — @chevp/cryolite

A small JS package that wraps the `frost-engine-api` + `nuna-middleware`
wasm bundle (same C++ build as [poc-06](../poc-06-frost-engine-middleware))
and exposes it through a three.js viewer class. The same package runs in
node (headless) and in the browser (three.js + WebGL).

```
@chevp/cryolite
├── FrostEngine        — pure wasm wrapper (browser + node)
└── FrostEngineViewer  — three.js viewer (browser; peer-deps three)
```

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │                  Host app                    │
                    │  (examples/browser/index.html │ examples/    │
                    │   node/smoke.js   │ your app)                │
                    └──────────────┬───────────────────────────────┘
                                   │ ES module import
                                   ▼
                    ┌──────────────────────────────────────────────┐
                    │            @chevp/cryolite (lib/)            │
                    │  ┌────────────────────┐  ┌────────────────┐  │
                    │  │   FrostEngine      │  │ FrostEngine    │  │
                    │  │   (browser+node)   │  │ Viewer (three) │  │
                    │  │   tick(dt)         │  │ render(t)      │  │
                    │  │   getEntity(i)     │  │ start()/stop() │  │
                    │  │   produce…Frame()  │  │                │  │
                    │  └─────────┬──────────┘  └──────┬─────────┘  │
                    └────────────┼────────────────────┼────────────┘
                                 │ cwrap              │ peer dep
                                 ▼                    ▼
                    ┌────────────────────────┐  ┌─────────────────┐
                    │  lib/engine.mjs (.wasm)│  │     three.js    │
                    │  Emscripten module     │  │ (≥ 0.165, host- │
                    │                        │  │  provided)      │
                    │  Exposes BOTH ABIs:    │  └─────────────────┘
                    │  • engine_*            │
                    │  • nuna_middleware_*   │
                    └────────────┬───────────┘
                                 │ statically linked at emcc time
                                 ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                       src/engine.cpp                        │
       │   frost-engine-api orchestration:                           │
       │   runtime.xml → scene.xml → per-entity lua_State            │
       │   (one frost.* global per state)                            │
       └─────────────────────┬───────────────────┬───────────────────┘
                             │                   │
                             ▼                   ▼
          ┌─────────────────────────────┐  ┌───────────────────────┐
          │  vendor/nuna-middleware/    │  │  Lua 5.4 + tinyxml2   │
          │  (git submodule)            │  │  (fetched by build.sh)│
          │  • middleware.cpp           │  │                       │
          │  • nuna_scene_frame_t       │  │                       │
          │  • produce_frame_flat       │  │                       │
          └─────────────────────────────┘  └───────────────────────┘

  ┌──── data flow per frame ─────────────────────────────────────────┐
  │  FrostEngineViewer.start():                                      │
  │    rAF →  engine.tick(dt)              [Lua scripts mutate       │
  │                                         entity transforms]      │
  │       →  for each entity:                                        │
  │            engine.getEntity(i)         [crosses wasm/JS bridge] │
  │       →  engine.produceMiddlewareFrame(t)  [19-float view onto  │
  │                                              wasm HEAPF32]      │
  │       →  three.js writes positions, colors, renders frame       │
  └──────────────────────────────────────────────────────────────────┘
```

Two independent ABIs share the same wasm module, but neither calls the
other:

- `engine_*` drives the Lua/XML orchestration story (poc-05's surface).
- `nuna_middleware_*` produces an ADR-029-style scene_frame buffer.

The viewer reads both each frame and overlays the middleware triangle
in a small minimap, exactly the way poc-06's HTML page does — but
packaged as a class so any host (node script, vue page, vanilla HTML)
can mount it.

## Public API

```js
import * as THREE from "three";
import { FrostEngine, FrostEngineViewer } from "@chevp/cryolite";

const engine = await FrostEngine.create({
  runtimePath: "/assets/runtime.xml",
});

// node / headless path — no three.js needed.
engine.tick(1 / 60);
const ent = engine.getEntity(0);          // { id, x, y, size, color }
const frame = engine.copyMiddlewareFrame(t); // Float32Array(19)

// browser path — bring your own three namespace.
const viewer = new FrostEngineViewer({
  engine,
  three: THREE,
  canvas: document.getElementById("canvas"),
});
viewer.start();
```

`FrostEngine` properties / methods:

| API                            | Notes                                            |
| ------------------------------ | ------------------------------------------------ |
| `FrostEngine.create(opts)`     | async ctor; loads wasm + preloaded `/assets` VFS |
| `engine.tick(dt)`              | advance simulation by `dt` seconds               |
| `engine.entityCount`           | count after `engine_init`                        |
| `engine.getEntity(i)`          | `{ id, x, y, size, color }`                      |
| `engine.produceMiddlewareFrame(t)` | zero-copy `Float32Array(19)` into wasm heap |
| `engine.copyMiddlewareFrame(t)`| owned copy (safe across memory growth)           |
| `engine.middlewareVersion`     | string from `nuna_middleware_version()`          |

`FrostEngineViewer` is documented inline in [`lib/index.js`](lib/index.js).

## Build & run

```sh
git submodule update --init --recursive
./build.sh                    # produces lib/engine.{mjs,wasm,data}
```

Browser example:

```sh
npm run serve:browser
open http://localhost:8080
```

Node smoke test:

```sh
cd examples/node && npm install && npm run smoke
```

## Files

| Path                                  | Role                                              |
| ------------------------------------- | ------------------------------------------------- |
| [src/engine.cpp](src/engine.cpp)      | frost runtime (≡ poc-06)                          |
| [src/assets/](src/assets/)            | runtime.xml + scene.xml + Lua scripts (≡ poc-06)  |
| [vendor/nuna-middleware/](vendor/nuna-middleware/) | git submodule, statically linked     |
| [lib/index.js](lib/index.js)          | `FrostEngine` + `FrostEngineViewer` classes       |
| [lib/engine.mjs](lib/engine.mjs)      | Emscripten glue (built artifact)                  |
| [examples/browser/](examples/browser/)| `<script type="module">` consumer + importmap     |
| [examples/node/](examples/node/)      | headless node consumer (`file:` dep)              |
| [build.sh](build.sh)                  | fetches Lua + tinyxml2, runs `emcc`               |
| [package.json](package.json)          | npm metadata; `three` is an optional peer dep     |

## Relationship to other POCs

| POC                                       | What it is                                                       |
| ----------------------------------------- | ---------------------------------------------------------------- |
| [poc-05](../poc-05-frost-engine-api)      | first frost-engine-api: Lua + XML + Canvas2D, no middleware      |
| [poc-06](../poc-06-frost-engine-middleware) | + nuna-middleware statically linked, three.js viewer (HTML demo) |
| poc-07-cryolite (this)                    | poc-06 packaged as an npm library; same wasm, three.js viewer class, browser + node consumers |
