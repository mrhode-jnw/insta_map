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
local Rules = require "Rules"
local Meta = require "Meta"
local Group = require "Group"

local BATCH = 10      -- Fotos je Anfrage: genug, um Serien zu vergleichen


local function thumbnail(photo, SIZE)
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
  local per = ((prefs.model == "claude-sonnet-5-5") and 0.005 or 0.01) * (((tonumber(prefs.size) or 1280) / 1280) ^ 2 * 0.7 + 0.3)
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

  -- nach Aufnahmezeit sortieren und vorgruppieren: Belichtungsreihen/Panoramas landen immer in derselben Anfrage
  local items, groups = Meta.collect(catalog, photos)
  -- Sparmodus: von vermuteten Belichtungsreihen nur das mittlere Bild senden, die übrigen bekommen dessen Urteil als „lila“
  local followers = {}
  if prefs.bracketOne then
    for _, g in ipairs(groups) do
      if g.id and g.id:sub(1, 1) == "R" and #g.items >= 3 then
        local mid = g.items[math.ceil(#g.items / 2)]
        local keep = { mid }
        followers[mid.name:lower()] = {}
        for _, it in ipairs(g.items) do if it ~= mid then table.insert(followers[mid.name:lower()], it.photo) end end
        mid.info = mid.info .. "\n(Mittleres Bild einer Belichtungsreihe aus " .. #g.items .. " Bildern – nur dieses wird gezeigt; kind = \"bracket\", best_in_group = true.)"
        g.items = keep
      end
    end
  end
  local size = tonumber(prefs.size) or 1280
  local batches = Group.batches(groups, BATCH, 20)

  local progress = LrProgressScope { title = "Claude bewertet Fotos", functionContext = context }
  local done, failed, msgs = 0, 0, {}
  local nb = #batches
  for b, batch in ipairs(batches) do
    if progress:isCanceled() then break end
    progress:setCaption(("Anfrage %d von %d – Vorschauen …"):format(b, nb))
    local images, byName = {}, {}
    for _, it in ipairs(batch) do
      local jpg, err = thumbnail(it.photo, size)
      if jpg then
        images[#images + 1] = { name = it.name, jpeg = LrStringUtils.encodeBase64(jpg), info = it.info }
        byName[it.name:lower()] = byName[it.name:lower()] or {}
        table.insert(byName[it.name:lower()], it.photo)
      else msgs[#msgs + 1] = it.name .. ": keine Vorschau (" .. tostring(err) .. ")"; failed = failed + 1 end
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
              local row = props.overwrite and Rules.toRow(r) or {}
              row.score, row.comment = r.score, r.comment
              row.group = ("%d%s"):format(b, tostring(r.group or ""))
              row.kind = Rules.KIND_DE[r.kind] or r.kind
              Apply.apply(p, row, _PLUGIN); done = done + 1
            end
            for _, p in ipairs(followers[tostring(r.file):lower()] or {}) do  -- nicht gesendete Bilder derselben Reihe
              Apply.apply(p, { color = props.overwrite and "purple" or nil, score = r.score, kind = "Belichtungsreihe",
                group = ("%d%s"):format(b, tostring(r.group or "")), comment = "(nicht einzeln bewertet – Teil der Reihe)" }, _PLUGIN)
              done = done + 1
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
  LrDialogs.message("Claude-Bewertung", text .. "\n\nFähnchen = bestes Bild je Serie · Grün = Top (Note ≥ 8,5)\nLila = übrige Bilder einer Belichtungsreihe · Blau = Panorama-Einzelbilder\nNote, Serie, Art und Kommentar: Metadaten-Bedienfeld → „Claude-Bewertung“.", #msgs > 0 and "warning" or "info")
end)
