/**
 * agentrc mail: a `message_claude` tool that writes to a Claude Code session on this machine.
 * The text is saved as a letter in a shared mailbox, and the session gets a one-line notice
 * pointing at it, which the agentrc Claude Code mod submits as a prompt once the session is idle.
 * Claude Code writes back with its `message_amp` tool.
 */
import type { PluginAPI } from '@ampcode/plugin'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Letters, logs and undelivered notices are kept this long. */
export const KEEP_MS = 90 * 24 * 60 * 60 * 1000

const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function mailRoot(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'agentrc', 'mail')
}

/** Whether a Claude Code session with this ID was ever recorded on this machine. */
function claudeProjects(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
}

export function claudeSessionExists(id: string): boolean {
  const projects = claudeProjects()
  try {
    return readdirSync(projects).some((dir) => existsSync(join(projects, dir, `${id}.jsonl`)))
  } catch {
    return false
  }
}

export function letterID(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${Math.random().toString(36).slice(2, 8)}`
}

/** Removes mail older than KEEP_MS, and inboxes left empty by sessions that stopped getting mail. */
export function pruneMail(now = Date.now()): void {
  const root = mailRoot()
  const old = (path: string) => now - lstatSync(path).mtimeMs > KEEP_MS
  const files = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
  }
  for (const dir of [root, join(root, '.logs'), join(root, '.tmp')]) {
    for (const entry of files(dir)) if (entry.isFile() && old(join(dir, entry.name))) unlinkSync(join(dir, entry.name))
  }
  for (const session of files(join(root, 'claude'))) {
    if (!session.isDirectory()) continue
    const inbox = join(root, 'claude', session.name)
    const isIdle = old(inbox) // no notice added or delivered for a while; judged before pruning touches it
    for (const entry of files(inbox)) if (entry.isFile() && old(join(inbox, entry.name))) unlinkSync(join(inbox, entry.name))
    if (isIdle && files(inbox).length === 0) rmdirSync(inbox)
  }
}

/** Saves the letter, then drops the notice into the session's inbox in one rename. Returns the letter's path. */
export function postToClaude(opts: { session: string; thread: string; cwd: string; message: string; now?: Date }): string {
  const root = mailRoot()
  const id = letterID(opts.now)
  const letter = join(root, `${id}.md`)
  const header = [
    `From: Amp thread ${opts.thread}${opts.cwd ? ` (${opts.cwd})` : ''}`,
    `To: Claude Code session ${opts.session}`,
    `Date: ${(opts.now ?? new Date()).toISOString()}`,
    `Reply: message_amp tool, to "${opts.thread}"`,
  ]
  mkdirSync(join(root, '.tmp'), { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  writeFileSync(letter, `${header.join('\n')}\n\n${opts.message.trim()}\n`, { mode: 0o600 })
  const notice =
    `You have mail from Amp thread ${opts.thread}${opts.cwd ? ` (in ${opts.cwd})` : ''}. ` +
    `Read ${letter}. Reply with the message_amp tool to "${opts.thread}" only if you have a result, a question or work for it; never just to acknowledge.`
  const inbox = join(root, 'claude', opts.session)
  mkdirSync(inbox, { recursive: true, mode: 0o700 })
  const tmp = join(root, '.tmp', id)
  writeFileSync(tmp, notice, { mode: 0o600 })
  renameSync(tmp, join(inbox, id))
  return letter
}

export default function (amp: PluginAPI) {
  if (!existsSync(claudeProjects())) return
  try {
    pruneMail()
  } catch (err) {
    amp.logger.log(`agentrc mail: prune failed: ${String(err)}`)
  }
  amp.registerTool({
    name: 'message_claude',
    description:
      'Message a Claude Code session on this machine, usually the one coordinating your work (its ID is in the mail you got from it). ' +
      'It reads your message when it is next idle, and its answer comes back to this thread as a new message, so do not wait for it. ' +
      'Use it to report a result, hand work back, or ask what you cannot decide yourself. Write tersely: the facts, paths, and what you need. ' +
      'No greeting, no acknowledgements, thanks or progress chatter, and no reply to a message that needs nothing from you.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The Claude Code session ID (a UUID).' },
        message: { type: 'string', description: 'What to tell the session.' },
      },
      required: ['to', 'message'],
    },
    async execute(input, ctx) {
      const session = String(input.to ?? '').trim()
      const message = String(input.message ?? '').trim()
      if (!SESSION.test(session)) return 'Error: to must be a Claude Code session ID (a UUID).'
      if (!message) return 'Error: message is required.'
      if (!claudeSessionExists(session)) return `Error: no Claude Code session ${session} on this machine.`
      const root = amp.system.workspaceRoot
      const cwd = root ? amp.helpers.filePathFromURI(root) : ''
      const letter = postToClaude({ session, thread: ctx.thread.id, cwd, message })
      return `Sent (${letter}). The session reads it when it is next idle; its reply will arrive here as a new message.`
    },
  })
}
