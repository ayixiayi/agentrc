#!/usr/bin/env bash
# Regenerate the Claude Code mod's policy from the Amp guard (single source of truth).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
{
  echo "// Copied from amp/plugins/guard.ts by scripts/sync-policy.sh; edit it there."
  sed -n '/^\/\/ begin policy/,/^\/\/ end policy$/p' "$root/amp/plugins/guard.ts"
} > "$root/claude/agentrc/hooks/policy.ts"
