import type { Hook } from 'claude-code'

// Helpers for the Telegram hooks in register.ts, the same messages as amp/plugins/telegram.ts.
// Off unless ~/.config/agentrc/telegram.json exists at session start; the file is read on every send.

export const NOTIFY = 'mcp__agentrc__notify_user'

export const DESCRIPTION =
  "Send the user a short message on their phone. They are often away from the screen, so use it when they would want to hear now: " +
  'a long task they left you on is done or has failed, you are blocked on a decision only they can make, ' +
  'or something needs their hands (a login, hardware). Not for routine progress, approval prompts (Amp shows those itself), short turns, or anything they are watching you do. ' +
  'Write one or two plain sentences: what happened and what, if anything, you need from them.'

type $ = Parameters<Hook<'session.start'>>[0]

export function summarize(text: string, max: number): string {
  const plain = text.replace(/```[\s\S]*?```/g, '[code]').replace(/[*_`#>]/g, '').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}

export async function configPath($: $): Promise<string> {
  const base = (await $.env.get('XDG_CONFIG_HOME')) || `${await $.env.get('HOME')}/.config`
  return `${base}/agentrc/telegram.json`
}

export async function send($: $, text: string): Promise<string | undefined> {
  let telegram: { bot_token?: unknown; chat_id?: unknown }
  try {
    telegram = JSON.parse(String(await $.fs.read(await configPath($))))
  } catch {
    return 'telegram.json is missing or unreadable'
  }
  if (typeof telegram.bot_token !== 'string' || !telegram.chat_id) return 'telegram.json is incomplete'
  const res = await $.http
    .fetch(`https://api.telegram.org/bot${telegram.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegram.chat_id, text, disable_web_page_preview: true }),
    })
    .catch(() => undefined)
  return res?.ok ? undefined : res ? `HTTP ${res.status}` : 'network error'
}

export async function where($: $): Promise<string> {
  return `Claude Code · ${(await $.session.cwd()).replace(/^.*\//, '') || '/'}`
}
