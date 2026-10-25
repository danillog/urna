#!/usr/bin/env sh
# One video per capital whose state elected its governor in the 1st round:
#   sh scripts/render-capitais.sh            # every capital in data/capitais-governador.json
#   sh scripts/render-capitais.sh 3550308    # some, by IBGE code
set -e
cd "$(dirname "$0")/.."
CODES="$*"
[ -n "$CODES" ] || CODES=$(node -e 'for (const c of require("./data/capitais-governador.json").capitals) console.log(c.code)')
mkdir -p out/capitais
for code in $CODES; do
  name=$(node -e "const c=require('./data/capitais-governador.json').capitals.find(c=>c.code==='$code'); console.log(c.name.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/ /g,'-'))")
  npx remotion render src/index.ts Capital "out/capitais/$name.mp4" --props="{\"code\":\"$code\"}" --log=error
  echo "out/capitais/$name.mp4"
done
