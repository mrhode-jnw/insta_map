// Teilbare Fakten-Seite für einen Ort: teilen.html?ort=shenzhen (oder ?land=china).
// Ohne Profil, ohne Reiseplan, speichert nichts außer zwischengespeicherten Bild-Adressen.
(() => {
  "use strict";
  const app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const ORT = q.get("ort"), LAND = q.get("land");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const paras = t => String(t || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const fmtDate = d => { const m = String(d || "").match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/); return !m ? "" : m[3] ? `${+m[3]}.${+m[2]}.${m[1]}` : m[2] ? `${+m[2]}/${m[1]}` : m[1]; };
  const toast = msg => { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2000); };

  let TAX, FACTS = [], filter = null;
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
    const chips = Object.entries(counts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<button class="pill" data-a="filter" data-v="${t}" aria-pressed="${filter === t}">${theme(t).icon} ${esc(theme(t).name)} <span class="cnt">${n}</span></button>`).join("");
    const name = ORT ? (TAX.places.find(p => p.id === ORT)?.name || ORT) : (TAX.countries.find(c => c.id === LAND)?.name || LAND);
    app.innerHTML = `<header class="hero">
        <div class="kicker">Unnützes Wissen</div>
        <h1>${esc(name)}</h1>
        <p class="muted">${FACTS.length} überraschende Fakten, jeder mit Quelle. Antippen für die ganze Geschichte.</p>
        <button class="btn" data-a="share-page">↗ Seite teilen</button>
      </header>
      <div class="filters"><button class="pill" data-a="filter" data-v="" aria-pressed="${!filter}">✨ Alle</button>${chips}</div>
      <div class="feed">${list.map(card).join("")}</div>
      <p class="foot">Alle Fakten wurden an ihren Quellen gegengeprüft. Fotos: Wikimedia Commons.</p>`;
    app.querySelectorAll(".media[data-wiki]").forEach(el => io.observe(el));
  }

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-a]");
    const c = e.target.closest(".card");
    if (!b && c && !e.target.closest("a")) { c.classList.toggle("open"); return; }
    if (!b) return;
    const a = b.dataset.a;
    if (a === "toggle") { b.closest(".card").classList.toggle("open"); b.textContent = b.closest(".card").classList.contains("open") ? "Weniger" : "Mehr dazu & Quelle →"; }
    if (a === "filter") { filter = b.dataset.v || null; render(); window.scrollTo({ top: 0 }); }
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
      TAX = tax;
      const packs = idx.packs.filter(p => ORT ? p.place === ORT : p.country === LAND);
      if (!packs.length) throw new Error("kein Paket");
      FACTS = (await Promise.all(packs.map(p => fetch(`data/${p.file}?v=${idx.version}`).then(r => r.json())))).flat()
        .filter(f => !f.expires || f.expires >= new Date().toISOString().slice(0, 10))
        .sort((a, b) => (b.fun || 3) - (a.fun || 3) || Math.random() - 0.5);
      document.title = `Unnützes Wissen: ${ORT ? (TAX.places.find(p => p.id === ORT)?.name || ORT) : LAND}`;
      render();
    } catch {
      app.innerHTML = `<div class="center"><div class="big-emoji">🤷</div><h1>Nichts gefunden</h1><p class="muted">Für diesen Ort gibt es (noch) keine Fakten.</p></div>`;
    }
  })();
})();
