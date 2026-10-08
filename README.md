# Insta Map – gespeicherte Instagram-Posts auf der Karte

Mobile Karte (Leaflet + OpenStreetMap) mit allen Orten aus einer gespeicherten
Instagram-Sammlung – mit Foto, Adresse, Koordinaten, Link zum Post und zum Profil
sowie deinem aktuellen Standort (blauer Punkt, Liste nach Entfernung sortiert).

## Hong Kong (Sammlung „Hong Kong“)

Die Karte enthält bereits die Sammlung **Hong Kong**: 86 Posts, daraus 125 Spots
mit Kategorie, Bezirk, Hinweisen und allen zugehörigen Post-Fotos. 44 Posts nennen
keinen konkreten Ort; sie stehen in der Liste unter „Ohne konkreten Ort“.

- `hk/spots.py` – kuratierte Spot-Liste (Name, Suchbegriff oder feste Koordinaten,
  Bezirk, Kategorie, Post-Indizes, Hinweis). Hier Spots ergänzen/korrigieren.
- `hk/geocode.py` – geocodiert neue Suchbegriffe über Nominatim → `hk/geocache.json`.
- `tools/build_hk.py` – lädt Fotos/Captions und schreibt `data/places.js`.

      python3 hk/geocode.py && python3 tools/fetch_slides.py && python3 tools/build_hk.py

`tools/fetch_slides.py` lädt die Karussell-Bilder; jeder Spot bekommt das Bild, das laut
nummerierter Caption-Liste („1. …“ bzw. „Location: …“) genau diesen Ort zeigt.

Spots mit „Pin ungefähr“ haben von Hand gesetzte Koordinaten.

## Andere Sammlungen

### 1. Posts einlesen

Gespeicherte Sammlungen sind privat und nur eingeloggt sichtbar – sie lassen sich
nicht automatisch abrufen. Zwei Wege:

**A) Links sammeln** – in `posts.txt` eine Post-URL pro Zeile
(in der App: Post → ⋯ → Link kopieren):

    https://www.instagram.com/p/XXXXXXXXXXX/
    https://www.instagram.com/reel/YYYYYYYYYYY/

**B) Instagram-Datenexport** – *Kontenübersicht → Deine Informationen
herunterladen → JSON*. Darin liegt `your_instagram_activity/saved/saved_collections.json`.

### 2. Orte extrahieren

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

## Google Maps & Zugangscode

Ohne Key zeigt die Karte OpenStreetMap. Für Google Maps (Karte + Satellit):

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen,
   Abrechnung aktivieren und die **Maps JavaScript API** einschalten.
2. Unter *APIs & Dienste → Anmeldedaten* einen API-Key erstellen und einschränken:
   *Websites* → `https://mrhode-jnw.github.io/*`, *API-Einschränkung* → Maps JavaScript API.
3. Optional unter *Kontingente* die Ladevorgänge pro Tag begrenzen (z.B. 500) – das ist
   die eigentliche Kostenbremse.
4. `setup.html` öffnen (z.B. https://mrhode-jnw.github.io/insta_map/setup.html), Key und
   einen Zugangscode eingeben, die erzeugte Zeile in `config.js` eintragen und pushen.

Ab dann fragt die Karte beim Öffnen nach dem Code. Der Key liegt nur verschlüsselt im
Repo und wird erst mit dem richtigen Code entschlüsselt; ohne Code wird Google Maps nie
geladen. Die Spot-Daten und Bilder selbst sind im öffentlichen Repo weiterhin lesbar.

## Karte öffnen

Der Standort funktioniert nur über HTTPS. Am einfachsten mit **GitHub Pages**:
Repo → Settings → Pages → Branch wählen → `/ (root)`. Dann die Seite auf dem Handy
öffnen und „Zum Home-Bildschirm“ hinzufügen.

Lokal testen: `python3 -m http.server` → http://localhost:8000

Bedienung: ◎ startet die Standortanzeige, ein zweiter Tipp lässt die Karte dir folgen.
Unten (Desktop: links) die durchsuchbare Liste, nach Entfernung sortiert.
Im Popup: Foto, Adresse, Koordinaten, **Post**, **@Profil**, **Route** (Google Maps).
