--[[ Claude-Bewertung – Lightroom-Classic-Zusatzmodul
Lässt ausgewählte Fotos direkt von Claude bewerten (oder übernimmt eine Bewertungsliste als CSV): Sterne, Farbmarkierung, Markierung (Auswahl/Abgelehnt),
Note 1–10 und Kommentar. Schreibt nur in den Katalog, nie in XMP- oder Bilddateien; Entwicklungseinstellungen bleiben unberührt.
Menü: Bibliothek → Zusatzmoduloptionen → „Claude-Bewertungen übernehmen …“ ]]
return {
  LrSdkVersion = 10.0,
  LrSdkMinimumVersion = 6.0,
  LrToolkitIdentifier = "de.mrhode.claudebewertung",
  LrPluginName = "Claude-Bewertung 3.4",
  LrPluginInfoUrl = "https://mrhode-jnw.github.io/insta_map/lightroom/",
  LrMetadataProvider = "MetadataDefinition.lua",
  LrPluginInfoProvider = "PluginInfoProvider.lua",
  LrLibraryMenuItems = {
    { title = "Vorschauen für Claude exportieren …", file = "ExportForClaude.lua" },
    { title = "Mit Claude bewerten (API-Schlüssel) …", file = "RateWithClaude.lua" },
    { title = "Claude-Bewertungsliste (CSV) übernehmen …", file = "ImportRatings.lua" },
    { title = "Panoramas automatisch stapeln …", file = "StackPanoramas.lua" },
    { title = "Dateinamen der Auswahl kopieren (für Claude)", file = "CopyNames.lua" },
  },
  VERSION = { major = 3, minor = 4, revision = 0, build = 1 },
}
