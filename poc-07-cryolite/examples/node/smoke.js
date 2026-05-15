// cryolite — node smoke test
//
// Headless: loads the wasm, ticks the engine for ~1s of simulated time,
// dumps entity positions and one middleware scene_frame. No three.js,
// no rendering. Verifies that the same library that drives the browser
// example also works in plain node without DOM.
//
//   node examples/node/smoke.js

import { FrostEngine } from "@chevp/cryolite";

const engine = await FrostEngine.create({
  runtimePath: "/assets/runtime.xml",
  print: (s) => process.stdout.write(`[wasm] ${s}\n`),
});

console.log(`cryolite booted: ${engine.entityCount} entities · nuna-middleware ${engine.middlewareVersion}`);

const STEPS = 60;
const DT = 1 / 60;
for (let i = 0; i < STEPS; i++) engine.tick(DT);

console.log(`after ${STEPS} ticks (${(STEPS * DT).toFixed(2)}s):`);
for (let i = 0; i < engine.entityCount; i++) {
  const e = engine.getEntity(i);
  console.log(
    `  ${e.id.padEnd(10)}  pos=(${e.x.toFixed(2).padStart(7)}, ${e.y.toFixed(2).padStart(7)})  ` +
    `size=${e.size.toFixed(2).padStart(6)}  color=${e.color}`
  );
}

const frame = engine.copyMiddlewareFrame(STEPS * DT);
console.log(`middleware scene_frame @ t=${(STEPS * DT).toFixed(2)}s:`);
console.log(`  clear rgba = [${[...frame.slice(0, 4)].map(v => v.toFixed(2)).join(", ")}]`);
for (let i = 0; i < 3; i++) {
  const o = 4 + i * 5;
  console.log(
    `  v${i} = (x=${frame[o].toFixed(3)}, y=${frame[o+1].toFixed(3)}, ` +
    `rgb=[${frame[o+2].toFixed(2)}, ${frame[o+3].toFixed(2)}, ${frame[o+4].toFixed(2)}])`
  );
}

process.exit(0);
