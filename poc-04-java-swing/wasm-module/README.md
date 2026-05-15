# wasm-module

TeaVM build that compiles [`shared-core`](../shared-core/) to WebAssembly and
exports a JS-callable surface for the Angular client.

## What gets exported

Only a thin adapter class with `@JSExport` methods. The shared-core POJOs are
not exported directly — instead the adapter accepts/returns primitives or
JSON strings, because Java objects don't cross the JS/WASM boundary cleanly.

See [`OrderApi`](src/main/java/playground/wasm/OrderApi.java).

## Build

```sh
mvn -pl wasm-module package
# output: wasm-module/target/generated/wasm/classes.wasm  + classes.wasm-runtime.js
```

Copy both artifacts into the Angular `web/src/assets/wasm/` folder (or wire up
a build step — see [`web/README.md`](../web/README.md)).

## Size budget

Empty TeaVM WASM output is ~50–150 KB depending on what the reachable graph
pulls from `java.lang`/`java.util`. Profile with `optimizationLevel=FULL` and
keep `shared-core` lean — every transitive class lands in the binary.
