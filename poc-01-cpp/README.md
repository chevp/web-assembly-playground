# poc-01-cpp — C++ → WebAssembly (Emscripten)

Compile a plain C++ function to `.wasm` with [Emscripten](https://emscripten.org/)
and call it from the browser.

## Why C++

Original major target for WebAssembly. Mature toolchain (Emscripten), drop-in
for existing native code, game engines (Unreal, Unity-via-IL2CPP), and large
C/C++ libraries (SQLite, ffmpeg, OpenCV) all ship WASM builds this way.

## Build

```sh
# one-time: install emsdk and activate
emcc src/hello.cpp -O2 \
  -s EXPORTED_FUNCTIONS='["_add"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -o web/hello.mjs
```

## Run

Serve `web/` with any static server, e.g. `python3 -m http.server -d web 8080`,
then open <http://localhost:8080/>.
