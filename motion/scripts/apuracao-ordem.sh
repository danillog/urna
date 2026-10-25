#!/usr/bin/env sh
# Copies the live capture of the count (pipeline.apuracao_ordem) into the motion.
#   sh scripts/apuracao-ordem.sh          # 2026 r2
#   sh scripts/apuracao-ordem.sh r1 2026
set -e
ROUND="${1:-r2}"
YEAR="${2:-2026}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/../data/raw/apuracao/$YEAR-$ROUND-ordem.json"
[ -f "$SRC" ] || { echo "missing $SRC: run uv run python -m pipeline.apuracao_ordem $ROUND during the count" >&2; exit 1; }
cp "$SRC" "$HERE/src/apuracao/ordem-$ROUND.json"
echo "copied $SRC -> src/apuracao/ordem-$ROUND.json"
