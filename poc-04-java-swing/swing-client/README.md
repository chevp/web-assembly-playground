# swing-client

Minimal Swing screen that stands in for the legacy desktop client. It depends
on the same [`shared-core`](../shared-core/) module that the WASM build
compiles — proving the migration principle: **identical Java code runs in
both the legacy JVM client and the new Angular/WASM client.**

## What it shows

[`OrderScreen`](src/main/java/playground/swing/OrderScreen.java) is a single
Swing window with:

- a few input fields (customer id, SKU/qty/price for two line items),
- a "Validate" button calling `OrderValidator` from shared-core,
- a "Price" button calling `PricingEngine` from shared-core,
- a results area.

The UI code uses Swing freely. The business logic calls — validation and
pricing — go through `shared-core` classes that have no Swing imports.
**That is the only invariant the migration needs.** Everything in
`shared-core` is what gets compiled to WASM and reused from Angular.

## Run

```sh
mvn -pl swing-client exec:java
```

or build a runnable jar with `mvn -pl swing-client package`.
