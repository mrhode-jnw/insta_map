# Claude-Bewertung – Zusatzmodul für Lightroom Classic

Lässt Fotos direkt aus Lightroom von Claude bewerten oder übernimmt eine Bewertungsliste: Sterne, Farbmarkierung, Markierung (Auswahl/Abgelehnt),
Note 1–10, Serie und Kommentar. Schreibt nur in den Katalog – keine XMP- oder Bilddateien, Entwicklung bleibt unberührt.
Rückgängig mit Cmd+Z.

## Installieren
1. `ClaudeBewertung.lrplugin.zip` laden und entpacken (Ordner `ClaudeBewertung.lrplugin`), z. B. nach `~/Documents/Lightroom-Plugins/`.
2. Lightroom Classic → Datei → Zusatzmodul-Manager → Hinzufügen → den Ordner wählen.

## Direkt mit Claude bewerten (empfohlen)
1. Einmalig: Datei → Zusatzmodul-Manager → Claude-Bewertung → **API-Schlüssel** eintragen
   (anlegen unter console.anthropic.com → API Keys; Kosten ca. 1 US-Cent je Foto mit Opus, ½ Cent mit Sonnet).
2. Fotos auswählen → Bibliothek → Zusatzmoduloptionen → **Mit Claude bewerten …** → optional Hinweis eingeben → Bewerten.
3. Das Modul schickt Vorschauen (1280 px) in Zehnergruppen nach Aufnahmezeit an Claude und setzt:
   Sterne aus der Note (9–10 → 5, 8 → 4, 7 → 3, 5,5–7 → 2, darunter 1), Fähnchen für das beste Bild je Serie,
   Grün für Bilder ab Note 8,5, „Abgelehnt“ für misslungene Bilder, dazu Note, Serie und Kommentar.
   In China ohne VPN ist api.anthropic.com gesperrt – dann über den Handy-Hotspot (Roaming).

## Mit Bewertungsliste aus dem Chat (CSV)
1. Fotos auswählen → Bibliothek → Zusatzmoduloptionen → **Dateinamen der Auswahl kopieren (für Claude)** (optional).
2. Vorschauen exportieren (Preset „Claude-Bewertung“: JPEG 1600 px, Dateiname = Original) und Claude schicken.
3. Claudes Liste als `.csv` speichern.
4. Dieselben Fotos auswählen (Ordner öffnen, Cmd+A) → Bibliothek → Zusatzmoduloptionen → **Claude-Bewertungsliste (CSV) übernehmen …** → Datei wählen.
5. Note, Serie und Kommentar stehen im Metadaten-Bedienfeld (Satz „Claude-Bewertung“); Note und Serie auch im Bibliotheksfilter → Metadaten.

## Listenformat (UTF-8, Trennzeichen ;)
```
datei;sterne;farbe;markierung;note;serie;kommentar
DSC01266;5;grün;auswahl;9;A;Stärkstes Einzelbild
DSC01268;1;;abgelehnt;2;;Ohne Licht
```
Leere Felder lassen den bisherigen Wert unverändert. Farben: rot, gelb, grün, blau, lila, keine.
Markierung: auswahl, abgelehnt, keine.
