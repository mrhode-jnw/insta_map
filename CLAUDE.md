# Hinweise für Claude (insta_map)

## Touren (data/my-tours.json im Branch map-data)
- **Jeder Stopp einer Tour ist ein Spot.** Nennt ein Reiseplan einen Ort, der noch kein Spot ist, wird er
  **zuerst als Spot angelegt** (HK: `hk/extra_spots.json`, China: `cn/extra_spots.json`, mit Koordinaten aus
  OSM/Photon oder der trip.com-Attraktionsseite (GCJ-02 → WGS84 umrechnen, `tools/linkinfo.py gcj2wgs`) und
  möglichst Fotos in `extra_photos.json`), danach in die Tour aufgenommen.
- Ort aus dem Plan **nie auf einen ähnlichen Nachbar-Spot umbiegen** (z. B. „Ping'an“ ≠ „Longji Rice Terraces“).
- Tour aus einem Reiseplan/Screenshot: **nur die dort genannten Orte** als Stopps – keine eigenen Ideen
  dazumischen. Eigene Vorschläge höchstens als Claude-Tipp auf der Karte und im Chat getrennt nennen.
- Allgemeine Programmpunkte ohne Ort (z. B. „Büffelbauer“, „eine alte Steinbrücke“) nicht raten – im
  Tournamen erwähnen oder nachfragen.

## Claude-Tipps
- **Jeder Claude-Tipp bekommt Fotos.** Quelle bevorzugt Instagram (Post per `node tools/ig_fetch.js <code>` laden),
  sonst andere Webquellen (trip.com-Moments der Attraktion, Ctrip-Reiseberichte, Nachrichten-/Blogfotos, Commons).
  Bilder nach `images/`, Eintrag in `cn/extra_photos.json` (Name → [{image, url, credit}]), Bilder vorher ansehen:
  nur Fotos, die wirklich den Ort zeigen (keine KI-Bilder, keine Nachbarorte).

## Reiseplan (📅 in der App)
- Quelle `cn/itinerary.json` (Tage → Karten: stop/move/info/hotel), danach `python3 tools/build_itinerary.py`
  (prüft Spot-IDs, rechnet Auto-Etappen per OSRM ×1,2) → `data/itinerary.js`.
- Jeder Stopp ist ein Spot; Instagram-Spots haben Vorrang. Zu jedem Stopp Licht angeben (`light`, `lightText`):
  fotografieren im guten Licht, mittags fahren oder Innenräume.
- Fest (`plan: true`) sind **nur die Orte aus dem offiziellen Reiseplan/Screenshot**. Alles, was Claude ergänzt
  (auch Instagram-Spots, die nicht im Plan stehen), bekommt `opt: true` – in der App per Filter „Optionale Spots“.

## Wetter- & Sichtprognose
- `tools/build_forecast.py` → `data/forecast.json` (Open-Meteo, je Reiseplan-Stopp zur geplanten Uhrzeit: Wetter,
  Wolken, Regen, Sicht, AQI/PM2,5, Einschätzung „klar … sehr diesig“). Liegt im Branch **map-data**, nicht im Seiten-Branch.
- `sh tools/update_forecast.sh` rechnet neu und pusht nach map-data; die Routine (3× täglich) ruft das
  in jedem Lauf auf (ROUTINE.md, Schritt 0b). Nach Änderungen am Reiseplan reicht ein Lauf dieses Skripts.

## Fotos & Erlebnisse (Leiste oben in der App)
- „📷 Fotos“ = Foto-Spots, „🎒 Erlebnisse“ = Claude-Tipps, Food und Spots mit `"kind": "sight"` (nicht primär Fotografie).
  Neue Spots sind standardmäßig Foto-Spots; Erlebnisse in `extra_spots.json` mit `"kind": "sight"` anlegen.
- Fotoideen sind kein Bereich oben, sondern der Filter „✷ Fotoideen“ unten (standardmäßig aus).
- **Keine Foto-Kategorien mehr** (Architektur, Aussicht, Dorf …): nicht mehr recherchieren oder vergeben, `cat` darf leer sein;
  einzige Ausnahme `"Food"` für Essen. Die App zeigt keine Kategorie-Filter oder -Angaben mehr.
