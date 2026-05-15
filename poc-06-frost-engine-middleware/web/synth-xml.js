// synth-xml parser — runtime config, scenes, and components with
// componentRef composition. Browser-native DOMParser, no deps.
//
// Mirrors the API shape of synth-playground's SynthXmlParser.js so
// scenes authored against this POC are portable to the bigger client.

export class SynthXmlParser {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
        this.componentCache = new Map();
    }

    async loadRuntime(relPath) {
        const root = await this._fetchRoot(relPath);
        const renderer = root.querySelector("renderer");
        const scene = root.querySelector("scene");
        return {
            renderer: {
                api: renderer?.querySelector("api")?.getAttribute("type") || "three.js",
                width:  parseInt(renderer?.querySelector("window")?.getAttribute("width")  || "800", 10),
                height: parseInt(renderer?.querySelector("window")?.getAttribute("height") || "600", 10),
            },
            sceneUri: scene?.getAttribute("uri") || null,
        };
    }

    async loadScene(relPath) {
        const root = await this._fetchRoot(relPath);
        const scene = root.querySelector("scene");
        if (!scene) throw new Error(`no <scene> in ${relPath}`);

        const entities = [];
        for (const el of scene.querySelectorAll(":scope > entities > entity")) {
            entities.push(await this._parseEntity(el));
        }
        return {
            id: scene.getAttribute("id") || "unnamed",
            name: scene.getAttribute("name") || scene.getAttribute("id") || "",
            entities,
        };
    }

    async _parseEntity(el) {
        const id = el.getAttribute("id");
        const componentRef = el.getAttribute("componentRef");

        // Base from componentRef (if any), then overlay entity-local fields.
        const base = componentRef ? await this._loadComponent(componentRef) : {};

        const transform = parseTransform(el.querySelector(":scope > transform"));
        const componentsEl = el.querySelector(":scope > components");
        const components = componentsEl ? parseComponents(componentsEl) : [];

        const scriptEl = el.querySelector(":scope > script");
        const scriptUri = scriptEl?.getAttribute("uri") || base.scriptUri || null;

        return {
            id,
            componentRef,
            transform: transform || base.transform || defaultTransform(),
            components: components.length ? components : (base.components || []),
            scriptUri,
            properties: { ...(base.properties || {}) },
        };
    }

    async _loadComponent(ref) {
        if (this.componentCache.has(ref)) return this.componentCache.get(ref);

        const root = await this._fetchRoot(ref);
        const comp = root.querySelector("component");
        if (!comp) throw new Error(`no <component> in ${ref}`);

        const scriptUri = comp.querySelector(":scope > script")?.getAttribute("uri") || null;
        const componentsEl = comp.querySelector(":scope > components");
        const components = componentsEl ? parseComponents(componentsEl) : [];

        const properties = {};
        for (const prop of comp.querySelectorAll(":scope > properties > property")) {
            const name = prop.getAttribute("name");
            const value = parsePropertyValue(prop.getAttribute("type"), prop.getAttribute("value"));
            properties[name] = value;
        }

        const parsed = { scriptUri, components, properties };
        this.componentCache.set(ref, parsed);
        return parsed;
    }

    async _fetchRoot(relPath) {
        const url = this.baseUrl + relPath;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
        const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
        const err = doc.querySelector("parsererror");
        if (err) throw new Error(`invalid XML in ${relPath}: ${err.textContent}`);
        return doc.documentElement;  // <synth> wrapper
    }

    async fetchText(relPath) {
        const url = this.baseUrl + relPath;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
        return res.text();
    }
}

function defaultTransform() {
    return { position: {x: 0, y: 0, z: 0}, scale: {x: 1, y: 1, z: 1} };
}

function parseTransform(el) {
    if (!el) return null;
    return {
        position: parseVec3(el.getAttribute("position"), 0),
        scale:    parseVec3(el.getAttribute("scale"),    1),
    };
}

function parseVec3(str, fallback) {
    if (!str) return { x: fallback, y: fallback, z: fallback };
    const parts = str.split(",").map(s => parseFloat(s.trim()));
    return {
        x: Number.isFinite(parts[0]) ? parts[0] : fallback,
        y: Number.isFinite(parts[1]) ? parts[1] : fallback,
        z: Number.isFinite(parts[2]) ? parts[2] : fallback,
    };
}

function parseComponents(el) {
    const out = [];
    for (const child of el.children) {
        const attrs = {};
        for (const a of child.attributes) attrs[a.name] = a.value;
        out.push({ kind: child.tagName, attrs });
    }
    return out;
}

function parsePropertyValue(type, raw) {
    if (raw == null) return null;
    switch ((type || "string").toLowerCase()) {
        case "float":
        case "double":
        case "number": return parseFloat(raw);
        case "int":
        case "integer": return parseInt(raw, 10);
        case "bool":
        case "boolean": return raw.toLowerCase() === "true";
        default: return raw;
    }
}
