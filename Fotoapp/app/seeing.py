"""Dimensions of seeing used by drills, concepts and the analysis."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    analysis_field: str | None  # field in analysis.construction, None = not drillable
    question: str
    hint: str


DIMENSIONS = [
    Dimension("viewpoint", "Standpunkt", "viewpoint",
              "Wo genau stand der Fotograf – Höhe, Abstand, Achse? Was wäre einen Meter weiter links, rechts oder höher verloren?",
              "Achte auf Horizonthöhe, Überschneidungen und darauf, welche Kanten sich berühren."),
    Dimension("distance", "Distanz", "distance_focal_estimate",
              "Wie nah ist er dran, und was macht diese Distanz mit dem Verhältnis von Vorder- und Hintergrund?",
              "Vergleiche Größenverhältnisse: Was rückt zusammen, was fällt auseinander?"),
    Dimension("light", "Licht", "light",
              "Woher kommt das Licht, wie ist es beschaffen – und was ordnet oder verschweigt es im Bild?",
              "Schatten lesen: Richtung, Länge, Härte. Wo liegt die hellste Stelle, wo fällt der Blick hin?"),
    Dimension("moment", "Moment", "moment",
              "Worauf wurde gewartet? Was wäre eine Sekunde (oder eine Stunde) früher oder später verloren?",
              "Gesten, Wetter, Verkehr, Lichtwechsel – was ist vorübergehend, was bleibt?"),
    Dimension("layers", "Ebenen", "layers",
              "Wie viele Ebenen gibt es, und wie greifen sie ineinander?",
              "Fahre mit dem Blick von vorn nach hinten. Wo wird verdeckt, wo geöffnet?"),
    Dimension("color", "Farbe und Ton", "color",
              "Welche Farben oder Tonwerte tragen das Bild, und welche fehlen auffällig?",
              "Suche Wiederholungen und den einen Farbton, der aus dem Rest fällt."),
    Dimension("omitted", "Weglassen", "omitted",
              "Was ist außerhalb des Rahmens geblieben – und warum hilft das dem Bild?",
              "Stell dir das Bild 20 % weiter vor. Was käme hinein, was ginge kaputt?"),
    Dimension("frame", "Rahmen", None, "", ""),
    Dimension("attitude", "Haltung", None, "", ""),
    Dimension("sequence", "Sequenz", None, "", ""),
]

BY_KEY = {d.key: d for d in DIMENSIONS}
DRILLABLE = [d for d in DIMENSIONS if d.analysis_field]
LOOK_CHOICES = [0, 30, 60, 90]
