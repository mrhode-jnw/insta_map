# Sehschule – private Fotografie-Lern-App

Lokale Web-App (FastAPI + SQLite + Jinja2/HTMX) zum Lernen an Bildern anderer Fotografen:
Bibliothek mit Quellen, Bildanalyse in vier Ebenen per Claude, Lernmodus „erst urteilen, dann lesen“,
quellenbasierte Geschichtskapitel und Zeitleiste. Konzept und Regeln: [CLAUDE.md](CLAUDE.md).

## Start (Mac)

```sh
cd Fotoapp
make install        # .venv + Abhängigkeiten, legt .env aus .env.example an
# .env bearbeiten: APP_PASSWORD, SECRET_KEY, ANTHROPIC_API_KEY
make seed           # optional: recherchierten Startbestand importieren (lädt Bilder nach data/)
make dev            # → http://localhost:8000 (im Heimnetz: http://<Mac-IP>:8000)
make test
```

Python 3.12+. `SECRET_KEY` erzeugen: `python3 -c "import secrets; print(secrets.token_hex(32))"`
(ohne festen Schlüssel ist man nach jedem Neustart abgemeldet).

## Bereiche

| Bereich | Was |
|---|---|
| **Bibliothek** | Fotograf → Projekt → Bild. Bild per Bild-URL oder Upload; Original unverändert in `data/images/`, Thumbnail in `data/thumbs/`. Quelle + Abrufdatum immer verlinkt. |
| **Quellen** | URL + wörtlicher Textauszug, gehängt an Fotograf, Projekt, Bild oder Kapitel. Nur diese Auszüge dürfen als Fakten in Analysen und Kapitel. |
| **Analyse** | Vier Ebenen (zu sehen · gebaut · Kontext mit `[S<id>]` + „Meine Einschätzung“ · übertragbare Technik). Einmal erzeugt, dann stabil. „Neu erzeugen“ gibt die alte Version mit und verlangt begründete Abweichungen; alte Versionen bleiben. Aussagen ohne gültige Quellen-ID werden verworfen. |
| **Lernen** | Runde mit 3–5 Bildern (zufällig, Schlagwort, Kapitel). Vier Freitextfragen, danach Analyse + 3–5 Sätze Feedback. Alles gespeichert. |
| **Geschichte** | 10 Kapitel. Quellen sammeln → „Entwurf aus Quellen erzeugen“ → prüfen, speichern, Status „geprüft“. Schlüsselbilder zuordnen; Ansicht wechselt Text und Bilder. |
| **Zeitleiste** | Alle Bilder mit Jahr, filterbar nach Kapitel. |

## KI

`ANTHROPIC_MODEL` (Standard `claude-opus-5-5`) und `ANTHROPIC_EFFORT` aus `.env`. Prompts liegen versioniert
in `prompts/`; jede Analyse speichert Modell und Prompt-Version. Bilder gehen verkleinert (max. 1568 px) als
Base64 an die API. `ANTHROPIC_FALLBACKS=default` schaltet den serverseitigen Fallback bei Ablehnungen ein
(nur direkte Claude API; leer lassen, um ihn abzuschalten).

## Startbestand (`seed/`)

`seed/content_*.json` enthält recherchierte Fotografen, Projekte, Bilder (Seiten- und Bild-URL) und
Quellenauszüge für die Kapitel. Import mit `make seed` – idempotent, kann wiederholt werden; Bilder, die sich
nicht laden lassen, werden aufgelistet und übersprungen. Die Bilder bleiben lokal (`data/` ist in `.gitignore`).
