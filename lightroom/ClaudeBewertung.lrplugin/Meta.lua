-- Aufnahmedaten der Fotos lesen, nach Zeit sortieren, vorgruppieren und als kurze Textzeile aufbereiten
local LrDate = import "LrDate"
local Group = require "Group"
local M = {}

M.KEYS = { "dateTimeOriginal", "exposureBias", "shutterSpeed", "aperture", "focalLength", "isoSpeedRating" }

local function shutter(t)
  if not t then return nil end
  if t >= 0.5 then return ("%g s"):format(math.floor(t * 10 + 0.5) / 10) end
  return ("1/%d s"):format(math.floor(1 / t + 0.5))
end

function M.describe(r)
  local p = {}
  if r.dateTimeOriginal then p[#p + 1] = LrDate.timeToUserFormat(r.dateTimeOriginal, "%Y-%m-%d %H:%M:%S") end
  if r.shutterSpeed then p[#p + 1] = shutter(r.shutterSpeed) end
  if r.aperture then p[#p + 1] = ("f/%g"):format(math.floor(r.aperture * 10 + 0.5) / 10) end
  if r.isoSpeedRating then p[#p + 1] = ("ISO %d"):format(r.isoSpeedRating) end
  if r.focalLength then p[#p + 1] = ("%d mm"):format(math.floor(r.focalLength + 0.5)) end
  if r.exposureBias and r.exposureBias ~= 0 then p[#p + 1] = ("Korrektur %+.1f EV"):format(r.exposureBias) end
  return table.concat(p, " · ")
end

-- → items (sortiert, mit .photo .name .raw .hint .pre .info), groups
function M.collect(catalog, photos)
  local raw = catalog:batchGetRawMetadata(photos, M.KEYS)
  local fmt = catalog:batchGetFormattedMetadata(photos, { "fileName" })
  local items = {}
  for i, p in ipairs(photos) do items[i] = { photo = p, name = (fmt[p] or {}).fileName or ("Foto" .. i), raw = raw[p] or {} } end
  table.sort(items, function(a, b)
    local ta, tb = a.raw.dateTimeOriginal or 0, b.raw.dateTimeOriginal or 0
    if ta ~= tb then return ta < tb end
    return a.name < b.name
  end)
  local groups = Group.cluster(items)
  for _, g in ipairs(groups) do for _, it in ipairs(g.items) do it.hint, it.pre = g.hint, g.id end end
  for _, it in ipairs(items) do
    it.info = "Aufnahme: " .. M.describe(it.raw) .. (it.pre and ("\nVorgruppe " .. it.pre .. ": " .. it.hint) or "")
  end
  return items, groups
end

return M
