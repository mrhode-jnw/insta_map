// "Häppchen": short, varied cards for the phone – games, stories, looking, short knowledge and some quiz.
// Built only from sourced library content (no AI call, so every card appears instantly). A round is a list of
// card specs {type, key}; everything else is derived deterministically from the key, so re-renders are stable.
import { DIM, lib, photographerOf } from "./domain.js";

function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (const c of seed) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const pickN = (arr, n, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
export const stripRefs = t => String(t || "").replace(/\s*\[(?:S|Q)\d+[^\]]*\]/g, "").trim();
const firstSentences = (t, n = 2) => (String(t || "").replace(/^#+.*$/gm, "").replace(/^::\w+.*$/gm, "").replace(/\n+/g, " ").match(/[^.!?]+[.!?]+(\s*\[[^\]]+\])?/g) || []).slice(0, n).join(" ").trim();
const words = t => new Set(stripRefs(t).toLowerCase().match(/[a-zäöüß]{4,}/g) || []);
const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
const img = id => lib.by.images.get(id);
const who = id => photographerOf(img(id) || {}).name;
const label = i => `**${photographerOf(i).name}** – ${i.title || "Ohne Titel"}${i.year ? `, ${i.year}` : ""}`;

// ---- segments: what they are called, how they play, and whether they count as a scored answer
export const SEGMENTS = {
  order: { name: "Zeitreise", scored: true }, crop: { name: "Ausschnitt", scored: true }, tf: { name: "Stimmt's?", scored: true },
  look: { name: "Eine Minute schauen" }, pair: { name: "Gegenüber" }, story: { name: "So entstand es" }, quote: { name: "O-Ton" },
  memory: { name: "Aus dem Gedächtnis", scored: true }, tiles: { name: "Aufdecken", scored: true }, mirror: { name: "Original oder gespiegelt?", scored: true },
  guess: { name: "Jahr schätzen", scored: true }, stamp: { name: "Briefmarken-Test" },
  blitz: { name: "Blitzsortierer", scored: true }, hand: { name: "Gleiche Handschrift?", scored: true }, odd: { name: "Fremdkörper", scored: true },
  zoomout: { name: "Zoom heraus", scored: true }, tone: { name: "Heller oder dunkler?", scored: true }, zone: { name: "Zonen-Schätzer", scored: true },
  edge: { name: "Wo war die Kante?", scored: true }, change: { name: "Was ist anders?", scored: true }, fmt: { name: "Welches Format?", scored: true },
  mistake: { name: "Finde den Fehler", scored: true }, allok: { name: "Alles, was stimmt", scored: true }, qimg: { name: "Welches Bild meint er?", scored: true },
  srcimg: { name: "Welches Bild beschreibt die Quelle?", scored: true }, aspect: { name: "Welcher Aspekt?", scored: true }, voices: { name: "Wer liest so?", scored: true },
  match: { name: "Begriffe zuordnen", scored: true }, cquote: { name: "Begriff zum Zitat", scored: true, quiz: true }, skline: { name: "Skizze zum Satz", scored: true, quiz: true },
  place: { name: "Selber Ort, zwei Blicke" }, task: { name: "Aufgabe für unterwegs" },
  womit: { name: "Womit entstand es?", scored: true }, tlook: { name: "Technik und Wirkung" }, contact: { name: "Die Wahl des Fotografen", scored: true },
  sheet: { name: "Kontaktbogen" }, myth: { name: "Belegt oder Mythos?", scored: true }, anec: { name: "Was geschah hier?" }, version: { name: "Welche Fassung?", scored: true }, bookseq: { name: "Buchfolge", scored: true },
  sketch: { name: "Mini-Lektion" }, merke: { name: "Merksatz" }, pinfo: { name: "Porträt" }, concept: { name: "Seh-Begriff" },
  who: { name: "Wer war's?", scored: true, quiz: true }, year: { name: "Jahrzehnt", scored: true, quiz: true },
  chap: { name: "Geschichte", scored: true, quiz: true }, ref: { name: "Laut Quelle", scored: true, quiz: true }, quiz: { name: "Theoriefrage", scored: true, quiz: true },
};
export const TOPICS = [ // weights per segment; pure information cards kept to roughly 15 % (Didaktik-Recherche)
  ["mix", "Bunt gemischt", { myth: 2, anec: 1, womit: 2, tlook: 1, contact: 2, sheet: 1, version: 2, bookseq: 1, order: 2, crop: 1, tf: 1, look: 1, pair: 1, story: 1, quote: 1, sketch: 1, merke: 1, pinfo: 1, concept: 1, memory: 2, tiles: 1, mirror: 1, guess: 1, stamp: 1,
    blitz: 2, hand: 1, odd: 2, zoomout: 2, tone: 2, zone: 1, edge: 2, change: 2, fmt: 1, mistake: 2, allok: 2, qimg: 1, srcimg: 1, aspect: 1, voices: 1, match: 1, cquote: 1, skline: 1, place: 1, task: 1,
    who: 1, year: 1, chap: 1, ref: 1, quiz: 1 }],
  ["schauen", "Schauen", { tlook: 2, version: 2, sheet: 1, look: 2, memory: 2, crop: 1, pair: 1, stamp: 1, mirror: 1, tone: 3, zone: 2, edge: 3, change: 3, fmt: 1, allok: 3, mistake: 2, zoomout: 1, place: 1, story: 1 }],
  ["menschen", "Fotografen & O-Töne", { myth: 2, anec: 2, contact: 3, sheet: 2, quote: 2, tiles: 2, blitz: 3, hand: 3, odd: 2, zoomout: 2, qimg: 2, voices: 2, who: 1, pinfo: 1, story: 1, crop: 1 }],
  ["geschichte", "Geschichte", { myth: 2, anec: 2, version: 2, bookseq: 2, womit: 2, order: 3, guess: 3, chap: 2, year: 1, story: 2, quote: 1, pinfo: 1, blitz: 1, odd: 1, qimg: 1 }],
  ["theorie", "Theorie kompakt", { tlook: 2, womit: 2, sketch: 2, merke: 2, concept: 1, quiz: 2, pair: 1, aspect: 3, srcimg: 2, match: 3, cquote: 2, skline: 2, task: 1, mistake: 1 }],
  ["quiz", "Nur Quiz", { myth: 2, womit: 2, contact: 1, who: 2, year: 1, chap: 1, ref: 2, quiz: 2, tf: 2, order: 1, crop: 1, guess: 1, tiles: 1, mistake: 2, aspect: 2, cquote: 1, skline: 1, hand: 1, odd: 1 }],
];

const VOICE = { fotograf: "Fotograf:in", museum: "Museum", kurator: "Kurator:in", kritik: "Kritik", wissenschaft: "Wissenschaft" };
const checkables = id => (pools().byImg[id] || []).flatMap(r => r.entries.flatMap(e => e.checkable.map(t => ({ t: stripRefs(t), dim: r.dimension, ref: r, e }))));
const DIM_NEAR = { viewpoint: ["distance", "scale"], distance: ["viewpoint", "scale", "detail"], omitted: ["frame", "detail"], frame: ["omitted"], layers: ["focus", "atmosphere"], atmosphere: ["light", "layers"], light: ["atmosphere", "color"], color: ["light", "surface"], surface: ["order", "color"], order: ["surface", "frame"], scale: ["distance", "viewpoint"], detail: ["distance", "omitted"], time: ["moment"], moment: ["time"], focus: ["layers"], attitude: [] };
const SIDE = /\b(links|rechts|linke[nmrs]?|rechte[nmrs]?)\b/i, STAMP_DIMS = ["order", "layers", "frame", "light", "color", "surface"];

// ---- material pools (built once)
let P = null;
function pools() {
  if (P) return P;
  const directives = []; // ::vergleich / ::skizze / ::merke lines with lesson + section context
  for (const l of lib.lessons) for (const [heading, text] of [["Beschreibung", l.intro_md], ...l.sections.map(s => [s.heading, s.body_md])]) {
    const lines = String(text || "").split("\n"), kurz = (lines.find(x => x.startsWith("::kurz ")) || "").slice(7);
    const firstImg = (lines.map(x => x.match(/^::(?:bild|vergleich)\s+(i\w+)/)).find(Boolean) || [])[1];
    for (const ln of lines) { const m = ln.match(/^::(vergleich|skizze|merke)\s+(.*)$/); if (m) directives.push({ kind: m[1], rest: m[2], lesson: l, heading, kurz, firstImg }); }
  }
  const refs = (lib.references || []).filter(r => img(r.image_id));
  const storyDims = ["viewpoint", "moment", "omitted", "light", "time", "distance"];
  const byImg = {}; for (const r of refs) (byImg[r.image_id] ||= []).push(r);
  const quoteImg = s => s.scope === "image" ? s.scope_id : s.scope === "reference" ? s.scope_id.split(":")[0]
    : s.scope === "project" ? lib.images.find(i => i.project_id === s.scope_id)?.id : s.scope === "photographer" ? lib.images.find(i => i.photographer_id === s.scope_id)?.id : null;
  P = {
    pairs: directives.filter(d => d.kind === "vergleich").map(d => ({ ...d, ids: d.rest.split("|")[0].trim().split(/\s+/), caps: d.rest.split("|").slice(1).map(x => x.trim()) })).filter(d => d.ids.length === 2 && d.ids.every(img)),
    sketches: directives.filter(d => d.kind === "skizze").map(d => ({ ...d, name: d.rest.split("|")[0].trim(), cap: (d.rest.split("|")[1] || "").trim() })).filter(d => lib.sketches?.[d.name]),
    merke: directives.filter(d => d.kind === "merke").map(d => ({ ...d, text: d.rest })),
    refs, byImg,
    stories: Object.entries(byImg).filter(([, rs]) => rs.filter(r => storyDims.includes(r.dimension)).length >= 2).map(([id]) => id),
    quotes: lib.sources.filter(s => (s.kind === "fotograf" || s.role === "photographer") && s.excerpt && s.excerpt.length > 70 && s.excerpt.length < 330 && quoteImg(s) && img(quoteImg(s)))
      .map(s => ({ id: s.id, image: quoteImg(s) })),
    dated: lib.images.filter(i => +i.year >= 1840),
    byPh: lib.images.reduce((m, i) => ((m[i.photographer_id] ||= []).push(i.id), m), {}),
    byProj: lib.images.reduce((m, i) => ((m[i.project_id] ||= []).push(i.id), m), {}),
    imgQuotes: lib.sources.filter(s => s.scope === "image" && (s.kind === "fotograf") && s.excerpt && s.excerpt.length > 60 && s.excerpt.length < 360 && img(s.scope_id)),
    voices: Object.entries(lib.sources.filter(s => s.scope === "image" && VOICE[s.kind] && s.excerpt && s.excerpt.length > 50 && s.excerpt.length < 300 && img(s.scope_id))
      .reduce((m, s) => ((m[s.scope_id] ||= {})[VOICE[s.kind]] ||= s, m), {})).filter(([, v]) => Object.keys(v).length >= 2),
    places: Object.values(lib.images.filter(i => i.location).reduce((m, i) => ((m[i.location] ||= []).push(i), m), {}))
      .flatMap(list => list.flatMap((a, k) => list.slice(k + 1).filter(b => b.photographer_id !== a.photographer_id && byImg[a.id] && byImg[b.id]).map(b => `${a.id}|${b.id}`))),
    tasks: [...lib.lessons.flatMap(l => (l.exercises || []).map((t, n) => ({ id: `${l.id}|${n}`, text: t, link: [`#/theorie/${l.id}`, `Lektion: ${l.title.split(":")[0]}`] }))),
      ...lib.concepts.filter(c => c.exercise_md).map(c => ({ id: `c|${c.id}`, text: c.exercise_md, link: [`#/begriffe/${c.id}`, `Begriff: ${c.name}`] }))],
    kurz: directives.filter(d => d.kurz).map(d => d.kurz).filter((t, i, a) => a.indexOf(t) === i),
  };
  return P;
}

function candidates(type) {
  const p = pools();
  switch (type) {
    case "blitz": case "hand": return Object.keys(p.byPh).filter(k => p.byPh[k].length >= 4);
    case "odd": return Object.keys(p.byProj).filter(k => p.byProj[k].length >= 3);
    case "zoomout": case "tone": case "zone": case "change": case "fmt": return lib.images.filter(i => who(i.id) !== "?").map(i => i.id);
    case "edge": return Object.keys(p.byImg).filter(id => p.byImg[id].some(r => ["frame", "omitted", "order", "layers"].includes(r.dimension)));
    case "mistake": return Object.keys(p.byImg).filter(id => checkables(id).length >= 3);
    case "allok": return Object.keys(p.byImg).filter(id => checkables(id).length >= 3);
    case "qimg": return p.imgQuotes.filter(s => p.byPh[img(s.scope_id).photographer_id].length >= 3).map(s => String(s.id));
    case "srcimg": case "aspect": return p.refs.filter(r => r.entries[0].answer_md).map(r => `${r.image_id}|${r.dimension}`);
    case "voices": return p.voices.map(([id]) => id);
    case "match": return lib.concepts.length >= 4 ? lib.concepts.map(c => c.id) : [];
    case "cquote": return lib.sources.filter(s => s.scope === "concept" && lib.by.concepts.get(s.scope_id) && s.excerpt.length < 420).map(s => String(s.id));
    case "skline": return p.sketches.map((d, i) => d.kurz ? String(i) : null).filter(Boolean);
    case "place": return p.places;
    case "myth": return lib.myths.map((_, n) => `${n}`);
    case "anec": return lib.anecdotes.map((a, n) => img(a.image_id) ? `${a.image_id}|${n}` : null).filter(Boolean);
    case "womit": return lib.womit.map((q, n) => img(q.image_id) && (q.cls !== "silver" || n % 5 === 0) ? `${q.image_id}|${n}` : null).filter(Boolean); // silver prints: rarely, too easy
    case "tlook": return lib.facts.map((f, n) => f.image_id && img(f.image_id) && f.visible_md ? `${f.image_id}|${n}` : null).filter(Boolean);
    case "contact": return lib.editing.series.map((e, n) => e.frames?.length >= 2 && e.chosen != null ? `e${n}` : null).filter(Boolean);
    case "sheet": return lib.editing.series.map((e, n) => e.sheet && e.published ? `e${n}` : null).filter(Boolean);
    case "version": return lib.editing.versions.map((_, n) => `v${n}`);
    case "bookseq": return lib.editing.sequences.map((q, n) => q.images.length >= 4 ? `q${n}` : null).filter(Boolean);
    case "task": return p.tasks.map(t => t.id);
    case "who": case "crop": case "tiles": return lib.images.filter(i => who(i.id) !== "?").map(i => i.id);
    case "year": case "guess": return p.dated.map(i => i.id);
    case "order": return p.dated.map(i => i.id); // anchor image; the other three are picked from other decades
    case "chap": return lib.chapters.flatMap(c => c.images.filter(img).map(id => `${id}|${c.id}`));
    case "mirror": return p.refs.filter(r => r.entries.some(e => e.checkable.some(t => SIDE.test(t)))).map(r => `${r.image_id}|${r.dimension}`);
    case "stamp": return Object.keys(p.byImg).filter(id => p.byImg[id].some(x => STAMP_DIMS.includes(x.dimension)));
    case "ref": case "tf": case "memory": return p.refs.filter(r => r.entries.some(e => e.checkable.length)).map(r => `${r.image_id}|${r.dimension}`);
    case "look": return Object.keys(p.byImg);
    case "story": return p.stories;
    case "quote": return p.quotes.map(q => String(q.id));
    case "pair": return p.pairs.map((_, i) => String(i));
    case "sketch": return p.sketches.map((_, i) => String(i));
    case "merke": return p.merke.map((_, i) => String(i));
    case "quiz": return lib.lessons.flatMap(l => l.quiz.map((q, n) => `${l.id}|${n}`));
    case "pinfo": return lib.photographers.filter(x => x.bio_md).map(x => x.id);
    case "concept": return lib.concepts.map(c => c.id);
    default: return [];
  }
}

// A round: weighted types, never the same segment twice in a row, at most 40 % classic quiz.
export function makeRound(topic, size, wrong = []) {
  const weights = (TOPICS.find(t => t[0] === topic) || TOPICS[0])[2], r = Math.random;
  const pool = Object.fromEntries(Object.keys(weights).map(t => [t, candidates(t)]));
  const types = Object.entries(weights).filter(([t]) => pool[t].length).flatMap(([t, w]) => Array(w).fill(t));
  const cards = [], used = new Set(), usedImg = new Set(), maxQuiz = topic === "quiz" ? size : Math.floor(size * 0.4);
  const ok = (t, key) => { const im = key.split("|")[0];
    return !used.has(`${t}:${key}`) && !(img(im) && usedImg.has(im)) && cards[cards.length - 1]?.type !== t
      && !(SEGMENTS[t].quiz && cards.filter(c => SEGMENTS[c.type].quiz).length >= maxQuiz); };
  const add = (t, key) => { used.add(`${t}:${key}`); const im = key.split("|")[0]; if (img(im)) usedImg.add(im); cards.push({ type: t, key }); };
  for (const id of wrong) { if (cards.length >= Math.ceil(size / 3)) break; const [t, ...k] = id.split(":"); if (weights[t] && candidates(t).includes(k.join(":")) && ok(t, k.join(":"))) add(t, k.join(":")); }
  for (let guard = 0; cards.length < size && guard < size * 80 && types.length; guard++) {
    const t = types[Math.floor(r() * types.length)], key = pool[t][Math.floor(r() * pool[t].length)];
    if (ok(t, key)) add(t, key);
  }
  return cards;
}
export const cardId = c => `${c.type}:${c.key}`;

// ---- build what a card shows. Kinds: mc, tf, order, reveal, story, look, info (see app.js views.kurzKarte)
export function buildCard(c) {
  const r = rng(cardId(c)), p = pools(), seg = SEGMENTS[c.type];
  const base = { type: c.type, label: seg?.name || "", scored: !!seg?.scored };
  const shuffleOpts = opts => pickN(opts, opts.length, r);
  switch (c.type) {
    case "who": case "tiles": {
      const i = img(c.key), name = who(c.key);
      const near = new Set(lib.chapters.filter(ch => ch.images.includes(i.id)).flatMap(ch => ch.images.map(who)));
      const others = [...new Set([...near, ...pickN(lib.photographers.map(x => x.name), 14, r)])].filter(n => n && n !== "?" && n !== name);
      const wrong = pickN(others.filter(n => near.has(n)), 3, r); for (const n of pickN(others, 10, r)) if (wrong.length < 3 && !wrong.includes(n)) wrong.push(n);
      const ph = photographerOf(i);
      return { ...base, kind: "mc", prompt: c.type === "tiles" ? "Das Bild deckt sich auf – erkennst du es vorher? Von wem ist es?" : "Von wem ist dieses Bild?", image: i.id, tiles: c.type === "tiles", tileOrder: pickN([...Array(16).keys()], 16, r), options: shuffleOpts([{ text: name, correct: true }, ...wrong.map(n => ({ text: n }))]),
        explain_md: `${label(i)}.${ph.bio_md ? "\n\n" + firstSentences(ph.bio_md, 1) : ""}`, link: [`#/fotograf/${ph.id}`, "Zum Fotografen"] };
    }
    case "year": {
      const i = img(c.key), dec = Math.floor(i.year / 10) * 10;
      const opts = [dec, ...pickN([-30, -20, -10, 10, 20, 30].map(d => dec + d).filter(y => y >= 1840 && y <= 2020), 3, r)].sort((a, b) => a - b);
      return { ...base, kind: "mc", prompt: "Aus welchem Jahrzehnt?", image: i.id, options: opts.map(y => ({ text: `${y}er`, correct: y === dec })),
        explain_md: `${label(i)}.`, link: [`#/bild/${i.id}`, "Zur Bildseite"] };
    }
    case "chap": {
      const [id, chId] = c.key.split("|"), ch = lib.by.chapters.get(chId), inCh = new Set(lib.chapters.filter(x => x.images.includes(id)).map(x => x.id));
      return { ...base, kind: "mc", prompt: "In welches Kapitel der Geschichte gehört es?", image: id,
        options: shuffleOpts([{ text: ch.title, correct: true }, ...pickN(lib.chapters.filter(x => !inCh.has(x.id)), 3, r).map(x => ({ text: x.title }))]),
        explain_md: `**Kapitel ${ch.number}: ${ch.title}** (${ch.period_from}–${ch.period_to}).\n\n${firstSentences((ch.text_md || "").split("## ")[1]?.replace(/^[^\n]*\n/, "") || "", 2)}`,
        link: [`#/kapitel/${ch.id}`, "Zum Kapitel"] };
    }
    case "ref": case "tf": case "memory": {
      const [id, dim] = c.key.split("|"), ref = lib.by.refs.get(`${id}:${dim}`), entry = ref.entries.find(e => e.checkable.length);
      const right = entry.checkable[Math.floor(r() * entry.checkable.length)], name = who(id);
      const others = p.refs.filter(x => x.dimension === dim && x.image_id !== id && who(x.image_id) !== name)
        .flatMap(x => x.entries.flatMap(e => e.checkable)).filter(t => overlap(t, right) < 0.34);
      const src = lib.by.sources.get(entry.source_ids[0]);
      const explain = `${entry.answer_md}${src ? `\n\n„${src.excerpt.length > 260 ? src.excerpt.slice(0, 257) + "…" : src.excerpt}“ – ${src.author || src.title}` : ""}`;
      const dl = DIM[dim]?.label || dim;
      if (c.type !== "ref") {
        const truth = r() < 0.5 || !others.length, statement = truth ? right : pickN(others, 1, r)[0];
        return { ...base, kind: "tf", memorize: c.type === "memory" ? 8 : 0, prompt: c.type === "memory" ? `${dl}: War das so im Bild?` : `${dl}: Stimmt das für dieses Bild?`, statement: stripRefs(statement), image: id, truth,
          explain_md: (truth ? "" : `Das stammt aus einer Quelle zu einem anderen Bild. Für dieses Bild gilt:\n\n`) + explain, link: [`#/bild/${id}`, "Zur Bildseite"] };
      }
      return { ...base, kind: "mc", label: `Laut Quelle · ${dl}`, prompt: `${dl}: Was stimmt laut Quelle?`, image: id,
        options: shuffleOpts([{ text: stripRefs(right), correct: true }, ...[...new Set(pickN(others, 8, r).map(stripRefs))].slice(0, 3).map(t => ({ text: t }))]),
        explain_md: explain, link: [`#/bild/${id}`, "Zur Bildseite"] };
    }
    case "guess": { // slider, right within ±5 years (tolerance as in Greengo's focal-length quiz)
      const i = img(c.key);
      return { ...base, kind: "slider", prompt: "In welchem Jahr entstand das Bild?", image: i.id, year: +i.year, min: 1840, max: 2025, tolerance: 5,
        explain_md: `${label(i)}.`, link: [`#/bild/${i.id}`, "Zur Bildseite"] };
    }
    case "mirror": { // one of two is flipped; the source names what is left or right
      const [id, dim] = c.key.split("|"), ref = lib.by.refs.get(`${id}:${dim}`), e = ref.entries.find(x => x.checkable.some(t => SIDE.test(t)));
      const hint = e.checkable.filter(t => SIDE.test(t));
      return { ...base, kind: "mc", prompt: "Eins der beiden ist gespiegelt. Welches ist das Original?",
        options: shuffleOpts([{ image: id, text: "Original", correct: true }, { image: id, text: "Gespiegelt", flip: true }]),
        explain_md: `${label(img(id))}.\n\n**Laut Quelle (${DIM[dim]?.label || dim}):**\n${hint.map(t => "- " + t).join("\n")}\n\n${e.answer_md}`, link: [`#/bild/${id}`, "Zur Bildseite"] };
    }
    case "stamp": { // the thumbnail test: does the structure still carry at stamp size?
      const ref = pickN(p.byImg[c.key].filter(x => STAMP_DIMS.includes(x.dimension)), 1, r)[0], e = ref.entries[0];
      return { ...base, kind: "reveal", stamp: c.key, prompt: "Briefmarken-Test: Was trägt das Bild noch, wenn es so klein ist? Formen, Helligkeiten, Linien?",
        back_image: c.key, back_md: `**${DIM[ref.dimension]?.label || ref.dimension} – was die Quellen sagen:** ${e.answer_md}${e.checkable.length ? "\n\n" + e.checkable.map(x => "- " + x).join("\n") : ""}`,
        caption_md: label(img(c.key)), link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "blitz": { // swipe sorting between two hands (Kellman; Kornell & Bjork 2008: interleaving styles)
      const A = c.key, peers = new Set(lib.chapters.filter(ch => ch.images.some(id => img(id)?.photographer_id === A)).flatMap(ch => ch.images.map(id => img(id)?.photographer_id)));
      const others = Object.keys(p.byPh).filter(k => k !== A && p.byPh[k].length >= 4), near = others.filter(k => peers.has(k));
      const B = pickN(near.length ? near : others, 1, r)[0], nA = lib.by.photographers.get(A).name, nB = lib.by.photographers.get(B).name;
      const items = pickN([...pickN(p.byPh[A], 4, r).map(id => ({ id, side: 0 })), ...pickN(p.byPh[B], 4, r).map(id => ({ id, side: 1 }))], 8, r);
      return { ...base, kind: "swipe2", prompt: "Von wem? Links oder rechts tippen bzw. wischen – so schnell wie möglich.", bins: [nA, nB], items,
        explain_md: [A, B].map(id => { const x = lib.by.photographers.get(id); return `**${x.name}**${x.signature_md ? `: ${stripRefs(firstSentences(x.signature_md, 1))} (Einschätzung)` : ""}`; }).join("\n\n"),
        link: [`#/fotograf/${A}`, `Zu ${nA}`] };
    }
    case "hand": { // same photographer or not?
      const A = c.key, same = r() < 0.5, [a, a2] = pickN(p.byPh[A], 2, r);
      const peers = new Set(lib.chapters.filter(ch => ch.images.includes(a)).flatMap(ch => ch.images.map(id => img(id)?.photographer_id)));
      const others = Object.keys(p.byPh).filter(k => k !== A), near = others.filter(k => peers.has(k));
      const b = same ? a2 : pickN(p.byPh[pickN(near.length ? near : others, 1, r)[0]], 1, r)[0];
      return { ...base, kind: "tf", images: [a, b], prompt: "Gleiche Handschrift?", statement: "Beide Bilder stammen von derselben Person.", truth: same,
        tfLabels: ["Ja, gleiche Hand", "Nein"], explain_md: [a, b].map(id => label(img(id))).join("\n\n"), link: [`#/fotograf/${A}`, "Zum Fotografen"] };
    }
    case "odd": { // three from one project, one stranger with a similar subject
      const ids = pickN(p.byProj[c.key], 3, r), proj = lib.by.projects?.get?.(c.key) || lib.projects.find(x => x.id === c.key), ph = img(ids[0]).photographer_id;
      const tags = new Set(ids.flatMap(id => img(id).tags || []));
      const pool = lib.images.filter(i => i.photographer_id !== ph), close = pool.filter(i => (i.tags || []).filter(t => tags.has(t)).length >= 2);
      const odd = pickN(close.length ? close : pool, 1, r)[0];
      const src = lib.sources.find(x => x.scope === "project" && x.scope_id === c.key);
      return { ...base, kind: "mc", prompt: "Drei gehören zu einem Projekt. Welches Bild ist der Fremdkörper?",
        options: shuffleOpts([...ids.map(id => ({ image: id, text: who(id) })), { image: odd.id, text: who(odd.id), correct: true }]),
        explain_md: `Fremd: ${label(odd)}.\n\nDie drei anderen: **${who(ids[0])}** – ${proj?.title || ""}.${src ? `\n\n„${src.excerpt.length > 240 ? src.excerpt.slice(0, 237) + "…" : src.excerpt}“` : ""}`,
        link: [`#/fotograf/${ph}`, "Zum Fotografen"] };
    }
    case "zoomout": { // start from a detail, widen step by step
      const i = img(c.key), base2 = buildCard({ type: "who", key: c.key });
      return { ...base2, ...base, kind: "mc", image: null, prompt: "Erkennst du es am Detail? Je früher, desto besser.", zoom: { id: i.id, x: 15 + Math.round(r() * 70), y: 20 + Math.round(r() * 60), steps: [6, 3, 1.6, 1] } };
    }
    case "tone": case "zone": { // tonal values, measured on the image at runtime (Zone System thinking)
      const pts = Array.from({ length: 24 }, () => [8 + Math.round(r() * 84), 8 + Math.round(r() * 84)]);
      return { ...base, kind: "tone", mode: c.type === "tone" ? "pair" : "zone", image: c.key, pts,
        prompt: c.type === "tone" ? "Welche markierte Stelle ist heller?" : "Welche Zone hat die markierte Stelle? (0 = tiefes Schwarz, 10 = reines Weiß)",
        explain_md: `${label(img(c.key))}.`, link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "edge": { // original vs. a crop the app makes
      const ref = pickN(p.byImg[c.key].filter(x => ["frame", "omitted", "order", "layers"].includes(x.dimension)), 1, r)[0];
      return { ...base, kind: "mc", prompt: "Eine Fassung ist von der App beschnitten. Welche Kante hat der Fotograf gewählt?",
        options: shuffleOpts([{ image: c.key, text: "Original", correct: true }, { image: c.key, text: "Beschnitten", zoomCrop: { x: Math.round(r() * 100), y: Math.round(r() * 100), s: 1.3 + Math.round(r() * 3) / 10 } }]),
        explain_md: `${label(img(c.key))}.\n\n**${DIM[ref.dimension]?.label || ref.dimension} – was die Quellen sagen:** ${ref.entries[0].answer_md}`, link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "change": { // what did the app change?
      const color = (img(c.key).tags || []).includes("farbe");
      const all = [["Gekippt", "transform:rotate(4deg) scale(1.12)"], ["Enger beschnitten", "transform:scale(1.35)"], ["Heller", "filter:brightness(1.35)"],
        ["Gespiegelt", "transform:scaleX(-1)"], ["Kontrastreicher", "filter:contrast(1.5)"], ...(color ? [["Entsättigt", "filter:saturate(0.15)"]] : [["Dunkler", "filter:brightness(0.7)"]])];
      const opts = pickN(all, 4, r), k = Math.floor(r() * 4);
      return { ...base, kind: "mc", preview: 4, image: c.key, variant: opts[k][1], prompt: "Was hat die App verändert?",
        options: opts.map(([t], n) => ({ text: t, correct: n === k })), explain_md: `${label(img(c.key))}.`, link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "fmt": return { ...base, kind: "fmt", image: c.key, prompt: "Hier mittig quadratisch beschnitten. Welches Format hat das Original?",
      options: [["Quadrat", 1], ["4:5 / 3:4", 1.29], ["2:3", 1.5], ["Breit (16:9)", 1.78], ["Panorama", 2.4]].map(([t, v]) => ({ text: t, v })),
      explain_md: `${label(img(c.key))}.`, link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    case "mistake": { // one statement belongs to another picture
      const mine = [...new Map(pickN(checkables(c.key), 12, r).map(x => [x.t, x])).values()].slice(0, 3);
      const foreign = pickN(p.refs.filter(x => x.image_id !== c.key && who(x.image_id) !== who(c.key) && mine.some(m => m.dim === x.dimension))
        .flatMap(x => x.entries.flatMap(e => e.checkable.map(t => ({ t: stripRefs(t), id: x.image_id })))).filter(x => mine.every(m => overlap(m.t, x.t) < 0.34)), 1, r)[0];
      if (!foreign || mine.length < 3) return null;
      return { ...base, kind: "mc", image: c.key, prompt: "Drei Beobachtungen stammen aus Quellen zu diesem Bild. Welche gehört nicht dazu?",
        options: shuffleOpts([...mine.map(m => ({ text: m.t })), { text: foreign.t, correct: true }]),
        explain_md: `Die fremde Beobachtung stammt aus einer Quelle zu ${label(img(foreign.id))}.\n\n${mine.map(m => `- ${m.t} (${DIM[m.dim]?.label || m.dim})`).join("\n")}`, link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "allok": { // tick every observation that fits (Project Zero: Looking Ten Times Two)
      const mine = [...new Map(pickN(checkables(c.key), 12, r).map(x => [x.t, x])).values()].slice(0, 3);
      const foreign = [...new Set(pickN(p.refs.filter(x => x.image_id !== c.key && who(x.image_id) !== who(c.key)), 30, r)
        .flatMap(x => x.entries.flatMap(e => e.checkable.map(stripRefs))).filter(t => mine.every(m => overlap(m.t, t) < 0.34)))].slice(0, 3);
      if (foreign.length < 2) return null;
      return { ...base, kind: "multi", image: c.key, prompt: "Schau genau hin. Tippe alles an, was für dieses Bild stimmt – es können mehrere sein.",
        options: shuffleOpts([...mine.map(m => ({ text: m.t, correct: true })), ...foreign.map(t => ({ text: t }))]),
        explain_md: `${label(img(c.key))}.`, link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "qimg": { // a photographer's sentence – which of his pictures?
      const q = lib.by.sources.get(+c.key), id = q.scope_id, others = pickN(p.byPh[img(id).photographer_id].filter(x => x !== id), 2, r);
      return { ...base, kind: "mc", quote: q.excerpt, quote_de: q.translation_de, prompt: `${who(id)} über eins seiner Bilder. Welches?`,
        options: shuffleOpts([{ image: id, text: img(id).title, correct: true }, ...others.map(x => ({ image: x, text: img(x).title }))]),
        explain_md: `${label(img(id))}.\n\n– ${q.author || who(id)}${q.title ? `, ${q.title}` : ""} [S${q.id}]`, link: [`#/bild/${id}`, "Zur Bildseite"] };
    }
    case "srcimg": { // reverse of "Laut Quelle": description → picture
      const [id, dim] = c.key.split("|"), ref = lib.by.refs.get(`${id}:${dim}`), ph = lib.by.photographers.get(img(id).photographer_id);
      const mask = t => [ph.name, ...ph.name.split(" ").filter(w => w.length > 3), img(id).title].filter(Boolean).reduce((x, w) => x.split(w).join("…"), stripRefs(t));
      const others = pickN(p.refs.filter(x => x.dimension === dim && x.image_id !== id).map(x => x.image_id), 2, r);
      return { ...base, kind: "mc", label: `${seg.name} · ${DIM[dim]?.label || dim}`, quote: mask(firstSentences(ref.entries[0].answer_md, 2) || ref.entries[0].answer_md),
        prompt: `${DIM[dim]?.label || dim}: Zu welchem Bild passt diese Beschreibung?`,
        options: shuffleOpts([{ image: id, text: who(id), correct: true }, ...others.map(x => ({ image: x, text: who(x) }))]),
        explain_md: `${label(img(id))}.\n\n${ref.entries[0].answer_md}`, link: [`#/bild/${id}`, "Zur Bildseite"] };
    }
    case "aspect": { // which aspect does the source talk about?
      const [id, dim] = c.key.split("|"), ref = lib.by.refs.get(`${id}:${dim}`), src = lib.by.sources.get(ref.entries[0].source_ids[0]);
      const wrong = pickN(Object.keys(DIM).filter(k => k !== dim && DIM[k].label && !(DIM_NEAR[dim] || []).includes(k)), 3, r);
      return { ...base, kind: "mc", image: id, quote: src?.excerpt || stripRefs(ref.entries[0].answer_md), quote_de: src?.translation_de, prompt: "Worüber spricht diese Quelle?",
        options: shuffleOpts([{ text: DIM[dim].label, correct: true }, ...wrong.map(k => ({ text: DIM[k].label }))]),
        explain_md: `**${DIM[dim].label}.** ${ref.entries[0].answer_md}\n\n${label(img(id))}.`, link: [`#/bild/${id}`, "Zur Bildseite"] };
    }
    case "voices": { // who reads the picture like this? (crit with several voices)
      const v = p.voices.find(([id]) => id === c.key)[1], keys = pickN(Object.keys(v), 3, r);
      const labels = [...new Set([...keys, ...pickN(Object.values(VOICE).filter(x => !keys.includes(x)), 1, r)])];
      return { ...base, kind: "assign", image: c.key, prompt: "Wer spricht hier? Ordne jede Stimme zu.", labels: pickN(labels, labels.length, r),
        rows: keys.map(k => ({ text: v[k].excerpt, answer: k, note: `${v[k].author || v[k].title}` })),
        explain_md: `${label(img(c.key))}.`, link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "match": { // concepts ↔ short definitions
      const cs = [lib.by.concepts.get(c.key), ...pickN(lib.concepts.filter(x => x.id !== c.key && x.dimension !== lib.by.concepts.get(c.key).dimension), 3, r)];
      const def = x => stripRefs(firstSentences(x.summary_md, 1)).replace(new RegExp(x.name.split(" (")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "…");
      return { ...base, kind: "assign", prompt: "Welcher Begriff gehört zu welcher Beschreibung?", labels: pickN(cs.map(x => x.name), 4, r),
        rows: pickN(cs, 4, r).map(x => ({ text: def(x), answer: x.name })), explain_md: "", link: ["#/begriffe", "Zu den Seh-Begriffen"] };
    }
    case "cquote": {
      const q = lib.by.sources.get(+c.key), k = lib.by.concepts.get(q.scope_id);
      return { ...base, kind: "mc", quote: q.excerpt, quote_de: q.translation_de, prompt: "Zu welchem Seh-Begriff gehört dieser Auszug?",
        options: shuffleOpts([{ text: k.name, correct: true }, ...pickN(lib.concepts.filter(x => x.id !== k.id), 3, r).map(x => ({ text: x.name }))]),
        explain_md: `**${k.name}** – ${stripRefs(firstSentences(k.summary_md, 2))}\n\n– ${q.author || q.title} [S${q.id}]`, link: [`#/begriffe/${k.id}`, "Zum Begriff"] };
    }
    case "skline": {
      const d = p.sketches[+c.key];
      return { ...base, kind: "mc", sketch: d.name, prompt: "Welcher Satz gehört zu dieser Skizze?",
        options: shuffleOpts([{ text: d.kurz, correct: true }, ...pickN(p.kurz.filter(t => t !== d.kurz && overlap(t, d.kurz) < 0.3), 2, r).map(t => ({ text: t }))]),
        explain_md: `aus „${d.heading}“${d.cap ? ` – ${d.cap}` : ""}`, link: [`#/theorie/${d.lesson.id}`, `Lektion: ${d.lesson.title.split(":")[0]}`] };
    }
    case "place": { // same place, two photographers
      const [a, b] = c.key.split("|"), ra = pickN(p.byImg[a], 1, r)[0], rb = p.byImg[b].find(x => x.dimension === ra.dimension) || pickN(p.byImg[b], 1, r)[0];
      return { ...base, kind: "reveal", images: [a, b], prompt: `${img(a).location}: Was hat der zweite Fotograf anders entschieden – Standpunkt, Distanz, Licht, Moment?`,
        back_md: [[a, ra], [b, rb]].map(([id, x]) => `${label(img(id))}\n\n**${DIM[x.dimension]?.label || x.dimension}:** ${x.entries[0].answer_md}`).join("\n\n"),
        link: [`#/bild/${b}`, "Zur Bildseite"] };
    }
    case "task": {
      const t = p.tasks.find(x => x.id === c.key);
      return { ...base, kind: "info", title: "Aufgabe für unterwegs", big: stripRefs(firstSentences(t.text, 3) || t.text), body_md: "Heute ausprobieren – beim nächsten Häppchen kurz daran denken, was es gezeigt hat.", link: t.link };
    }
    case "womit": { // technique that explains the look (sourced)
      const [id, n] = c.key.split("|"), q = lib.womit[+n], f = lib.facts[q.fact];
      return { ...base, kind: "mc", image: id, prompt: "Womit entstand es?", options: shuffleOpts([{ text: q.answer, correct: true }, ...q.distractors.slice(0, 3).map(t => ({ text: t }))]),
        explain_md: `${label(img(id))}.\n\n${f.statement_md}${f.visible_md ? `\n\n**Was man daran sieht:** ${f.visible_md}` : ""}`, link: [`#/bild/${id}`, "Zur Bildseite"] };
    }
    case "tlook": {
      const [id, n] = c.key.split("|"), f = lib.facts[+n];
      return { ...base, kind: "reveal", image: id,
        prompt: `Entstanden mit: ${f.value}. Woran sieht man das im Bild?`, back_md: `${f.statement_md}\n\n**Was man daran sieht:** ${f.visible_md}`,
        caption_md: label(img(id)), link: [`#/bild/${id}`, "Zur Bildseite"] };
    }
    case "contact": { // frames of one situation – which one did the photographer choose?
      const e = lib.editing.series[+c.key.slice(1)], frames = e.frames.slice(0, 8);
      return { ...base, kind: "mc", situation_md: e.situation_md, prompt: `Welches Bild hat ${e.photographer} gewählt?`,
        options: shuffleOpts(frames.map((f, k) => ({ image: f.id, text: f.note.split(":")[0].slice(0, 60), correct: k === e.chosen }))),
        explain_md: `**${e.title}**${e.year ? `, ${e.year}` : ""}\n\n${e.answer_md}`, link: e.photographer_id ? [`#/fotograf/${e.photographer_id}`, "Zum Fotografen"] : ["#/kurz", "Häppchen"] };
    }
    case "sheet": { // a whole contact sheet: choose yourself, then see the photographer's choice
      const e = lib.editing.series[+c.key.slice(1)];
      return { ...base, kind: "reveal", sheet: e.sheet.id, situation_md: e.situation_md, prompt: `Kontaktbogen von ${e.photographer}: Welches Bild würdest du wählen? (Antippen zum Vergrößern)`,
        back_image: e.published, back_md: `**Gewählt:** ${e.sheet.frame_label ? `Bild ${e.sheet.frame_label}` : "dieses Bild"}${e.sheet.note ? ` – ${e.sheet.note}` : ""}\n\n${e.answer_md}`,
        caption_md: `**${e.photographer}** – ${e.title}${e.year ? `, ${e.year}` : ""}`, link: e.photographer_id ? [`#/fotograf/${e.photographer_id}`, "Zum Fotografen"] : ["#/kurz", "Häppchen"] };
    }
    case "version": { // two versions of one picture
      const v = lib.editing.versions[+c.key.slice(1)];
      if (v.published === "a" || v.published === "b") return { ...base, kind: "mc", prompt: `${v.title}: Welche Fassung ist die veröffentlichte?`,
        options: shuffleOpts(["a", "b"].map(k => ({ image: v[k].id, text: v[k].label, correct: k === v.published }))),
        explain_md: v.difference_md, link: v.photographer_id ? [`#/fotograf/${v.photographer_id}`, "Zum Fotografen"] : ["#/kurz", "Häppchen"] };
      return { ...base, scored: false, kind: "reveal", images: [v.a.id, v.b.id], prompt: `${v.title}: Was unterscheidet die beiden Fassungen?`,
        back_md: `**Links:** ${v.a.label}\n\n**Rechts:** ${v.b.label}\n\n${v.difference_md}`, link: v.photographer_id ? [`#/fotograf/${v.photographer_id}`, "Zum Fotografen"] : ["#/kurz", "Häppchen"] };
    }
    case "bookseq": { // put a few consecutive plates back into book order
      const q = lib.editing.sequences[+c.key.slice(1)], n = Math.min(5, q.images.length), start = Math.floor(r() * (q.images.length - n + 1));
      const run = q.images.slice(start, start + n).map((x, k) => ({ id: x.id, order: k, label: x.title.split("/")[0].slice(0, 70) })), shown = pickN(run, n, r);
      return { ...base, kind: "order", prompt: `${q.book}: Tippe die Bilder in die Reihenfolge der Folge.`, items: shown.map(x => ({ id: x.id, label: x.label })),
        solution: shown.map((_, k) => k).sort((a, b) => shown[a].order - shown[b].order), explain_md: q.answer_md,
        link: q.photographer_id ? [`#/fotograf/${q.photographer_id}`, "Zum Fotografen"] : ["#/kurz", "Häppchen"] };
    }
    case "myth": { // widely believed – or sourced? half the cards show the myth, half the correction
      const m = lib.myths[+c.key], truth = r() < 0.5, fact = stripRefs(firstSentences(m.fact_md, 1) || m.fact_md);
      return { ...base, kind: "tf", image: m.image_id && img(m.image_id) ? m.image_id : null, prompt: "Belegt oder Mythos?", statement: truth ? fact : m.claim, truth,
        tfLabels: ["Belegt", "Mythos"], explain_md: `**Verbreitet, aber falsch:** ${m.claim}\n\n**Laut Quelle:** ${m.fact_md}`,
        link: m.image_id ? [`#/bild/${m.image_id}`, "Zur Bildseite"] : m.photographer_id ? [`#/fotograf/${m.photographer_id}`, "Zum Fotografen"] : ["#/kurz", "Häppchen"] };
    }
    case "anec": {
      const [id, n] = c.key.split("|"), a = lib.anecdotes[+n];
      return { ...base, kind: "reveal", image: id, prompt: "Was geschah hier, bevor oder während das Bild entstand? Erst überlegen, dann aufdecken.",
        back_md: a.story_md, caption_md: label(img(id)), link: [`#/bild/${id}`, "Zur Bildseite"] };
    }
    case "quiz": {
      const [lid, n] = c.key.split("|"), l = lib.by.lessons.get(lid), q = l.quiz[+n];
      return { ...base, kind: "mc", label: `Theoriefrage · ${l.title.split(":")[0]}`, prompt: q.question, image: q.image_id && img(q.image_id) ? q.image_id : null,
        options: shuffleOpts(q.options.map((o, k) => ({ text: o, correct: k === q.correct }))), explain_md: q.explanation, link: [`#/theorie/${lid}`, "Zur Lektion"] };
    }
    case "order": { // four pictures from different decades, tap them oldest first
      const a = img(c.key), decs = new Set([Math.floor(a.year / 10)]), items = [a];
      for (const i of pickN(p.dated, 60, r)) { const d = Math.floor(i.year / 10); if (!decs.has(d) && items.length < 4) { decs.add(d); items.push(i); } }
      const shown = pickN(items, items.length, r);
      return { ...base, kind: "order", prompt: "Tippe die Bilder in der Reihenfolge ihrer Entstehung – das älteste zuerst.",
        items: shown.map(i => ({ id: i.id, year: +i.year, who: who(i.id), title: i.title })), solution: shown.map((_, k) => k).sort((x, y) => shown[x].year - shown[y].year), link: ["#/zeitleiste", "Zur Zeitleiste"] };
    }
    case "crop": { // a zoomed detail – which picture is it from?
      const i = img(c.key), same = lib.images.filter(x => x.id !== i.id && x.photographer_id === i.photographer_id);
      const rest = pickN(lib.images.filter(x => x.id !== i.id && x.photographer_id !== i.photographer_id), 4, r);
      const opts = [i, ...pickN(same, 1, r), ...rest].slice(0, 3);
      return { ...base, kind: "mc", prompt: "Aus welchem Bild stammt dieser Ausschnitt?", crop: { id: i.id, x: 20 + Math.round(r() * 60), y: 25 + Math.round(r() * 50), zoom: 3 },
        options: shuffleOpts(opts.map(x => ({ image: x.id, text: `${who(x.id)} – ${x.title || ""}`, correct: x.id === i.id }))), explain_md: `${label(i)}.`, link: [`#/bild/${i.id}`, "Zur Bildseite"] };
    }
    case "look": { // look first, then what the sources say you can see
      const rs = p.byImg[c.key], ref = pickN(rs, 1, r)[0], e = ref.entries.find(x => x.checkable.length) || ref.entries[0];
      return { ...base, kind: "look", image: c.key, seconds: 20, prompt: "Nur schauen. Wo bleibt dein Blick hängen?",
        fact_md: `**${DIM[ref.dimension]?.label || ref.dimension} – was die Quellen sagen:** ${e.answer_md}${e.checkable.length ? `\n\n**Daran siehst du es:**\n${e.checkable.map(x => "- " + x).join("\n")}` : ""}`,
        caption_md: label(img(c.key)), link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "pair": {
      const d = p.pairs[+c.key];
      return { ...base, kind: "reveal", images: d.ids, prompt: `${d.heading}: Was unterscheidet die beiden?`,
        back_md: d.ids.map((id, k) => `${label(img(id))}${d.caps[k] ? ` – ${d.caps[k]}` : ""}`).join("\n\n") + (d.kurz ? `\n\n**Der Punkt:** ${d.kurz}` : ""),
        link: [`#/theorie/${d.lesson.id}`, `Lektion: ${d.lesson.title.split(":")[0]}`] };
    }
    case "quote": {
      const q = p.quotes.find(x => String(x.id) === c.key), s = lib.by.sources.get(q.id), i = img(q.image);
      return { ...base, kind: "reveal", quote: s.excerpt, prompt: "Wer sagt das?",
        back_md: `**${s.author || photographerOf(i).name}**${s.title ? ` · ${s.title}` : ""} [S${s.id}]${s.translation_de ? `\n\n*Übersetzung:* ${s.translation_de}` : ""}`, back_image: q.image, caption_md: label(i),
        link: [`#/fotograf/${photographerOf(i).id}`, "Zum Fotografen"] };
    }
    case "story": { // how the picture was made, step by step from the sources
      const order = ["viewpoint", "moment", "omitted", "light", "time", "distance"], rs = p.byImg[c.key].filter(x => order.includes(x.dimension)).sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension));
      return { ...base, kind: "story", image: c.key, prompt: label(img(c.key)),
        slides: rs.map(x => ({ title: DIM[x.dimension]?.label || x.dimension, md: x.entries[0].answer_md })), link: [`#/bild/${c.key}`, "Zur Bildseite"] };
    }
    case "sketch": {
      const d = p.sketches[+c.key];
      return { ...base, kind: "info", title: d.heading, sketch: d.name, body_md: `${d.kurz ? `**${d.kurz}**\n\n` : ""}${d.cap}`, link: [`#/theorie/${d.lesson.id}`, `Lektion: ${d.lesson.title.split(":")[0]}`] };
    }
    case "merke": {
      const d = p.merke[+c.key];
      return { ...base, kind: "info", title: "Merke", big: d.text, image: d.firstImg && img(d.firstImg) ? d.firstImg : null,
        body_md: `aus „${d.heading}“`, link: [`#/theorie/${d.lesson.id}`, `Lektion: ${d.lesson.title.split(":")[0]}`] };
    }
    case "pinfo": {
      const x = lib.by.photographers.get(c.key), imgs = lib.images.filter(i => i.photographer_id === x.id);
      return { ...base, kind: "info", title: `${x.name}${x.born ? ` (${x.born}–${x.died || ""})` : ""}`, portrait: x.portrait ? x.id : null, thumbs: pickN(imgs, 3, r).map(i => i.id),
        body_md: firstSentences(x.bio_md, 3) + (x.signature_md ? `\n\n**Woran man die Bilder erkennt** (Einschätzung): ${stripRefs(firstSentences(x.signature_md, 1))}` : ""),
        link: [`#/fotograf/${x.id}`, "Mehr zum Fotografen"] };
    }
    case "concept": {
      const k = lib.by.concepts.get(c.key);
      return { ...base, kind: "info", title: k.name, image: k.images?.[0]?.id && img(k.images[0].id) ? k.images[0].id : null,
        body_md: firstSentences(k.summary_md, 3) + (k.exercise_md ? `\n\n**Für unterwegs:** ${firstSentences(k.exercise_md, 2)}` : ""), link: [`#/begriffe/${k.id}`, "Zum Begriff"] };
    }
    default: return null;
  }
}

// Was the answer right? (only for scored kinds; result values as stored by app.js)
export function isRight(card, res) {
  if (res == null) return null;
  if (card.kind === "mc") return !!card.options[res]?.correct;
  if (card.kind === "tf") return res === (card.truth ? 1 : 0);
  if (card.kind === "swipe2") return Array.isArray(res) && res.length === card.items.length && res.filter((v, k) => v === card.items[k].side).length >= Math.ceil(card.items.length * 0.75);
  if (card.kind === "multi") return Array.isArray(res) && card.options.every((o, k) => !!o.correct === res.includes(k));
  if (card.kind === "assign") return Array.isArray(res) && card.rows.every((row, k) => card.labels[res[k]] === row.answer);
  if (card.kind === "tone" || card.kind === "fmt") return !!res.ok;
  if (card.kind === "slider") return Math.abs(res - card.year) <= card.tolerance;
  if (card.kind === "order") return Array.isArray(res) && res.length === card.items.length && res.every((v, k) => v === card.solution[k]);
  return null;
}
