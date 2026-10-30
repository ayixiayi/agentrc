# agentrc

My personal layer for coding agents: Amp, Claude Code and Codex. Like a `.bashrc`, it only holds what the harnesses don't already do:

1. **Approval**: a small deterministic check, with a quote-aware shell tokenizer, refuses the few commands whose damage is catastrophic and can't be undone: recursive deletes of `/`, a system directory or a home directory, `mkfs`/`wipefs`/`dd`/`shred` or redirection onto a disk, and a fork bomb. Everything else is reviewed by AI. In Amp, the `approval` plugin asks a fast decision model whether a shell command, MCP call, web fetch or edit outside the workspace needs you, given your request for the turn and the thread's last few calls. A prompt left unanswered for 5 minutes is refused so long tasks keep moving; that refusal, and any refusal in a background thread, goes to Telegram, and an Allow given after the timeout is passed on to the agent. Local reads and edits inside the workspace run unreviewed. In Claude Code, auto mode and its layered permission rules handle the rest.
2. **Telegram** (Amp and Claude Code, optional): a `notify_user` tool the agent calls when you'd want to hear now (a long task done, blocked on your decision, something needing your hands), plus a message whenever a turn stops with an error. On once `~/.config/agentrc/telegram.json` exists. Desktop notifications are left to the harnesses.
3. **Goal** (Amp): opt-in `goal` command. Once set, the thread keeps working across turns until the agent marks the goal complete or paused. Claude Code and Codex have `/goal` built in.
4. **Mail** (Amp and Claude Code): `message_amp` in Claude Code and `message_claude` in Amp let two agents on different models work together, typically Claude coordinating and Amp taking a task of its own. A message is saved as a letter in `~/.local/state/agentrc/mail/`, and the other side gets a one-line notice to read it. An Amp thread that is open somewhere gets it in that Amp; one that isn't (or a new thread) runs headless. A Claude Code session gets it as a prompt once it is idle. No waiting, scheduling or status tracking: the reply is just another letter, and the agents are told to stop when an exchange is not getting anywhere. Mail older than 90 days is pruned.
5. **Status line** (Amp): `ctx 6% · 5h 20% ↻2:40 · wk 16%`. `ctx` is how full the active thread is, as a share of the auto-compaction point (90% of the window); the rest is the Claude subscription left this session and this week, from `claude -p /usage` (a local command, no model call).
6. **Preferences**: one global `AGENTS.md` shared by all three.

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

## Telegram

Copy `telegram.json.example` to `~/.config/agentrc/telegram.json` and fill it in. Then run `plugins: reload` in Amp; Claude Code picks it up at the next session start. The file is re-read on every send.

## Develop

See `AGENTS.md`.

## License

MIT
