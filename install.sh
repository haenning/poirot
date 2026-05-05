#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"
npm install
npm run package

VSIX=$(ls poirot-*.vsix | tail -1)

if command -v cursor &>/dev/null; then
  cursor --install-extension "$VSIX"
elif command -v code &>/dev/null; then
  code --install-extension "$VSIX"
else
  echo "Installed: $VSIX"
  echo "Run: code --install-extension $VSIX"
fi
