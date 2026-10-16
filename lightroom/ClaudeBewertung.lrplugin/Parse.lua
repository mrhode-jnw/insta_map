-- Bewertungsliste lesen. Eine Zeile je Foto, Trennzeichen ; (oder Tabulator):
--   datei;sterne;farbe;markierung;note;serie;art;kommentar
--   DSC01266;5;grün;auswahl;9;A;einzel;Stärkstes Einzelbild …
-- datei: Dateiname mit oder ohne Endung · sterne: 0–5 (leer = unverändert)
-- farbe: rot, gelb, grün, blau, lila, keine (leer = unverändert)
-- markierung: auswahl, abgelehnt, keine (leer = unverändert) · note: 1–10 · serie: frei (z. B. „A“)
-- art: einzel, serie, reihe (Belichtungsreihe), pano (Panorama) – wird als „Claude-Art“ gespeichert
-- Zeilen mit # am Anfang und die Kopfzeile werden übersprungen.
local M = {}

local COLORS = { rot = "red", red = "red", gelb = "yellow", yellow = "yellow", ["grün"] = "green", gruen = "green", green = "green",
  blau = "blue", blue = "blue", lila = "purple", violett = "purple", purple = "purple", keine = "none", none = "none", ["-"] = "none" }
local PICKS = { auswahl = 1, pick = 1, ["markiert"] = 1, abgelehnt = -1, reject = -1, x = -1, keine = 0, none = 0, ["-"] = 0 }

local KINDS = { einzel = "Einzelbild", einzelbild = "Einzelbild", serie = "Serie", reihe = "Belichtungsreihe",
  belichtungsreihe = "Belichtungsreihe", hdr = "Belichtungsreihe", pano = "Panorama", panorama = "Panorama" }

local function trim(s) return (s or ""):gsub("^%s+", ""):gsub("%s+$", "") end
M.trim = trim

-- Dateiname ohne Pfad und Endung, klein geschrieben (Schlüssel für den Abgleich)
function M.key(name)
  name = trim(name):gsub("^.*[/\\]", "")
  return (name:gsub("%.[^%.]+$", "")):lower()
end

function M.split(line)
  local sep = line:find("\t") and "\t" or ";"
  local out, pos = {}, 1
  for _ = 1, 7 do  -- die ersten sieben Felder; der Rest ist der Kommentar (darf ; enthalten)
    local i = line:find(sep, pos, true)
    if not i then break end
    out[#out + 1] = trim(line:sub(pos, i - 1)); pos = i + 1
  end
  out[#out + 1] = trim(line:sub(pos))
  return out
end

function M.parse(text)
  local rows, errors = {}, {}
  text = (text or ""):gsub("^\239\187\191", "")  -- UTF-8-BOM
  local n = 0
  for line in (text .. "\n"):gmatch("(.-)\r?\n") do
    n = n + 1
    local l = trim(line)
    if l ~= "" and l:sub(1, 1) ~= "#" and not l:lower():match("^datei[;\t]") and not l:lower():match("^file[;\t]") then
      local f = M.split(l)
      local row = { line = n, name = f[1], key = M.key(f[1]) }
      local stars, color, pick, score, group, kind, comment = f[2], f[3], f[4], f[5], f[6], f[7], f[8]
      if stars and stars ~= "" then
        local s = tonumber(stars)
        if s and s >= 0 and s <= 5 then row.rating = math.floor(s) else errors[#errors + 1] = ("Zeile %d: Sterne „%s“ ungültig"):format(n, stars) end
      end
      if color and color ~= "" then
        row.color = COLORS[color:lower()]
        if not row.color then errors[#errors + 1] = ("Zeile %d: Farbe „%s“ unbekannt"):format(n, color) end
      end
      if pick and pick ~= "" then
        row.pick = PICKS[pick:lower()]
        if row.pick == nil then errors[#errors + 1] = ("Zeile %d: Markierung „%s“ unbekannt"):format(n, pick) end
      end
      if score and score ~= "" then row.score = score end
      if group and group ~= "" then row.group = group end
      if kind and kind ~= "" then row.kind = KINDS[kind:lower()] or kind end
      if comment and comment ~= "" then row.comment = comment end
      if row.key == "" then errors[#errors + 1] = ("Zeile %d: kein Dateiname"):format(n) else rows[#rows + 1] = row end
    end
  end
  return rows, errors
end

-- liste.csv (vom Export): Spalten datei;jpeg;aufnahme;vorgruppe;hinweis;pfad → Schlüssel (JPEG- und Originalname) → Pfad
function M.pathMap(text)
  local byJpeg, byName, count = {}, {}, {}
  local first = true
  for line in ((text or ""):gsub("^\239\187\191", "") .. "\n"):gmatch("(.-)\r?\n") do
    if first then first = false
    elseif trim(line) ~= "" then
      local f = {}
      for x in (line .. ";"):gmatch("(.-);") do f[#f + 1] = x end
      local path = f[6]
      if path and path ~= "" then
        if f[2] and f[2] ~= "" then byJpeg[M.key(f[2])] = path end
        local k = M.key(f[1] or "")
        count[k] = (count[k] or 0) + 1
        byName[k] = path
      end
    end
  end
  -- JPEG-Name ist eindeutig; der Originalname nur, wenn er in keinem zweiten Ordner vorkommt
  local map = {}
  for k, v in pairs(byName) do if count[k] == 1 then map[k] = v end end
  for k, v in pairs(byJpeg) do map[k] = v end
  return map
end

return M
