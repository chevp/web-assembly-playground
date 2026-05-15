// @chevp/cryolite — public entry
//
// Cryolite is a thin client library for the frost-engine-api +
// nuna-middleware wasm bundle (same C++ sources as poc-06). It exposes
// the engine to JS hosts (browser or node) and ships a three.js viewer
// that mirrors poc-06's HTML demo as a reusable class.
//
// Two exports:
//   FrostEngine       — pure wasm wrapper (browser + node). No three.js.
//   FrostEngineViewer — three.js viewer for a FrostEngine instance (browser).
//
// The wasm artifact lib/engine.mjs is built by ../build.sh from the C++
// sources in ../src. It exposes BOTH ABIs in one module:
//   engine_*               — frost-engine-api orchestration (Lua/XML)
//   nuna_middleware_*      — ADR-029 every-frame compute (linked submodule)

import Module from "./engine.mjs";

const FRAME_FLOATS = 19;

export class FrostEngine {
  // Async ctor — wasm module load + asset preload happen here.
  //
  //   opts.runtimePath   path inside the preloaded /assets VFS
  //                      (default "/assets/runtime.xml")
  //   opts.print         optional log sink (printed C stdout)
  //   opts.locateFile    optional Emscripten locateFile override for
  //                      .wasm / .data when serving from a non-standard
  //                      path (e.g. behind a CDN).
  static async create(opts = {}) {
    const moduleOpts = {};
    if (opts.print) {
      moduleOpts.print = opts.print;
      moduleOpts.printErr = opts.print;
    }
    if (opts.locateFile) moduleOpts.locateFile = opts.locateFile;

    const m = await Module(moduleOpts);

    const runtimePath = opts.runtimePath ?? "/assets/runtime.xml";

    const inst = new FrostEngine(m, runtimePath);
    inst._init();
    return inst;
  }

  constructor(m, runtimePath) {
    this._m = m;
    this._runtimePath = runtimePath;

    this._init_     = m.cwrap("engine_init",             "number", ["string"]);
    this._tick_     = m.cwrap("engine_tick",             null,     ["number"]);
    this._count_    = m.cwrap("engine_get_entity_count", "number", []);
    this._getId_    = m.cwrap("engine_get_entity_id",    "string", ["number"]);
    this._getX_     = m.cwrap("engine_get_entity_x",     "number", ["number"]);
    this._getY_     = m.cwrap("engine_get_entity_y",     "number", ["number"]);
    this._getSize_  = m.cwrap("engine_get_entity_size",  "number", ["number"]);
    this._getColor_ = m.cwrap("engine_get_entity_color", "string", ["number"]);

    this._framePtr = m._malloc(FRAME_FLOATS * 4);
    this._frameView = new Float32Array(m.HEAPF32.buffer, this._framePtr, FRAME_FLOATS);
    this._middlewareVersion = m.UTF8ToString(m._nuna_middleware_version());

    this._entityCount = 0;
  }

  _init() {
    const n = this._init_(this._runtimePath);
    if (n < 0) throw new Error(`engine_init failed for ${this._runtimePath}`);
    this._entityCount = n;
  }

  tick(dt) { this._tick_(dt); }

  get entityCount() { return this._entityCount; }

  getEntity(i) {
    return {
      id:    this._getId_(i),
      x:     this._getX_(i),
      y:     this._getY_(i),
      size:  this._getSize_(i),
      color: this._getColor_(i),
    };
  }

  // Returns a Float32Array(19) view into wasm heap. The buffer is
  // re-filled in place on every call — do NOT cache it across ticks if
  // wasm memory growth could re-base HEAPF32 (use copyMiddlewareFrame()).
  produceMiddlewareFrame(timeSeconds) {
    this._m._nuna_middleware_produce_frame_flat(timeSeconds, this._framePtr);
    if (this._frameView.buffer !== this._m.HEAPF32.buffer) {
      this._frameView = new Float32Array(this._m.HEAPF32.buffer, this._framePtr, FRAME_FLOATS);
    }
    return this._frameView;
  }

  copyMiddlewareFrame(timeSeconds, out) {
    const v = this.produceMiddlewareFrame(timeSeconds);
    const dst = out ?? new Float32Array(FRAME_FLOATS);
    dst.set(v);
    return dst;
  }

  get middlewareVersion() { return this._middlewareVersion; }
  static get FRAME_FLOATS() { return FRAME_FLOATS; }
}

// Three.js-based viewer for a FrostEngine. `three` is injected so the
// host app keeps a single three.js instance (and so we don't impose a
// version). Pass either an existing renderer/scene/camera or a canvas
// and let the viewer build defaults.
export class FrostEngineViewer {
  //   opts.engine      FrostEngine instance (required)
  //   opts.three       the THREE namespace (required, peer dep)
  //   opts.canvas      HTMLCanvasElement (required if no renderer)
  //   opts.width       logical world width (default 800)
  //   opts.height      logical world height (default 600)
  //   opts.background  THREE.Color or hex int (default 0x0e1116)
  //   opts.renderer    bring your own THREE.WebGLRenderer (optional)
  constructor(opts) {
    if (!opts || !opts.engine || !opts.three) {
      throw new Error("FrostEngineViewer requires { engine, three, canvas }");
    }
    this.engine = opts.engine;
    const THREE = this._THREE = opts.three;

    this.width = opts.width ?? 800;
    this.height = opts.height ?? 600;

    if (opts.renderer) {
      this.renderer = opts.renderer;
    } else {
      if (!opts.canvas) {
        throw new Error("FrostEngineViewer needs opts.canvas or opts.renderer");
      }
      this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true });
      this.renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
      this.renderer.setSize(this.width, this.height, false);
    }
    const bg = opts.background ?? 0x0e1116;
    this.renderer.setClearColor(bg, 1);

    this.scene = new THREE.Scene();
    // Logical-pixel ortho camera matching the Canvas2D 800x600 space the
    // existing Lua tick scripts assume (cx=400, cy=300, +y downward).
    this.camera = new THREE.OrthographicCamera(0, this.width, 0, this.height, -10, 10);

    this._entityMeshes = [];
    for (let i = 0; i < this.engine.entityCount; i++) {
      const geom = new THREE.CircleGeometry(1, 32);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(geom, mat);
      this.scene.add(mesh);
      this._entityMeshes.push({ mesh, mat });
    }

    this._triPositions = new Float32Array(9);
    this._triColors = new Float32Array(9);
    this._triGeom = new THREE.BufferGeometry();
    this._triGeom.setAttribute("position", new THREE.BufferAttribute(this._triPositions, 3));
    this._triGeom.setAttribute("color", new THREE.BufferAttribute(this._triColors, 3));
    const triMesh = new THREE.Mesh(this._triGeom, new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.scene.add(triMesh);

    this._overlay = {
      x: this.width - 120,
      y: 10,
      w: 110,
      h: 110,
    };

    this._running = false;
    this._rafId = null;
    this._last = 0;
  }

  // Pull current state from the engine and render one frame. Does not
  // tick — caller must call engine.tick(dt) before render() to advance
  // the simulation. (Or use start() which does both.)
  render(timeSeconds = performance.now() / 1000) {
    const e = this.engine;
    for (let i = 0; i < e.entityCount; i++) {
      const ent = e.getEntity(i);
      const m = this._entityMeshes[i];
      m.mesh.position.set(ent.x, ent.y, 0);
      m.mesh.scale.setScalar(ent.size);
      m.mat.color.set(ent.color);
    }

    const frame = e.produceMiddlewareFrame(timeSeconds);
    const o = this._overlay;
    for (let i = 0; i < 3; i++) {
      const k = 4 + i * 5;
      const nx = frame[k    ];
      const ny = frame[k + 1];
      this._triPositions[i*3+0] = o.x + ((nx + 1) * 0.5) * o.w;
      this._triPositions[i*3+1] = o.y + ((1 - ny) * 0.5) * o.h;
      this._triPositions[i*3+2] = 0;
      this._triColors[i*3+0] = frame[k + 2];
      this._triColors[i*3+1] = frame[k + 3];
      this._triColors[i*3+2] = frame[k + 4];
    }
    this._triGeom.attributes.position.needsUpdate = true;
    this._triGeom.attributes.color.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  // requestAnimationFrame loop: tick(dt) + render() each frame.
  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    const step = (now) => {
      if (!this._running) return;
      const dt = Math.min((now - this._last) / 1000, 0.1);
      this._last = now;
      this.engine.tick(dt);
      this.render((now - performance.timeOrigin) / 1000);
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  stop() {
    this._running = false;
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  destroy() {
    this.stop();
    this._entityMeshes.forEach(({ mesh, mat }) => {
      mesh.geometry.dispose();
      mat.dispose();
      this.scene.remove(mesh);
    });
    this._triGeom.dispose();
  }
}
