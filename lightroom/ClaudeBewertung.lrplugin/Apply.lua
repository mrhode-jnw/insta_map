-- Bewertungen auf Fotos im Katalog schreiben (gemeinsam für CSV-Import und Direktbewertung)
local M = {}

-- Note 1–10 → Sterne (gleicher Maßstab wie im Chat)
function M.starsFor(score)
  score = tonumber((tostring(score or ""):gsub(",", ".")))
  if not score then return nil end
  if score >= 9 then return 5 elseif score >= 8 then return 4 elseif score >= 7 then return 3 elseif score >= 5.5 then return 2 else return 1 end
end

-- row: rating (0–5), color ("green"…/"none"), pick (1/0/-1), score, group, comment – fehlende Felder bleiben unverändert
function M.apply(photo, row, plugin)
  if row.rating ~= nil then photo:setRawMetadata("rating", row.rating > 0 and row.rating or nil) end
  if row.color then photo:setRawMetadata("colorNameForLabel", row.color) end
  if row.pick ~= nil then photo:setRawMetadata("pickStatus", row.pick) end
  if row.score then photo:setPropertyForPlugin(plugin, "claudeScore", tostring(row.score)) end
  if row.group then photo:setPropertyForPlugin(plugin, "claudeGroup", row.group) end
  if row.comment then photo:setPropertyForPlugin(plugin, "claudeComment", row.comment) end
  if row.kind then photo:setPropertyForPlugin(plugin, "claudeKind", row.kind) end
end

return M
