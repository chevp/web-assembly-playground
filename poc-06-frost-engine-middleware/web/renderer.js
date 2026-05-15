// three.js renderer — the frost-engine-api implementation on the web.
//
// Owns the THREE.Scene. One mesh/light/camera per entity, built once
// from parsed components, then re-positioned each frame from the
// engine's transform table.

import * as THREE from "three";

const PLACEHOLDER_GEOMETRY = {
    sphere: () => new THREE.SphereGeometry(0.5, 24, 16),
    box:    () => new THREE.BoxGeometry(1, 1, 1),
    plane:  () => new THREE.PlaneGeometry(10, 10),
};

export class FrostRenderer {
    constructor(canvas, { width = 800, height = 600 } = {}) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0e1116);
        this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
        this.camera.position.set(6, 5, 8);
        this.camera.lookAt(0, 0, 0);

        this.three = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.three.setPixelRatio(window.devicePixelRatio);
        this.three.setSize(width, height, false);

        this.objects = new Map();  // id → { mesh, material? }
    }

    build(parsedScene) {
        for (const entity of parsedScene.entities) {
            for (const comp of entity.components) {
                const obj = this._buildComponent(entity.id, comp);
                if (obj) {
                    this.scene.add(obj);
                    this.objects.set(entity.id, { object3d: obj });
                    break;  // one renderable per entity for the POC
                }
            }
        }
    }

    _buildComponent(entityId, comp) {
        switch (comp.kind) {
            case "mesh": {
                const shape = comp.attrs.shape || "sphere";
                const geom = (PLACEHOLDER_GEOMETRY[shape] || PLACEHOLDER_GEOMETRY.sphere)();
                const color = parseColor(comp.attrs.color || "#ffffff");
                const mat = new THREE.MeshStandardMaterial({
                    color,
                    roughness: 0.4,
                    metalness: 0.1,
                });
                const mesh = new THREE.Mesh(geom, mat);
                mesh.userData.entityId = entityId;
                return mesh;
            }
            case "light": {
                const type = comp.attrs.type || "point";
                const color = parseColor(comp.attrs.color || "#ffffff");
                const intensity = parseFloat(comp.attrs.intensity || "1");
                if (type === "ambient")     return new THREE.AmbientLight(color, intensity);
                if (type === "directional") return new THREE.DirectionalLight(color, intensity);
                return new THREE.PointLight(color, intensity);
            }
            default:
                return null;
        }
    }

    /** Update transforms from the engine's flat table. Called each frame. */
    sync(engine) {
        const n = engine.getEntityCount();
        for (let i = 0; i < n; i++) {
            const id = engine.getEntityId(i);
            const obj = this.objects.get(id);
            if (!obj) continue;
            const o = obj.object3d;
            o.position.set(engine.getX(i), engine.getY(i), engine.getZ(i));
            o.scale.set(engine.getScaleX(i), engine.getScaleY(i), engine.getScaleZ(i));
            if (o.material && o.material.color) {
                o.material.color.set(parseColor(engine.getColor(i)));
            }
        }
    }

    render() {
        this.three.render(this.scene, this.camera);
    }
}

function parseColor(hex) {
    return new THREE.Color(hex);
}
