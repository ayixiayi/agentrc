/**
 * agentrc telegram: optional Telegram message when a main-thread turn ran at least
 * `long_task_threshold_sec` (default 180s) or ended in error. Off unless ~/.config/amp/telegram.json
 * exists; the file is read on every send, so edits and token rotation apply without a reload.
 *
 * Threads that are not the active one (subagents, background work) stay quiet.
 */
import type { PluginAPI } from '@ampcode/plugin'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface TelegramConfig {
  bot_token: string
  chat_id: string | number
  long_task_threshold_sec?: number
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

export function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`
}

function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'assistant') continue
    const text = typeof m.content === 'string'
      ? m.content
      : (m.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
    if (text.trim()) return text
  }
  return ''
}

export default function (amp: PluginAPI, deps: { now?: () => number; fetch?: typeof fetch } = {}) {
  const now = deps.now ?? Date.now
  const doFetch = deps.fetch ?? fetch
  const started = new Map<string, number>()

  amp.on('agent.start', (event) => {
    started.set(event.thread.id, now())
  })

  amp.on('agent.end', async (event) => {
    const start = started.get(event.thread.id)
    started.delete(event.thread.id)
    if (start === undefined || event.status === 'cancelled') return
    if (amp.activeThread.current && amp.activeThread.current.id !== event.thread.id) return

    const elapsed = now() - start
    const failed = event.status === 'error'
    const title = `Amp ${failed ? 'stopped with an error' : 'done'} · ${formatDuration(elapsed)}`
    const telegram = await loadTelegramConfig()
    if (!telegram) return
    if (!failed && elapsed < (telegram.long_task_threshold_sec ?? 180) * 1000) return
    const body = summarize(lastAssistantText(event.messages), 600)
    const res = await doFetch(`https://api.telegram.org/bot${telegram.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegram.chat_id, text: `${title}\n\n${body}`.trim(), disable_web_page_preview: true }),
    }).catch((err: unknown) => err)
    if (!(res instanceof Response) || !res.ok) {
      amp.logger.log(`telegram: send failed (${res instanceof Response ? res.status : 'network error'})`)
    }
  })
}
