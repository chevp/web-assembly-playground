// .cryo project-manifest parser (browser DOMParser, no deps).
//
// A .cryo file points at backend + renderer runtime configs and asset
// paths. It is NOT a scene format — scenes live in synth-xml.

export async function loadCryo(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return parseCryo(await res.text());
}

export function parseCryo(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error(`invalid .cryo XML: ${err.textContent}`);

    const project = doc.querySelector("game-project");
    if (!project) throw new Error("missing <game-project> element");

    return {
        version: project.getAttribute("version") || "1.0",
        metadata: parseMetadata(project.querySelector("metadata")),
        backend: parseBinding(project.querySelector("backend")),
        renderer: parseBinding(project.querySelector("renderer")),
        paths: parsePaths(project.querySelector("paths")),
        launcher: parseLauncher(project.querySelector("launcher")),
    };
}

function text(el, tag, fallback = "") {
    return el?.querySelector(tag)?.textContent?.trim() ?? fallback;
}

function bool(el, tag, fallback = false) {
    const v = text(el, tag);
    return v === "" ? fallback : v.toLowerCase() === "true";
}

function parseMetadata(el) {
    return {
        name:        text(el, "name"),
        description: text(el, "description"),
        version:     text(el, "version"),
        author:      text(el, "author"),
        created:     text(el, "created"),
    };
}

function parseBinding(el) {
    if (!el) return null;
    return {
        runtime:        text(el, "runtime"),
        autoStart:      bool(el, "autoStart", true),
        waitForReady:   bool(el, "waitForReady", false),
        startupTimeout: parseFloat(text(el, "startupTimeout", "30")),
    };
}

function parsePaths(el) {
    return {
        assets:     text(el, "assets",     "assets"),
        scenes:     text(el, "scenes",     "assets/scenes"),
        components: text(el, "components", "assets/components"),
        scripts:    text(el, "scripts",    "scripts"),
        data:       text(el, "data",       "data"),
        config:     text(el, "config",     "config"),
    };
}

function parseLauncher(el) {
    return {
        startupOrder:     text(el, "startupOrder", "sequential"),
        showConsole:      bool(el, "showConsole", false),
        workingDirectory: text(el, "workingDirectory", "."),
    };
}
