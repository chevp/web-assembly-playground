// poc-10 — mock backend for the Cryolite project API.
//
// Graph is the source of truth. A project is { nodes, edges, version };
// every authoring operation is a graph mutation. Files only appear at the
// /export and /import boundary as one possible serialization of the graph.
// This deliberately mirrors the architecture sketch:
//
//   GRAPH (truth)  →  files (projection)
//
// not
//
//   FILES + GRAPH as equal stores.
//
// Routes:
//   GET    /api/projects/:projectId
//   POST   /api/projects/:projectId/nodes
//   GET    /api/projects/:projectId/nodes/:nodeId
//   PUT    /api/projects/:projectId/nodes/:nodeId       (shallow-merges components)
//   DELETE /api/projects/:projectId/nodes/:nodeId       (cascades dangling edges)
//   POST   /api/projects/:projectId/edges
//   DELETE /api/projects/:projectId/edges/:edgeId
//   POST   /api/projects/:projectId/sync                (batch + optimistic version)
//   GET    /api/projects/:projectId/export              (graph → files projection)
//   POST   /api/projects/:projectId/import              (files → graph projection)

const path = require("path");
const jsonServer = require("json-server");

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, "db.json"));

server.use(jsonServer.defaults());
server.use(jsonServer.bodyParser);

const findProject = (id) => router.db.get("projects").find({ id }).value();
const persist = () => router.db.write();
const bumpVersion = (p) => {
  p.version = (p.version || 0) + 1;
  return p.version;
};
const genId = (prefix) =>
  prefix + ":" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// ---------- project snapshot ----------

server.get("/api/projects/:projectId", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });
  res.json(p);
});

// ---------- nodes ----------

server.post("/api/projects/:projectId/nodes", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });

  const { id, type, components = {} } = req.body || {};
  if (!type) return res.status(400).json({ error: "type required" });
  const nid = id || genId("n");
  if (p.nodes.some((n) => n.id === nid))
    return res.status(409).json({ error: "node id exists" });

  const node = { id: nid, type, components };
  p.nodes.push(node);
  const version = bumpVersion(p);
  persist();
  res.status(201).json({ node, version });
});

server.get("/api/projects/:projectId/nodes/:nodeId", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });
  const node = p.nodes.find((n) => n.id === req.params.nodeId);
  if (!node) return res.status(404).json({ error: "node not found" });
  res.json(node);
});

// PUT does a shallow merge of `components` — partial inspector edits don't
// need to round-trip the whole node. `type` is overwritten if supplied.
server.put("/api/projects/:projectId/nodes/:nodeId", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });
  const node = p.nodes.find((n) => n.id === req.params.nodeId);
  if (!node) return res.status(404).json({ error: "node not found" });

  const { type, components } = req.body || {};
  if (type) node.type = type;
  if (components) node.components = { ...node.components, ...components };

  const version = bumpVersion(p);
  persist();
  res.json({ node, version });
});

// Deleting a node cascades: any edge touching it is dropped. Returned in
// `droppedEdges` so the client can reconcile its view.
server.delete("/api/projects/:projectId/nodes/:nodeId", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });

  const idx = p.nodes.findIndex((n) => n.id === req.params.nodeId);
  if (idx < 0) return res.status(404).json({ error: "node not found" });
  const [removed] = p.nodes.splice(idx, 1);
  const droppedEdges = p.edges.filter(
    (e) => e.from === removed.id || e.to === removed.id,
  );
  p.edges = p.edges.filter(
    (e) => e.from !== removed.id && e.to !== removed.id,
  );

  const version = bumpVersion(p);
  persist();
  res.json({ removed, droppedEdges, version });
});

// ---------- edges ----------

server.post("/api/projects/:projectId/edges", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });

  const { id, from, to, kind } = req.body || {};
  if (!from || !to || !kind)
    return res.status(400).json({ error: "from, to, kind required" });
  if (!p.nodes.some((n) => n.id === from))
    return res.status(400).json({ error: "from-node not found" });
  if (!p.nodes.some((n) => n.id === to))
    return res.status(400).json({ error: "to-node not found" });

  const eid = id || genId("e");
  if (p.edges.some((e) => e.id === eid))
    return res.status(409).json({ error: "edge id exists" });

  const edge = { id: eid, from, to, kind };
  p.edges.push(edge);
  const version = bumpVersion(p);
  persist();
  res.status(201).json({ edge, version });
});

// Edges are immutable beyond create/delete. To "rewire" an edge, delete
// and recreate — keeps mutation atomic and avoids partial-edge states.
server.delete("/api/projects/:projectId/edges/:edgeId", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });
  const idx = p.edges.findIndex((e) => e.id === req.params.edgeId);
  if (idx < 0) return res.status(404).json({ error: "edge not found" });

  const [removed] = p.edges.splice(idx, 1);
  const version = bumpVersion(p);
  persist();
  res.json({ removed, version });
});

// ---------- batch sync ----------
//
// Body: { baseVersion?, changes: [{ op, ... }] }
// Ops:
//   { op: "node.create", id?, type, components? }
//   { op: "node.update", id, type?, components? }   (components shallow-merged)
//   { op: "node.delete", id }                       (cascades edges)
//   { op: "edge.create", id?, from, to, kind }
//   { op: "edge.delete", id }
//
// If baseVersion is supplied and doesn't match the server's current
// version, returns 409 without applying anything. Per-change failures
// (missing id, dangling edge endpoint) come back in `conflicts` without
// aborting the batch — keeps the editor responsive on partial drift.

server.post("/api/projects/:projectId/sync", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });

  const { baseVersion, changes = [] } = req.body || {};
  const current = p.version || 0;
  if (typeof baseVersion === "number" && baseVersion !== current) {
    return res.status(409).json({
      error: "version conflict",
      serverVersion: current,
      baseVersion,
    });
  }

  const conflicts = [];
  for (const c of changes) {
    switch (c.op) {
      case "node.create": {
        if (!c.type) { conflicts.push({ change: c, reason: "type required" }); break; }
        const id = c.id || genId("n");
        if (p.nodes.some((n) => n.id === id)) {
          conflicts.push({ change: c, reason: "id exists" }); break;
        }
        p.nodes.push({ id, type: c.type, components: c.components || {} });
        break;
      }
      case "node.update": {
        const node = p.nodes.find((n) => n.id === c.id);
        if (!node) { conflicts.push({ change: c, reason: "no such node" }); break; }
        if (c.type) node.type = c.type;
        if (c.components) node.components = { ...node.components, ...c.components };
        break;
      }
      case "node.delete": {
        const idx = p.nodes.findIndex((n) => n.id === c.id);
        if (idx < 0) { conflicts.push({ change: c, reason: "no such node" }); break; }
        const [removed] = p.nodes.splice(idx, 1);
        p.edges = p.edges.filter(
          (e) => e.from !== removed.id && e.to !== removed.id,
        );
        break;
      }
      case "edge.create": {
        if (!c.from || !c.to || !c.kind) {
          conflicts.push({ change: c, reason: "from, to, kind required" }); break;
        }
        if (!p.nodes.some((n) => n.id === c.from)) {
          conflicts.push({ change: c, reason: "from-node missing" }); break;
        }
        if (!p.nodes.some((n) => n.id === c.to)) {
          conflicts.push({ change: c, reason: "to-node missing" }); break;
        }
        const id = c.id || genId("e");
        if (p.edges.some((e) => e.id === id)) {
          conflicts.push({ change: c, reason: "id exists" }); break;
        }
        p.edges.push({ id, from: c.from, to: c.to, kind: c.kind });
        break;
      }
      case "edge.delete": {
        const idx = p.edges.findIndex((e) => e.id === c.id);
        if (idx < 0) { conflicts.push({ change: c, reason: "no such edge" }); break; }
        p.edges.splice(idx, 1);
        break;
      }
      default:
        conflicts.push({ change: c, reason: "unknown op" });
    }
  }

  const newVersion = bumpVersion(p);
  persist();
  res.json({ newVersion, conflicts });
});

// ---------- export / import (the only place files live) ----------
//
// Projection format `graph-json/v1`: a single `graph.json` file carrying
// the full nodes + edges. Real game-specific projections (synth.xml,
// per-script .lua) belong upstream of the backend — they're a *runtime*
// concern, not a storage concern. The mock backend stays format-neutral.

server.get("/api/projects/:projectId/export", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });
  res.json({
    format: "graph-json/v1",
    project: { id: p.id, name: p.name, version: p.version },
    files: [
      {
        path: "graph.json",
        content: JSON.stringify({ nodes: p.nodes, edges: p.edges }, null, 2),
      },
    ],
  });
});

server.post("/api/projects/:projectId/import", (req, res) => {
  const p = findProject(req.params.projectId);
  if (!p) return res.status(404).json({ error: "project not found" });

  const body = req.body || {};
  if (body.format !== "graph-json/v1")
    return res.status(400).json({ error: "unsupported format" });
  const file = (body.files || []).find((f) => f.path === "graph.json");
  if (!file) return res.status(400).json({ error: "graph.json missing" });

  let parsed;
  try { parsed = JSON.parse(file.content); }
  catch { return res.status(400).json({ error: "graph.json invalid JSON" }); }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges))
    return res.status(400).json({ error: "graph shape invalid" });

  p.nodes = parsed.nodes;
  p.edges = parsed.edges;
  const version = bumpVersion(p);
  persist();
  res.json({
    imported: { nodes: p.nodes.length, edges: p.edges.length },
    version,
  });
});

// ---------- fallback: raw json-server routes ----------
//
// Exposes /projects, /projects/:id at the root for ad-hoc inspection.
// Not part of the documented API; useful for debugging the underlying db.

server.use(router);

const port = Number(process.env.PORT) || 4010;
server.listen(port, () => {
  console.log(`poc-10 graph-first project API on http://localhost:${port}`);
  console.log(`  GET    /api/projects/orbital`);
  console.log(`  POST   /api/projects/orbital/sync`);
  console.log(`  GET    /api/projects/orbital/export`);
});
