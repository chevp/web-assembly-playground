-- center.tick.lua — pulses the central sphere and breathes its colour.

local id = frost.self.id
local base_scale = 1.2

function onLoad()
    frost.log("center spawned: " .. id)
end

function onUpdate(dt)
    local t = frost.getTime()
    local pulse = 1.0 + 0.15 * math.sin(t * 2.0)
    local s = base_scale * pulse
    frost.setScale(id, s, s, s)
end
