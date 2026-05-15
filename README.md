# web-assembly-playground

WebAssembly is a low-level binary format, not tied to any single source
language. The same trivial `add(a, b)` function is implemented here in three
languages and compiled to `.wasm` to compare the toolchains.

## POCs

| Folder | Language | Toolchain | Notes |
|---|---|---|---|
| [poc-01-cpp](poc-01-cpp/) | C++ | Emscripten | Original target; mature, drop-in for existing native code |
| [poc-02-java](poc-02-java/) | Java | TeaVM | JVM bytecode → WASM; heavier output, useful for existing JVM code |
| [poc-03-rust](poc-03-rust/) | Rust | `wasm-pack` + `wasm-bindgen` | Small binaries, no GC, best modern tooling |
| [poc-04-swing-modernization](poc-04-swing-modernization/) | Java + Angular | TeaVM | Strategy POC: reuse Java business logic from a ~120k LOC Swing app in a new Angular client via WASM |
| [poc-05-frost-engine-api](poc-05-frost-engine-api/) | C++ + Lua + XML | Emscripten | Frost-engine-style runtime: declarative XML scene + per-entity Lua tick scripts, no Vulkan, Canvas2D output |

POCs 01–03 expose the same surface (`add(i32, i32) -> i32`) and ship a minimal
`web/index.html` that loads the module and prints `add(2, 3) = 5`. POC 04
demonstrates JVM → WASM strategy for legacy Swing modernization. POC 05
embeds an interpreter (Lua) and parser (tinyxml2) in C++ to produce an
interactive scene driven entirely from XML + Lua — mirroring the runtime
model used in [nuna/nuna](../../nuna/nuna).

## Mental model

```
 Rust / C++ / Java source
          ↓ compile
      WebAssembly (.wasm)
          ↓ run
   Browser / runtime
```

## Choosing a language today

- **Rust** for most new WebAssembly projects.
- **C++** when reusing existing native libraries or game engines.
- **Java** when integrating an existing JVM ecosystem.

Other languages targeting WASM: C, Go, Kotlin, Zig, AssemblyScript.
