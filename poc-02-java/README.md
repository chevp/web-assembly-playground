# poc-01-java — Java → WebAssembly (TeaVM)

Compile a Java method to `.wasm` with [TeaVM](https://teavm.org/) and call it
from the browser. TeaVM translates JVM bytecode to WebAssembly directly — no
JVM is shipped to the browser.

## Why Java

Mostly useful when integrating an existing JVM codebase. The output is larger
than Rust/C++ because of runtime support (GC, exceptions). Prefer Rust or C++
for greenfield WASM work; see top-level [README](../README.md).

Alternatives: [GraalVM Native Image WASM backend](https://www.graalvm.org/),
[CheerpJ](https://cheerpj.com/) (full JVM-in-WASM, heavier).

## Build

```sh
mvn package
# output: target/generated/wasm/classes.wasm  (+ classes.wasm-runtime.js)
cp target/generated/wasm/classes.wasm* web/
```

## Run

```sh
python3 -m http.server -d web 8080
```

Open <http://localhost:8080/>.
