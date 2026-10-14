#!/usr/bin/env python3
"""Ort/Fotos aus einem Link auslesen (für die Routine): Google Maps, OpenStreetMap, Locationscout, sonst jede Webseite.

  python3 tools/linkinfo.py <url>      # gibt JSON aus: kind, name, lat, lng, exact, + Zusatzinfos

exact = Koordinaten stammen direkt aus dem Link/OSM-Objekt. Bei Locationscout sind die GPS-Daten nur
mit Login sichtbar → nur Name/Tipps/Foto; Koordinaten dann per Geocoding (exact=false).
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
HERE = os.path.dirname(os.path.abspath(__file__))


def get(url, ua=UA):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Language": "de,en"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")


def geocode(q):
    u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 1})
    try:
        _, body = get(u, ua="insta_map/1.0")
        r = json.loads(body)
        return (float(r[0]["lat"]), float(r[0]["lon"]), r[0]["display_name"]) if r else None
    except Exception:  # noqa: BLE001
        return None


def gmaps(url):
    final, body = get(url)  # Kurzlinks (maps.app.goo.gl) leiten auf die volle URL weiter
    u = urllib.parse.unquote(final)
    name = None
    m = re.search(r"/maps/place/([^/@]+)", u)
    if m:
        name = m.group(1).replace("+", " ")
    lat = lng = None
    m = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", u)  # genauer Ort des Eintrags
    if m:
        lat, lng = float(m.group(1)), float(m.group(2))
    else:
        m = re.search(r"[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)", u) or re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", u)
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
    if not name:
        m = re.search(r"[?&]q=([^&]+)", u)
        if m and not re.match(r"-?\d+\.\d+,", m.group(1)):
            name = m.group(1).replace("+", " ")
    if not name:
        m = re.search(r'<meta (?:property|itemprop)="(?:og:title|name)" content="([^"]+)"', body)
        if m:
            name = m.group(1).split(" · ")[0]
    out = {"kind": "gmaps", "url": final, "name": name, "lat": lat, "lng": lng, "exact": lat is not None}
    if lat is None and name:
        g = geocode(name)
        if g:
            out.update(lat=g[0], lng=g[1], geocoded=g[2], exact=False)
    return out


def osm(url):
    m = re.search(r"/(node|way|relation)/(\d+)", url)
    if m:
        t, i = m.groups()
        api = f"https://api.openstreetmap.org/api/0.6/{t}/{i}" + ("" if t == "node" else "/full") + ".json"
        _, body = get(api, ua="insta_map/1.0")
        els = json.loads(body)["elements"]
        obj = next(e for e in els if e["type"] == t and str(e["id"]) == i)
        nodes = [e for e in els if e["type"] == "node"]
        lat = sum(n["lat"] for n in nodes) / len(nodes)
        lng = sum(n["lon"] for n in nodes) / len(nodes)
        tags = obj.get("tags", {})
        return {"kind": "osm", "url": url, "name": tags.get("name:en") and f'{tags.get("name:en")} {tags.get("name", "")}'.strip() or tags.get("name"),
                "lat": round(lat, 6), "lng": round(lng, 6), "exact": True, "tags": tags}
    m = re.search(r"mlat=(-?\d+\.\d+).*?mlon=(-?\d+\.\d+)", url) or re.search(r"#map=\d+/(-?\d+\.\d+)/(-?\d+\.\d+)", url)
    if m:
        return {"kind": "osm", "url": url, "name": None, "lat": float(m.group(1)), "lng": float(m.group(2)), "exact": True}
    return {"kind": "osm", "url": url, "error": "kein Objekt/Ort im Link"}


def locationscout(url):
    r = subprocess.run(["node", os.path.join(HERE, "ls_fetch.js"), url], capture_output=True, text=True, timeout=120)
    if r.returncode:
        return {"kind": "locationscout", "url": url, "error": r.stderr.strip()[:300]}
    d = json.loads(r.stdout)
    name = re.sub(r",\s*[^,]+$", "", d.get("title") or "")  # „Jardine's Lookout, Hong Kong“ → Name
    out = {"kind": "locationscout", "url": d.get("final_url") or url, "name": name, "lat": None, "lng": None, "exact": False, **d}
    g = geocode(d.get("title") or name)
    if g:
        out.update(lat=g[0], lng=g[1], geocoded=g[2])
    return out


def web(url):
    r = subprocess.run(["node", os.path.join(HERE, "web_fetch.js"), url], capture_output=True, text=True, timeout=150)
    if r.returncode:
        return {"kind": "web", "url": url, "error": r.stderr.strip()[:300]}
    d = json.loads(r.stdout)
    return {"kind": "web", "url": d.get("final_url") or url, "name": None, "lat": None, "lng": None, "exact": False,
            "hint": "Ort(e) und Fotos aus title/description/text/json_ld/coords_in_page bestimmen – nie raten", **d}


def gcj2wgs(lat, lng):
    """GCJ-02 (chinesische Kartenkoordinaten) → WGS84, Genauigkeit ca. 1–2 m."""
    import math

    def t(x, y, a, b, c, d):
        r = a + b * x + c * y + 0.1 * x * x * (a == 300) + 0.2 * y * y * (a != 300) + 0.1 * x * y + d * math.sqrt(abs(x))
        r += (20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2 / 3
        v = y if a != 300 else x
        r += (20 * math.sin(v * math.pi) + 40 * math.sin(v / 3 * math.pi)) * 2 / 3
        r += ((160 * math.sin(v / 12 * math.pi) + 320 * math.sin(v * math.pi / 30)) if a != 300 else
              (150 * math.sin(v / 12 * math.pi) + 300 * math.sin(v / 30 * math.pi))) * 2 / 3
        return r
    A, EE = 6378245.0, 0.00669342162296594323
    x, y = lng - 105, lat - 35
    dl, dg = t(x, y, -100, 2, 3, 0.2), t(x, y, 300, 1, 2, 0.1)
    rl = lat / 180 * math.pi
    m = 1 - EE * math.sin(rl) ** 2
    dl = dl * 180 / ((A * (1 - EE)) / (m * math.sqrt(m)) * math.pi)
    dg = dg * 180 / (A / math.sqrt(m) * math.cos(rl) * math.pi)
    return round(lat - dl, 6), round(lng - dg, 6)


def tripcom(url):
    """trip.com Moments/Travel-Guide: Browser wird geblockt (whaleguard), einfacher Abruf liefert __NEXT_DATA__."""
    if "/w/" in url:  # Kurzlink: nur die erste Weiterleitung nehmen, Query (führt sonst zur Startseite) weglassen
        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        try:
            urllib.request.build_opener(NoRedir).open(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30)
        except urllib.error.HTTPError as e:
            url = re.sub(r"^https?://[^/]+", "https://www.trip.com", (e.headers.get("Location") or url).split("?")[0])
    final, html = get(url, ua="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return web(url)
    pp = json.loads(m.group(1))["props"]["pageProps"]
    mo = (pp.get("momentDetail") or {}).get("moment") or pp.get("moment") or {}
    out = {"kind": "web", "site": "trip.com", "url": final.split("?")[0], "title": mo.get("title"),
           "text": (mo.get("content") or "")[:4000], "author": (mo.get("author") or {}).get("nickName"),
           "images": [i["url"] for i in mo.get("imageList", [])], "pois": [], "lat": None, "lng": None,
           "exact": False, "hint": "POI-Koordinaten: lat_wgs/lng_wgs verwenden (GCJ-02 bereits umgerechnet)"}
    for poi in mo.get("poiList", []):
        e = {"name": poi.get("name"), "page": (poi.get("pageUrl") or {}).get("h5Url")}
        try:
            _, ph = get(e["page"])
            c = re.search(r'"coordinate":\{"coordinateType":"(\w+)","latitude":([\d.]+),"longitude":([\d.]+)', ph)
            a = re.search(r'"address":"([^"]+)"', ph)
            if c:
                e.update(coord_type=c.group(1), lat=float(c.group(2)), lng=float(c.group(3)))
                if c.group(1).upper().startswith("GCJ"):
                    e["lat_wgs"], e["lng_wgs"] = gcj2wgs(e["lat"], e["lng"])
            if a:
                e["address"] = a.group(1)
        except Exception:  # noqa: BLE001
            pass
        out["pois"].append(e)
    return out


def info(url):
    if re.search(r"(^|\.)trip\.com/", urllib.parse.urlsplit(url).netloc + "/"):
        return tripcom(url)
    if re.search(r"locationscout\.net/", url):
        return locationscout(url)
    if re.search(r"(openstreetmap|osm)\.org/", url):
        return osm(url)
    if re.search(r"(google\.[a-z.]+/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl/maps|g\.co/kgs)", url):
        return gmaps(url)
    return web(url)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print(json.dumps(info(sys.argv[1]), ensure_ascii=False, indent=1))
