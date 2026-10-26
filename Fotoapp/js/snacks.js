// "Häppchen": quick cards for the phone – multiple choice and short facts, built only from sourced library content
// (no AI call, so a card appears instantly). A round is a list of card specs {type, key}; options are derived
// deterministically from the key, so a re-render shows the same card.
import { DIM, lib, photographerOf } from "./domain.js";

// small seeded RNG (mulberry32) so options stay stable for a card
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (const c of seed) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const pickN = (arr, n, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
const stripRefs = t => String(t || "").replace(/\s*\[(?:S|Q)\d+[^\]]*\]/g, "").trim();
const firstSentences = (t, n = 2) => (String(t || "").replace(/^#+.*$/gm, "").replace(/\n+/g, " ").match(/[^.!?]+[.!?]+(\s*\[[^\]]+\])?/g) || []).slice(0, n).join(" ").trim();
const words = t => new Set(stripRefs(t).toLowerCase().match(/[a-zäöüß]{4,}/g) || []);
const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };

export const TOPICS = [
  ["alles", "Alles gemischt"], ["bilder", "Bilder & Fotografen"], ["quellen", "Was die Quellen sagen"],
  ["geschichte", "Geschichte"], ["theorie", "Theorie-Fragen"], ["wissen", "Wissenskarten"],
];
const TOPIC_TYPES = {
  alles: { who: 3, ref: 3, quiz: 2, chap: 1, year: 1, pinfo: 1, concept: 1 },
  bilder: { who: 4, year: 2, pinfo: 1 }, quellen: { ref: 1 }, geschichte: { chap: 3, year: 2, pinfo: 1 },
  theorie: { quiz: 4, concept: 1 }, wissen: { pinfo: 1, concept: 1 },
};

// all possible card keys per type
function candidates(type) {
  switch (type) {
    case "who": return lib.images.filter(i => photographerOf(i).name !== "?").map(i => i.id);
    case "year": return lib.images.filter(i => +i.year >= 1840).map(i => i.id);
    case "chap": return lib.chapters.flatMap(c => c.images.map(id => `${id}|${c.id}`));
    case "ref": return (lib.references || []).filter(r => lib.by.images.has(r.image_id) && r.entries.some(e => e.checkable.length)).map(r => `${r.image_id}|${r.dimension}`);
    case "quiz": return lib.lessons.flatMap(l => l.quiz.map((q, n) => `${l.id}|${n}`));
    case "pinfo": return lib.photographers.filter(p => p.bio_md).map(p => p.id);
    case "concept": return lib.concepts.map(c => c.id);
    default: return [];
  }
}

export function makeRound(topic, size, wrong = []) {
  const weights = TOPIC_TYPES[topic] || TOPIC_TYPES.alles, r = Math.random;
  const pool = Object.fromEntries(Object.keys(weights).map(t => [t, candidates(t)]));
  const types = Object.entries(weights).filter(([t]) => pool[t].length).flatMap(([t, w]) => Array(w).fill(t));
  const cards = [], used = new Set(), usedImg = new Set();
  // repeat up to a third of the round from cards answered wrongly before (same topic types only)
  for (const id of wrong) { const [t, ...k] = id.split(":"); if (cards.length >= Math.ceil(size / 3)) break; if (weights[t] && !used.has(id)) { cards.push({ type: t, key: k.join(":") }); used.add(id); } }
  for (let guard = 0; cards.length < size && guard < size * 50 && types.length; guard++) {
    const t = types[Math.floor(r() * types.length)], key = pool[t][Math.floor(r() * pool[t].length)];
    const img = key.split("|")[0];
    if (used.has(`${t}:${key}`) || (lib.by.images.has(img) && usedImg.has(img))) continue;
    used.add(`${t}:${key}`); if (lib.by.images.has(img)) usedImg.add(img);
    cards.push({ type: t, key });
  }
  return cards;
}
export const cardId = c => `${c.type}:${c.key}`;

// Build what a card shows. Question cards: {kind:"q", prompt, image, options:[{text, correct}], explain_md, link}
// Info cards: {kind:"info", title, image?, portrait?, body_md, link}
export function buildCard(c) {
  const r = rng(cardId(c));
  const shuffleOpts = opts => pickN(opts, opts.length, r);
  if (c.type === "who") {
    const img = lib.by.images.get(c.key), ph = photographerOf(img);
    const near = new Set(lib.chapters.filter(ch => ch.images.includes(img.id)).flatMap(ch => ch.images.map(id => photographerOf(lib.by.images.get(id) || {}).name)));
    const others = [...new Set([...near, ...pickN(lib.photographers.map(p => p.name), 12, r)])].filter(n => n && n !== "?" && n !== ph.name);
    const wrong = pickN(others.filter(n => near.has(n)), 3, r); while (wrong.length < 3) { const n = others[Math.floor(r() * others.length)]; if (!wrong.includes(n)) wrong.push(n); }
    return { kind: "q", label: "Wer hat's gemacht?", prompt: "Von wem ist dieses Bild?", image: img.id,
      options: shuffleOpts([{ text: ph.name, correct: true }, ...wrong.map(n => ({ text: n }))]),
      explain_md: `**${ph.name}** – ${img.title || "Ohne Titel"}${img.year ? `, ${img.year}` : ""}.${ph.bio_md ? "\n\n" + firstSentences(ph.bio_md, 1) : ""}`,
      link: [`#/fotograf/${ph.id}`, "Zum Fotografen"] };
  }
  if (c.type === "year") {
    const img = lib.by.images.get(c.key), dec = Math.floor(img.year / 10) * 10;
    const pool = [-30, -20, -10, 10, 20, 30].map(d => dec + d).filter(y => y >= 1840 && y <= 2020);
    const opts = [dec, ...pickN(pool, 3, r)];
    return { kind: "q", label: "Aus welcher Zeit?", prompt: "In welchem Jahrzehnt entstand dieses Bild?", image: img.id,
      options: shuffleOpts(opts.map(y => ({ text: `${y}er Jahre`, correct: y === dec }))).sort((a, b) => parseInt(a.text) - parseInt(b.text)),
      explain_md: `**${photographerOf(img).name}** – ${img.title || "Ohne Titel"}, **${img.year}**.`, link: [`#/bild/${img.id}`, "Zur Bildseite"] };
  }
  if (c.type === "chap") {
    const [id, chId] = c.key.split("|"), img = lib.by.images.get(id), ch = lib.by.chapters.get(chId);
    const inCh = new Set(lib.chapters.filter(x => x.images.includes(id)).map(x => x.id));
    const wrong = pickN(lib.chapters.filter(x => !inCh.has(x.id)), 3, r);
    return { kind: "q", label: "Geschichte", prompt: "In welches Kapitel der Geschichte gehört dieses Bild?", image: id,
      options: shuffleOpts([{ text: ch.title, correct: true }, ...wrong.map(x => ({ text: x.title }))]),
      explain_md: `**Kapitel ${ch.number}: ${ch.title}** (${ch.period_from}–${ch.period_to}).\n\n${firstSentences((ch.text_md || "").split("## ")[1]?.replace(/^[^\n]*\n/, "") || "", 2)}`,
      link: [`#/kapitel/${ch.id}`, "Zum Kapitel"] };
  }
  if (c.type === "ref") {
    const [id, dim] = c.key.split("|"), ref = lib.by.refs.get(`${id}|${dim}`.replace("|", ":"));
    const entry = ref.entries.find(e => e.checkable.length), right = entry.checkable[Math.floor(r() * entry.checkable.length)];
    const ph = photographerOf(lib.by.images.get(id)).name;
    // distractors: sourced points about OTHER photographers' images on the same aspect, not too similar to the right one
    const others = (lib.references || []).filter(x => x.dimension === dim && x.image_id !== id && photographerOf(lib.by.images.get(x.image_id) || {}).name !== ph)
      .flatMap(x => x.entries.flatMap(e => e.checkable)).filter(t => overlap(t, right) < 0.34);
    const wrong = [...new Set(pickN(others, 8, r).map(stripRefs))].slice(0, 3);
    const src = lib.by.sources.get(entry.source_ids[0]);
    return { kind: "q", label: `Quelle · ${DIM[dim]?.label || dim}`, prompt: `${DIM[dim]?.label || dim}: Was stimmt laut Quelle für dieses Bild?`, image: id,
      options: shuffleOpts([{ text: stripRefs(right), correct: true }, ...wrong.map(t => ({ text: t }))]),
      explain_md: `${entry.answer_md}${src ? `\n\n„${src.excerpt.length > 280 ? src.excerpt.slice(0, 277) + "…" : src.excerpt}“ – ${src.author || src.title}` : ""}${entry.scope_note ? `\n\n<!-- ${entry.scope_note} -->` : ""}`,
      link: [`#/bild/${id}`, "Zur Bildseite"] };
  }
  if (c.type === "quiz") {
    const [lid, n] = c.key.split("|"), l = lib.by.lessons.get(lid), q = l.quiz[+n];
    return { kind: "q", label: `Theorie · ${l.title.split(":")[0]}`, prompt: q.question, image: q.image_id && lib.by.images.has(q.image_id) ? q.image_id : null,
      options: shuffleOpts(q.options.map((o, k) => ({ text: o, correct: k === q.correct }))), explain_md: q.explanation, link: [`#/theorie/${lid}`, "Zur Lektion"] };
  }
  if (c.type === "pinfo") {
    const p = lib.by.photographers.get(c.key), img = lib.images.find(i => i.photographer_id === p.id);
    return { kind: "info", label: "Fotograf:in", title: `${p.name}${p.born ? ` (${p.born}–${p.died || ""})` : ""}`, image: img?.id, portrait: p.portrait ? p.id : null,
      body_md: firstSentences(p.bio_md, 3) + (p.signature_md ? `\n\n**Woran man die Bilder erkennt** (Einschätzung): ${stripRefs(firstSentences(p.signature_md, 1))}` : ""),
      link: [`#/fotograf/${p.id}`, "Mehr zum Fotografen"] };
  }
  if (c.type === "concept") {
    const k = lib.by.concepts.get(c.key);
    return { kind: "info", label: "Seh-Begriff", title: k.name, image: k.images?.[0]?.id && lib.by.images.has(k.images[0].id) ? k.images[0].id : null,
      body_md: firstSentences(k.summary_md, 3) + (k.exercise_md ? `\n\n**Für unterwegs:** ${firstSentences(k.exercise_md, 2)}` : ""), link: [`#/begriffe/${k.id}`, "Zum Begriff"] };
  }
  return null;
}
