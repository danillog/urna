#!/usr/bin/env bash
# Checks, commits everything, pushes and (optionally) deploys the site.
#   npm run ship -- "commit message"
# Stops at the first failing check, and asks before committing and before deploying.
set -euo pipefail
cd "$(dirname "$0")/.."

msg="${1:-}"

ask() {
  local answer
  read -r -p "$1 [s/N] " answer
  [[ "$answer" =~ ^[sSyY]$ ]]
}

echo "== Checks"
npm run typecheck
npx prettier --check src tests/web
npm test
uv run ruff check pipeline tests
uv run ruff format --check pipeline tests
uv run pytest -q
uv run python -m pipeline.build --check

echo
echo "== What goes in the commit"
git add -A
# Safety lock: SSH settings and env files never go to the repository.
if git diff --cached --name-only | grep -qE '(^|/)\.env(\.deploy|\.local)?$'; then
  echo "An .env file is staged; remove it (and add it to .gitignore) before publishing."
  git reset -q
  exit 1
fi
git status --short
if git diff --cached --quiet; then
  echo "Nothing to commit."
else
  if [ -z "$msg" ]; then
    read -r -p "Commit message: " msg
  fi
  [ -n "$msg" ] || { echo "No message, nothing done."; git reset -q; exit 1; }
  if ! ask "Commit these files and push to $(git rev-parse --abbrev-ref HEAD)?"; then
    git reset -q
    echo "Cancelled; files left as they were (unstaged)."
    exit 1
  fi
  git commit -m "$msg"
  git push
fi

echo
if ask "Deploy to danillogomes.com/urna now?"; then
  npm run deploy
fi
