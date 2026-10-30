/**
 * agentrc statusline: one Amp status item with how close the active thread is to auto-compaction
 * (`amp threads context`) and how much of the Claude subscription is left (`claude -p /usage`).
 */
import type { PluginAPI } from '@ampcode/plugin'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'

/** Amp compacts at 90% of the context window unless an agent sets its own threshold. */
export const COMPACT_AT = 0.9
const CONTEXT_EVERY_MS = 10_000
const USAGE_EVERY_MS = 60_000

/** Context used, as a share of the compaction point rather than the whole window. */
export function contextText(ctx: { totalTokens: number; maxContextTokens: number }): string {
  const limit = Math.round(ctx.maxContextTokens * COMPACT_AT)
  const pct = Math.min(100, Math.round((ctx.totalTokens / limit) * 100))
  return `ctx ${pct}%`
}

/** "2:40am" -> "2:40", "6pm" -> "18:00" */
export function clock(t: string): string {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i.exec(t)
  if (!m) return t
  const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)
  return `${h}:${m[2] ?? '00'}`
}

/** Claude subscription left, from `claude -p /usage`: "5h 20% ↻2:40 · wk 16%". */
export function claudeText(out: string): string {
  const session = /Current session: (\d+)% used(?: · resets [^,\n]*, ([^ \n]+))?/.exec(out)
  const week = /Current week \(all models\): (\d+)% used/.exec(out)
  const parts: string[] = []
  if (session) parts.push(`5h ${100 - Number(session[1])}%${session[2] ? ` ↻${clock(session[2])}` : ''}`)
  if (week) parts.push(`wk ${100 - Number(week[1])}%`)
  return parts.join(' · ')
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout: 30_000, cwd: tmpdir() }, (err, out) => (err ? reject(err) : resolve(out))),
  )

export default function (amp: PluginAPI) {
  const item = amp.createStatusItem()
  let ctxPart = ''
  let usagePart = ''
  let ctxAt = 0
  let usageAt = 0

  const refresh = async (force = false) => {
    const id = amp.activeThread.current?.id
    const now = Date.now()
    const jobs: Promise<void>[] = []
    if (!id) ctxPart = ''
    else if (force || now - ctxAt > CONTEXT_EVERY_MS) {
      ctxAt = now
      jobs.push(
        run('amp', ['threads', 'context', id]).then((out) => {
          // Drop the answer if the user switched threads while it ran.
          if (amp.activeThread.current?.id === id) ctxPart = contextText(JSON.parse(out))
        }),
      )
    }
    if (now - usageAt > USAGE_EVERY_MS) {
      usageAt = now
      // A local command: no model call, no session file.
      jobs.push(run('claude', ['-p', '/usage', '--no-session-persistence']).then((out) => void (usagePart = claudeText(out))))
    }
    for (const r of await Promise.allSettled(jobs)) {
      if (r.status === 'rejected') amp.logger.log(`agentrc statusline: ${String(r.reason)}`)
    }
    const text = [ctxPart, usagePart].filter(Boolean).join(' · ')
    if (text) item.update({ text })
  }

  const isActive = (thread: { id: string }) => thread.id === amp.activeThread.current?.id
  amp.activeThread.subscribe(() => void refresh(true))
  amp.on('tool.result', (event) => void (isActive(event.thread) && refresh()))
  amp.on('agent.end', (event) => void (isActive(event.thread) && refresh(true)))
  void refresh(true)
}
