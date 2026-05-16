// MiniEngine + CanvasRenderer — extracted from poc-09/h-tabs so the
// Vue app can import them cleanly. Same API shape as poc-07's FrostEngine
// (addEntity / setPosition / setScale / setColor / attachUpdate / tick),
// but pure JS — no wasm, no Lua, no nuna-middleware.

export class MiniEngine {
  constructor() {
    this.entities = new Map();
    this.order = [];
    this.t = 0;
  }

  addEntity(id) {
    if (this.entities.has(id)) return;
    this.entities.set(id, { id, x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color: "#fff", update: null });
    this.order.push(id);
  }

  setPosition(id, x, y, z) { const e = this.entities.get(id); if (e) { e.x = x; e.y = y; e.z = z; } }
  setScale(id, sx, sy, sz) { const e = this.entities.get(id); if (e) { e.sx = sx; e.sy = sy; e.sz = sz; } }
  setColor(id, c)          { const e = this.entities.get(id); if (e) e.color = c; }

  // FrostEngine has attachScript(id, luaSource); the local POC takes a JS
  // closure of shape (entity, t, dt) => void. The graph still says the
  // entity edges to script:orbit kind=runs — the model is the same, only
  // the runtime is different.
  attachUpdate(id, fn) { const e = this.entities.get(id); if (e) e.update = fn; }

  tick(dt) {
    this.t += dt;
    for (const id of this.order) {
      const e = this.entities.get(id);
      if (e && e.update) e.update(e, this.t, dt);
    }
  }

  *iter() { for (const id of this.order) yield this.entities.get(id); }
}

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = canvas.width;
    this.h = canvas.height;
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.scale = 38; // pixels per world unit
  }

  resize(width, height) {
    if (width === this.w && height === this.h) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.w = width;
    this.h = height;
    this.cx = width / 2;
    this.cy = height / 2;
  }

  clear() {
    const { ctx, w, h, cx, cy } = this;
    const grd = ctx.createRadialGradient(cx, cy, 40, cx, cy, Math.max(w, h));
    grd.addColorStop(0, "#161b22");
    grd.addColorStop(1, "#0a0c10");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = (cx % 32); x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
    for (let y = (cy % 32); y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
  }

  ring(r) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r * this.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawEntity(e, opts = {}) {
    const { ctx } = this;
    const sx = this.cx + e.x * this.scale;
    const sy = this.cy + e.z * this.scale;
    const radius = Math.max(2, e.sx * 12);

    const glow = ctx.createRadialGradient(sx, sy, radius * 0.3, sx, sy, radius * 3);
    glow.addColorStop(0, e.color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, radius * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();

    if (opts.label) {
      ctx.fillStyle = "rgba(220,220,220,0.55)";
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillText(opts.label, sx + radius + 6, sy + 3);
    }
  }
}
