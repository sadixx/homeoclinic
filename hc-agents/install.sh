#!/usr/bin/env bash
# Kiro only: export the pack and link the agent configs into ~/.kiro/agents (re-run after edits).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
python3 "$here/export.py" --target kiro
mkdir -p "$HOME/.kiro/agents"
for f in "$here"/dist/kiro/HomeoClinic-*.json; do
  ln -sf "$f" "$HOME/.kiro/agents/$(basename "$f")"
done
echo "linked $(ls "$here"/dist/kiro/HomeoClinic-*.json | wc -l) agents into ~/.kiro/agents (remove with: rm ~/.kiro/agents/HomeoClinic-*.json)"
