# Sehschule – private Fotografie-Lern-App

Browser-App auf GitHub Pages (https://mrhode-jnw.github.io/insta_map/Fotoapp/), am Handy nutzbar, nur für den privaten Gebrauch von Mathias. Keine Veröffentlichung von Bildern: Bilder und eigene Daten liegen nur verschlüsselt im Repo (siehe README).

## Zugang

- Zugangscode wie bei der Karte (`../crypto.js`, AES-GCM/PBKDF2). Er entschlüsselt den Bilder-Schlüssel und die KI-Keys (OpenAI und/oder Anthropic) aus `Fotoapp/config.js`, den GitHub-Token aus `../config.js`.
- Bilder: Branch `sehschule-media` (`m/`, `t/`, verschlüsselt). Eigene Daten: Branch `map-data`, `sehschule/{analyses,answers,drills,discussions,chapters,user_library}.enc` (verschlüsselt).
- Nichts Unverschlüsseltes mit Bildern oder persönlichen Antworten committen.

## Ziel

Mathias (Reise- und Landschaftsfotograf auf fast professionellem Niveau; Architektur ist nicht sein Schwerpunkt) lernt an Bildern anderer Fotografen:
- wie gute Bilder gebaut sind (Analyse),
- wie sich die Fotografie in seinem Bereich entwickelt hat (Geschichte anhand konkreter Bilder),
- durch eigenes Urteilen vor dem Aufdecken der Analyse (Lernmodus).

Eigene Bilder kommen erst in einer späteren Stufe dazu.

## Leitprinzipien (verbindlich für Code und Prompts)

1. **Quelle und Einschätzung strikt trennen.** Jede Faktenaussage (Name, Jahr, Ort, Projekt, Zitat, Einfluss) braucht eine hinterlegte Quelle mit URL. Alles Abgeleitete steht getrennt darunter unter der Überschrift „Meine Einschätzung“.
2. **Nichts erfinden.** Keine Zitate, Jahreszahlen, Kamerainfos oder Biografiedetails ohne Quelle. Fehlt eine Quelle, steht dort: „Keine Quelle hinterlegt.“
3. **Stabile Analysen.** Eine Analyse wird einmal erzeugt und gespeichert. Neu erzeugt wird nur auf ausdrücklichen Wunsch. Dann sieht das Modell die alte Analyse und muss jede Abweichung begründen. Die alte Version bleibt erhalten.
4. **Niveau: fast Profi.** Keine Grundlagen wie Drittelregel, Belichtungsdreieck oder „führende Linien“ als Selbstzweck. Technik (Format, Kamera, Objektivwirkung, Belichtungszeit, Material, Abzug) dort, wo sie erklärt, warum das Bild so aussieht – Fakten dazu nur mit Quelle, Abgelesenes als Schätzung; keine Anfänger-Erklärungen. Fokus auf Standpunkt, Moment, Licht, Ebenen, Weglassen, Farbe, Haltung, Sequenz.
5. **Erst urteilen, dann lesen.** Im Lernmodus ist die Analyse verborgen, bis Mathias selbst geantwortet hat.
6. **Sprache der Oberfläche und der Analysen: Deutsch.** Code, Bezeichner und Kommentare: Englisch.

## Stufe 1 – Umfang

### 0. Sehen lernen (Schwerpunkt, ergänzt)
- **Sehübungen** (`#/sehen`, `drills.enc`): je Bild ein Aspekt (Dimensionen in `js/domain.js`), Frage eng gefasst, erst schauen (Timer), dann Antwort; aufgedeckt wird das passende Feld der gespeicherten Analyse; Feedback per `prompts/drill_feedback_v1.md` (die KI sieht das Bild).
- **„Erst schauen“-Timer** auch im Lernmodus; tatsächliche Schauzeit wird gespeichert.
- **Seh-Begriffe** (`#/begriffe`, `concepts` in `library.json`, Quellen mit `scope=concept`): Kurztext nur aus Quellen, Übung für unterwegs, Beispielbilder mit „Meine Einschätzung“. Import aus `seed/content_sehen.json`.

### 0b. Experten, Fotografen, Fortschritt, Diskussion (ergänzt)
- **Expertenstimmen pro Bild:** wörtliche Auszüge von Museen, Kurator:innen, Kritik, Wissenschaft oder den Fotograf:innen selbst (`seed/experts_*.json` → Quellen mit `kind`, `author`, `aspect`, `series_level`), getrennt von der KI-Analyse angezeigt.
- **Qualität und Wirkung:** Analyse-Feld `quality` (effect, strengths, weaknesses, significance) und `technique` – als Einschätzung der KI gekennzeichnet; Bedeutung als Fakt nur mit Quelle.
- **Fotograf:innen:** Porträt (verschlüsselt, `p/<id>.bin`), `bio_md`/`method_md` nur aus Quellen (`seed/photographers_bio.json`).
- **Bewertung der eigenen Einschätzung:** Feedback als JSON mit `hit` (Treffer 0–5), `precision` (Genauigkeit 0–5), `per_question` (Punkte je Frage), `missed` (was fehlte).
- **Kein Warten:** Analysen einer Runde werden beim Start im Hintergrund erzeugt; nach dem Absenden sofort aufdecken und weiter, Bewertung kommt nach; Rundenübersicht am Ende; offene Runden lassen sich fortsetzen.
- **Rückfragen/Diskussion** je Bild (`prompts/discuss_v1.md`, `discussions.enc`), mit Bild, Analyse, Quellen und eigenen Antworten als Kontext.
- **Fortschritt** (`#/fortschritt`: Treffer/Genauigkeit je Aspekt, Trend, häufig Übersehenes, Kapitelabdeckung) und **Verlauf** (`#/lernen/antworten`: alle gesehenen Bilder nach Tagen mit Punkten und Gesprächen).

### 1. Bibliothek
- Struktur: Fotograf → Projekt → Bild.
- Bild hinzufügen per Formular: Seiten-URL (Quelle), Bild-URL oder Datei-Upload, Fotograf, Projekt, Jahr (optional), Ort (optional), Schlagworte.
- Bild wird lokal gespeichert (`data/images/`), Thumbnail erzeugt (`data/thumbs/`).
- Quelle (Seiten-URL, Abrufdatum) wird immer gespeichert und in der Ansicht verlinkt.
- Fotografen- und Projektseiten mit Kurztext (nur aus hinterlegten Quellen, siehe Prinzip 1).

### 2. Analyse in vier Ebenen
Erzeugt per Claude API (Bildanalyse), Ausgabe als JSON nach Schema (unten), gespeichert in `analyses`.

1. **Was zu sehen ist** – nüchterne Beschreibung, keine Deutung.
2. **Wie es gebaut ist** – Standpunkt, geschätzte Distanz/Brennweite, Licht und Tageszeit, Moment (worauf gewartet wurde), Ebenen, Farbe, was weggelassen ist. Schätzungen als Schätzung kennzeichnen.
3. **Kontext** – nur aus den zum Bild/Projekt/Fotografen hinterlegten Quellen. Jede Aussage mit Quellenverweis `[S<id>]`. Darunter getrennt „Meine Einschätzung“.
4. **Übertragbare Technik** – 2–4 konkrete, übertragbare Punkte für die eigene Praxis.

### 3. Lernmodus
- Zeigt ein Bild (zufällig, nach Schlagwort oder nach Kapitel), Analyse verborgen.
- Vier Fragen, Freitext:
  - Wo stand der Fotograf?
  - Worauf hat er gewartet?
  - Was ist weggelassen?
  - Was hättest du anders gemacht?
  - plus eine wechselnde fünfte Frage nach Szarkowskis Kategorien (Ding selbst, Detail, Rahmen, Zeit; Felder `q_extra_label`/`q_extra`).
- Nach dem Absenden: Analyse aufdecken, daneben die eigenen Antworten.
- Kurzes Feedback (3–5 Sätze) von Claude: Wo deckt sich die Antwort mit der Analyse, was wurde übersehen.
- Antworten und Feedback werden gespeichert (`answers`).
- Sitzungslänge: 3–5 Bilder.

### 4. Geschichte (Bereich E, erste Ausbaustufe)
- **Kapitel** mit Titel, Zeitraum, Fließtext und 5–10 Schlüsselbildern aus der Bibliothek.
- **Kapiteltext entsteht quellenbasiert:** Mathias hinterlegt Quellen (URL + relevanter Textauszug) zum Kapitel. Claude schreibt den Entwurf nur aus diesen Auszügen, mit Verweisen `[S<id>]`. Aussagen ohne Beleg sind nicht erlaubt; Ableitungen stehen unter „Meine Einschätzung“.
- **Kapitelansicht:** Text und Schlüsselbilder abwechselnd; jedes Bild klickbar zur Analyse.
- **Zeitleiste:** alle Bilder mit Jahr auf einer horizontalen Achse, filterbar nach Kapitel.

Vorgeschlagene Kapitel (Inhalte erst beim Füllen mit Quellen belegen):
1. Expeditions- und Reisefotografie des 19. Jahrhunderts
2. Die große Landschaftsfotografie in Schwarzweiß
3. Der entscheidende Augenblick: Straßenfotografie und die Gründung von Magnum
4. Farbe wird ernst genommen: die Farbfotografen der 70er
5. Neue Topografie: Landschaft mit Spuren des Menschen
6. Das Reisemagazin-Zeitalter: ikonische Reportage- und Porträtbilder
7. Die großen Formate: Düsseldorfer Schule und die Megastädte
8. Natur und Tiere: von der Expedition zur Naturschutzfotografie
9. Zeitgenössische Landschaft: Mensch, Industrie, Klima
10. Instagram und die Folgen
11. Die Reise als Autorenprojekt: Roadtrip, Fremde, Blick von außen (ergänzt; Schwerpunkt Reise)

## Technik

- **Frontend:** statische Browser-App, Vanilla-JS-Module (`js/core.js` Krypto/GitHub/Bilder/Claude, `js/domain.js` Bibliothek/Analyse/Prompts, `js/app.js` Ansichten). Dunkles Layout, mobil zuerst, PWA-Manifest.
- **Daten:** `data/library.json` wird aus `seed/*.json` gebaut (`tools/build_library.py`, stabile IDs: Bilder `i…`, Quellen 6-stellig für `[S<id>]`). Eigene Bilder/Quellen kommen aus `user_library.enc` dazu.
- **Bilder:** beim Build auf 1568 px (API-Grenze) und 480 px skaliert, verschlüsselt; im Browser per WebCrypto entschlüsselt und im Cache-Storage gehalten.
- **KI:** zwei Anbieter, umschaltbar in `setup.html` (`SEHSCHULE_PROVIDER`): OpenAI Chat Completions (Bild als data-URL, `response_format` json_schema strict) oder Claude Messages API (`anthropic-dangerous-direct-browser-access`, `output_config.format`, Server-Fallback). Gleiche Prompts und gleiches Schema; jede Analyse speichert das tatsächlich verwendete Modell.
- **Prompts:** Dateien unter `prompts/` (versioniert), jede Analyse speichert `prompt_version` und `model`.
- **Theorie-Lektionen** (`seed/lessons_*.json`, Tracks sehen/grundlagen/fotografen): Texte sind bildhaft aufgebaut. Zeilen-Direktiven in `intro_md`/`body_md`: `::kurz`, `::merke`, `::schau`, `::bild <id> | Text`, `::vergleich <idA> <idB> | Text A | Text B`, `::skizze <name> | Text` (SVG in `seed/sketches/`, Stilklassen `a`/`af`/`m`/`mf`/`f`, beim Build bereinigt und in `library.json` eingebettet). Jeder Abschnitt beginnt mit `::kurz` und hat mindestens ein Bild oder eine Skizze; Quellen erscheinen als hochgestellte Nummern mit Einblendung.
- **Test:** `tests_web/e2e.js` (Playwright, GitHub und KI simuliert; `PROVIDER=openai|anthropic`).

### Verzeichnisstruktur
```
Fotoapp/
  index.html, setup.html, style.css, config.js, manifest.webmanifest
  js/            # core.js, domain.js, app.js
  prompts/       # analysis_v4, analysis_revision_v1, learn_feedback_v4, drill_feedback_v2, discuss_v1, chapter_draft_v4 (+ ältere Versionen)
  data/library.json
  seed/          # recherchierter Startbestand (Quellen wörtlich)
  tools/build_library.py
  docs/benchmark_hochschulen.md
  tests_web/e2e.js
```

## Datenmodell (Stufe 1)

Umgesetzt als JSON: Bibliothek in `data/library.json` (photographers, projects, images, sources mit `scope`/`scope_id`, chapters mit `images`, concepts), Nutzerdaten verschlüsselt in `map-data` (`analyses`: {image_id: [Versionen]}, `answers`, `drills`, `chapters`: {id: {text_md, status, images}}). Bei Neuerzeugung enthält das Analyse-JSON zusätzlich `deviations` [{field, reason}], bei entfernten unbelegten Aussagen `warnings`. Die ursprünglich geplanten SQL-Tabellen unten dienen als Feldbeschreibung.


- `photographers` (id, name, born, died, bio_md, created_at)
- `projects` (id, photographer_id, title, year_from, year_to, description_md)
- `images` (id, project_id, photographer_id, title, year, location, file_path, thumb_path, source_url, image_url, accessed_at, tags)
- `sources` (id, url, title, excerpt, accessed_at, scope_type [photographer|project|image|chapter], scope_id)
- `analyses` (id, image_id, version, model, prompt_version, json, created_at, replaced_by)
- `answers` (id, image_id, q_position, q_wait, q_omitted, q_different, feedback_md, created_at)
- `chapters` (id, number, title, period_from, period_to, text_md, status [draft|reviewed])
- `chapter_images` (chapter_id, image_id, position, caption_md)

## Analyse-JSON (Schema)

```json
{
  "seen": "string",
  "construction": {
    "viewpoint": "string",
    "distance_focal_estimate": "string (als Schätzung formuliert)",
    "light": "string",
    "moment": "string",
    "layers": "string",
    "color": "string",
    "omitted": "string",
    "edge": "string (Rahmen/Bildkante, ab v3)",
    "detail": "string (ab v3)",
    "focus_plane": "string (Schärfe und Tiefe als Bildwirkung, ab v3)"
  },
  "context": {
    "sourced": [{"text": "string", "source_ids": [1]}],
    "assessment": "string (Meine Einschätzung)"
  },
  "stance": "string (Haltung, Meine Einschätzung, ab v3)",
  "transferable": ["string", "string"],
  "not_assessable": "string (an der Bildschirmkopie nicht beurteilbar, ab v3)"
}
```
Leere Felder statt erfundener Inhalte. `context.sourced` darf nur Aussagen enthalten, die durch übergebene Quellenauszüge gedeckt sind.

## Prompt-Regeln (für alle Prompts)

- Rolle: erfahrener Bildredakteur und Fotohistoriker, schreibt für einen fortgeschrittenen Fotografen.
- Nur übergebene Quellenauszüge als Faktenbasis verwenden; alles andere ist Einschätzung oder fehlt.
- Keine Grundlagenerklärungen, keine Floskeln, keine Superlative ohne Begründung.
- Bei Neuerzeugung: vorherige Analyse wird mitgegeben; Abweichungen ausdrücklich begründen.

## Reihenfolge der Umsetzung

1. Projektgerüst, Datenbank, Migrationen, `.env.example`, Makefile.
2. Bibliothek: Fotograf/Projekt/Bild anlegen, Import per URL und Upload, Thumbnails, Listen- und Detailansicht.
3. Quellen anlegen und an Fotograf/Projekt/Bild/Kapitel hängen.
4. Analyse erzeugen, speichern, anzeigen; Versionierung bei Neuerzeugung.
5. Lernmodus mit verborgenem Aufdecken, Feedback, Speicherung.
6. Kapitel: Quellen sammeln, Entwurf erzeugen, bearbeiten, Bilder zuordnen, Kapitelansicht.
7. Zeitleiste.
8. Tests für Datenmodell, Import und JSON-Validierung der Analysen.

## Spätere Stufen – Gesamtkonzept

Erst umsetzen, wenn Stufe 1 läuft. Jede Stufe einzeln bauen und testen. Die Leitprinzipien gelten für alle Module.

### Stufe 2 – Lernen vertiefen (Referenzen)

**Fotografen-Vergleich**
- Zwei Referenzbilder zum selben Thema/Ort nebeneinander (z. B. Großstadt bei zwei Fotografen, Gebirge bei zwei Landschaftsfotografen).
- Vergleichsanalyse: Unterschiede in Standpunkt, Distanz, Licht, Moment, Haltung – Bauweise, nicht Geschmack.
- Tabelle `comparisons` (id, image_a_id, image_b_id, theme, json, created_at).

**Lernpfade**
- Kuratierte Folgen von 8–12 Bildern zu einem Thema (Licht, Nähe, Menschen, Nacht, Wetter, Farbe, Serie), aufeinander aufbauend.
- Fortschritt je Pfad speichern.
- Tabellen `paths` (id, title, theme, description_md), `path_items` (path_id, image_id, position, focus_md), `path_progress` (path_id, position, completed_at).

**Projekt-Sequenz**
- Ein ganzes Projekt in Originalreihenfolge (sofern bekannt und belegt), mit Analyse des Aufbaus: Einstieg, Wechsel, Rhythmus, Distanzverteilung, Schluss.
- Feld `sequence_position` in `images`, Tabelle `sequence_analyses` (project_id, json, created_at).

**Stilerkennung**
- Bild ohne Namen anzeigen; Mathias rät Fotograf und begründet.
- Auflösung mit den Merkmalen der Handschrift, die das Bild zuordenbar machen.
- Trefferquote je Fotograf speichern (`style_guesses`).

**Verteilte Wiederholung**
- Bereits gesehene Bilder kehren nach wachsenden Abständen zurück (z. B. 1, 3, 7, 21 Tage), mit einer Kurzfrage.
- Tabelle `reviews` (image_id, due_at, interval_days, last_result).

**Annotationen im Bild**
- Analyse liefert optional Bildbereiche (Lichtkante, Blickachse, Ebenen, Weggelassenes) als relative Koordinaten; Darstellung als einblendbare Overlays.
- Zuerst als Prototyp testen, ob die Verortung zuverlässig genug ist; sonst weglassen.

### Stufe 3 – Geschichte erweitern

**Einflusslinien**
- Belegte Einflüsse zwischen Fotografen (Interview, Ausstellungstext) als Verbindungen zwischen Bildern; ohne Quelle keine Linie.
- Tabelle `influences` (from_photographer_id, to_photographer_id, source_id, note_md).

**Damals – heute**
- Paare aus historischem und aktuellem Bild zu Ort oder Thema, weltweit.
- Analyse: was sich an Technik, Blick und Haltung verändert hat.
- Tabelle `pairs` (id, old_image_id, new_image_id, theme, json).

**Technik im Kontext**
- Je Kapitel: Kameras, Formate, Material, Belichtungszeiten der Zeit – nur aus Quellen.
- Erklärt, warum Bilder so aussehen, und was heute selbstverständlich ist.

**Erzählmodus**
- Kapitel zusätzlich als Hörstück-Skript mit zwei Stimmen (Moderation + Erzähler), sachlicher Feature-Ton.
- Export als Text; Audio-Erzeugung über externen Dienst optional und später.

### Stufe 4 – Eigene Bilder

Import über das bestehende Lightroom-Plugin „Claude-Bewertung“ (Export-Ordner mit JPEGs + `liste.csv`, Spalte `pfad` = Originalpfad). EXIF per `exiftool`.

**Tagesrückblick**
- Mathias wählt 3 Bilder des Tages und schreibt je einen Satz „Warum dieses?“.
- Danach Analyse nach demselben Vier-Ebenen-Raster (Ebene 3 entfällt oder enthält nur Mathias' eigene Angaben).
- Zum Schluss formuliert Mathias selbst eine Aufgabe für morgen.

**Passende Referenz**
- Zu einem eigenen Bild Referenzen mit ähnlichem Motiv/Aufbau finden (Schlagworte + Bildähnlichkeit über lokales Embedding-Modell, z. B. CLIP-Familie).
- Gegenüberstellung mit Analyse der Unterschiede in der Bauweise.

**Übung nach Vorbild**
- Aufgabe an eine Referenz gekoppelt (z. B. „Szene mit drei Ebenen“). Abends eigenes Ergebnis neben das Vorbild, kurze Analyse.

**Kalibrierung**
- Mathias' Sterne/Noten neben Claudes Bewertung über die Zeit; systematische Abweichungen je Motivart zeigen.
- Jede Bewertung gespeichert; bei erneuter Bewertung desselben Bildes muss Abweichung begründet werden.

**Auswahltraining**
- Echte Serien/Bursts aus dem Archiv (Plugin erkennt sie bereits); beste Aufnahme auf Zeit wählen.
- Dieselbe Serie Wochen später erneut: Stabilität des Urteils messen. Max. 10 Serien pro Sitzung.

**Archiv-Profil**
- Aus EXIF: Brennweiten, Uhrzeiten, Kamera vs. Drohne; per Bildklassifikation: Anteil Menschen, Nähe/Distanz, Spot-Motive.
- Daraus Aufgabenvorschläge gegen die eigene Gewohnheit (Merksatz: näher, höher, länger, hindurch; „eine Person pro Tag“ als Zähler).

**Serienwerkstatt / Buch-Dummy**
- 20–60 Bilder in Reihenfolge bringen; Analyse von Rhythmus, Distanzwechseln, Wiederholungen; Vergleich mit der Sequenz eines Referenzprojekts.
- Export als einfacher Layout-Vorschlag (PDF).

Tabellen (Entwurf): `own_images` (id, file_path, original_path, exif_json, imported_at), `own_reviews` (own_image_id, user_note, user_rating, ai_json, ai_rating, created_at), `tasks` (id, text, reference_image_id, due_date, done_at, result_image_id), `selection_rounds`, `sequences`.

### Stufe 5 – Unterwegs

**Morgenimpuls**
- Ein Referenzbild + eine Aufgabe, passend zum Ort des Tages. Ortsdaten aus dem Reiseplan (Markdown-Datei im GitHub-Repo, Pfad konfigurierbar).

**Ortsdossier**
- Vor der Ankunft: Referenzbilder anderer Fotografen zum Ort (aus der Bibliothek), Suchbegriffe für lokale Plattformen, Ideen für Gegenperspektiven.

**Notizen vor Ort**
- Kurze Text- oder Sprachnotiz zu einem Motiv; taucht abends im Tagesrückblick wieder auf.

**Mobil**
- App als PWA nutzbar machen; prüfen, ob Analysen offline vorgeladen werden können.

### Stufe 6 – Entwicklung

**Lerntagebuch**
- Alle Antworten, Begründungen und Aufgaben chronologisch; Auswertung, wie sich Vokabular und Kriterien verändern.

**Reise- bzw. Quartalsrückblick**
- Welche Aufgaben haben gewirkt, welche Referenzen haben am meisten beeinflusst, wie hat sich das Archiv-Profil verschoben.

**Deine Einordnung (Geschichte)**
- Nach jedem Kapitel: Welche eigenen Bilder stehen in dieser Tradition? Die App schlägt Kandidaten vor, Mathias entscheidet.

## Offene Punkte

- Startbestand an Fotografen/Projekten festlegen (Vorschlag: 8–10 Fotografen à 8–10 Bilder aus je einem Projekt).
- Welche Quellen pro Kapitel verwendet werden (Museen, Stiftungen, Interviews) – vor dem Schreiben sammeln.
- Prüfen, ob die Claude API und GitHub auf Reisen (z. B. China) ohne VPN erreichbar sind.
