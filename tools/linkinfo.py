#!/usr/bin/env python3
"""Ort aus einem Google-Maps-, OpenStreetMap- oder Locationscout-Link auslesen (für die Routine).

  python3 tools/linkinfo.py <url>      # gibt JSON aus: kind, name, lat, lng, exact, + Zusatzinfos

exact = Koordinaten stammen direkt aus dem Link/OSM-Objekt. Bei Locationscout sind die GPS-Daten nur
mit Login sichtbar → nur Name/Tipps/Foto; Koordinaten dann per Geocoding (exact=false).
"""
import json
import os
import re
import subprocess
import sys
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


def info(url):
    if re.search(r"locationscout\.net/", url):
        return locationscout(url)
    if re.search(r"(openstreetmap|osm)\.org/", url):
        return osm(url)
    return gmaps(url)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print(json.dumps(info(sys.argv[1]), ensure_ascii=False, indent=1))
