# Claude-Bewertung – Zusatzmodul für Lightroom Classic

Lässt Fotos direkt aus Lightroom von Claude bewerten oder übernimmt eine Bewertungsliste: Sterne, Farbmarkierung, Markierung (Auswahl/Abgelehnt),
Note 1–10, Serie und Kommentar. Schreibt nur in den Katalog – keine XMP- oder Bilddateien, Entwicklung bleibt unberührt.
Rückgängig mit Cmd+Z.

## Installieren
1. `ClaudeBewertung.lrplugin.zip` laden und entpacken (Ordner `ClaudeBewertung.lrplugin`), z. B. nach `~/Documents/Lightroom-Plugins/`.
2. Lightroom Classic → Datei → Zusatzmodul-Manager → Hinzufügen → den Ordner wählen.

## Ohne API-Schlüssel (mit dem Claude-Abo)
1. Fotos auswählen → Bibliothek → Zusatzmoduloptionen → **Vorschauen für Claude exportieren …**
   Fragt nach dem Speicherort (wird gemerkt) und legt dort JPEGs (mit deiner Bearbeitung, 1600 px) in `<Datum_Uhrzeit>/` ab,
   Fortschritt oben links,
   dazu `liste.csv` (Aufnahmedaten, vermutete Belichtungsreihen/Panoramas) und `ANWEISUNG.md` für Claude.
2. Den Ordner Claude geben (Claude-App am Mac: „Bewerte die Fotos in diesem Ordner nach ANWEISUNG.md“;
   oder Bilder in den Chat ziehen). Claude schreibt `bewertung.csv` in den Ordner (bzw. gibt sie dir zum Speichern).
3. Zusatzmoduloptionen → **Claude-Bewertungsliste (CSV) übernehmen …** – die Datei im letzten Export-Ordner wird automatisch angeboten.

## Belichtungsreihen und Panoramas
- **Belichtungsreihe:** nur das allein beste Bild bekommt Sterne und Fähnchen (ab Note 8,5 Grün); die übrigen
  werden **lila**, nie abgelehnt (fürs HDR). Kommentar: ob sich HDR lohnt.
- **Panorama:** alle Einzelbilder **blau**, nie abgelehnt; das erste bekommt Sterne/Fähnchen für das fertige Panorama.
- Erkannt an Aufnahmezeit (≤ 10 s), gleicher Brennweite und Belichtung, entschieden von Claude nach dem Bild.
  Feld „Claude-Art“ im Metadaten-Bedienfeld: Einzelbild, Serie, Belichtungsreihe, Panorama.

## Panoramas automatisch stapeln
Zusatzmoduloptionen → **Panoramas automatisch stapeln …** (wird nach dem Übernehmen einer Bewertung auch direkt angeboten).
Je Panorama werden die Einzelbilder zu einem Stapel gruppiert (erstes Bild vorn); optional auch Belichtungsreihen
(gewähltes Bild vorn). Lightroom hat dafür keine Zusatzmodul-Funktion – das Modul wählt die Bilder aus und löst Cmd+G über
macOS aus. Einmalig nötig: Systemeinstellungen → Datenschutz & Sicherheit → **Bedienungshilfen** → Adobe Lightroom Classic
einschalten (und die Frage „Lightroom möchte System Events steuern“ erlauben). Bereits gestapelte Gruppen werden übersprungen.

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
datei;sterne;farbe;markierung;note;serie;art;kommentar
DSC01266;5;grün;auswahl;9;A;einzel;Stärkstes Einzelbild
DSC01268;1;;abgelehnt;2;;einzel;Ohne Licht
```
Leere Felder lassen den bisherigen Wert unverändert. Farben: rot, gelb, grün, blau, lila, keine.
Markierung: auswahl, abgelehnt, keine. Art: einzel, serie, reihe, pano.
