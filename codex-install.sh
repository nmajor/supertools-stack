#!/usr/bin/env bash
#
# supertools-stack install — codex-supervised variant
#
# Wraps install.sh in a codex session so an LLM watches the output, diagnoses
# failures, and can propose fixes back into the template repo. Falls back to
# install.sh directly if codex is not installed.
#
# Status: v0.1 — codex wrapping is a stub. Currently just delegates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v codex >/dev/null 2>&1; then
  echo "(codex not installed — falling back to deterministic install.sh)"
  exec "$SCRIPT_DIR/install.sh" "$@"
fi

# v0.2+: actually wrap with codex. For v0.1, just delegate.
echo "(codex supervision is a v0.2+ feature — falling back to install.sh)"
exec "$SCRIPT_DIR/install.sh" "$@"
