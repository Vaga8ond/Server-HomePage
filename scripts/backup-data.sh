#!/bin/bash
# Nightly snapshot of the history recorder's JSONL data (~/homebase/data)
# into ~/homebase/backups/<date>/ — keeps the last 7. Local-only for now;
# when the NAS opens SSH, change DST_ROOT to the NAS target.
set -euo pipefail

SRC="$HOME/homebase/data"
DST_ROOT="$HOME/homebase/backups"
KEEP=7

[ -d "$SRC" ] || { echo "backup: no $SRC, skipping"; exit 0; }

DST="$DST_ROOT/$(date +%F)"
mkdir -p "$DST"
rsync -a "$SRC/" "$DST/"

# prune old snapshots (keep newest $KEEP) — portable sort -r + tail -n +N
ls -1d "$DST_ROOT"/*/ 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" \
  | while IFS= read -r d; do rm -rf "$d"; done
echo "backup: $(du -sh "$DST" | cut -f1) → $DST (keeping $KEEP)"
