-- Aus Claudes Urteil (Note, Art, bestes Bild je Gruppe, Ablehnung) die Lightroom-Werte ableiten.
-- Gleiche Regeln stehen in ANWEISUNG.md für die CSV aus dem Chat.
local Apply = require "Apply"
local M = {}

-- r: {score, kind = "single"|"series"|"bracket"|"panorama", best_in_group, reject}
function M.toRow(r)
  local s = tonumber((tostring(r.score or ""):gsub(",", "."))) or 0
  local kind, best = r.kind or "single", r.best_in_group
  local row = {}
  if kind == "bracket" then
    -- Belichtungsreihe: nur ein Bild wird gewählt; die übrigen bleiben (fürs HDR) und werden lila
    if best then row.rating = Apply.starsFor(s); row.pick = s >= 7 and 1 or nil; row.color = s >= 8.5 and "green" or nil
    else row.color = "purple" end
  elseif kind == "panorama" then
    -- Panorama: alle Einzelbilder blau; das erste trägt Sterne/Fähnchen für das fertige Panorama
    row.color = "blue"
    if best then row.rating = Apply.starsFor(s); row.pick = s >= 7 and 1 or nil end
  else
    if r.reject then row.rating, row.pick = 1, -1
    else
      row.rating = Apply.starsFor(s)
      if best and s >= 7 then row.pick = 1 end
      if best and s >= 8.5 then row.color = "green" end
    end
  end
  return row
end

M.KIND_DE = { single = "Einzelbild", series = "Serie", bracket = "Belichtungsreihe", panorama = "Panorama" }
return M
