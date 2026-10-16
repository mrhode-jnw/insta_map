#!/bin/sh
# Prognose neu berechnen und in den Branch map-data schreiben (für die Routine, mehrmals täglich).
#   sh tools/update_forecast.sh
set -e
cd "$(dirname "$0")/.."
python3 tools/build_forecast.py
WT=/tmp/insta_map_data
for i in 1 2 3 4; do
  git fetch -q origin map-data
  [ -d "$WT" ] || git worktree add -q --detach "$WT" origin/map-data
  git -C "$WT" checkout -q --detach origin/map-data
  cp data/forecast.json "$WT/data/forecast.json"
  git -C "$WT" add data/forecast.json
  if git -C "$WT" diff --cached --quiet; then echo "Prognose unverändert."; exit 0; fi
  git -C "$WT" commit -qm "Prognose aktualisiert $(date -u +%Y-%m-%dT%H:%MZ)"
  if git -C "$WT" push -q origin HEAD:map-data; then echo "✔ Prognose nach map-data gepusht."; exit 0; fi
  sleep $((i * 4))
done
echo "Push nach map-data fehlgeschlagen." >&2; exit 1
