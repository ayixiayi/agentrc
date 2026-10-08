import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import telegram from '../amp/plugins/telegram'

let configDir = ''
const previous = process.env.AMP_CONFIG_DIR

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'agentrc-telegram.'))
  process.env.AMP_CONFIG_DIR = configDir
})
afterEach(async () => {
  if (previous === undefined) delete process.env.AMP_CONFIG_DIR
  else process.env.AMP_CONFIG_DIR = previous
  await rm(configDir, { recursive: true, force: true })
})

const configure = () =>
  writeFile(join(configDir, 'telegram.json'), JSON.stringify({ bot_token: 'tok', chat_id: 1, long_task_threshold_sec: 30 }))

function harness(activeThreadID = 'T1') {
  const handlers: Record<string, (event: any) => Promise<void> | void> = {}
  const sent: string[] = []
  let clock = 0
  const amp: any = {
    activeThread: { current: { id: activeThreadID } },
    logger: { log() {} },
    on: (name: string, fn: any) => (handlers[name] = fn),
  }
  const fetch = (async (url: string, init: any) => {
    sent.push(`${url} ${init.body}`)
    return new Response('{}')
  }) as unknown as typeof globalThis.fetch
  telegram(amp, { now: () => clock, fetch })
  const turn = async (ms: number, status = 'done', thread = 'T1') => {
    handlers['agent.start']({ thread: { id: thread } })
    clock += ms
    await handlers['agent.end']({
      thread: { id: thread },
      status,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: '**All green**' }] }],
    })
  }
  return { turn, sent }
}

test('off without telegram.json', async () => {
  const h = harness()
  await h.turn(600_000)
  await h.turn(1_000, 'error')
  expect(h.sent).toEqual([])
})

test('sends long turns past the threshold once configured', async () => {
  await configure()
  const h = harness()
  await h.turn(10_000)
  expect(h.sent).toEqual([])
  await h.turn(60_000)
  expect(h.sent.length).toBe(1)
  expect(h.sent[0]).toContain('https://api.telegram.org/bottok/sendMessage')
  expect(h.sent[0]).toContain('Amp done · 1m0s')
  expect(h.sent[0]).toContain('All green')
})

test('errors are sent even when quick', async () => {
  await configure()
  const h = harness()
  await h.turn(1_000, 'error')
  expect(h.sent[0]).toContain('Amp stopped with an error · 1s')
})

test('cancelled turns and background threads stay quiet', async () => {
  await configure()
  const h = harness('T1')
  await h.turn(120_000, 'cancelled')
  await h.turn(120_000, 'done', 'T-sub')
  expect(h.sent).toEqual([])
})
