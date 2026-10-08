#!/usr/bin/env bash
# Regenerate the Claude Code mod's policy from the Amp approval plugin (single source of truth).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
{
  echo "// Copied from amp/plugins/approval.ts by scripts/sync-policy.sh; edit it there."
  sed -n '/^\/\/ begin policy/,/^\/\/ end policy$/p' "$root/amp/plugins/approval.ts"
} > "$root/claude/agentrc/hooks/policy.ts"
