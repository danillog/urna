#!/usr/bin/env bash
# Publishes the site on Hostinger over SSH (rsync), at https://danillogomes.com/urna/.
# Settings in .env.deploy (see .env.deploy.example).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.deploy ] || { echo "Missing .env.deploy (copy it from .env.deploy.example)."; exit 1; }
# shellcheck disable=SC1091
source .env.deploy

: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PORT:=65002}" "${DEPLOY_PATH:?}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_hostinger}"

# Safety lock: --delete may only act inside the urna folder.
case "$DEPLOY_PATH" in
  */urna/) ;;
  *) echo "DEPLOY_PATH must end in /urna/ (it is: $DEPLOY_PATH)"; exit 1 ;;
esac

npm run build

rsync -avz --delete \
  -e "ssh -p $DEPLOY_PORT -i $DEPLOY_KEY" \
  dist/ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH"

echo "Published: https://danillogomes.com/urna/"
