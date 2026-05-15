# web

Angular integration stubs for the WASM module.

This folder is not a runnable Angular project — it shows the **integration
shape** only: where the WASM loader lives, what an injectable service that
wraps it looks like, and how a component calls into it.

## Files

| Path | Role |
|---|---|
| [`src/app/wasm/order-api.service.ts`](src/app/wasm/order-api.service.ts) | Injectable service. Loads `classes.wasm` once, exposes typed methods over the TeaVM exports. |
| [`src/app/screens/order/order.component.ts`](src/app/screens/order/order.component.ts) | Sample screen calling `totalCents` and `validate`. |

## Wiring into a real Angular app

1. `ng new client --standalone --routing` in a separate folder.
2. Copy `wasm-module/target/generated/wasm/classes.wasm*` into
   `client/src/assets/wasm/` as part of the build (Maven `antrun` or
   `mvn-frontend` plugin).
3. Drop `src/app/wasm/` and the example screen in, register the service.
4. Configure `angular.json` to copy `assets/wasm/` and serve `application/wasm`
   with the right MIME type.

## Backend

Calls that hit persistence/auth/reporting continue to use the existing REST
or SOAP APIs over `HttpClient`. The WASM module never makes network calls.
