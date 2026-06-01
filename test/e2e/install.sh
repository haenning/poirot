#!/usr/bin/env bash
# Smoke-test: package the extension and install it into Cursor.
# Exits non-zero if packaging or installation fails.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "[install-test] building..."
npm run compile

echo "[install-test] packaging..."
VSIX=$(npm run package --silent 2>/dev/null | grep -o '[^ ]*\.vsix' | tail -1)
if [ -z "$VSIX" ]; then
  # fallback: find the most recently modified vsix
  VSIX=$(ls -t "$ROOT"/*.vsix 2>/dev/null | head -1)
fi
if [ -z "$VSIX" ]; then
  echo "[install-test] ERROR: no .vsix found after packaging" >&2
  exit 1
fi
echo "[install-test] packaged: $VSIX"

echo "[install-test] installing into Cursor..."
cursor --install-extension "$VSIX"

echo "[install-test] OK"
