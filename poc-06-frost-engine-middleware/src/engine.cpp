// poc-06-frost-engine-middleware
//
// Same orchestration model as poc-05 (XML scene + per-entity Lua tick
// scripts driving an engine through a small `frost.*` Lua global), but
// the C++ runtime statically links nuna-middleware (vendored as a git
// submodule under vendor/nuna-middleware) and re-exports its public C
// ABI. The renderer this time is three.js in the browser, fed by the
// same JS-side read-back of (x, y, size, color) plus the middleware's
// 19-float scene_frame triangle for parity with nuna-middleware's own
// WASM smoke test.
//
// The point of the POC is to show that the Lua/XML orchestration story
// (poc-05) and the ADR-029 every-frame compute story (nuna-middleware)
// are independent layers and can coexist in a single WASM module
// without either knowing about the other.

#include <emscripten/emscripten.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "tinyxml2.h"
#include "nuna/middleware/middleware.h"

extern "C" {
#include "lauxlib.h"
#include "lua.h"
#include "lualib.h"
}

using namespace tinyxml2;

struct Entity {
    std::string id;
    float x = 0, y = 0;
    float size = 20;
    std::string color = "#ffffff";
    std::string scriptPath;
    lua_State* L = nullptr;
};

static std::vector<Entity> g_entities;
static lua_State* g_sceneL = nullptr;
static std::string g_sceneId;
static float g_time = 0.0f;

static Entity* findEntity(const std::string& id) {
    for (auto& e : g_entities)
        if (e.id == id) return &e;
    return nullptr;
}

static std::string stripFileUri(const char* uri) {
    if (!uri) return "";
    std::string s = uri;
    const std::string prefix = "file://";
    if (s.rfind(prefix, 0) == 0) s.erase(0, prefix.size());
    return s;
}

// ---------------- frost.* Lua bindings ----------------

static int l_log(lua_State* L) {
    const char* s = luaL_checkstring(L, 1);
    printf("[frost] %s\n", s);
    return 0;
}

static int l_getTime(lua_State* L) {
    lua_pushnumber(L, g_time);
    return 1;
}

static int l_getPosition(lua_State* L) {
    const char* id = luaL_checkstring(L, 1);
    Entity* e = findEntity(id);
    if (!e) {
        lua_pushnumber(L, 0);
        lua_pushnumber(L, 0);
        return 2;
    }
    lua_pushnumber(L, e->x);
    lua_pushnumber(L, e->y);
    return 2;
}

static int l_setPosition(lua_State* L) {
    const char* id = luaL_checkstring(L, 1);
    float x = (float)luaL_checknumber(L, 2);
    float y = (float)luaL_checknumber(L, 3);
    if (Entity* e = findEntity(id)) {
        e->x = x;
        e->y = y;
    }
    return 0;
}

static int l_setSize(lua_State* L) {
    const char* id = luaL_checkstring(L, 1);
    float n = (float)luaL_checknumber(L, 2);
    if (Entity* e = findEntity(id)) e->size = n;
    return 0;
}

static int l_setColor(lua_State* L) {
    const char* id = luaL_checkstring(L, 1);
    const char* c = luaL_checkstring(L, 2);
    if (Entity* e = findEntity(id)) e->color = c;
    return 0;
}

static void registerFrost(lua_State* L, const std::string& selfId) {
    lua_newtable(L);
    lua_pushcfunction(L, l_log);         lua_setfield(L, -2, "log");
    lua_pushcfunction(L, l_getTime);     lua_setfield(L, -2, "getTime");
    lua_pushcfunction(L, l_getPosition); lua_setfield(L, -2, "getPosition");
    lua_pushcfunction(L, l_setPosition); lua_setfield(L, -2, "setPosition");
    lua_pushcfunction(L, l_setSize);     lua_setfield(L, -2, "setSize");
    lua_pushcfunction(L, l_setColor);    lua_setfield(L, -2, "setColor");

    lua_newtable(L);
    lua_pushstring(L, selfId.c_str());
    lua_setfield(L, -2, "id");
    lua_setfield(L, -2, "self");

    lua_setglobal(L, "frost");
}

static lua_State* makeLuaState(const std::string& selfId, const std::string& scriptPath) {
    lua_State* L = luaL_newstate();
    luaL_openlibs(L);
    registerFrost(L, selfId);
    if (!scriptPath.empty()) {
        if (luaL_dofile(L, scriptPath.c_str()) != LUA_OK) {
            fprintf(stderr, "lua load error (%s): %s\n", scriptPath.c_str(), lua_tostring(L, -1));
            lua_pop(L, 1);
        }
    }
    return L;
}

static void callIfFunction(lua_State* L, const char* name, float dt, bool passDt) {
    lua_getglobal(L, name);
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 1);
        return;
    }
    int argc = 0;
    if (passDt) {
        lua_pushnumber(L, dt);
        argc = 1;
    }
    if (lua_pcall(L, argc, 0, 0) != LUA_OK) {
        fprintf(stderr, "lua %s error: %s\n", name, lua_tostring(L, -1));
        lua_pop(L, 1);
    }
}

// ---------------- XML loading ----------------

static bool loadScene(const std::string& scenePath) {
    XMLDocument doc;
    if (doc.LoadFile(scenePath.c_str()) != XML_SUCCESS) {
        fprintf(stderr, "failed to load scene: %s\n", scenePath.c_str());
        return false;
    }
    XMLElement* root = doc.RootElement();
    if (!root) return false;

    XMLElement* scene = root->FirstChildElement("scene");
    if (!scene) {
        fprintf(stderr, "scene.xml has no <scene> element\n");
        return false;
    }
    if (const char* id = scene->Attribute("id")) g_sceneId = id;

    for (XMLElement* ent = scene->FirstChildElement("entity"); ent;
         ent = ent->NextSiblingElement("entity")) {
        Entity e;
        if (const char* id = ent->Attribute("id")) e.id = id;
        ent->QueryFloatAttribute("x", &e.x);
        ent->QueryFloatAttribute("y", &e.y);
        ent->QueryFloatAttribute("size", &e.size);
        if (const char* c = ent->Attribute("color")) e.color = c;
        if (XMLElement* s = ent->FirstChildElement("script"))
            e.scriptPath = stripFileUri(s->Attribute("uri"));
        g_entities.push_back(std::move(e));
    }
    return true;
}

static bool loadRuntime(const std::string& runtimePath, std::string& outScene,
                        std::string& outSceneScript) {
    XMLDocument doc;
    if (doc.LoadFile(runtimePath.c_str()) != XML_SUCCESS) {
        fprintf(stderr, "failed to load runtime: %s\n", runtimePath.c_str());
        return false;
    }
    XMLElement* root = doc.RootElement();
    if (!root) return false;

    XMLElement* renderer = root->FirstChildElement("runtimeRenderer");
    if (!renderer) renderer = root;

    if (XMLElement* s = renderer->FirstChildElement("scene"))
        outScene = stripFileUri(s->Attribute("uri"));

    if (XMLElement* scripts = renderer->FirstChildElement("scripts")) {
        for (XMLElement* s = scripts->FirstChildElement("script"); s;
             s = s->NextSiblingElement("script")) {
            const char* scope = s->Attribute("scope");
            if (scope && std::string(scope) == "scene") {
                outSceneScript = stripFileUri(s->Attribute("uri"));
                break;
            }
        }
    }
    return true;
}

// ---------------- C API exposed to JS ----------------

extern "C" {

EMSCRIPTEN_KEEPALIVE
int engine_init(const char* runtimePath) {
    g_entities.clear();
    g_time = 0;

    std::string scenePath, sceneScriptPath;
    if (!loadRuntime(runtimePath, scenePath, sceneScriptPath)) return -1;
    if (scenePath.empty()) {
        fprintf(stderr, "runtime.xml did not declare a <scene>\n");
        return -1;
    }
    if (!loadScene(scenePath)) return -1;

    for (auto& e : g_entities) e.L = makeLuaState(e.id, e.scriptPath);
    for (auto& e : g_entities) callIfFunction(e.L, "onLoad", 0, false);

    if (!sceneScriptPath.empty()) {
        g_sceneL = makeLuaState(g_sceneId, sceneScriptPath);
        callIfFunction(g_sceneL, "onLoad", 0, false);
    }
    return (int)g_entities.size();
}

EMSCRIPTEN_KEEPALIVE
void engine_tick(float dt) {
    g_time += dt;
    if (g_sceneL) callIfFunction(g_sceneL, "onUpdate", dt, true);
    for (auto& e : g_entities)
        if (e.L) callIfFunction(e.L, "onUpdate", dt, true);
}

EMSCRIPTEN_KEEPALIVE
int engine_get_entity_count() {
    return (int)g_entities.size();
}

EMSCRIPTEN_KEEPALIVE
const char* engine_get_entity_id(int i) {
    if (i < 0 || i >= (int)g_entities.size()) return "";
    return g_entities[i].id.c_str();
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_x(int i) {
    return (i >= 0 && i < (int)g_entities.size()) ? g_entities[i].x : 0;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_y(int i) {
    return (i >= 0 && i < (int)g_entities.size()) ? g_entities[i].y : 0;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_size(int i) {
    return (i >= 0 && i < (int)g_entities.size()) ? g_entities[i].size : 0;
}

EMSCRIPTEN_KEEPALIVE
const char* engine_get_entity_color(int i) {
    return (i >= 0 && i < (int)g_entities.size()) ? g_entities[i].color.c_str() : "";
}

}  // extern "C"
