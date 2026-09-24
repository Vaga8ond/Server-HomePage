#!/usr/bin/env bash
# Deploy to the Mac mini dashboard server (192.168.12.53, launchd, no Docker).
#
# Usage:  ./deploy-mini.sh
#
# rsync (excludes server-local state) → vite build on the mini → restart
# the launchd service. SSH alias must exist in ~/.ssh/config.
set -euo pipefail

REMOTE="${REMOTE:-Internal_server@192.168.12.53}"
DEST="${DEST:-~/homebase}"

echo "▸ rsync → ${REMOTE}:${DEST}"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'backend/node_modules' \
  --exclude 'backend/config' \
  --exclude 'data' \
  --exclude '.env*' \
  --exclude '.api-token' \
  --exclude 'run_homebase.sh' \
  --exclude 'deploy.sh' \
  --exclude 'deploy-mini.sh' \
  ./ "${REMOTE}:${DEST}/"

echo "▸ build on remote"
ssh "${REMOTE}" "export PATH=\$HOME/.local/bin:/opt/homebrew/bin:\$PATH; cd ${DEST} && npm run build"

echo "▸ restart launchd service"
ssh "${REMOTE}" "launchctl kickstart -k gui/\$(id -u)/com.homebase.server"

echo "✓ deployed → http://192.168.12.53:8088"
