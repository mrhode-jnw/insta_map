local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrTasks = import "LrTasks"
local LrFunctionContext = import "LrFunctionContext"
local LrFileUtils = import "LrFileUtils"
local LrProgressScope = import "LrProgressScope"
local LrPrefs = import "LrPrefs"
local LrPathUtils = import "LrPathUtils"
local Parse = require "Parse"
local Apply = require "Apply"

-- Fehler sichtbar machen (sonst bricht Lightroom stumm ab)
LrFunctionContext.postAsyncTaskWithContext("ClaudeBewertungImport", function(context)
  LrDialogs.attachErrorDialogToFunctionContext(context)
  local catalog = LrApplication.activeCatalog()
  local prefs = LrPrefs.prefsForPlugin()

  -- Bewertungsdatei(en): zuerst bewertung.csv im zuletzt exportierten Ordner, sonst wählen (mehrere möglich)
  local files
  local auto = prefs.lastExport and LrPathUtils.child(prefs.lastExport, "bewertung.csv")
  if auto and LrFileUtils.exists(auto) and LrDialogs.confirm("Bewertung übernehmen?", "Gefunden: " .. auto, "Diese nehmen", "Andere Datei(en) …") == "ok" then
    files = { auto }
  else
    files = LrDialogs.runOpenPanel { title = "Bewertungsliste(n) von Claude wählen (bewertung.csv, mehrere mit Cmd)", canChooseFiles = true,
      canChooseDirectories = false, allowsMultipleSelection = true, fileTypes = { "csv", "txt", "tsv" },
      initialDirectory = prefs.lastExport and LrPathUtils.parent(prefs.lastExport) }
  end
  if not files or not files[1] then return end

  -- Zeilen sammeln; liegt liste.csv daneben, wird jedes Foto über seinen Pfad gefunden (Auswahl und Ordner egal)
  local rows, errors, targets = {}, {}, {}
  local selByKey = nil
  local function selection()
    if selByKey then return selByKey end
    selByKey = {}
    local sel = catalog:getTargetPhotos()
    local meta = catalog:batchGetFormattedMetadata(sel, { "fileName" })
    for _, photo in ipairs(sel) do
      local k = Parse.key(meta[photo] and meta[photo].fileName or "")
      selByKey[k] = selByKey[k] or {}
      table.insert(selByKey[k], photo)
    end
    return selByKey
  end
  local missing = {}
  for _, file in ipairs(files) do
    local r, e = Parse.parse(LrFileUtils.readFile(file))
    for _, x in ipairs(e) do errors[#errors + 1] = LrPathUtils.leafName(LrPathUtils.parent(file)) .. ": " .. x end
    local listPath = LrPathUtils.child(LrPathUtils.parent(file), "liste.csv")
    local paths = LrFileUtils.exists(listPath) and Parse.pathMap(LrFileUtils.readFile(listPath)) or nil
    for _, row in ipairs(r) do
      local found = {}
      local p = paths and paths[row.key]
      if p then
        local photo = catalog:findPhotoByPath(p)
        if photo then found = { photo } end
      else
        found = selection()[row.key] or {}
      end
      if #found > 0 then rows[#rows + 1] = row; targets[row] = found
      else missing[#missing + 1] = row.name end
    end
  end
  local todo, photos = 0, {}
  for _, row in ipairs(rows) do for _, p in ipairs(targets[row]) do todo = todo + 1; photos[#photos + 1] = p end end
  local msg = ("%d Datei%s gelesen, %d Fotos gefunden."):format(#files, #files == 1 and "" or "en", todo)
  if #missing > 0 then msg = msg .. ("\n\nNicht gefunden (%d): %s"):format(#missing, table.concat(missing, ", "):sub(1, 400)) end
  if #errors > 0 then msg = msg .. "\n\nHinweise:\n" .. table.concat(errors, "\n"):sub(1, 400) end
  if todo == 0 then LrDialogs.message("Claude-Bewertung", msg .. "\n\n(Ohne liste.csv neben der Bewertung: vorher die Fotos auswählen.)", "warning"); return end
  if LrDialogs.confirm("Bewertungen übernehmen?", msg .. "\n\nSterne, Farben und Markierungen werden im Katalog gesetzt (rückgängig mit Cmd+Z).",
      "Übernehmen", "Abbrechen") ~= "ok" then return end

  local progress = LrProgressScope { title = "Claude-Bewertungen übernehmen" }
  local done = 0
  catalog:withWriteAccessDo("Claude-Bewertungen übernehmen", function()
    for i, r in ipairs(rows) do
      for _, photo in ipairs(targets[r] or {}) do
        Apply.apply(photo, r, _PLUGIN)
        done = done + 1
      end
      progress:setPortionComplete(i, #rows)
    end
  end, { timeout = 120 })
  progress:done()
  LrDialogs.showBezel(("Claude: %d Fotos bewertet"):format(done))
  -- Panoramas gefunden? Gleich stapeln anbieten
  local StackLib = require "StackLib"
  local LrPrefs2 = import "LrPrefs"
  local sp = LrPrefs2.prefsForPlugin()
  local groups = StackLib.groups(catalog, photos, sp.stackBrackets == true)
  local open = 0
  for _, g in ipairs(groups) do if not g.stacked then open = open + 1 end end
  if open > 0 and LrDialogs.confirm(("%d Panorama%s gefunden"):format(open, sp.stackBrackets and "s/Belichtungsreihen" or "s"),
      "Jetzt automatisch stapeln? (Lightroom währenddessen nicht bedienen)", "Stapeln", "Nicht jetzt") == "ok" then
    StackLib.run(context, catalog, photos, sp.stackBrackets == true)
  end

end)
