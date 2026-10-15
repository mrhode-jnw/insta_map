# Unnützes Wissen

Fakten-App als Zeitvertreib statt Instagram: jeden Tag bis zu 100 überraschende, belegte Fakten
in Runden zu 20 Karten. Ein Tipp auf die Karte zeigt die ausführliche Erklärung und die Quelle.

Erreichbar unter `…/insta_map/unnuetzes_wissen/` (GitHub Pages), auf dem Handy über
„Zum Home-Bildschirm“ als App installierbar.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css`, `app.js` | die App (ohne Build-Schritt) |
| `config.js` | öffentliche Einstellungen |
| `config.local.js` | nur in dieser Version: Link zur Insta-Map |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation und Offline-Betrieb |
| `data/taxonomy.json` | Kategorien, Jobs, Hobbys, Orte, Zwischenfragen |
| `data/facts-*.json`, `data/index.json` | geprüfte Fakten-Pakete (allgemein, je Ort, aktuell) |
| `tools/build_facts.py` | übernimmt geprüfte Recherche-Dateien in die Pakete |

## Datenschutz

Profil, Interessen, Gelesenes und Gemerktes liegen nur im `localStorage` des Geräts
(Schlüssel `uw_state`). Die App verschickt nichts.

## Neue Fakten

Recherche und Gegenprüfung laufen außerhalb der App. Jede geprüfte Datei
(`verified-*.json`, nur Einträge mit `"verdict": "belegt"`) wird so übernommen:

    python3 unnuetzes_wissen/tools/build_facts.py <ordner>

Belegzitate aus der Prüfung landen dabei nicht in den öffentlichen Dateien.

## Teilen-Link

`teilen.html` ist ein einzelner Link für andere: Dort wählt man einen Ort (oder „Alle Orte“) aus und blättert durch die ortsbezogenen Fakten. Allgemeine und aktuelle Fakten erscheinen dort nicht. Direktlinks: `teilen.html?ort=shenzhen`, `?land=china`, `?ort=alle`, optional mit Kategorie `&thema=krimi`. Eine gewählte Kategorie bleibt beim Stadtwechsel erhalten; die Städteleiste zeigt dann die Trefferzahl je Stadt.
