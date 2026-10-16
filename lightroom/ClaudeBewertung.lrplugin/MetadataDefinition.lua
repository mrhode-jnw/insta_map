-- Eigene Metadatenfelder: im Metadaten-Bedienfeld sichtbar, im Bibliotheksfilter durchsuchbar
return {
  metadataFieldsForPhotos = {
    { id = "claudeScore", title = "Claude-Note", dataType = "string", searchable = true, browsable = true },
    { id = "claudeComment", title = "Claude-Kommentar", dataType = "string", searchable = true, browsable = false },
    { id = "claudeGroup", title = "Claude-Serie", dataType = "string", searchable = true, browsable = true },
  },
  schemaVersion = 1,
}
