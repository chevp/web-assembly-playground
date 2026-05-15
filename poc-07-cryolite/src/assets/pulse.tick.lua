-- pulse.tick.lua
-- Pulses the entity's size and breathes the colour between two warm tones.

local id = frost.self.id
local base_size = 30

function onLoad()
    frost.log("pulse spawned: " .. id)
end

local function lerp(a, b, t) return a + (b - a) * t end

local function hex(r, g, b)
    return string.format("#%02x%02x%02x",
        math.floor(r * 255 + 0.5),
        math.floor(g * 255 + 0.5),
        math.floor(b * 255 + 0.5))
end

function onUpdate(dt)
    local t = frost.getTime()
    local s = base_size + math.sin(t * 2.0) * 10
    frost.setSize(id, s)

    local k = (math.sin(t * 1.3) + 1) * 0.5
    frost.setColor(id, hex(lerp(1.0, 1.0, k), lerp(0.90, 0.65, k), lerp(0.43, 0.18, k)))
end
