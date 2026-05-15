# poc-01-rust — Rust → WebAssembly (wasm-bindgen)

Compile a Rust function to `.wasm` with [`wasm-pack`](https://rustwasm.github.io/wasm-pack/)
and call it from the browser. `wasm-bindgen` generates the JS glue.

## Why Rust

Small binaries, no GC, memory safety, first-class WASM tooling. Default choice
for new WebAssembly projects unless an existing C/C++ codebase forces otherwise.

## Build

```sh
# one-time: cargo install wasm-pack
wasm-pack build --target web --out-dir web/pkg
```

## Run

```sh
python3 -m http.server -d web 8080
```

Open <http://localhost:8080/>.
