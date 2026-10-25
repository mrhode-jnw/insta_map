# Sehschule – Fotografie-Lern-App (Web)

Läuft im Browser, auch am Handy: **https://mrhode-jnw.github.io/insta_map/Fotoapp/**
Zugang mit demselben Zugangscode wie die Karte. Konzept und Regeln: [CLAUDE.md](CLAUDE.md).

## Einrichtung (einmalig)

1. `https://mrhode-jnw.github.io/insta_map/Fotoapp/setup.html` öffnen.
2. Zugangscode der Karte, den **Bilder-Schlüssel** (von Claude), den KI-Anbieter (**OpenAI** oder Claude) und den passenden **API-Key** eingeben → „Verschlüsseln und speichern“.
   Die Seite verschlüsselt beides im Browser und schreibt `Fotoapp/config.js` (mit dem GitHub-Token aus `../config.js`).
3. Nach 1–2 Minuten die Sehschule öffnen, Code eingeben („auf diesem Gerät merken“). Am Handy: „Zum Home-Bildschirm“.

## Wie es gebaut ist

| Teil | Wo | Sichtbarkeit |
|---|---|---|
| App (HTML/JS/CSS), Prompts, Seed, `data/library.json` | Seiten-Branch, `Fotoapp/` | öffentlich (Metadaten, Quellenauszüge – stehen ohnehin im Seed) |
| Bilder (1568 px + 480 px Vorschau) | Branch `sehschule-media`, `m/<id>.bin`, `t/<id>.bin` | AES-256-GCM-verschlüsselt |
| Analysen, Lernantworten, Sehübungen, Kapiteltexte, eigene Bilder/Quellen | Branch `map-data`, `sehschule/*.enc` | AES-256-GCM-verschlüsselt |
| Bilder-Schlüssel, OpenAI-/Anthropic-Key | `Fotoapp/config.js` | mit dem Zugangscode verschlüsselt (wie der Maps-Key der Karte) |

GitHub Pages hat keinen Server, der ein Passwort prüfen könnte – nur durch die Verschlüsselung schützt der Zugangscode
die Bilder (urheberrechtlich geschützt) und deine Daten tatsächlich. Für dich ist es ein einfacher Passwortschutz.

Die KI (OpenAI oder Claude, umschaltbar in `setup.html`) wird direkt aus dem Browser aufgerufen; Anbieter und Modelle stehen in
`config.js`. Analysen werden einmal erzeugt und gespeichert (Versionen bleiben erhalten).

## Bibliothek neu bauen (nach Änderungen an `seed/`)

```sh
git worktree add ../media sehschule-media        # einmalig
python3 Fotoapp/tools/build_library.py --media-dir ../media --key-file <Datei mit Bilder-Schlüssel>
(cd ../media && git add -A && git commit -m "Bilder" && git push)
```
Fehlende Downloads (z. B. Wikimedia-Drosselung) einfach später erneut ausführen – vorhandene Bilder werden übersprungen.
Danach `SEHSCHULE_BUILD` in `config.js` hochzählen (Cache).

## Test

`node Fotoapp/tests_web/e2e.js <media-dir> <schlüssel-hex> [screenshot-dir]` – Ende-zu-Ende im Headless-Chromium
(GitHub und KI simuliert, Bilder echt entschlüsselt; `PROVIDER=openai` oder `anthropic`).
