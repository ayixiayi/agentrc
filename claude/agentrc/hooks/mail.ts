import type { Hook } from 'claude-code'

// Helpers for the mail hooks in register.ts, the Claude Code side of amp/plugins/mail.ts: letters
// live in ~/.local/state/agentrc/mail, and each side gets a one-line notice pointing at one.

export const MESSAGE_AMP = 'mcp__agentrc__message_amp'

export const MESSAGE_AMP_DESCRIPTION =
  'Message an Amp thread on this machine (another agent, on another model), or start a new thread with your message. ' +
  'Amp answers with its own message_claude tool, and the answer arrives here later as a new prompt: do not wait or poll, and never ask Amp to answer through files, handoff notes or the user. ' +
  'Write tersely, as to a colleague who already knows who you are and how to reply: the task or the facts, paths, and what you need back. No greeting, no explanation of this tool, no acknowledgements or thanks, and no reply to a message that needs nothing from Amp. ' +
  'Stop messaging when the exchange is not making progress or a message came by mistake, and tell the user instead. ' +
  'Amp often runs with nobody to approve a risky step, so do pushing, publishing, deploying, installing or system changes yourself instead of handing them over. ' +
  'Leave `to` out to start a new thread; it runs in the background, and the user can open it with `amp threads continue <id>`.'

export const MESSAGE_AMP_SCHEMA = {
  type: 'object',
  properties: {
    to: { type: 'string', description: 'The Amp thread ID (T-...) or URL. Leave it out to start a new thread.' },
    message: { type: 'string', description: 'What to tell Amp.' },
    mode: { type: 'string', description: 'For a new thread only: the Amp mode, such as low, medium, high or ultra.' },
  },
  required: ['message'],
}

const THREAD = /T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Wakes the thread with the notice: `$1` log, `$2` thread, `$3` notice, `$4` mode for a new thread.
 * A detached run executes the turn headless. When an Amp that has the thread open refuses it, that
 * run hands the notice to that Amp with `-ox` instead, however late the refusal comes. Only the
 * wrapper writes `<log>.state`, never Amp's output. Prints delivered or started after at most 12 s.
 */
export const WAKE = `log=$1 thread=$2 notice=$3 mode=$4 state=$1.state
set -- amp threads continue "$thread"
if [ -n "$mode" ]; then set -- "$@" -m "$mode"; fi
set -- "$@" -x "$notice"
run='log=$1 state=$2 thread=$3 notice=$4; shift 4
"$@" </dev/null >"$log" 2>&1; code=$?
if [ "$code" -ne 0 ] && grep -qE "already open and active in another Amp|already running in an orb" "$log"; then
  if amp threads continue "$thread" -ox -x "$notice" </dev/null >>"$log" 2>&1; then echo delivered >"$state"; else echo failed >"$state"; fi
else echo "exit $code" >"$state"; fi'
: >"$state"
if command -v setsid >/dev/null 2>&1; then setsid -f sh -c "$run" agentrc-mail "$log" "$state" "$thread" "$notice" "$@" </dev/null >/dev/null 2>&1
else nohup sh -c "$run" agentrc-mail "$log" "$state" "$thread" "$notice" "$@" </dev/null >/dev/null 2>&1 & fi
i=0
while [ "$i" -lt 24 ]; do
  case $(cat "$state") in
    delivered) echo delivered; exit 0 ;;
    'exit 0') echo started; exit 0 ;;
    exit*|failed) grep -m1 '^Error:' "$log" || tail -n 3 "$log"; exit 1 ;;
  esac
  sleep 0.5; i=$((i + 1))
done
echo started`

type $ = Parameters<Hook<'session.start'>>[0]

export function threadID(text: string): string | undefined {
  return text.match(THREAD)?.[0]
}

export async function mailRoot($: $): Promise<string> {
  const base = (await $.env.get('XDG_STATE_HOME')) || `${await $.env.get('HOME')}/.local/state`
  return `${base}/agentrc/mail`
}

export async function letterID($: $): Promise<string> {
  const now = new Date(await $.clock.now())
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Submits the notices waiting in this session's inbox as prompts, oldest first, removing each once
 * it has entered. A prompt the engine or a hook drops stays in the inbox, and delivery stops there.
 * Returns how many are left, and the drop's reason if one was dropped.
 */
export async function deliverMail($: $, inbox: string): Promise<{ waiting: number; dropped?: string }> {
  const entries = await $.fs.list(inbox).catch(() => [])
  const names = entries.filter((entry) => entry.kind === 'file' && !entry.name.startsWith('.')).map((entry) => entry.name).sort()
  for (const [i, name] of names.entries()) {
    const path = `${inbox}/${name}`
    const text = String(await $.fs.read(path)).trim()
    if (text) {
      const entered = await $.prompt.submit({ text })
      if (entered.drop !== undefined) return { waiting: names.length - i, dropped: entered.drop }
    }
    await $.process.run(['rm', '-f', '--', path])
  }
  return { waiting: 0 }
}

/** Writes the letter and wakes the thread, starting one first when `to` is left out. Returns what the model reads. */
export async function messageAmp($: $, input: { to?: unknown; message?: unknown; mode?: unknown }): Promise<{ text: string; isError?: true }> {
  const message = String(input.message ?? '').trim()
  const to = String(input.to ?? '').trim()
  const mode = String(input.mode ?? '').trim()
  if (!message) return { text: 'message is required.', isError: true }
  if (mode && !/^[\w:-]{1,40}$/.test(mode)) return { text: 'mode must be an Amp mode name, such as low, medium, high or ultra.', isError: true }
  let thread = to ? threadID(to) : undefined
  if (to && !thread) return { text: 'to must be an Amp thread ID (T-...) or URL; leave it out to start a new thread.', isError: true }

  const cwd = await $.session.cwd()
  if (!thread) {
    const made = await $.process.run(['amp', 'threads', 'new', ...(mode ? ['-m', mode] : [])], { cwd, timeoutMs: 60_000 })
    thread = threadID(made.stdout)
    if (made.exitCode !== 0 || !thread) return { text: `Could not start an Amp thread: ${(made.stderr || made.stdout).trim().slice(0, 300)}`, isError: true }
  }

  const session = await $.session.id()
  const root = await mailRoot($)
  const id = await letterID($)
  const letter = `${root}/${id}.md`
  await $.process.run(['sh', '-c', 'mkdir -p "$0/.logs" && chmod 700 "$0" "$0/.logs"', root])
  const header = [
    `From: Claude Code session ${session} (${cwd})`,
    `To: Amp thread ${thread}`,
    `Date: ${new Date(await $.clock.now()).toISOString()}`,
    `Reply: message_claude tool, to "${session}"`,
  ]
  await $.fs.write(letter, `${header.join('\n')}\n\n${message}\n`)
  const notice = `You have mail from Claude Code session ${session} (in ${cwd}). Read ${letter}. Reply with the message_claude tool to "${session}" only if you have a result, a question or work for it; never just to acknowledge.`

  const woke = await $.process.run(['sh', '-c', WAKE, 'agentrc-mail', `${root}/.logs/${id}.log`, thread, notice, to ? '' : mode], { cwd, timeoutMs: 90_000 })
  const how = woke.stdout.trim()
  if (woke.exitCode !== 0) return { text: `Could not reach ${thread}: ${(how || woke.stderr).slice(0, 300)} (letter ${letter})`, isError: true }
  const where = how === 'delivered' ? 'delivered to the Amp that has it open' : 'on its way (run headless, or handed to an Amp that has it open)'
  return { text: `Sent to ${to ? '' : 'new thread '}${thread}, ${where}. Letter: ${letter}. The reply will arrive here as a new prompt.` }
}
