# Claude-Bewertung – Zusatzmodul für Lightroom Classic

Übernimmt Claudes Bewertungsliste in den Katalog: Sterne, Farbmarkierung, Markierung (Auswahl/Abgelehnt),
Note 1–10, Serie und Kommentar. Schreibt nur in den Katalog – keine XMP- oder Bilddateien, Entwicklung bleibt unberührt.
Rückgängig mit Cmd+Z.

## Installieren
1. `ClaudeBewertung.lrplugin.zip` laden und entpacken (Ordner `ClaudeBewertung.lrplugin`), z. B. nach `~/Documents/Lightroom-Plugins/`.
2. Lightroom Classic → Datei → Zusatzmodul-Manager → Hinzufügen → den Ordner wählen.

## Benutzen
1. Fotos auswählen → Bibliothek → Zusatzmoduloptionen → **Dateinamen der Auswahl kopieren (für Claude)** (optional).
2. Vorschauen exportieren (Preset „Claude-Bewertung“: JPEG 1600 px, Dateiname = Original) und Claude schicken.
3. Claudes Liste als `.csv` speichern.
4. Dieselben Fotos auswählen (Ordner öffnen, Cmd+A) → Bibliothek → Zusatzmoduloptionen → **Claude-Bewertungen übernehmen …** → Datei wählen.
5. Note, Serie und Kommentar stehen im Metadaten-Bedienfeld (Satz „Claude-Bewertung“); Note und Serie auch im Bibliotheksfilter → Metadaten.

## Listenformat (UTF-8, Trennzeichen ;)
```
datei;sterne;farbe;markierung;note;serie;kommentar
DSC01266;5;grün;auswahl;9;A;Stärkstes Einzelbild
DSC01268;1;;abgelehnt;2;;Ohne Licht
```
Leere Felder lassen den bisherigen Wert unverändert. Farben: rot, gelb, grün, blau, lila, keine.
Markierung: auswahl, abgelehnt, keine.
