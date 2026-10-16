-- Ausgewählte Fotos als kleine JPEGs (mit Bearbeitung) in einen Ordner legen – samt liste.csv und ANWEISUNG.md für Claude
local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrTasks = import "LrTasks"
local LrFunctionContext = import "LrFunctionContext"
local LrPrefs = import "LrPrefs"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local LrExportSession = import "LrExportSession"
local LrDate = import "LrDate"
local LrShell = import "LrShell"
local Meta = require "Meta"
local INSTR = require "Instructions"
local log = require "Log"
log:info("ExportForClaude: Skript geladen")

-- Fehler sichtbar machen (sonst bricht Lightroom stumm ab)
LrFunctionContext.postAsyncTaskWithContext("ClaudeBewertungExport", function(context)
  LrDialogs.attachErrorDialogToFunctionContext(context)
  context:addFailureHandler(function(status, message) log:error("Export-Fehler: " .. tostring(message)) end)
  log:info("Export gestartet")
  local prefs = LrPrefs.prefsForPlugin()
  local catalog = LrApplication.activeCatalog()
  local photos = catalog:getTargetPhotos()
  if #photos == 0 then LrDialogs.message("Claude-Bewertung", "Bitte zuerst Fotos auswählen.", "info"); return end
  log:info(("%d Fotos ausgewählt"):format(#photos))
  LrDialogs.showBezel(("Claude: %d Vorschauen werden exportiert …"):format(#photos))
  local items = Meta.collect(catalog, photos)
  log:info("Aufnahmedaten gelesen")

  local base = LrPathUtils.child(LrPathUtils.getStandardFilePath("pictures"), "Claude-Bewertung")
  local sub = LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%d_%H%M")
  local dir = LrPathUtils.child(base, sub)
  LrFileUtils.createAllDirectories(dir)

  local size = tonumber(prefs.size) or 1600
  local session = LrExportSession {
    photosToExport = photos,
    exportSettings = {
      LR_export_destinationType = "specificFolder", LR_export_destinationPathPrefix = base,
      LR_export_useSubfolder = true, LR_export_destinationPathSuffix = sub,
      LR_collisionHandling = "rename", LR_renamingTokensOn = false,
      LR_format = "JPEG", LR_jpeg_quality = 0.7, LR_export_colorSpace = "sRGB",
      LR_size_doConstrain = true, LR_size_resizeType = "longEdge", LR_size_maxWidth = size, LR_size_maxHeight = size,
      LR_size_units = "pixels", LR_size_resolution = 72, LR_size_doNotEnlarge = true,
      LR_outputSharpeningOn = true, LR_outputSharpeningMedia = "screen", LR_outputSharpeningLevel = 2,
      LR_removeLocationMetadata = true, LR_reimportExportedPhoto = false, LR_includeVideoFiles = false,
    },
  }
  log:info("Zielordner: " .. dir)
  local jpgOf, fails, n = {}, {}, 0
  for _, rendition in session:renditions { stopIfCanceled = true } do
    local ok, path = rendition:waitForRender()
    log:info(("Rendition: %s %s"):format(tostring(ok), tostring(path)))
    if ok then jpgOf[rendition.photo] = LrPathUtils.leafName(path); n = n + 1
    else fails[#fails + 1] = tostring(path) end
  end
  if n == 0 then
    LrDialogs.message("Claude-Bewertung", "Export fehlgeschlagen – keine Vorschau erzeugt.\nZiel: " .. dir .. "\n" .. table.concat(fails, "\n"):sub(1, 600), "critical")
    return
  end

  local lines = { "datei;jpeg;aufnahme;vorgruppe;hinweis" }
  for _, it in ipairs(items) do
    lines[#lines + 1] = table.concat({ it.name, jpgOf[it.photo] or "", Meta.describe(it.raw), it.pre or "", it.hint or "" }, ";")
  end
  local f = io.open(LrPathUtils.child(dir, "liste.csv"), "w"); f:write(table.concat(lines, "\n"), "\n"); f:close()
  f = io.open(LrPathUtils.child(dir, "ANWEISUNG.md"), "w"); f:write(INSTR); f:close()
  prefs.lastExport = dir
  log:info(("fertig: %d Vorschauen"):format(n))
  LrShell.revealInShell(LrPathUtils.child(dir, "ANWEISUNG.md"))
  local warn = #fails > 0 and (("%d Fehler: "):format(#fails) .. table.concat(fails, "; "):sub(1, 300) .. "\n\n") or ""
  LrDialogs.message("Claude-Bewertung", warn .. ("%d Vorschauen in\n%s\n\nJetzt den Ordner an Claude geben (z. B. in der Claude-App: „Bewerte die Fotos in diesem Ordner nach ANWEISUNG.md“).\nDanach: Zusatzmoduloptionen → „Claude-Bewertungsliste (CSV) übernehmen …“ – bewertung.csv wird dort automatisch gefunden.")
    :format(n, dir), "info")
end)
