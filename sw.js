// Offline-Unterstützung für die Insta Map (als App auf dem Home-Bildschirm).
// Seite & Daten: erst Netz, sonst Cache. Bilder, Bibliotheken, Kartenkacheln: erst Cache, sonst Netz (und merken).
const CORE = "core-v2", MEDIA = "media-v1", TILES = "tiles-v1";
const CORE_FILES = ["./", "index.html", "crypto.js", "config.js", "data/places.js", "data/china.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CORE).then(c => c.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

const networkFirst = async (req, key) => {
  const c = await caches.open(CORE);
  try {
    const res = await fetch(req, { cache: "no-cache" });  // Seite immer frisch beim Server prüfen
    if (res.ok) c.put(key, res.clone());
    return res;
  } catch {
    return (await c.match(key, { ignoreSearch: true })) || (await caches.match(key, { ignoreSearch: true })) || Response.error();
  }
};
const cacheFirst = async (req, name, limit) => {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    c.put(req, res.clone());
    if (limit) c.keys().then(k => k.length > limit && c.delete(k[0]));
  }
  return res;
};

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.github.com" || url.hostname === "raw.githubusercontent.com") return;  // Speichern/Status immer live
  if (url.origin === location.origin) {
    if (url.pathname.includes("/images/") || url.pathname.includes("/icons/")) return e.respondWith(cacheFirst(req, MEDIA));
    if (url.searchParams.has("check")) return;  // Update-Prüfung immer live
    // Seite, config.js, data/*.js (mit ?v=…) – Netz zuerst, offline die letzte Version
    const key = url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname;
    return e.respondWith(networkFirst(req, key));
  }
  if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/.test(url.hostname)) return e.respondWith(cacheFirst(req, MEDIA));
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) return e.respondWith(cacheFirst(req, TILES, 4000));
});

// Seite schickt die Liste aller Spot-Fotos → nach und nach für offline laden
self.addEventListener("message", e => {
  if (!e.data || e.data.type !== "precache") return;
  e.waitUntil((async () => {
    const c = await caches.open(MEDIA);
    let n = 0;
    for (const u of e.data.urls) {
      if (await c.match(u)) { n++; continue; }
      try { const r = await fetch(u); if (r.ok) { await c.put(u, r); n++; } } catch {}
    }
    const clients = await self.clients.matchAll();
    clients.forEach(cl => cl.postMessage({ type: "precached", n, total: e.data.urls.length }));
  })());
});
