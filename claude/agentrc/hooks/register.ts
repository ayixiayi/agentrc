import type { Register } from 'claude-code'
import { catastrophic } from './policy'
import { deliverMail, MAIL_TURN_LIMIT, mailRoot, MESSAGE_AMP, MESSAGE_AMP_DESCRIPTION, MESSAGE_AMP_SCHEMA, messageAmp } from './mail'
import { configPath, DESCRIPTION, NOTIFY, send, summarize, where } from './telegram'

// Refuse only catastrophic shell commands; everything else is the permission mode's call.
// Plus the optional Telegram message shared with Amp (a notify_user tool and API errors), and mail
// between this session and Amp threads (a message_amp tool, and notices from Amp submitted as prompts).
export const register: Register = on => {
  on('tool.check', { tool: 'Bash' }, ($, e, next) => {
    const command = (e.input as { command?: unknown }).command
    const reason = typeof command === 'string' ? catastrophic(command) : undefined
    return reason ? { decision: 'deny', reason: `agentrc: blocked ${reason}` } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { decision: 'deny', reason: 'agentrc: guard failed' }))

  let lastPrompt = ''
  // Turns started by mail since the person last wrote; past the limit, letters wait for them.
  let mailTurns = 0
  let isMailPaused = false
  let mailPoll: { cancel(): void } | undefined

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

    if ((await $.process.run(['sh', '-c', 'command -v amp'])).exitCode !== 0) return started
    await $.tool.register({ name: 'message_amp', description: MESSAGE_AMP_DESCRIPTION, inputSchema: MESSAGE_AMP_SCHEMA, isDeferred: true })
    const root = await mailRoot($)
    let checking = false
    mailPoll?.cancel()
    mailPoll = $.clock.every(2_000, async () => {
      if (checking) return
      checking = true
      try {
        const inbox = `${root}/claude/${await $.session.id()}`
        const { waiting, dropped } = await deliverMail($, inbox, {
          allowed: () => !isMailPaused && mailTurns < MAIL_TURN_LIMIT,
          started: () => void mailTurns++,
        })
        if (waiting > 0 && !isMailPaused) {
          isMailPaused = true
          const why = dropped
            ? `an Amp letter was not let in (${dropped}); ${waiting} waiting. Write anything here to retry.`
            : `${waiting} Amp letter(s) are waiting after ${MAIL_TURN_LIMIT} mail turns in a row; write anything here to resume.`
          $.ui.status(`agentrc: ${why}`)
          await send($, `${await where($)}: mail paused. ${why}`)
        }
      } finally {
        checking = false
      }
    })
    return started
  })

  // Sending is left to the permission mode: the letter can start work in Amp.
  on('tool.call', { tool: MESSAGE_AMP }, async ($, e) => {
    const sent = await messageAmp($, e as { to?: unknown; message?: unknown; mode?: unknown })
    return sent.isError ? { deny: sent.text } : { result: sent.text }
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
    const from = (e as { origin?: { kind?: string } }).origin?.kind
    if (from === 'composer' || from === 'bridge') {
      mailTurns = 0
      if (isMailPaused) $.ui.status(undefined)
      isMailPaused = false
    }
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
