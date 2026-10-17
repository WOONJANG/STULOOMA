#!/usr/bin/env bash
# Reproduce the development toolchain without modifying source, manifests, or lockfiles.
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("STULOOMA cloud setup requires Node.js 24+")'
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/workspace/.cache/npm}"
export electron_config_cache="${electron_config_cache:-/workspace/.cache/electron}"
export ELECTRON_CACHE="$electron_config_cache"
export NODE_USE_ENV_PROXY=1
mkdir -p "$NPM_CONFIG_CACHE" "$electron_config_cache"
npm ci --no-audit --no-fund
node node_modules/electron/install.js
bash scripts/setup-cloud-display.sh --install-only
npm run build
npm test
