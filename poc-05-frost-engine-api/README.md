# poc-05-frost-engine-api — C++ engine with XML scene + Lua API, no Vulkan

A small C++ runtime compiled to WebAssembly that reproduces the
**Frost Engine orchestration model** from
[nuna/nuna](../../../nuna/nuna/games/_showcases/engine-showcase): a
declarative XML scene + per-entity Lua tick scripts driving an engine
through a thin `frost.*` Lua global.

The renderer is **plain Canvas2D** — no Vulkan, no shaders, no GPU. The
point of this POC is the *shape* of the API, not the renderer behind it.
The same scene and Lua scripts would drive a software rasteriser, a WebGL
canvas, or a terminal renderer with no changes.

## What this shows

```
runtime.xml   ──┐
scene.xml     ──┼─→  C++ engine (wasm)  ─→  entity transforms  ─→  Canvas2D
*.tick.lua    ──┘         (Lua 5.4)
```

1. `engine_init("/assets/runtime.xml")` parses the runtime config, which
   points at `scene.xml` and any scene-scope Lua scripts.
2. For each entity in `scene.xml`, the engine creates a private
   `lua_State`, installs the `frost.*` global (with `frost.self.id` bound
   to that entity), and runs the entity's `*.tick.lua` source.
3. `engine_tick(dt)` calls every entity's `onUpdate(dt)` once per frame.
4. JS reads each entity's `(x, y, size, color)` back through cwrap'd
   getters and draws circles on the canvas.

## `frost.*` API exposed to Lua

| Lua call                       | Effect                              |
| ------------------------------ | ----------------------------------- |
| `frost.log(msg)`               | writes to module stdout / DOM log   |
| `frost.getTime()`              | seconds since `engine_init`         |
| `frost.self.id`                | id of the currently-ticking entity  |
| `frost.getPosition(id)`        | returns `x, y`                      |
| `frost.setPosition(id, x, y)`  | move an entity                      |
| `frost.setSize(id, n)`         | resize an entity                    |
| `frost.setColor(id, "#rgb")`   | recolour an entity                  |

This is a deliberately tiny slice of the larger `frost.*` namespace
documented in
[`nuna/nuna/context/specs/frost-engine/frost-engine-api.schema.json`](../../../nuna/nuna/context/specs/frost-engine/frost-engine-api.schema.json).
Adding more is a matter of registering more `lua_CFunction`s in
`registerFrost()` in [src/engine.cpp](src/engine.cpp).

## Files

| Path                                | Role                                            |
| ----------------------------------- | ----------------------------------------------- |
| [src/engine.cpp](src/engine.cpp)    | runtime: XML loader + Lua bindings + frame loop |
| [src/assets/runtime.xml](src/assets/runtime.xml) | renderer / scene wiring                   |
| [src/assets/scene.xml](src/assets/scene.xml)     | entity declarations                       |
| [src/assets/scene.script.lua](src/assets/scene.script.lua) | scene-scope script (onLoad/onUpdate) |
| [src/assets/orbiter.tick.lua](src/assets/orbiter.tick.lua) | per-entity tick (3 instances)        |
| [src/assets/pulse.tick.lua](src/assets/pulse.tick.lua)     | per-entity tick (centre node)        |
| [web/index.html](web/index.html)    | browser shell + Canvas2D renderer               |
| [build.sh](build.sh)                | fetches Lua 5.4 + tinyxml2, runs `emcc`         |

## Build

Requires Emscripten on `PATH` (`emcc --version`).

```sh
./build.sh
python3 -m http.server -d web 8080
open http://localhost:8080
```

First run pulls Lua 5.4.7 from `lua.org` and tinyxml2 10.0.0 from GitHub
into `vendor/` (gitignored).

## How this maps to nuna/nuna

| nuna/nuna                                                | this POC                                           |
| -------------------------------------------------------- | -------------------------------------------------- |
| `runtime-engine-showcase.xml`                            | `runtime.xml`                                      |
| Vulkan renderer + shaders                                | Canvas2D in JS                                     |
| `<api type="vulkan" version="1.0"/>`                     | `<api type="canvas2d"/>`                           |
| `<scene uri="file://scenes/sim-1-suzanne.scene.json"/>`  | `<scene uri="file:///assets/scene.xml"/>`          |
| `<script uri="..." scope="scene"/>`                      | same                                               |
| `*.tick.lua` per entity                                  | same                                               |
| `LuaFrostApi.cpp` registering `frost.*`                  | `registerFrost()` in `src/engine.cpp`              |

The XML attribute names and Lua function names are kept identical to
nuna's so the same scripts could in principle be lifted across.

## Why this POC exists

Showing the runtime can be retargeted from Vulkan → Canvas2D without
touching a single XML or Lua line validates that the `frost.*` surface
really *is* the boundary, not just the documentation. It's also the
smallest meaningful "C++ in the browser" demo: a real interpreter
embedded, real XML being parsed, real game-loop semantics — under 250
lines of engine code.
