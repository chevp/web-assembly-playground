// graph-json → synth-xml projection. Pure function: feed the graph, get
// a string back. Boundary per ADR-034: the graph is truth; this is one
// of several possible file projections.
//
// External .js file, so the literal `</script>` close-tag string used
// inside the function body is fine — only inline <script> blocks need
// the `<\/script>` escape trick.

export function projectSceneXml(graph) {
  const scene = graph.nodes.find((n) => n.type === "scene");
  if (!scene) return "";

  const containsEdges = graph.edges.filter((e) => e.from === scene.id && e.kind === "contains");
  const out = [];

  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<synth version="1.0">');
  out.push(`<scene id="${scene.id}" name="${(scene.components && scene.components.name) || scene.id}">`);
  out.push("  <entities>");

  for (const edge of containsEdges) {
    const ent = graph.nodes.find((n) => n.id === edge.to);
    if (!ent) continue;
    const c = ent.components || {};
    const t = c.transform;
    const m = c.mesh;
    const sp = c.scriptProps;

    const scriptEdge = graph.edges.find((eg) => eg.from === ent.id && eg.kind === "runs");
    const scriptNode = scriptEdge && graph.nodes.find((n) => n.id === scriptEdge.to);

    out.push(`    <entity id="${ent.id}">`);

    if (t) {
      const pos = (t.position || [0, 0, 0]).join(",");
      const scl = (t.scale || [1, 1, 1]).join(",");
      out.push(`      <transform position="${pos}" scale="${scl}"/>`);
    }

    if (m) {
      out.push("      <components>");
      out.push(
        `        <mesh shape="${m.shape || "sphere"}" color="${m.color || "#ffffff"}"${
          m.shader ? ` shader="${m.shader}"` : ""
        }/>`,
      );
      out.push("      </components>");
    }

    if (scriptNode) {
      const uri = (scriptNode.components && scriptNode.components.uri) || "scripts/unknown.lua";
      if (sp && Object.keys(sp).length) {
        out.push(`      <script uri="${uri}">`);
        for (const [k, v] of Object.entries(sp)) {
          out.push(`        <property name="${k}" value="${v}"/>`);
        }
        out.push("      </script>");
      } else {
        out.push(`      <script uri="${uri}"/>`);
      }
    }

    out.push("    </entity>");
  }

  out.push("  </entities>");
  out.push("</scene>");
  out.push("</synth>");

  return out.join("\n");
}
