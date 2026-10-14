// Offline-Unterstützung für „Unnützes Wissen“: App und Fakten erst aus dem Netz, offline aus dem Cache.
const CACHE = "uw-v3";
const CORE = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest",
  "data/taxonomy.json", "data/index.json", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("uw-v") && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Fotos von Wikimedia: einmal geladen, offline verfügbar
  if (url.hostname === "upload.wikimedia.org") {
    e.respondWith(caches.open("uw-img").then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") { c.put(req, res.clone()); c.keys().then(k => k.length > 400 && c.delete(k[0])); }
      return res;
    }));
    return;
  }
  const mine = url.pathname.startsWith(new URL("./", location).pathname) || url.pathname.endsWith("/data/trip.js");
  if (url.origin !== location.origin || !mine) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const key = url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname;
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) c.put(key, res.clone());
      return res;
    } catch {
      return (await c.match(key, { ignoreSearch: true })) || Response.error();
    }
  })());
});
