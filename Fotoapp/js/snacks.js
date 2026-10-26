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
  sketch: { name: "Mini-Lektion" }, merke: { name: "Merksatz" }, pinfo: { name: "Porträt" }, concept: { name: "Seh-Begriff" },
  who: { name: "Wer war's?", scored: true, quiz: true }, year: { name: "Jahrzehnt", scored: true, quiz: true },
  chap: { name: "Geschichte", scored: true, quiz: true }, ref: { name: "Laut Quelle", scored: true, quiz: true }, quiz: { name: "Theoriefrage", scored: true, quiz: true },
};
export const TOPICS = [
  ["mix", "Bunt gemischt", { order: 2, crop: 2, tf: 2, look: 2, pair: 2, story: 2, quote: 2, sketch: 1, merke: 1, pinfo: 1, concept: 1, memory: 2, tiles: 2, mirror: 1, guess: 2, stamp: 1, who: 1, year: 1, chap: 1, ref: 1, quiz: 1 }],
  ["schauen", "Schauen", { look: 3, memory: 3, crop: 2, pair: 2, stamp: 2, mirror: 2, story: 2, tf: 1 }],
  ["menschen", "Fotografen & O-Töne", { quote: 3, tiles: 3, who: 1, pinfo: 2, story: 2, crop: 1 }],
  ["geschichte", "Geschichte", { order: 3, guess: 3, chap: 2, year: 1, story: 2, quote: 1, pinfo: 1 }],
  ["theorie", "Theorie kompakt", { sketch: 3, merke: 3, concept: 2, quiz: 2, pair: 1 }],
  ["quiz", "Nur Quiz", { who: 2, year: 1, chap: 1, ref: 2, quiz: 2, tf: 2, order: 1, crop: 1, guess: 1, tiles: 1 }],
];

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
  };
  return P;
}

function candidates(type) {
  const p = pools();
  switch (type) {
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
        back_md: `**${s.author || photographerOf(i).name}**${s.title ? ` · ${s.title}` : ""} [S${s.id}]`, back_image: q.image, caption_md: label(i),
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
  if (card.kind === "slider") return Math.abs(res - card.year) <= card.tolerance;
  if (card.kind === "order") return Array.isArray(res) && res.length === card.items.length && res.every((v, k) => v === card.solution[k]);
  return null;
}
