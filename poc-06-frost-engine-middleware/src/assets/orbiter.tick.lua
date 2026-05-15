-- orbiter.tick.lua
-- Orbits the centre on a wobbling circle. Multiple entities share this
-- script; per-instance phase is derived from frost.self.id so each
-- orbiter ends up on its own trajectory.

local id = frost.self.id
local cx, cy = 400, 300

local phase = 0
for i = 1, #id do
    phase = phase + string.byte(id, i)
end
phase = phase * 0.17

local base_radius = 130
local speed = 1.1

function onLoad()
    frost.log("orbiter spawned: " .. id .. " (phase=" .. string.format("%.2f", phase) .. ")")
end

function onUpdate(dt)
    local t = frost.getTime() * speed + phase
    local r = base_radius + math.sin(t * 0.5) * 40
    frost.setPosition(id, cx + math.cos(t) * r, cy + math.sin(t) * r)
end
