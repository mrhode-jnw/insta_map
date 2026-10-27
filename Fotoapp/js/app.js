// Sehschule web app: unlock, routing and views.
import { AIError, loadState, mediaUrl, providerLabel, mutateState, session, store, unlock, uid, uploadMedia } from "./core.js";
import {
  CONSTRUCTION_LABELS, DIM, DIMENSIONS, DRILLABLE, EXTRA_QUESTIONS, QUESTIONS, addOwn, allTags, analyses, chapterDraft,
  currentAnalysis, drillFeedback, esc, generateAnalysis, learnFeedback, lib, loadLibrary, md, newSourceId, ownId,
  LEARN_ROUND_REQUIRES, PASS_RATIO, analysisPending, lessonTime, splitDeep, refFor, refCount, drillFeedbackSourced, learnRefs, learnFeedbackSourced, LEARN_REF_DIMS, askLesson, discuss, expertsFor, isUnlocked, theoryProgress, photographerOf, projectOf, referenceText, referencedIds, sourcesFor, sourcesForImage,
} from "./domain.js";
import { SEGMENTS, TOPICS, buildCard, cardId, isRight, makeRound } from "./snacks.js";

const $ = s => document.querySelector(s);
const main = () => $("#main");
const LOOK_CHOICES = [0, 30, 60, 90];
// Stable pseudo-random order per seed, so quiz answers aren't always in the authored position.
const shuffled = (arr, seed) => {
  let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const a = [...arr], rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("de-DE") : "";
const scopeLabel = { photographer: "Fotograf", project: "Projekt", image: "Bild", chapter: "Kapitel", concept: "Begriff" };
// Round state lives in localStorage, so an unfinished round can be resumed later.
const sess = { get: k => JSON.parse(store.get("round:" + k) || "null"), set: (k, v) => store.set("round:" + k, v == null ? null : JSON.stringify(v)) };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function toast(msg, ms = 2500) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- background work: AI calls run while the user continues with the next image
const jobs = { running: 0 };
function bg(fn) {
  jobs.running++; jobBadge();
  return Promise.resolve().then(fn).catch(e => console.warn(e)).finally(() => { jobs.running--; jobBadge(); });
}
function jobBadge() { const b = $("#jobs"); if (b) { b.hidden = !jobs.running; b.textContent = `Im Hintergrund … ${jobs.running}`; } }
// Analyses for a whole round are generated up front, in round order.
function prefetch(ids) { bg(async () => { for (const id of ids) await generateAnalysis(lib.by.images.get(id)).catch(() => {}); }); }
const pendingItems = new Map(); // answers/drills not yet written back, so reveal pages can show them at once
async function findItem(kind, id) { return pendingItems.get(id) || (await loadState(kind, [])).find(x => x.id === id); }
const rerenderIf = id => { if (location.hash.includes(id)) route(true); };

const dots = n => `<i class="dots">${"●".repeat(n)}${"○".repeat(5 - n)}</i>`;
function scoreBlock(x) {
  if (x.hit == null) return "";
  return `<div class="scores"><span>Treffer <b>${x.hit}/5</b> ${dots(x.hit)}</span><span>Genauigkeit <b>${x.precision}/5</b> ${dots(x.precision)}</span></div>
  ${(x.per_question || []).length > 1 ? `<table class="pq">${x.per_question.map(q => `<tr><td>${esc(q.question)}</td><td class="pts">${q.points}/5</td></tr><tr><td colspan="2" class="muted small">${esc(q.note)}</td></tr>`).join("")}</table>` : ""}
  ${(x.missed || []).length ? `<p class="small">Was fehlte: ${x.missed.map(m => `<span class="tag miss">${esc(m)}</span>`).join(" ")}</p>` : ""}`;
}
function feedbackBlock(x, retryAction) {
  if (x.feedback_md) return `<h3>Bewertung deiner Einschätzung</h3>${scoreBlock(x)}<div class="prose feedback">${md(x.feedback_md)}</div>`;
  if (x.error) return `<p class="error">${esc(x.error)}</p><button class="secondary" data-action="${retryAction}" data-id="${x.id}">Erneut versuchen</button>`;
  return `<p class="pending">Bewertung wird erstellt … du kannst schon weitermachen, sie wird gespeichert.</p>`;
}

// ---------- rendering helpers
const media = (id, kind = "t", cls = "") => `<img data-media="${esc(id)}" data-kind="${kind}" class="${cls}" alt="">`;
const inlineMd = t => md(t).replace(/^<p>|<\/p>$/g, "");
const imgLabel = i => `<b>${esc(photographerOf(i).name)}</b> – ${esc(i.title || "Ohne Titel")}${i.year ? `, ${i.year}` : ""}`;
// Lesson text with visual blocks, one directive per line:
//   ::kurz Satz · ::merke Satz · ::schau Seh-Aufgabe · ::bild <imgId> | Text
//   ::vergleich <imgA> <imgB> | Text A | Text B · ::skizze <name> | Text
function rich(text) {
  const out = [], buf = [];
  const flush = () => { if (buf.length) out.push(md(buf.join("\n"))); buf.length = 0; };
  for (const line of String(text || "").split("\n")) {
    const m = line.trim().match(/^::(kurz|merke|schau|bild|vergleich|skizze|galerie)\s+(.*)$/);
    if (!m) { buf.push(line); continue; }
    flush();
    const [head, ...caps] = m[2].split("|").map(x => x.trim());
    if (m[1] === "kurz") out.push(`<p class="kurz">${inlineMd(m[2])}</p>`);
    else if (m[1] === "merke") out.push(`<div class="merke"><span>Merke</span>${inlineMd(m[2])}</div>`);
    else if (m[1] === "schau") out.push(`<div class="schau"><span>Schau hin</span>${inlineMd(m[2])}</div>`);
    else if (m[1] === "galerie") { const imgs = head.split(/\s+/).map(x => lib.by.images.get(x)).filter(Boolean);
      if (imgs.length) out.push(`<figure class="galerie"><div class="galerie-grid">${imgs.map(i => `<div class="g-item"><div class="g-img">${media(i.id, "t", "g")}</div><span>${esc(photographerOf(i).name)}</span></div>`).join("")}</div>${caps[0] ? `<figcaption>${inlineMd(caps[0])}</figcaption>` : ""}</figure>`); }
    else if (m[1] === "skizze") { const svg = lib.sketches?.[head];
      if (svg) out.push(`<figure class="sketch">${svg}${caps[0] ? `<figcaption>${inlineMd(caps[0])}</figcaption>` : ""}</figure>`); }
    else if (m[1] === "bild") { const i = lib.by.images.get(head);
      if (i) out.push(`<figure class="inline-img"><a href="#/bild/${i.id}">${media(i.id, "m")}</a><figcaption><span class="who">${imgLabel(i)}</span>${caps[0] ? ` ${inlineMd(caps[0])}` : ""}</figcaption></figure>`); }
    else { const ids = head.split(/\s+/).map(x => lib.by.images.get(x)).filter(Boolean);
      if (ids.length) out.push(`<figure class="compare">${ids.map((i, k) => `<div><a href="#/bild/${i.id}">${media(i.id, "m")}</a><figcaption><span class="who">${imgLabel(i)}</span>${caps[k] ? ` ${inlineMd(caps[k])}` : ""}</figcaption></div>`).join("")}</figure>`); }
  }
  flush();
  return out.join("\n");
}
// "[S12, S34]" → small superscript numbers, numbered in order of first appearance
function compactRefs(html, nums) {
  return html.replace(/\s?\[((?:<a class="ref"[^>]*>S\d+<\/a>(?:,\s*)?)+)\]/g, (_, g) => `<sup class="refs">${[...g.matchAll(/data-src="(\d+)"/g)].map(([, id]) => {
    if (!nums.has(+id)) nums.set(+id, nums.size + 1);
    return `<a class="ref" href="#source-${id}" data-src="${id}">${nums.get(+id)}</a>`; }).join("")}</sup>`)
    // keep "word¹." together so the number never wraps onto its own line
    .replace(/([^\s>]*)(<sup class="refs">.*?<\/sup>)([.,;:!?)»“"]*)/g, `<span class="nw">$1$2$3</span>`);
}
const thumbs = images => images.length ? `<div class="thumbs">${images.map(i => `
  <a class="thumb" href="#/bild/${i.id}">${media(i.id)}
    <span class="cap">${esc(photographerOf(i).name)}${i.year ? ` · ${i.year}` : ""}</span></a>`).join("")}</div>`
  : `<p class="muted">Noch keine Bilder.</p>`;

function sourcesBlock(srcs, { scope = null, scopeId = null, editable = false, nums = null } = {}) {
  srcs = srcs.filter(s => !s.kind);
  if (nums) srcs = [...srcs].sort((a, b) => (nums.get(a.id) || 1e9) - (nums.get(b.id) || 1e9));
  return `<section id="sources" class="sources"><h3>Quellen</h3>
    ${srcs.length ? "" : `<p class="muted">Keine Quelle hinterlegt.</p>`}
    <ol class="source-list">${srcs.map(s => `<li id="source-${s.id}"><span class="sid">${nums?.has(s.id) ? nums.get(s.id) : `S${s.id}`}</span>
      <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>
      <span class="muted">· abgerufen ${fmtDate(s.accessed_at)}${scope && s.scope !== scope ? ` · ${scopeLabel[s.scope]}` : ""}</span>
      ${s.excerpt ? `<blockquote>${esc(s.excerpt)}</blockquote>` : ""}</li>`).join("")}</ol>
    ${editable ? `<details class="add-source"><summary>Quelle hinzufügen</summary>
      <form data-action="add-source" data-scope="${scope}" data-scope-id="${esc(scopeId)}" class="grid-form">
        <label class="wide">URL <input type="url" name="url" required></label>
        <label class="wide">Titel <input name="title"></label>
        <label class="wide">Relevanter Textauszug (wörtlich)<textarea name="excerpt" rows="4"></textarea></label>
        <button>Speichern</button></form></details>` : ""}
  </section>`;
}

const KIND = { museum: "Museum", kurator: "Kuratorin/Kurator", kritik: "Kritik", fotograf: "Fotograf/in selbst", wissenschaft: "Wissenschaft" };
const ASPECT = { entstehung: "Entstehung", deutung: "Deutung", wirkung: "Wirkung", rezeption: "Rezeption", technik: "Technik" };
function expertsBlock(img) {
  const ex = expertsFor(img);
  return `<section class="experts"><h2>Expertenstimmen</h2>
    ${ex.length ? ex.map(s => `<figure class="expert" id="source-${s.id}"><blockquote>${esc(s.excerpt)}</blockquote>
      <figcaption>— ${esc(s.author || KIND[s.kind] || "")}${s.author && KIND[s.kind] ? ` <span class="muted">(${KIND[s.kind]})</span>` : ""}
      ${s.aspect ? `<span class="tag">${ASPECT[s.aspect] || esc(s.aspect)}</span>` : ""}${s.series_level ? `<span class="tag">zur Serie</span>` : ""}
      · <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || "Quelle")}</a> <span class="sid">S${s.id}</span></figcaption></figure>`).join("")
      : `<p class="muted">Zu diesem Bild ist noch keine Expertenstimme hinterlegt.</p>`}</section>`;
}
async function discussionBlock(img) {
  const thread = (await loadState("discussions", {}))[img.id] || [];
  const pending = pendingQuestions.get(img.id);
  return `<section class="discussion" id="discussion"><h2>Rückfragen und Diskussion</h2>
    ${thread.map(m => `<div class="msg ${m.role}"><div class="who">${m.role === "user" ? "Du" : "KI"} · ${fmtDate(m.at)}</div><div class="prose">${md(m.text)}</div></div>`).join("")}
    ${pending ? `<div class="msg user"><div class="who">Du</div><div class="prose">${md(pending)}</div></div><p class="pending">Antwort kommt …</p>` : ""}
    <form data-action="ask" data-img="${img.id}" class="ask"><textarea name="q" rows="2" placeholder="z. B. Warum wirkt der Horizont so tief? Ich sehe das Licht anders, weil …" required></textarea>
      <button>Fragen</button></form></section>`;
}
const pendingQuestions = new Map();

async function myHistory(img) {
  const [answers, drills] = await Promise.all([loadState("answers", []), loadState("drills", [])]);
  const mine = [...answers.filter(a => a.image_id === img.id).map(a => ({ ...a, href: `#/lernen/r/${a.id}`, label: "Lernrunde" })),
    ...drills.filter(d => d.image_id === img.id).map(d => ({ ...d, href: `#/sehen/r/${d.id}`, label: DIM[d.dimension]?.label }))];
  if (!mine.length) return "";
  return `<p class="my-history">Deine Übungen zu diesem Bild: ${mine.map(x => `<a href="${x.href}" class="tag">${x.label} · ${fmtDate(x.created_at)}${x.hit != null ? ` · ${x.hit}/${x.precision}` : ""}</a>`).join(" ")}</p>`;
}

function artistCard(p, full = false) {
  return `<div class="artist">${p.portrait ? `<img data-media="${esc(p.id)}" data-kind="p" class="portrait" alt="">` : ""}
    <div><b><a href="#/fotograf/${p.id}">${esc(p.name)}</a></b> ${p.born ? `<span class="muted">${p.born}–${p.died || ""}</span>` : ""}
    ${p.bio_md ? `<div class="prose small">${md(full ? p.bio_md : p.bio_md.split(/(?<=\.)\s/).slice(0, 2).join(" "))}</div>` : ""}
    ${p.portrait?.credit ? `<p class="muted tiny">Porträt: ${esc(p.portrait.credit)}</p>` : ""}</div></div>`;
}

function analysisBody(a) {
  if (!a) return `<p class="muted">Keine Analyse vorhanden.</p>`;
  return `
  <section class="level"><h3><span class="num">1</span> Was zu sehen ist</h3><p>${esc(a.seen || "—")}</p>
    ${(a.layout || []).length ? `<details class="layout"><summary>Lage im Bild</summary><ul>${a.layout.map(x => `<li><b>${esc(x.thing)}</b>: ${esc(x.where)}</li>`).join("")}</ul></details>` : ""}</section>
  <section class="level"><h3><span class="num">2</span> Wie es gebaut ist</h3><dl class="construction">
    ${CONSTRUCTION_LABELS.filter(([k]) => k in (a.construction || {})).map(([k, l]) => `<dt>${l}</dt><dd>${esc(a.construction[k] || "—")}</dd>`).join("")}</dl></section>
  <section class="level"><h3><span class="num">3</span> Kontext</h3>
    ${(a.context?.sourced || []).length ? `<ul class="sourced">${a.context.sourced.map(st => `<li>${esc(st.text)} [${st.source_ids.map(i => `<a class="ref" href="#source-${i}" data-src="${i}">S${i}</a>`).join(", ")}]</li>`).join("")}</ul>` : `<p class="muted">Keine Quelle hinterlegt.</p>`}
    <h4>Meine Einschätzung</h4><p>${esc(a.context?.assessment || "—")}</p></section>
  ${a.stance ? `<section class="level"><h3><span class="num">·</span> Haltung <span class="muted small">(Meine Einschätzung)</span></h3><p>${esc(a.stance)}</p></section>` : ""}
  ${a.technique ? `<section class="level"><h3><span class="num">·</span> Technik im Dienst der Wirkung</h3><div class="prose">${md(a.technique)}</div></section>` : ""}
  ${a.quality ? `<section class="level quality"><h3><span class="num">·</span> Qualität und Wirkung <span class="muted small">(Einschätzung der KI)</span></h3><dl class="construction">
    <dt>Wirkung</dt><dd>${esc(a.quality.effect || "—")}</dd><dt>Stärken</dt><dd>${esc(a.quality.strengths || "—")}</dd>
    <dt>Schwächen</dt><dd>${esc(a.quality.weaknesses || "—")}</dd><dt>Bedeutung</dt><dd>${md(a.quality.significance || "—")}</dd></dl></section>` : ""}
  <section class="level"><h3><span class="num">4</span> Übertragbar auf die eigene Reise</h3><ol>${(a.transferable || []).map(t => `<li>${esc(t)}</li>`).join("")}</ol></section>
  ${a.not_assessable ? `<p class="muted small">Nicht beurteilbar an der Bildschirmkopie: ${esc(a.not_assessable)}</p>` : ""}
  ${(a.deviations || []).length ? `<section class="level"><h4>Begründete Abweichungen zur Vorversion</h4><ul>${a.deviations.map(d => `<li><code>${esc(d.field)}</code>: ${esc(d.reason)}</li>`).join("")}</ul></section>` : ""}
  ${(a.warnings || []).length ? `<p class="warn small">Prüfhinweise: ${a.warnings.map(esc).join(" · ")}</p>` : ""}`;
}

function lookTimer(look) {
  return `<div id="look-timer" class="look-timer" ${look ? "" : "hidden"}>
    <p>Erst nur schauen. <span id="look-left">${look}</span> s</p><button type="button" class="link" id="look-skip">überspringen</button></div>`;
}
function startLookTimer(look) {
  const q = $("#questions"), t = $("#look-timer"), started = Date.now();
  const show = () => { t.hidden = true; q.hidden = false; };
  if (look > 0) {
    q.hidden = true; let left = look;
    const iv = setInterval(() => { left--; $("#look-left") && ($("#look-left").textContent = left); if (left <= 0) { clearInterval(iv); show(); } }, 1000);
    $("#look-skip").onclick = () => { clearInterval(iv); show(); };
    window.addEventListener("hashchange", () => clearInterval(iv), { once: true });
  }
  return () => Math.round((Date.now() - started) / 1000);
}

// ---------- views
const views = {};

views.home = async () => {
  const [an, answers, drills] = await Promise.all([analyses(), loadState("answers", []), loadState("drills", [])]);
  const recent = lib.images.slice(-12).reverse();
  return `<h1>Sehschule</h1>
  <p class="lead">Sehen lernen an Bildern anderer: erst schauen, dann selbst urteilen, dann die Analyse. Fakten nur mit Quelle.</p>
  <div class="stats">
    <a href="#/fotografen"><b>${lib.photographers.length}</b> Fotografen</a><a href="#/bibliothek"><b>${lib.images.length}</b> Bilder</a>
    <span><b>${Object.keys(an).length}</b> Analysen</span><a href="#/lernen/antworten"><b>${answers.length + drills.length}</b> Übungen</a>
    <a href="#/begriffe"><b>${lib.concepts.length}</b> Seh-Begriffe</a></div>
  ${session.anthropicKey || session.openaiKey ? `<p class="muted small">KI: ${esc(providerLabel())} · <a href="setup.html">ändern</a></p>`
    : `<p class="warn">Kein KI-Key hinterlegt – Analysen und Feedback gehen erst nach <a href="setup.html">Einrichtung</a>.</p>`}
  ${session.ghToken ? "" : `<p class="warn">Kein GitHub-Token – Analysen und Antworten können nicht gespeichert werden.</p>`}
  ${["learn", "drill"].map(k => [k, sess.get(k)]).filter(([, v]) => v && v.pos < (v.ids || v.items).length).map(([k, v]) =>
    `<p class="card">Offene ${k === "learn" ? "Lernrunde" : "Sehübung"}: Bild ${v.pos + 1} von ${(v.ids || v.items).length} · <a href="#/${k === "learn" ? "lernen/runde" : "sehen/uebung"}">fortsetzen</a></p>`).join("")}
  <div class="actions"><a class="button" href="#/theorie">Theorie</a><a class="button secondary" href="#/sehen">Sehen lernen</a><a class="button secondary" href="#/lernen">Lernrunde</a><a class="button secondary" href="#/fortschritt">Fortschritt</a></div>
  <h2>Zuletzt hinzugefügt</h2>${thumbs(recent)}
  <h2>Geschichte</h2><ol class="chapter-list">${lib.chapters.map(c => `<li value="${c.number}"><a href="#/kapitel/${c.id}">${esc(c.title)}</a></li>`).join("")}</ol>`;
};

// --- Sehen lernen
views.sehen = async () => {
  const drills = await loadState("drills", []), prog = await theoryProgress();
  const open = DRILLABLE.filter(d => isUnlocked(prog, d.key));
  const counts = drills.reduce((m, d) => (m[d.dimension] = (m[d.dimension] || 0) + 1, m), {});
  const look = Number(store.get("lookSeconds") ?? 60);
  const byDim = {}; lib.concepts.forEach(c => (byDim[c.dimension] ||= []).push(c));
  return `<h1>Sehen lernen</h1>
  <p class="lead">Ein Aspekt, ein Bild, eine Frage. Erst schauen, dann beschreiben, was wirklich da ist – dann vergleichen.</p>
  <form data-action="drill-start" class="card grid-form">
    <fieldset class="wide"><legend>Worauf schauen?</legend><div class="dims">
      ${open.map(d => `<label class="dim"><input type="radio" name="dimension" value="${d.key}" ${d === open[0] ? "checked" : ""}>
        <span class="dim-text"><b>${d.label}</b><span>${d.q}</span><em class="muted">${counts[d.key] || 0} geübt · ${refCount(d.key)} Bilder mit Quellenreferenz</em></span></label>`).join("")}
      ${open.length > 1 ? `<label class="dim"><input type="radio" name="dimension" value="mixed"><span class="dim-text"><b>Gemischt</b><span>Jedes Bild mit einem freigeschalteten Aspekt.</span></span></label>` : ""}
    </div>
    ${DRILLABLE.length > open.length ? `<p class="locked-list"><span class="muted small">Noch gesperrt – erst die Lektion abschließen:</span>
      ${DRILLABLE.filter(d => !isUnlocked(prog, d.key)).map(d => `<a class="tag" href="#/theorie/${d.key}">🔒 ${d.label}</a>`).join(" ")}</p>` : ""}</fieldset>
    <label class="check wide"><input type="checkbox" name="sourced" ${open.some(d => refCount(d.key)) ? "checked" : ""}> Nur Bilder mit Quellenreferenz (empfohlen) <span class="muted small">– verglichen wird mit Aussagen der Fotografen, Museen und Lehrgänge, nicht mit einer KI-Einschätzung</span></label>
    <label>Bilder <select name="size"><option>3</option><option selected>5</option><option>8</option></select></label>
    <label>Erst schauen <select name="look">${LOOK_CHOICES.map(s => `<option value="${s}" ${s === look ? "selected" : ""}>${s ? s + " Sekunden" : "ohne Timer"}</option>`).join("")}</select></label>
    ${open.length ? `<button>Übung starten</button>` : `<p class="warn wide">Noch keine Sehübung freigeschaltet – beginne mit der <a href="#/theorie">Theorie</a>.</p>`}</form>
  <h2>Seh-Begriffe</h2><div class="concept-grid">${DIMENSIONS.filter(d => byDim[d.key]).map(d => `<div><h4>${d.label}</h4><ul>
    ${byDim[d.key].map(c => `<li><a href="#/begriffe/${c.id}">${esc(c.name)}</a></li>`).join("")}</ul></div>`).join("")}</div>
  ${drills.length ? `<h2>Zuletzt geübt</h2><ul class="answer-list">${drills.slice(-8).reverse().map(d => { const i = lib.by.images.get(d.image_id); return i ? `
    <li><a href="#/sehen/r/${d.id}">${media(i.id)}</a><div><a href="#/sehen/r/${d.id}">${esc(i.title || "Bild")}</a>
    <span class="muted">${DIM[d.dimension]?.label} · ${fmtDate(d.created_at)}${d.look_seconds ? ` · ${d.look_seconds} s geschaut` : ""}</span></div></li>` : ""; }).join("")}</ul>` : ""}`;
};

views.drill = async () => {
  const st = sess.get("drill");
  if (!st) { location.hash = "#/sehen"; return ""; }
  if (st.pos >= st.items.length) { location.hash = "#/runde/sehen"; return ""; }
  const [iid, dkey] = st.items[st.pos]; const img = lib.by.images.get(iid), d = DIM[dkey];
  setTimeout(() => { const looked = startLookTimer(st.look); $("#questions").addEventListener("submit", () => ($("#questions").dataset.looked = looked()), { capture: true }); });
  return `<p class="progress">Sehübung ${st.pos + 1} von ${st.items.length} · <b>${d.label}</b></p>
  <figure class="hero learn">${media(img.id, "m")}</figure>
  <form data-action="drill-answer" data-img="${img.id}" data-dim="${d.key}" id="questions" class="answers card">
    <label>${d.q}<textarea name="answer" rows="5"></textarea></label><p class="muted small">${d.hint}</p>
    <button>Aufdecken</button></form>${lookTimer(st.look)}`;
};

views.drillReveal = async id => {
  const drill = await findItem("drills", id);
  if (!drill) return `<p class="muted">Nicht gefunden.</p>`;
  const img = lib.by.images.get(drill.image_id), d = DIM[drill.dimension], an = await currentAnalysis(img.id);
  const st = sess.get("drill"), inSession = st && st.items[st.pos]?.[0] === img.id && st.items[st.pos]?.[1] === drill.dimension;
  const concepts = lib.concepts.filter(c => c.dimension === d.key);
  return `${inSession ? `<p class="progress">Sehübung ${st.pos + 1} von ${st.items.length} · <b>${d.label}</b></p>` : ""}
  ${inSession ? nextButton("drill-next", st.pos + 1 < st.items.length, true) : ""}
  ${imageHeader(img)}
  <div class="two-col reveal"><div><h2>${d.label}: deine Beobachtung</h2><p class="muted small">${d.q}</p><p class="pre">${esc(drill.answer || "—")}</p>
    ${feedbackBlock(drill, "drill-retry")}</div>
  <div>${(() => { const ref = refFor(img.id, d.key);
    const aiPart = an ? `${analysisMeta(an)}<p>${esc(referenceText(an.data, d.field) || "Die gespeicherte Analyse (ältere Version) behandelt diesen Aspekt nicht – auf der Bildseite neu erzeugen.")}</p>
      <details><summary>Ganze Analyse</summary>${analysisBody(an.data)}</details>${objectionBlock(img, an, { drill: drill.id })}`
      : ref ? `<div id="analysis"><button class="secondary" data-action="analyze" data-img="${img.id}">KI-Einschätzung erzeugen</button><span class="busy">KI analysiert … (1–3 Minuten)</span></div>` : `<p class="pending">Analyse wird erzeugt …</p>`;
    return ref ? `${refBlock(ref, d)}<details class="ai-opt"><summary>KI-Einschätzung (zusätzlich, kann irren)</summary>${aiPart}</details>`
      : `<h2>${d.label}: Analyse <span class="muted small">(KI-Einschätzung, kann irren – zu diesem Bild gibt es keine Quellenreferenz)</span></h2>${aiPart}`; })()}
    ${concepts.length ? `<h3>Begriffe dazu</h3><ul>${concepts.map(c => `<li><a href="#/begriffe/${c.id}">${esc(c.name)}</a></li>`).join("")}</ul>` : ""}</div></div>
  ${expertsBlock(img)}${await discussionBlock(img)}${artistCard(photographerOf(img))}
  ${sourcesBlock(sourcesForImage(img), { scope: "image" })}
  ${inSession ? nextButton("drill-next", st.pos + 1 < st.items.length) : `<p><a href="#/sehen">Zurück zu Sehen lernen</a></p>`}`;
};
// "Analyse stimmt nicht?": the AI re-checks the picture against his objection; the old version stays (principle 3).
const objecting = new Set();
function objectionBlock(img, an, ref = {}) {
  if (!an) return "";
  const answered = an.objection ? `<div class="objection-answer"><h4>Dein Einwand (Version ${an.version})</h4><p class="pre">${esc(an.objection)}</p>
    ${(an.data.deviations || []).length ? `<h4>Antwort der KI nach erneuter Prüfung am Bild</h4><ul>${an.data.deviations.map(d => `<li><code>${esc(d.field)}</code>: ${esc(d.reason)}</li>`).join("")}</ul>`
      : `<p class="muted">Die KI hat keine Abweichung begründet.</p>`}</div>` : "";
  if (objecting.has(img.id)) return answered + `<p class="pending">KI prüft deinen Einwand am Bild … (1–3 Minuten)</p>`;
  return answered + `<details class="objection"><summary>Analyse stimmt nicht?</summary>
    <form data-action="object" data-img="${img.id}" data-drill="${esc(ref.drill || "")}" data-answer="${esc(ref.answer || "")}">
      <label>Was ist falsch – und woran siehst du es im Bild?<textarea name="text" rows="4" required placeholder="z. B. Die Kamera stand auf Augenhöhe: Der Bug des mittleren Boots ragt über den Horizont."></textarea></label>
      <p class="muted small">Die KI prüft deinen Einwand Punkt für Punkt am Bild, korrigiert oder begründet, warum nicht. Die bisherige Version bleibt erhalten; deine Bewertung wird danach neu berechnet.</p>
      <button>Prüfen lassen</button></form></details>`;
}
// Reference from fixed sources (photographers, museums, courses): the yardstick in drills, shown before any AI text.
const ROLE = { photographer: "Fotograf:in selbst", museum: "Museum", curator: "Kurator:in", critic: "Kritik", teaching: "Lehrgang / Hochschule", magazine: "Fachmagazin" };
function refBlock(ref, d) {
  const ids = [...new Set(ref.entries.flatMap(e => e.source_ids))], srcs = ids.map(i => lib.by.sources.get(i)).filter(Boolean);
  return `<section class="refblock"><h2>${d.label} – was die Quellen sagen</h2>
    ${ref.entries.map(e => `<div class="prose">${md(e.answer_md)}</div>
      ${e.checkable.length ? `<p class="small"><b>Daran siehst du es im Bild:</b></p><ul class="checkable">${e.checkable.map(c => `<li>${md(c).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>` : ""}
      ${e.scope_note ? `<p class="muted small">${esc(e.scope_note)}</p>` : ""}`).join("")}
    <div class="ref-quotes">${srcs.map(s => `<figure class="expert" id="source-${s.id}"><blockquote>${esc(s.excerpt)}</blockquote>
      <figcaption>— ${esc(s.author || "")}${s.role || s.kind ? ` <span class="tag">${esc(ROLE[s.role] || s.role || s.kind)}</span>` : ""} · <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></figcaption></figure>`).join("")}</div></section>`;
}
// Which analysis is this? Older prompt versions had no grid and misjudged positions more often.
const analysisMeta = an => { const v = Number((an.prompt_version || "").match(/analysis_v(\d+)/)?.[1] || 0);
  return `<p class="meta muted small">Version ${an.version} · ${esc(an.model || "")} · ${fmtDate(an.created_at)}${v && v < 6 ? ` · <span class="warn-inline">ältere Analyse ohne Lageprüfung – bei Zweifel „Analyse stimmt nicht?“</span>` : ""}</p>`; };
const nextButton = (action, more, top = false) => `<div class="next${top ? " top" : ""}"><button data-action="${action}">${more ? "Nächstes Bild →" : "Runde abschließen"}</button></div>`;

const imageHeader = img => `<h1>${esc(img.title || "Ohne Titel")} <span class="muted">· ${esc(photographerOf(img).name)}${img.year ? `, ${img.year}` : ""}</span></h1>
  <figure class="hero">${media(img.id, "m")}<figcaption><a href="#/bild/${img.id}">Bildseite</a> · <a href="${esc(img.source_url)}" target="_blank" rel="noopener noreferrer">Quelle</a></figcaption></figure>`;

// --- theory course
views.theorie = async () => {
  const prog = await theoryProgress();
  const done = lib.lessons.filter(l => prog[l.id]?.passed).length;
  const next = lib.lessons.find(l => !prog[l.id]?.passed);
  return `<h1>Theorie</h1>
  <p class="lead">Der Lernteil: ein Kurs in ${lib.lessons.length} Lektionen (Beschreibung, Erklärung, Beispiele, Abschlusstest – erst wenn eine Lektion bestanden ist, öffnet sich die Sehübung dazu), dazu die <a href="#/geschichte">Geschichte</a> in ${lib.chapters.length} Kapiteln, <a href="#/fotografen">${lib.photographers.length} Fotografen</a>, die <a href="#/begriffe">Seh-Begriffe</a> und die <a href="#/zeitleiste">Zeitleiste</a>.</p>
  <div class="stats"><span><b>${done}</b>/${lib.lessons.length} bestanden</span></div>
  ${next ? "" : `<p class="ok">Alle Lektionen bestanden.</p>`}
  ${[["sehen", "Sehen: Bildmerkmale"], ["grundlagen", "Grundlagen: Theorie, Methode, Praxis"], ["fotografen", "Fotografen: Traditionen, Handschriften, Werke"]].map(([track, label]) => {
    const ls = lib.lessons.filter(l => (l.track || "sehen") === track); if (!ls.length) return "";
    const nx = ls.find(l => !prog[l.id]?.passed);
    return `<h2>${label}</h2>${nx ? `<p><a class="button secondary" href="#/theorie/${nx.id}">Weiter mit: ${esc(nx.title)}</a></p>` : `<p class="ok">Alle bestanden.</p>`}<ol class="lesson-list">${ls.map(l => { const p = prog[l.id];
    return `<li><a href="#/theorie/${l.id}">${esc(l.title)}</a>
      ${p?.passed ? `<span class="status reviewed">bestanden ${p.best}/${p.total}</span>` : p ? `<span class="status">${p.best}/${p.total} – noch nicht bestanden</span>` : `<span class="muted small">offen</span>`}</li>`; }).join("")}</ol>`; }).join("")}
  ${lib.lessons.length ? "" : `<p class="muted">Die Lektionen werden gerade erstellt.</p>`}`;
};

views.lektion = async id => {
  const l = lib.by.lessons.get(id); if (!l) return `<p class="muted">Nicht gefunden.</p>`;
  const prog = (await theoryProgress())[id];
  const idx = lib.lessons.indexOf(l), nextL = lib.lessons[idx + 1];
  const d = DIM[id], concepts = lib.concepts.filter(c => c.dimension === id);
  const srcs = lib.sources.filter(x => x.scope === "lesson" && x.scope_id === id);
  const nums = new Map();
  const cited = [...referencedIds([l.intro_md, ...l.sections.map(x => x.body_md), ...l.examples.map(e => e.caption_md)].join(" "))]
    .filter(i => !srcs.some(x => x.id === i)).map(i => lib.by.sources.get(i)).filter(Boolean).map(x => ({ ...x, kind: undefined }));
  const thread = (await loadState("discussions", {}))["lesson:" + id] || [];
  const pend = pendingQuestions.get("lesson:" + id);
  const time = lessonTime(l), coreQ = l.quiz.map((q, n) => [q, n]).filter(([q]) => !q.deep), deepQ = l.quiz.map((q, n) => [q, n]).filter(([q]) => q.deep);
  const deepEx = l.examples.filter(e => e.deep), coreEx = l.examples.filter(e => !e.deep);
  const example = e => { const i = lib.by.images.get(e.image_id); return i ? `<figure class="key-image example">
      <a href="#/bild/${i.id}">${media(i.id, "m")}</a><figcaption><b>${esc(photographerOf(i).name)}</b> – ${esc(i.title || "Ohne Titel")}${i.year ? `, ${i.year}` : ""}
      <div class="prose">${md(e.caption_md)}</div>
      ${(e.look_for || []).length ? `<ul class="look-for">${e.look_for.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</figcaption></figure>` : ""; };
  const question = ([q, n]) => `<fieldset class="q" data-n="${n}"><legend>${md(q.question).replace(/^<p>|<\/p>$/g, "")}</legend>
      ${q.image_id && lib.by.images.has(q.image_id) ? `<div class="quiz-img">${media(q.image_id, "m")}</div>` : ""}
      ${shuffled(q.options.map((o, k) => [o, k]), `${id}:${n}`).map(([o, k]) => `<label class="radio"><input type="radio" name="q${n}" value="${k}" required> ${md(o).replace(/^<p>|<\/p>$/g, "")}</label>`).join("")}
      <div class="explain" hidden></div></fieldset>`;
  const section = (x, n) => { const [core, more] = splitDeep(x.body_md);
    const head = `<h3 data-h="${esc(x.heading)}"><span class="num">${n + 1}</span>${esc(x.heading)}</h3>`;
    if (x.deep) return `<details class="lsec deep"><summary>${head}<span class="deep-tag">Vertiefung</span></summary><div class="prose">${rich(core)}${rich(more)}</div></details>`;
    return `<section class="lsec">${head}<div class="prose">${rich(core)}</div>${more.trim() ? `<details class="deep more"><summary>Mehr dazu (Vertiefung)</summary><div class="prose">${rich(more)}</div></details>` : ""}</section>`; };
  const page = `<p class="crumbs"><a href="#/theorie">Theorie</a> › Lektion ${l.order}</p>
  <h1>${esc(l.title)} ${prog?.passed ? `<span class="status reviewed">bestanden</span>` : ""}</h1>
  <p class="lesson-time">⏱ Kern ca. ${time.core} Min${time.deep ? ` · Vertiefung ca. ${time.deep} Min (aufklappbar, freiwillig)` : ""}</p>
  <nav class="toc"><a href="#" data-toc="Beschreibung">Beschreibung</a>${l.sections.filter(x => !x.deep).map(x => `<a href="#" data-toc="${esc(x.heading)}">${esc(x.heading)}</a>`).join("")}
    <a href="#" data-toc="Beispiele">Beispiele</a><a href="#" data-toc="Abschlusstest">Abschlusstest</a></nav>
  <article class="chapter lesson">
    <h3 data-h="Beschreibung">Beschreibung</h3><div class="prose">${rich(l.intro_md)}</div>
    ${l.sections.map(section).join("")}
    ${(l.photographers || []).length ? `<h3>Fotografen im Porträt</h3><p class="muted small">Zum Nachschlagen – tippe auf einen Namen.</p>${l.photographers.map(pid => { const p = lib.by.photographers.get(pid); if (!p) return "";
      const imgs = lib.images.filter(i => i.photographer_id === pid).slice(0, 6);
      return `<details class="profile"><summary>${esc(p.name)}${p.born ? ` <span class="muted">${p.born}–${p.died || ""}</span>` : ""}</summary>${artistCard(p, true)}${p.method_md ? `<p class="small"><b>Arbeitsweise:</b></p><div class="prose small">${md(p.method_md)}</div>` : ""}
        ${p.signature_md ? `<p class="small"><b>Handschrift – woran man die Bilder erkennt</b> <span class="muted">(Einschätzung)</span></p><div class="prose small">${md(p.signature_md)}</div>` : ""}
        ${imgs.length ? `<div class="thumbs mini">${imgs.map(i => `<a class="thumb" href="#/bild/${i.id}">${media(i.id)}</a>`).join("")}</div>` : ""}</details>`; }).join("")}` : ""}
    <h3>Beispiele</h3>
    ${coreEx.map(example).join("")}
    ${deepEx.length ? `<details class="deep more"><summary>Weitere Beispiele (${deepEx.length})</summary>${deepEx.map(example).join("")}</details>` : ""}
    <h3>Merksätze</h3><ul class="takeaways">${l.takeaways.map(t => `<li>${md(t).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>
    <details class="deep more"><summary>Übungen für unterwegs (${l.exercises.length})</summary><ul>${l.exercises.map(t => `<li>${md(t).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul></details>
    ${concepts.length ? `<p class="small">Seh-Begriffe dazu: ${concepts.map(c => `<a href="#/begriffe/${c.id}" class="tag">${esc(c.name)}</a>`).join(" ")}</p>` : ""}
  </article>
  <section class="card quiz" id="quiz"><h3>Abschlusstest</h3>
    <p class="muted small">${coreQ.length} Fragen zum Kern · bestanden ab ${Math.ceil(coreQ.length * PASS_RATIO)} richtigen Antworten${prog ? ` · bisher bestes Ergebnis ${prog.best}/${prog.total}` : ""}</p>
    <form data-action="quiz" data-id="${id}" class="numbered">${coreQ.map(question).join("")}
      <button>Auswerten</button></form>
    <div id="quiz-result"></div>
    ${deepQ.length ? `<details class="deep more"><summary>Zusatzfragen zur Vertiefung (${deepQ.length}, freiwillig)</summary>
      <form data-action="quiz" data-id="${id}" data-set="deep" class="numbered">${deepQ.map(question).join("")}<button class="secondary">Auswerten</button></form><div class="quiz-result-deep"></div></details>` : ""}</section>
  ${d?.field ? `<p>${prog?.passed ? `<button class="secondary" data-action="drill-quick" data-dim="${id}">Sehübung „${d.label}“ starten</button>` : `<span class="muted">🔒 Die Sehübung „${d.label}“ öffnet sich nach bestandenem Test.</span>`}</p>` : ""}
  ${nextL ? `<p><a href="#/theorie/${nextL.id}">Nächste Lektion: ${esc(nextL.title)} →</a></p>` : ""}
  <section class="discussion"><h2>Fragen zur Lektion</h2>
    ${thread.map(m => `<div class="msg ${m.role}"><div class="who">${m.role === "user" ? "Du" : "Dozent (KI)"} · ${fmtDate(m.at)}</div><div class="prose">${md(m.text)}</div></div>`).join("")}
    ${pend ? `<div class="msg user"><div class="who">Du</div><div class="prose">${md(pend)}</div></div><p class="pending">Antwort kommt …</p>` : ""}
    <form data-action="lesson-ask" data-id="${id}" class="ask"><textarea name="q" rows="2" placeholder="Was ist dir unklar? z. B. Warum wirkt Gegenlicht flächiger?" required></textarea><button>Fragen</button></form></section>
`;
  const body = compactRefs(page, nums);
  return body + sourcesBlock([...srcs, ...cited], { scope: "lesson", nums });
};

// --- Häppchen: short, varied cards for the train – games, stories, looking, short knowledge, some quiz; no AI
async function snackStats() { return (await loadState("progress", { theory: {} })).snacks || { total: 0, right: 0, rounds: 0, last: {} }; }
const SEG_ICON = { order: "⏳", crop: "🔍", tf: "✓✗", look: "👁", pair: "⇆", story: "📖", quote: "❝", sketch: "✎", merke: "★", pinfo: "◉", concept: "◇",
  memory: "◐", tiles: "▦", mirror: "⇋", guess: "≈", stamp: "▪", blitz: "⚡", hand: "✍", odd: "◌", zoomout: "⤢", tone: "◑", zone: "▤", edge: "⌗", change: "Δ",
  fmt: "▭", myth: "?!", anec: "✦", womit: "⚙", tlook: "⚙", contact: "▦", sheet: "▤", version: "⇆", bookseq: "☷", mistake: "✗", allok: "☑", qimg: "❝", srcimg: "⌕", aspect: "◎", voices: "☰", match: "⇄", cquote: "◇", skline: "✎", place: "⌖", task: "➜", who: "?", year: "#", chap: "§", ref: "❞", quiz: "?" };
views.kurz = async () => {
  const st = await snackStats(), open = sess.get("snack");
  const wrongN = Object.values(st.last || {}).filter(v => v === 0).length;
  return `<h1>Häppchen</h1><p class="lead">Fünf Minuten in der Bahn: Zeitreisen, Ausschnitte, Bilder aus dem Gedächtnis, O-Töne, Making-ofs, Bildpaare, Mini-Lektionen – und ab und zu eine Frage. Alles aus belegten Inhalten, ohne Wartezeit.</p>
  ${open && open.pos < open.cards.length ? `<p><a class="button" href="#/kurz/karte">Runde fortsetzen (${open.pos + 1}/${open.cards.length})</a></p>` : ""}
  <form data-action="snack-start" class="card snack-start">
    <div class="pills">${TOPICS.map(([k, l], n) => `<label class="pill"><input type="radio" name="topic" value="${k}" ${n ? "" : "checked"}><span>${l}</span></label>`).join("")}</div>
    <div class="pills">${[8, 15].map((n, i) => `<label class="pill"><input type="radio" name="size" value="${n}" ${i ? "" : "checked"}><span>${n} Karten</span></label>`).join("")}</div>
    <button class="big">Los</button></form>
  <div class="seg-list">${Object.entries(SEGMENTS).filter(([, v]) => !v.quiz).map(([k, v]) => `<span><i>${SEG_ICON[k]}</i>${v.name}</span>`).join("")}</div>
  ${st.total ? `<p class="muted small">Bisher ${st.total} Antworten, ${Math.round(100 * st.right / st.total)} % richtig · ${st.rounds} Runden${wrongN ? ` · ${wrongN} Karten kommen wieder` : ""}</p>` : ""}`;
};
const mdInline = t => md(t).replace(/^<p>|<\/p>$/g, "");
function snackBody(card, res, st) {
  const done = res != null, okText = r => r ? `<p class="ok"><b>Richtig.</b></p>` : `<p class="warn"><b>Nicht ganz.</b></p>`;
  const after = (inner = "") => `<div class="snack-explain prose">${inner}<p class="small"><a href="${card.link[0]}">${esc(card.link[1])} →</a></p></div>`;
  const hero = id => `<figure class="snack-img">${media(id, "m")}</figure>`;
  switch (card.kind) {
    case "mc": {
      if (card.preview && !done && !st.memo?.[st.pos]) return `<figure class="snack-img tall">${media(card.image, "m")}</figure>
        <p class="snack-q">Präg dir das Bild ein – gleich verändert die App etwas daran.</p><div class="memo-bar"><i style="animation-duration:${card.preview}s"></i></div>
        <button class="big secondary reveal-btn" data-action="snack-memo">Weiter</button>`;
      const zs = card.zoom ? Math.min(st.zoom?.[st.pos] || 0, card.zoom.steps.length - 1) : 0;
      const top = card.preview ? (done ? `<div class="snack-pair"><figure>${media(card.image, "m")}<figcaption class="small muted">Original</figcaption></figure><figure class="clip">${imgS(card.image, card.variant)}<figcaption class="small muted">Verändert</figcaption></figure></div>`
          : `<figure class="snack-img clip">${imgS(card.image, card.variant)}</figure>`)
        : card.zoom ? (done ? hero(card.zoom.id) : `<figure class="snack-crop">${imgS(card.zoom.id, `object-position:${card.zoom.x}% ${card.zoom.y}%;transform-origin:${card.zoom.x}% ${card.zoom.y}%;transform:scale(${card.zoom.steps[zs]})`)}</figure>
          ${zs < card.zoom.steps.length - 1 ? `<p><button class="secondary" data-action="snack-zoom">Weiter herauszoomen (${zs + 1}/${card.zoom.steps.length})</button></p>` : ""}`)
        : card.sketch ? `<figure class="sketch">${lib.sketches[card.sketch]}</figure>`
        : card.quote ? `${card.image ? `<figure class="snack-img small">${media(card.image, "m")}</figure>` : ""}<blockquote class="snack-quote small">„${esc(card.quote)}“</blockquote>${card.quote_de ? `<p class="muted small">Übersetzung: ${esc(card.quote_de)}</p>` : ""}` : "";
      const two = card.options.length === 2;
      return `${top}${card.crop ? `<figure class="snack-crop"><img data-media="${esc(card.crop.id)}" data-kind="m" alt="" style="object-position:${card.crop.x}% ${card.crop.y}%;transform-origin:${card.crop.x}% ${card.crop.y}%;transform:scale(${card.crop.zoom})"></figure>`
        : card.image && card.tiles && !done ? `<figure class="snack-img tiles">${media(card.image, "m")}<div class="tile-cover">${card.tileOrder.map(k => `<i style="animation-delay:${0.4 + 0.55 * k}s"></i>`).join("")}</div></figure>`
        : card.image && !top ? hero(card.image) : ""}
      ${card.situation_md ? `<div class="prose small">${md(card.situation_md)}</div>` : ""}<h2 class="snack-q">${mdInline(card.prompt)}</h2>
      <div class="snack-opts${card.options[0].image ? " thumbs3" : ""}" style="--n:${card.options.length}">${card.options.map((o, k) => `<button class="opt${done ? (o.correct ? " right" : k === res ? " wrong" : " dim") : ""}" data-action="snack-answer" data-i="${k}" ${done ? "disabled" : ""}>
        ${o.image ? `${o.flip ? `<span class="flip">${media(o.image, two ? "m" : undefined)}</span>` : o.zoomCrop ? `<span class="clip">${imgS(o.image, `transform-origin:${o.zoomCrop.x}% ${o.zoomCrop.y}%;transform:scale(${o.zoomCrop.s})`, two ? "m" : "t")}</span>` : two ? media(o.image, "m") : media(o.image)}${done ? `<span>${esc(o.text)}</span>` : ""}` : mdInline(o.text)}</button>`).join("")}</div>
      ${done ? after(okText(card.options[res]?.correct) + (card.zoom ? `<p class="small muted">Geantwortet bei Zoomstufe ${zs + 1} von ${card.zoom.steps.length}.</p>` : "") + md(card.explain_md)) : ""}`; }
    case "tf": if (card.memorize && !done && !st.memo?.[st.pos]) return `<figure class="snack-img tall">${media(card.image, "m")}</figure>
        <p class="snack-q">Präg dir das Bild ein – gleich ist es weg.</p><div class="memo-bar"><i style="animation-duration:${card.memorize}s"></i></div>
        <button class="big secondary reveal-btn" data-action="snack-memo">Hab's – Bild ausblenden</button>`;
      return `${card.memorize && !done ? `<div class="memo-gone">Bild ausgeblendet</div>` : card.images ? `<div class="snack-pair">${card.images.map(id => `<figure>${media(id, "m")}</figure>`).join("")}</div>` : card.image ? hero(card.image) : ""}<p class="muted small">${esc(card.prompt)}</p><blockquote class="snack-statement">${esc(card.statement)}</blockquote>
      <div class="tf-btns"><button class="opt${done ? (card.truth ? " right" : res === 1 ? " wrong" : " dim") : ""}" data-action="snack-tf" data-v="1" ${done ? "disabled" : ""}>${card.tfLabels ? esc(card.tfLabels[0]) : "✓ Stimmt"}</button>
        <button class="opt${done ? (!card.truth ? " right" : res === 0 ? " wrong" : " dim") : ""}" data-action="snack-tf" data-v="0" ${done ? "disabled" : ""}>${card.tfLabels ? esc(card.tfLabels[1]) : "✗ Stimmt nicht"}</button></div>
      ${done ? after(okText(res === (card.truth ? 1 : 0)) + md(card.explain_md)) : ""}`;
    case "order": { const picked = Array.isArray(res) ? res : [], full = picked.length === card.items.length;
      return `<h2 class="snack-q">${esc(card.prompt)}</h2><div class="order-grid">${card.items.map((it, k) => { const pos = picked.indexOf(k);
        return `<button class="order-item${pos >= 0 ? " picked" : ""}${full ? (card.solution[pos] === k ? " right" : " wrong") : ""}" data-action="snack-order" data-k="${k}" ${pos >= 0 || full ? "disabled" : ""}>
          ${media(it.id)}${pos >= 0 ? `<b class="order-n">${pos + 1}</b>` : ""}${full ? `<span>${it.label ? esc(it.label) : `${it.year} · ${esc(it.who)}`}</span>` : ""}</button>`; }).join("")}</div>
        ${full ? after(okText(picked.every((v, k) => v === card.solution[k])) + `${card.items[0].label ? `<p>Richtig ist: ${card.solution.map(k => `<b>${esc(card.items[k].label)}</b>`).join(" → ")}</p>${md(card.explain_md || "")}` : `<p>Richtig ist: ${card.solution.map(k => `<b>${card.items[k].year}</b> ${esc(card.items[k].who)}`).join(" → ")}</p>`}`) : picked.length ? `<p class="muted small">Weiter tippen …</p>` : ""}`; }
    case "look": { const t0 = (st.lookStart ||= {})[st.pos] ||= Date.now(), left = Math.max(0, card.seconds - Math.floor((Date.now() - t0) / 1000));
      return `<figure class="snack-img tall">${media(card.image, "m")}</figure>
        ${done ? `<div class="snack-explain prose"><p class="small muted">${mdInline(card.caption_md)}</p>${md(card.fact_md)}<p class="small"><a href="${card.link[0]}">${esc(card.link[1])} →</a></p></div>`
          : `<p class="snack-q">${esc(card.prompt)}</p><div class="look-timer"><b id="snack-timer" data-left="${left}">${left}</b> s <button class="secondary" data-action="snack-reveal">Auflösen</button></div>`}`; }
    case "swipe2": { const got = Array.isArray(res) ? res : [], k = got.length, n = card.items.length;
      const dots = `<div class="blitz-dots">${card.items.map((it, j) => `<i class="${j < k ? (got[j] === it.side ? "ok" : "bad") : j === k ? "cur" : ""}"></i>`).join("")}</div>`;
      if (k < n) { const prev = k ? got[k - 1] === card.items[k - 1].side : null;
        return `<p class="snack-q">${esc(card.prompt)}</p>${dots}<figure class="snack-img blitz-img" data-blitz>${media(card.items[k].id, "m")}</figure>
          <p class="small blitz-fb ${prev == null ? "" : prev ? "ok" : "warn"}">${prev == null ? "&nbsp;" : prev ? "✓ richtig" : `✗ war ${esc(card.bins[card.items[k - 1].side])}`}</p>
          <div class="tf-btns"><button class="opt" data-action="snack-bin" data-v="0">← ${esc(card.bins[0])}</button><button class="opt" data-action="snack-bin" data-v="1">${esc(card.bins[1])} →</button></div>`; }
      const right = got.filter((v, j) => v === card.items[j].side).length;
      return `<p class="snack-q">${right} von ${n} richtig</p>${dots}<div class="order-grid">${card.items.map((it, j) => `<div class="order-item ${got[j] === it.side ? "right" : "wrong"}">${media(it.id)}<span>${esc(card.bins[it.side])}</span></div>`).join("")}</div>
        ${after(okText(isRight(card, res)) + md(card.explain_md))}`; }
    case "multi": { const sel = done ? res : (st.sel?.[st.pos] || []);
      return `${hero(card.image)}<h2 class="snack-q">${esc(card.prompt)}</h2><div class="chips">${card.options.map((o, k) => `<button class="chip${sel.includes(k) ? " on" : ""}${done ? (o.correct ? " right" : sel.includes(k) ? " wrong" : " dim") : ""}" data-action="snack-toggle" data-i="${k}" ${done ? "disabled" : ""}>${esc(o.text)}</button>`).join("")}</div>
        ${done ? after(okText(isRight(card, res)) + `<p class="small muted">Grün umrandet = laut Quelle zutreffend.</p>` + md(card.explain_md)) : `<button class="big" data-action="snack-check" ${sel.length ? "" : "disabled"}>Prüfen</button>`}`; }
    case "assign": { const sel = done ? res : (st.sel?.[st.pos] || []);
      return `${card.image ? `<figure class="snack-img small">${media(card.image, "m")}</figure>` : ""}<h2 class="snack-q">${esc(card.prompt)}</h2>
        ${card.rows.map((row, k) => `<div class="assign-row"><p>${card.type === "voices" ? `„${esc(row.text)}“` : esc(row.text)}</p><div class="chips">${card.labels.map((l, n) => `<button class="chip${sel[k] === n ? " on" : ""}${done ? (l === row.answer ? " right" : sel[k] === n ? " wrong" : " dim") : ""}" data-action="snack-assign" data-row="${k}" data-i="${n}" ${done ? "disabled" : ""}>${esc(l)}</button>`).join("")}</div>${done && row.note ? `<p class="small muted">– ${esc(row.note)}</p>` : ""}</div>`).join("")}
        ${done ? after(okText(isRight(card, res)) + md(card.explain_md || "")) : `<button class="big" data-action="snack-check" ${card.rows.every((_, k) => sel[k] != null) ? "" : "disabled"}>Prüfen</button>`}`; }
    case "tone": { const m = st.tone?.[st.pos], pts = m ? (card.mode === "pair" ? [m.a, m.b] : [m.a]) : [];
      const fig = `<figure class="snack-img tone-fig${done ? "" : " gray"}"><span class="tone-wrap">${media(card.image, "m")}${pts.map((pt, n) => `<b class="tone-pt" style="left:${pt.x}%;top:${pt.y}%">${card.mode === "pair" ? "AB"[n] : ""}</b>`).join("")}</span></figure>`;
      if (!m) return `${fig}<p class="muted small">Bild wird vermessen …</p>`;
      const zoneOf = L => Math.round(L / 10), info = pt => `Zone ${zoneOf(pt.L)} (L* ${Math.round(pt.L)})`;
      if (!done) return `${fig}<h2 class="snack-q">${esc(card.prompt)}</h2>${card.mode === "pair"
        ? `<div class="tf-btns"><button class="opt" data-action="snack-tone" data-v="0">A ist heller</button><button class="opt" data-action="snack-tone" data-v="1">B ist heller</button></div>`
        : `<div class="year-guess"><output id="snack-year-out">5</output><input type="range" id="snack-year" min="0" max="10" step="1" value="5"><div class="year-scale"><span>0 Schwarz</span><span>10 Weiß</span></div></div><button class="big" data-action="snack-zone">Tippen</button>`}`;
      return `${fig}<h2 class="snack-q">${esc(card.prompt)}</h2>
        <div class="year-result">${card.mode === "pair" ? `<span>A: <b>${info(m.a)}</b></span><span>B: <b>${info(m.b)}</b></span>` : `<span>Dein Tipp <b>Zone ${res.pick}</b></span><span>Gemessen <b>${info(m.a)}</b></span>`}</div>
        ${after(okText(res.ok) + `<p class="small muted">Gemessen an der Bildschirmfassung (Helligkeit L* ÷ 10 als Zone, Näherung – nicht der Abzug).${card.mode === "zone" ? " Richtig bei höchstens einer Zone Abstand." : ""}</p>` + md(card.explain_md))}`; }
    case "fmt": return `${done ? hero(card.image) : `<figure class="snack-crop square">${media(card.image, "m")}</figure>`}<h2 class="snack-q">${esc(card.prompt)}</h2>
      <div class="snack-opts">${card.options.map((o, k) => `<button class="opt${done ? (k === res.truth ? " right" : k === res.pick ? " wrong" : " dim") : ""}" data-action="snack-fmt" data-i="${k}" ${done ? "disabled" : ""}>${esc(o.text)}</button>`).join("")}</div>
      ${done ? after(okText(res.ok) + `<p>Original: ${res.portrait ? "Hochformat" : "Querformat"}, Seitenverhältnis ${res.ratio.toFixed(2).replace(".", ",")} : 1.</p>` + md(card.explain_md)) : ""}`;
    case "slider": { const mid = Math.round((card.min + card.max) / 2 / 5) * 5;
      if (!done) return `${hero(card.image)}<h2 class="snack-q">${esc(card.prompt)}</h2>
        <div class="year-guess"><output id="snack-year-out">${mid}</output><input type="range" id="snack-year" min="${card.min}" max="${card.max}" step="1" value="${mid}">
        <div class="year-scale"><span>${card.min}</span><span>${card.max}</span></div></div>
        <button class="big" data-action="snack-guess">Tippen</button>`;
      const off = Math.abs(res - card.year);
      return `${hero(card.image)}<h2 class="snack-q">${esc(card.prompt)}</h2>
        <div class="year-result"><span>Dein Tipp <b>${res}</b></span><span>Tatsächlich <b>${card.year}</b></span></div>
        ${after(`<p class="${off <= card.tolerance ? "ok" : "warn"}"><b>${off === 0 ? "Volltreffer." : off <= card.tolerance ? `Richtig – ${off} ${off === 1 ? "Jahr" : "Jahre"} daneben.` : off <= 15 ? `Nah dran – ${off} Jahre daneben.` : `${off} Jahre daneben.`}</b></p>` + md(card.explain_md))}`; }
    case "reveal": return `${card.stamp && !done ? `<div class="snack-stamp">${media(card.stamp)}</div>` : ""}${card.image ? hero(card.image) : ""}${card.sheet ? `<figure class="snack-img tall">${media(card.sheet, "m")}</figure>` : ""}${card.situation_md ? `<div class="prose small">${md(card.situation_md)}</div>` : ""}${card.quote ? `<blockquote class="snack-quote">„${esc(card.quote)}“</blockquote>` : ""}
      ${card.images ? `<div class="snack-pair">${card.images.map(id => `<figure>${media(id, "m")}</figure>`).join("")}</div>` : ""}
      <h2 class="snack-q">${esc(card.prompt)}</h2>
      ${done ? `<div class="snack-explain prose">${card.back_image ? hero(card.back_image) : ""}${md(card.back_md)}${card.caption_md ? `<p class="small muted">${mdInline(card.caption_md)}</p>` : ""}<p class="small"><a href="${card.link[0]}">${esc(card.link[1])} →</a></p></div>`
        : `<button class="big secondary reveal-btn" data-action="snack-reveal">Auflösen</button>`}`;
    case "story": { const step = typeof res === "number" ? res : 0, last = step >= card.slides.length;
      return `${hero(card.image)}<p class="small muted">${mdInline(card.prompt)}</p>
        <div class="story-dots">${card.slides.map((_, k) => `<i class="${k < step ? "on" : ""}"></i>`).join("")}</div>
        ${card.slides.slice(0, step).map(sl => `<div class="story-slide"><h3>${esc(sl.title)}</h3>${md(sl.md)}</div>`).join("")}
        ${last ? `<p class="small"><a href="${card.link[0]}">${esc(card.link[1])} →</a></p>` : `<button class="big secondary reveal-btn" data-action="snack-step">${step ? "Und dann?" : "Wie entstand es?"} (${step + 1}/${card.slides.length})</button>`}`; }
    case "info": return `${card.sketch ? `<figure class="sketch">${lib.sketches[card.sketch]}</figure>` : card.portrait ? `<figure class="snack-img portrait"><img data-media="${esc(card.portrait)}" data-kind="p" alt=""></figure>` : card.image ? hero(card.image) : ""}
      <h2 class="snack-q">${esc(card.title)}</h2>${card.big ? `<p class="snack-big">${mdInline(card.big)}</p>` : ""}
      <div class="prose">${md(card.body_md)}</div>${card.thumbs?.length ? `<div class="thumbs mini">${card.thumbs.map(id => `<a class="thumb" href="#/bild/${id}">${media(id)}</a>`).join("")}</div>` : ""}
      <p class="small"><a href="${card.link[0]}">${esc(card.link[1])} →</a></p>`;
  }
  return "";
}
const snackDone = (card, res) => card.kind === "info" || (card.kind === "swipe2" ? Array.isArray(res) && res.length === card.items.length : card.kind === "story" ? res >= card.slides.length : card.kind === "order" ? Array.isArray(res) && res.length === card.items.length : res != null);
views.kurzKarte = async () => {
  const st = sess.get("snack");
  if (!st) { location.hash = "#/kurz"; return ""; }
  if (st.pos >= st.cards.length) return snackEnd(st);
  const c = st.cards[st.pos], card = buildCard(c), res = st.results[st.pos];
  if (!card) { st.pos++; sess.set("snack", st); return views.kurzKarte(); }
  const done = snackDone(card, res), nx = st.cards[st.pos + 1] && buildCard(st.cards[st.pos + 1]);
  const body = snackBody(card, res, st);
  sess.set("snack", st); // keeps the look timer's start time
  clearTimeout(snackTimer); if (card.kind === "look" && !done) snackTimer = setTimeout(snackTick, 1000);
  if ((card.memorize || card.preview) && !done && !st.memo?.[st.pos]) snackTimer = setTimeout(() => actions["snack-memo"](), (card.memorize || card.preview) * 1000);
  if (card.kind === "tone" && !st.tone?.[st.pos]) snackTimer = setTimeout(() => measureTone(st.pos, card), 250);
  return compactRefs(`<div class="snack snack-${card.kind}" data-swipe="${done ? "next" : ""}">
    <div class="snack-top"><span class="seg"><i>${SEG_ICON[card.type] || ""}</i>${esc(card.label)}</span><span class="snack-count">${st.pos + 1}/${st.cards.length}</span></div>
    <div class="snack-bar"><i style="width:${100 * st.pos / st.cards.length}%"></i></div>
    ${body}
    ${done ? `<div class="snack-next"><button class="big" data-action="snack-next">${st.pos + 1 < st.cards.length ? "Weiter →" : "Ergebnis"}</button></div>` : ""}
    ${nx && (nx.image || nx.crop || nx.zoom || nx.items) ? `<img data-media="${esc(nx.image || nx.crop?.id || nx.zoom?.id || nx.items[0].id)}" data-kind="m" class="preload" alt="">` : ""}</div>`, new Map());
};
let snackTimer = null;
const imgS = (id, style, kind = "m") => `<img data-media="${esc(id)}" data-kind="${kind}" alt="" style="${style}">`;
// Tonal values of the shown image: luminance → CIE L* (0–100), zone ≈ L*/10. Picks points deterministically from the card's candidates.
function measureTone(pos, card, tries = 0) {
  const st = sess.get("snack"), el = document.querySelector(".tone-fig img");
  if (!st || st.pos !== pos || location.hash !== "#/kurz/karte") return;
  if (!el || !el.complete || !el.naturalWidth) { if (tries < 60) snackTimer = setTimeout(() => measureTone(pos, card, tries + 1), 200); return; }
  const w = 240, h = Math.round(w * el.naturalHeight / el.naturalWidth), cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(el, 0, 0, w, h);
  const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const Lstar = ([x, y]) => { const d = cx.getImageData(Math.max(0, Math.round(x / 100 * w) - 2), Math.max(0, Math.round(y / 100 * h) - 2), 5, 5).data; let Y = 0;
    for (let i = 0; i < d.length; i += 4) Y += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    Y /= d.length / 4; return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; };
  const pts = card.pts.map(pt => ({ x: pt[0], y: pt[1], L: Lstar(pt) }));
  let pick = null;
  if (card.mode === "pair") { for (let i = 0; i < pts.length && !pick; i++) for (let j = i + 1; j < pts.length && !pick; j++) { const d = Math.abs(pts[i].L - pts[j].L); if (d >= 10 && d <= 30) pick = { a: pts[i], b: pts[j] }; }
    pick ||= { a: pts[0], b: pts.reduce((m, p) => Math.abs(p.L - pts[0].L) > Math.abs(m.L - pts[0].L) ? p : m, pts[1]) }; }
  else pick = { a: pts.find(p => p.L > 8 && p.L < 95) || pts[0] };
  (st.tone ||= {})[pos] = pick; sess.set("snack", st); route(true);
}
document.addEventListener("input", e => { if (e.target.id === "snack-year") document.getElementById("snack-year-out").textContent = e.target.value; });
function snackTick() {
  const el = document.getElementById("snack-timer"); if (!el) return;
  const left = Number(el.dataset.left) - 1;
  if (left <= 0) return actions["snack-reveal"]();
  el.dataset.left = left; el.textContent = left; snackTimer = setTimeout(snackTick, 1000);
}
function snackEnd(st) {
  const scored = st.cards.map((c, i) => [c, buildCard(c), st.results[i]]).filter(([, k]) => k?.scored && !["reveal", "info", "story", "look"].includes(k.kind));
  const right = scored.filter(([, k, r]) => isRight(k, r)).length, wrong = scored.filter(([, k, r]) => !isRight(k, r));
  const seen = st.cards.length - scored.length;
  return `<h1>Runde geschafft</h1><div class="stats"><span><b>${right}</b>/${scored.length} richtig</span>${seen ? `<span><b>${seen}</b> Geschichten, Bilder und Wissenskarten</span>` : ""}</div>
  ${wrong.length ? `<h3>Zum Nachlesen</h3><ul class="snack-wrong">${wrong.map(([, k]) => { const im = k.image || k.crop?.id || k.items?.[0]?.id;
    return `<li>${im ? `<a href="${k.link[0]}">${media(im)}</a>` : ""}<div><span class="muted small">${esc(k.label)}</span><br>${k.kind === "mc" ? mdInline(k.options.find(o => o.correct).text) : k.kind === "multi" ? k.options.filter(o => o.correct).map(o => esc(o.text)).join(" · ") : k.kind === "assign" ? k.rows.map(r => esc(r.answer)).join(" · ")
      : k.kind === "swipe2" ? `${esc(k.bins[0])} oder ${esc(k.bins[1])}` : k.kind === "tone" || k.kind === "fmt" ? esc(k.prompt) : k.kind === "tf" ? (k.truth ? "Stimmt: " : "Stimmt nicht: ") + esc(k.statement) : k.kind === "slider" ? `Entstanden ${k.year}` : "Reihenfolge: " + k.solution.map(x => k.items[x].label || k.items[x].year).join(" → ")} <a href="${k.link[0]}">→</a></div></li>`; }).join("")}</ul>
    <p class="muted small">Diese Karten kommen in einer der nächsten Runden wieder.</p>` : scored.length ? `<p class="ok">Alles richtig.</p>` : ""}
  <p><button class="big" data-action="snack-again">Noch eine Runde</button> <a href="#/kurz">Thema wechseln</a></p>`;
}

// --- concepts
views.begriffe = async () => `<h1>Seh-Begriffe</h1>
  <p class="lead">Begriffe, mit denen Fotografen und Kuratoren über Bilder sprechen – mit Quelle, Beispielbildern und einer Übung für unterwegs.</p>
  ${DIMENSIONS.filter(d => lib.concepts.some(c => c.dimension === d.key)).map(d => `<h2>${d.label}</h2><ul class="concept-list">
    ${lib.concepts.filter(c => c.dimension === d.key).map(c => `<li><a href="#/begriffe/${c.id}">${esc(c.name)}</a><span class="muted small">${esc((c.exercise_md || "").slice(0, 140))}</span></li>`).join("")}</ul>`).join("")}`;

views.begriff = async id => {
  const c = lib.by.concepts.get(id); if (!c) return `<p class="muted">Nicht gefunden.</p>`;
  const d = DIM[c.dimension];
  return `<p class="crumbs"><a href="#/begriffe">Seh-Begriffe</a>${d ? ` › ${d.label}` : ""}</p><h1>${esc(c.name)}</h1>
  <div class="two-col wide-left"><div>
    ${c.summary_md ? `<div class="prose">${md(c.summary_md)}</div>` : `<p class="muted">Keine Quelle hinterlegt.</p>`}
    ${c.exercise_md ? `<h3>Übung für unterwegs</h3><div class="prose exercise">${md(c.exercise_md)}</div>` : ""}
    ${d?.field ? `<p><button class="secondary" data-action="drill-quick" data-dim="${d.key}">Sehübung „${d.label}“ starten</button></p>` : ""}
    ${c.images.length ? `<h3>Beispiele</h3>${c.images.map(e => { const i = lib.by.images.get(e.id); return i ? `<figure class="key-image left"><a href="#/bild/${i.id}">${media(i.id, "m")}</a>
      <figcaption>${esc(photographerOf(i).name)}${i.year ? `, ${i.year}` : ""} – ${esc(i.title)}${e.note ? `<div class="small"><b>Meine Einschätzung:</b> ${esc(e.note)}</div>` : ""}</figcaption></figure>` : ""; }).join("")}` : ""}
  </div><div>${sourcesBlock(sourcesFor("concept", c.id))}</div></div>`;
};

// --- library
views.bibliothek = async params => {
  const tag = params.get("tag") || "", ph = params.get("fotograf") || "";
  let rows = lib.images.filter(i => (!tag || (i.tags || []).includes(tag)) && (!ph || i.photographer_id === ph));
  rows = rows.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  return `<h1>Bibliothek <span class="muted">${rows.length} Bilder</span></h1>
  <div class="tags"><a href="#/bibliothek" class="tag ${tag ? "" : "on"}">alle</a>${allTags().map(t => `<a href="#/bibliothek?tag=${encodeURIComponent(t)}" class="tag ${t === tag ? "on" : ""}">${esc(t)}</a>`).join("")}</div>
  ${thumbs(rows)}<p><a class="button secondary" href="#/neu">Bild hinzufügen</a></p>`;
};

views.fotografen = async () => `<h1>Fotografen</h1><table class="list"><thead><tr><th>Name</th><th>Lebensdaten</th><th>Bilder</th></tr></thead><tbody>
  ${lib.photographers.map(p => `<tr><td><a href="#/fotograf/${p.id}">${esc(p.name)}</a></td><td>${p.born ? `${p.born}–${p.died || ""}` : ""}</td>
  <td>${lib.images.filter(i => i.photographer_id === p.id).length}</td></tr>`).join("")}</tbody></table>`;

views.fotograf = async id => {
  const p = lib.by.photographers.get(id); if (!p) return `<p class="muted">Nicht gefunden.</p>`;
  const projects = lib.projects.filter(r => r.photographer_id === id);
  return `<h1>${esc(p.name)} ${p.born ? `<span class="muted">(${p.born}–${p.died || ""})</span>` : ""}</h1>
  <div class="artist big">${p.portrait ? `<img data-media="${esc(p.id)}" data-kind="p" class="portrait" alt="">` : ""}<div>
    ${p.bio_md ? `<div class="prose">${md(p.bio_md)}</div>` : `<p class="muted">Noch kein Kurztext – Grundlage sind die Quellen unten.</p>`}
    ${p.method_md ? `<h3>Arbeitsweise</h3><div class="prose">${md(p.method_md)}</div>` : ""}
    ${p.signature_md ? `<h3>Handschrift <span class="muted small">(Einschätzung)</span></h3><div class="prose">${md(p.signature_md)}</div>` : ""}
    ${lib.lessons.filter(l => (l.photographers || []).includes(p.id)).map(l => `<p><a href="#/theorie/${l.id}" class="tag">Lektion: ${esc(l.title)}</a></p>`).join("")}
    ${p.portrait?.credit ? `<p class="muted tiny">Porträt: ${esc(p.portrait.credit)}${p.portrait.source_url ? ` · <a href="${esc(p.portrait.source_url)}" target="_blank" rel="noopener noreferrer">Quelle</a>` : ""}</p>` : ""}</div></div>
  <div class="two-col"><div><h3>Projekte</h3><ul>${projects.map(r => `<li><a href="#/projekt/${r.id}">${esc(r.title)}</a> <span class="muted">${period(r)}</span></li>`).join("")}</ul></div>
  <div>${sourcesBlock(sourcesFor("photographer", id), { scope: "photographer", scopeId: id, editable: true })}</div></div>
  <h2>Bilder</h2>${thumbs(lib.images.filter(i => i.photographer_id === id))}`;
};
const period = r => r.year_from && r.year_to && r.year_from !== r.year_to ? `${r.year_from}–${r.year_to}` : (r.year_from || r.year_to || "");

views.projekt = async id => {
  const r = lib.by.projects.get(id); if (!r) return `<p class="muted">Nicht gefunden.</p>`;
  const p = lib.by.photographers.get(r.photographer_id);
  return `<p class="crumbs"><a href="#/fotograf/${p.id}">${esc(p.name)}</a> ›</p><h1>${esc(r.title)} <span class="muted">${period(r)}</span></h1>
  ${sourcesBlock(sourcesFor("project", id), { scope: "project", scopeId: id, editable: true })}
  <h2>Bilder</h2>${thumbs(lib.images.filter(i => i.project_id === id))}`;
};

views.bild = async id => {
  const img = lib.by.images.get(id); if (!img) return `<p class="muted">Nicht gefunden.</p>`;
  const p = photographerOf(img), r = projectOf(img), an = await currentAnalysis(id);
  const inCh = lib.chapters.filter(c => (c.images || []).includes(id));
  return `<p class="crumbs"><a href="#/fotograf/${p.id}">${esc(p.name)}</a> › ${r ? `<a href="#/projekt/${r.id}">${esc(r.title)}</a> ›` : ""}</p>
  <h1>${esc(img.title || "Ohne Titel")}</h1>
  <figure class="hero">${media(id, "m")}<figcaption>${esc(p.name)}${img.year ? `, ${img.year}` : ""}${img.location ? ` · ${esc(img.location)}` : ""}
    · <a href="${esc(img.source_url)}" target="_blank" rel="noopener noreferrer">Quelle</a> <span class="muted">(abgerufen ${fmtDate(img.accessed_at)})</span>
    ${(img.tags || []).map(t => `<a class="tag" href="#/bibliothek?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}
    ${inCh.map(c => `<a class="tag chapter" href="#/kapitel/${c.id}">Kap. ${c.number}</a>`).join("")}</figcaption></figure>
  ${await myHistory(img)}
  <div class="two-col wide-left"><div>${expertsBlock(img)}<h2>Analyse <span class="muted small">(KI)</span></h2><div id="analysis">${analysisPanel(img, an)}</div>
    ${await discussionBlock(img)}</div>
  <div>${artistCard(p)}${sourcesBlock(sourcesForImage(img), { scope: "image", scopeId: id, editable: true })}
    <p class="muted small">Angezeigt werden Quellen zu Bild, Projekt und Fotograf.</p></div></div>`;
};
const analysisPanel = (img, an) => an ? `${analysisBody(an.data)}
  <p class="meta muted">Version ${an.version} · ${esc(an.model)} · ${esc(an.prompt_version)} · ${fmtDate(an.created_at)}${an.version > 1 ? ` · <a href="#/bild/${img.id}/versionen">frühere Versionen</a>` : ""}</p>
  ${objectionBlock(img, an)}
  <button class="secondary" data-action="analyze" data-img="${img.id}" data-regen="1">Neu erzeugen …</button><span class="busy">KI analysiert … (1–2 Minuten)</span>`
  : `<p class="muted">Noch keine Analyse.</p><button data-action="analyze" data-img="${img.id}">Analyse erzeugen</button><span class="busy">KI analysiert … (1–2 Minuten)</span>`;

views.versionen = async id => {
  const img = lib.by.images.get(id); const list = ((await analyses())[id] || []).slice().reverse();
  return `<p class="crumbs"><a href="#/bild/${id}">${esc(img.title || "Bild")}</a> ›</p><h1>Analyse-Versionen</h1>
  ${list.map((a, i) => `<details class="card" ${i ? "" : "open"}><summary>Version ${a.version} · ${fmtDate(a.created_at)} · ${esc(a.model)} · ${esc(a.prompt_version)}${i ? "" : " · <b>aktuell</b>"}</summary>${analysisBody(a.data)}</details>`).join("")}
  ${sourcesBlock(sourcesForImage(img), { scope: "image" })}`;
};

views.neu = async () => `<h1>Bild hinzufügen</h1>
  <form data-action="add-image" class="grid-form card">
    <label class="wide">Seiten-URL (Quelle) * <input type="url" name="source_url" required></label>
    <label class="wide">Bilddatei * (Screenshot oder Download) <input type="file" name="file" accept="image/*" required></label>
    <label>Fotograf * <input name="photographer" list="phs" required></label><datalist id="phs">${lib.photographers.map(p => `<option value="${esc(p.name)}">`).join("")}</datalist>
    <label>Projekt <input name="project" list="prs"></label><datalist id="prs">${lib.projects.map(r => `<option value="${esc(r.title)}">`).join("")}</datalist>
    <label>Titel <input name="title"></label><label>Jahr <input name="year" inputmode="numeric"></label>
    <label>Ort <input name="location"></label><label>Schlagworte (kommagetrennt) <input name="tags"></label>
    <p class="muted wide">Jahr, Ort und Titel nur eintragen, wenn sie auf der Quellseite stehen. Das Bild wird verkleinert und verschlüsselt gespeichert.</p>
    <button>Speichern</button><span class="busy">Wird verschlüsselt und hochgeladen …</span></form>`;

// --- learning round
views.lernen = async () => {
  const answers = await loadState("answers", []), prog = await theoryProgress();
  const missing = LEARN_ROUND_REQUIRES.filter(k => !isUnlocked(prog, k));
  if (missing.length) return `<h1>Lernrunde</h1><p class="lead">Die Lernrunde fragt Standpunkt, Moment und Weglassen ab – dafür zuerst diese Lektionen abschließen:</p>
    <ul>${missing.map(k => `<li><a href="#/theorie/${k}">${esc(lib.by.lessons.get(k)?.title || DIM[k].label)}</a></li>`).join("")}</ul>`;
  const sourcedImgs = lib.images.filter(i => Object.keys(learnRefs(i.id)).length).length;
  return `<h1>Lernrunde</h1><p class="lead">Ein Bild, vier Fragen und eine wechselnde fünfte. Die Referenzen bleiben verborgen, bis du geantwortet hast.</p>
  <form data-action="learn-start" class="card grid-form"><fieldset class="wide"><legend>Auswahl</legend>
    <label class="radio"><input type="radio" name="mode" value="random" checked> zufällig</label>
    <label class="radio"><input type="radio" name="mode" value="tag"> nach Schlagwort <select name="tag">${allTags().map(t => `<option>${esc(t)}</option>`).join("")}</select></label>
    <label class="radio"><input type="radio" name="mode" value="chapter"> nach Kapitel <select name="chapter">${lib.chapters.map(c => `<option value="${c.id}">${c.number}. ${esc(c.title)}</option>`).join("")}</select></label></fieldset>
    <label>Erst schauen <select name="look">${LOOK_CHOICES.map(s => `<option value="${s}" ${s === 60 ? "selected" : ""}>${s ? s + " Sekunden" : "ohne Timer"}</option>`).join("")}</select></label>
    <label class="check wide"><input type="checkbox" name="sourced" ${sourcedImgs ? "checked" : ""}> Nur Bilder mit Quellenreferenz (empfohlen, ${sourcedImgs} Bilder) <span class="muted small">– Standpunkt, Moment und Weglassen werden mit Aussagen der Fotografen, Museen und Lehrgänge verglichen; die KI-Einschätzung gibt es nur auf Wunsch</span></label>
    <label>Bilder <select name="size"><option>3</option><option selected>4</option><option>5</option></select></label><button>Runde starten</button></form>
  ${answers.length ? `<p><a href="#/lernen/antworten">Alle Antworten (${answers.length})</a></p>` : ""}`;
};

views.learn = async () => {
  const st = sess.get("learn");
  if (!st) { location.hash = "#/lernen"; return ""; }
  if (st.pos >= st.ids.length) { location.hash = "#/runde/lernen"; return ""; }
  const img = lib.by.images.get(st.ids[st.pos]);
  const extra = EXTRA_QUESTIONS[(st.pos + st.seed) % EXTRA_QUESTIONS.length];
  setTimeout(() => { const looked = startLookTimer(st.look); $("#questions").addEventListener("submit", () => ($("#questions").dataset.looked = looked()), { capture: true }); });
  return `<p class="progress">Bild ${st.pos + 1} von ${st.ids.length}</p><figure class="hero learn">${media(img.id, "m")}</figure>
  <form data-action="learn-answer" data-img="${img.id}" id="questions" class="answers card">
    ${QUESTIONS.map(([k, l]) => `<label>${l}<textarea name="${k}" rows="3"></textarea></label>`).join("")}
    <input type="hidden" name="q_extra_label" value="${esc(extra)}"><label>${esc(extra)}<textarea name="q_extra" rows="2"></textarea></label>
    <button>Antwort abgeben und aufdecken</button></form>
  ${lookTimer(st.look)}<p class="muted small">Fotograf und Titel werden erst nach dem Absenden angezeigt.</p>`;
};

views.learnReveal = async id => {
  const a = await findItem("answers", id); if (!a) return `<p class="muted">Nicht gefunden.</p>`;
  const img = lib.by.images.get(a.image_id), an = await currentAnalysis(img.id);
  const st = sess.get("learn"), inSession = st && st.ids[st.pos] === img.id;
  return `${inSession ? `<p class="progress">Bild ${st.pos + 1} von ${st.ids.length}</p>${nextButton("learn-next", st.pos + 1 < st.ids.length, true)}` : ""}${imageHeader(img)}
  <div class="two-col reveal"><div><h2>Deine Antworten</h2><dl class="my-answers">
    ${QUESTIONS.map(([k, l]) => `<dt>${l}</dt><dd>${esc(a[k] || "—")}</dd>`).join("")}
    ${a.q_extra_label ? `<dt>${esc(a.q_extra_label)}</dt><dd>${esc(a.q_extra || "—")}</dd>` : ""}</dl>
    ${feedbackBlock(a, "learn-retry")}</div>
  <div>${(() => { const refs = learnRefs(img.id, a.q_extra_label), keys = Object.keys(refs);
    const aiPart = an ? analysisMeta(an) + analysisBody(an.data) + objectionBlock(img, an, { answer: a.id })
      : keys.length ? `<div id="analysis"><button class="secondary" data-action="analyze" data-img="${img.id}">KI-Einschätzung erzeugen</button><span class="busy">KI analysiert … (1–3 Minuten)</span></div>` : `<p class="pending">Analyse wird erzeugt …</p>`;
    if (!keys.length) return `${expertsBlock(img)}<h2>Analyse <span class="muted small">(KI-Einschätzung, kann irren – zu diesem Bild gibt es keine Quellenreferenz)</span></h2>${aiPart}`;
    const label = k => k === "q_extra" ? a.q_extra_label.split(":")[0] : QUESTIONS.find(([q]) => q === k)[1];
    return keys.map(k => refBlock(refs[k], { label: label(k) })).join("")
      + `<p class="muted small">Ohne Quelle (nicht bewertet): ${[...QUESTIONS.map(([k, l]) => [k, l]), ...(a.q_extra_label ? [["q_extra", a.q_extra_label.split(":")[0]]] : [])].filter(([k]) => !refs[k]).map(([, l]) => esc(l)).join(" · ")}</p>`
      + expertsBlock(img) + `<details class="ai-opt"><summary>KI-Einschätzung (zusätzlich, kann irren)</summary>${aiPart}</details>`; })()}</div></div>
  ${await discussionBlock(img)}${artistCard(photographerOf(img))}
  ${sourcesBlock(sourcesForImage(img), { scope: "image" })}
  ${inSession ? nextButton("learn-next", st.pos + 1 < st.ids.length) : `<p><a href="#/lernen">Zurück</a></p>`}`;
};

// End of a round: all images with their scores (feedback may still be arriving).
views.rundeEnde = async kind => {
  const isLearn = kind === "lernen", st = sess.get(isLearn ? "learn" : "drill");
  if (!st) { location.hash = isLearn ? "#/lernen" : "#/sehen"; return ""; }
  const items = await Promise.all((st.done || []).map(id => findItem(isLearn ? "answers" : "drills", id)));
  const ok = items.filter(x => x?.hit != null);
  const avg = k => ok.length ? (ok.reduce((n, x) => n + x[k], 0) / ok.length).toFixed(1) : "–";
  return `<h1>Runde abgeschlossen</h1>
  <div class="stats"><span><b>${avg("hit")}</b> Treffer ⌀</span><span><b>${avg("precision")}</b> Genauigkeit ⌀</span><span><b>${items.length}</b> Bilder</span></div>
  ${ok.length < items.length ? `<p class="pending">${items.length - ok.length} Bewertung(en) laufen noch – diese Seite aktualisiert sich.</p>` : ""}
  <ul class="answer-list">${items.filter(Boolean).map(x => { const i = lib.by.images.get(x.image_id), href = isLearn ? `#/lernen/r/${x.id}` : `#/sehen/r/${x.id}`;
    return `<li><a href="${href}">${media(i.id)}</a><div><a href="${href}">${esc(i.title || "Bild")}</a> <span class="muted">${esc(photographerOf(i).name)}${isLearn ? "" : ` · ${DIM[x.dimension]?.label}`}</span>
      ${x.hit != null ? `<div class="small">Treffer ${x.hit}/5 · Genauigkeit ${x.precision}/5${(x.missed || []).length ? ` · fehlte: ${x.missed.map(esc).join(", ")}` : ""}</div>` : x.error ? `<div class="error small">${esc(x.error)}</div>` : `<div class="pending small">Bewertung läuft …</div>`}</div></li>`; }).join("")}</ul>
  <div class="actions"><button data-action="round-close" data-kind="${kind}">Neue Runde</button><a class="button secondary" href="#/fortschritt">Fortschritt</a></div>`;
};

// Learning progress across all exercises.
views.fortschritt = async () => {
  const answers = await loadState("answers", []), drills = await loadState("drills", []);
  const all = [...answers.map(a => ({ ...a, dim: "lernrunde" })), ...drills.map(d => ({ ...d, dim: d.dimension }))].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const scored = all.filter(x => x.hit != null);
  const avg = (xs, k) => xs.length ? xs.reduce((n, x) => n + x[k], 0) / xs.length : null;
  const fmt = v => v == null ? "–" : v.toFixed(1);
  const last = scored.slice(-10), prev = scored.slice(-20, -10);
  const trend = (k) => { const a = avg(last, k), b = avg(prev, k); return a == null || b == null ? "" : a > b + 0.2 ? " ↑" : a < b - 0.2 ? " ↓" : " →"; };
  const rows = [["lernrunde", "Lernrunde (5 Fragen)"], ...DRILLABLE.map(d => [d.key, d.label])].map(([k, label]) => {
    const xs = scored.filter(x => x.dim === k), n = all.filter(x => x.dim === k).length;
    return `<tr><td>${label}</td><td>${n}</td><td>${fmt(avg(xs, "hit"))}</td><td>${fmt(avg(xs, "precision"))}</td></tr>`;
  }).join("");
  const missed = {}; scored.slice(-40).forEach(x => (x.missed || []).forEach(m => { const k = m.toLowerCase().trim(); missed[k] = (missed[k] || 0) + 1; }));
  const topMissed = Object.entries(missed).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const seen = new Set(all.map(x => x.image_id));
  const days = [...new Set(all.map(x => x.created_at.slice(0, 10)))];
  const chapters = await Promise.all(lib.chapters.map(async c => { const s = await chapterState(c); return [c, s.ids.filter(i => seen.has(i)).length, s.ids.length]; }));
  const open = ["learn", "drill"].map(k => [k, sess.get(k)]).filter(([, v]) => v && v.pos < (v.ids || v.items).length);
  return `<h1>Lernfortschritt</h1>
  ${open.map(([k, v]) => `<p class="card">Offene ${k === "learn" ? "Lernrunde" : "Sehübung"}: Bild ${v.pos + 1} von ${(v.ids || v.items).length} · <a href="#/${k === "learn" ? "lernen/runde" : "sehen/uebung"}">fortsetzen</a></p>`).join("")}
  <div class="stats"><span><b>${all.length}</b> Übungen</span><span><b>${seen.size}</b>/${lib.images.length} Bilder gesehen</span><span><b>${days.length}</b> Übungstage</span>
    <span><b>${fmt(avg(last, "hit"))}${trend("hit")}</b> Treffer (letzte 10)</span><span><b>${fmt(avg(last, "precision"))}${trend("precision")}</b> Genauigkeit (letzte 10)</span></div>
  <h2>Theorie</h2><p>${await (async () => { const p = await theoryProgress(); return `${lib.lessons.filter(l => p[l.id]?.passed).length}/${lib.lessons.length} Lektionen bestanden · <a href="#/theorie">zum Kurs</a>`; })()}</p>
  ${await (async () => { const sn = await snackStats(); return sn.total ? `<h2>Häppchen</h2><p>${sn.total} Karten in ${sn.rounds} Runden · ${Math.round(100 * sn.right / sn.total)} % richtig · ${Object.values(sn.last || {}).filter(v => v === 0).length} zur Wiederholung · <a href="#/kurz">weiter üben</a></p>` : ""; })()}
  <h2>Nach Aspekt</h2><table class="list keep"><thead><tr><th>Aspekt</th><th>Anzahl</th><th>Treffer ⌀</th><th>Genauigkeit ⌀</th></tr></thead><tbody>${rows}</tbody></table>
  ${topMissed.length ? `<h2>Was dir oft fehlt</h2><p>${topMissed.map(([m, n]) => `<span class="tag miss">${esc(m)} · ${n}</span>`).join(" ")}</p>` : ""}
  <h2>Kapitel</h2><table class="list keep"><tbody>${chapters.map(([c, n, t]) => `<tr><td><a href="#/kapitel/${c.id}">${c.number}. ${esc(c.title)}</a></td><td>${n}/${t}</td><td><div class="bar"><span style="width:${t ? Math.round(n / t * 100) : 0}%"></span></div></td></tr>`).join("")}</tbody></table>
  <p><a href="#/lernen/antworten">Lerntagebuch: alle Antworten</a></p>`;
};

// History of everything seen and practised, grouped by day.
views.antworten = async () => {
  const [answers, drills, disc] = await Promise.all([loadState("answers", []), loadState("drills", []), loadState("discussions", {})]);
  const items = [...answers.map(a => ({ ...a, kind: "learn" })), ...drills.map(d => ({ ...d, kind: "drill" }))];
  Object.entries(disc).forEach(([iid, msgs]) => { const first = msgs.find(m => m.role === "user"); if (first) items.push({ kind: "talk", image_id: iid, created_at: msgs[msgs.length - 1].at, count: msgs.length / 2 }); });
  items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byDay = {}; items.forEach(x => (byDay[x.created_at.slice(0, 10)] ||= []).push(x));
  return `<h1>Verlauf</h1><p class="lead">Alle Bilder, die du gesehen hast – mit Punkten, Bewertung und Gesprächen. <a href="#/fortschritt">Fortschritt</a></p>
  ${Object.entries(byDay).map(([day, xs]) => `<h2>${new Date(day).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
  <ul class="answer-list">${xs.map(x => { const i = lib.by.images.get(x.image_id); if (!i) return "";
    const href = x.kind === "learn" ? `#/lernen/r/${x.id}` : x.kind === "drill" ? `#/sehen/r/${x.id}` : `#/bild/${i.id}`;
    const label = x.kind === "learn" ? "Lernrunde" : x.kind === "drill" ? `Sehübung ${DIM[x.dimension]?.label}` : `Diskussion (${x.count} Fragen)`;
    return `<li><a href="${href}">${media(i.id)}</a><div><a href="${href}">${esc(i.title || "Bild")}</a>
      <span class="muted">${esc(photographerOf(i).name)} · ${label}</span>
      ${x.hit != null ? `<div class="small">Treffer ${x.hit}/5 · Genauigkeit ${x.precision}/5${(x.missed || []).length ? ` · fehlte: ${x.missed.map(esc).join(", ")}` : ""}</div>` : ""}
      ${x.feedback_md ? `<p class="small">${esc(x.feedback_md.slice(0, 200))}${x.feedback_md.length > 200 ? " …" : ""}</p>` : ""}</div></li>`; }).join("")}</ul>`).join("") || `<p class="muted">Noch nichts geübt.</p>`}`;
};

// --- history
// Chapter sources plus every source the text cites (photographer, project, image sources).
function chapterSources(id, text) {
  const own = sourcesFor("chapter", id), seen = new Set(own.map(x => x.id));
  const cited = [...referencedIds(text)].filter(i => !seen.has(i)).map(i => lib.by.sources.get(i)).filter(Boolean)
    .map(x => (x.kind ? { ...x, kind: undefined } : x));
  return [...own, ...cited];
}
const STATUS = { draft: "Entwurf", reviewed: "geprüft", base: "Grundtext (quellenbasiert)" };
async function chapterState(ch) {
  const all = await loadState("chapters", {});
  const s = all[ch.id] || {};
  const ids = (s.images || ch.images || []).filter(i => lib.by.images.has(i));
  // Own edits win; otherwise the sourced base text from the library.
  return { text: s.text_md || ch.text_md || "", own: !!s.text_md, status: s.status || (ch.text_md ? "base" : "draft"), ids, captions: s.captions || {} };
}

views.geschichte = async () => {
  const all = await loadState("chapters", {});
  return `<h1>Geschichte</h1><p class="lead">Kapitel entstehen aus hinterlegten Quellen. Ohne Beleg keine Aussage.</p>
  <table class="list"><thead><tr><th>#</th><th>Kapitel</th><th>Bilder</th><th>Status</th></tr></thead><tbody>
  ${lib.chapters.map(c => { const s = all[c.id] || {}; return `<tr><td>${c.number}</td><td><a href="#/kapitel/${c.id}">${esc(c.title)}</a></td>
    <td>${(s.images || c.images || []).length}</td><td><span class="status">${STATUS[s.status || (c.text_md ? "base" : "draft")]}</span>${s.text_md || c.text_md ? "" : ` <span class="muted">· ohne Text</span>`}</td></tr>`; }).join("")}
  </tbody></table><p><a href="#/zeitleiste">Zeitleiste</a></p>`;
};

views.kapitel = async id => {
  const ch = lib.by.chapters.get(id); if (!ch) return `<p class="muted">Nicht gefunden.</p>`;
  const s = await chapterState(ch);
  const sections = s.text ? s.text.split(/\n(?=## )/) : [];
  const pics = s.ids.map(i => lib.by.images.get(i));
  const fig = i => `<figure class="key-image"><a href="#/bild/${i.id}">${media(i.id, "m")}</a><figcaption><a href="#/bild/${i.id}">${esc(i.title || "Ohne Titel")}</a> · ${esc(photographerOf(i).name)}${i.year ? `, ${i.year}` : ""}${s.captions[i.id] ? `<div class="small">${md(s.captions[i.id])}</div>` : ""}</figcaption></figure>`;
  let used = 0; const blocks = [];
  sections.forEach(sec => { blocks.push(`<div class="prose">${md(sec)}</div>`); if (used < pics.length && !sec.startsWith("## Meine Einschätzung")) blocks.push(fig(pics[used++])); });
  pics.slice(used).forEach(p => blocks.push(fig(p)));
  return `<p class="crumbs"><a href="#/geschichte">Geschichte</a> › Kapitel ${ch.number}</p>
  <h1>${esc(ch.title)} <span class="muted">${ch.period_from || ""}–${ch.period_to || ""}</span></h1>
  <p><span class="status ${s.status}">${STATUS[s.status]}</span> · <a href="#/kapitel/${id}/bearbeiten">bearbeiten</a> · <a href="#/zeitleiste?k=${id}">Zeitleiste</a></p>
  ${s.text ? "" : `<p class="muted">Noch kein Kapiteltext. Unter „bearbeiten“ einen Entwurf aus den Quellen erzeugen.</p>`}
  ${s.text ? `<nav class="toc">${[...s.text.matchAll(/^## (.+)$/gm)].map(m => `<a href="#" data-toc="${esc(m[1])}">${esc(m[1])}</a>`).join("")}</nav>` : ""}
  <article class="chapter">${blocks.join("")}</article>${sourcesBlock(chapterSources(id, s.text), { scope: "chapter" })}`;
};

views.kapitelEdit = async id => {
  const ch = lib.by.chapters.get(id), s = await chapterState(ch);
  const draft = sess.get("draft:" + id), text = draft ?? s.text, srcs = sourcesFor("chapter", id);
  const unknown = [...referencedIds(text)].filter(i => !srcs.some(x => x.id === i));
  const candidates = lib.images.filter(i => !s.ids.includes(i.id)).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  return `<p class="crumbs"><a href="#/geschichte">Geschichte</a> › <a href="#/kapitel/${id}">Kapitel ${ch.number}</a></p><h1>${esc(ch.title)} bearbeiten</h1>
  ${draft != null ? `<p class="warn">Neuer KI-Entwurf im Textfeld – noch nicht gespeichert.</p>` : ""}
  ${unknown.length ? `<p class="error">Verweise auf Quellen, die diesem Kapitel nicht zugeordnet sind: ${unknown.map(i => "S" + i).join(" ")}</p>` : ""}
  <div class="two-col wide-left"><div>
    <form data-action="chapter-save" data-id="${id}" class="grid-form card">
      <label class="wide">Text (Markdown; Belege als [S&lt;id&gt;], Ableitungen unter „## Meine Einschätzung“)<textarea name="text_md" rows="22" class="mono">${esc(text)}</textarea></label>
      <label>Status <select name="status"><option value="draft">Entwurf</option><option value="reviewed" ${s.status === "reviewed" ? "selected" : ""}>geprüft</option><option value="base" ${s.status === "base" ? "selected" : ""}>Grundtext</option></select></label>
      <button>Speichern</button></form>
    <div class="card"><button class="secondary" data-action="chapter-draft" data-id="${id}">Entwurf aus Quellen erzeugen</button><span class="busy">KI schreibt … (bis zu 2 Minuten)</span>
      <p class="muted small">Die KI sieht nur die ${srcs.length} Quellenauszüge dieses Kapitels und die Angaben zu den Schlüsselbildern.</p></div>
    <h2 id="images">Schlüsselbilder <span class="muted">${s.ids.length} (Ziel 5–10)</span></h2>
    ${s.ids.map((iid, n) => { const i = lib.by.images.get(iid); return `<div class="key-row">${media(iid)}<div>${esc(i.title || "Ohne Titel")} <span class="muted">${esc(photographerOf(i).name)}${i.year ? `, ${i.year}` : ""}</span>
      <div class="row-actions"><button class="link" data-action="chapter-move" data-id="${id}" data-img="${iid}" data-dir="-1" ${n ? "" : "disabled"}>↑</button>
      <button class="link" data-action="chapter-move" data-id="${id}" data-img="${iid}" data-dir="1" ${n < s.ids.length - 1 ? "" : "disabled"}>↓</button>
      <button class="link danger" data-action="chapter-remove" data-id="${id}" data-img="${iid}">entfernen</button></div></div></div>`; }).join("")}
    <form data-action="chapter-add" data-id="${id}" class="grid-form card"><label class="wide">Bild aus der Bibliothek <select name="image">
      ${candidates.map(i => `<option value="${i.id}">${i.year || "o. J."} · ${esc(photographerOf(i).name)} · ${esc(i.title || "Ohne Titel")}</option>`).join("")}</select></label><button>Hinzufügen</button></form>
  </div><div>${sourcesBlock(srcs, { scope: "chapter", scopeId: id, editable: true })}</div></div>`;
};

views.zeitleiste = async params => {
  const k = params.get("k") || "";
  let rows = lib.images.filter(i => i.year);
  if (k) { const s = await chapterState(lib.by.chapters.get(k)); rows = rows.filter(i => s.ids.includes(i.id)); }
  rows.sort((a, b) => a.year - b.year);
  let html = `<h1>Zeitleiste</h1><select id="tl-filter"><option value="">alle Bilder mit Jahr</option>${lib.chapters.map(c => `<option value="${c.id}" ${c.id === k ? "selected" : ""}>${c.number}. ${esc(c.title)}</option>`).join("")}</select>`;
  if (!rows.length) return html + `<p class="muted">Keine Bilder mit Jahresangabe.</p>`;
  let y0 = rows[0].year, y1 = rows[rows.length - 1].year; y0 -= y0 % 10; y1 += 10 - (y1 % 10);
  const span = Math.max(1, y1 - y0), width = Math.max(900, span * 24), gap = 90 / width * 100, ends = [];
  const pts = rows.map(i => { const left = (i.year - y0) / span * 100; let lv = ends.findIndex(e => left - e >= gap); if (lv < 0) { lv = ends.length; ends.push(left); } else ends[lv] = left; return { i, left, lv }; });
  const ticks = []; for (let y = y0; y <= y1; y += span <= 120 ? 10 : 20) ticks.push([y, (y - y0) / span * 100]);
  return html + `<div class="timeline-scroll"><div class="timeline" style="--levels:${ends.length};min-width:${width}px">
    ${pts.map(p => `<a class="tl-item" href="#/bild/${p.i.id}" style="left:${p.left.toFixed(2)}%;--level:${p.lv}" title="${p.i.year} · ${esc(photographerOf(p.i).name)}">${media(p.i.id)}<span>${p.i.year}</span></a>`).join("")}
    <div class="axis">${ticks.map(([y, l]) => `<span class="tick" style="left:${l.toFixed(2)}%">${y}</span>`).join("")}</div></div></div>`;
};

// ---------- routing
const routes = [
  [/^\/?$/, () => views.home()],
  [/^\/kurz$/, () => views.kurz()], [/^\/kurz\/karte$/, () => views.kurzKarte()],
  [/^\/sehen$/, () => views.sehen()], [/^\/sehen\/uebung$/, () => views.drill()], [/^\/sehen\/r\/(.+)$/, m => views.drillReveal(m[1])],
  [/^\/theorie$/, () => views.theorie()], [/^\/theorie\/(.+)$/, m => views.lektion(m[1])],
  [/^\/begriffe$/, () => views.begriffe()], [/^\/begriffe\/(.+)$/, m => views.begriff(m[1])],
  [/^\/bibliothek$/, (m, p) => views.bibliothek(p)], [/^\/fotografen$/, () => views.fotografen()],
  [/^\/fotograf\/(.+)$/, m => views.fotograf(m[1])], [/^\/projekt\/(.+)$/, m => views.projekt(m[1])],
  [/^\/bild\/([^/]+)\/versionen$/, m => views.versionen(m[1])], [/^\/bild\/(.+)$/, m => views.bild(m[1])], [/^\/neu$/, () => views.neu()],
  [/^\/lernen$/, () => views.lernen()], [/^\/lernen\/runde$/, () => views.learn()], [/^\/lernen\/r\/(.+)$/, m => views.learnReveal(m[1])],
  [/^\/lernen\/antworten$/, () => views.antworten()], [/^\/fortschritt$/, () => views.fortschritt()],
  [/^\/runde\/(lernen|sehen)$/, m => views.rundeEnde(m[1])],
  [/^\/geschichte$/, () => views.geschichte()], [/^\/kapitel\/([^/]+)\/bearbeiten$/, m => views.kapitelEdit(m[1])],
  [/^\/kapitel\/(.+)$/, m => views.kapitel(m[1])], [/^\/zeitleiste$/, (m, p) => views.zeitleiste(p)],
];

// keep=true: background results re-render the page in place without jumping to the top.
// Theory section: course, history, photographers, concepts and timeline are one learning area with a sub-navigation.
const THEORY_TABS = [["theorie", "Kurs"], ["geschichte", "Geschichte"], ["fotografen", "Fotografen"], ["begriffe", "Begriffe"], ["zeitleiste", "Zeitleiste"]];
const THEORY_OF = { theorie: "theorie", geschichte: "geschichte", kapitel: "geschichte", fotografen: "fotografen", fotograf: "fotografen", projekt: "fotografen",
  begriffe: "begriffe", begriff: "begriffe", zeitleiste: "zeitleiste" };
const theoryTab = path => THEORY_OF[path.split("/")[1]];
const theoryNav = tab => `<nav class="subnav">${THEORY_TABS.map(([k, l]) => `<a href="#/${k}"${k === tab ? ' class="on"' : ""}>${l}</a>`).join("")}</nav>`;

let renderSeq = 0;
async function route(keep = false) {
  const ticket = ++renderSeq, hashAtStart = location.hash;
  const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    const y = window.scrollY;
    // keep what the user is typing when the page re-renders in place
    const typed = keep ? [...main().querySelectorAll("form [name]")].map(t => [`${t.closest("form").dataset.action}|${t.name}|${t.type === "radio" ? t.value : ""}`,
      t.type === "radio" || t.type === "checkbox" ? t.checked : t.value]) : [];
    if (!keep) main().innerHTML = `<p class="muted">Lädt …</p>`;
    try {
      const html = await fn(m, params);
      // a slower, older render (e.g. a background re-render) must not overwrite a newer page
      if (ticket !== renderSeq || location.hash !== hashAtStart) return;
      if (html !== "") {
        const tab = theoryTab(path);
        main().innerHTML = (tab ? theoryNav(tab) : "") + html; hydrate();
        for (const [k, v] of typed) {
          const [a, n, rv] = k.split("|"), sel = `form[data-action="${a}"] [name="${n}"]${rv ? `[value="${CSS.escape(rv)}"]` : ""}`, t = main().querySelector(sel);
          if (!t) continue;
          if (t.type === "radio" || t.type === "checkbox") t.checked = v; else if (t.tagName === "TEXTAREA" ? v : true) t.value = v;
        }
        window.scrollTo(0, keep ? y : 0);
      }
    } catch (e) { console.error(e); main().innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    const section = theoryTab(path) ? "#/theorie" : null;
    document.querySelectorAll("header nav a").forEach(a => a.classList.toggle("on", section ? a.getAttribute("href") === section
      : location.hash.startsWith(a.getAttribute("href")) && a.getAttribute("href") !== "#/"));
    return;
  }
  main().innerHTML = `<p class="muted">Seite nicht gefunden.</p>`;
}

const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; io.unobserve(e.target); loadImg(e.target);
}), { rootMargin: "400px" }) : null;
function loadImg(el) { mediaUrl(el.dataset.media, el.dataset.kind).then(u => (el.src = u)).catch(() => el.classList.add("broken")); }
function hydrate() {
  // everything lazy: images in collapsed "Vertiefung" blocks load only when opened
  document.querySelectorAll("img[data-media]").forEach(el => io && !el.classList.contains("preload") && !el.closest(".snack") ? io.observe(el) : loadImg(el));
  const f = $("#tl-filter"); if (f) f.onchange = () => (location.hash = f.value ? `#/zeitleiste?k=${f.value}` : "#/zeitleiste");
  const tl = document.querySelector(".timeline"); if (tl) tl.scrollIntoView({ block: "end" });
}

// ---------- actions
async function busy(el, fn) {
  const btns = el.querySelectorAll("button"); btns.forEach(b => (b.disabled = true)); el.classList.add("is-busy");
  try { return await fn(); } finally { btns.forEach(b => (b.disabled = false)); el.classList.remove("is-busy"); }
}
const errMsg = e => e instanceof AIError ? e.message : `Fehler: ${e.message}`;

const actions = {
  async "snack-start"(form) {
    const f = new FormData(form), st = await snackStats();
    const wrong = Object.entries(st.last || {}).filter(([, v]) => v === 0).map(([k]) => k);
    sess.set("snack", { topic: f.get("topic"), cards: makeRound(f.get("topic"), Number(f.get("size")), shuffle(wrong)), pos: 0, results: {} });
    location.hash = "#/kurz/karte";
  },
  "snack-answer"(btn) { snackSet(st => st.results[st.pos] ?? Number(btn.dataset.i)); },
  "snack-tf"(btn) { snackSet(st => st.results[st.pos] ?? Number(btn.dataset.v)); },
  "snack-order"(btn) { snackSet(st => { const cur = st.results[st.pos] || []; const k = Number(btn.dataset.k); return cur.includes(k) ? cur : [...cur, k]; }); },
  "snack-reveal"() { snackSet(st => st.results[st.pos] ?? "shown"); },
  "snack-memo"() { const st = sess.get("snack"); if (location.hash !== "#/kurz/karte" || !st || st.memo?.[st.pos]) return; (st.memo ||= {})[st.pos] = 1; sess.set("snack", st); route(true); },
  "snack-guess"() { const v = Number(document.getElementById("snack-year")?.value); if (v) snackSet(st => st.results[st.pos] ?? v); },
  "snack-zoom"() { const st = sess.get("snack"); if (!st) return; (st.zoom ||= {})[st.pos] = (st.zoom[st.pos] || 0) + 1; sess.set("snack", st); route(true); },
  "snack-bin"(btn) { snackSet(st => { const cur = Array.isArray(st.results[st.pos]) ? st.results[st.pos] : []; const card = buildCard(st.cards[st.pos]); return cur.length < card.items.length ? [...cur, Number(btn.dataset.v)] : cur; }); },
  "snack-toggle"(btn) { const st = sess.get("snack"); if (!st || st.results[st.pos] != null) return; const k = Number(btn.dataset.i), cur = (st.sel ||= {})[st.pos] || [];
    st.sel[st.pos] = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]; sess.set("snack", st); route(true); },
  "snack-assign"(btn) { const st = sess.get("snack"); if (!st || st.results[st.pos] != null) return; const cur = [...((st.sel ||= {})[st.pos] || [])];
    cur[Number(btn.dataset.row)] = Number(btn.dataset.i); st.sel[st.pos] = cur; sess.set("snack", st); route(true); },
  "snack-check"() { snackSet(st => st.results[st.pos] ?? [...(st.sel?.[st.pos] || [])]); },
  "snack-tone"(btn) { snackSet(st => { if (st.results[st.pos] != null) return st.results[st.pos]; const m = st.tone[st.pos], v = Number(btn.dataset.v); return { pick: v, ok: v === 0 ? m.a.L > m.b.L : m.b.L > m.a.L }; }); },
  "snack-zone"() { const v = Number(document.getElementById("snack-year")?.value); snackSet(st => st.results[st.pos] ?? { pick: v, ok: Math.abs(v - Math.round(st.tone[st.pos].a.L / 10)) <= 1 }); },
  "snack-fmt"(btn) { const el = document.querySelector(".snack-crop.square img"); if (!el?.naturalWidth) return;
    const ratio = Math.max(el.naturalWidth, el.naturalHeight) / Math.min(el.naturalWidth, el.naturalHeight), card = buildCard(sess.get("snack").cards[sess.get("snack").pos]);
    const truth = card.options.reduce((b, o, k) => Math.abs(Math.log(o.v / ratio)) < Math.abs(Math.log(card.options[b].v / ratio)) ? k : b, 0), pick = Number(btn.dataset.i);
    snackSet(st => st.results[st.pos] ?? { pick, truth, ok: pick === truth, ratio, portrait: el.naturalHeight > el.naturalWidth }); },
  "snack-step"() { snackSet(st => (typeof st.results[st.pos] === "number" ? st.results[st.pos] : 0) + 1); },
  "snack-next"() {
    const st = sess.get("snack"); if (!st) return;
    st.pos++; sess.set("snack", st);
    if (st.pos >= st.cards.length) saveSnackRound(st);
    route(); window.scrollTo(0, 0);
  },
  async "snack-again"() {
    const st = sess.get("snack"), stats = await snackStats();
    const wrong = Object.entries(stats.last || {}).filter(([, v]) => v === 0).map(([k]) => k);
    sess.set("snack", { topic: st?.topic || "mix", cards: makeRound(st?.topic || "mix", st?.cards.length || 8, shuffle(wrong)), pos: 0, results: {} });
    route();
  },
  async "drill-start"(form) {
    const f = new FormData(form), dim = f.get("dimension"), look = Number(f.get("look")); store.set("lookSeconds", look);
    const prog = await theoryProgress();
    const dims = (dim === "mixed" ? DRILLABLE.map(d => d.key) : [dim]).filter(k => isUnlocked(prog, k));
    if (!dims.length) return toast("Erst die Lektion abschließen.");
    startDrill(dims, Number(f.get("size")), look, f.get("sourced") === "on");
  },
  async "drill-quick"(btn) {
    if (!isUnlocked(await theoryProgress(), btn.dataset.dim)) { location.hash = `#/theorie/${btn.dataset.dim}`; return toast("Erst die Lektion abschließen."); }
    startDrill([btn.dataset.dim], 5, Number(store.get("lookSeconds") ?? 60), true);
  },
  async quiz(form) {
    const l = lib.by.lessons.get(form.dataset.id), f = new FormData(form), deepSet = form.dataset.set === "deep";
    let right = 0;
    const asked = l.quiz.map((q, n) => [q, n]).filter(([q]) => !!q.deep === deepSet);
    asked.forEach(([q, n]) => {
      const given = Number(f.get("q" + n)), fs = form.querySelector(`fieldset[data-n="${n}"]`), ok = given === q.correct;
      if (ok) right++;
      fs.classList.toggle("right", ok); fs.classList.toggle("wrong", !ok);
      const ex = fs.querySelector(".explain"); ex.hidden = false;
      ex.innerHTML = `${ok ? "✓ Richtig." : `✗ Richtig wäre: <b>${md(q.options[q.correct]).replace(/^<p>|<\/p>$/g, "")}</b>.`} ${md(q.explanation).replace(/^<p>|<\/p>$/g, "")}`;
    });
    const total = asked.length, passed = right >= Math.ceil(total * PASS_RATIO);
    if (deepSet) { form.parentElement.querySelector(".quiz-result-deep").innerHTML = `<p class="${passed ? "ok" : "warn"}"><b>${right}/${total}</b> Zusatzfragen richtig.</p>`; return; }
    $("#quiz-result").innerHTML = `<p class="${passed ? "ok" : "warn"}"><b>${right}/${total}</b> – ${passed ? "bestanden. Die Sehübung ist freigeschaltet." : "noch nicht bestanden. Lies die Erklärungen und versuch es noch einmal."}</p>
      ${passed && DIM[l.id]?.field ? `<button data-action="drill-quick" data-dim="${l.id}">Sehübung „${DIM[l.id].label}“ starten</button>` : `<button class="secondary" onclick="location.reload()">Test neu starten</button>`}`;
    $("#quiz-result").scrollIntoView({ behavior: "smooth", block: "center" });
    const apply = st => {
      const t = (st.theory ||= {}), prev = t[l.id] || {};
      t[l.id] = { passed: prev.passed || passed, best: Math.max(prev.best || 0, right), total, attempts: (prev.attempts || 0) + 1, at: new Date().toISOString() };
      return st;
    };
    // Unlock immediately in this session; the write to GitHub follows.
    apply(await loadState("progress", { theory: {} }));
    await mutateState("progress", { theory: {} }, apply, `Theorie ${l.id}`).catch(e => toast(errMsg(e), 5000));
  },
  async "lesson-ask"(form) {
    const l = lib.by.lessons.get(form.dataset.id), q = new FormData(form).get("q").trim(); if (!q) return;
    const key = "lesson:" + l.id, thread = (await loadState("discussions", {}))[key] || [];
    pendingQuestions.set(key, q); route(true);
    bg(async () => {
      let reply;
      try { reply = await askLesson(l, thread, q); }
      catch (e) { toast(errMsg(e), 6000); pendingQuestions.delete(key); return route(true); }
      const now = new Date().toISOString();
      await mutateState("discussions", {}, s => { (s[key] ||= []).push({ role: "user", text: q, at: now }, { role: "ai", text: reply, at: new Date().toISOString() }); return s; }, "Frage zur Lektion");
      pendingQuestions.delete(key);
      if (location.hash === `#/theorie/${l.id}`) route(true);
    });
  },
  async "drill-answer"(form) {
    const img = lib.by.images.get(form.dataset.img), d = DIM[form.dataset.dim];
    const drill = { id: uid(), image_id: img.id, dimension: d.key, answer: new FormData(form).get("answer").trim(), look_seconds: Number(form.dataset.looked || 0), created_at: new Date().toISOString() };
    pendingItems.set(drill.id, drill);
    const st = sess.get("drill"); if (st) { st.done = [...(st.done || []), drill.id]; sess.set("drill", st); }
    bg(() => mutateState("drills", [], s => [...s, drill], "Sehübung"));
    const ref = refFor(img.id, d.key);
    bg(() => evaluate("drills", drill, async () => {
      if (ref) return { reference: true, ...await drillFeedbackSourced(img, d, ref, drill.answer) };
      const an = await generateAnalysis(img); rerenderIf(drill.id);
      return { analysis_version: an.version, ...await drillFeedback(img, d, an.data, drill.answer) };
    }));
    location.hash = `#/sehen/r/${drill.id}`;
  },
  async "drill-retry"(btn) {
    const dr = await findItem("drills", btn.dataset.id), img = lib.by.images.get(dr.image_id);
    pendingItems.set(dr.id, { ...dr, error: undefined }); route();
    const ref = refFor(img.id, dr.dimension);
    bg(() => evaluate("drills", pendingItems.get(dr.id), async () => {
      if (ref) return { reference: true, ...await drillFeedbackSourced(img, DIM[dr.dimension], ref, dr.answer) };
      const an = await generateAnalysis(img);
      return { analysis_version: an.version, ...await drillFeedback(img, DIM[dr.dimension], an.data, dr.answer) };
    }));
  },
  async "drill-next"() { const st = sess.get("drill"); st.pos++; sess.set("drill", st); location.hash = st.pos < st.items.length ? "#/sehen/uebung" : "#/runde/sehen"; },
  async "round-close"(btn) { sess.set(btn.dataset.kind === "lernen" ? "learn" : "drill", null); location.hash = btn.dataset.kind === "lernen" ? "#/lernen" : "#/sehen"; },

  async "learn-start"(form) {
    const f = new FormData(form); let pool = lib.images.slice();
    if (f.get("mode") === "tag") pool = pool.filter(i => (i.tags || []).includes(f.get("tag")));
    if (f.get("mode") === "chapter") { const s = await chapterState(lib.by.chapters.get(f.get("chapter"))); pool = pool.filter(i => s.ids.includes(i.id)); }
    const sourced = f.get("sourced") === "on";
    if (sourced) pool = pool.filter(i => Object.keys(learnRefs(i.id)).length);
    const nRefs = i => Object.keys(learnRefs(i.id)).length;
    const done = new Set((await loadState("answers", [])).map(a => a.image_id));
    const ids = [...shuffle(pool.filter(i => !done.has(i.id))).sort((a, b) => nRefs(b) - nRefs(a)), ...shuffle(pool.filter(i => done.has(i.id)))].slice(0, Number(f.get("size"))).map(i => i.id);
    if (!ids.length) return toast(sourced ? "Für diese Auswahl gibt es keine Bilder mit Quellenreferenz – Haken entfernen, um mit KI-Einschätzung zu üben." : "Für diese Auswahl gibt es keine Bilder.", 6000);
    sess.set("learn", { ids, pos: 0, look: Number(f.get("look")), seed: Math.floor(Math.random() * 4), done: [], sourced });
    if (!sourced) prefetch(ids); // with sources, the AI analysis is only made on request
    location.hash = "#/lernen/runde";
  },
  async "learn-answer"(form) {
    const img = lib.by.images.get(form.dataset.img), f = new FormData(form);
    const a = { id: uid(), image_id: img.id, created_at: new Date().toISOString(), look_seconds: Number(form.dataset.looked || 0) };
    for (const k of ["q_position", "q_wait", "q_omitted", "q_different", "q_extra_label", "q_extra"]) a[k] = (f.get(k) || "").trim();
    pendingItems.set(a.id, a);
    const st = sess.get("learn"); if (st) { st.done = [...(st.done || []), a.id]; sess.set("learn", st); }
    bg(() => mutateState("answers", [], s => [...s, a], "Lernantwort"));
    const refs = learnRefs(img.id, a.q_extra_label);
    bg(() => evaluate("answers", a, async () => {
      if (Object.keys(refs).length) return { reference: true, ...await learnFeedbackSourced(img, a, refs) };
      const an = await generateAnalysis(img); rerenderIf(a.id);
      const fb = await learnFeedback(an.data, a, img);
      return { analysis_version: an.version, ...fb };
    }));
    location.hash = `#/lernen/r/${a.id}`;
  },
  async "learn-retry"(btn) {
    const a = await findItem("answers", btn.dataset.id), img = lib.by.images.get(a.image_id);
    pendingItems.set(a.id, { ...a, error: undefined }); route();
    const refs = learnRefs(img.id, a.q_extra_label);
    bg(() => evaluate("answers", pendingItems.get(a.id), async () => {
      if (Object.keys(refs).length) return { reference: true, ...await learnFeedbackSourced(img, a, refs) };
      const an = await generateAnalysis(img);
      return { analysis_version: an.version, ...await learnFeedback(an.data, a, img) };
    }));
  },
  async object(form) {
    const img = lib.by.images.get(form.dataset.img), text = new FormData(form).get("text").trim(), { drill, answer } = form.dataset;
    if (!text) return;
    objecting.add(img.id); route(true);
    bg(async () => {
      try {
        const an = await generateAnalysis(img, true, text);
        objecting.delete(img.id); route(true);
        // re-grade his answer against the checked analysis
        if (drill) { const dr = await findItem("drills", drill); if (dr && !refFor(dr.image_id, dr.dimension)) { pendingItems.set(dr.id, { ...dr, error: undefined, hit: undefined, feedback_md: undefined }); route(true);
          await evaluate("drills", pendingItems.get(dr.id), async () => ({ analysis_version: an.version, ...await drillFeedback(img, DIM[dr.dimension], an.data, dr.answer) })); } }
        if (answer) { const a = await findItem("answers", answer); if (a && !Object.keys(learnRefs(a.image_id, a.q_extra_label)).length) { pendingItems.set(a.id, { ...a, error: undefined, hit: undefined, feedback_md: undefined }); route(true);
          await evaluate("answers", pendingItems.get(a.id), async () => ({ analysis_version: an.version, ...await learnFeedback(an.data, a, img) })); } }
      } catch (e) { toast(errMsg(e), 6000); }
      finally { objecting.delete(img.id); route(true); }
    });
  },
  async "learn-next"() { const st = sess.get("learn"); st.pos++; sess.set("learn", st); location.hash = st.pos < st.ids.length ? "#/lernen/runde" : "#/runde/lernen"; },

  async ask(form) {
    const img = lib.by.images.get(form.dataset.img), q = new FormData(form).get("q").trim(); if (!q) return;
    const [answers, drills] = await Promise.all([loadState("answers", []), loadState("drills", [])]);
    const mine = [...answers, ...drills].filter(x => x.image_id === img.id)
      .map(({ id, image_id, feedback_md, per_question, error, ...rest }) => rest);
    const thread = (await loadState("discussions", {}))[img.id] || [];
    pendingQuestions.set(img.id, q); route();
    bg(async () => {
      let reply;
      try { reply = await discuss(img, (await currentAnalysis(img.id))?.data, mine, thread, q); }
      catch (e) { toast(errMsg(e), 6000); pendingQuestions.delete(img.id); return route(); }
      const now = new Date().toISOString();
      await mutateState("discussions", {}, s => { (s[img.id] ||= []).push({ role: "user", text: q, at: now }, { role: "ai", text: reply, at: new Date().toISOString() }); return s; }, "Diskussion");
      pendingQuestions.delete(img.id);
      if (location.hash.includes(img.id) || document.querySelector(`form[data-img="${img.id}"].ask`)) route();
    });
  },
  async analyze(btn) {
    const img = lib.by.images.get(btn.dataset.img), regen = !!btn.dataset.regen;
    if (regen && !confirm("Analyse wirklich neu erzeugen? Die alte Version bleibt erhalten; Abweichungen müssen begründet werden.")) return;
    await busy(btn.parentElement, async () => {
      try { const an = await generateAnalysis(img, regen); $("#analysis").innerHTML = analysisPanel(img, an); }
      catch (e) { toast(errMsg(e), 6000); }
    });
  },

  async "add-source"(form) {
    const f = new FormData(form);
    const src = { id: newSourceId(), url: f.get("url").trim(), title: f.get("title").trim(), excerpt: f.get("excerpt").trim(),
      accessed_at: new Date().toISOString().slice(0, 10), scope: form.dataset.scope, scope_id: form.dataset.scopeId };
    await busy(form, () => addOwn("sources", src, "Quelle"));
    toast("Quelle gespeichert"); route();
  },
  async "add-image"(form) {
    const f = new FormData(form), file = f.get("file");
    await busy(form, async () => {
      const name = f.get("photographer").trim();
      let ph = lib.photographers.find(p => p.name === name);
      if (!ph) { ph = { id: ownId("p"), name, born: null, died: null }; await addOwn("photographers", ph, "Fotograf"); }
      let pr = null; const pt = f.get("project").trim();
      if (pt) { pr = lib.projects.find(r => r.photographer_id === ph.id && r.title === pt);
        if (!pr) { pr = { id: ownId("r"), photographer_id: ph.id, title: pt, year_from: null, year_to: null }; await addOwn("projects", pr, "Projekt"); } }
      const id = ownId("u");
      const [full, thumb, size] = await scaleImage(file);
      await uploadMedia(id, full, thumb);
      await addOwn("images", { id, photographer_id: ph.id, project_id: pr?.id || null, title: f.get("title").trim(), year: Number(f.get("year")) || null,
        location: f.get("location").trim(), source_url: f.get("source_url").trim(), image_url: "", accessed_at: new Date().toISOString().slice(0, 10),
        tags: [...new Set(f.get("tags").split(/[,;]/).map(t => t.trim().toLowerCase()).filter(Boolean))], w: size[0], h: size[1] }, "Bild");
      location.hash = `#/bild/${id}`;
    }).catch(e => toast(errMsg(e), 6000));
  },

  async "chapter-save"(form) {
    const f = new FormData(form), id = form.dataset.id;
    await busy(form, () => mutateState("chapters", {}, s => { s[id] = { ...(s[id] || {}), text_md: f.get("text_md").trim(), status: f.get("status") }; return s; }, `Kapitel ${id}`));
    sess.set("draft:" + id, null); toast("Gespeichert"); route();
  },
  async "chapter-draft"(btn) {
    const id = btn.dataset.id, ch = lib.by.chapters.get(id), s = await chapterState(ch);
    if (!confirm("Entwurf aus den Quellen erzeugen? Der Text im Feld wird ersetzt (erst beim Speichern übernommen).")) return;
    await busy(btn.parentElement, async () => {
      try { sess.set("draft:" + id, await chapterDraft(ch, s.ids.map(i => lib.by.images.get(i)))); route(); }
      catch (e) { toast(errMsg(e), 6000); }
    });
  },
  async "chapter-add"(form) { await editChapterImages(form.dataset.id, ids => [...ids, new FormData(form).get("image")]); },
  async "chapter-remove"(btn) { await editChapterImages(btn.dataset.id, ids => ids.filter(i => i !== btn.dataset.img)); },
  async "chapter-move"(btn) {
    await editChapterImages(btn.dataset.id, ids => { const i = ids.indexOf(btn.dataset.img), j = i + Number(btn.dataset.dir); [ids[i], ids[j]] = [ids[j], ids[i]]; return ids; });
  },
};

// Run the AI evaluation for an answer/drill, then store the result next to it.
async function evaluate(kind, item, fn) {
  let patch;
  try {
    const r = await fn();
    patch = { analysis_version: r.analysis_version, feedback_md: r.feedback, hit: r.hit, precision: r.precision,
      per_question: r.per_question, missed: r.missed, error: undefined };
  } catch (e) { patch = { error: errMsg(e) }; }
  Object.assign(item, patch); pendingItems.set(item.id, item);
  rerenderIf(item.id); if (location.hash.startsWith("#/runde/")) route(true);
  await mutateState(kind, [], s => s.map(x => x.id === item.id ? { ...x, ...patch } : x), "Bewertung");
  pendingItems.delete(item.id);
}

async function editChapterImages(id, fn) {
  const ch = lib.by.chapters.get(id);
  await mutateState("chapters", {}, s => { const cur = s[id]?.images || ch.images.slice(); s[id] = { ...(s[id] || {}), images: fn(cur.slice()) }; return s; }, `Kapitel ${id} Bilder`);
  route();
}

// round stats into progress.enc: totals plus the last result per card (0 = wrong → comes back for repetition)
function snackSet(fn) { const st = sess.get("snack"); if (!st) return; st.results[st.pos] = fn(st); sess.set("snack", st); route(true); }
function saveSnackRound(st) {
  if (st.saved) return; st.saved = true; sess.set("snack", st);
  const res = st.cards.map((c, i) => { const k = buildCard(c); return k?.scored && !["reveal", "info", "story", "look"].includes(k.kind) ? [cardId(c), isRight(k, st.results[i]) ? 1 : 0] : null; }).filter(Boolean);
  const apply = s => { const sn = (s.snacks ||= { total: 0, right: 0, rounds: 0, last: {} });
    sn.total += res.length; sn.right += res.filter(([, v]) => v).length; sn.rounds++; for (const [id, v] of res) sn.last[id] = v; return s; };
  bg(() => mutateState("progress", { theory: {} }, apply, "Häppchen"));
}
function startDrill(dims, size, look, sourcedOnly = true) {
  loadState("drills", []).then(drills => {
    const done = new Set(drills.map(d => d.image_id + "|" + d.dimension));
    // pairs (image, aspect): with a sourced reference first; unseen before seen
    const pairs = shuffle(lib.images.flatMap(i => dims.map(d => [i.id, d])))
      .filter(([i, d]) => !sourcedOnly || refFor(i, d))
      .sort((a, b) => (done.has(a.join("|")) - done.has(b.join("|"))) || (!refFor(...a) - !refFor(...b)));
    const items = [], used = new Set();
    for (const p of pairs) { if (items.length >= size) break; if (!used.has(p[0])) { used.add(p[0]); items.push(p); } }
    if (!items.length) return toast("Zu diesem Aspekt gibt es noch keine Bilder mit Quellenreferenz – Haken „Nur Bilder mit Quellenreferenz“ entfernen, um mit KI-Einschätzung zu üben.", 7000);
    if (items.length < size) toast(`Nur ${items.length} Bild(er) mit Quellenreferenz verfügbar.`, 4000);
    sess.set("drill", { items, pos: 0, look, done: [] });
    prefetch(items.filter(([i, d]) => !refFor(i, d)).map(([id]) => id)); // AI analysis only where no sourced reference exists
    location.hash = "#/sehen/uebung";
  });
}

async function scaleImage(file) {
  const bmp = await createImageBitmap(file);
  const enc = async edge => {
    const s = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.86));
    return [new Uint8Array(await blob.arrayBuffer()), [c.width, c.height]];
  };
  const [full] = await enc(1568), [thumb, size] = await enc(480);
  return [full, thumb, size];
}

document.addEventListener("submit", e => {
  const a = e.target.dataset.action; if (!actions[a]) return;
  e.preventDefault(); actions[a](e.target);
});
// Buttons outside action forms carry their own data-action (submit buttons are handled above).
document.addEventListener("click", e => {
  const el = e.target.closest("button[data-action]");
  if (!el || !actions[el.dataset.action] || el.form?.dataset.action) return;
  e.preventDefault(); actions[el.dataset.action](el);
});
// Chapter table of contents: scroll to the heading.
document.addEventListener("click", e => {
  const a = e.target.closest("a[data-toc]"); if (!a) return;
  e.preventDefault();
  const h = [...document.querySelectorAll(".chapter h3, .chapter h2")].find(x => (x.dataset.h || x.textContent.trim()) === a.dataset.toc);
  h?.scrollIntoView({ behavior: "smooth", block: "start" });
});
// [S<id>] links: scroll to the source instead of changing the route
document.addEventListener("click", e => {
  const ref = e.target.closest("a.ref"); if (!ref) return;
  e.preventDefault();
  const src = lib.by?.sources.get(Number(ref.dataset.src));
  if (src && !ref.closest(".src-sheet")) return showSource(src, ref.textContent);
  closeSheet(); const t = document.getElementById("source-" + ref.dataset.src);
  if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1500); }
});
// Source as a bottom sheet: read the evidence without losing your place in the text
function showSource(s, label) {
  closeSheet();
  const el = document.createElement("div"); el.className = "src-sheet";
  el.innerHTML = `<div class="sheet-head"><span class="sid">${esc(label)}</span><button class="secondary" data-close>Schließen</button></div>
    ${s.author ? `<p class="small"><b>${esc(s.author)}</b></p>` : ""}${s.excerpt ? `<blockquote>${esc(s.excerpt)}</blockquote>` : ""}
    <p class="small"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a> <span class="muted">· abgerufen ${fmtDate(s.accessed_at)}</span></p>
    ${document.getElementById("source-" + s.id) ? `<p class="small"><a class="ref" href="#source-${s.id}" data-src="${s.id}">In der Quellenliste zeigen</a></p>` : ""}`;
  el.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.body.append(el);
}
function closeSheet() { document.querySelector(".src-sheet")?.remove(); }
window.addEventListener("hashchange", closeSheet);

// ---------- full-screen viewer: tap an image or sketch in a lesson/chapter or a Häppchen card, pinch or double-tap to zoom, drag to pan
document.addEventListener("click", e => {
  const img = e.target.closest('.chapter img[data-kind="m"], .quiz-img img, .galerie img, .snack .snack-img:not(.tiles) img, .snack .snack-pair img, .snack .thumbs img, .snack[data-swipe="next"] .opt img, .snack[data-swipe="next"] .order-item img');
  const svg = !img && e.target.closest(".chapter figure.sketch svg");
  if (!img && !svg) return;
  e.preventDefault(); e.stopPropagation();
  const fig = (img || svg).closest(".g-item, figure, .compare > div, .quiz-img");
  const gi = img && lib.by.images.get(img.dataset.media);
  const cap = (fig?.classList.contains("g-item") || (img?.closest(".snack") && !fig?.querySelector("figcaption"))) && gi ? { innerHTML: `<span class="who"><b>${esc(photographerOf(gi).name)}</b> – ${esc(gi.title || "")}${gi.year ? `, ${gi.year}` : ""}</span>` }
    : fig?.querySelector(":scope > figcaption, :scope figcaption");
  const spoiler = img?.closest('.snack:not([data-swipe="next"])'); // an open Häppchen card: no name, no link before the answer
  openViewer({ img, svg, caption: cap && !spoiler ? cap.innerHTML : "", noLink: !!spoiler });
}, true);

function openViewer({ img, svg, caption, noLink }) {
  closeViewer();
  const id = img?.dataset.media;
  const v = document.createElement("div"); v.className = "viewer";
  v.innerHTML = `<div class="viewer-bar"><button class="secondary" data-close>Schließen</button>
      ${id && lib.by.images.has(id) && !noLink ? `<a href="#/bild/${id}">Zur Bildseite</a>` : ""}<span class="muted small">Zwei Finger oder Doppeltippen zum Zoomen</span></div>
    <div class="viewer-stage"><div class="viewer-content"></div></div>
    ${caption ? `<div class="viewer-cap">${caption}</div>` : ""}`;
  const content = v.querySelector(".viewer-content"), stage = v.querySelector(".viewer-stage");
  if (svg) content.innerHTML = `<div class="viewer-svg sketch">${svg.outerHTML}</div>`;
  else {
    const el = document.createElement("img"); el.alt = ""; el.draggable = false; content.append(el);
    if (img.src && (img.dataset.kind === "m" || img.dataset.kind === "p")) el.src = img.src; // portraits have no other size
    else { if (img.src) el.src = img.src; mediaUrl(id, "m").then(u => (el.src = u)); } // thumbnail first, sharp version follows
  }
  document.body.append(v); document.body.classList.add("noscroll");
  history.pushState({ viewer: true }, "");
  v.querySelector("[data-close]").onclick = () => history.back();
  v.querySelector(".viewer-bar a")?.addEventListener("click", () => closeViewer());
  v.addEventListener("gesturestart", e => e.preventDefault());

  let s = 1, tx = 0, ty = 0, start = null, lastTap = 0;
  const pts = new Map();
  const apply = () => { if (s <= 1.001) { s = 1; tx = ty = 0; } content.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; };
  const rel = p => { const r = stage.getBoundingClientRect(); return { x: p.x - r.left - r.width / 2, y: p.y - r.top - r.height / 2 }; };
  const snapshot = () => {
    const [a, b] = [...pts.values()];
    start = b ? { s, tx, ty, d: Math.hypot(a.x - b.x, a.y - b.y), m: rel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) } : { s, tx, ty, p: rel(a), moved: false };
  };
  const zoomAt = (to, at) => { to = Math.min(8, Math.max(1, to)); tx = at.x - (at.x - tx) * (to / s); ty = at.y - (at.y - ty) * (to / s); s = to; apply(); };
  stage.addEventListener("pointerdown", e => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); snapshot(); });
  stage.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pts.values()];
    if (b && start.d) {
      const m = rel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), to = Math.min(8, Math.max(1, start.s * Math.hypot(a.x - b.x, a.y - b.y) / start.d));
      s = to; tx = m.x - (start.m.x - start.tx) * (to / start.s); ty = m.y - (start.m.y - start.ty) * (to / start.s); apply();
    } else if (!b && start.p) {
      const p = rel(a); if (Math.hypot(p.x - start.p.x, p.y - start.p.y) > 8) start.moved = true;
      if (s > 1) { tx = start.tx + p.x - start.p.x; ty = start.ty + p.y - start.p.y; apply(); }
    }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    const single = pts.size === 1 && start.p && !start.moved;
    pts.delete(e.pointerId);
    if (single) {
      const now = Date.now();
      if (now - lastTap < 320) { zoomAt(s > 1.5 ? 1 : 2.5, rel({ x: e.clientX, y: e.clientY })); lastTap = 0; } else lastTap = now;
    }
    if (pts.size) snapshot();
  };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  stage.addEventListener("wheel", e => { e.preventDefault(); zoomAt(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), rel({ x: e.clientX, y: e.clientY })); }, { passive: false });
}
function closeViewer() { document.querySelector(".viewer")?.remove(); document.body.classList.remove("noscroll"); }
window.addEventListener("popstate", closeViewer);

// swipe left on an answered Häppchen card = next
let swipeX = null;
let swipeBlitz = false;
document.addEventListener("touchstart", e => { swipeBlitz = !!e.target.closest("[data-blitz]"); swipeX = swipeBlitz || e.target.closest('.snack[data-swipe="next"]') ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener("touchend", e => {
  if (swipeX == null) return; const dx = e.changedTouches[0].clientX - swipeX; swipeX = null;
  if (swipeBlitz) { if (Math.abs(dx) > 60) actions["snack-bin"]({ dataset: { v: dx > 0 ? "1" : "0" } }); return; } // Blitzsortierer: left = A, right = B
  if (dx < -70) actions["snack-next"]();
}, { passive: true });

// ---------- boot
async function start(code, remember) {
  await unlock(code);
  if (remember) store.set("sehschuleCode", code);
  $("#lock").hidden = true; $("#app").hidden = false;
  main().innerHTML = `<p class="muted">Bibliothek wird geladen …</p>`;
  await loadLibrary();
  window.addEventListener("hashchange", route);
  route();
}

$("#lock-form").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("#code").value, err = $("#lock-error");
  err.textContent = ""; $("#lock-form button").disabled = true;
  try { await start(code, $("#remember").checked); }
  catch (ex) { err.textContent = ex.message; }
  finally { $("#lock-form button").disabled = false; }
});
$("#logout").addEventListener("click", () => { store.set("sehschuleCode", null); sessionStorage.clear(); location.reload(); });

const saved = store.get("sehschuleCode");
if (saved) start(saved, true).catch(() => { store.set("sehschuleCode", null); $("#lock").hidden = false; });
else $("#lock").hidden = false;
