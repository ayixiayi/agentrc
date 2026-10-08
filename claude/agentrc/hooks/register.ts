import type { Register } from 'claude-code'
import { catastrophic } from './policy'

// Refuse only catastrophic shell commands; everything else is the permission mode's call.
export const register: Register = on => {
  on('tool.check', { tool: 'Bash' }, ($, e, next) => {
    const command = (e.input as { command?: unknown }).command
    const reason = typeof command === 'string' ? catastrophic(command) : undefined
    return reason ? { decision: 'deny', reason: `agentrc: blocked ${reason}` } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { decision: 'deny', reason: 'agentrc: guard failed' }))
}
