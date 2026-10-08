# agentrc

My personal layer for Amp, Claude Code and Codex. Keep it small: add something only when the harness can't already do it.

## Layout

- `amp/plugins/approval.ts`: AI approval for Amp. Its regex policy block (catastrophic commands only) is the single source of truth.
- `amp/plugins/telegram.ts`: optional Telegram message for long or failed turns; off without `~/.config/amp/telegram.json`.
- `amp/plugins/goal.ts`: opt-in per-thread goal that continues turns until the agent marks it complete or paused.
- `claude/agentrc/`: the Claude Code mod (function hooks) with the same policy block on `tool.check`, and nothing else. `hooks/policy.ts` is generated from the Amp approval plugin by `scripts/sync-policy.sh`. Never edit it by hand.
- `home/AGENTS.md`: global preferences, installed as `~/.config/amp/AGENTS.md`, `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`.
- `scripts/install.sh`: installs all of the above. `DRY_RUN=1` previews it.

## Checks

- `bun test`: approval, telegram, goal, and policy parity between Amp and Claude Code.
- `claude plugin validate claude/agentrc && claude plugin test claude/agentrc`: the mod.
- `python3 scripts/secret-guard.py .`: run before committing. Never commit a raw `settings.json` or `telegram.json`.

After changing the regex policy, run `scripts/sync-policy.sh` and then `bun test`.
