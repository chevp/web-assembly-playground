// @chevp/cryolite — public entry
//
// Cryolite packages poc-06's design (.cryo + synth-xml + Lua + three.js
// over a wasm engine that also embeds nuna-middleware) as a library.
//
// Three layers exported:
//
//   FrostEngine        wasm wrapper (browser + node). No three.js dep.
//                      Methods mirror engine.cpp's C ABI 1:1.
//
//   loadCryo, SynthXmlParser
//                      Asset parsers (browser DOMParser). Reusable
//                      independently of the engine.
//
//   FrostRenderer      three.js scene builder + per-frame transform
//                      sync. Peer-deps `three`.
//
//   Cryolite.boot()    Convenience: wires the above end-to-end from a
//                      single .cryo URL + canvas. Browser-only because
//                      it instantiates FrostRenderer.

import Module from "./engine.mjs";
import { loadCryo, parseCryo } from "./cryo.js";
import { SynthXmlParser } from "./synth-xml.js";
import { FrostRenderer } from "./renderer.js";

export { loadCryo, parseCryo, SynthXmlParser, FrostRenderer };

export class FrostEngine {
  // opts.print       optional log sink (printed C stdout)
  // opts.locateFile  optional Emscripten locateFile override
  static async create(opts = {}) {
    const moduleOpts = {};
    if (opts.print) {
      moduleOpts.print = opts.print;
      moduleOpts.printErr = opts.print;
    }
    if (opts.locateFile) moduleOpts.locateFile = opts.locateFile;

    const m = await Module(moduleOpts);
    const inst = new FrostEngine(m);
    inst._init();
    return inst;
  }

  constructor(m) {
    this._m = m;
    this._init_        = m.cwrap("engine_init",             null,     []);
    this._addEntity_   = m.cwrap("engine_add_entity",       "number", ["string"]);
    this._setPosition_ = m.cwrap("engine_set_position",     null,     ["string","number","number","number"]);
    this._setScale_    = m.cwrap("engine_set_scale",        null,     ["string","number","number","number"]);
    this._setColor_    = m.cwrap("engine_set_color",        null,     ["string","string"]);
    this._setProperty_ = m.cwrap("engine_set_property",     null,     ["string","string","number"]);
    this._attachScript_= m.cwrap("engine_attach_script",    "number", ["string","string"]);
    this._tick_        = m.cwrap("engine_tick",             null,     ["number"]);
    this._count_       = m.cwrap("engine_get_entity_count", "number", []);
    this._getId_       = m.cwrap("engine_get_entity_id",    "string", ["number"]);
    this._getX_        = m.cwrap("engine_get_entity_x",     "number", ["number"]);
    this._getY_        = m.cwrap("engine_get_entity_y",     "number", ["number"]);
    this._getZ_        = m.cwrap("engine_get_entity_z",     "number", ["number"]);
    this._getSX_       = m.cwrap("engine_get_entity_scale_x","number",["number"]);
    this._getSY_       = m.cwrap("engine_get_entity_scale_y","number",["number"]);
    this._getSZ_       = m.cwrap("engine_get_entity_scale_z","number",["number"]);
    this._getColor_    = m.cwrap("engine_get_entity_color", "string", ["number"]);

    this._framePtr = m._malloc(19 * 4);
    this._frameView = new Float32Array(m.HEAPF32.buffer, this._framePtr, 19);
    this._middlewareVersion = m.UTF8ToString(m._nuna_middleware_version());
  }

  _init() { this._init_(); }
  reset() { this._init_(); }

  addEntity(id)                          { return this._addEntity_(id); }
  setPosition(id, x, y, z)               { this._setPosition_(id, x, y, z); }
  setScale(id, sx, sy, sz)               { this._setScale_(id, sx, sy, sz); }
  setColor(id, hex)                      { this._setColor_(id, hex); }
  setProperty(id, name, value)           { this._setProperty_(id, name, value); }
  attachScript(id, luaSource)            { return this._attachScript_(id, luaSource); }
  tick(dt)                               { this._tick_(dt); }

  getEntityCount()       { return this._count_(); }
  getEntityId(i)         { return this._getId_(i); }
  getX(i)                { return this._getX_(i); }
  getY(i)                { return this._getY_(i); }
  getZ(i)                { return this._getZ_(i); }
  getScaleX(i)           { return this._getSX_(i); }
  getScaleY(i)           { return this._getSY_(i); }
  getScaleZ(i)           { return this._getSZ_(i); }
  getColor(i)            { return this._getColor_(i); }

  // 19-float view into wasm heap. Refreshed in place each call.
  produceMiddlewareFrame(timeSeconds) {
    this._m._nuna_middleware_produce_frame_flat(timeSeconds, this._framePtr);
    if (this._frameView.buffer !== this._m.HEAPF32.buffer) {
      this._frameView = new Float32Array(this._m.HEAPF32.buffer, this._framePtr, 19);
    }
    return this._frameView;
  }

  copyMiddlewareFrame(timeSeconds, out) {
    const v = this.produceMiddlewareFrame(timeSeconds);
    const dst = out ?? new Float32Array(19);
    dst.set(v);
    return dst;
  }

  get middlewareVersion() { return this._middlewareVersion; }

  // Upload a parsed scene (from SynthXmlParser.loadScene) plus its
  // script sources (fetched via the same parser). Mirrors poc-06's
  // main.js upload loop, just packaged.
  async uploadScene(parsedScene, parser, { onLog } = {}) {
    for (const e of parsedScene.entities) {
      this.addEntity(e.id);
      const p = e.transform.position, s = e.transform.scale;
      this.setPosition(e.id, p.x, p.y, p.z);
      this.setScale(e.id, s.x, s.y, s.z);
      for (const comp of e.components) {
        if (comp.kind === "mesh" && comp.attrs.color) {
          this.setColor(e.id, comp.attrs.color);
        }
      }
      for (const [name, value] of Object.entries(e.properties || {})) {
        if (typeof value === "number") this.setProperty(e.id, name, value);
      }
      if (e.scriptUri) {
        const src = await parser.fetchText(e.scriptUri);
        const rc = this.attachScript(e.id, src);
        if (onLog) {
          if (rc !== 0) onLog(`script attach failed for ${e.id} (rc=${rc})`);
          else          onLog(`${e.id} ← ${e.scriptUri}`);
        }
      }
    }
  }
}

// Convenience all-in-one boot for browser hosts. Returns an object with
// { engine, renderer, manifest, runtime, scene, start, stop, frame } —
// start() runs a requestAnimationFrame loop that ticks the engine and
// re-syncs the renderer each frame. For more control, instantiate the
// pieces directly.
export const Cryolite = {
  async boot({ cryoUrl, canvas, three, log }) {
    const onLog = log ?? (() => {});

    const engine = await FrostEngine.create({ print: onLog });

    onLog(`loading ${cryoUrl}…`);
    const manifest = await loadCryo(cryoUrl);
    onLog(`  project: ${manifest.metadata.name} (${manifest.metadata.version})`);

    const baseUrl = cryoUrl.substring(0, cryoUrl.lastIndexOf("/") + 1);
    const parser = new SynthXmlParser(baseUrl);

    const runtime = await parser.loadRuntime(manifest.renderer.runtime);
    onLog(`  renderer api: ${runtime.renderer.api}  (${runtime.renderer.width}x${runtime.renderer.height})`);

    if (!runtime.sceneUri) throw new Error("runtime did not declare a <scene>");
    const scene = await parser.loadScene(runtime.sceneUri);
    onLog(`  scene: ${scene.id} — ${scene.entities.length} entities`);

    await engine.uploadScene(scene, parser, { onLog: (s) => onLog("  + " + s) });

    let renderer = null;
    if (canvas) {
      if (!three) throw new Error("Cryolite.boot({canvas, ...}) needs `three`");
      renderer = new FrostRenderer(canvas, runtime.renderer);
      renderer.build(scene);
    }

    const handle = {
      engine, renderer, manifest, runtime, scene,
      _raf: null, _last: 0,
      frame(now) {
        const dt = Math.min((now - this._last) / 1000, 0.1);
        this._last = now;
        engine.tick(dt);
        if (renderer) { renderer.sync(engine); renderer.render(); }
      },
      start() {
        if (this._raf) return;
        this._last = performance.now();
        const loop = (now) => { this.frame(now); this._raf = requestAnimationFrame(loop); };
        this._raf = requestAnimationFrame(loop);
      },
      stop() {
        if (this._raf != null) cancelAnimationFrame(this._raf);
        this._raf = null;
      },
    };
    return handle;
  },
};
