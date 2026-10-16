-- Einstellungen im Zusatzmodul-Manager: API-Schlüssel und Modell
local LrView = import "LrView"
local LrPrefs = import "LrPrefs"
local LrHttp = import "LrHttp"
local Claude = require "Claude"

return {
  sectionsForTopOfDialog = function(f, propertyTable)
    local prefs = LrPrefs.prefsForPlugin()
    prefs.model = prefs.model or "claude-opus-5-5"
    prefs.size = prefs.size or 1280
    if prefs.bracketOne == nil then prefs.bracketOne = true end
    return { {
      title = "Claude-Bewertung",
      bind_to_object = prefs,
      f:row { f:static_text { title = "API-Schlüssel:", width = LrView.share "lbl" },
        f:password_field { value = LrView.bind "apiKey", width_in_chars = 44 } },
      f:row { f:static_text { title = "Modell:", width = LrView.share "lbl" },
        f:popup_menu { value = LrView.bind "model", items = Claude.MODELS } },
      f:row { f:static_text { title = "Vorschaugröße:", width = LrView.share "lbl" },
        f:popup_menu { value = LrView.bind "size", items = {
          { title = "1024 px (günstig, für Auswahl meist genug)", value = 1024 },
          { title = "1280 px (Standard)", value = 1280 },
          { title = "1600 px (mehr Details, teurer)", value = 1600 } } } },
      f:row { f:static_text { title = "", width = LrView.share "lbl" },
        f:checkbox { title = "Belichtungsreihen: nur das mittlere Bild senden (spart bei 3er-Reihen ca. 2/3)", value = LrView.bind "bracketOne" } },
      f:row { f:static_text { title = "", width = LrView.share "lbl" },
        f:push_button { title = "Schlüssel anlegen (console.anthropic.com) …", action = function() LrHttp.openUrlInBrowser("https://console.anthropic.com/settings/keys") end } },
      f:static_text { title = "Kosten etwa 1 US-Cent je Foto (Opus) bzw. ½ Cent (Sonnet). Der Schlüssel liegt in den Lightroom-Einstellungen dieses Rechners.",
        width_in_chars = 70, height_in_lines = 2 },
    } }
  end,
}
