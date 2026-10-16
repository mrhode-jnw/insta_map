-- Panoramas (und auf Wunsch Belichtungsreihen) automatisch stapeln.
-- Lightroom hat dafür keine Zusatzmodul-Funktion: das Modul wählt je Gruppe die Bilder aus (erstes bzw. bestes Bild vorn)
-- und löst „Foto → Stapeln → In Stapel gruppieren“ (Cmd+G) über macOS aus. Dafür braucht Lightroom einmalig die Freigabe
-- unter Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen.
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDialogs = import "LrDialogs"
local LrTasks = import "LrTasks"
local LrFunctionContext = import "LrFunctionContext"
local LrProgressScope = import "LrProgressScope"
local log = require "Log"

local M = {}

-- Gruppen aus den Claude-Feldern: { kind = "Panorama"|"Belichtungsreihe", photos = {erstes/bestes zuerst} }
function M.groups(catalog, photos, withBrackets)
  local byKey, order = {}, {}
  local fmt = catalog:batchGetFormattedMetadata(photos, { "fileName" })
  local raw = catalog:batchGetRawMetadata(photos, { "dateTimeOriginal", "isInStackInFolder", "pickStatus", "rating" })
  for _, p in ipairs(photos) do
    local kind = p:getPropertyForPlugin(_PLUGIN, "claudeKind")
    local grp = p:getPropertyForPlugin(_PLUGIN, "claudeGroup")
    if grp and (kind == "Panorama" or (withBrackets and kind == "Belichtungsreihe")) then
      local k = kind .. "|" .. grp
      if not byKey[k] then byKey[k] = { kind = kind, group = grp, photos = {} }; order[#order + 1] = byKey[k] end
      table.insert(byKey[k].photos, { photo = p, name = (fmt[p] or {}).fileName or "", raw = raw[p] or {} })
    end
  end
  local out = {}
  for _, g in ipairs(order) do
    if #g.photos >= 2 then
      local stacked = false
      for _, it in ipairs(g.photos) do if it.raw.isInStackInFolder then stacked = true end end
      table.sort(g.photos, function(a, b)
        if g.kind == "Belichtungsreihe" then  -- gewähltes Bild (Fähnchen/Sterne) nach vorn
          local sa = (a.raw.pickStatus == 1 and 10 or 0) + (a.raw.rating or 0)
          local sb = (b.raw.pickStatus == 1 and 10 or 0) + (b.raw.rating or 0)
          if sa ~= sb then return sa > sb end
        end
        local ta, tb = a.raw.dateTimeOriginal or 0, b.raw.dateTimeOriginal or 0
        if ta ~= tb then return ta < tb end
        return a.name < b.name
      end)
      g.stacked = stacked
      out[#out + 1] = g
    end
  end
  return out
end

-- Lightroom nach vorn holen und Cmd+G senden; Fehlertext von osascript ins Protokoll
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local function sendCmdG()
  local tmp = LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"), "claude_stack_err.txt")
  local script = [[osascript -e 'tell application "System Events"' ]] ..
    [[-e 'set lr to first application process whose name contains "Lightroom"' ]] ..
    [[-e 'set frontmost of lr to true' -e 'delay 0.3' ]] ..
    [[-e 'keystroke "g" using {command down}' -e 'end tell' 2>"]] .. tmp .. [["]]
  local code = LrTasks.execute(script)
  local err = LrFileUtils.exists(tmp) and LrFileUtils.readFile(tmp) or ""
  if code ~= 0 or err ~= "" then log:error(("osascript %s: %s"):format(tostring(code), err)) end
  return code, err
end

local function isStacked(photo)
  local ok, v = pcall(function() return photo:getRawMetadata("isInStackInFolder") end)
  return ok and v
end

function M.run(context, catalog, photos, withBrackets)
  local groups = M.groups(catalog, photos, withBrackets)
  local todo = {}
  for _, g in ipairs(groups) do if not g.stacked then todo[#todo + 1] = g end end
  if #todo == 0 then
    LrDialogs.message("Claude-Bewertung", "Keine ungestapelten Panoramas" .. (withBrackets and " oder Belichtungsreihen" or "") ..
      " in der Auswahl.\n(Erkannt werden Fotos, die Claude als Panorama bzw. Belichtungsreihe bewertet hat.)", "info")
    return 0
  end
  pcall(function() LrApplicationView.switchToModule("library") end)
  pcall(function() LrApplicationView.gridView() end)
  local progress = LrProgressScope { title = ("Stapeln (%d Gruppen)"):format(#todo), functionContext = context }
  local ok, failed = 0, 0
  for i, g in ipairs(todo) do
    if progress:isCanceled() then break end
    progress:setCaption(("%s %s: %d Bilder"):format(g.kind, g.group, #g.photos))
    local first, rest = g.photos[1].photo, {}
    for k = 2, #g.photos do rest[#rest + 1] = g.photos[k].photo end
    catalog:setSelectedPhotos(first, rest)
    LrTasks.sleep(0.5)
    log:info(("Gruppe %s: %d Bilder ausgewählt, Auswahl jetzt %d"):format(g.group, #g.photos, #catalog:getTargetPhotos()))
    local code, err = sendCmdG()
    if code ~= 0 then
      progress:done()
      LrDialogs.message("Claude-Bewertung", "macOS hat den Tastenbefehl blockiert:\n" .. tostring(err):sub(1, 300) ..
        "\n\nEinmalig freigeben: Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen → „Adobe Lightroom Classic“ " ..
        "einschalten (ggf. mit + hinzufügen), außerdem unter „Automation“ für Lightroom „System Events“ erlauben. Danach Lightroom neu starten.\n\n" ..
        "Bisher gestapelt: " .. ok, "warning")
      return ok
    end
    local t = 0
    while not isStacked(first) and t < 15 do LrTasks.sleep(0.2); t = t + 1 end
    if isStacked(first) then ok = ok + 1
    else failed = failed + 1; log:error("nicht gestapelt: " .. g.group) end
    progress:setPortionComplete(i, #todo)
  end
  progress:done()
  local msg = ("%d Gruppen gestapelt%s."):format(ok, failed > 0 and (", " .. failed ..
    " nicht – Lightroom hat Cmd+G nicht ausgeführt. Mögliche Gründe: Raster nicht im Vordergrund, Bilder nicht sichtbar (Filter), Bilder in verschiedenen Ordnern." ..
    "\nProtokoll: Dokumente/LrClassicLogs/ClaudeBewertung.log") or "")
  LrDialogs.message("Claude-Bewertung", msg .. "\nStapel auf-/zuklappen: S. Vorn liegt das erste Panorama-Bild bzw. das gewählte Bild der Reihe.", failed > 0 and "warning" or "info")
  return ok
end

return M
