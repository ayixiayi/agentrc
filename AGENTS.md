# agentrc

My personal layer for Amp, Claude Code and Codex. Keep it small: add something only when the harness can't already do it.

## Layout

- `amp/plugins/guard.ts`: denies secret files and catastrophic commands; asks before push, publish, sudo and similar. Its policy block is the single source of truth.
- `amp/plugins/notify.ts`: desktop and Telegram notifications for long or failed turns.
- `amp/plugins/goal.ts`: opt-in per-thread goal that continues turns until the agent marks it complete or paused.
- `claude/agentrc/`: the Claude Code mod (function hooks) with the same guard (`tool.check`) and a desktop notification (`turn.complete`). `hooks/policy.ts` is generated from the Amp guard by `scripts/sync-policy.sh`. Never edit it by hand.
- `home/AGENTS.md`: global preferences, installed as `~/.config/amp/AGENTS.md`, `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`.
- `scripts/install.sh`: installs all of the above. `DRY_RUN=1` previews it.

## Checks

- `bun test`: guard, notify, and policy parity between Amp and Claude Code.
- `claude plugin validate claude/agentrc && claude plugin test claude/agentrc`: the mod.
- `python3 scripts/secret-guard.py .`: run before committing. Never commit a raw `settings.json` or `telegram.json`.

After changing the guard policy, run `scripts/sync-policy.sh` and then `bun test`.
