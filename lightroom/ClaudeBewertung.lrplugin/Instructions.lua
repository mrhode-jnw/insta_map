-- ANWEISUNG.md, die neben die exportierten Vorschauen gelegt wird: so weiß jede Claude-Sitzung (App, Claude Code, Chat),
-- was zu tun ist und in welchem Format die Antwort zurück nach Lightroom geht.
return [[# Fotos bewerten für Lightroom (Zusatzmodul „Claude-Bewertung“)

Bewerte alle JPEGs in diesem Ordner und schreibe das Ergebnis als `bewertung.csv` in denselben Ordner.
`liste.csv` enthält je Foto Dateiname, Aufnahmezeit und Belichtungsdaten sowie eine **Vorgruppe**
(R = vermutete Belichtungsreihe, P = vermutetes Panorama oder Serie) – ein Hinweis, entschieden wird nach dem Bild.

## Maßstab (Note 1–10)
10 herausragend · 8 stark · 6 solide · 4 schwach · 1–2 technisch misslungen.
Kriterien: Licht und Stimmung, Komposition, Motiv, Tiefe und Ebenen, Farbe, Technik (Schärfe, Lichter/Schatten, Horizont).
Sehr ähnliche Bilder bilden eine Serie (A, B, C …); je Serie genau ein bestes Bild.

## Sterne, Fähnchen, Farbe
- Sterne aus der Note: 9–10 → 5 · 8 → 4 · 7 → 3 · 5,5–7 → 2 · darunter 1
- Einzelbild/Serie: bestes Bild der Serie ab Note 7 → `auswahl`; ab 8,5 zusätzlich `grün`. Misslungen → Sterne 1, `abgelehnt`.
- **Belichtungsreihe** (art `reihe`): nur das allein beste Bild bekommt Sterne/`auswahl` (ab 8,5 `grün`); die übrigen Bilder
  der Reihe: Sterne leer, Farbe `lila`, nie `abgelehnt` (werden fürs HDR gebraucht). Im Kommentar des besten: HDR lohnt sich ja/nein.
- **Panorama** (art `pano`): alle Einzelbilder Farbe `blau`, nie `abgelehnt`; nur das erste Bild bekommt Sterne/`auswahl`
  für den Wert des fertigen Panoramas, die übrigen Sterne leer. Kommentar des ersten: aus wie vielen Bildern, was es zeigt.

## Format von bewertung.csv (UTF-8, Trennzeichen ;)
```
datei;sterne;farbe;markierung;note;serie;art;kommentar
DSC01266.jpg;5;grün;auswahl;9;A;einzel;Dramatischer Himmel, Kegel im rechten Drittel; Häuser unten rechts abdunkeln.
DSC01270.jpg;;lila;;8;B;reihe;
DSC01271.jpg;4;;auswahl;8;B;reihe;Mittlere Belichtung trägt allein; HDR lohnt sich für den Himmel.
```
`datei` = Name des JPEGs aus `liste.csv` (Spalte jpeg, z. B. `DSC01266.jpg` oder `DSC01266-2.jpg`) – eindeutig, auch wenn
Fotos aus mehreren Ordnern gleich heißen. Leere Felder = unverändert.
Farben: rot, gelb, grün, blau, lila, keine · Markierung: auswahl, abgelehnt, keine · art: einzel, serie, reihe, pano.
Kommentar kurz, auf Deutsch, höchstens zwei Sätze, gern mit Bearbeitungstipp.
]]
