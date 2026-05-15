-- orbiter.tick.lua — orbits the entity around (0, 0, 0) using its own
-- properties from the orbiter.synth.xml component (radius, speed, phase, tilt).

local id     = frost.self.id
local radius = frost.self.props.radius or 3.0
local speed  = frost.self.props.speed  or 1.0
local phase  = frost.self.props.phase  or 0.0
local tilt   = frost.self.props.tilt   or 0.0

-- Per-instance phase: derive from id so siblings don't overlap, then add
-- the explicit phase from props. (frost.self.props lets components stay
-- generic while scenes inject the variation.)
local function hash_phase(s)
    local h = 0
    for i = 1, #s do h = (h * 31 + string.byte(s, i)) % 1000 end
    return h / 1000.0 * (2 * math.pi)
end
phase = phase + hash_phase(id)

function onLoad()
    frost.log("orbiter " .. id .. " r=" .. radius .. " v=" .. speed)
end

function onUpdate(dt)
    local t = frost.getTime() * speed + phase
    local x = math.cos(t) * radius
    local z = math.sin(t) * radius
    local y = math.sin(t * 2.0) * radius * tilt
    frost.setPosition(id, x, y, z)
end
