// Sehschule web app: unlock, routing and views.
import { AIError, loadState, mediaUrl, providerLabel, mutateState, session, store, unlock, uid, uploadMedia } from "./core.js";
import {
  CONSTRUCTION_LABELS, DIM, DIMENSIONS, DRILLABLE, EXTRA_QUESTIONS, QUESTIONS, addOwn, allTags, analyses, chapterDraft,
  currentAnalysis, drillFeedback, esc, generateAnalysis, learnFeedback, lib, loadLibrary, md, newSourceId, ownId,
  LEARN_ROUND_REQUIRES, PASS_RATIO, analysisPending, askLesson, discuss, expertsFor, isUnlocked, theoryProgress, photographerOf, projectOf, referenceText, referencedIds, sourcesFor, sourcesForImage,
} from "./domain.js";

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
function jobBadge() { const b = $("#jobs"); if (b) { b.hidden = !jobs.running; b.textContent = `KI arbeitet … ${jobs.running}`; } }
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
    const m = line.trim().match(/^::(kurz|merke|schau|bild|vergleich|skizze)\s+(.*)$/);
    if (!m) { buf.push(line); continue; }
    flush();
    const [head, ...caps] = m[2].split("|").map(x => x.trim());
    if (m[1] === "kurz") out.push(`<p class="kurz">${inlineMd(m[2])}</p>`);
    else if (m[1] === "merke") out.push(`<div class="merke"><span>Merke</span>${inlineMd(m[2])}</div>`);
    else if (m[1] === "schau") out.push(`<div class="schau"><span>Schau hin</span>${inlineMd(m[2])}</div>`);
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
    return `<a class="ref" href="#source-${id}" data-src="${id}">${nums.get(+id)}</a>`; }).join("")}</sup>`);
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
  <section class="level"><h3><span class="num">1</span> Was zu sehen ist</h3><p>${esc(a.seen || "—")}</p></section>
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
      ${DRILLABLE.map(d => isUnlocked(prog, d.key)
        ? `<label class="dim"><input type="radio" name="dimension" value="${d.key}" ${d === open[0] ? "checked" : ""}>
        <b>${d.label}</b><span>${d.q}</span><em class="muted">${counts[d.key] || 0} geübt</em></label>`
        : `<a class="dim locked" href="#/theorie/${d.key}"><span class="lock">🔒</span><b>${d.label}</b><span>Erst die Lektion „${d.label}“ abschließen.</span></a>`).join("")}
      ${open.length > 1 ? `<label class="dim"><input type="radio" name="dimension" value="mixed"><b>Gemischt</b><span>Jedes Bild mit einem freigeschalteten Aspekt.</span></label>` : ""}
    </div></fieldset>
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
  <div><h2>${d.label}: Analyse</h2>${an ? `<p>${esc(referenceText(an.data, d.field) || "Die gespeicherte Analyse (ältere Version) behandelt diesen Aspekt nicht – auf der Bildseite neu erzeugen.")}</p>
    <details><summary>Ganze Analyse</summary>${analysisBody(an.data)}</details>` : `<p class="pending">Analyse wird erzeugt …</p>`}
    ${concepts.length ? `<h3>Begriffe dazu</h3><ul>${concepts.map(c => `<li><a href="#/begriffe/${c.id}">${esc(c.name)}</a></li>`).join("")}</ul>` : ""}</div></div>
  ${expertsBlock(img)}${await discussionBlock(img)}${artistCard(photographerOf(img))}
  ${sourcesBlock(sourcesForImage(img), { scope: "image" })}
  ${inSession ? nextButton("drill-next", st.pos + 1 < st.items.length) : `<p><a href="#/sehen">Zurück zu Sehen lernen</a></p>`}`;
};
const nextButton = (action, more, top = false) => `<div class="next${top ? " top" : ""}"><button data-action="${action}">${more ? "Nächstes Bild →" : "Runde abschließen"}</button></div>`;

const imageHeader = img => `<h1>${esc(img.title || "Ohne Titel")} <span class="muted">· ${esc(photographerOf(img).name)}${img.year ? `, ${img.year}` : ""}</span></h1>
  <figure class="hero">${media(img.id, "m")}<figcaption><a href="#/bild/${img.id}">Bildseite</a> · <a href="${esc(img.source_url)}" target="_blank" rel="noopener noreferrer">Quelle</a></figcaption></figure>`;

// --- theory course
views.theorie = async () => {
  const prog = await theoryProgress();
  const done = lib.lessons.filter(l => prog[l.id]?.passed).length;
  const next = lib.lessons.find(l => !prog[l.id]?.passed);
  return `<h1>Theorie</h1>
  <p class="lead">Ein Kurs in ${lib.lessons.length} Lektionen: Beschreibung, Erklärung, Beispiele, Abschlusstest. Erst wenn eine Lektion bestanden ist, öffnet sich die Sehübung dazu.</p>
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
  const page = `<p class="crumbs"><a href="#/theorie">Theorie</a> › Lektion ${l.order}</p>
  <h1>${esc(l.title)} ${prog?.passed ? `<span class="status reviewed">bestanden</span>` : ""}</h1>
  <nav class="toc"><a href="#" data-toc="Beschreibung">Beschreibung</a>${l.sections.map(x => `<a href="#" data-toc="${esc(x.heading)}">${esc(x.heading)}</a>`).join("")}
    <a href="#" data-toc="Beispiele">Beispiele</a><a href="#" data-toc="Abschlusstest">Abschlusstest</a></nav>
  <article class="chapter lesson">
    <h3 data-h="Beschreibung">Beschreibung</h3><div class="prose">${rich(l.intro_md)}</div>
    ${l.sections.map((x, n) => `<section class="lsec"><h3 data-h="${esc(x.heading)}"><span class="num">${n + 1}</span>${esc(x.heading)}</h3><div class="prose">${rich(x.body_md)}</div></section>`).join("")}
    ${(l.photographers || []).length ? `<h3>Fotografen im Porträt</h3>${l.photographers.map(pid => { const p = lib.by.photographers.get(pid); if (!p) return "";
      const imgs = lib.images.filter(i => i.photographer_id === pid).slice(0, 6);
      return `<div class="profile">${artistCard(p, true)}${p.method_md ? `<p class="small"><b>Arbeitsweise:</b></p><div class="prose small">${md(p.method_md)}</div>` : ""}
        ${p.signature_md ? `<p class="small"><b>Handschrift – woran man die Bilder erkennt</b> <span class="muted">(Einschätzung)</span></p><div class="prose small">${md(p.signature_md)}</div>` : ""}
        ${imgs.length ? `<div class="thumbs mini">${imgs.map(i => `<a class="thumb" href="#/bild/${i.id}">${media(i.id)}</a>`).join("")}</div>` : ""}</div>`; }).join("")}` : ""}
    <h3>Beispiele</h3>
    ${l.examples.map(e => { const i = lib.by.images.get(e.image_id); return i ? `<figure class="key-image example">
      <a href="#/bild/${i.id}">${media(i.id, "m")}</a><figcaption><b>${esc(photographerOf(i).name)}</b> – ${esc(i.title || "Ohne Titel")}${i.year ? `, ${i.year}` : ""}
      <div class="prose">${md(e.caption_md)}</div>
      ${(e.look_for || []).length ? `<ul class="look-for">${e.look_for.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</figcaption></figure>` : ""; }).join("")}
    <h3>Merksätze</h3><ul class="takeaways">${l.takeaways.map(t => `<li>${md(t).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>
    <h3>Übungen für unterwegs</h3><ul>${l.exercises.map(t => `<li>${md(t).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>
    ${concepts.length ? `<p class="small">Seh-Begriffe dazu: ${concepts.map(c => `<a href="#/begriffe/${c.id}" class="tag">${esc(c.name)}</a>`).join(" ")}</p>` : ""}
  </article>
  <section class="card quiz" id="quiz"><h3>Abschlusstest</h3>
    <p class="muted small">${l.quiz.length} Fragen · bestanden ab ${Math.ceil(l.quiz.length * PASS_RATIO)} richtigen Antworten${prog ? ` · bisher bestes Ergebnis ${prog.best}/${prog.total}` : ""}</p>
    <form data-action="quiz" data-id="${id}">${l.quiz.map((q, n) => `<fieldset class="q" data-n="${n}"><legend>${n + 1}. ${md(q.question).replace(/^<p>|<\/p>$/g, "")}</legend>
      ${q.image_id && lib.by.images.has(q.image_id) ? `<div class="quiz-img">${media(q.image_id, "m")}</div>` : ""}
      ${shuffled(q.options.map((o, k) => [o, k]), `${id}:${n}`).map(([o, k]) => `<label class="radio"><input type="radio" name="q${n}" value="${k}" required> ${md(o).replace(/^<p>|<\/p>$/g, "")}</label>`).join("")}
      <div class="explain" hidden></div></fieldset>`).join("")}
      <button>Auswerten</button></form>
    <div id="quiz-result"></div></section>
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
  return `<h1>Lernrunde</h1><p class="lead">Ein Bild, vier Fragen und eine wechselnde fünfte. Die Analyse bleibt verborgen, bis du geantwortet hast.</p>
  <form data-action="learn-start" class="card grid-form"><fieldset class="wide"><legend>Auswahl</legend>
    <label class="radio"><input type="radio" name="mode" value="random" checked> zufällig</label>
    <label class="radio"><input type="radio" name="mode" value="tag"> nach Schlagwort <select name="tag">${allTags().map(t => `<option>${esc(t)}</option>`).join("")}</select></label>
    <label class="radio"><input type="radio" name="mode" value="chapter"> nach Kapitel <select name="chapter">${lib.chapters.map(c => `<option value="${c.id}">${c.number}. ${esc(c.title)}</option>`).join("")}</select></label></fieldset>
    <label>Erst schauen <select name="look">${LOOK_CHOICES.map(s => `<option value="${s}" ${s === 60 ? "selected" : ""}>${s ? s + " Sekunden" : "ohne Timer"}</option>`).join("")}</select></label>
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
  <div>${expertsBlock(img)}<h2>Analyse <span class="muted small">(KI)</span></h2>${an ? analysisBody(an.data) : `<p class="pending">Analyse wird erzeugt …</p>`}</div></div>
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
async function route(keep = false) {
  const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    const y = window.scrollY;
    // keep what the user is typing when the page re-renders in place
    const typed = keep ? [...main().querySelectorAll("textarea")].map(t => [t.closest("form")?.dataset.action + "|" + t.name, t.value]) : [];
    if (!keep) main().innerHTML = `<p class="muted">Lädt …</p>`;
    try {
      const html = await fn(m, params);
      if (html !== "") {
        main().innerHTML = html; hydrate();
        for (const [k, v] of typed) { const [a, n] = k.split("|"); const t = main().querySelector(`form[data-action="${a}"] textarea[name="${n}"]`); if (t && v) t.value = v; }
        window.scrollTo(0, keep ? y : 0);
      }
    } catch (e) { console.error(e); main().innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    document.querySelectorAll("header nav a").forEach(a => a.classList.toggle("on", location.hash.startsWith(a.getAttribute("href")) && a.getAttribute("href") !== "#/"));
    return;
  }
  main().innerHTML = `<p class="muted">Seite nicht gefunden.</p>`;
}

const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; io.unobserve(e.target); loadImg(e.target);
}), { rootMargin: "400px" }) : null;
function loadImg(el) { mediaUrl(el.dataset.media, el.dataset.kind).then(u => (el.src = u)).catch(() => el.classList.add("broken")); }
function hydrate() {
  document.querySelectorAll("img[data-media]").forEach(el => el.dataset.kind === "m" || !io ? loadImg(el) : io.observe(el));
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
  async "drill-start"(form) {
    const f = new FormData(form), dim = f.get("dimension"), look = Number(f.get("look")); store.set("lookSeconds", look);
    const prog = await theoryProgress();
    const dims = (dim === "mixed" ? DRILLABLE.map(d => d.key) : [dim]).filter(k => isUnlocked(prog, k));
    if (!dims.length) return toast("Erst die Lektion abschließen.");
    startDrill(dims, Number(f.get("size")), look);
  },
  async "drill-quick"(btn) {
    if (!isUnlocked(await theoryProgress(), btn.dataset.dim)) { location.hash = `#/theorie/${btn.dataset.dim}`; return toast("Erst die Lektion abschließen."); }
    startDrill([btn.dataset.dim], 5, Number(store.get("lookSeconds") ?? 60));
  },
  async quiz(form) {
    const l = lib.by.lessons.get(form.dataset.id), f = new FormData(form);
    let right = 0;
    l.quiz.forEach((q, n) => {
      const given = Number(f.get("q" + n)), fs = form.querySelector(`fieldset[data-n="${n}"]`), ok = given === q.correct;
      if (ok) right++;
      fs.classList.toggle("right", ok); fs.classList.toggle("wrong", !ok);
      const ex = fs.querySelector(".explain"); ex.hidden = false;
      ex.innerHTML = `${ok ? "✓ Richtig." : `✗ Richtig wäre: <b>${md(q.options[q.correct]).replace(/^<p>|<\/p>$/g, "")}</b>.`} ${md(q.explanation).replace(/^<p>|<\/p>$/g, "")}`;
    });
    const total = l.quiz.length, passed = right >= Math.ceil(total * PASS_RATIO);
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
    bg(() => evaluate("drills", drill, async () => {
      const an = await generateAnalysis(img); rerenderIf(drill.id);
      return { analysis_version: an.version, ...await drillFeedback(img, d, an.data, drill.answer) };
    }));
    location.hash = `#/sehen/r/${drill.id}`;
  },
  async "drill-retry"(btn) {
    const dr = await findItem("drills", btn.dataset.id), img = lib.by.images.get(dr.image_id);
    pendingItems.set(dr.id, { ...dr, error: undefined }); route();
    bg(() => evaluate("drills", pendingItems.get(dr.id), async () => {
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
    const done = new Set((await loadState("answers", [])).map(a => a.image_id));
    const ids = [...shuffle(pool.filter(i => !done.has(i.id))), ...shuffle(pool.filter(i => done.has(i.id)))].slice(0, Number(f.get("size"))).map(i => i.id);
    if (!ids.length) return toast("Für diese Auswahl gibt es keine Bilder.");
    sess.set("learn", { ids, pos: 0, look: Number(f.get("look")), seed: Math.floor(Math.random() * 4), done: [] });
    prefetch(ids);
    location.hash = "#/lernen/runde";
  },
  async "learn-answer"(form) {
    const img = lib.by.images.get(form.dataset.img), f = new FormData(form);
    const a = { id: uid(), image_id: img.id, created_at: new Date().toISOString(), look_seconds: Number(form.dataset.looked || 0) };
    for (const k of ["q_position", "q_wait", "q_omitted", "q_different", "q_extra_label", "q_extra"]) a[k] = (f.get(k) || "").trim();
    pendingItems.set(a.id, a);
    const st = sess.get("learn"); if (st) { st.done = [...(st.done || []), a.id]; sess.set("learn", st); }
    bg(() => mutateState("answers", [], s => [...s, a], "Lernantwort"));
    bg(() => evaluate("answers", a, async () => {
      const an = await generateAnalysis(img); rerenderIf(a.id);
      const fb = await learnFeedback(an.data, a);
      return { analysis_version: an.version, ...fb };
    }));
    location.hash = `#/lernen/r/${a.id}`;
  },
  async "learn-retry"(btn) {
    const a = await findItem("answers", btn.dataset.id), img = lib.by.images.get(a.image_id);
    pendingItems.set(a.id, { ...a, error: undefined }); route();
    bg(() => evaluate("answers", pendingItems.get(a.id), async () => {
      const an = await generateAnalysis(img);
      return { analysis_version: an.version, ...await learnFeedback(an.data, a) };
    }));
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

function startDrill(dims, size, look) {
  loadState("drills", []).then(drills => {
    const done = new Set(drills.map(d => d.image_id + "|" + d.dimension));
    const pool = shuffle(lib.images.slice()).sort((a, b) => dims.some(d => done.has(a.id + "|" + d)) - dims.some(d => done.has(b.id + "|" + d)));
    const items = pool.slice(0, size).map(i => [i.id, dims[Math.floor(Math.random() * dims.length)]]);
    sess.set("drill", { items, pos: 0, look, done: [] });
    prefetch(items.map(([id]) => id));
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
