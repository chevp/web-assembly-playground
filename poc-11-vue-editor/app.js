// poc-11 — Vue 3 + Monaco scene editor.
//
// Same conceptual layout as poc-09/h-tabs: chat on the left, tabs on the
// right (scene canvas + scene.xml + orbit.lua + glow.frag), graph drawer
// at the bottom. What's new:
//
//   • Vue 3 (Composition API, global build) drives all state + DOM.
//   • Monaco Editor replaces the read-only <pre> code views.
//   • Lua and GLSL tabs are editable; their content lives at
//       graph.nodes[script:orbit].components.source
//       graph.nodes[shader:glow].components.source
//     and a Save button bumps graph.version.
//   • scene.xml is a read-only projection — editing it is the wrong
//     abstraction (ADR-034 — files are projections, not storage).
//   • FontAwesome 6 icons in the tab strip.
//
// Boot order: index.html loads Monaco's AMD loader (sets up `require`),
// then Vue (sets up `Vue`), then this module.

import { MiniEngine, CanvasRenderer } from "./engine.js";
import { projectSceneXml } from "./projection.js";

const {
  createApp, ref, reactive, computed,
  onMounted, onBeforeUnmount, watch, nextTick,
} = Vue;

// ---------------------------------------------------------------------------
// Monaco bootstrap
// ---------------------------------------------------------------------------
//
// Wrap Monaco's AMD-style loader in a promise. We also register a minimal
// GLSL Monarch tokenizer because Monaco doesn't ship one out of the box.

const monacoReady = new Promise((resolve, reject) => {
  if (typeof window.require === "undefined") {
    reject(new Error("Monaco AMD loader (vs/loader.js) is not present"));
    return;
  }
  window.require.config({ paths: { vs: "https://unpkg.com/monaco-editor@0.44.0/min/vs" } });
  window.require(["vs/editor/editor.main"], () => {
    try {
      if (!monaco.languages.getLanguages().find((l) => l.id === "glsl")) {
        monaco.languages.register({ id: "glsl" });
        monaco.languages.setMonarchTokensProvider("glsl", GLSL_MONARCH);
      }
    } catch (err) {
      console.warn("GLSL language registration failed:", err);
    }
    resolve(monaco);
  });
});

const GLSL_MONARCH = {
  defaultToken: "",
  keywords: [
    "void", "bool", "int", "uint", "float", "double",
    "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "bvec2", "bvec3", "bvec4",
    "mat2", "mat3", "mat4", "mat2x2", "mat3x3", "mat4x4",
    "in", "out", "inout", "uniform", "varying", "attribute", "const",
    "return", "if", "else", "for", "while", "do", "break", "continue", "discard",
    "precision", "highp", "mediump", "lowp", "layout",
    "sampler2D", "samplerCube", "sampler3D",
    "true", "false",
  ],
  builtins: [
    "gl_Position", "gl_FragColor", "gl_FragCoord", "gl_PointCoord", "gl_PointSize",
    "texture", "texture2D", "textureCube",
    "length", "normalize", "dot", "cross", "mix", "smoothstep", "step",
    "sin", "cos", "tan", "atan", "abs", "pow", "exp", "log", "sqrt", "min", "max", "clamp",
    "floor", "ceil", "fract", "mod",
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  tokenizer: {
    root: [
      [/#[a-zA-Z_][\w]*.*$/, "keyword.directive"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/[a-zA-Z_][\w]*/, {
        cases: {
          "@keywords": "keyword",
          "@builtins": "type.identifier",
          "@default": "identifier",
        },
      }],
      [/\d+\.\d+([eE][\-+]?\d+)?[fFlL]?/, "number.float"],
      [/\d+[uUlL]?/, "number"],
      [/[{}()\[\]]/, "@brackets"],
      [/[;,.]/, "delimiter"],
      [/@symbols/, "operator"],
      [/"([^"\\]|\\.)*"/, "string"],
    ],
    comment: [
      [/[^\/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[\/*]/, "comment"],
    ],
  },
};

// ---------------------------------------------------------------------------
// Seed content for the script + shader nodes — pre-filled so the Monaco
// editors have something meaningful to edit on first load.
// ---------------------------------------------------------------------------

const INITIAL_LUA = `-- orbit.lua — shared orbiter script.
--
-- Reads per-entity scriptProps (radius, speed) from frost.self.props
-- and writes back through frost.setPosition. Every entity edged to
-- script:orbit with kind="runs" runs this same file — the per-orbit
-- numbers are data on the entity, not a fork of the script.

local id = frost.self.id
local r  = frost.self.props.radius or 1.0
local sp = frost.self.props.speed  or 1.0

function onLoad()
    frost.log("orbit " .. id .. " r=" .. r .. " v=" .. sp)
end

function onUpdate(dt)
    local t = frost.getTime() * sp
    frost.setPosition(id, math.cos(t) * r, 0.0, math.sin(t) * r)
end
`;

const INITIAL_GLSL = `// glow.frag — radial glow used by every <mesh shader="shader:glow">.
//
// One shader node, many entity→shader edges with kind="uses". The
// per-instance differentiator is the uColor uniform the renderer
// pushes per frame.

#version 300 es
precision highp float;

in  vec2 vUV;
in  vec3 vNormal;

uniform float uTime;
uniform vec3  uColor;

out vec4 fragColor;

void main() {
    vec2  c     = vUV - 0.5;
    float d     = length(c);
    float glow  = smoothstep(0.5, 0.0, d);
    float pulse = 0.85 + 0.15 * sin(uTime * 2.0);

    vec3 base = uColor * 0.4;
    vec3 col  = mix(base, uColor, glow * pulse);
    fragColor = vec4(col, glow * pulse);
}
`;

// ---------------------------------------------------------------------------
// Initial graph snapshot. ADR-034: this is the truth.
// ---------------------------------------------------------------------------

function initialGraph() {
  return {
    version: 1,
    nodes: [
      { id: "scene:orbital", type: "scene",  components: { name: "Orbital Demo (Vue + Monaco)" } },
      { id: "script:orbit",  type: "script", components: { language: "lua",  uri: "scripts/orbit.lua", source: INITIAL_LUA } },
      { id: "shader:glow",   type: "shader", components: { language: "glsl", stage: "fragment", uri: "shaders/glow.frag", source: INITIAL_GLSL } },
      { id: "entity:sun",    type: "entity", components: {
          transform: { position: [0, 0, 0], scale: [1.4, 1.4, 1.4] },
          mesh:      { shape: "sphere", color: "#ffe66d", shader: "shader:glow" },
      } },
    ],
    edges: [
      { from: "scene:orbital", to: "entity:sun", kind: "contains" },
      { from: "entity:sun",    to: "shader:glow", kind: "uses" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tabs metadata. FontAwesome 6 free has fa-globe / fa-code / fa-moon /
// fa-bolt — picked so the four tab kinds read at a glance.
// ---------------------------------------------------------------------------

const TABS = [
  { id: "scene", label: "scene",     path: "preview",                icon: "fa-solid fa-globe",     kind: "live"    },
  { id: "xml",   label: "scene.xml", path: "games/orbital/",         icon: "fa-solid fa-code",      kind: "xml"     },
  { id: "lua",   label: "orbit.lua", path: "games/orbital/scripts/", icon: "fa-solid fa-moon",      kind: "lua"     },
  { id: "glsl",  label: "glow.frag", path: "games/orbital/shaders/", icon: "fa-solid fa-bolt",      kind: "glsl"    },
];

// ---------------------------------------------------------------------------
// MonacoEditor component — v-model bound, dispose on unmount.
// ---------------------------------------------------------------------------

const MonacoEditor = {
  props: {
    modelValue: { type: String, default: "" },
    language:   { type: String, default: "plaintext" },
    readOnly:   { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  template: `<div ref="container" class="monaco-host"></div>`,
  setup(props, { emit }) {
    const container = ref(null);
    let editor = null;
    let model  = null;
    let suppressing = false;

    onMounted(async () => {
      try {
        await monacoReady;
        model = monaco.editor.createModel(props.modelValue, props.language);
        editor = monaco.editor.create(container.value, {
          model,
          theme: "vs-dark",
          readOnly: props.readOnly,
          fontSize: 12,
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          tabSize: 2,
          renderWhitespace: "selection",
          wordWrap: "off",
        });
        model.onDidChangeContent(() => {
          if (suppressing) return;
          emit("update:modelValue", model.getValue());
        });
      } catch (err) {
        container.value.innerHTML = "";
        const div = document.createElement("div");
        div.className = "monaco-error";
        div.textContent =
          "Monaco failed to load: " + String((err && err.message) || err) +
          "\n\n(this view falls back to the source-of-truth in the drawer below)";
        container.value.appendChild(div);
      }
    });

    watch(() => props.modelValue, (val) => {
      if (model && model.getValue() !== val) {
        suppressing = true;
        model.setValue(val);
        suppressing = false;
      }
    });

    watch(() => props.readOnly, (val) => {
      if (editor) editor.updateOptions({ readOnly: val });
    });

    onBeforeUnmount(() => {
      if (editor) { editor.dispose(); editor = null; }
      if (model)  { model.dispose();  model  = null; }
    });

    return { container };
  },
};

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

const App = {
  components: { MonacoEditor },

  template: `
    <div class="app-shell">
      <!-- ============== LEFT: chat ============== -->
      <div class="chat">
        <div class="chat-head">
          poc-11 <b>vue + monaco</b> &middot; chat &rarr; graph &rarr; projections
          <span class="live">running</span>
        </div>

        <div class="thread" ref="threadEl">
          <div v-for="(m, i) in messages" :key="i" :class="['msg', m.who, m.thinking ? 'thinking' : '']">
            <div class="who">{{ m.who === 'you' ? 'you' : 'assistant' }}</div>
            <div class="body" v-html="m.html"></div>
          </div>

          <div class="chips" v-if="currentStep">
            <button class="chip" @click="runCurrentStep">{{ currentStep.prompt }}</button>
          </div>
        </div>

        <div class="composer">
          <div class="box">
            <textarea
              v-model="composerText"
              rows="1"
              :placeholder="composerDisabled ? '(canned demo finished)' : 'describe a change…'"
              :disabled="composerDisabled"
              @keydown.enter.exact.prevent="sendFreeText"
              ref="promptEl"
            ></textarea>
            <button type="button" @click="sendFreeText" :disabled="composerDisabled">send</button>
          </div>
          <div class="hint">
            files on the right are <em>projections</em> of the graph &middot; the graph is truth
          </div>
        </div>
      </div>

      <!-- ============== RIGHT: tabs + active pane + drawer ============== -->
      <div class="right">
        <div class="tabs">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :class="['tab', tab.id, currentTab === tab.id ? 'active' : '']"
            @click="currentTab = tab.id"
          >
            <i :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
            <span class="ver-pill" v-if="tab.id === 'xml'">v{{ graph.version }}</span>
            <span class="badge-dot" v-if="dirtyTabs[tab.id]" title="unsaved edits"></span>
          </button>
        </div>

        <div class="panes">
          <!-- ===== SCENE ===== -->
          <div class="pane" :hidden="currentTab !== 'scene'">
            <div class="preview-bar">
              <div class="left">
                <span class="dot"></span>
                <span class="title">scene:orbital</span>
                <span class="meta">{{ status }}</span>
              </div>
              <div class="right">canvas2d &middot; in-process tick</div>
            </div>
            <div class="stage">
              <canvas ref="canvasEl" width="800" height="600"></canvas>
            </div>
          </div>

          <!-- ===== scene.xml (read-only projection) ===== -->
          <div class="pane" :hidden="currentTab !== 'xml'">
            <div class="code-head">
              <span class="path"><span class="dir">{{ tab('xml').path }}</span>{{ tab('xml').label }}</span>
              <div class="right">
                <span class="badge live">live projection · re-derived per graph version</span>
                <span class="badge readonly">read-only · edit the graph instead</span>
              </div>
            </div>
            <monaco-editor
              :model-value="xmlSource"
              language="xml"
              :read-only="true"
            />
          </div>

          <!-- ===== orbit.lua (editable, writes to script:orbit.components.source) ===== -->
          <div class="pane" :hidden="currentTab !== 'lua'">
            <div class="code-head">
              <span class="path"><span class="dir">{{ tab('lua').path }}</span>{{ tab('lua').label }}</span>
              <div class="right">
                <span class="badge editable">editable · bound to script:orbit.components.source</span>
                <button class="save-btn" :class="{ flash: savedFlash === 'lua' }" @click="saveLua">
                  <i class="fa-solid fa-floppy-disk"></i>
                  {{ savedFlash === 'lua' ? 'saved' : 'save' }}
                </button>
              </div>
            </div>
            <monaco-editor
              v-model="luaSource"
              language="lua"
              @update:model-value="dirtyTabs.lua = true"
            />
          </div>

          <!-- ===== glow.frag (editable, writes to shader:glow.components.source) ===== -->
          <div class="pane" :hidden="currentTab !== 'glsl'">
            <div class="code-head">
              <span class="path"><span class="dir">{{ tab('glsl').path }}</span>{{ tab('glsl').label }}</span>
              <div class="right">
                <span class="badge editable">editable · bound to shader:glow.components.source</span>
                <button class="save-btn" :class="{ flash: savedFlash === 'glsl' }" @click="saveGlsl">
                  <i class="fa-solid fa-floppy-disk"></i>
                  {{ savedFlash === 'glsl' ? 'saved' : 'save' }}
                </button>
              </div>
            </div>
            <monaco-editor
              v-model="glslSource"
              language="glsl"
              @update:model-value="dirtyTabs.glsl = true"
            />
          </div>
        </div>

        <div :class="['drawer', drawerOpen ? 'open' : '']">
          <div class="head" @click="drawerOpen = !drawerOpen">
            <div class="left">
              <span class="chev">&rsaquo;</span>
              <span>show source</span>
              <span class="fmt">graph-json/v1</span>
              <span class="badge">truth (not a file)</span>
            </div>
            <span class="ver">version {{ graph.version }}</span>
          </div>
          <div class="body"><pre>{{ graphJsonPretty }}</pre></div>
        </div>
      </div>

      <!-- floating toast -->
      <div class="toast" v-if="toast">{{ toast }}</div>
    </div>
  `,

  setup() {
    const graph        = reactive(initialGraph());
    const currentTab   = ref("scene");
    const messages     = ref([]);
    const composerText = ref("");
    const stepIdx      = ref(0);
    const drawerOpen   = ref(false);
    const dirtyTabs    = reactive({ lua: false, glsl: false });
    const savedFlash   = ref(null);
    const toast        = ref(null);

    const canvasEl  = ref(null);
    const threadEl  = ref(null);
    const promptEl  = ref(null);

    // Engine state (independent of Vue reactivity — its own per-frame loop)
    const engine    = new MiniEngine();
    let   renderer  = null;
    const labels    = new Map([["entity:sun", "sun"]]);
    const ringRadii = new Map();
    let   rafId     = null;

    engine.addEntity("entity:sun");
    engine.setColor("entity:sun", "#ffe66d");
    engine.setScale("entity:sun", 1.4, 1.4, 1.4);

    // ----- Computed views over the graph -----
    const xmlSource       = computed(() => projectSceneXml(graph));
    const graphJsonPretty = computed(() => JSON.stringify(graph, null, 2));
    const status          = computed(() => `${graph.nodes.length} nodes · ${graph.edges.length} edges · version ${graph.version}`);

    // Two-way bindings for the editable script + shader source.
    // Reads/writes a specific node's components.source — typing in Monaco
    // updates the graph immediately. Version is only bumped on Save.
    const luaSource = computed({
      get: () => graph.nodes.find((n) => n.id === "script:orbit")?.components?.source ?? "",
      set: (v) => {
        const n = graph.nodes.find((x) => x.id === "script:orbit");
        if (n) n.components.source = v;
      },
    });
    const glslSource = computed({
      get: () => graph.nodes.find((n) => n.id === "shader:glow")?.components?.source ?? "",
      set: (v) => {
        const n = graph.nodes.find((x) => x.id === "shader:glow");
        if (n) n.components.source = v;
      },
    });

    function tab(id) { return TABS.find((t) => t.id === id) || {}; }

    // ----- Graph mutation helpers -----
    function addNode(n) { graph.nodes.push(n); graph.version++; }
    function addEdge(e) { graph.edges.push(e); graph.version++; }
    function patchNode(id, patch) {
      const n = graph.nodes.find((x) => x.id === id);
      if (n) {
        n.components = { ...n.components, ...patch };
        graph.version++;
      }
    }

    // ----- Save buttons -----
    function saveLua()  { graph.version++; dirtyTabs.lua  = false; flash("lua",  `saved scripts/orbit.lua → script:orbit.components.source (v${graph.version})`); }
    function saveGlsl() { graph.version++; dirtyTabs.glsl = false; flash("glsl", `saved shaders/glow.frag → shader:glow.components.source (v${graph.version})`); }
    function flash(which, msg) {
      savedFlash.value = which;
      toast.value = msg;
      setTimeout(() => { if (savedFlash.value === which) savedFlash.value = null; }, 1200);
      setTimeout(() => { if (toast.value === msg) toast.value = null; }, 2400);
    }

    // ----- Orbit closure (stand-in for the Lua at runtime) -----
    function makeOrbit(r, speed) {
      return (e, t) => {
        const a = t * speed;
        e.x = Math.cos(a) * r;
        e.z = Math.sin(a) * r;
      };
    }

    // ----- Canned chat steps -----
    const steps = [
      {
        prompt: "add a red planet at radius 3",
        reply:  `Added <span class="ref">entity:planet-red</span> at radius 3. Flip to <span class="tag">scene.xml</span> on the right — the projection just grew an &lt;entity&gt; block. <span class="ref">orbit.lua</span> didn't change: same file, shared by edge.`,
        apply() {
          const id = "entity:planet-red";
          engine.addEntity(id);
          engine.setColor(id, "#ff6b6b");
          engine.setScale(id, 0.45, 0.45, 0.45);
          engine.attachUpdate(id, makeOrbit(3.0, 1.0));
          labels.set(id, "planet-red · r=3");
          ringRadii.set(id, 3.0);
          addNode({ id, type: "entity", components: {
            transform:   { position: [3, 0, 0], scale: [0.45, 0.45, 0.45] },
            mesh:        { shape: "sphere", color: "#ff6b6b", shader: "shader:glow" },
            scriptProps: { radius: 3.0, speed: 1.0 },
          }});
          addEdge({ from: "scene:orbital", to: id, kind: "contains" });
          addEdge({ from: id, to: "script:orbit", kind: "runs" });
          addEdge({ from: id, to: "shader:glow",  kind: "uses" });
        },
      },
      {
        prompt: "add a teal one further out, twice as fast",
        reply:  `Added <span class="ref">entity:planet-teal</span> at r=4.5, <span class="tag">speed 2.0</span>. <span class="ref">orbit.lua</span> stays one file.`,
        apply() {
          const id = "entity:planet-teal";
          engine.addEntity(id);
          engine.setColor(id, "#4ecdc4");
          engine.setScale(id, 0.4, 0.4, 0.4);
          engine.attachUpdate(id, makeOrbit(4.5, 2.0));
          labels.set(id, "planet-teal · r=4.5");
          ringRadii.set(id, 4.5);
          addNode({ id, type: "entity", components: {
            transform:   { position: [4.5, 0, 0], scale: [0.4, 0.4, 0.4] },
            mesh:        { shape: "sphere", color: "#4ecdc4", shader: "shader:glow" },
            scriptProps: { radius: 4.5, speed: 2.0 },
          }});
          addEdge({ from: "scene:orbital", to: id, kind: "contains" });
          addEdge({ from: id, to: "script:orbit", kind: "runs" });
          addEdge({ from: id, to: "shader:glow",  kind: "uses" });
        },
      },
      {
        prompt: "add a slow purple one far out",
        reply:  `Added <span class="ref">entity:planet-purple</span> at r=7, <span class="tag">speed 0.4</span>. Three planets share one Lua file and one fragment shader — edges, not folders.`,
        apply() {
          const id = "entity:planet-purple";
          engine.addEntity(id);
          engine.setColor(id, "#a78bfa");
          engine.setScale(id, 0.55, 0.55, 0.55);
          engine.attachUpdate(id, makeOrbit(7.0, 0.4));
          labels.set(id, "planet-purple · r=7");
          ringRadii.set(id, 7.0);
          addNode({ id, type: "entity", components: {
            transform:   { position: [7, 0, 0], scale: [0.55, 0.55, 0.55] },
            mesh:        { shape: "sphere", color: "#a78bfa", shader: "shader:glow" },
            scriptProps: { radius: 7.0, speed: 0.4 },
          }});
          addEdge({ from: "scene:orbital", to: id, kind: "contains" });
          addEdge({ from: id, to: "script:orbit", kind: "runs" });
          addEdge({ from: id, to: "shader:glow",  kind: "uses" });
        },
      },
      {
        prompt: "make the red one bigger",
        reply:  `Bumped <span class="ref">entity:planet-red</span> scale to <span class="tag">0.9</span>. Same node, transform patched. Compare scene.xml before and after — only that &lt;entity&gt; changed.`,
        apply() {
          engine.setScale("entity:planet-red", 0.9, 0.9, 0.9);
          patchNode("entity:planet-red", {
            transform:   { position: [3, 0, 0], scale: [0.9, 0.9, 0.9] },
            mesh:        { shape: "sphere", color: "#ff6b6b", shader: "shader:glow" },
            scriptProps: { radius: 3.0, speed: 1.0 },
          });
        },
      },
    ];

    const currentStep = computed(() => steps[stepIdx.value] || null);
    const composerDisabled = computed(() => stepIdx.value >= steps.length);

    function pushMsg(m) {
      messages.value.push(m);
      nextTick(() => {
        if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight;
      });
    }

    function runCurrentStep() {
      const step = steps[stepIdx.value];
      if (!step) return;
      pushMsg({ who: "you", html: escapeHtml(step.prompt) });
      pushMsg({ who: "ai",  html: "applying", thinking: true });
      setTimeout(() => {
        const idx = messages.value.findIndex((m) => m.thinking);
        if (idx >= 0) messages.value.splice(idx, 1);
        try { step.apply(); }
        catch (err) {
          pushMsg({ who: "ai", html: `engine call failed: <code>${escapeHtml(String(err && err.message || err))}</code>` });
          return;
        }
        pushMsg({ who: "ai", html: step.reply });
        stepIdx.value++;
        if (stepIdx.value >= steps.length) {
          pushMsg({ who: "ai", html: `Canned walk-through finished. Try editing <span class="ref">orbit.lua</span> or <span class="ref">glow.frag</span> on the right — saves write back to the graph nodes' <code>components.source</code>.` });
        }
      }, 420);
    }

    function sendFreeText() {
      const txt = composerText.value.trim();
      if (!txt) return;
      pushMsg({ who: "you", html: escapeHtml(txt) });
      pushMsg({ who: "ai",  html: "(free-text isn't wired to a model in this POC — use the suggested chip below the thread)" });
      composerText.value = "";
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // ----- Mount: greet, set up render loop -----
    onMounted(() => {
      pushMsg({
        who: "ai",
        html: `Vue + Monaco editor is up. The right pane has four tabs: <span class="ref">scene</span> (canvas), <span class="ref">scene.xml</span> (live projection, read-only), <span class="ref">orbit.lua</span> and <span class="ref">glow.frag</span> (editable, bound to their nodes' <code>components.source</code>). Pick a prompt below to add a planet — then click the lua tab and edit the script.`,
      });

      // Canvas is always present in DOM thanks to v-show via :hidden;
      // but it lives inside the scene pane, which has display:none when
      // not active. The renderer still paints to its bitmap — the pixels
      // just aren't visible until the tab is shown. Cheap.
      nextTick(() => {
        if (canvasEl.value) {
          renderer = new CanvasRenderer(canvasEl.value);
          let last = performance.now();
          const loop = (now) => {
            const dt = Math.min((now - last) / 1000, 0.1);
            last = now;
            engine.tick(dt);
            if (renderer) {
              renderer.clear();
              for (const r of ringRadii.values()) renderer.ring(r);
              for (const e of engine.iter()) renderer.drawEntity(e, { label: labels.get(e.id) });
            }
            rafId = requestAnimationFrame(loop);
          };
          rafId = requestAnimationFrame(loop);
        }
      });
    });

    onBeforeUnmount(() => {
      if (rafId != null) cancelAnimationFrame(rafId);
    });

    return {
      graph, currentTab, messages, composerText, stepIdx, drawerOpen,
      dirtyTabs, savedFlash, toast,
      xmlSource, luaSource, glslSource, graphJsonPretty, status,
      currentStep, composerDisabled,
      tabs: TABS, tab,
      saveLua, saveGlsl,
      runCurrentStep, sendFreeText,
      canvasEl, threadEl, promptEl,
    };
  },
};

createApp(App).mount("#root");
