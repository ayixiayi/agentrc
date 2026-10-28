import type { Register } from 'claude-code'
import { catastrophic } from './policy'
import { configPath, DESCRIPTION, NOTIFY, send, summarize, where } from './telegram'

// Refuse only catastrophic shell commands; everything else is the permission mode's call.
// Plus the optional Telegram message shared with Amp: a notify_user tool and API errors.
export const register: Register = on => {
  on('tool.check', { tool: 'Bash' }, ($, e, next) => {
    const command = (e.input as { command?: unknown }).command
    const reason = typeof command === 'string' ? catastrophic(command) : undefined
    return reason ? { decision: 'deny', reason: `agentrc: blocked ${reason}` } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { decision: 'deny', reason: 'agentrc: guard failed' }))

  let lastPrompt = ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (await $.fs.exists(await configPath($))) {
      await $.tool.register({
        name: 'notify_user',
        description: DESCRIPTION,
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string', description: 'The message, one or two plain sentences.' } },
          required: ['message'],
        },
        isDeferred: false,
      })
    }
    return started
  })

  // The message only reaches the user's own chat, so it needs no review.
  on('tool.check', { tool: NOTIFY }, () => ({ decision: 'allow' as const }))

  on('tool.call', { tool: NOTIFY }, async ($, e) => {
    const message = String((e as { message?: unknown }).message ?? '').trim()
    if (!message) return { deny: 'message is required.' }
    const failed = await send($, `${summarize(message, 1000)}\n\n${await where($)}`)
    return failed ? { deny: `Not sent: ${failed}.` } : { result: 'Sent.' }
  })

  on('prompt.submit', ($, e, next) => {
    lastPrompt = String((e as { text?: unknown }).text ?? '')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.reason === 'error' && !e.agentId) {
      const task = summarize(lastPrompt, 200)
      await send($, [`${await where($)} stopped with an API error.`, task && `Task: ${task}`].filter(Boolean).join('\n\n'))
    }
    return done
  })
}
