-- Menüpunkt „Panoramas automatisch stapeln …“
local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrFunctionContext = import "LrFunctionContext"
local LrView = import "LrView"
local LrBinding = import "LrBinding"
local LrPrefs = import "LrPrefs"
local StackLib = require "StackLib"

LrFunctionContext.postAsyncTaskWithContext("ClaudeBewertungStapeln", function(context)
  LrDialogs.attachErrorDialogToFunctionContext(context)
  local catalog = LrApplication.activeCatalog()
  local photos = catalog:getTargetPhotos()
  if #photos < 2 then LrDialogs.message("Claude-Bewertung", "Bitte zuerst die Fotos (z. B. den ganzen Ordner mit Cmd+A) auswählen.", "info"); return end
  local prefs = LrPrefs.prefsForPlugin()
  local f = LrView.osFactory()
  local props = LrBinding.makePropertyTable(context)
  props.brackets = prefs.stackBrackets == true
  if LrDialogs.presentModalDialog { title = "Automatisch stapeln", actionVerb = "Stapeln",
      contents = f:column { bind_to_object = props, spacing = f:control_spacing(),
        f:static_text { title = "Panoramas (von Claude erkannt) werden je Panorama zu einem Stapel gruppiert.\nLightroom währenddessen nicht bedienen (ca. 1 s je Gruppe).", height_in_lines = 2 },
        f:checkbox { title = "Belichtungsreihen auch stapeln (gewähltes Bild vorn)", value = LrView.bind "brackets" } } } ~= "ok" then return end
  prefs.stackBrackets = props.brackets
  StackLib.run(context, catalog, photos, props.brackets)
end)
