#!/usr/bin/env bash
# Relay installer — macOS / Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/ssm-08/relay/master/install.sh | sh
# Or:    ./install.sh [--from-local <path>] [--home <path>] [--dry-run]
# Note:  When piping via curl, pass args as: curl ... | sh -s -- --from-local /path
set -eu

# Node >= 20 check
if ! command -v node >/dev/null 2>&1; then
  echo "[relay] ERROR: node not found on PATH." >&2
  echo "  Install from https://nodejs.org/ or via nvm: https://github.com/nvm-sh/nvm" >&2
  exit 2
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[relay] ERROR: Node $NODE_MAJOR found but >= 20 required." >&2
  echo "  Install from https://nodejs.org/ or via nvm: https://github.com/nvm-sh/nvm" >&2
  exit 2
fi

# git check
if ! command -v git >/dev/null 2>&1; then
  echo "[relay] ERROR: git not found on PATH. Install from https://git-scm.com/" >&2
  exit 2
fi

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
CLONE="$CLAUDE_HOME/relay"

# If --from-local is provided, skip clone
FROM_LOCAL=""
ARGS="$*"
for arg in "$@"; do
  case "$arg" in
    --from-local) FROM_LOCAL="$2"; break ;;
  esac
done

if [ -z "$FROM_LOCAL" ] && [ ! -d "$CLONE" ]; then
  echo "[relay] Cloning relay into $CLONE ..." >&2
  if [ "$(uname)" = "Darwin" ]; then
    echo "[relay] TIP: If macOS shows a Command Line Tools dialog, install it and re-run." >&2
  fi
  git clone --depth=1 https://github.com/ssm-08/relay "$CLONE"
fi

INSTALLER="${FROM_LOCAL:-$CLONE}/scripts/installer.mjs"
exec node "$INSTALLER" install "$@"
