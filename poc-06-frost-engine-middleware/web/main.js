// poc-06 bootstrap.
//
// Resolves a .cryo project manifest → runtime.frost config →
// scene.synth.xml (+ componentRefs) → uploads entities and Lua scripts
// into the wasm engine → starts a three.js render loop. Also drives
// nuna-middleware as a side-by-side compute layer.

import * as THREE from "three";
import Module from "./engine.mjs";
import { loadCryo } from "./cryo.js";
import { SynthXmlParser } from "./synth-xml.js";
import { FrostRenderer } from "./renderer.js";

const logEl = document.getElementById("log");
const logLines = [];
function log(s) {
    logLines.push(s);
    if (logLines.length > 80) logLines.shift();
    logEl.textContent = logLines.join("\n");
    logEl.scrollTop = logEl.scrollHeight;
}

// ---- wasm setup --------------------------------------------------------

const m = await Module({ print: log, printErr: log });

const engine = {
    init:          m.cwrap("engine_init",             null,     []),
    addEntity:     m.cwrap("engine_add_entity",       "number", ["string"]),
    setPosition:   m.cwrap("engine_set_position",     null,     ["string","number","number","number"]),
    setScale:      m.cwrap("engine_set_scale",        null,     ["string","number","number","number"]),
    setColor:      m.cwrap("engine_set_color",        null,     ["string","string"]),
    setProperty:   m.cwrap("engine_set_property",     null,     ["string","string","number"]),
    attachScript:  m.cwrap("engine_attach_script",    "number", ["string","string"]),
    tick:          m.cwrap("engine_tick",             null,     ["number"]),
    getEntityCount:m.cwrap("engine_get_entity_count", "number", []),
    getEntityId:   m.cwrap("engine_get_entity_id",    "string", ["number"]),
    getX:          m.cwrap("engine_get_entity_x",     "number", ["number"]),
    getY:          m.cwrap("engine_get_entity_y",     "number", ["number"]),
    getZ:          m.cwrap("engine_get_entity_z",     "number", ["number"]),
    getScaleX:     m.cwrap("engine_get_entity_scale_x", "number", ["number"]),
    getScaleY:     m.cwrap("engine_get_entity_scale_y", "number", ["number"]),
    getScaleZ:     m.cwrap("engine_get_entity_scale_z", "number", ["number"]),
    getColor:      m.cwrap("engine_get_entity_color", "string", ["number"]),
};

const middleware = {
    version: m.UTF8ToString(m._nuna_middleware_version()),
    framePtr: m._malloc(19 * 4),
};
middleware.frameView = new Float32Array(m.HEAPF32.buffer, middleware.framePtr, 19);

// ---- asset boot --------------------------------------------------------

log("loading project.cryo…");
const manifest = await loadCryo("./assets/project.cryo");
log(`  project: ${manifest.metadata.name} (${manifest.metadata.version})`);

const parser = new SynthXmlParser(`./assets/`);
const runtimePath = manifest.renderer.runtime;
log(`loading ${runtimePath}…`);
const runtime = await parser.loadRuntime(runtimePath);
log(`  renderer api: ${runtime.renderer.api}  (${runtime.renderer.width}x${runtime.renderer.height})`);

if (!runtime.sceneUri) throw new Error("runtime did not declare a <scene>");
log(`loading ${runtime.sceneUri}…`);
const parsedScene = await parser.loadScene(runtime.sceneUri);
log(`  scene: ${parsedScene.id} — ${parsedScene.entities.length} entities`);

// ---- engine upload -----------------------------------------------------

engine.init();
for (const e of parsedScene.entities) {
    engine.addEntity(e.id);
    const p = e.transform.position, s = e.transform.scale;
    engine.setPosition(e.id, p.x, p.y, p.z);
    engine.setScale(e.id, s.x, s.y, s.z);
    for (const comp of e.components) {
        if (comp.kind === "mesh" && comp.attrs.color) {
            engine.setColor(e.id, comp.attrs.color);
        }
    }
    for (const [name, value] of Object.entries(e.properties || {})) {
        if (typeof value === "number") engine.setProperty(e.id, name, value);
    }
    if (e.scriptUri) {
        const src = await parser.fetchText(e.scriptUri);
        const rc = engine.attachScript(e.id, src);
        if (rc !== 0) log(`  ! script attach failed for ${e.id} (rc=${rc})`);
        else          log(`  + ${e.id}  ←  ${e.scriptUri}`);
    }
}

// ---- renderer ----------------------------------------------------------

const canvas = document.getElementById("canvas");
const renderer = new FrostRenderer(canvas, runtime.renderer);
renderer.build(parsedScene);

document.getElementById("version").textContent =
    `nuna-middleware ${middleware.version}  ·  frost-engine-api on three.js`;

// ---- middleware triangle overlay ---------------------------------------
// (lives in screen-space; independent of the frost scene)

const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
const overlayScene = new THREE.Scene();
const triPos = new Float32Array(9);
const triCol = new Float32Array(9);
const triGeom = new THREE.BufferGeometry();
triGeom.setAttribute("position", new THREE.BufferAttribute(triPos, 3));
triGeom.setAttribute("color",    new THREE.BufferAttribute(triCol, 3));
const triMesh = new THREE.Mesh(triGeom, new THREE.MeshBasicMaterial({ vertexColors: true }));
overlayScene.add(triMesh);

// ---- frame loop --------------------------------------------------------

const frameEl = document.getElementById("frame");
let last = performance.now();
let frameNo = 0;

function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    frameNo++;

    // 1) tick the frost orchestration layer (runs all Lua scripts)
    engine.tick(dt);

    // 2) pull middleware's flat scene_frame (independent of engine)
    const tSec = (now - performance.timeOrigin) / 1000;
    m._nuna_middleware_produce_frame_flat(tSec, middleware.framePtr);

    // 3) sync engine transforms → three.js objects
    renderer.sync(engine);

    // 4) write middleware triangle into NDC overlay
    for (let i = 0; i < 3; i++) {
        const o = 4 + i * 5;
        triPos[i*3+0] = middleware.frameView[o    ] * 0.25 + 0.7;  // squashed top-right
        triPos[i*3+1] = middleware.frameView[o + 1] * 0.25 + 0.7;
        triPos[i*3+2] = 0;
        triCol[i*3+0] = middleware.frameView[o + 2];
        triCol[i*3+1] = middleware.frameView[o + 3];
        triCol[i*3+2] = middleware.frameView[o + 4];
    }
    triGeom.attributes.position.needsUpdate = true;
    triGeom.attributes.color.needsUpdate = true;

    // gentle camera drift so the 3D shape is obvious
    const t = engine ? tSec : 0;
    renderer.camera.position.x = Math.cos(t * 0.2) * 8;
    renderer.camera.position.z = Math.sin(t * 0.2) * 8;
    renderer.camera.lookAt(0, 0, 0);

    renderer.render();
    renderer.three.autoClear = false;
    renderer.three.clearDepth();
    renderer.three.render(overlayScene, overlayCam);
    renderer.three.autoClear = true;

    if ((frameNo & 31) === 0) frameEl.textContent = `frame #${frameNo} · ${(1/dt).toFixed(0)} fps`;
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
