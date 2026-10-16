local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrTasks = import "LrTasks"
local LrFileUtils = import "LrFileUtils"
local LrProgressScope = import "LrProgressScope"
local Parse = require "Parse"

LrTasks.startAsyncTask(function()
  local catalog = LrApplication.activeCatalog()
  local photos = catalog:getTargetPhotos()
  if #photos < 2 then
    LrDialogs.message("Claude-Bewertung", "Bitte zuerst die Fotos auswählen, für die die Liste gilt (z. B. den Ordner öffnen und Cmd+A).", "info")
    return
  end
  local files = LrDialogs.runOpenPanel { title = "Bewertungsliste von Claude wählen (.csv / .txt)", canChooseFiles = true,
    canChooseDirectories = false, allowsMultipleSelection = false, fileTypes = { "csv", "txt", "tsv" } }
  if not files or not files[1] then return end
  local rows, errors = Parse.parse(LrFileUtils.readFile(files[1]))
  if #rows == 0 then
    LrDialogs.message("Claude-Bewertung", "In der Datei steht keine Bewertung.\n" .. table.concat(errors, "\n"), "warning")
    return
  end

  -- Dateinamen der ausgewählten Fotos (auch virtuelle Kopien) → Fotos
  local byKey = {}
  local meta = catalog:batchGetFormattedMetadata(photos, { "fileName" })
  for _, photo in ipairs(photos) do
    local k = Parse.key(meta[photo] and meta[photo].fileName or "")
    byKey[k] = byKey[k] or {}
    table.insert(byKey[k], photo)
  end
  local missing, todo = {}, 0
  for _, r in ipairs(rows) do
    if byKey[r.key] then todo = todo + #byKey[r.key] else missing[#missing + 1] = r.name end
  end
  local msg = ("%d Zeilen gelesen, %d Fotos in der Auswahl gefunden."):format(#rows, todo)
  if #missing > 0 then msg = msg .. ("\n\nNicht in der Auswahl (%d): %s"):format(#missing, table.concat(missing, ", "):sub(1, 400)) end
  if #errors > 0 then msg = msg .. "\n\nHinweise:\n" .. table.concat(errors, "\n"):sub(1, 400) end
  if todo == 0 then LrDialogs.message("Claude-Bewertung", msg, "warning"); return end
  if LrDialogs.confirm("Bewertungen übernehmen?", msg .. "\n\nSterne, Farben und Markierungen werden im Katalog gesetzt (rückgängig mit Cmd+Z).",
      "Übernehmen", "Abbrechen") ~= "ok" then return end

  local progress = LrProgressScope { title = "Claude-Bewertungen übernehmen" }
  local done = 0
  catalog:withWriteAccessDo("Claude-Bewertungen übernehmen", function()
    for i, r in ipairs(rows) do
      for _, photo in ipairs(byKey[r.key] or {}) do
        if r.rating ~= nil then photo:setRawMetadata("rating", r.rating > 0 and r.rating or nil) end
        if r.color then photo:setRawMetadata("colorNameForLabel", r.color) end
        if r.pick ~= nil then photo:setRawMetadata("pickStatus", r.pick) end
        if r.score then photo:setPropertyForPlugin(_PLUGIN, "claudeScore", r.score) end
        if r.group then photo:setPropertyForPlugin(_PLUGIN, "claudeGroup", r.group) end
        if r.comment then photo:setPropertyForPlugin(_PLUGIN, "claudeComment", r.comment) end
        done = done + 1
      end
      progress:setPortionComplete(i, #rows)
    end
  end, { timeout = 120 })
  progress:done()
  LrDialogs.showBezel(("Claude: %d Fotos bewertet"):format(done))
end)
