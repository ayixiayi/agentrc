import type { Register } from 'claude-code'
import { checkPath, checkShell, checkToolInput, checkToolName, type Verdict } from './policy'

const DESKTOP_MIN_MS = 30_000

export const register: Register = on => {
  let home = ''

  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    return next(e)
  })

  // Secrets and catastrophic commands: deny. Outward-facing or destructive commands: ask,
  // which the session's permission mode then decides. Everything else: the engine's own verdict.
  on('tool.check', async ($, e, next) => {
    const input = (e.input ?? {}) as Record<string, unknown>
    let verdict: Verdict
    if (e.tool === 'Bash' && typeof input.command === 'string') verdict = checkShell(input.command, home)
    else if (e.tool === 'Glob' && typeof input.pattern === 'string') verdict = checkPath(input.pattern, home)
    else verdict = checkToolInput(input, home)
    if (verdict.decision === 'allow' && e.tool !== 'Bash') verdict = checkToolName(e.tool)

    if (verdict.decision === 'deny') return { decision: 'deny', reason: `agentrc: ${verdict.reason}` }
    const engine = await next(e)
    if (verdict.decision === 'ask' && engine.decision === 'allow') {
      return { decision: 'ask', reason: `agentrc: ${verdict.reason}` }
    }
    return engine
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
