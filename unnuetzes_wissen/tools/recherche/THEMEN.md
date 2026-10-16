# Themen zuordnen (ohne Internet)

Ordne jedem Eintrag (nur verdict == "belegt") der Eingabedateien 1–3 Themen aus dieser
festen Liste zu – nur wenn es wirklich passt; lieber 1 treffendes als 3 lockere:

- krimi        Kriminalfall, Betrug, Schmuggel, Diebstahl, Prozess wegen Straftat
- faelschung   Fälschungen, Kopien, Imitate, Hochstapelei
- legende      Spuk, Legenden, Aberglaube, Feng Shui, Glückszahlen, Rituale mit magischem Denken
- mythos       ein verbreiteter Irrtum wird aufgelöst
- panne        Pannen, Fails, Missgeschicke, Fehlplanungen, Schnapsideen, die schiefgingen
- rekord       Rekorde, Extreme, Weltrekorde, „am längsten/meisten“
- gesetz       absurde Gesetze, Verbote, Behörden-Kuriositäten, Gerichtsurteile ohne Straftat
- tiere        Tiere stehen im Mittelpunkt
- forschung    absurde/kuriose Studien, Experimente, Ig-Nobelpreise
- geld         Geld, Preise, Gier, Handel, Marken
- woerter      Wortherkunft, Namen, Sprache, Übersetzungen
- erfindung    Erfindungen, Zufallsentdeckungen, Produktgeschichte
- essen        Essen und Trinken
- bauwerk      Gebäude, Bauwerke, Stadtbild, Infrastruktur
- brauch       Feste, Bräuche, Alltagskultur, Wettbewerbe

Ausgabe: ein JSON-Objekt {"<id>": ["thema", ...], ...} an den Pfad aus deinem Auftrag.
Jede id der Eingabe (verdict belegt) genau einmal. Mit python3 prüfen: gültiges JSON,
nur Themen aus der Liste, alle ids vorhanden. Antworte nur mit Anzahl je Thema.
