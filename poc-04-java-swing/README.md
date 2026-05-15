# poc-04 — Swing-to-Web via WASM

Direct modernization strategy for a Java Swing desktop application:
keep the backend, reuse the business logic, replace only the UI.

```
 ┌─ Browser ─────────────────────────────────────┐
 │ Angular UI            (replaces Swing)        │
 │ TS integration layer  (WASM bindings)         │
 │ Java business logic → WASM   (reused as-is)   │
 └────────────────┬──────────────────────────────┘
                  │ existing REST/SOAP
 ┌─ Backend ──────┴──────────────────────────────┐
 │ Existing Java services, persistence, auth     │
 └───────────────────────────────────────────────┘
```

## Principle

The Swing application is split along its existing seams, not rewritten:

| Layer | Strategy |
|---|---|
| Swing UI | **Replace** with Angular |
| Domain models, validation, rules, pricing | **Reuse** — compile to WASM via [TeaVM](https://teavm.org/) |
| Server APIs (REST/SOAP) | **Keep** |
| Persistence, auth, reporting | **Keep** (server-side) |

The same Java code runs in three places: the legacy Swing client (JVM), the
new Angular client (WASM), and the backend (JVM). One source of truth for
validation and calculation across all surfaces.

## What this POC contains

This is a structural skeleton, not a runnable migration. It shows how the
three pieces fit together with a trivial `Order` / `PricingEngine` example.

| Folder | Role |
|---|---|
| [shared-core/](shared-core/) | Pure-Java module — POJOs, validation, pricing. **No Swing, no JDBC, no reflection-heavy frameworks.** Consumed by both the legacy Swing app and the WASM build. |
| [swing-client/](swing-client/) | Stand-in for the legacy desktop client. A `JFrame` that depends on `shared-core` — same JAR the WASM build consumes — proving the reuse path. |
| [wasm-module/](wasm-module/) | TeaVM build that compiles `shared-core` to `.wasm` and exports a JS-callable API. |
| [web/](web/) | Angular integration stubs — TS service that loads the WASM module and a component that calls into it. |

## Refactor target — separating UI from logic

Typical Swing code mixes everything in a listener:

```java
saveButton.addActionListener(e -> {
    if (order.isValid()) {                  // logic
        pricingEngine.calculate(order);     // logic
        serverApi.save(order);              // I/O
    }
});
```

The migration prerequisite is mechanical: extract the logic out of the
listener into [`shared-core`](shared-core/) so it has no Swing/AWT imports,
no desktop threading assumptions, no file-system or JDBC calls. Once that
holds, the same module compiles for the JVM **and** for WASM.

## Browser runtime constraints

Best candidates for WASM execution: validation, pricing, rules, calculations,
parsers, workflow state machines.

Avoid in the WASM module: JDBC, Hibernate, file I/O, sockets, reflection-heavy
frameworks, unbounded threading. Those stay on the server.

## Tooling

| Concern | Choice |
|---|---|
| Java → WASM | [TeaVM](https://teavm.org/) (alternatives: Bytecoder, CheerpJ for full-JVM-in-browser) |
| Frontend | Angular + TypeScript + RxJS |
| Backend | Existing Spring Boot / Java services, unchanged |

## Execution plan

| Phase | Work |
|---|---|
| 1 — Extraction | Identify reusable logic in Swing classes, remove Swing coupling, isolate into `shared-core` |
| 2 — WASM prototype | Compile one logic module (e.g. pricing) to WASM, validate from Angular |
| 3 — Angular foundation | Auth, navigation, layout, API integration |
| 4 — Incremental migration | Screen-by-screen: low-risk forms → lookup screens → dashboards → transactional workflows → complex editors. Swing and Angular clients coexist against the same backend. |
| 5 — Optimization | Bundle splitting, lazy WASM loading, startup tuning |

## Why this beats a full rewrite

- Business logic — the part that took years to get right — is **not retyped**.
- Backend contracts are unchanged, so server work is zero on day one.
- The two clients coexist during migration; nothing has to ship in a big bang.
- Identical validation and pricing in Swing, browser, and server, because
  they execute the **same compiled bytecode**.

## Future evolution

Once stable, individual hot WASM modules can be selectively rewritten in
Rust for size/perf, microfrontends introduced, PWA/offline added. The
backend can be modernized independently on its own timeline.
