-- Ausgewählte Fotos direkt von Claude bewerten lassen: Vorschauen → API → Sterne, Farbe, Markierung, Note, Serie, Kommentar
local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrTasks = import "LrTasks"
local LrPrefs = import "LrPrefs"
local LrStringUtils = import "LrStringUtils"
local LrProgressScope = import "LrProgressScope"
local LrFunctionContext = import "LrFunctionContext"
local LrView = import "LrView"
local LrBinding = import "LrBinding"
local Claude = require "Claude"
local Apply = require "Apply"

local BATCH = 10      -- Fotos je Anfrage: genug, um Serien zu vergleichen
local SIZE = 1280     -- lange Kante der Vorschau in Pixeln (~1.400 Bild-Token)

local function thumbnail(photo)
  local done, data, err = false, nil, nil
  local req = photo:requestJpegThumbnail(SIZE, SIZE, function(jpg, e) data, err, done = jpg, e, true end)
  local t = 0
  while not done and t < 300 do LrTasks.sleep(0.1); t = t + 1 end
  req = nil  -- Anfrage bis hier festhalten, sonst verwirft Lightroom sie
  return data, err or (not done and "Zeitüberschreitung") or nil
end

LrFunctionContext.postAsyncTaskWithContext("ClaudeBewertung", function(context)
  LrDialogs.attachErrorDialogToFunctionContext(context)
  local prefs = LrPrefs.prefsForPlugin()
  local catalog = LrApplication.activeCatalog()
  local photos = catalog:getTargetPhotos()
  if #photos == 0 then LrDialogs.message("Claude-Bewertung", "Bitte zuerst Fotos auswählen.", "info"); return end
  if not prefs.apiKey or prefs.apiKey == "" then
    LrDialogs.message("Claude-Bewertung", "Noch kein API-Schlüssel hinterlegt.\nDatei → Zusatzmodul-Manager → Claude-Bewertung → Schlüssel eintragen.", "info"); return
  end

  -- Rückfrage mit Kostenschätzung und optionalem Hinweis (z. B. „Sonnenuntergang Yangshuo, für Instagram“)
  local f = LrView.osFactory()
  local props = LrBinding.makePropertyTable(context)
  props.note = prefs.lastNote or ""
  props.overwrite = prefs.overwrite ~= false
  local per = (prefs.model == "claude-sonnet-5-5") and 0.005 or 0.01
  local res = LrDialogs.presentModalDialog {
    title = "Mit Claude bewerten",
    contents = f:column { bind_to_object = props, spacing = f:control_spacing(),
      f:static_text { title = ("%d Fotos · %s · geschätzt ca. %.2f US$"):format(#photos, prefs.model or "claude-opus-5-5", #photos * per) },
      f:static_text { title = "Hinweis an Claude (optional, z. B. Ort, Zweck der Auswahl):" },
      f:edit_field { value = LrView.bind "note", width_in_chars = 50, height_in_lines = 2 },
      f:checkbox { title = "Sterne, Farbe und Markierung setzen (sonst nur Note/Serie/Kommentar)", value = LrView.bind "overwrite" },
    },
    actionVerb = "Bewerten",
  }
  if res ~= "ok" then return end
  prefs.lastNote, prefs.overwrite = props.note, props.overwrite

  -- nach Aufnahmezeit sortieren, damit Serien in derselben Anfrage landen
  local raw = catalog:batchGetRawMetadata(photos, { "dateTimeOriginal" })
  local fmt = catalog:batchGetFormattedMetadata(photos, { "fileName" })
  table.sort(photos, function(a, b) return ((raw[a] or {}).dateTimeOriginal or 0) < ((raw[b] or {}).dateTimeOriginal or 0) end)

  local progress = LrProgressScope { title = "Claude bewertet Fotos", functionContext = context }
  local done, failed, msgs = 0, 0, {}
  local nb = math.ceil(#photos / BATCH)
  for b = 1, nb do
    if progress:isCanceled() then break end
    progress:setCaption(("Anfrage %d von %d – Vorschauen …"):format(b, nb))
    local batch, images, byName = {}, {}, {}
    for i = (b - 1) * BATCH + 1, math.min(b * BATCH, #photos) do
      local p = photos[i]
      local name = (fmt[p] or {}).fileName or ("Foto" .. i)
      local jpg, err = thumbnail(p)
      if jpg then
        images[#images + 1] = { name = name, jpeg = LrStringUtils.encodeBase64(jpg) }
        byName[name:lower()] = byName[name:lower()] or {}
        table.insert(byName[name:lower()], p)
      else msgs[#msgs + 1] = name .. ": keine Vorschau (" .. tostring(err) .. ")"; failed = failed + 1 end
    end
    if #images > 0 then
      progress:setCaption(("Anfrage %d von %d – Claude bewertet %d Fotos …"):format(b, nb, #images))
      local list, err = Claude.rate(prefs.apiKey, prefs.model or "claude-opus-5-5", images, props.note)
      if not list then
        msgs[#msgs + 1] = ("Anfrage %d: %s"):format(b, err); failed = failed + #images
        if err:find("Keine Verbindung") or err:find("401") or err:find("authentication") then break end
      else
        catalog:withWriteAccessDo("Claude-Bewertung", function()
          for _, r in ipairs(list) do
            for _, p in ipairs(byName[tostring(r.file):lower()] or {}) do
              local row = { score = r.score, group = ("%d%s"):format(b, tostring(r.group or "")), comment = r.comment }
              if props.overwrite then
                row.rating = r.reject and 1 or Apply.starsFor(r.score)
                row.pick = r.reject and -1 or (r.best_in_group and (tonumber(r.score) or 0) >= 7 and 1 or nil)
                row.color = (r.best_in_group and (tonumber(r.score) or 0) >= 8.5) and "green" or nil
              end
              Apply.apply(p, row, _PLUGIN); done = done + 1
            end
          end
        end, { timeout = 60 })
      end
    end
    progress:setPortionComplete(b, nb)
  end
  progress:done()
  local text = ("%d Fotos bewertet%s."):format(done, failed > 0 and (", " .. failed .. " ohne Bewertung") or "")
  if #msgs > 0 then text = text .. "\n\n" .. table.concat(msgs, "\n"):sub(1, 1200) end
  LrDialogs.message("Claude-Bewertung", text .. "\n\nGrün = beste Bilder (Note ≥ 8,5), Fähnchen = bestes Bild je Serie.\nNote, Serie und Kommentar: Metadaten-Bedienfeld → „Claude-Bewertung“.", #msgs > 0 and "warning" or "info")
end)
