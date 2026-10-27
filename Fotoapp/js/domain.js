// Domain logic: library (seed + own additions), sources, analysis generation and feedback.
import { ai, AIError, loadState, mediaBase64, mutateState, prompt, uid } from "./core.js";

// ---------- library
export const lib = { photographers: [], projects: [], images: [], sources: [], chapters: [], concepts: [], by: {} };
export const EMPTY_USER_LIB = { photographers: [], projects: [], images: [], sources: [] };

export async function loadLibrary() {
  const base = await fetch(`data/library.json?v=${window.SEHSCHULE_BUILD || ""}`).then(r => r.json());
  const own = await loadState("user_library", EMPTY_USER_LIB);
  for (const k of ["photographers", "projects", "images", "sources"]) lib[k] = [...base[k], ...(own[k] || [])];
  lib.chapters = base.chapters;
  lib.concepts = base.concepts;
  lib.lessons = base.lessons || [];
  lib.sketches = base.sketches || {};
  lib.references = base.references || [];
  lib.facts = base.facts || [];
  lib.womit = base.womit || [];
  lib.anecdotes = base.anecdotes || [];
  lib.myths = base.myths || [];
  lib.editing = base.editing || { series: [], versions: [], sequences: [] };
  lib.built_at = base.built_at;
  index();
}
function index() {
  lib.by = {};
  for (const k of ["photographers", "projects", "images", "chapters", "concepts"]) lib.by[k] = new Map(lib[k].map(x => [x.id, x]));
  lib.by.sources = new Map(lib.sources.map(s => [s.id, s]));
  lib.by.lessons = new Map((lib.lessons || []).map(l => [l.id, l]));
  lib.by.refs = new Map((lib.references || []).map(r => [`${r.image_id}:${r.dimension}`, r]));
  lib.photographers.sort((a, b) => a.name.localeCompare(b.name));
}
export const photographerOf = img => lib.by.photographers.get(img.photographer_id) || { name: "?" };
export const projectOf = img => lib.by.projects.get(img.project_id);
export const sourcesFor = (scope, id) => lib.sources.filter(s => s.scope === scope && s.scope_id === id);
export function sourcesForImage(img) {
  return lib.sources.filter(s => (s.scope === "image" && s.scope_id === img.id)
    || (s.scope === "project" && s.scope_id === img.project_id)
    || (s.scope === "photographer" && s.scope_id === img.photographer_id));
}
export const expertsFor = img => lib.sources.filter(s => s.kind && s.scope === "image" && s.scope_id === img.id);
export const allTags = () => [...new Set(lib.images.flatMap(i => i.tags || []))].sort();

export async function addOwn(kind, item, message) {
  const next = await mutateState("user_library", EMPTY_USER_LIB, s => { (s[kind] ||= []).push(item); return s; }, message);
  lib[kind] = [...lib[kind].filter(x => x.id !== item.id), item];
  index();
  return next;
}
export const newSourceId = () => 900000 + Math.floor(Math.random() * 99999);
export const ownId = prefix => prefix + uid();

// ---------- dimensions of seeing
export const DIMENSIONS = [
  { key: "viewpoint", label: "Standpunkt", field: "viewpoint",
    q: "Wo genau stand der Fotograf – Höhe, Abstand, Achse? Was wäre einen Meter weiter links, rechts oder höher verloren?",
    hint: "Achte auf Horizonthöhe, Überschneidungen und darauf, welche Kanten sich berühren." },
  { key: "distance", label: "Distanz", field: "distance_focal_estimate",
    q: "Wie nah ist er dran, und was macht diese Distanz mit dem Verhältnis von Vorder- und Hintergrund?",
    hint: "Vergleiche Größenverhältnisse: Was rückt zusammen, was fällt auseinander?" },
  { key: "light", label: "Licht", field: "light",
    q: "Woher kommt das Licht, wie ist es beschaffen – und was ordnet oder verschweigt es im Bild?",
    hint: "Schatten lesen: Richtung, Länge, Härte. Wo liegt die hellste Stelle, wo fällt der Blick hin?" },
  { key: "moment", label: "Moment", field: "moment",
    q: "Worauf wurde gewartet? Was wäre eine Sekunde (oder eine Stunde) früher oder später verloren?",
    hint: "Gesten, Wetter, Verkehr, Lichtwechsel – was ist vorübergehend, was bleibt?" },
  { key: "layers", label: "Ebenen", field: "layers",
    q: "Wie viele Ebenen gibt es, und wie greifen sie ineinander?",
    hint: "Fahre mit dem Blick von vorn nach hinten. Wo wird verdeckt, wo geöffnet?" },
  { key: "color", label: "Farbe und Ton", field: "color",
    q: "Welche Farben oder Tonwerte tragen das Bild, und welche fehlen auffällig?",
    hint: "Suche Wiederholungen und den einen Farbton, der aus dem Rest fällt." },
  { key: "omitted", label: "Weglassen", field: "omitted",
    q: "Was ist außerhalb des Rahmens geblieben – und warum hilft das dem Bild?",
    hint: "Stell dir das Bild 20 % weiter vor. Was käme hinein, was ginge kaputt?" },
  { key: "frame", label: "Rahmen", field: "edge",
    q: "Was entsteht genau an den vier Bildkanten – was wird angeschnitten, was berührt den Rand, was hält Abstand?",
    hint: "Gehe die Kanten einzeln ab. Warum steht der Rand hier und nicht eine Handbreit weiter?" },
  { key: "detail", label: "Detail", field: "detail",
    q: "Welches Detail trägt das Bild – und was erzählt es, das die Gesamtszene nicht erzählt?",
    hint: "Suche das Kleinste, das du nicht weglassen könntest." },
  { key: "attitude", label: "Haltung", field: "stance",
    q: "Welche Haltung hat der Fotograf zu dem, was er zeigt – Nähe, Distanz, Respekt, Ironie, Außenblick?",
    hint: "Woran im Bild machst du das fest: Höhe, Abstand, Blickkontakt, Auswahl, Moment?" },
  { key: "scale", label: "Maßstab", field: "scale",
    q: "Woran liest du die Größe dieser Landschaft ab – und wie steuert der Fotograf, ob sie groß, klein oder unbestimmbar wirkt?",
    hint: "Suche Maßstabsträger: Menschen, Bäume, Wege, Häuser. Fehlen sie, was passiert dann?" },
  { key: "atmosphere", label: "Atmosphäre und Wetter", field: "atmosphere",
    q: "Was tun Wetter, Dunst, Wolken oder Jahreszeit in diesem Bild – und was wäre es bei klarem Mittagslicht?",
    hint: "Achte auf Luftperspektive, Kontrastabfall nach hinten, Wolkenschatten, nasse oder trockene Flächen." },
  { key: "focus", label: "Schärfe und Unschärfe", field: "focus_plane",
    q: "Wo liegt die Schärfe, wie tief reicht sie – und was gewinnt oder verliert das Bild dadurch?",
    hint: "Vergleiche Vorder- und Hintergrund: Was ist lesbar, was wird zur Fläche oder Farbe?" },
  { key: "order", label: "Bildordnung", field: "pictorial_order",
    q: "Wie ist das Bild ins Gleichgewicht gebracht – wo liegt Gewicht, wo Spannung, in welche Richtung zieht es?",
    hint: "Kneif die Augen zusammen: Welche Massen bleiben? Was ist Figur, was Grund?" },
  { key: "surface", label: "Fläche und Raum", field: "surface_space",
    q: "Liest du das Bild eher als Fläche (Muster, Geometrie, Rhythmus) oder als Raum – und wie erzeugt der Fotograf das?",
    hint: "Achte auf Kanten, die Ebenen verbinden, auf Wiederholungen und darauf, ob Tiefe gezeigt oder unterdrückt wird." },
  { key: "time", label: "Zeit und Bewegung", field: "time_motion",
    q: "Wie viel Zeit steckt in diesem Bild – eingefroren, verwischt, gedehnt – und was macht das mit der Wirkung?",
    hint: "Suche Bewegungsspuren: Wasser, Wolken, Menschen, Fahrzeuge. Was wäre bei 1/1000 s oder 30 s anders?" },
  { key: "sequence", label: "Sequenz", field: null },
];
export const DIM = Object.fromEntries(DIMENSIONS.map(d => [d.key, d]));
// What each aspect covers – and what belongs to other aspects. Feedback must stay inside this scope:
// a distance drill must not mark camera height (viewpoint) or reflections (layers) as "missing".
export const DIM_SCOPE = {
  viewpoint: ["Kamerahöhe, seitliche Lage, Blickachse und Abstand des Standorts; woran man sie im Bild abliest (Horizont relativ zu Dingen, Überschneidungen, Ober-/Unterseiten)", "Licht, Moment, Farbe, Bildwirkung der Ebenen"],
  distance: ["Abstand zum Motiv und die daraus folgenden Größenverhältnisse von Nah und Fern, Raumdehnung oder -stauchung, Brennweitenwirkung, Maßstabsanker zum Abschätzen des Abstands", "Kamerahöhe und Blickachse (Standpunkt), Spiegelungen, Licht, Farbe, Moment, Ebenenaufbau als Gestaltung"],
  light: ["Lichtrichtung, -qualität, Tageszeit/Wetter als Lichtquelle, Schatten, Kontrast, was das Licht hervorhebt oder verschweigt", "Standpunkt, Distanz, Moment (außer Lichtwechsel), Farbe als Gestaltung"],
  moment: ["worauf gewartet wurde, was den Augenblick ausmacht, was früher oder später verloren wäre (Gesten, Konstellation, Wetter- und Lichtwechsel)", "Standpunkt, Distanz, Bildaufbau ohne Zeitbezug"],
  layers: ["Zahl und Staffelung der Raumebenen, wie sie sich überlagern, verdecken oder öffnen, Tiefenhinweise", "Standpunkt, Licht als Thema, Farbe, Moment"],
  color: ["tragende Farben oder Tonwerte, Farbbeziehungen, Akzente, was farblich fehlt", "Standpunkt, Distanz, Moment, Ebenen"],
  omitted: ["was außerhalb des Rahmens bleibt oder ausgeschnitten ist und was das Bild dadurch gewinnt", "Kamerahöhe, Licht, Moment, Farbe"],
  frame: ["was an den vier Bildkanten geschieht: Anschnitte, Berührungen, Abstände zum Rand", "Standpunkt, Licht, Farbe, Moment"],
  detail: ["welches Einzelne für das Ganze steht und warum", "Standpunkt, Licht, Distanz als Messung"],
  attitude: ["Haltung zum Motiv und zu Menschen: Nähe/Distanz im übertragenen Sinn, Respekt, Ironie, beobachtet oder inszeniert", "Technik, Licht, Farbe als Selbstzweck"],
  scale: ["woran man die Größe der Szene abliest, Maßstabsträger, betonte oder unbestimmbare Größe", "Licht, Farbe, Moment"],
  atmosphere: ["Dunst, Nebel, Wolken, Niederschlag, Jahreszeit, Luftperspektive und was sie leisten", "Standpunkt, Moment ohne Wetterbezug"],
  focus: ["wo die Schärfe liegt, Tiefe oder Flachheit, was die Schärfe lenkt", "Standpunkt, Licht, Farbe"],
  order: ["Gewichtsverteilung, Gleichgewicht oder Spannung, Richtung, Blickführung, Figur und Grund", "Standpunkt als Ort, Licht als Quelle, Moment"],
  surface: ["ob sich das Bild als Fläche oder Raum liest und wodurch (Geometrie, Rhythmus, Verflachung)", "Standpunkt als Ort, Moment, Licht als Quelle"],
  time: ["Belichtungszeit als Bildwirkung: eingefroren, Bewegungsunschärfe, Langzeit", "Standpunkt, Farbe, Ebenen"],
};
export const scopeText = key => DIM_SCOPE[key] ? `Gehört zu diesem Aspekt: ${DIM_SCOPE[key][0]}.\nGehört NICHT dazu (andere Aspekte, weder als Fehler noch als fehlend werten): ${DIM_SCOPE[key][1]}.` : "";
export const DRILLABLE = DIMENSIONS.filter(d => d.field);

export const QUESTIONS = [
  ["q_position", "Wo stand der Fotograf?"],
  ["q_wait", "Worauf hat er gewartet?"],
  ["q_omitted", "Was ist weggelassen?"],
  ["q_different", "Was hättest du anders gemacht?"],
];
// Rotating fifth question after Szarkowski's categories (MoMA 1966).
export const EXTRA_QUESTIONS = [
  "Das Ding selbst: Was ist hier eigentlich das Motiv – und was daran sieht man nur auf dem Foto so?",
  "Detail: Welches Detail steht für das Ganze?",
  "Rahmen: Was entsteht an den Bildkanten?",
  "Zeit: Wie viel Zeit steckt in diesem Bild – ein Bruchteil, ein Tag, Jahrzehnte?",
];
export const CONSTRUCTION_LABELS = [
  ["viewpoint", "Standpunkt"], ["distance_focal_estimate", "Distanz / Brennweite (Schätzung)"],
  ["light", "Licht und Tageszeit"], ["moment", "Moment"], ["layers", "Ebenen"], ["color", "Farbe / Tonwerte"],
  ["omitted", "Weggelassen"], ["edge", "Rahmen / Bildkante"], ["detail", "Detail"], ["focus_plane", "Schärfe und Tiefe"],
  ["scale", "Maßstab"], ["atmosphere", "Atmosphäre und Wetter"],
  ["pictorial_order", "Bildordnung (Gewicht, Spannung, Richtung)"], ["surface_space", "Fläche und Raum"], ["time_motion", "Zeit und Bewegung"],
];
export const referenceText = (data, field) => ((data?.construction || {})[field] || data?.[field] || "").trim();

// ---------- analysis
const str = { type: "string" };
const CONSTRUCTION_KEYS = CONSTRUCTION_LABELS.map(([k]) => k);
const obj = props => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const ANALYSIS_PROPS = {
  // first: where the key things sit on the 10x10 grid, so every later position claim is anchored
  layout: { type: "array", items: obj({ thing: str, where: str }) },
  seen: str,
  construction: obj(Object.fromEntries(CONSTRUCTION_KEYS.map(k => [k, str]))),
  context: obj({ sourced: { type: "array", items: obj({ text: str, source_ids: { type: "array", items: { type: "integer" } } }) }, assessment: str }),
  stance: str,
  technique: str,
  quality: obj({ effect: str, strengths: str, weaknesses: str, significance: str }),
  transferable: { type: "array", items: str },
  not_assessable: str,
};
export const ANALYSIS_SCHEMA = obj(ANALYSIS_PROPS);
const int = { type: "integer" };
export const FEEDBACK_SCHEMA = obj({
  feedback: str, hit: int, precision: int,
  per_question: { type: "array", items: obj({ question: str, points: int, note: str }) },
  missed: { type: "array", items: str },
});
// Clamp model scores into 0–5.
export const clampScores = fb => ({ ...fb, hit: Math.max(0, Math.min(5, fb.hit | 0)), precision: Math.max(0, Math.min(5, fb.precision | 0)),
  per_question: (fb.per_question || []).map(q => ({ ...q, points: Math.max(0, Math.min(5, q.points | 0)) })) });
export const REVISION_SCHEMA = obj({ ...ANALYSIS_PROPS, deviations: { type: "array", items: obj({ field: str, reason: str }) } });
const ANALYSIS_PROMPT = "analysis_v6", REVISION_PROMPT = "analysis_revision_v2";

// Drop sourced statements without a valid source id (principle: no fact without a source).
export function enforceSources(data, allowedIds) {
  const warnings = [];
  const kept = [];
  for (const st of data.context?.sourced || []) {
    const ids = (st.source_ids || []).filter(i => allowedIds.has(i));
    if (!ids.length) { warnings.push(`Aussage ohne gültige Quelle entfernt: „${st.text.slice(0, 80)}…“`); continue; }
    if (ids.length !== st.source_ids.length) warnings.push(`Ungültige Quellen-IDs entfernt bei: „${st.text.slice(0, 80)}…“`);
    kept.push({ text: st.text, source_ids: ids });
  }
  data.context = { ...(data.context || {}), sourced: kept };
  data.transferable = (data.transferable || []).filter(t => t.trim()).slice(0, 4);
  if (warnings.length) data.warnings = warnings;
  return data;
}

export const formatSources = srcs => srcs.length
  ? srcs.map(s => `<source id="${s.id}" scope="${s.scope}"${s.kind ? ` kind="expert:${s.kind}"` : ""}${s.author ? ` author="${s.author}"` : ""} url="${s.url}" title="${s.title}">\n${(s.excerpt || "").trim()}\n</source>`).join("\n")
  : "(Keine Quellen hinterlegt.)";

export const imageMeta = img => ({
  fotograf: photographerOf(img).name, projekt: projectOf(img)?.title || null, titel: img.title || null,
  jahr: img.year ?? null, ort: img.location || null, quelle: img.source_url,
});

export async function analyses() { return loadState("analyses", {}); }
export async function currentAnalysis(imgId) {
  const list = (await analyses())[imgId] || [];
  return list.length ? list[list.length - 1] : null;
}

// Stable analyses: generated once; regeneration only on request, with the previous version and justified deviations.
const inflight = new Map();
export function generateAnalysis(img, regenerate = false, objection = "") {
  if (!regenerate && inflight.has(img.id)) return inflight.get(img.id);
  const p = doGenerateAnalysis(img, regenerate, objection).finally(() => inflight.delete(img.id));
  if (!regenerate) inflight.set(img.id, p);
  return p;
}
export const analysisPending = id => inflight.has(id);

async function doGenerateAnalysis(img, regenerate, objection = "") {
  const current = await currentAnalysis(img.id);
  if (current && !regenerate) return current;
  const srcs = sourcesForImage(img);
  let system = await prompt(ANALYSIS_PROMPT), version = ANALYSIS_PROMPT;
  if (current) { system += "\n\n" + await prompt(REVISION_PROMPT); version += "+" + REVISION_PROMPT; }
  let text = `<metadata>\n${JSON.stringify(imageMeta(img), null, 2)}\n</metadata>\n\n<sources>\n${formatSources(srcs)}\n</sources>`;
  if (current) text += `\n\n<previous_analysis>\n${JSON.stringify(current.data, null, 2)}\n</previous_analysis>`;
  if (current && objection) text += `\n\n<objection>\n${objection}\n</objection>`;
  const res = await ai({
    system, schema: current ? REVISION_SCHEMA : ANALYSIS_SCHEMA, thorough: true,
    content: [...await imageBlocks(img), { type: "text", text }],
  });
  const data = enforceSources(res.data, new Set(srcs.map(s => s.id)));
  const entry = { version: (current?.version || 0) + 1, model: res.model, prompt_version: version, created_at: new Date().toISOString(), data,
    ...(objection ? { objection } : {}) };
  await mutateState("analyses", {}, s => { (s[img.id] ||= []).push(entry); return s; }, `Analyse ${img.id} v${entry.version}`);
  return entry;
}

// The picture twice: clean, and with a labelled 10x10 grid as a measuring aid. Vision models misjudge positions in the
// frame ("near the right edge" for something right of centre); the grid anchors every position claim.
const gridCache = new Map();
async function griddedBase64(id, b64) {
  if (gridCache.has(id)) return gridCache.get(id);
  const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: "image/jpeg" }));
  const pad = Math.round(Math.max(bmp.width, bmp.height) * 0.04), W = bmp.width, H = bmp.height;
  const cv = document.createElement("canvas"); cv.width = W + pad; cv.height = H + pad;
  const g = cv.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, pad, pad);
  const line = (x1, y1, x2, y2) => { for (const [c, w] of [["rgba(0,0,0,.55)", 3], ["rgba(255,255,255,.75)", 1]]) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); } };
  for (let i = 1; i < 10; i++) { line(pad + W * i / 10, pad, pad + W * i / 10, pad + H); line(pad, pad + H * i / 10, pad + W, pad + H * i / 10); }
  g.fillStyle = "#fff"; g.font = `bold ${Math.round(pad * 0.62)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  for (let i = 0; i < 10; i++) { g.fillText("ABCDEFGHIJ"[i], pad + W * (i + 0.5) / 10, pad / 2); g.fillText(String(i + 1), pad / 2, pad + H * (i + 0.5) / 10); }
  const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.88));
  const out = btoa(Array.from(new Uint8Array(await blob.arrayBuffer()), c => String.fromCharCode(c)).join(""));
  gridCache.set(id, out); return out;
}
export const GRID_NOTE = "Das Bild kommt zweimal: zuerst unverändert, dann mit einem Messraster (10 × 10; Spalten A–J von links nach rechts, Zeilen 1–10 von oben nach unten). Das Raster ist nur eine Messhilfe, nicht Teil des Bildes.";
export async function imageBlocks(img) {
  const b64 = await mediaBase64(img.id);
  const grid = await griddedBase64(img.id, b64).catch(() => null); // without canvas (e.g. tests in node) the clean image suffices
  return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
    ...(grid ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: grid } }, { type: "text", text: GRID_NOTE }] : [])];
}

export async function learnFeedback(analysis, answers, img = null) {
  let txt = QUESTIONS.map(([k, l]) => `${l}\n${(answers[k] || "").trim() || "(keine Antwort)"}\n`).join("\n");
  if (answers.q_extra_label) txt += `\n${answers.q_extra_label}\n${(answers.q_extra || "").trim() || "(keine Antwort)"}\n`;
  const res = await ai({ system: await prompt("learn_feedback_v6"), maxTokens: 4000, schema: FEEDBACK_SCHEMA, light: true,
    content: [...(img ? await imageBlocks(img) : []),
      { type: "text", text: `<analysis>\n${JSON.stringify(analysis, null, 2)}\n</analysis>\n\n<answers>\n${txt}</answers>` }] });
  return clampScores(res.data);
}

// Sourced reference for an image and aspect (photographers, museums, courses — not AI), or null.
export const refFor = (imageId, dim) => lib.by.refs?.get(`${imageId}:${dim}`) || null;
export const refCount = dim => (lib.references || []).filter(r => r.dimension === dim && lib.by.images.has(r.image_id)).length;
export function referenceSourcesText(ref) {
  const ids = [...new Set(ref.entries.flatMap(e => e.source_ids))];
  return ref.entries.map(e => `Musterantwort: ${e.answer_md}\nPrüfbare Punkte:\n${e.checkable.map(c => "- " + c).join("\n")}${e.scope_note ? `\nHinweis: ${e.scope_note}` : ""}`).join("\n\n")
    + "\n\nQuellen (wörtlich):\n" + ids.map(i => lib.by.sources.get(i)).filter(Boolean)
      .map(s => `[S${s.id}] ${s.author || ""}${s.role ? ` (${s.role})` : ""}: "${s.excerpt}" – ${s.title}`).join("\n");
}
// Learning round: which questions can be checked against sourced references
export const LEARN_REF_DIMS = { q_position: "viewpoint", q_wait: "moment", q_omitted: "omitted" };
export const EXTRA_REF_DIMS = [null, "detail", "frame", "time"]; // matches EXTRA_QUESTIONS
export function learnRefs(imageId, extraLabel = "") {
  const out = {};
  for (const [k, dim] of Object.entries(LEARN_REF_DIMS)) { const r = refFor(imageId, dim); if (r) out[k] = r; }
  const xi = EXTRA_QUESTIONS.indexOf(extraLabel), xdim = EXTRA_REF_DIMS[xi];
  if (xdim && refFor(imageId, xdim)) out.q_extra = refFor(imageId, xdim);
  return out;
}
export async function learnFeedbackSourced(img, answers, refs) {
  const qs = [...QUESTIONS, ...(answers.q_extra_label ? [["q_extra", answers.q_extra_label]] : [])];
  const dimOf = k => k === "q_extra" ? EXTRA_REF_DIMS[EXTRA_QUESTIONS.indexOf(answers.q_extra_label)] : LEARN_REF_DIMS[k];
  const txt = qs.map(([k, l]) => `${l}\nAntwort: ${(answers[k] || "").trim() || "(keine Antwort)"}\n`
    + (refs[k] ? `Umfang der Frage:\n${scopeText(dimOf(k))}\nReferenz:\n${referenceSourcesText(refs[k])}\n` : "Referenz: keine Quelle\n")).join("\n");
  const res = await ai({ system: await prompt("learn_feedback_src_v2"), maxTokens: 4000, schema: FEEDBACK_SCHEMA, light: true,
    content: [...await imageBlocks(img), { type: "text", text: `<references_and_answers>\n${txt}</references_and_answers>` }] });
  return clampScores(res.data);
}

export async function drillFeedbackSourced(img, dim, ref, answer) {
  const res = await ai({ system: await prompt("drill_feedback_src_v2"), maxTokens: 4000, schema: FEEDBACK_SCHEMA, light: true, content: [
    ...await imageBlocks(img),
    { type: "text", text: `<dimension>${dim.label}</dimension>\n<question>${dim.q}</question>\n<scope>\n${scopeText(dim.key)}\n</scope>\n\n<reference>\n${referenceSourcesText(ref)}\n</reference>\n\n<answer>${answer.trim() || "(keine Antwort)"}</answer>` },
  ] });
  return clampScores(res.data);
}

export async function drillFeedback(img, dim, analysis, answer) {
  const res = await ai({ system: await prompt("drill_feedback_v5"), maxTokens: 4000, schema: FEEDBACK_SCHEMA, light: true, content: [
    ...await imageBlocks(img),
    { type: "text", text: `<dimension>${dim.label}</dimension>\n<question>${dim.q}</question>\n<scope>\n${scopeText(dim.key)}\n</scope>\n\n<reference>${referenceText(analysis, dim.field)}</reference>\n\n<answer>${answer.trim() || "(keine Antwort)"}</answer>` },
  ] });
  return clampScores(res.data);
}

// Follow-up questions / discussion about one image, with everything known about it.
export async function discuss(img, analysis, myAnswers, thread, question) {
  const srcs = sourcesForImage(img);
  const history = thread.map(m => `${m.role === "user" ? "Er" : "Du"}: ${m.text}`).join("\n\n");
  const res = await ai({ system: await prompt("discuss_v1"), maxTokens: 4000, light: true, content: [
    ...await imageBlocks(img),
    { type: "text", text: `<metadata>\n${JSON.stringify(imageMeta(img), null, 2)}\n</metadata>\n\n<sources>\n${formatSources(srcs)}\n</sources>\n\n`
      + `<analysis>\n${JSON.stringify(analysis || {}, null, 2)}\n</analysis>\n\n<his_answers>\n${JSON.stringify(myAnswers, null, 2)}\n</his_answers>\n\n`
      + `<conversation>\n${history || "(noch kein Gespräch)"}\n</conversation>\n\n<question>${question}</question>` },
  ] });
  return res.text;
}

// Theory progress: {theory: {<dimension>: {passed, best, total, attempts, at}}}
export const PASS_RATIO = 0.8;
export async function theoryProgress() { return (await loadState("progress", { theory: {} })).theory || {}; }
export const isUnlocked = (progress, dim) => !lib.by.lessons?.has(dim) || !!progress[dim]?.passed;
export const LEARN_ROUND_REQUIRES = ["viewpoint", "moment", "omitted"];

export async function askLesson(lesson, thread, question) {
  const text = [lesson.intro_md, ...lesson.sections.map(s => `## ${s.heading}\n${s.body_md}`), "Merksätze:\n- " + lesson.takeaways.join("\n- ")].join("\n\n");
  const srcs = lib.sources.filter(s => s.scope === "lesson" && s.scope_id === lesson.id);
  const history = thread.map(m => `${m.role === "user" ? "Er" : "Du"}: ${m.text}`).join("\n\n");
  const res = await ai({ system: await prompt("lesson_discuss_v1"), maxTokens: 4000, light: true,
    content: `<lesson title="${lesson.title}">\n${text}\n</lesson>\n\n<sources>\n${formatSources(srcs)}\n</sources>\n\n<conversation>\n${history || "(noch kein Gespräch)"}\n</conversation>\n\n<question>${question}</question>` });
  return res.text;
}

export async function chapterDraft(ch, keyImages) {
  const srcs = sourcesFor("chapter", ch.id);
  if (!srcs.length) throw new AIError("Erst Quellen mit Textauszug hinterlegen – ohne Quellen kein Entwurf.");
  const meta = { nummer: ch.number, titel: ch.title, zeitraum: [ch.period_from, ch.period_to] };
  const imgs = keyImages.map(i => ({ fotograf: photographerOf(i).name, titel: i.title, jahr: i.year }));
  const res = await ai({ system: await prompt("chapter_draft_v4"),
    content: `<chapter>\n${JSON.stringify(meta, null, 2)}\n</chapter>\n\n<key_images>\n${JSON.stringify(imgs, null, 2)}\n</key_images>\n\n<sources>\n${formatSources(srcs)}\n</sources>` });
  return res.text;
}

// ---------- markdown (trusted local text, escaped first) with [S<id>] links
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export { esc };
export function linkRefs(html) {
  return html.replace(/\[(S\d+(?:\s*,\s*S?\d+)*)\]/g, (_, g) =>
    "[" + g.match(/\d+/g).map(i => `<a class="ref" href="#source-${i}" data-src="${i}">S${i}</a>`).join(", ") + "]");
}
export function md(text) {
  const out = [];
  let list = null;
  for (const raw of esc(text).split(/\n/)) {
    const line = raw.trimEnd();
    const inline = s => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, "$1<i>$2</i>");
    if (/^\s*[-*] /.test(line)) { if (!list) { list = []; } list.push(`<li>${inline(line.replace(/^\s*[-*] /, ""))}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    if (/^#{1,3} /.test(line)) { const n = line.match(/^#+/)[0].length + 1; out.push(`<h${n}>${inline(line.replace(/^#+ /, ""))}</h${n}>`); }
    else if (/^&lt;!--.*--&gt;$/.test(line)) out.push(`<p class="muted small">${line.replace(/^&lt;!--\s*|\s*--&gt;$/g, "")}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);
  return linkRefs(out.join("\n"));
}
export const referencedIds = text => new Set([...String(text).matchAll(/\[(S\d+(?:\s*,\s*S?\d+)*)\]/g)].flatMap(m => m[1].match(/\d+/g).map(Number)));

// Estimated study time (minutes) for a lesson's core path and its Vertiefung — same formula as tools/lesson_time.py,
// calibrated on the user's pace: 80 words/min, 1.5 min per image or sketch, 0.3 min per gallery thumbnail, 1 min per quiz question.
const WPM = 80, PER_VISUAL = 1.5, PER_QUESTION = 1, PER_GLANCE = 0.3; // gallery thumbnail = a quick look
const textCost = text => String(text || "").split("\n").reduce((m, line) => {
  const d = line.trim().match(/^::(\w+)\s*(.*)$/);
  const visual = d ? (d[1] === "vergleich" ? 2 : ["bild", "skizze"].includes(d[1]) ? 1 : 0) : 0;
  const glance = d?.[1] === "galerie" ? d[2].split("|")[0].trim().split(/\s+/).length * PER_GLANCE : 0;
  return m + visual * PER_VISUAL + glance + (d ? d[2] : line).replace(/\[(?:S|Q)\d+[^\]]*\]/g, "").split(/\s+/).filter(Boolean).length / WPM;
}, 0);
export const splitDeep = text => { const [a, ...b] = String(text || "").split(/^::vertiefung\s*$/m); return [a, b.join("\n")]; };
export function lessonTime(l) {
  let core = textCost(l.intro_md), deep = 0;
  for (const s of l.sections) { const [a, b] = splitDeep(s.body_md); if (s.deep) deep += textCost(a) + textCost(b); else { core += textCost(a); deep += textCost(b); } }
  for (const e of l.examples) { const t = PER_VISUAL + `${e.caption_md} ${(e.look_for || []).join(" ")}`.split(/\s+/).length / WPM; e.deep ? (deep += t) : (core += t); }
  core += l.takeaways.join(" ").split(/\s+/).length / WPM;
  deep += l.exercises.join(" ").split(/\s+/).length / WPM; // exercises are for the road, collapsed
  for (const q of l.quiz) q.deep ? (deep += PER_QUESTION) : (core += PER_QUESTION);
  return { core: Math.round(core), deep: Math.round(deep) };
}
