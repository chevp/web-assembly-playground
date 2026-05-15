-- scene.script.lua
-- Scene-level setup, analogous to scene_showcase.script.lua in
-- nuna/nuna/games/_showcases/engine-showcase. Runs once at engine_init
-- after every entity's lua_State is constructed.

function onLoad()
    frost.log("scene loaded: " .. frost.self.id)
end

function onUpdate(dt)
    -- no per-frame scene logic
end
