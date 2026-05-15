// poc-06-frost-engine-middleware
//
// WASM runtime: per-entity Lua state + scene transform table. No XML
// parsing inside the wasm — JS parses .cryo + synth-xml + components,
// then uploads entities and Lua tick scripts through the C ABI below.
//
// Side-by-side with nuna-middleware: both ABIs are exported from the
// same wasm. The two layers do not call each other; the renderer pulls
// engine transforms each frame and middleware's flat scene_frame each
// frame as independent data sources.

#include <emscripten/emscripten.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <unordered_map>
#include <vector>

#include "nuna/middleware/middleware.h"

extern "C" {
#include "lauxlib.h"
#include "lua.h"
#include "lualib.h"
}

struct Vec3 {
    float x = 0, y = 0, z = 0;
};

struct Entity {
    std::string id;
    Vec3 position;
    Vec3 scale{1, 1, 1};
    std::string color = "#ffffff";
    std::unordered_map<std::string, double> props;
    lua_State* L = nullptr;
};

static std::vector<Entity> g_entities;
static std::unordered_map<std::string, size_t> g_index;
static float g_time = 0.0f;

static Entity* findEntity(const std::string& id) {
    auto it = g_index.find(id);
    return (it == g_index.end()) ? nullptr : &g_entities[it->second];
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
    Entity* e = findEntity(luaL_checkstring(L, 1));
    if (!e) {
        lua_pushnumber(L, 0); lua_pushnumber(L, 0); lua_pushnumber(L, 0);
        return 3;
    }
    lua_pushnumber(L, e->position.x);
    lua_pushnumber(L, e->position.y);
    lua_pushnumber(L, e->position.z);
    return 3;
}

static int l_setPosition(lua_State* L) {
    const char* id = luaL_checkstring(L, 1);
    float x = (float)luaL_checknumber(L, 2);
    float y = (float)luaL_checknumber(L, 3);
    float z = (float)luaL_checknumber(L, 4);
    if (Entity* e = findEntity(id)) e->position = {x, y, z};
    return 0;
}

static int l_getScale(lua_State* L) {
    Entity* e = findEntity(luaL_checkstring(L, 1));
    if (!e) {
        lua_pushnumber(L, 1); lua_pushnumber(L, 1); lua_pushnumber(L, 1);
        return 3;
    }
    lua_pushnumber(L, e->scale.x);
    lua_pushnumber(L, e->scale.y);
    lua_pushnumber(L, e->scale.z);
    return 3;
}

static int l_setScale(lua_State* L) {
    const char* id = luaL_checkstring(L, 1);
    float x = (float)luaL_checknumber(L, 2);
    float y = (float)luaL_checknumber(L, 3);
    float z = (float)luaL_checknumber(L, 4);
    if (Entity* e = findEntity(id)) e->scale = {x, y, z};
    return 0;
}

static int l_setColor(lua_State* L) {
    const char* id = luaL_checkstring(L, 1);
    const char* c = luaL_checkstring(L, 2);
    if (Entity* e = findEntity(id)) e->color = c;
    return 0;
}

static void pushPropsTable(lua_State* L, const Entity& e) {
    lua_newtable(L);
    for (const auto& kv : e.props) {
        lua_pushnumber(L, kv.second);
        lua_setfield(L, -2, kv.first.c_str());
    }
}

static void registerFrost(lua_State* L, const Entity& self) {
    lua_newtable(L);
    lua_pushcfunction(L, l_log);         lua_setfield(L, -2, "log");
    lua_pushcfunction(L, l_getTime);     lua_setfield(L, -2, "getTime");
    lua_pushcfunction(L, l_getPosition); lua_setfield(L, -2, "getPosition");
    lua_pushcfunction(L, l_setPosition); lua_setfield(L, -2, "setPosition");
    lua_pushcfunction(L, l_getScale);    lua_setfield(L, -2, "getScale");
    lua_pushcfunction(L, l_setScale);    lua_setfield(L, -2, "setScale");
    lua_pushcfunction(L, l_setColor);    lua_setfield(L, -2, "setColor");

    // frost.self = { id = "...", props = { … } }
    lua_newtable(L);
    lua_pushstring(L, self.id.c_str());
    lua_setfield(L, -2, "id");
    pushPropsTable(L, self);
    lua_setfield(L, -2, "props");
    lua_setfield(L, -2, "self");

    lua_setglobal(L, "frost");
}

static void callIfFunction(lua_State* L, const char* name, float dt, bool passDt) {
    lua_getglobal(L, name);
    if (!lua_isfunction(L, -1)) { lua_pop(L, 1); return; }
    int argc = 0;
    if (passDt) { lua_pushnumber(L, dt); argc = 1; }
    if (lua_pcall(L, argc, 0, 0) != LUA_OK) {
        fprintf(stderr, "lua %s error: %s\n", name, lua_tostring(L, -1));
        lua_pop(L, 1);
    }
}

// ---------------- C ABI exposed to JS ----------------

extern "C" {

EMSCRIPTEN_KEEPALIVE
void engine_init(void) {
    for (auto& e : g_entities) if (e.L) lua_close(e.L);
    g_entities.clear();
    g_index.clear();
    g_time = 0;
}

EMSCRIPTEN_KEEPALIVE
int engine_add_entity(const char* id) {
    if (!id || g_index.count(id)) return -1;
    Entity e;
    e.id = id;
    g_entities.push_back(std::move(e));
    g_index[id] = g_entities.size() - 1;
    return (int)(g_entities.size() - 1);
}

EMSCRIPTEN_KEEPALIVE
void engine_set_position(const char* id, float x, float y, float z) {
    if (Entity* e = findEntity(id)) e->position = {x, y, z};
}

EMSCRIPTEN_KEEPALIVE
void engine_set_scale(const char* id, float sx, float sy, float sz) {
    if (Entity* e = findEntity(id)) e->scale = {sx, sy, sz};
}

EMSCRIPTEN_KEEPALIVE
void engine_set_color(const char* id, const char* hex) {
    if (Entity* e = findEntity(id)) e->color = hex ? hex : "#ffffff";
}

EMSCRIPTEN_KEEPALIVE
void engine_set_property(const char* id, const char* name, double value) {
    if (Entity* e = findEntity(id)) e->props[name] = value;
}

EMSCRIPTEN_KEEPALIVE
int engine_attach_script(const char* id, const char* lua_source) {
    Entity* e = findEntity(id);
    if (!e) return -1;
    if (e->L) lua_close(e->L);
    e->L = luaL_newstate();
    luaL_openlibs(e->L);
    registerFrost(e->L, *e);
    if (lua_source && *lua_source) {
        if (luaL_dostring(e->L, lua_source) != LUA_OK) {
            fprintf(stderr, "lua load (%s): %s\n", id, lua_tostring(e->L, -1));
            lua_pop(e->L, 1);
            return -2;
        }
        callIfFunction(e->L, "onLoad", 0, false);
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void engine_tick(float dt) {
    g_time += dt;
    for (auto& e : g_entities)
        if (e.L) callIfFunction(e.L, "onUpdate", dt, true);
}

EMSCRIPTEN_KEEPALIVE
int engine_get_entity_count(void) { return (int)g_entities.size(); }

EMSCRIPTEN_KEEPALIVE
const char* engine_get_entity_id(int i) {
    return (i >= 0 && (size_t)i < g_entities.size()) ? g_entities[i].id.c_str() : "";
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_x(int i) {
    return (i >= 0 && (size_t)i < g_entities.size()) ? g_entities[i].position.x : 0;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_y(int i) {
    return (i >= 0 && (size_t)i < g_entities.size()) ? g_entities[i].position.y : 0;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_z(int i) {
    return (i >= 0 && (size_t)i < g_entities.size()) ? g_entities[i].position.z : 0;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_scale_x(int i) {
    return (i >= 0 && (size_t)i < g_entities.size()) ? g_entities[i].scale.x : 1;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_scale_y(int i) {
    return (i >= 0 && (size_t)i < g_entities.size()) ? g_entities[i].scale.y : 1;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_entity_scale_z(int i) {
    return (i >= 0 && (size_t)i < g_entities.size()) ? g_entities[i].scale.z : 1;
}

EMSCRIPTEN_KEEPALIVE
const char* engine_get_entity_color(int i) {
    return (i >= 0 && (size_t)i < g_entities.size()) ? g_entities[i].color.c_str() : "#ffffff";
}

}  // extern "C"
