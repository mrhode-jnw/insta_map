-- Dateinamen der ausgewählten Fotos in die Zwischenablage-Ansicht – zum Einfügen im Chat mit Claude
local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrTasks = import "LrTasks"
local LrView = import "LrView"

LrTasks.startAsyncTask(function()
  local catalog = LrApplication.activeCatalog()
  local photos = catalog:getTargetPhotos()
  local meta = catalog:batchGetFormattedMetadata(photos, { "fileName" })
  local names = {}
  for _, p in ipairs(photos) do names[#names + 1] = meta[p] and meta[p].fileName or "" end
  local f = LrView.osFactory()
  LrDialogs.presentModalDialog {
    title = ("%d Dateinamen – markieren und kopieren"):format(#names),
    contents = f:edit_field { value = table.concat(names, "\n"), height_in_lines = 16, width_in_chars = 40 },
    cancelVerb = "< exclude >", actionVerb = "Fertig",
  }
end)
