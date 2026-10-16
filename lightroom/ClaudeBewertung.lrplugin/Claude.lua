-- Anfrage an die Claude-API (Messages API, ohne SDK – Lightroom-Lua hat keins)
local LrHttp = import "LrHttp"
local Json = require "Json"

local M = {}
M.URL = "https://api.anthropic.com/v1/messages"
M.MODELS = { { title = "Claude Opus 5.5 (beste Qualität)", value = "claude-opus-5-5" },
             { title = "Claude Sonnet 5.5 (günstiger)", value = "claude-sonnet-5-5" } }

M.SYSTEM = [[Du bist ein erfahrener Bildredakteur für Landschafts-, Reise- und Straßenfotografie und hilfst einem Fotografen,
aus einer großen Menge Fotos die besten auszuwählen. Bewerte jedes Foto ehrlich auf einer Skala von 1 bis 10
(10 = herausragend, 8 = stark, 6 = solide, 4 = schwach, 1–2 = technisch misslungen). Kriterien: Licht und Stimmung,
Komposition und Bildaufbau, Motiv, Tiefe und Ebenen, Farbe, und die technische Qualität, soweit in der Vorschau erkennbar
(Schärfe, ausgefressene Lichter, abgesoffene Schatten, schiefer Horizont).
Fasse sehr ähnliche Aufnahmen (gleiches Motiv, gleicher Standpunkt, Belichtungsreihe, Serie) zu einer Serie zusammen
(Buchstaben A, B, C …) und markiere genau ein Foto je Serie als bestes; Einzelbilder bilden eine eigene Serie.
Belichtungsreihen (gleicher Ausschnitt, kurz nacheinander, unterschiedlich belichtet): kind = "bracket", die ganze
Reihe ist eine Serie; best_in_group = true für genau das Bild, das allein am besten funktioniert (meist die mittlere
Belichtung); die übrigen sind nie reject, weil sie für ein HDR gebraucht werden. Sag im Kommentar des besten Bildes,
ob sich das Zusammenfügen zum HDR lohnt.
Panoramas (gleiche Belichtung, Ausschnitt seitlich oder vertikal versetzt, überlappend): kind = "panorama", alle
Einzelbilder eine Serie, gleiche Note für alle = Wert des fertigen Panoramas; best_in_group = true nur für das erste
Bild; Kommentar des ersten Bildes: aus wie vielen Bildern zusammenfügen und was das Panorama zeigt. Nie reject.
Die Angaben „Aufnahme“ und „Vorgruppe“ bei jedem Foto sind ein Hinweis aus den Metadaten – entscheide nach dem Bild.
Sonst: kind = "series" für ähnliche Aufnahmen desselben Motivs, "single" für Einzelbilder.
Setze reject nur für klar misslungene Fotos (unscharf, stark fehlbelichtet, versehentlich).
Der Kommentar ist kurz und auf Deutsch (höchstens 2 Sätze): was das Bild trägt und was es schwächt, gern mit
einem konkreten Tipp für die Bearbeitung. Verwende für "file" exakt den angegebenen Dateinamen.]]

M.SCHEMA = {
  type = "object", additionalProperties = false, required = Json.array { "photos" },
  properties = { photos = { type = "array", items = { type = "object", additionalProperties = false,
    required = Json.array { "file", "score", "kind", "group", "best_in_group", "reject", "comment" },
    properties = {
      file = { type = "string" }, score = { type = "number" }, group = { type = "string" },
      kind = { type = "string", enum = Json.array { "single", "series", "bracket", "panorama" } },
      best_in_group = { type = "boolean" }, reject = { type = "boolean" }, comment = { type = "string" },
    } } } },
}

-- images: { {name=, jpeg=<Base64>} … } → Liste {file, score, group, best_in_group, reject, comment} oder nil, Fehlertext
function M.rate(apiKey, model, images, note, noFallback)
  local content = Json.array()
  for i, im in ipairs(images) do
    content[#content + 1] = { type = "text", text = ("Foto %d: %s%s"):format(i, im.name, im.info and ("\n" .. im.info) or "") }
    content[#content + 1] = { type = "image", source = { type = "base64", media_type = "image/jpeg", data = im.jpeg } }
  end
  content[#content + 1] = { type = "text", text = ("Bewerte alle %d Fotos.%s"):format(#images, note and note ~= "" and ("\nHinweis des Fotografen: " .. note) or "") }
  local body = Json.encode {
    model = model, max_tokens = 16000, system = M.SYSTEM,
    output_config = { effort = "medium", format = { type = "json_schema", schema = M.SCHEMA } },
    fallbacks = (not noFallback) and "default" or nil,  -- lehnt das Modell ab, übernimmt automatisch ein anderes
    messages = Json.array { { role = "user", content = content } },
  }
  local headers = {
    { field = "x-api-key", value = apiKey },
    { field = "anthropic-version", value = "2023-06-01" },
    { field = "content-type", value = "application/json" },
  }
  if not noFallback then table.insert(headers, { field = "anthropic-beta", value = "server-side-fallback-2026-07-01" }) end
  local res, hdrs = LrHttp.post(M.URL, body, headers, "POST", 300)
  if not res then
    return nil, "Keine Verbindung zu api.anthropic.com" .. (hdrs and hdrs.error and (" (" .. tostring(hdrs.error.name or hdrs.error.errorCode or "") .. ")") or "")
      .. ". In China ohne VPN gesperrt – z. B. über den Hotspot des Handys (Roaming) versuchen."
  end
  local ok, data = pcall(Json.decode, res)
  if not ok or type(data) ~= "table" then return nil, "Antwort nicht lesbar: " .. tostring(res):sub(1, 300) end
  if data.type == "error" or data.error then
    local e = data.error or {}
    -- Fallback-Option für dieses Konto/Modell nicht verfügbar → einmal ohne versuchen
    if not noFallback and tostring(e.message or ""):lower():find("fallback") then return M.rate(apiKey, model, images, note, true) end
    return nil, ("API-Fehler %s: %s"):format(tostring(hdrs and hdrs.status or e.type or ""), tostring(e.message or res):sub(1, 400))
  end
  if data.stop_reason == "refusal" then return nil, "Claude hat diese Fotos nicht bewertet (Ablehnung)." end
  if data.stop_reason == "max_tokens" then return nil, "Antwort abgeschnitten – weniger Fotos je Anfrage wählen." end
  for _, b in ipairs(data.content or {}) do
    if b.type == "text" then
      local ok2, out = pcall(Json.decode, b.text)
      if ok2 and type(out) == "table" and out.photos then return out.photos, nil, data.usage end
      return nil, "Bewertung nicht lesbar: " .. tostring(b.text):sub(1, 300)
    end
  end
  return nil, "Leere Antwort von Claude."
end

return M
