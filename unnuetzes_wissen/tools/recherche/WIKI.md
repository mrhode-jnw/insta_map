# Bild-Motiv zuordnen (ohne Internet)

Für jeden Eintrag (nur verdict == "belegt") der Eingabedateien: Nenne den Titel des
ENGLISCHEN Wikipedia-Artikels, dessen Titelbild den Fakt am besten bebildert – so wie er
auf en.wikipedia.org heißt (z. B. "Wombat", "Pando (tree)", "Kowloon Walled City",
"Star Ferry", "Mona Lisa", "Tardigrade", "Ig Nobel Prize").

- Nimm das konkrete Motiv (Tier, Bauwerk, Ort, Gegenstand, Person des öffentlichen
  Lebens aus der Geschichte), nicht ein abstraktes Thema.
- Nur Artikel, von denen du sicher bist, dass es sie gibt. Im Zweifel ein allgemeineres
  Motiv (z. B. "Shenzhen" statt eines unbekannten Hochhauses).
- KEINE Bilder lebender Privatpersonen, keine Opfer, keine Verbrecher-Fotos, keine
  Leichen/Tatorte. Bei Kriminalfällen das Objekt oder den Ort wählen (z. B. "Huaqiangbei",
  "Cartier", "Lo Wu Control Point") oder null.
- Wenn kein sinnvolles, unbedenkliches Motiv existiert: null.

Ausgabe: JSON-Objekt {"<id>": "Titel" | null, …} an den Pfad aus deinem Auftrag; jede id
genau einmal; mit python3 prüfen. Antworte nur mit Anzahl Titel / null.
