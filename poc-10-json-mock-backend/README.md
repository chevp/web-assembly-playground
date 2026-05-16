# poc-10 — json-mock-backend (graph-first project API)

Mock backend for the Cryolite editor. **The graph is the source of truth.**
A project is `{ nodes, edges, version }` and every authoring operation is
a graph mutation. Files only appear at the `/export` and `/import`
boundary as one possible serialization.

This mirrors the architecture decision:

```
GRAPH (truth)  →  files (projection)
```

not

```
FILES + GRAPH  (competing stores)
```

Per-file CRUD endpoints from the earlier files-first draft are gone on
purpose — keeping both would re-introduce the "two-systems" complexity
the model is meant to dissolve.

## Run

```sh
npm install
npm start
# listening on http://localhost:4010
```

Data lives in `db.json`. Every mutation bumps `project.version` and
writes through. Delete `db.json` to reset, but keep a copy of the seed
first — it won't regenerate.

## Data model

```ts
type Project = {
  id: string;
  name: string;
  version: number;
  nodes: Node[];
  edges: Edge[];
};

type Node = {
  id: string;                    // opaque, e.g. "entity:center", "script:orbiter"
  type: string;                  // "scene" | "entity" | "script" | ...
  components: Record<string, unknown>;
};

type Edge = {
  id: string;
  from: string;                  // node id
  to: string;                    // node id
  kind: string;                  // "contains" | "runs" | "references" | ...
};
```

Nodes are independent. Cross-references are *edges*, not paths — which
is what makes streaming/chunking native and millions-of-entities tractable.

## Endpoints

All under `/api`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET    | `/api/projects/:projectId`                       | —                            | full graph + `version` |
| POST   | `/api/projects/:projectId/nodes`                 | `{ id?, type, components? }` | `{ node, version }` (201) |
| GET    | `/api/projects/:projectId/nodes/:nodeId`         | —                            | the node |
| PUT    | `/api/projects/:projectId/nodes/:nodeId`         | `{ type?, components? }`     | `{ node, version }` — `components` is shallow-merged |
| DELETE | `/api/projects/:projectId/nodes/:nodeId`         | —                            | `{ removed, droppedEdges, version }` |
| POST   | `/api/projects/:projectId/edges`                 | `{ id?, from, to, kind }`    | `{ edge, version }` (201) |
| DELETE | `/api/projects/:projectId/edges/:edgeId`         | —                            | `{ removed, version }` |
| POST   | `/api/projects/:projectId/sync`                  | `{ baseVersion?, changes }`  | `{ newVersion, conflicts }` |
| GET    | `/api/projects/:projectId/export`                | —                            | `{ format, project, files }` |
| POST   | `/api/projects/:projectId/import`                | `{ format, files }`          | `{ imported, version }` |

`/sync` accepts a `changes[]` array:

- `{ op: "node.create", id?, type, components? }`
- `{ op: "node.update", id, type?, components? }` — components shallow-merged
- `{ op: "node.delete", id }` — cascades dangling edges
- `{ op: "edge.create", id?, from, to, kind }`
- `{ op: "edge.delete", id }`

If `baseVersion` is supplied and doesn't match the current `version`, the
response is `409` with `{ serverVersion, baseVersion }` and nothing is
applied. Per-change failures come back in `conflicts[]` without aborting
the batch.

### Export / import

Export emits a single `graph.json` file (`format: "graph-json/v1"`) with
the full nodes + edges. Import accepts the same shape and replaces the
project's graph. Game-specific projections (`synth.xml`, per-script
`.lua`) are **not** this backend's job — they belong upstream in the
editor/runtime, where domain knowledge lives. The mock stays format-
neutral on purpose.

## Quick check

```sh
curl -s http://localhost:4010/api/projects/orbital | jq '.nodes | length, .edges | length'

curl -s -X POST http://localhost:4010/api/projects/orbital/sync \
  -H 'content-type: application/json' \
  -d '{
    "baseVersion": 1,
    "changes": [
      { "op": "node.create", "id": "entity:orbiter-c", "type": "entity",
        "components": { "transform": { "position": [-2,1,1] } } },
      { "op": "edge.create", "from": "scene:orbital", "to": "entity:orbiter-c", "kind": "contains" },
      { "op": "edge.create", "from": "entity:orbiter-c", "to": "script:orbiter", "kind": "runs" }
    ]
  }' | jq .

curl -s http://localhost:4010/api/projects/orbital/export | jq '.files[0].path'
```

## Out of scope (on purpose)

No auth, no asset blobs, no chunking/streaming, no multi-project
listing, no merge resolution. Those belong to a real backend (Spring +
Postgres + object store). What this POC nails down is the *API shape*
so the frontend graph editor + sync adapter can be built against a real
HTTP server today and survive the swap.
