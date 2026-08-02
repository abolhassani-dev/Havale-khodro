#!/usr/bin/env bash
# Install this skill globally for Claude Code.
#
#   ./install.sh            install or update
#   ./install.sh --check    show what is installed without changing anything
set -euo pipefail

SKILL_NAME="fullstack-project-architecture"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${HOME}/.claude/skills/${SKILL_NAME}"

if [[ "${1:-}" == "--check" ]]; then
  if [[ -d "$DEST" ]]; then
    echo "Installed at: $DEST"
    grep -m1 '^## ' "$DEST/CHANGELOG.md" 2>/dev/null || true
  else
    echo "Not installed. Run ./install.sh"
  fi
  exit 0
fi

mkdir -p "${HOME}/.claude/skills"

if [[ -d "$DEST" ]]; then
  BACKUP="${DEST}.backup-$(date +%Y%m%d-%H%M%S)"
  cp -r "$DEST" "$BACKUP"
  echo "Existing version backed up to $BACKUP"
  rm -rf "$DEST"
fi

mkdir -p "$DEST"
cp -r "$SRC/SKILL.md" "$SRC/CHANGELOG.md" "$SRC/references" "$SRC/scripts" "$DEST/"
cp "$SRC/install.sh" "$DEST/" 2>/dev/null || true
chmod +x "$DEST/scripts/scaffold.py" "$DEST/install.sh" 2>/dev/null || true

echo "Installed '${SKILL_NAME}' to $DEST"
echo "Start a new Claude Code session for it to be picked up."
