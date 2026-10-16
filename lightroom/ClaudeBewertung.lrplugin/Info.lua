--[[ Claude-Bewertung – Lightroom-Classic-Zusatzmodul
Übernimmt Claudes Bewertungsliste (CSV) in den Katalog: Sterne, Farbmarkierung, Markierung (Auswahl/Abgelehnt),
Note 1–10 und Kommentar. Schreibt nur in den Katalog, nie in XMP- oder Bilddateien; Entwicklungseinstellungen bleiben unberührt.
Menü: Bibliothek → Zusatzmoduloptionen → „Claude-Bewertungen übernehmen …“ ]]
return {
  LrSdkVersion = 10.0,
  LrSdkMinimumVersion = 6.0,
  LrToolkitIdentifier = "de.mrhode.claudebewertung",
  LrPluginName = "Claude-Bewertung",
  LrPluginInfoUrl = "https://mrhode-jnw.github.io/insta_map/lightroom/",
  LrMetadataProvider = "MetadataDefinition.lua",
  LrLibraryMenuItems = {
    { title = "Claude-Bewertungen übernehmen …", file = "ImportRatings.lua" },
    { title = "Dateinamen der Auswahl kopieren (für Claude)", file = "CopyNames.lua" },
  },
  VERSION = { major = 1, minor = 0, revision = 0, build = 1 },
}
