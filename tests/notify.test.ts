import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import notify from '../amp/plugins/notify'

let configDir = ''
const previous = process.env.AMP_CONFIG_DIR

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'agentrc-notify.'))
  process.env.AMP_CONFIG_DIR = configDir
})
afterEach(async () => {
  if (previous === undefined) delete process.env.AMP_CONFIG_DIR
  else process.env.AMP_CONFIG_DIR = previous
  await rm(configDir, { recursive: true, force: true })
})

function harness(activeThreadID = 'T1') {
  const handlers: Record<string, (event: any) => Promise<void> | void> = {}
  const desktop: string[] = []
  const telegram: string[] = []
  let clock = 0
  const amp: any = {
    activeThread: { current: { id: activeThreadID } },
    logger: { log() {} },
    on: (name: string, fn: any) => (handlers[name] = fn),
    $: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      desktop.push(String(values[1]))
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  }
  const fetch = (async (url: string, init: any) => {
    telegram.push(`${url} ${init.body}`)
    return new Response('{}')
  }) as unknown as typeof globalThis.fetch
  notify(amp, { now: () => clock, fetch })
  const turn = async (ms: number, status = 'done', thread = 'T1') => {
    handlers['agent.start']({ thread: { id: thread } })
    clock += ms
    await handlers['agent.end']({
      thread: { id: thread },
      status,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: '**All green**' }] }],
    })
  }
  return { turn, desktop, telegram }
}

test('short turns stay quiet', async () => {
  const h = harness()
  await h.turn(5_000)
  expect(h.desktop).toEqual([])
})

test('long turns notify the desktop; Telegram only when configured and past threshold', async () => {
  const h = harness()
  await h.turn(60_000)
  expect(h.desktop).toEqual(['Amp done · 1m0s'])
  expect(h.telegram).toEqual([])

  await writeFile(join(configDir, 'telegram.json'), JSON.stringify({ bot_token: 'tok', chat_id: 1, long_task_threshold_sec: 30 }))
  await h.turn(60_000)
  expect(h.telegram.length).toBe(1)
  expect(h.telegram[0]).toContain('https://api.telegram.org/bottok/sendMessage')
  expect(h.telegram[0]).toContain('All green')
})

test('errors notify even when quick', async () => {
  const h = harness()
  await h.turn(1_000, 'error')
  expect(h.desktop).toEqual(['Amp stopped with an error · 1s'])
})

test('cancelled turns and background threads stay quiet', async () => {
  const h = harness('T1')
  await h.turn(120_000, 'cancelled')
  await h.turn(120_000, 'done', 'T-sub')
  expect(h.desktop).toEqual([])
})
