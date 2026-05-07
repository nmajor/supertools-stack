#!/usr/bin/env bash
#
# supertools-stack install
#
# Bootstrap a TanStack Start + Cloudflare Workers project at <target-path>.
#
# Usage:
#   install.sh <target-path> [--no-refresh] [--refresh]
#
# By default, refreshes deps in this template repo at most once every 7 days
# before running the install. Use --no-refresh to skip; --refresh to force.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAST_REFRESH_FILE="$SCRIPT_DIR/.last-refresh"
WEEK_SECONDS=604800

usage() {
  cat <<EOF
Usage: install.sh <target-path> [--no-refresh] [--refresh]

Bootstrap a TanStack Start + Cloudflare Workers project at <target-path>.

Flags:
  --no-refresh   Skip the once-weekly dependency-refresh step.
  --refresh      Force a refresh now even if one ran < 7 days ago.
EOF
}

# Parse args
TARGET=""
SHOULD_REFRESH=auto

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --no-refresh) SHOULD_REFRESH=false; shift ;;
    --refresh) SHOULD_REFRESH=true; shift ;;
    -*) echo "Unknown flag: $1" >&2; usage >&2; exit 1 ;;
    *)
      if [ -z "$TARGET" ]; then TARGET="$1"; else echo "Multiple targets given" >&2; exit 1; fi
      shift
      ;;
  esac
done

if [ -z "$TARGET" ]; then
  usage >&2
  exit 1
fi

# Resolve auto-mode based on .last-refresh
if [ "$SHOULD_REFRESH" = auto ]; then
  if [ -f "$LAST_REFRESH_FILE" ]; then
    last=$(cat "$LAST_REFRESH_FILE")
    now=$(date +%s)
    age=$((now - last))
    if [ "$age" -lt "$WEEK_SECONDS" ]; then
      SHOULD_REFRESH=false
    else
      SHOULD_REFRESH=true
    fi
  else
    SHOULD_REFRESH=true
  fi
fi

# Refresh if needed
if [ "$SHOULD_REFRESH" = true ]; then
  echo "▶ Refreshing template (last refresh > 7 days ago or first run)..."
  if node "$SCRIPT_DIR/scripts/refresh.mjs"; then
    date +%s > "$LAST_REFRESH_FILE"
    # Try commit + push, gracefully degrade if no perms
    if (cd "$SCRIPT_DIR" && [ -n "$(git status --porcelain 2>/dev/null)" ]); then
      if (cd "$SCRIPT_DIR" && git add -A && git commit -m "auto: weekly refresh" >/dev/null 2>&1 && git push >/dev/null 2>&1); then
        echo "  (refresh committed and pushed)"
      else
        (cd "$SCRIPT_DIR" && git reset --soft HEAD~1 >/dev/null 2>&1 || true)
        echo "  (no push perms — local refresh kept in working tree)"
      fi
    fi
  else
    echo "  (refresh failed — proceeding with existing template)"
  fi
fi

# Run the orchestrator
exec node "$SCRIPT_DIR/scripts/orchestrate-install.mjs" "$TARGET"
