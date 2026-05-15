// cryolite — node smoke test
//
// Headless: drives FrostEngine directly without DOMParser-based scene
// loading (Cryolite.boot is browser-only because cryo.js/synth-xml.js
// use DOMParser; node would need jsdom to use them, which is out of
// scope for a smoke test).
//
// Verifies in node:
//   - wasm loads
//   - engine_init / add_entity / set_position / set_scale / set_property
//     / attach_script all work
//   - Lua tick scripts run and mutate transforms
//   - nuna_middleware_produce_frame_flat returns sane values
//
//   node examples/node/smoke.js

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FrostEngine } from "@chevp/cryolite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "..", "lib", "assets");

async function loadLua(rel) {
  return readFile(path.join(ASSETS, rel), "utf8");
}

const engine = await FrostEngine.create({
  print: (s) => process.stdout.write(`[wasm] ${s}\n`),
});

const orbiterLua = await loadLua("scripts/orbiter.tick.lua");
const centerLua  = await loadLua("scripts/center.tick.lua");

// One center + one orbiter, hand-rolled in node (no synth-xml here).
engine.addEntity("center");
engine.setPosition("center", 0, 0, 0);
engine.setScale("center", 1.2, 1.2, 1.2);
engine.setColor("center", "#ffe66d");
engine.attachScript("center", centerLua);

engine.addEntity("orbiter-a");
engine.setPosition("orbiter-a", 3, 0, 0);
engine.setScale("orbiter-a", 0.6, 0.6, 0.6);
engine.setColor("orbiter-a", "#ff6b6b");
engine.setProperty("orbiter-a", "radius", 3.0);
engine.setProperty("orbiter-a", "speed",  1.0);
engine.setProperty("orbiter-a", "phase",  0.0);
engine.setProperty("orbiter-a", "tilt",   0.2);
engine.attachScript("orbiter-a", orbiterLua);

console.log(`cryolite booted: ${engine.getEntityCount()} entities · nuna-middleware ${engine.middlewareVersion}`);

const STEPS = 60;
const DT = 1 / 60;
for (let i = 0; i < STEPS; i++) engine.tick(DT);

console.log(`after ${STEPS} ticks (${(STEPS * DT).toFixed(2)}s):`);
for (let i = 0; i < engine.getEntityCount(); i++) {
  const id = engine.getEntityId(i);
  console.log(
    `  ${id.padEnd(12)}  pos=(${engine.getX(i).toFixed(3)}, ${engine.getY(i).toFixed(3)}, ${engine.getZ(i).toFixed(3)})  ` +
    `scale=(${engine.getScaleX(i).toFixed(2)}, ${engine.getScaleY(i).toFixed(2)}, ${engine.getScaleZ(i).toFixed(2)})  ` +
    `color=${engine.getColor(i)}`
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
