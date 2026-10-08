# agentrc

My personal layer for coding agents: Amp, Claude Code and Codex. Like a `.bashrc`, it only holds what the harnesses don't already do:

1. **Approval**: a small deterministic check, with a quote-aware shell tokenizer, refuses the few commands whose damage is catastrophic and can't be undone: recursive deletes of `/`, a system directory or a home directory, `mkfs`/`wipefs`/`dd`/`shred` or redirection onto a disk, and a fork bomb. Everything else is reviewed by AI. In Amp, the `approval` plugin asks a fast decision model whether a shell command, MCP call, web fetch or edit outside the workspace needs you, given your request for the turn. Local reads and edits inside the workspace run unreviewed. In Claude Code, auto mode and its layered permission rules handle the rest.
2. **Notify** (Amp): sends a desktop notification for turns that ran 30s+ or failed, and optionally a Telegram message for turns past a threshold. Claude Code and Codex use their built-in notifications.
3. **Goal** (Amp): opt-in `goal` command. Once set, the thread keeps working across turns until the agent marks the goal complete or paused. Claude Code and Codex have `/goal` built in.
4. **Preferences**: one global `AGENTS.md` shared by all three.

My skills live in a separate, private repo (`agentrc-skills`).

Everything else (subagents, todos, questions, planning, permission modes, worktrees) is left to the harnesses' native features.

## Install

```sh
git clone https://github.com/ayixiayi/agentrc.git ~/agentrc
~/agentrc/scripts/install.sh        # DRY_RUN=1 to preview
```

This does four things:
- copies `amp/plugins/*.ts` to `~/.config/amp/plugins/`
- installs `home/AGENTS.md` as `~/.config/amp/AGENTS.md`, `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`
- registers this repo as a local Claude Code marketplace and installs the `agentrc` mod
- moves any file it would overwrite that didn't come from this repo to `~/.config/amp/agentrc-backup/`

To update, run `git pull`, then `scripts/install.sh`. Then run `plugins: reload` in Amp and `/reload-plugins` in Claude Code.

Only want the Claude Code mod? In Claude Code, run `/plugin install agentrc --marketplace ayixiayi/agentrc`.

`home/AGENTS.md` holds my own preferences. Replace it with yours before installing.

## Amp Telegram

Copy `amp/telegram.json.example` to `~/.config/amp/telegram.json` and fill it in. It is re-read on every send.

## Develop

See `AGENTS.md`.

## License

MIT
