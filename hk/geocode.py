import json, time, urllib.parse, urllib.request, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from spots import S

CACHE = os.path.join(os.path.dirname(__file__), "geocache.json")
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
BBOX = (113.82, 22.15, 114.45, 22.57)  # lon_min, lat_min, lon_max, lat_max

def nom(q):
    if q in cache: return cache[q]
    params = dict(q=q, format="json", limit=1, viewbox=f"{BBOX[0]},{BBOX[3]},{BBOX[2]},{BBOX[1]}", bounded=1)
    u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(u, headers={"User-Agent": "hk-photospots-personal/1.0"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=30))
    except Exception as e:
        r = []
    res = None
    if r:
        res = dict(lat=float(r[0]["lat"]), lon=float(r[0]["lon"]), name=r[0].get("display_name",""), type=r[0].get("type",""))
    cache[q] = res
    json.dump(cache, open(CACHE,"w"), ensure_ascii=False, indent=1)
    time.sleep(1.1)
    return res

fails = []
for s in S:
    if isinstance(s["q"], tuple): continue
    r = nom(s["q"])
    if not r:
        fails.append(s["name"] + " | " + s["q"])
print("done", len(S), "fails", len(fails))
print("\n".join(fails))
