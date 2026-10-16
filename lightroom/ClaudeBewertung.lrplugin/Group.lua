-- Vorgruppierung nach Aufnahmedaten: Belichtungsreihen und Panoramas/Serien erkennen (Hinweis für Claude,
-- und damit eine Reihe nie auf zwei Anfragen verteilt wird)
local M = {}

local function ev(r)  -- Belichtungswert aus Zeit/Blende/ISO (für Reihen ohne Belichtungskorrektur, z. B. manuell)
  local t, a, iso = r.shutterSpeed, r.aperture, r.isoSpeedRating
  if not (t and a and t > 0 and a > 0) then return nil end
  return math.log(a * a / t) / math.log(2) - math.log((iso or 100) / 100) / math.log(2)
end

-- items: { {photo=, name=, raw={dateTimeOriginal, exposureBias, shutterSpeed, aperture, focalLength, isoSpeedRating}} … }, nach Zeit sortiert
-- Ergebnis: Liste von Gruppen { items = {…}, hint = "Belichtungsreihe?" | "Panorama oder Serie?" | nil, id = "R1"/"P2"/nil }
function M.cluster(items, maxGap)
  maxGap = maxGap or 10
  local groups, cur = {}, nil
  for _, it in ipairs(items) do
    local r = it.raw or {}
    local prev = cur and cur.items[#cur.items].raw or nil
    local same = prev and r.dateTimeOriginal and prev.dateTimeOriginal
      and math.abs(r.dateTimeOriginal - prev.dateTimeOriginal) <= maxGap
      and math.abs((r.focalLength or 0) - (prev.focalLength or 0)) < 1
    if same then table.insert(cur.items, it) else cur = { items = { it } }; groups[#groups + 1] = cur end
  end
  local nr, np = 0, 0
  for _, g in ipairs(groups) do
    if #g.items >= 2 then
      local evs, distinct, span = {}, 0, 0
      local t0, t1 = g.items[1].raw.dateTimeOriginal or 0, g.items[#g.items].raw.dateTimeOriginal or 0
      span = t1 - t0
      for _, it in ipairs(g.items) do
        local v = it.raw.exposureBias or ev(it.raw) or 0
        local k = ("%.1f"):format(math.floor(v * 3 + 0.5) / 3)
        if not evs[k] then evs[k] = true; distinct = distinct + 1 end
      end
      if distinct >= 2 and distinct >= #g.items / 3 then
        nr = nr + 1; g.id = "R" .. nr
        g.hint = (#g.items > distinct and #g.items % distinct == 0) and ("Belichtungsreihen-Panorama? (%d Stufen × %d)"):format(distinct, #g.items / distinct)
          or ("Belichtungsreihe? (%d Stufen)"):format(distinct)
      else
        np = np + 1; g.id = "P" .. np
        g.hint = ("Panorama oder Serie? (%d Bilder in %d s, gleiche Belichtung)"):format(#g.items, span)
      end
    end
  end
  return groups
end

-- Gruppen zu Anfragen bündeln, ohne eine Gruppe zu zerteilen (sehr lange Gruppen werden bei max geteilt)
function M.batches(groups, size, max)
  size, max = size or 10, max or 20
  local out, cur = {}, {}
  local function flush() if #cur > 0 then out[#out + 1] = cur; cur = {} end end
  for _, g in ipairs(groups) do
    if #cur + #g.items > size then flush() end
    for i, it in ipairs(g.items) do
      it.hint, it.pre = g.hint, g.id
      cur[#cur + 1] = it
      if #cur >= max then flush() end
    end
  end
  flush()
  return out
end

return M
