#!/usr/bin/env bash
# Wyren installer — macOS / Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/ssm-08/wyren/master/install.sh | sh
# Or:    ./install.sh [--from-local <path>] [--home <path>] [--dry-run]
# Note:  When piping via curl, pass args as: curl ... | sh -s -- --from-local /path
set -eu

# Node >= 20 check
if ! command -v node >/dev/null 2>&1; then
  echo "[wyren] ERROR: node not found on PATH." >&2
  echo "  Install from https://nodejs.org/ or via nvm: https://github.com/nvm-sh/nvm" >&2
  exit 2
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[wyren] ERROR: Node $NODE_MAJOR found but >= 20 required." >&2
  echo "  Install from https://nodejs.org/ or via nvm: https://github.com/nvm-sh/nvm" >&2
  exit 2
fi

# npm check
if ! command -v npm >/dev/null 2>&1; then
  echo "[wyren] ERROR: npm not found on PATH. Install from https://nodejs.org/" >&2
  exit 2
fi

# Parse --from-local (dev installs only)
FROM_LOCAL=""
_prev=""
for _arg in "$@"; do
  if [ "$_prev" = "--from-local" ]; then
    FROM_LOCAL="$_arg"
    break
  fi
  _prev="$_arg"
done

if [ -n "$FROM_LOCAL" ]; then
  # Dev install: run installer directly from local checkout
  exec node "${FROM_LOCAL}/scripts/installer.mjs" install "$@"
fi

# Standard install: npm global install, then wire hooks
echo "[wyren] Installing wyren globally..." >&2
npm install -g wyren

exec wyren install "$@"
