# Insta Map – gespeicherte Instagram-Posts auf der Karte

Mobile Karte (Leaflet + OpenStreetMap) mit allen Orten aus einer gespeicherten
Instagram-Sammlung – mit Foto, Adresse, Koordinaten, Link zum Post und zum Profil
sowie deinem aktuellen Standort (blauer Punkt, Liste nach Entfernung sortiert).

## 1. Posts einlesen

Gespeicherte Sammlungen sind privat und nur eingeloggt sichtbar – sie lassen sich
nicht automatisch abrufen. Zwei Wege:

**A) Links sammeln** – in `posts.txt` eine Post-URL pro Zeile
(in der App: Post → ⋯ → Link kopieren):

    https://www.instagram.com/p/XXXXXXXXXXX/
    https://www.instagram.com/reel/YYYYYYYYYYY/

**B) Instagram-Datenexport** – *Kontenübersicht → Deine Informationen
herunterladen → JSON*. Darin liegt `your_instagram_activity/saved/saved_collections.json`.

## 2. Orte extrahieren

    python3 tools/build_places.py posts.txt
    # oder
    python3 tools/build_places.py saved_collections.json --collection "Hong Kong"

Das Skript (nur Python-Standardbibliothek)
- lädt pro Post die öffentliche Embed-Seite (Foto → `images/`, Username, Caption),
- extrahiert jeden Ort aus der Caption (`📍`/`📌`-Zeilen, `Address:`, `Location:`, `地址:` …);
  ein Post mit fünf 📍 ergibt fünf Marker,
- geocodiert über Nominatim/Photon (OpenStreetMap) oder über Google, wenn
  `GOOGLE_MAPS_API_KEY` gesetzt ist (meist genauer bei Hausnummern),
- schreibt `data/places.js`; Posts ohne erkennbaren Ort landen in `data/unresolved.json`.

Fehlende oder falsche Orte trägst du in `data/overrides.json` ein (Format siehe
`data/overrides.example.json`) und startest das Skript erneut. Bereits geladene
Posts und Geocodes kommen aus `data/cache.json`.

Optionen: `--region "Hong Kong"` (wird an Adressen angehängt), `--delay 3` (Pause
zwischen Instagram-Abrufen; bei HTTP 429 erhöhen).

## 3. Karte öffnen

Der Standort funktioniert nur über HTTPS. Am einfachsten mit **GitHub Pages**:
Repo → Settings → Pages → Branch wählen → `/ (root)`. Dann die Seite auf dem Handy
öffnen und „Zum Home-Bildschirm“ hinzufügen.

Lokal testen: `python3 -m http.server` → http://localhost:8000

Bedienung: ◎ startet die Standortanzeige, ein zweiter Tipp lässt die Karte dir folgen.
Unten (Desktop: links) die durchsuchbare Liste, nach Entfernung sortiert.
Im Popup: Foto, Adresse, Koordinaten, **Post**, **@Profil**, **Route** (Google Maps).
