// Drehbare Google-Vektorkarte hinter der Leaflet-Oberfläche der Hauptkarte.
// Stellt genau die Teile der Leaflet-API bereit, die index.html benutzt (Marker, Gruppen, Popups, Linien, Steuerknöpfe),
// damit die Karte mit ?google dieselbe App ist – nur mit Drehen/Kippen.
(function () {
  const css = document.createElement("style");
  css.textContent = `
    .glm.leaflet-marker-icon { position: relative !important; left: auto !important; top: auto !important; }
    .gl-inner { position: absolute; inset: 0; }
    .gl-north a { font-size: 17px; line-height: 30px; text-align: center; }
    .gl-north span { display: inline-block; transition: transform .15s; }
    .leaflet-control-layers-list label { display: block; padding: 2px 4px; white-space: nowrap; }`;
  document.head.appendChild(css);

  const g = () => google.maps;
  const toLL = a => a == null ? null : Array.isArray(a) ? { lat: +a[0], lng: +a[1] }
    : typeof a.lat === "function" ? { lat: a.lat(), lng: a.lng() } : { lat: +a.lat, lng: +a.lng };

  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    equals(o) { o = toLL(o); return Math.abs(o.lat - this.lat) < 1e-9 && Math.abs(o.lng - this.lng) < 1e-9; }
  }
  const latLng = (a, b) => { const p = b === undefined ? toLL(a) : { lat: +a, lng: +b }; return new LatLng(p.lat, p.lng); };

  class Bounds {
    constructor(a, b) { this.s = Infinity; this.n = -Infinity; this.w = Infinity; this.e = -Infinity;
      if (Array.isArray(a) && b === undefined && a.length && typeof a[0] !== "number") a.forEach(p => this.extend(p));
      else { if (a) this.extend(a); if (b) this.extend(b); } }
    extend(p) { p = toLL(p); this.s = Math.min(this.s, p.lat); this.n = Math.max(this.n, p.lat); this.w = Math.min(this.w, p.lng); this.e = Math.max(this.e, p.lng); return this; }
    contains(p) { p = toLL(p); return p.lat >= this.s && p.lat <= this.n && p.lng >= this.w && p.lng <= this.e; }
    isValid() { return this.s <= this.n; }
    getSouth() { return this.s; } getNorth() { return this.n; } getWest() { return this.w; } getEast() { return this.e; }
    toGoogle() { return new (g().LatLngBounds)({ lat: this.s, lng: this.w }, { lat: this.n, lng: this.e }); }
  }
  const latLngBounds = (a, b) => a instanceof Bounds ? a : new Bounds(a, b);

  // kleiner Ereignis-Mechanismus wie bei Leaflet (on/off/fire)
  const Evented = Base => class extends Base {
    on(t, fn, ctx) { (this._ev ||= {}); t.split(" ").forEach(k => (this._ev[k] ||= []).push([fn, ctx])); if (this._hook) t.split(" ").forEach(k => this._hook(k)); return this; }
    off(t, fn, ctx) { if (this._ev && this._ev[t]) this._ev[t] = this._ev[t].filter(([f, c]) => !(f === fn && (!ctx || c === ctx))); return this; }
    fire(t, data = {}) { data.type = t; data.target = this; ((this._ev || {})[t] || []).slice().forEach(([f, c]) => f.call(c || this, data)); return this; }
  };
  class Base {}

  // ---------- Popup (Leaflet-DOM, damit die vorhandenen Stile und Handler unverändert greifen)
  class Popup {
    constructor(content, options, source) {
      this.options = Object.assign({ maxWidth: 400, maxHeight: null, autoPan: true, autoPanPaddingTopLeft: [5, 5], autoPanPaddingBottomRight: [5, 5] }, options);
      this._content = content; this._source = source; this._map = null;
      const el = this._el = document.createElement("div");
      el.className = "leaflet-popup leaflet-zoom-animated";
      el.innerHTML = `<div class="leaflet-popup-content-wrapper"><div class="leaflet-popup-content"></div></div>
        <div class="leaflet-popup-tip-container"><div class="leaflet-popup-tip"></div></div><a class="leaflet-popup-close-button" role="button" href="#">×</a>`;
      el.style.position = "absolute";
      this._contentEl = el.querySelector(".leaflet-popup-content");
      el.querySelector(".leaflet-popup-close-button").onclick = e => { e.preventDefault(); this._map && this._map.closePopup(); };
    }
    getElement() { return this._el; }
    isOpen() { return !!this._map; }
    _render() {
      const c = typeof this._content === "function" ? this._content(this._source) : this._content;
      if (typeof c === "string") this._contentEl.innerHTML = c; else { this._contentEl.innerHTML = ""; this._contentEl.appendChild(c); }
      this._layout();
    }
    _layout() {
      const mh = this.options.maxHeight, ce = this._contentEl;
      ce.style.maxHeight = mh ? mh + "px" : ""; ce.style.overflowY = mh ? "auto" : "";
      this._el.classList.toggle("leaflet-popup-scrolled", !!mh && ce.scrollHeight > mh);
    }
    update() { if (!this._map) return; this._render(); this._ov && this._ov.draw(); }
    _open(map, ll, anchor) {
      this._map = map; this._ll = ll; this._anchor = anchor || [0, 0];
      const self = this;
      const ov = this._ov = new (g().OverlayView)();
      ov.onAdd = function () {  // Handy: die App hat das Popup schon als feste Karte an <body> gehängt → dort lassen
        if (self._el.classList.contains("card") && self._el.parentNode === document.body) return;
        this.getPanes().floatPane.appendChild(self._el); g().OverlayView.preventMapHitsAndGesturesFrom(self._el); };
      ov.draw = function () {
        const pr = this.getProjection(); if (!pr || self._el.classList.contains("card")) return;
        const pt = pr.fromLatLngToDivPixel(ll); if (!pt) return;
        self._el.style.left = Math.round(pt.x + self._anchor[0] - self._el.offsetWidth / 2) + "px";
        self._el.style.top = Math.round(pt.y + self._anchor[1] - self._el.offsetHeight - 20) + "px";
      };
      ov.onRemove = () => self._el.remove();
      this._render();
      ov.setMap(map._g);
    }
    _close() { if (this._ov) { this._ov.setMap(null); this._ov = null; } this._el.remove(); this._map = null; }
    // Desktop: Karte so verschieben, dass das Popup ganz zu sehen ist
    _adjustPan() {
      if (!this._map || !this.options.autoPan || this._el.classList.contains("card")) return;
      const r = this._el.getBoundingClientRect(), m = this._map._box.getBoundingClientRect();
      const tl = this.options.autoPanPaddingTopLeft || [5, 5], br = this.options.autoPanPaddingBottomRight || [5, 5];
      let dx = 0, dy = 0;
      if (r.right + br[0] > m.right) dx = r.right + br[0] - m.right;
      if (r.left - dx < m.left + tl[0]) dx = r.left - m.left - tl[0];
      if (r.bottom + br[1] > m.bottom) dy = r.bottom + br[1] - m.bottom;
      if (r.top - dy < m.top + tl[1]) dy = r.top - m.top - tl[1];
      if (dx || dy) this._map._g.panBy(dx, dy);
    }
  }

  // ---------- Map
  class GMap extends Evented(Base) {
    constructor(id, opts = {}) {
      super();
      const box = this._box = typeof id === "string" ? document.getElementById(id) : id;
      if (getComputedStyle(box).position === "static") box.style.position = "relative";
      const inner = document.createElement("div"); inner.className = "gl-inner"; box.appendChild(inner);  // Google setzt auf seinem Container position:relative
      const q = new URLSearchParams(location.search);
      let mapId = q.get("mapid"); try { if (mapId) localStorage.setItem("gmapId", mapId); else mapId = localStorage.getItem("gmapId"); } catch {}
      this._g = new (g().Map)(inner, { center: { lat: 0, lng: 0 }, zoom: 2, mapId: mapId || "DEMO_MAP_ID", renderingType: g().RenderingType.VECTOR,
        headingInteractionEnabled: true, tiltInteractionEnabled: true, gestureHandling: "greedy", disableDefaultUI: true, clickableIcons: false,
        maxZoom: opts.maxZoom || 21, isFractionalZoomEnabled: true });
      this._popup = null; this._hooked = {};
      const ctr = this._ctr = document.createElement("div"); ctr.className = "leaflet-control-container";
      ctr.innerHTML = '<div class="leaflet-top leaflet-left"></div><div class="leaflet-top leaflet-right"></div><div class="leaflet-bottom leaflet-left"></div><div class="leaflet-bottom leaflet-right"></div>';
      box.appendChild(ctr);
      if (opts.rotateControl) this._northControl(opts.rotateControl.position || "topright");
      // Klick auf die Karte schließt das Popup (wie Leaflet)
      this._g.addListener("click", () => this.closePopup());
      this._longPress(inner);
      setTimeout(() => { if (this._g.getRenderingType && this._g.getRenderingType() !== "VECTOR" && window.toastGL) window.toastGL(); }, 5000);
    }
    _hook(t) {
      if (this._hooked[t]) return; this._hooked[t] = true;
      const G = this._g, ev = e => e && e.latLng ? { latlng: latLng(e.latLng) } : {};
      const map = { moveend: "idle", zoomend: "zoom_changed", dragstart: "dragstart", rotate: "heading_changed", click: "click", contextmenu: "contextmenu" }[t];
      if (map) G.addListener(map, e => this.fire(t, ev(e)));
    }
    _longPress(el) {  // Handy: lange tippen = contextmenu (Spot hinzufügen)
      let t = null, p0 = null;
      const clear = () => { clearTimeout(t); t = null; };
      el.addEventListener("touchstart", e => {
        if (e.touches.length !== 1) return clear();
        p0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        t = setTimeout(() => { t = null; const r = this._box.getBoundingClientRect(); this.fire("contextmenu", { latlng: this.containerPointToLatLng([p0.x - r.left, p0.y - r.top]) }); }, 650);
      }, { passive: true });
      el.addEventListener("touchmove", e => { if (t && Math.hypot(e.touches[0].clientX - p0.x, e.touches[0].clientY - p0.y) > 10) clear(); }, { passive: true });
      el.addEventListener("touchend", clear); el.addEventListener("touchcancel", clear);
    }
    _corner(pos) { return this._ctr.querySelector({ topright: ".leaflet-top.leaflet-right", topleft: ".leaflet-top.leaflet-left", bottomright: ".leaflet-bottom.leaflet-right", bottomleft: ".leaflet-bottom.leaflet-left" }[pos] || ".leaflet-top.leaflet-right"); }
    _northControl(pos) {
      const d = document.createElement("div"); d.className = "leaflet-bar leaflet-control gl-north";
      d.innerHTML = '<a href="#" role="button" title="Nach Norden ausrichten" aria-label="Nach Norden ausrichten"><span>⬆</span></a>';
      d.querySelector("a").onclick = e => { e.preventDefault(); this._g.moveCamera({ heading: 0, tilt: 0 }); };
      this._g.addListener("heading_changed", () => d.querySelector("span").style.transform = `rotate(${-(this._g.getHeading() || 0)}deg)`);
      this._corner(pos).appendChild(d);
    }
    getContainer() { return this._box; }
    getZoom() { return this._g.getZoom() ?? 2; }
    getCenter() { return latLng(this._g.getCenter()); }
    setView(ll, z, o) { const c = toLL(ll); this._g.moveCamera({ center: c, zoom: z ?? this.getZoom() }); return this; }
    setZoom(z) { this._g.setZoom(z); return this; }
    panTo(ll) { this._g.panTo(toLL(ll)); return this; }
    fitBounds(b, o = {}) { b = latLngBounds(b); if (!b.isValid()) return this; const p = (o.padding || [0, 0])[0]; this._g.fitBounds(b.toGoogle(), p); return this; }
    getBounds() {
      const gb = this._g.getBounds();
      if (gb) { const ne = gb.getNorthEast(), sw = gb.getSouthWest(); return new Bounds({ lat: sw.lat(), lng: sw.lng() }, { lat: ne.lat(), lng: ne.lng() }); }
      const r = this._box.getBoundingClientRect(), b = new Bounds();
      [[0, 0], [r.width, 0], [0, r.height], [r.width, r.height]].forEach(p => b.extend(this.containerPointToLatLng(p)));
      return b;
    }
    // Bildschirmpunkt → Koordinate (Web-Mercator, berücksichtigt die Drehung; Kippen nur näherungsweise)
    containerPointToLatLng(pt) {
      const r = this._box.getBoundingClientRect(), c = toLL(this._g.getCenter() || { lat: 0, lng: 0 }), z = this.getZoom();
      const S = 256 * Math.pow(2, z), h = (this._g.getHeading() || 0) * Math.PI / 180;
      const sx = pt[0] - r.width / 2, sy = pt[1] - r.height / 2;
      const dx = sx * Math.cos(h) - sy * Math.sin(h), dy = sx * Math.sin(h) + sy * Math.cos(h);
      const s = Math.sin(c.lat * Math.PI / 180);
      const wx = (c.lng + 180) / 360 * S + dx, wy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * S + dy;
      const lng = wx / S * 360 - 180, n = Math.PI - 2 * Math.PI * wy / S;
      return latLng(180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng);
    }
    getBearing() { return -(this._g.getHeading() || 0); }
    setBearing(b) { this._g.moveCamera({ heading: ((-b % 360) + 360) % 360 }); return this; }
    addLayer(l) { l.addTo(this); return this; }
    removeLayer(l) { l.remove(); return this; }
    hasLayer(l) { return !!l && l._map === this; }
    openPopupFor(popup, ll, anchor) {
      if (this._popup) this.closePopup();
      this._popup = popup; popup._open(this, ll, anchor);
      this.fire("popupopen", { popup }); popup._source && popup._source.fire && popup._source.fire("popupopen", { popup });
      requestAnimationFrame(() => popup._adjustPan());
    }
    closePopup() {
      const p = this._popup; if (!p) return this;
      this._popup = null; p._close();
      this.fire("popupclose", { popup: p }); p._source && p._source.fire && p._source.fire("popupclose", { popup: p });
      return this;
    }
  }

  // ---------- Marker (AdvancedMarkerElement mit dem HTML des divIcon)
  class Marker extends Evented(Base) {
    constructor(ll, o = {}) {
      super(); this.options = o; this._ll = latLng(ll); this._map = null;
      const el = this._el = document.createElement("div");
      this._gm = new (g().marker.AdvancedMarkerElement)({ position: toLL(this._ll), content: el, title: o.title || "", zIndex: o.zIndexOffset || 0,
        gmpClickable: o.interactive !== false, gmpDraggable: !!o.draggable });
      this._gm.addEventListener("gmp-click", () => { this.fire("click", { latlng: this._ll }); this._togglePopup(); });
      if (o.draggable) this._gm.addListener("dragend", () => { this._ll = latLng(this._gm.position); this.fire("dragend"); });
      this.setIcon(o.icon || divIcon({ html: '<div class="pin"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }));
    }
    setIcon(icon) {
      this.options.icon = icon;
      const [w, h] = icon.options.iconSize || [24, 24], [ax, ay] = icon.options.iconAnchor || [w / 2, h / 2];
      const keep = this._el.classList.contains("hl") ? " hl" : "";
      this._el.className = "glm leaflet-marker-icon leaflet-interactive " + (icon.options.className || "") + keep;
      Object.assign(this._el.style, { width: w + "px", height: h + "px", transform: `translate(${w / 2 - ax}px, ${h - ay}px)` });  // Google verankert unten mittig
      this._el.innerHTML = icon.options.html || "";
      return this;
    }
    getElement() { return this._gm.map ? this._el : null; }
    getLatLng() { return this._ll; }
    setLatLng(ll) { this._ll = latLng(ll); this._gm.position = toLL(this._ll); return this; }
    addTo(map) { this._map = map; this._gm.map = map._g; return this; }
    remove() { this._gm.map = null; this._map = null; return this; }
    bindPopup(content, o) { this._popup = new Popup(content, o, this); return this; }
    bindTooltip(t) { this._gm.title = String(t); return this; }
    _mapRef() { return this._map || (this._cluster && this._cluster._map); }
    openPopup() { const m = this._mapRef(); if (m && this._popup) m.openPopupFor(this._popup, toLL(this._ll), (this.options.icon && this.options.icon.options.popupAnchor) || [0, 0]); return this; }
    closePopup() { const m = this._mapRef(); if (m && m._popup === this._popup) m.closePopup(); return this; }
    isPopupOpen() { const m = this._mapRef(); return !!(m && this._popup && m._popup === this._popup); }
    _togglePopup() { if (!this._popup) return; this.isPopupOpen() ? this.closePopup() : this.openPopup(); }
  }
  const divIcon = o => ({ options: o });

  // ---------- Gruppen (MarkerClusterer mit Leaflet-Gruppen-Optik)
  class Cluster {
    constructor(o = {}) { this.options = o; this._set = new Set(); this._map = null; this._mc = null; }
    _make() {
      const MC = window.markerClusterer;
      this._mc = new MC.MarkerClusterer({
        map: this._map._g, markers: [...this._set].map(m => m._gm),
        algorithm: new MC.SuperClusterAlgorithm({ radius: (this.options.maxClusterRadius || 80) * 2, maxZoom: 18 }),
        renderer: { render: ({ count, position }) => {
          const d = document.createElement("div");
          d.className = "glm leaflet-marker-icon marker-cluster marker-cluster-" + (count < 10 ? "small" : count < 100 ? "medium" : "large");
          Object.assign(d.style, { width: "40px", height: "40px", transform: "translateY(20px)" });
          d.innerHTML = `<div><span>${count}</span></div>`;
          return new (g().marker.AdvancedMarkerElement)({ position, content: d, zIndex: 1000 + count });
        } },
      });
    }
    addTo(map) { this._map = map; if (!this._mc) this._make(); return this; }
    remove() { if (this._mc) { this._mc.setMap(null); this._mc = null; } this._map = null; return this; }
    addLayers(ms) { ms.forEach(m => { this._set.add(m); m._cluster = this; }); if (this._mc) this._mc.addMarkers(ms.map(m => m._gm)); return this; }
    removeLayers(ms) { ms.forEach(m => { this._set.delete(m); m._cluster = null; }); if (this._mc) this._mc.removeMarkers(ms.map(m => m._gm)); return this; }
    addLayer(m) { return this.addLayers([m]); }
    removeLayer(m) { return m ? this.removeLayers([m]) : this; }
    getVisibleParent(m) {
      if (!this._set.has(m) || !this._mc) return null;
      const c = (this._mc.clusters || []).find(c => c.markers && c.markers.includes(m._gm));
      if (!c) return null;
      if (c.markers.length === 1) return m;
      return { getElement: () => c.marker && c.marker.content, _isCluster: true };
    }
    // so weit hineinzoomen, bis der Marker nicht mehr in einer Gruppe steckt
    zoomToShowLayer(m, cb) {
      const G = this._map._g; let n = 0;
      const step = () => {
        const vp = this.getVisibleParent(m);
        if (vp === m) {
          const b = G.getBounds();
          if (b && !b.contains(toLL(m._ll))) G.panTo(toLL(m._ll));
          return setTimeout(cb, 60);
        }
        if (++n > 22) return cb && cb();
        const z = Math.min(19, Math.floor(G.getZoom() || 0) + 1);
        let done = false; const next = () => { if (!done) { done = true; setTimeout(step, 30); } };
        g().event.addListenerOnce(this._mc, "clusteringend", next); setTimeout(next, 700);
        G.moveCamera({ center: toLL(m._ll), zoom: z });
      };
      step();
    }
  }

  // ---------- Linien, Kreise, Gruppen von Ebenen
  class Polyline {
    constructor(lls, o = {}) {
      const dash = o.dashArray ? o.dashArray.split(/[ ,]+/).map(Number) : null;
      this._gl = new (g().Polyline)({ path: lls.map(toLL), clickable: false, strokeColor: o.color || "#3388ff", strokeWeight: o.weight || 3,
        strokeOpacity: dash ? 0 : (o.opacity ?? 1),
        icons: dash ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: o.opacity ?? 1, strokeWeight: o.weight || 3, scale: (o.weight || 3) }, offset: "0", repeat: (dash[0] + dash[1]) + "px" }] : [] });
    }
    addTo(map) { this._map = map; this._gl.setMap(map._g); return this; }
    remove() { this._gl.setMap(null); this._map = null; return this; }
  }
  class CircleMarker extends Marker {
    constructor(ll, o = {}) {
      const r = o.radius || 6, s = (r + (o.weight || 0)) * 2;
      super(ll, { interactive: false, zIndexOffset: 10, icon: divIcon({ iconSize: [s, s], iconAnchor: [s / 2, s / 2],
        html: `<div style="width:${s}px;height:${s}px;box-sizing:border-box;border-radius:50%;background:${o.fillColor || o.color};border:${o.weight || 0}px solid ${o.color || "#fff"};opacity:${o.fillOpacity ?? 1}"></div>` }) });
    }
  }
  class Circle {
    constructor(ll, o = {}) { this._c = new (g().Circle)({ center: toLL(ll), radius: o.radius || 10, strokeColor: o.color || "#3388ff", strokeWeight: o.weight ?? 1, fillColor: o.color || "#3388ff", fillOpacity: o.fillOpacity ?? .2, clickable: false }); }
    addTo(map) { this._map = map; this._c.setMap(map._g); return this; }
    remove() { this._c.setMap(null); this._map = null; return this; }
    setLatLng(ll) { this._c.setCenter(toLL(ll)); return this; }
    setRadius(r) { this._c.setRadius(r); return this; }
  }
  class LayerGroup {
    constructor(ls = []) { this._ls = ls; this._map = null; }
    addTo(map) { this._map = map; this._ls.forEach(l => l.addTo(map)); return this; }
    remove() { this._ls.forEach(l => l.remove()); this._map = null; return this; }
  }

  // ---------- Steuerknöpfe
  const control = {
    zoom: (o = {}) => ({ addTo(map) {
      const d = document.createElement("div"); d.className = "leaflet-control-zoom leaflet-bar leaflet-control";
      d.innerHTML = '<a class="leaflet-control-zoom-in" href="#" title="Hineinzoomen" role="button">+</a><a class="leaflet-control-zoom-out" href="#" title="Herauszoomen" role="button">−</a>';
      d.querySelector(".leaflet-control-zoom-in").onclick = e => { e.preventDefault(); map._g.setZoom(Math.round(map.getZoom()) + 1); };
      d.querySelector(".leaflet-control-zoom-out").onclick = e => { e.preventDefault(); map._g.setZoom(Math.round(map.getZoom()) - 1); };
      map._corner(o.position || "topleft").appendChild(d); return this; } }),
    // Kartentypen: Werte sind Google-Kartentypen („roadmap“, „hybrid“ …)
    layers: (base, _ov, o = {}) => ({ addTo(map) {
      const d = document.createElement("div"); d.className = "leaflet-control-layers leaflet-control";
      const name = "gl-" + Math.random().toString(36).slice(2);
      d.innerHTML = `<a class="leaflet-control-layers-toggle" href="#" title="Kartenart" role="button"></a><section class="leaflet-control-layers-list"><div class="leaflet-control-layers-base">${
        Object.keys(base).map((k, i) => `<label><span><input type="radio" class="leaflet-control-layers-selector" name="${name}" value="${i}"${i ? "" : " checked"}><span> ${k}</span></span></label>`).join("")}</div></section>`;
      d.querySelector("a").onclick = e => { e.preventDefault(); d.classList.toggle("leaflet-control-layers-expanded"); };
      d.addEventListener("change", e => { map._g.setMapTypeId(Object.values(base)[+e.target.value]); d.classList.remove("leaflet-control-layers-expanded"); });
      map._corner(o.position || "topright").appendChild(d); return this; } }),
  };
  const noopLayer = () => ({ addTo() { return this; }, remove() { return this; } });

  // Google laden (Schlüssel kommt erst nach dem Zugangscode)
  async function load(key) {
    (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({ key, v: "weekly", language: "de" });
    const timeout = new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 15000));
    await Promise.race([Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker")]), timeout]);
    google.maps.importLibrary("geocoding").catch(() => {});
    await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@googlemaps/markerclusterer@2.5.3/dist/index.min.js"; s.onload = ok; s.onerror = no; document.head.append(s); });
  }

  function MapCtor() {}
  MapCtor.prototype.setBearing = GMap.prototype.setBearing;
  window.L = {
    isGoogle: true, load, Map: MapCtor,
    map: (id, o) => new GMap(id, o), marker: (ll, o) => new Marker(ll, o), divIcon,
    markerClusterGroup: o => new Cluster(o), polyline: (a, o) => new Polyline(a, o), circleMarker: (ll, o) => new CircleMarker(ll, o),
    circle: (ll, o) => new Circle(ll, o), layerGroup: ls => new LayerGroup(ls), latLng, latLngBounds, control,
    tileLayer: noopLayer, gridLayer: { googleMutant: noopLayer },
  };
})();
