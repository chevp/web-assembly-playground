# shared-core

Pure-Java business logic reused across the legacy Swing client, the new
WASM-in-Angular client, and the backend.

## Rules

- No Swing / AWT imports.
- No JDBC, no file I/O, no sockets.
- No reflection-heavy frameworks (Spring, Hibernate, etc.).
- Deterministic, stateless services where possible. Immutable models.

Anything that violates these rules belongs on the server, not here.

## Example surface

- [`Order`](src/main/java/playground/sharedcore/domain/Order.java) — domain model
- [`OrderValidator`](src/main/java/playground/sharedcore/validation/OrderValidator.java) — pure validation
- [`PricingEngine`](src/main/java/playground/sharedcore/pricing/PricingEngine.java) — pure calculation

## Build

```sh
mvn -pl shared-core install
```

Produces a plain JAR consumable by:
- the existing Swing client (drop-in replacement for the extracted classes),
- the `wasm-module/` (TeaVM compiles it to `.wasm`),
- the backend services.
