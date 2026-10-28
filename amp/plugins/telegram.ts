/**
 * agentrc telegram: a `notify_user` tool the agent calls when the user needs to know something,
 * plus a message whenever a turn stops with an error. Off unless ~/.config/amp/telegram.json
 * exists when the plugin loads; the file is read on every send, so token rotation applies
 * without a reload.
 */
import type { PluginAPI } from '@ampcode/plugin'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface TelegramConfig {
  bot_token: string
  chat_id: string | number
}

export function telegramConfigPath(): string {
  const configDir = process.env.AMP_CONFIG_DIR ?? join(process.env.HOME ?? '', '.config/amp')
  return join(configDir, 'telegram.json')
}

export async function loadTelegramConfig(path = telegramConfigPath()): Promise<TelegramConfig | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return typeof parsed?.bot_token === 'string' && parsed.chat_id ? parsed : null
  } catch {
    return null
  }
}

export function summarize(text: string, max: number): string {
  const plain = text.replace(/```[\s\S]*?```/g, '[code]').replace(/[*_`#>]/g, '').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}

function lastInfoText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'info') continue
    const text = (m.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
    if (text.trim()) return text
  }
  return ''
}

const threadURL = (id: string) => `https://ampcode.com/threads/${id}`

export default function (amp: PluginAPI, deps: { fetch?: typeof fetch } = {}) {
  if (!existsSync(telegramConfigPath())) return
  const doFetch = deps.fetch ?? fetch

  async function send(text: string): Promise<string | undefined> {
    const telegram = await loadTelegramConfig()
    if (!telegram) return 'telegram.json is missing or incomplete'
    const res = await doFetch(`https://api.telegram.org/bot${telegram.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegram.chat_id, text, disable_web_page_preview: true }),
    }).catch((err: unknown) => err)
    if (res instanceof Response && res.ok) return undefined
    const why = res instanceof Response ? `HTTP ${res.status}` : 'network error'
    amp.logger.log(`telegram: send failed (${why})`)
    return why
  }

  amp.registerTool({
    name: 'notify_user',
    description:
      "Send the user a short message on their phone. They are often away from the screen, so use it when they would want to hear now: " +
      'a long task they left you on is done or has failed, you are blocked on a decision only they can make, ' +
      'or something needs their hands (a login, hardware, an approval). Not for routine progress, short turns, or anything they are watching you do. ' +
      'Write one or two plain sentences: what happened and what, if anything, you need from them.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The message, one or two plain sentences.' } },
      required: ['message'],
    },
    async execute(input, ctx) {
      const message = String(input.message ?? '').trim()
      if (!message) return 'Error: message is required.'
      const failed = await send(`${summarize(message, 1000)}\n\n${threadURL(ctx.thread.id)}`)
      return failed ? `Not sent: ${failed}.` : 'Sent.'
    },
  })

  amp.on('agent.end', async (event) => {
    if (event.status !== 'error') return
    const detail = summarize(lastInfoText(event.messages), 400)
    const request = summarize(event.message ?? '', 200)
    await send([`Amp stopped with an error${detail ? `: ${detail}` : '.'}`, request && `Task: ${request}`, threadURL(event.thread.id)].filter(Boolean).join('\n\n'))
  })
}
