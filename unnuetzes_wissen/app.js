// Unnützes Wissen – Fakten-App. Alle persönlichen Angaben bleiben im localStorage dieses Geräts.
(() => {
  "use strict";
  const CFG = window.UW_CONFIG || {};
  const KEY = (CFG.storagePrefix || "uw_") + "state";
  const app = document.getElementById("app");
  const tabs = document.getElementById("tabs");
  const sheet = document.getElementById("sheet");
  const sheetInner = sheet.querySelector(".sheet-inner");

  // ---------- Hilfsfunktionen ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const paras = t => String(t || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const fmtDate = d => {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (!m) return esc(d);
    return m[3] ? `${+m[3]}.${+m[2]}.${m[1]}` : m[2] ? `${+m[2]}/${m[1]}` : m[1];
  };
  const toast = (msg, ms = 2200) => {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  };

  // ---------- Zustand ----------
  const freshState = () => ({
    v: 1,
    onboarded: false,
    profile: {
      interests: [], depth: "neugierig", humor: null, gross: false,
      birthYear: null, birthDay: null, job: null, hobbies: [],
      home: null, birth: null, extraPlaces: [...(CFG.defaultPlaces || [])], useLocation: false,
      sexuality: null, queer: false,
      exclude: { politik: false, krieg: false, krankheit: false },
      answers: {}, never: {}, kidsMode: false
    },
    catW: {}, tagW: {}, seen: {}, ratings: {}, saved: [], reported: [], wishes: [],
    perDay: CFG.factsPerDay || 100,
    day: null, curPlace: null, lastQuestion: null
  });
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || freshState(); } catch { S = freshState(); }
  S = Object.assign(freshState(), S);
  S.profile = Object.assign(freshState().profile, S.profile);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

  // ---------- Daten ----------
  let TAX = { categories: [], jobs: [], hobbies: [], places: [], questions: [] };
  let FACTS = [];
  const BY = new Map();
  let PACK_PLACES = new Set();
  const cat = id => TAX.categories.find(c => c.id === id) || { id, name: id, icon: "•" };
  const place = id => TAX.places.find(p => p.id === id);
  const placeName = p => p ? (p.id ? (place(p.id)?.name || p.name) : p.name) : "";

  async function loadData() {
    const [tax, idx] = await Promise.all([
      fetch("data/taxonomy.json", { cache: "no-cache" }).then(r => r.json()),
      fetch("data/index.json", { cache: "no-cache" }).then(r => r.json())
    ]);
    TAX = tax;
    const packs = await Promise.all(idx.packs.map(p =>
      fetch(`data/${p.file}?v=${encodeURIComponent(idx.version)}`).then(r => r.json()).catch(() => [])));
    FACTS = packs.flat();
    FACTS.forEach(f => BY.set(f.id, f));
    PACK_PLACES = new Set(idx.packs.filter(p => p.place).map(p => p.place));
  }

  // ---------- Auswahl & Gewichtung ----------
  function profileTags() {
    const p = S.profile, m = {};
    const add = (tags, w) => (tags || []).forEach(t => { m[t] = (m[t] || 0) + w; });
    add(TAX.jobs.find(j => j.name === p.job)?.tags, 1.5);
    p.hobbies.forEach(h => add(TAX.hobbies.find(x => x.name === h)?.tags, 1));
    if (p.queer) add(["queer"], 2.5);
    for (const q of TAX.questions) {
      const opt = q.options.find(o => o.value === p.answers[q.id]);
      if (opt) add(opt.tags, 0.8);
    }
    return m;
  }
  function profileEra() {
    const q = TAX.questions.find(q => q.id === "era");
    return q?.options.find(o => o.value === S.profile.answers.era)?.era || null;
  }
  const catWeight = c => S.catW[c] ?? (S.profile.interests.includes(c) ? 3 : 1);

  function eligible(f) {
    const p = S.profile;
    if (S.reported.includes(f.id)) return false;
    if (f.sensitive && p.exclude[f.sensitive]) return false;
    if (f.gross && !p.gross) return false;
    if (f.expires && f.expires < today()) return false;
    return true;
  }
  function activePlaces() {
    const p = S.profile, s = new Set(p.extraPlaces);
    [p.home, p.birth].forEach(x => x?.id && s.add(x.id));
    if (S.curPlace) s.add(S.curPlace);
    return s;
  }
  function score(f, pt, era) {
    let s = f.category === "ort" || f.category === "aktuell" ? 2.5 : catWeight(f.category);
    for (const t of f.tags || []) s += (pt[t] || 0) + (S.tagW[t] || 0);
    if (era && f.era === era) s += 1;
    if (S.profile.kidsMode && f.kids) s += 0.5;
    return Math.max(0.1, s);
  }
  // Mischt so, dass möglichst nie zwei Karten derselben Kategorie aufeinander folgen
  function spread(list) {
    const left = [...list], out = [];
    while (left.length) {
      const last = out.at(-1)?.category;
      let i = left.findIndex(f => f.category !== last);
      if (i < 0) i = 0;
      out.push(left.splice(i, 1)[0]);
    }
    return out;
  }
  function buildDeck(n, exclude = new Set()) {
    const pt = profileTags(), era = profileEra(), places = activePlaces();
    const pool = FACTS.filter(f => !S.seen[f.id] && !exclude.has(f.id) && eligible(f) && (!f.place || places.has(f.place)));
    const ranked = arr => arr.map(f => ({ f, s: score(f, pt, era) * (0.55 + Math.random() * 0.9) })).sort((a, b) => b.s - a.s).map(x => x.f);
    const akt = ranked(pool.filter(f => f.category === "aktuell"));
    const loc = ranked(pool.filter(f => f.place));
    const rest = ranked(pool.filter(f => !f.place && f.category !== "aktuell"));
    const chosen = [...akt.slice(0, Math.round(n * 0.2)), ...loc.slice(0, Math.round(n * 0.4))];
    const used = new Set(chosen.map(f => f.id));
    for (const f of [...rest, ...loc, ...akt]) {
      if (chosen.length >= n) break;
      if (!used.has(f.id)) { chosen.push(f); used.add(f.id); }
    }
    // Reihenfolge: nach Gewicht mit Zufall, dann Kategorien verteilen
    return spread(ranked(chosen)).map(f => f.id);
  }
  function ensureDay() {
    if (S.day && S.day.date === today()) return;
    let ids = buildDeck(S.perDay);
    // Am Geburtstag: die bestpassenden Fakten zuerst (ohne Zufall)
    if (S.profile.birthDay && today().slice(5) === S.profile.birthDay) {
      const pt = profileTags(), era = profileEra();
      ids = [...ids].sort((a, b) => score(BY.get(b), pt, era) - score(BY.get(a), pt, era));
      ids = spread(ids.map(id => BY.get(id))).map(f => f.id);
    }
    S.day = { date: today(), ids, pos: 0, breaks: {}, bonus: 0, asked: false };
    save();
  }

  // Nach Profiländerungen: Gelesenes behalten, den Rest des Tages neu zusammenstellen
  function rebuildRest() {
    if (!S.day || S.day.date !== today()) { S.day = null; return; }
    const keep = S.day.ids.slice(0, S.day.pos);
    S.day.ids = keep.concat(buildDeck(Math.max(0, S.perDay - keep.length), new Set(keep)));
    S.day.bonus = 0;
  }

  function learn(f, kind) {
    const d = { neu: [0.25, 0.15], kannte: [-0.05, -0.03], langweilig: [-0.4, -0.25] }[kind];
    if (!d) return;
    if (f.category !== "ort" && f.category !== "aktuell") S.catW[f.category] = clamp(catWeight(f.category) + d[0], 0.2, 6);
    for (const t of f.tags || []) S.tagW[t] = clamp((S.tagW[t] || 0) + d[1], -2, 3);
  }

  // ---------- Standort ----------
  const distKm = (a, b) => {
    const R = 6371, r = x => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  function locate(ask = false) {
    if (!S.profile.useLocation || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const hit = TAX.places.map(p => ({ p, d: distKm(here, p) })).filter(x => x.d <= x.p.radiusKm).sort((a, b) => a.d - b.d)[0];
      const id = hit?.p.id || null;
      if (id !== S.curPlace) {
        S.curPlace = id;
        if (id && !PACK_PLACES.has(id)) wish("place", hit.p.name);
        save();
        if (route === "heute") render();
      }
    }, () => { if (ask) toast("Standort nicht verfügbar – du kannst Orte auch von Hand wählen."); },
    { enableHighAccuracy: false, maximumAge: 3600e3, timeout: 15000 });
  }
  function wish(type, value) {
    if (!value || S.wishes.some(w => w.type === type && w.value === value)) return;
    S.wishes.push({ type, value, date: today() });
  }

  // ---------- Bausteine ----------
  const chip = f => {
    const c = cat(f.category);
    const where = f.place ? ` · ${esc(place(f.place)?.name || f.place)}` : "";
    return `<span class="chip">${c.icon} ${esc(c.name)}${where}</span>`;
  };
  const isSaved = id => S.saved.includes(id);

  function cardHTML(f, opts = {}) {
    return `<article class="card enter" data-id="${esc(f.id)}" tabindex="0" aria-label="${esc(f.headline)}">
      ${chip(f)}
      ${opts.noSave ? "" : `<button class="save-btn ${isSaved(f.id) ? "on" : ""}" data-a="save" data-v="${esc(f.id)}" aria-label="Merken" aria-pressed="${isSaved(f.id)}">${isSaved(f.id) ? "★" : "☆"}</button>`}
      <h2>${esc(f.headline)}</h2>
      <p class="teaser">${esc(f.teaser)}</p>
      <button class="link-btn more" data-a="detail" data-v="${esc(f.id)}">Mehr dazu & Quelle →</button>
    </article>`;
  }
  const rateHTML = (a = "rate") => `<div class="rate">
      <button class="btn" data-a="${a}" data-v="kannte">Kannte ich</button>
      <button class="btn primary" data-a="${a}" data-v="neu">Neu!</button>
      <button class="btn" data-a="${a}" data-v="langweilig">Langweilig</button>
    </div>`;

  // Wischen = weiter, Tippen = Details
  function bindCard(onSwipe) {
    const el = app.querySelector(".card");
    if (!el) return;
    let x0 = null, y0 = 0, dx = 0;
    el.addEventListener("pointerdown", e => { if (e.target.closest("button")) return; x0 = e.clientX; y0 = e.clientY; dx = 0; el.style.transition = "none"; });
    el.addEventListener("pointermove", e => {
      if (x0 === null) return;
      dx = e.clientX - x0;
      if (Math.abs(dx) > Math.abs(e.clientY - y0)) el.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
    });
    const end = () => {
      if (x0 === null) return;
      el.style.transition = ""; x0 = null;
      if (Math.abs(dx) > 90 && onSwipe) { el.classList.add(dx < 0 ? "leave-left" : "leave-right"); setTimeout(onSwipe, 200); }
      else { el.style.transform = ""; if (Math.abs(dx) < 6) openDetail(el.dataset.id); }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", () => { x0 = null; el.style.transform = ""; el.style.transition = ""; });
    el.addEventListener("keydown", e => { if (e.key === "Enter") openDetail(el.dataset.id); });
  }

  // ---------- Detail ----------
  function openSheet(html) {
    sheetInner.innerHTML = `<div class="sheet-grip"></div><button class="sheet-close" data-a="close" aria-label="Schließen">✕</button>${html}`;
    if (sheet.hidden) { sheet.hidden = false; history.pushState({ sheet: 1 }, ""); }
    sheetInner.scrollTop = 0;
  }
  function closeSheet(fromPop) {
    if (sheet.hidden) return;
    sheet.hidden = true; sheetInner.innerHTML = "";
    if (!fromPop && history.state?.sheet) history.back();
    render();
  }
  window.addEventListener("popstate", () => closeSheet(true));
  sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });

  function openDetail(id, full = S.profile.depth !== "einsteiger") {
    const f = BY.get(id);
    if (!f) return;
    const ps = paras(f.detail);
    const shown = full ? ps : ps.slice(0, 1);
    const srcs = (f.sources || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">
        <div class="pub">${esc(s.publisher || new URL(s.url).hostname)}${s.date ? " · " + fmtDate(s.date) : ""}</div>
        <div class="t">${esc(s.title || s.url)} ↗</div></a></li>`).join("");
    const map = CFG.instaMapUrl && f.place === "hongkong" ? `<a class="btn" href="${esc(CFG.instaMapUrl)}">🗺️ Insta-Map</a>` : "";
    openSheet(`<div class="detail">
      ${chip(f)}
      <h2>${esc(f.headline)}</h2>
      <div class="body">${shown.map(p => `<p>${esc(p)}</p>`).join("")}</div>
      ${!full && ps.length > 1 ? `<button class="link-btn" data-a="detail-full" data-v="${esc(f.id)}">Weiterlesen</button>` : ""}
      <div class="section-title">Quelle${(f.sources || []).length > 1 ? "n" : ""}</div>
      <ul class="sources">${srcs}</ul>
      <p class="small muted" style="margin-top:12px">${f.verified ? `Gegengeprüft am ${fmtDate(f.verified)}.` : ""}</p>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn" data-a="save" data-v="${esc(f.id)}">${isSaved(f.id) ? "★ Gemerkt" : "☆ Merken"}</button>
        <button class="btn" data-a="share" data-v="${esc(f.id)}">↗ Weitererzählen</button>
        ${map}
      </div>
      <button class="btn ghost block" style="margin-top:8px" data-a="report" data-v="${esc(f.id)}">Stimmt nicht?</button>
    </div>`);
  }

  // ---------- Heute ----------
  function viewToday() {
    ensureDay();
    const d = S.day, R = CFG.roundSize || 20;
    const total = d.ids.length;
    const rounds = Math.max(1, Math.ceil(d.ids.length / R));
    const loc = S.curPlace ? place(S.curPlace) : null;
    const where = loc ? `📍 ${esc(loc.name)}${PACK_PLACES.has(loc.id) ? "" : " (noch keine Ortsfakten)"}` : "";

    if (!d.ids.length) {
      return `<div class="center"><div class="big-emoji">📚</div><h1>Alles gelesen</h1>
        <p class="muted">Du hast alle geprüften Fakten gesehen, die gerade zu dir passen. Nachschub wird recherchiert.</p>
        <button class="btn" data-a="tab" data-v="kategorien">Kategorien durchstöbern</button></div>`;
    }
    // Zwischenstand nach jeder Runde
    if (d.pos > 0 && d.pos < d.ids.length && d.pos % R === 0 && !d.breaks[d.pos]) return viewBreak(d.pos / R, rounds);
    if (d.pos >= d.ids.length) return viewDone();

    const f = BY.get(d.ids[d.pos]);
    if (!f) { d.pos++; save(); return viewToday(); }
    const round = Math.floor(d.pos / R) + 1;
    const bday = S.profile.birthDay && today().slice(5) === S.profile.birthDay && d.pos < R
      ? `<div class="privacy" style="margin-bottom:12px"><span>🎂</span><span><strong>Alles Gute zum Geburtstag!</strong> Heute gibt es die Fakten, die am besten zu dir passen, zuerst.</span></div>` : "";
    return `<div class="topbar"><h1 style="margin:0">Heute</h1><span class="where">${where}</span></div>
      <div class="round-label"><span>Runde ${round} von ${rounds}</span><span>${d.pos + 1} / ${total}</span></div>
      <div class="progress"><i style="width:${(d.pos / total) * 100}%"></i></div>
      ${bday}${cardHTML(f)}
      ${rateHTML()}
      <p class="hint">Antippen für mehr · zur Seite wischen zum Überspringen</p>`;
  }

  function roundBest(from, to) {
    const ids = S.day.ids.slice(from, to);
    return ids.find(id => S.ratings[id] === "neu") || ids.find(isSaved) || ids[0];
  }
  function nextQuestion() {
    if (S.day.asked || S.lastQuestion === today()) return null;
    return TAX.questions.find(q => !S.profile.answers[q.id] && !S.profile.never[q.id]);
  }
  function viewBreak(n, rounds) {
    const R = CFG.roundSize || 20;
    const best = BY.get(roundBest(S.day.pos - R, S.day.pos));
    const q = nextQuestion();
    return `<div class="center">
      <div class="big-emoji">☕</div>
      <h1>Runde ${n} von ${rounds} geschafft</h1>
      <p class="muted">Kurz durchatmen – oder gleich weiter.</p>
      ${best ? `<div class="best"><div class="small muted">Dein Fakt der Runde</div><strong>${esc(best.headline)}</strong>
        <div><button class="link-btn" data-a="detail" data-v="${esc(best.id)}">Nochmal lesen →</button></div></div>` : ""}
      ${q ? questionHTML(q) : ""}
      <button class="btn primary block" data-a="next-round">Nächste Runde</button>
    </div>`;
  }
  function questionHTML(q) {
    return `<div class="question"><div class="small muted">Kurze Frage, damit die Fakten besser passen</div>
      <p style="font-weight:600;margin:6px 0 12px">${esc(q.text)}</p>
      <div class="pills">${q.options.map(o => `<button class="pill" data-a="answer" data-q="${esc(q.id)}" data-v="${esc(o.value)}">${esc(o.label)}</button>`).join("")}</div>
      <div class="btn-row" style="margin-top:8px"><button class="btn ghost" data-a="q-later">Später</button><button class="btn ghost" data-a="q-never" data-v="${esc(q.id)}">Nie fragen</button></div>
    </div>`;
  }
  function viewDone() {
    const d = S.day;
    const top = d.ids.filter(id => S.ratings[id] === "neu").slice(0, 3).map(id => BY.get(id)).filter(Boolean);
    const more = d.bonus === 0 && buildDeck(1, new Set(d.ids)).length > 0;
    const short = d.ids.length < S.perDay;
    return `<div class="center">
      <div class="big-emoji">🎉</div>
      <h1>Für heute durch</h1>
      <p class="muted">${d.ids.length} Fakten gelesen. Morgen früh liegt ein neuer Stapel bereit.</p>
      ${short ? `<p class="small muted">Heute waren es weniger als ${S.perDay}, weil gerade nicht mehr geprüfte Fakten zu dir passen. Nachschub wird recherchiert.</p>` : ""}
      ${top.length ? `<div class="section-title">Zum Weitererzählen</div><div class="list">${top.map(f => `
        <button class="row" data-a="detail" data-v="${esc(f.id)}"><span class="ico">${cat(f.category).icon}</span>
          <span class="grow"><span class="title">${esc(f.headline)}</span></span></button>`).join("")}</div>` : ""}
      ${more ? `<button class="btn block" style="margin-top:20px" data-a="bonus">Noch ${CFG.bonusSize || 5}</button>` : ""}
    </div>`;
  }

  function advance(kind) {
    const d = S.day, id = d.ids[d.pos], f = BY.get(id);
    if (f) {
      S.seen[id] = Date.now();
      if (kind) { S.ratings[id] = kind; learn(f, kind); }
    }
    d.pos++;
    save();
    const el = app.querySelector(".card");
    if (el && kind) { el.classList.add(kind === "langweilig" ? "leave-left" : "leave-right"); setTimeout(render, 180); }
    else render();
  }

  // ---------- Kategorien ----------
  function viewCategories(sel) {
    if (sel) {
      const list = FACTS.filter(f => (sel.startsWith("place:") ? f.place === sel.slice(6) : f.category === sel) && eligible(f));
      const title = sel.startsWith("place:") ? `📍 ${esc(place(sel.slice(6))?.name || sel.slice(6))}` : `${cat(sel).icon} ${esc(cat(sel).name)}`;
      return `<button class="link-btn" data-a="tab" data-v="kategorien">← Alle Kategorien</button>
        <h1>${title}</h1><p class="muted small">${list.length} Fakten · ${list.filter(f => S.seen[f.id]).length} gelesen</p>
        <div class="list">${list.map(f => `<button class="row" data-a="detail" data-v="${esc(f.id)}">
          <span class="grow"><span class="title">${esc(f.headline)}</span>${S.seen[f.id] ? `<div class="sub">gelesen</div>` : ""}</span>
          ${isSaved(f.id) ? "★" : ""}</button>`).join("") || `<p class="muted">Hier gibt es noch keine Fakten.</p>`}</div>`;
    }
    const cats = TAX.categories.filter(c => c.id !== "ort").map(c => ({ c, n: FACTS.filter(f => f.category === c.id && !f.place && eligible(f)).length })).filter(x => x.n);
    const places = [...PACK_PLACES].map(id => ({ p: place(id), n: FACTS.filter(f => f.place === id && eligible(f)).length }));
    return `<h1>Kategorien</h1>
      <div class="section-title">Orte</div>
      <div class="list">${places.map(x => `<button class="row" data-a="cat" data-v="place:${esc(x.p?.id)}"><span class="ico">📍</span>
        <span class="grow"><span class="title">${esc(x.p?.name)}</span><div class="sub">${x.n} Fakten</div></span></button>`).join("")}</div>
      <div class="section-title">Themen</div>
      <div class="list">${cats.map(x => `<button class="row" data-a="cat" data-v="${esc(x.c.id)}"><span class="ico">${x.c.icon}</span>
        <span class="grow"><span class="title">${esc(x.c.name)}</span><div class="sub">${x.n} Fakten</div></span></button>`).join("")}</div>`;
  }

  // ---------- Gemerkt ----------
  function viewSaved() {
    const list = S.saved.map(id => BY.get(id)).filter(Boolean).reverse();
    return `<h1>Gemerkt</h1>${list.length ? `<div class="list">${list.map(f => `<button class="row" data-a="detail" data-v="${esc(f.id)}">
        <span class="ico">${cat(f.category).icon}</span><span class="grow"><span class="title">${esc(f.headline)}</span>
        <div class="sub">${esc(f.teaser)}</div></span></button>`).join("")}</div>`
      : `<p class="muted">Tippe auf ☆ bei einem Fakt, um ihn hier zu sammeln – zum Nachlesen oder Weitererzählen.</p>`}`;
  }

  // ---------- Profil ----------
  function viewProfile() {
    const p = S.profile;
    const read = Object.keys(S.seen).length, neu = Object.values(S.ratings).filter(r => r === "neu").length;
    const sum = (step, title, sub) => `<button class="row" data-a="edit" data-v="${step}"><span class="grow"><span class="title">${title}</span><div class="sub">${sub || "–"}</div></span>›</button>`;
    const places = [placeName(p.home), placeName(p.birth), ...p.extraPlaces.map(id => place(id)?.name)].filter(Boolean);
    return `<h1>Profil</h1>
      <p class="muted">${read} Fakten gelesen · ${neu} davon neu für dich</p>
      <div class="privacy"><span>🔒</span><span>Alle Angaben bleiben nur auf diesem Gerät. Nichts davon wird verschickt.</span></div>
      <div class="section-title">Deine Angaben</div>
      <div class="list">
        ${sum(1, "Interessen", p.interests.map(i => cat(i).name).join(", "))}
        ${sum(3, "Stil", [{ einsteiger: "Einsteiger", neugierig: "Neugierig", nerd: "Volle Nerd-Dosis" }[p.depth], p.gross ? "darf eklig sein" : "nicht eklig"].join(" · "))}
        ${sum(4, "Über dich", [p.birthYear, p.job, p.hobbies.slice(0, 3).join(", ")].filter(Boolean).join(" · "))}
        ${sum(5, "Orte", places.join(", ") + (p.useLocation ? " · Standort an" : ""))}
        ${sum(6, "Persönliches & Ausschlüsse", Object.entries(p.exclude).filter(([, v]) => v).map(([k]) => "ohne " + k).join(", ") || "keine Ausschlüsse")}
      </div>
      <div class="section-title">Fakten pro Tag</div>
      <div class="pills">${[20, 50, 100].map(n => `<button class="pill" data-a="perday" data-v="${n}" aria-pressed="${S.perDay === n}">${n}</button>`).join("")}</div>
      ${S.wishes.length ? `<div class="section-title">Deine Wünsche</div><p class="small muted">Werden in einer späteren Version an die Recherche übermittelt: ${S.wishes.map(w => esc(w.value)).join(", ")}</p>` : ""}
      <div class="section-title">Über die App</div>
      <p class="small muted">Jeder Fakt wird mit Quelle recherchiert und von einem zweiten, unabhängigen Durchlauf an dieser Quelle gegengeprüft. Was sich nicht belegen lässt, fliegt raus. Falls trotzdem etwas nicht stimmt: „Stimmt nicht?“ in der Detailansicht.</p>
      <div class="list">
        <button class="row" data-a="onboarding"><span class="grow"><span class="title">Einführung erneut starten</span></span>›</button>
        <button class="row" data-a="reset"><span class="grow"><span class="title" style="color:var(--bad)">Alle Daten löschen</span><div class="sub">Profil, Gelesenes und Gemerktes</div></span></button>
      </div>`;
  }

  // ---------- Onboarding ----------
  const OB_STEPS = 8;
  let ob = { step: 0, calib: [], ci: 0, editing: false };

  function obStep(i) {
    const p = S.profile;
    switch (i) {
      case 0: return {
        body: `<div class="big-emoji">🤓</div><h1>Unnützes Wissen</h1>
          <p>Jeden Tag ein Stapel überraschender Fakten – zum Staunen und Weitererzählen. Statt endlos zu scrollen gibt es Runden zu ${CFG.roundSize || 20} Karten, und irgendwann ist Schluss für heute.</p>
          <p>Jeder Fakt hat eine Quelle. Ein Tipp auf die Karte zeigt die ganze Geschichte.</p>
          <div class="privacy"><span>🔒</span><span>Gleich ein paar Fragen, damit die Fakten zu dir passen. Fast alles ist freiwillig, und <strong>deine Angaben bleiben auf diesem Gerät</strong>.</span></div>`,
        next: "Los geht's" };
      case 1: {
        const n = p.interests.length;
        return {
          body: `<h1>Was interessiert dich?</h1><p class="muted">Wähle mindestens 3 Themen.</p>
            <div class="tiles">${TAX.categories.filter(c => c.interest).map(c => `<button class="tile" data-a="ob-int" data-v="${c.id}" aria-pressed="${p.interests.includes(c.id)}">
              <span class="ico">${c.icon}</span>${esc(c.name)}</button>`).join("")}</div>`,
          next: n >= 3 ? "Weiter" : `Noch ${3 - n} auswählen`, disabled: n < 3 };
      }
      case 2: {
        if (!ob.calib.length) ob.calib = calibFacts();
        if (ob.ci >= ob.calib.length) return { body: `<h1>Danke!</h1><p>Das hilft schon sehr. Jetzt noch ein paar Fragen zum Stil.</p>`, next: "Weiter" };
        const f = BY.get(ob.calib[ob.ci]);
        return {
          body: `<h1>Kanntest du das?</h1><p class="muted">${ob.ci + 1} von ${ob.calib.length} – so lernt die App schnell, was dich überrascht.</p>
            <div class="calib">${cardHTML(f, { noSave: true })}${rateHTML("ob-rate")}</div>`,
          next: null, skip: "Überspringen" };
      }
      case 3: return {
        body: `<h1>Dein Stil</h1>
          ${pillField("Wie nerdig darf es sein?", "depth", [["einsteiger", "Einsteiger"], ["neugierig", "Neugierig"], ["nerd", "Volle Nerd-Dosis"]], p.depth, "Bei „Einsteiger“ zeigt die Detailansicht erst eine Kurzfassung.")}
          ${pillField("Welcher Humor passt zu dir?", "humor", [["trocken", "Trocken"], ["absurd", "Absurd"], ["wortwitz", "Wortwitz"]], p.humor, "Fließt in künftige Fakten ein.")}
          ${pillField("Darf es auch eklig werden?", "gross", [["ja", "Ja, her damit"], ["nein", "Lieber nicht"]], p.gross ? "ja" : "nein", "Körperflüssigkeiten, Parasiten und Co.")}`,
        next: "Weiter", skip: "Überspringen" };
      case 4: {
        const days = Array.from({ length: 31 }, (_, i) => i + 1), months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
        const [bm, bd] = (p.birthDay || "-").split("-");
        return {
          body: `<h1>Über dich</h1><p class="muted">Alles freiwillig.</p>
            <div class="field"><label for="ob-year">Geburtsjahr</label><input id="ob-year" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" placeholder="z. B. 1990" value="${esc(p.birthYear ?? "")}">
              <span class="help">Für Fakten aus „deiner“ Zeit – kommt mit den nächsten Fakten-Paketen.</span></div>
            <div class="field"><span class="label">Geburtstag</span><div class="inline">
              <select id="ob-bd" aria-label="Tag"><option value="">Tag</option>${days.map(x => `<option ${+bd === x ? "selected" : ""}>${x}</option>`).join("")}</select>
              <select id="ob-bm" aria-label="Monat"><option value="">Monat</option>${months.map((m, i) => `<option value="${i + 1}" ${+bm === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></div>
              <span class="help">An deinem Geburtstag kommen die besten Fakten zuerst.</span></div>
            <div class="field"><label for="ob-job">Job</label><select id="ob-job"><option value="">– keine Angabe –</option>
              ${TAX.jobs.map(j => `<option ${p.job === j.name ? "selected" : ""}>${esc(j.name)}</option>`).join("")}</select></div>
            <div class="field"><span class="label">Hobbys</span><div class="pills">${TAX.hobbies.map(h => `<button class="pill" data-a="ob-hobby" data-v="${esc(h.name)}" aria-pressed="${p.hobbies.includes(h.name)}">${esc(h.name)}</button>`).join("")}</div></div>`,
          next: "Weiter", skip: "Überspringen", collect: collectAbout };
      }
      case 5: {
        const opts = TAX.places.map(x => `<option value="${esc(x.name)}"></option>`).join("");
        const packs = [...PACK_PLACES].map(id => place(id)).filter(Boolean);
        return {
          body: `<h1>Deine Orte</h1><p class="muted">Für Fakten über deine Umgebung.</p>
            <datalist id="ob-places">${opts}</datalist>
            <div class="field"><label for="ob-home">Wohnort</label><input id="ob-home" type="text" list="ob-places" autocomplete="off" placeholder="Stadt suchen" value="${esc(placeName(p.home))}"></div>
            <div class="field"><label for="ob-birth">Geburtsort</label><input id="ob-birth" type="text" list="ob-places" autocomplete="off" placeholder="Stadt suchen" value="${esc(placeName(p.birth))}"></div>
            ${packs.length ? `<div class="field"><span class="label">Orte mit eigenem Fakten-Paket</span><div class="pills">${packs.map(x => `<button class="pill" data-a="ob-place" data-v="${x.id}" aria-pressed="${p.extraPlaces.includes(x.id)}">📍 ${esc(x.name)}</button>`).join("")}</div>
              <span class="help">Zum Beispiel für dein nächstes Reiseziel. Weitere Städte kommen nach und nach.</span></div>` : ""}
            <label class="switch"><span><strong>Standort nutzen</strong><br><span class="small muted">Nur grob die Stadt, bleibt auf dem Gerät.</span></span>
              <input id="ob-loc" type="checkbox" ${p.useLocation ? "checked" : ""}></label>`,
          next: "Weiter", skip: "Überspringen", collect: collectPlaces };
      }
      case 6: {
        const sx = [["", "Möchte ich nicht sagen"], ["hetero", "Heterosexuell"], ["schwul", "Schwul"], ["lesbisch", "Lesbisch"], ["bi", "Bisexuell"], ["pan", "Pansexuell"], ["ace", "Asexuell"], ["queer", "Queer"], ["anders", "Anders"]];
        return {
          body: `<h1>Persönliches</h1><p class="muted">Ganz freiwillig – und nur auf diesem Gerät.</p>
            <div class="field"><label for="ob-sx">Sexualität</label><select id="ob-sx">${sx.map(([v, l]) => `<option value="${v}" ${(p.sexuality || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select>
              <span class="help">Wirkt nur als Interesse: Es macht Themen häufiger, blendet aber nie etwas aus.</span></div>
            <label class="switch"><span>Mehr Fakten zu queerer Geschichte & Kultur</span><input id="ob-queer" type="checkbox" ${p.queer ? "checked" : ""}></label>
            <div class="section-title">Diese Themen nicht zeigen</div>
            <label class="switch"><span>Politik</span><input id="ob-ex-politik" type="checkbox" ${p.exclude.politik ? "checked" : ""}></label>
            <label class="switch"><span>Krieg</span><input id="ob-ex-krieg" type="checkbox" ${p.exclude.krieg ? "checked" : ""}></label>
            <label class="switch"><span>Krankheit</span><input id="ob-ex-krankheit" type="checkbox" ${p.exclude.krankheit ? "checked" : ""}></label>`,
          next: "Weiter", skip: "Überspringen", collect: collectPersonal };
      }
      case 7: return {
        body: `<div class="big-emoji">🚀</div><h1>Alles bereit</h1>
          <p>Dein erster Stapel wartet: bis zu ${S.perDay} Fakten in Runden zu ${CFG.roundSize || 20}.</p>
          <p class="muted">Mit „Neu!“, „Kannte ich“ und „Langweilig“ wird der Stapel jeden Tag besser. Alles lässt sich später unter „Profil“ ändern.</p>`,
        next: "Ersten Stapel öffnen" };
    }
  }
  function pillField(label, key, opts, cur, help) {
    return `<div class="field"><span class="label">${label}</span><div class="pills">${opts.map(([v, l]) =>
      `<button class="pill" data-a="ob-pill" data-k="${key}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join("")}</div>
      ${help ? `<span class="help">${help}</span>` : ""}</div>`;
  }
  function calibFacts() {
    const seenCats = new Set(), out = [];
    const pool = FACTS.filter(f => !f.place && f.category !== "aktuell" && !f.gross && !f.sensitive && !S.seen[f.id])
      .sort(() => Math.random() - 0.5);
    for (const f of pool) { if (out.length >= 8) break; if (!seenCats.has(f.category)) { seenCats.add(f.category); out.push(f.id); } }
    return out;
  }
  const findPlace = name => {
    const n = (name || "").trim();
    if (!n) return null;
    const hit = TAX.places.find(x => x.name.toLowerCase() === n.toLowerCase());
    if (hit) { if (!PACK_PLACES.has(hit.id)) wish("place", hit.name); return { id: hit.id, name: hit.name }; }
    wish("place", n);
    return { id: null, name: n };
  };
  function collectAbout() {
    const p = S.profile, y = parseInt(document.getElementById("ob-year").value, 10);
    p.birthYear = y > 1900 && y <= new Date().getFullYear() ? y : null;
    const bd = document.getElementById("ob-bd").value, bm = document.getElementById("ob-bm").value;
    p.birthDay = bd && bm ? `${String(bm).padStart(2, "0")}-${String(bd).padStart(2, "0")}` : null;
    p.job = document.getElementById("ob-job").value || null;
  }
  function collectPlaces() {
    const p = S.profile;
    p.home = findPlace(document.getElementById("ob-home").value);
    p.birth = findPlace(document.getElementById("ob-birth").value);
    const loc = document.getElementById("ob-loc").checked;
    if (loc && !p.useLocation) { p.useLocation = true; locate(true); }
    if (!loc) { p.useLocation = false; S.curPlace = null; }
  }
  function collectPersonal() {
    const p = S.profile;
    p.sexuality = document.getElementById("ob-sx").value || null;
    p.queer = document.getElementById("ob-queer").checked;
    for (const k of ["politik", "krieg", "krankheit"]) p.exclude[k] = document.getElementById("ob-ex-" + k).checked;
  }

  function viewOnboarding() {
    const st = obStep(ob.step);
    const dots = ob.editing ? "" : `<div class="ob-steps">${Array.from({ length: OB_STEPS }, (_, i) => `<i class="${i <= ob.step ? "on" : ""}"></i>`).join("")}</div>`;
    return `<div class="ob">${dots}
      <div class="ob-body">${st.body}</div>
      <div class="ob-foot">
        ${st.next ? `<button class="btn primary block" data-a="ob-next" ${st.disabled ? "disabled" : ""}>${ob.editing ? "Fertig" : st.next}</button>` : ""}
        ${st.skip && !ob.editing ? `<button class="btn ghost block" data-a="ob-skip">${st.skip}</button>` : ""}
        ${ob.step > 0 && !ob.editing ? `<button class="btn ghost block" data-a="ob-back">Zurück</button>` : ""}
      </div></div>`;
  }
  function obNext(skip) {
    const st = obStep(ob.step);
    if (!skip && st.collect) st.collect();
    save();
    if (ob.editing) { ob.editing = false; rebuildRest(); save(); go("profil"); return; }
    if (ob.step >= OB_STEPS - 1) {
      S.onboarded = true; S.day = null; save(); go("heute"); return;
    }
    ob.step++;
    if (ob.step === 2 && !FACTS.length) ob.step++;
    render(); window.scrollTo(0, 0);
  }

  // ---------- Router ----------
  let route = "heute", sub = null;
  function go(r, s = null) { route = r; sub = s; render(); window.scrollTo(0, 0); }
  function render() {
    const onb = route === "onboarding";
    tabs.hidden = onb;
    document.body.classList.toggle("no-tabs", onb);
    tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === route ? "page" : "false"));
    app.innerHTML = onb ? viewOnboarding()
      : route === "kategorien" ? viewCategories(sub)
      : route === "gemerkt" ? viewSaved()
      : route === "profil" ? viewProfile()
      : viewToday();
    if (route === "heute") bindCard(() => advance(null));
  }
  tabs.addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) go(b.dataset.tab); });

  // ---------- Aktionen ----------
  const ACT = {
    rate: v => advance(v),
    detail: v => openDetail(v),
    "detail-full": v => openDetail(v, true),
    close: () => closeSheet(),
    save: v => {
      const i = S.saved.indexOf(v);
      if (i >= 0) S.saved.splice(i, 1); else { S.saved.push(v); toast("Gemerkt ★"); }
      save();
      if (!sheet.hidden) openDetail(v); else render();
    },
    share: async v => {
      const f = BY.get(v), src = f.sources?.[0]?.url || "";
      const text = `${f.headline} – ${f.teaser}${src ? "\nQuelle: " + src : ""}`;
      try {
        if (navigator.share) await navigator.share({ title: f.headline, text });
        else { await navigator.clipboard.writeText(text); toast("Kopiert – jetzt weitererzählen!"); }
      } catch {}
    },
    report: v => {
      if (!confirm("Diesen Fakt als fehlerhaft melden? Er wird ausgeblendet und beim nächsten Prüflauf kontrolliert.")) return;
      if (!S.reported.includes(v)) S.reported.push(v);
      wish("report", v);
      const d = S.day;
      if (d && d.ids[d.pos] === v) { S.seen[v] = Date.now(); d.pos++; }
      save(); closeSheet(); toast("Danke! Der Fakt ist ausgeblendet.");
    },
    "next-round": () => { S.day.breaks[S.day.pos] = 1; save(); render(); },
    answer: (v, b) => {
      const qid = b.dataset.q;
      S.profile.answers[qid] = v;
      if (qid === "share") S.profile.kidsMode = v === "kinder";
      S.day.asked = true; S.lastQuestion = today(); save();
      toast("Danke, gemerkt!"); render();
    },
    "q-later": () => { S.day.asked = true; save(); render(); },
    "q-never": v => { S.profile.never[v] = 1; S.day.asked = true; save(); render(); },
    bonus: () => {
      const extra = buildDeck(CFG.bonusSize || 5, new Set(S.day.ids));
      S.day.breaks[S.day.ids.length] = 1;
      S.day.ids.push(...extra); S.day.bonus = extra.length; save(); render();
    },
    tab: v => go(v),
    cat: v => go("kategorien", v),
    perday: v => { S.perDay = +v; rebuildRest(); save(); render(); toast(`${v} Fakten pro Tag`); },
    edit: v => { ob = { step: +v, calib: [], ci: 0, editing: true }; go("onboarding"); },
    onboarding: () => { ob = { step: 0, calib: [], ci: 0, editing: false }; go("onboarding"); },
    reset: () => {
      if (!confirm("Wirklich alles löschen? Profil, Gelesenes und Gemerktes sind danach weg.")) return;
      try { localStorage.removeItem(KEY); } catch {}
      S = freshState(); ob = { step: 0, calib: [], ci: 0, editing: false }; go("onboarding");
    },
    // Onboarding
    "ob-next": () => obNext(false),
    "ob-skip": () => { if (ob.step === 2) ob.ci = ob.calib.length; obNext(true); },
    "ob-back": () => { ob.step = Math.max(0, ob.step - 1); if (ob.step === 2 && !FACTS.length) ob.step--; render(); },
    "ob-int": v => { const a = S.profile.interests, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); save(); render(); },
    "ob-rate": v => {
      const id = ob.calib[ob.ci], f = BY.get(id);
      if (f) { S.seen[id] = Date.now(); S.ratings[id] = v; learn(f, v); }
      ob.ci++; save();
      if (ob.ci >= ob.calib.length) obNext(true); else render();
    },
    "ob-pill": (v, b) => {
      const k = b.dataset.k;
      S.profile[k] = k === "gross" ? v === "ja" : v;
      save(); render();
    },
    "ob-hobby": v => { collectAbout(); const a = S.profile.hobbies, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); save(); render(); },
    "ob-place": v => { collectPlaces(); const a = S.profile.extraPlaces, i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); save(); render(); }
  };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-a]");
    if (!b || b.disabled) return;
    e.preventDefault();
    ACT[b.dataset.a]?.(b.dataset.v, b, e);
  });
  // Sexualität gewählt → Interesse an queeren Themen vorschlagen
  document.addEventListener("change", e => {
    if (e.target.id === "ob-sx") {
      const q = document.getElementById("ob-queer");
      if (q) q.checked = !["", "hetero"].includes(e.target.value);
    }
  });

  // ---------- Start ----------
  (async () => {
    app.innerHTML = `<p class="muted center" style="margin-top:40vh">Lade Fakten …</p>`;
    try { await loadData(); }
    catch { app.innerHTML = `<div class="center"><div class="big-emoji">📡</div><h1>Keine Verbindung</h1><p class="muted">Die Fakten konnten nicht geladen werden. Bitte später nochmal versuchen.</p></div>`; return; }
    if (!S.onboarded) { route = "onboarding"; }
    render();
    locate();
  })();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
