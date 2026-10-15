// Teilbare Fakten-Seite: ein Link (teilen.html), auf dem man den Ort auswählt.
// Zeigt ausschließlich ortsbezogene Fakten (Orts- und Länderpakete), nie allgemeine oder aktuelle.
// Direktlinks gehen weiter: teilen.html?ort=shenzhen, ?land=china, ?ort=alle, dazu &thema=krimi.
// Eine gewählte Kategorie bleibt beim Stadtwechsel erhalten.
// Ohne Profil, ohne Reiseplan, speichert nichts außer zwischengespeicherten Bild-Adressen.
(() => {
  "use strict";
  const app = document.getElementById("app");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const paras = t => String(t || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const fmtDate = d => { const m = String(d || "").match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/); return !m ? "" : m[3] ? `${+m[3]}.${+m[2]}.${m[1]}` : m[2] ? `${+m[2]}/${m[1]}` : m[1]; };
  const toast = msg => { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2000); };

  let TAX, IDX, PACKS = [], FACTS = [], filter = null, SEL = null;
  // Reihenfolge der Reise; weitere Orte folgen alphabetisch
  const ORDER = ["hongkong", "shenzhen", "guilin", "guizhou", "zhangjiajie", "chongqing", "shanghai", "china"];
  const keyOf = p => p.place ? "ort:" + p.place : "land:" + p.country;
  const nameOf = key => {
    const [k, id] = key.split(":");
    if (key === "ort:alle") return "Alle Orte";
    return k === "ort" ? (TAX.places.find(p => p.id === id)?.name || id) : (TAX.countries.find(c => c.id === id)?.name || id);
  };
  const flagOf = key => {
    const [k, id] = key.split(":");
    if (id === "hongkong") return "🇭🇰";
    const c = k === "land" ? id : TAX.places.find(p => p.id === id)?.countryId;
    return TAX.countries.find(x => x.id === c)?.flag || "📍";
  };
  const themeFromUrl = () => new URLSearchParams(location.search).get("thema") || null;
  const selFromUrl = () => {
    const q = new URLSearchParams(location.search);
    return q.get("ort") ? "ort:" + q.get("ort") : q.get("land") ? "land:" + q.get("land") : null;
  };
  const cache = {};
  const loadPack = p => cache[p.file] ||= fetch(`data/${p.file}?v=${IDX.version}`).then(r => r.json());
  const theme = id => (TAX.themes || []).find(t => t.id === id) || { id, name: id, icon: "•" };
  const cat = id => TAX.categories.find(c => c.id === id) || { id, name: id, icon: "•" };

  // --- Bilder: Titelbild des Wikipedia-Artikels, nur freie Commons-Dateien (wie in der App)
  const IMG_KEY = "uw_img";
  let IMG = {};
  try { IMG = JSON.parse(localStorage.getItem(IMG_KEY)) || {}; } catch {}
  const SKIP = /(logo|map|locator|flag|icon|seal|emblem|coat[_ ]of[_ ]arms|diagram|\.svg)/i;
  const strip = h => { const d = document.createElement("div"); d.innerHTML = h || ""; return (d.textContent || "").replace(/\s+/g, " ").trim(); };
  async function loadImage(title) {
    const hit = IMG[title];
    if (hit && (hit.src || Date.now() - hit.ts < 14 * 864e5)) return hit.src ? hit : null;
    try {
      const sum = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`).then(r => r.ok ? r.json() : null);
      const src0 = sum?.thumbnail?.source || "";
      const file = decodeURIComponent((sum?.originalimage?.source || src0).split("/").pop() || "");
      if (!src0.includes("/wikipedia/commons/") || SKIP.test(file)) { IMG[title] = { ts: Date.now() }; return null; }
      const w = Math.min(960, sum.originalimage?.width || 960);
      const src = /\/\d+px-/.test(src0) ? src0.replace(/\/\d+px-/, `/${w}px-`) : src0;
      let artist = "", license = "";
      try {
        const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=extmetadata&titles=File:${encodeURIComponent(file)}`).then(r => r.json());
        const m = Object.values(r.query.pages)[0].imageinfo[0].extmetadata;
        artist = strip(m.Artist?.value).slice(0, 80); license = m.LicenseShortName?.value || "";
      } catch {}
      IMG[title] = { src, file, artist, license, ts: Date.now() };
      try { localStorage.setItem(IMG_KEY, JSON.stringify(IMG)); } catch {}
      return IMG[title];
    } catch { return null; }
  }
  // Bilder erst laden, wenn die Karte in die Nähe des Bildschirms kommt
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const el = e.target;
    loadImage(el.dataset.wiki).then(img => {
      if (!img) return;
      const i = new Image(); i.alt = ""; i.decoding = "async"; i.src = img.src;
      i.onload = () => el.classList.add("has-img");
      el.prepend(i);
      const c = document.createElement("a");
      c.className = "credit"; c.target = "_blank"; c.rel = "noopener";
      c.href = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(img.file)}`;
      c.textContent = `Foto: ${img.artist || "unbekannt"}${img.license ? " · " + img.license : ""} · Wikimedia Commons`;
      c.addEventListener("click", ev => ev.stopPropagation());
      el.closest(".card").querySelector(".more-body").prepend(c);
    });
  }), { rootMargin: "400px" });

  function media(f) {
    const ico = (f.themes || []).map(t => theme(t).icon).find(Boolean) || cat(f.category).icon;
    const hue = [...(f.category || "x")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    return `<div class="media" style="--h:${hue}" ${f.wiki ? `data-wiki="${esc(f.wiki)}"` : ""}><span class="ph">${ico}</span></div>`;
  }
  function card(f) {
    const srcs = (f.sources || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">
      <div class="pub">${esc(s.publisher || new URL(s.url).hostname)}${s.date ? " · " + fmtDate(s.date) : ""}</div>
      <div class="t">${esc(s.title || s.url)} ↗</div></a></li>`).join("");
    const th = (f.themes || []).filter(t => t !== "vorort").slice(0, 1).map(t => `${theme(t).icon} ${esc(theme(t).name)}`)[0] || `${cat(f.category).icon} ${esc(cat(f.category).name)}`;
    return `<article class="card" data-id="${esc(f.id)}">
      ${media(f)}
      <span class="chip">${th}</span>
      <h2>${esc(f.headline)}</h2>
      <p class="teaser">${esc(f.teaser)}</p>
      <div class="more-body">
        ${paras(f.detail).map(p => `<p>${esc(p)}</p>`).join("")}
        <div class="section-title">Quelle${(f.sources || []).length > 1 ? "n" : ""}</div>
        <ul class="sources">${srcs}</ul>
      </div>
      <div class="card-actions">
        <button class="link-btn more" data-a="toggle">Mehr dazu & Quelle →</button>
        <span style="flex:1"></span>
        <button class="btn" data-a="share" data-v="${esc(f.id)}">↗ Teilen</button>
      </div>
    </article>`;
  }

  function render() {
    const list = FACTS.filter(f => !filter || (f.themes || []).includes(filter));
    const counts = {};
    FACTS.forEach(f => (f.themes || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    // gewählte Kategorie bleibt sichtbar, auch wenn es sie in dieser Stadt nicht gibt
    if (filter && !counts[filter]) counts[filter] = 0;
    const chips = Object.entries(counts).sort((a, b) => (b[0] === filter) - (a[0] === filter) || b[1] - a[1])
      .map(([t, n]) => `<button class="pill" data-a="filter" data-v="${t}" aria-pressed="${filter === t}">${theme(t).icon} ${esc(theme(t).name)} <span class="cnt">${n}</span></button>`).join("");
    const name = nameOf(SEL);
    const places = [...PACKS.map(keyOf), "ort:alle"].map(k => `<button class="pill" data-a="pick" data-v="${k}" aria-pressed="${k === SEL}">${k === "ort:alle" ? "🌏" : flagOf(k)} ${esc(nameOf(k))}<span class="cnt" data-k="${k}" hidden></span></button>`).join("");
    const ft = filter ? theme(filter) : null;
    app.innerHTML = `<button class="link-btn back" data-a="home">← Alle Orte</button>
      <div class="filters places">${places}</div>
      <header class="hero">
        <div class="kicker">Unnützes Wissen</div>
        <h1>${esc(name)}</h1>
        <p class="muted">${ft ? `${list.length} von ${FACTS.length} Fakten in ${ft.icon} ${esc(ft.name)}` : `${FACTS.length} überraschende Fakten`}, jeder mit Quelle. Antippen für die ganze Geschichte.</p>
        <button class="btn" data-a="share-page">↗ Diesen Ort teilen</button>
      </header>
      <div class="section-title flabel">Kategorie</div>
      <div class="filters themes"><button class="pill" data-a="filter" data-v="" aria-pressed="${!filter}">✨ Alle</button>${chips}</div>
      <div class="feed">${list.length ? list.map(card).join("") : `<div class="center empty"><div class="big-emoji">🤷</div>
        <p class="muted">In ${esc(name)} gibt es keine Fakten in ${ft.icon} ${esc(ft.name)}. Andere Stadt oben wählen oder:</p>
        <button class="btn" data-a="filter" data-v="">Alle Kategorien zeigen</button></div>`}</div>
      <p class="foot">Alle Fakten wurden an ihren Quellen gegengeprüft. Fotos: Wikimedia Commons.</p>`;
    app.querySelectorAll(".media[data-wiki]").forEach(el => io.observe(el));
    app.querySelector(".themes [aria-pressed=true]")?.scrollIntoView({ inline: "center", block: "nearest" });
    placeCounts();
  }
  // Bei gewählter Kategorie: in der Städteleiste anzeigen, wie viele Treffer jede Stadt hat
  async function placeCounts() {
    if (!filter) return;
    const f0 = filter, today = new Date().toISOString().slice(0, 10);
    const per = await Promise.all(PACKS.map(p => loadPack(p).then(fs => fs.filter(f => (!f.expires || f.expires >= today) && (f.themes || []).includes(f0)).length)));
    if (filter !== f0) return;
    const n = { "ort:alle": per.reduce((a, b) => a + b, 0) };
    PACKS.forEach((p, i) => { n[keyOf(p)] = per[i]; });
    app.querySelectorAll(".places .cnt").forEach(el => { el.textContent = n[el.dataset.k] ?? ""; el.hidden = false; });
  }
  function syncUrl() {
    const u = new URL(location.href);
    filter ? u.searchParams.set("thema", filter) : u.searchParams.delete("thema");
    history.replaceState(null, "", u);
  }

  // Startseite des Links: Ort auswählen
  function renderPicker() {
    const total = PACKS.reduce((n, p) => n + p.count, 0);
    const tiles = PACKS.map(p => `<button class="tile" data-a="pick" data-v="${keyOf(p)}">
        <span class="flag">${flagOf(keyOf(p))}</span><b>${esc(nameOf(keyOf(p)))}</b><span class="muted">${p.count} Fakten</span></button>`).join("");
    app.innerHTML = `<header class="hero">
        <div class="kicker">Unnützes Wissen</div>
        <h1>Wohin geht’s?</h1>
        <p class="muted">Skurrile, belegte Fakten zu ${PACKS.length} Orten – Kriminalfälle, Legenden, Rekorde, Essen. Ort antippen und losblättern.</p>
        <button class="btn" data-a="share-page">↗ Link teilen</button>
      </header>
      <div class="tiles">${tiles}
        <button class="tile all" data-a="pick" data-v="ort:alle"><span class="flag">🌏</span><b>Alle Orte</b><span class="muted">${total} Fakten</span></button>
      </div>
      <p class="foot">Alle Fakten wurden an ihren Quellen gegengeprüft. Fotos: Wikimedia Commons.</p>`;
    document.title = "Unnützes Wissen: Orte";
  }

  async function show(key) {
    SEL = key; filter = themeFromUrl();
    if (!key) { renderPicker(); return; }
    const packs = key === "ort:alle" ? PACKS : PACKS.filter(p => keyOf(p) === key);
    if (!packs.length) {
      app.innerHTML = `<div class="center"><div class="big-emoji">🤷</div><h1>Nichts gefunden</h1><p class="muted">Für diesen Ort gibt es (noch) keine Fakten.</p><button class="btn" data-a="home">Ort auswählen</button></div>`;
      return;
    }
    app.innerHTML = `<p class="muted center" style="margin-top:40vh">Lade Fakten …</p>`;
    const today = new Date().toISOString().slice(0, 10);
    FACTS = (await Promise.all(packs.map(loadPack))).flat()
      .filter(f => (f.place || f.country) && (!f.expires || f.expires >= today))
      .sort((a, b) => (b.fun || 3) - (a.fun || 3) || Math.random() - 0.5);
    document.title = `Unnützes Wissen: ${nameOf(key)}`;
    render();
    app.querySelector(".places [aria-pressed=true]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }
  function go(key) {
    const u = new URL(location.href);
    u.search = ""; u.hash = "";
    if (key) { const [k, id] = key.split(":"); u.searchParams.set(k === "land" ? "land" : "ort", id); if (filter) u.searchParams.set("thema", filter); }
    history.pushState(null, "", u);
    window.scrollTo({ top: 0 });
    show(key);
  }
  window.addEventListener("popstate", () => show(selFromUrl()));

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-a]");
    const c = e.target.closest(".card");
    if (!b && c && !e.target.closest("a")) { c.classList.toggle("open"); return; }
    if (!b) return;
    const a = b.dataset.a;
    if (a === "toggle") { b.closest(".card").classList.toggle("open"); b.textContent = b.closest(".card").classList.contains("open") ? "Weniger" : "Mehr dazu & Quelle →"; }
    if (a === "pick") { go(b.dataset.v); return; }
    if (a === "home") { go(null); return; }
    if (a === "filter") { filter = b.dataset.v || null; syncUrl(); render(); window.scrollTo({ top: 0 }); }
    if (a === "share" || a === "share-page") {
      const f = FACTS.find(x => x.id === b.dataset.v);
      const url = location.href.split("#")[0];
      const text = f ? `${f.headline} – ${f.teaser}` : document.title;
      try {
        if (navigator.share) await navigator.share({ title: f ? f.headline : document.title, text, url });
        else { await navigator.clipboard.writeText(`${text}\n${url}`); toast("Link kopiert"); }
      } catch {}
    }
  });

  (async () => {
    try {
      const [tax, idx] = await Promise.all([fetch("data/taxonomy.json").then(r => r.json()), fetch("data/index.json", { cache: "no-cache" }).then(r => r.json())]);
      TAX = tax; IDX = idx;
      // nur Orts- und Länderpakete
      const rank = p => { const i = ORDER.indexOf(p.place || p.country); return i < 0 ? 99 : i; };
      PACKS = idx.packs.filter(p => (p.place || p.country) && p.count > 0)
        .sort((a, b) => rank(a) - rank(b) || nameOf(keyOf(a)).localeCompare(nameOf(keyOf(b)), "de"));
      await show(selFromUrl());
    } catch {
      app.innerHTML = `<div class="center"><div class="big-emoji">🤷</div><h1>Nichts gefunden</h1><p class="muted">Die Fakten konnten nicht geladen werden.</p></div>`;
    }
  })();
})();
