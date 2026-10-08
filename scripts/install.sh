#!/usr/bin/env bash
# Install agentrc into Amp, Claude Code and Codex. Safe to re-run after `git pull`.
#
#   scripts/install.sh            install everything
#   DRY_RUN=1 scripts/install.sh  show what would change
#
# A file it would overwrite that didn't come from this repo is moved to $AMP_CONFIG_DIR/agentrc-backup/<timestamp>/ first.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
amp_dir="${AMP_CONFIG_DIR:-$HOME/.config/amp}"
claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
backup="$amp_dir/agentrc-backup/$(date +%Y%m%d-%H%M%S)"
dry() { [[ "${DRY_RUN:-0}" == 1 ]]; }
run() { if dry; then echo "would: $*"; else "$@"; fi; }

# Plugins from earlier layouts, retired in favour of approval.ts, telegram.ts and goal.ts.
retired=(guard notify ask-user-choice autofix delegation-orchestrator desktop-notify ephemeral-skill-orb github-issues
  oma-bootstrap oma-safety oma-sync oma-todo permissions secret-config-broker status-bar telegram-webhook
  upgrade-sentinel)

stash() { # move a file into the backup dir, keeping its name
  run mkdir -p "$backup"
  run mv "$1" "$backup/$(basename "$1")${2:-}"
}

ours() { # is this file some past version of a file in this repo?
  git -C "$root" cat-file -e "$(git hash-object "$1")" 2>/dev/null
}

place() { # place <src> <dst>: copy unless identical; back up a different file we didn't install
  if [[ -f "$2" ]] && cmp -s "$1" "$2"; then return; fi
  if [[ -f "$2" ]] && ! ours "$2"; then stash "$2" ".$(basename "$(dirname "$2")")"; fi
  run install -D -m 0644 "$1" "$2"
  echo "installed $2"
}

python3 "$root/scripts/secret-guard.py" "$root"

for name in "${retired[@]}"; do
  [[ -f "$amp_dir/plugins/$name.ts" ]] && run rm "$amp_dir/plugins/$name.ts" && echo "retired plugin $name"
done
for plugin in "$root"/amp/plugins/*.ts; do
  place "$plugin" "$amp_dir/plugins/$(basename "$plugin")"
done

place "$root/home/AGENTS.md" "$amp_dir/AGENTS.md"
place "$root/home/AGENTS.md" "$claude_dir/CLAUDE.md"
[[ -d "${CODEX_HOME:-$HOME/.codex}" ]] && place "$root/home/AGENTS.md" "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"

if command -v claude >/dev/null; then
  if ! claude plugin marketplace list 2>/dev/null | grep -q "❯ agentrc$"; then
    run claude plugin marketplace add "$root"
  fi
  run claude plugin install agentrc@agentrc --scope user
else
  echo "claude not found; skipped the Claude Code mod"
fi

echo "done. Reload Amp plugins (command palette: plugins: reload) and run /reload-plugins in Claude Code."
[[ -d "$backup" ]] && echo "backups: $backup"
exit 0
