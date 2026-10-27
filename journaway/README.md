# journaway · Reise-App (abgespeckte Version der Insta Map)

Kunden-Version der bestehenden Karten-App für eine gebuchte journaway-Reise. Gleiche Bedienung wie die Haupt-App
(Karte mit Spot-Liste, Spot-Karten zum Blättern, Reiseplan-Fenster, Standort), aber ohne Foto-Funktionen und ohne
alles, was nur für die eigene Planung gedacht ist (Touren, Rundgänge, Inspiration, Timeline, Spots hinzufügen,
Bewertungen, GitHub-Anbindung, Zugangscode). Design nach journaway: Türkis `#4dc6d3`, Dunkellila `#1f0e32`, Limette `#dae863`.

- **Programm** (★): Orte aus dem Reiseverlauf der Angebotsseite. **Empfehlungen** (✦): zusätzliche Spots, im Reiseplan
  über „Empfehlungen wählen“ einplanbar. Die Auswahl bleibt nur auf dem Gerät.
- Der Kunde trägt unter **Infos** sein Abflugdatum ein; dann zeigt der Reiseplan echte Tage und markiert „heute“.
- Alles liegt in diesem Ordner: `index.html`, `data/` (erzeugt), `trip.json` (Quelle), `logo.svg`, `icons/`.
  Der Browser-Speicher nutzt den Präfix `jw:`, damit sich die App nicht mit der Haupt-App unter derselben Domain beißt.

## Andere Reise einbauen
1. `trip.json` anpassen (Städte, Hotels, Spots mit Koordinaten, Tage mit Stopps; `tip: true` = Empfehlung).
2. `python3 journaway/tools/build_trip.py` → schreibt `data/places.js`, `data/trip.js`, `data/itinerary.js`.

Stopps ohne Spot (Bahnhöfe, Konbini: `kind: "station"` bzw. `noMap`) werden im Reiseplan zu Info-Karten.
Hotel-Koordinaten in `trip.json` sind geschätzt (`approx`) und vor dem Einsatz gegen die Buchung zu prüfen.
