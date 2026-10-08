import type { Register } from 'claude-code'
import { catastrophic } from './policy'

const DESKTOP_MIN_MS = 30_000

export const register: Register = on => {
  // Refuse only catastrophic shell commands; everything else is the permission mode's call.
  on('tool.check', { tool: 'Bash' }, ($, e, next) => {
    const command = (e.input as { command?: unknown }).command
    const reason = typeof command === 'string' ? catastrophic(command) : undefined
    return reason ? { decision: 'deny', reason: `agentrc: blocked ${reason}` } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { decision: 'deny', reason: 'agentrc: guard failed' }))

  // Desktop notification for main-loop turns that ran long or died on an error.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.reason === 'aborted') return result
    const failed = e.reason === 'error' || e.reason === 'refusal'
    const title = `Claude ${failed ? `stopped (${e.reason})` : 'done'} · ${formatDuration(e.durationMs)}`
    if (failed || e.durationMs >= DESKTOP_MIN_MS) {
      await $.process
        .run(['notify-send', '-a', 'Claude Code', '-u', failed ? 'critical' : 'normal', '--transient', title, summarize(e.answer, 200)])
        .catch(() => undefined)
    }
    return result
  })
}

export function summarize(text: string, max: number): string {
  const plain = text.replace(/```[\s\S]*?```/g, '[code]').replace(/[*_`#>]/g, '').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}

export function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`
}
