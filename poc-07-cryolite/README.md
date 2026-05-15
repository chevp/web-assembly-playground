# poc-07-cryolite — `@chevp/cryolite`

Cryolite is poc-06's design packaged as an npm-style library:
`.cryo` + synth-xml + Lua tick scripts driving a wasm engine that
also embeds `nuna-middleware`, with a three.js renderer as the
frost-engine-api implementation on the web.

Two host environments are supported from the same package:

- **Browser** — `Cryolite.boot()` does manifest → runtime → scene
  → upload → render loop end-to-end. Uses the host's three.js (peer dep).
- **Node** — `FrostEngine` works headless; you upload entities and
  Lua scripts yourself (no `DOMParser` in node, so the synth-xml loader
  is browser-only).

## Architecture

```
                       ┌────────────────────────────────────────────────┐
                       │                  Host app                      │
                       │  examples/browser/index.html  │  examples/node │
                       └──────────────┬─────────────────────────┬───────┘
                                      │ ES module import        │
                                      ▼                         ▼
                       ┌──────────────────────────────┐  ┌──────────────┐
                       │   @chevp/cryolite (lib/)     │  │  FrostEngine │
                       │   high-level Cryolite.boot() │  │  only        │
                       │                              │  │  (no DOM)    │
                       │   ┌──────────────────────┐   │  └──────┬───────┘
                       │   │  cryo.js             │   │         │
                       │   │  .cryo manifest      │◄──┼─────────┘
                       │   └──────────────────────┘   │
                       │   ┌──────────────────────┐   │
                       │   │  synth-xml.js        │   │
                       │   │  runtime + scene +   │   │
                       │   │  componentRef        │   │
                       │   └──────────────────────┘   │
                       │   ┌──────────────────────┐   │
                       │   │  renderer.js         │◄──┼──── three.js (peer)
                       │   │  FrostRenderer (3D)  │   │
                       │   └──────────────────────┘   │
                       │   ┌──────────────────────┐   │
                       │   │  FrostEngine         │   │
                       │   │  cwrap of engine.*   │   │
                       │   └──────────┬───────────┘   │
                       └──────────────┼───────────────┘
                                      │ cwrap
                                      ▼
                       ┌──────────────────────────────┐
                       │  lib/engine.mjs (+ .wasm)    │
                       │  Emscripten module           │
                       │                              │
                       │  Exposes BOTH ABIs:          │
                       │  • engine_*                  │
                       │  • nuna_middleware_*         │
                       └──────────────┬───────────────┘
                                      │ statically linked at emcc time
                                      ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │                       src/engine.cpp                             │
        │   per-entity Lua state + transform table.                        │
        │   No XML parsing inside the wasm.                                │
        └─────────────────────┬─────────────────────┬──────────────────────┘
                              │                     │
                              ▼                     ▼
           ┌──────────────────────────────┐  ┌──────────────────────────┐
           │  vendor/nuna-middleware/     │  │  Lua 5.4                 │
           │  (git submodule)             │  │  (fetched by build.sh)   │
           │  • middleware.cpp            │  │                          │
           │  • nuna_scene_frame_t        │  │                          │
           │  • produce_frame_flat        │  │                          │
           └──────────────────────────────┘  └──────────────────────────┘

   ┌──── browser data flow per frame (Cryolite.boot → start()) ────────────┐
   │   rAF → engine.tick(dt)        [Lua scripts mutate transforms]        │
   │       → renderer.sync(engine)  [per-entity transform table → meshes]  │
   │       → renderer.render()      [three.js draws the WebGL frame]       │
   └───────────────────────────────────────────────────────────────────────┘
```

## Public API

```js
import * as THREE from "three";
import { Cryolite, FrostEngine, FrostRenderer, SynthXmlParser, loadCryo } from "@chevp/cryolite";

// --- browser one-liner ---
const h = await Cryolite.boot({
  cryoUrl: "./assets/project.cryo",
  canvas: document.getElementById("canvas"),
  three: THREE,
  log: console.log,
});
h.start();                       // requestAnimationFrame loop
// h.engine, h.renderer, h.manifest, h.runtime, h.scene available afterwards

// --- node / lower level ---
const engine = await FrostEngine.create({ print: console.log });
engine.addEntity("player");
engine.setPosition("player", 0, 0, 0);
engine.attachScript("player", await readFile("player.tick.lua", "utf8"));
engine.tick(1 / 60);
const x = engine.getX(0);
const frame = engine.copyMiddlewareFrame(engine ? 0 : 0);  // Float32Array(19)
```

### `FrostEngine`

1:1 wrapper around `engine.cpp`'s C ABI:

| Method                                | Maps to                          |
| ------------------------------------- | -------------------------------- |
| `FrostEngine.create({ print })`       | async ctor + `engine_init()`     |
| `addEntity(id)`                       | `engine_add_entity`              |
| `setPosition(id, x, y, z)`            | `engine_set_position`            |
| `setScale(id, sx, sy, sz)`            | `engine_set_scale`               |
| `setColor(id, hex)`                   | `engine_set_color`               |
| `setProperty(id, name, value)`        | `engine_set_property` (numeric)  |
| `attachScript(id, luaSource)`         | `engine_attach_script` (string)  |
| `tick(dt)`                            | `engine_tick`                    |
| `getEntityCount/Id/X/Y/Z/Scale*/Color`| `engine_get_entity_*`            |
| `produceMiddlewareFrame(t)`           | `nuna_middleware_produce_frame_flat` (zero-copy view) |
| `copyMiddlewareFrame(t)`              | owned copy (safe across heap growth) |
| `uploadScene(parsedScene, parser)`    | replays scene → engine_set_* + attachScript |
| `middlewareVersion`                   | `nuna_middleware_version()`      |

### `Cryolite.boot({ cryoUrl, canvas, three, log })`

Browser convenience. Returns `{ engine, renderer, manifest, runtime, scene, start(), stop(), frame(now) }`.

### Lower-level modules

`loadCryo`, `parseCryo`, `SynthXmlParser`, `FrostRenderer` are exported
for hosts that want to compose differently (e.g. preload assets, build
their own renderer).

## Build & run

```sh
git submodule update --init --recursive
./build.sh                          # → lib/engine.{mjs,wasm} + lib/assets/
```

Browser example (CDN three.js via importmap, no bundler):

```sh
npm run serve:browser
open http://localhost:8080
```

Node smoke test (headless, no rendering):

```sh
cd examples/node && npm install && npm run smoke
```

## Files

| Path                                      | Role                                                |
| ----------------------------------------- | --------------------------------------------------- |
| [src/engine.cpp](src/engine.cpp)          | wasm engine (≡ poc-06)                              |
| [src/assets/](src/assets/)                | sample `.cryo` + `.frost` + scenes + components + scripts |
| [vendor/nuna-middleware/](vendor/nuna-middleware/) | git submodule, statically linked into the wasm |
| [lib/index.js](lib/index.js)              | public entry: `FrostEngine`, `Cryolite`, re-exports |
| [lib/cryo.js](lib/cryo.js)                | `.cryo` parser                                      |
| [lib/synth-xml.js](lib/synth-xml.js)      | `SynthXmlParser` (runtime + scene + componentRef)   |
| [lib/renderer.js](lib/renderer.js)        | `FrostRenderer` (three.js)                          |
| [lib/engine.mjs / .wasm](lib/)            | Emscripten artifacts (built)                        |
| [lib/assets/](lib/assets/)                | demo assets copied by build.sh                      |
| [examples/browser/](examples/browser/)    | `<script type="module">` consumer + importmap       |
| [examples/node/](examples/node/)          | headless node consumer (`file:` dep)                |
| [build.sh](build.sh)                      | fetches Lua, runs `emcc`, copies assets             |
| [package.json](package.json)              | `three` is an optional peer dep                     |

## Relationship to other POCs

| POC                                              | What it is                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| [poc-05](../poc-05-frost-engine-api)             | first frost-engine-api: Lua + XML + Canvas2D, no middleware      |
| [poc-06](../poc-06-frost-engine-middleware)      | `.cryo` + synth-xml + Lua + three.js + nuna-middleware (HTML host) |
| poc-07-cryolite (this)                           | same wasm + same JS modules, packaged as a library with `Cryolite.boot` and a browser + node example |
