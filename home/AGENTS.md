# Personal preferences

Installed as `~/.config/amp/AGENTS.md` (Amp), `~/.claude/CLAUDE.md` (Claude Code) and `~/.codex/AGENTS.md` (Codex).

## Working style

- Within the scope I asked for, keep going until the outcome is done and verified. Don't stop just to announce a plan, report partial progress, or ask whether to continue routine work.
- Ask only when a decision is genuinely mine: it changes shared state, is hard to reverse, or can't be inferred. Do the unblocked work first.
- Before saying something is done or fixed, run the check that proves it and say what you ran. If something wasn't checked, say so.
- Independent review from another model (the `ask-codex` skill in Claude Code, the oracle in Amp) costs minutes per round, so spend it where a miss is expensive: security, data loss, concurrency, public interfaces, or a change you are unsure of. Skip it for routine or easily reverted edits. One round is the default; re-review only a risky fix to a blocking finding. Run it in the background while you keep working.
- Commits, pushes, PRs, releases and other outward-facing actions need my go-ahead unless I already gave it for this task.

## Output

- Long explanations with formulas or derivations go in a file or artifact (Markdown, or self-contained HTML when layout helps), with a short summary in chat — unless I ask to keep it in chat.
- Academic papers, theses and lab reports: LaTeX source (XeLaTeX for Chinese) compiled to PDF; DOCX only as a compatibility copy.
- In Amp, use the built-in painter tool for image generation unless I ask otherwise.

## Secrets and SSH

- Never read, print or copy credentials, tokens, private keys, or the raw Amp `settings.json` / `telegram.json`. If a value is needed, ask me to set it locally.
- Use my existing OpenSSH multiplexing config as is. Check effective settings with `ssh -G <host>` if needed; don't read keys or edit `~/.ssh`.
