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

const configure = () => writeFile(join(configDir, 'telegram.json'), JSON.stringify({ bot_token: 'tok', chat_id: 1 }))

function harness(status = 200) {
  const handlers: Record<string, (event: any) => Promise<void> | void> = {}
  const tools: Record<string, any> = {}
  const sent: { url: string; text: string }[] = []
  const amp: any = {
    logger: { log() {} },
    on: (name: string, fn: any) => (handlers[name] = fn),
    registerTool: (def: any) => (tools[def.name] = def),
  }
  const fetch = (async (url: string, init: any) => {
    sent.push({ url, text: JSON.parse(init.body).text })
    return new Response('{}', { status })
  }) as unknown as typeof globalThis.fetch
  telegram(amp, { fetch })
  const end = (status: string, messages: any[] = []) =>
    handlers['agent.end']?.({ thread: { id: 'T-1' }, message: 'deploy the docs', status, messages })
  const notify = (message: string) => tools.notify_user.execute({ message }, { thread: { id: 'T-1' } })
  return { tools, handlers, sent, end, notify }
}

test('off without telegram.json: no tool, no handlers', () => {
  const h = harness()
  expect(h.tools).toEqual({})
  expect(h.handlers).toEqual({})
})

test('the agent can message the user, with a link to the thread', async () => {
  await configure()
  const h = harness()
  expect(await h.notify('**Training** finished; val loss 0.12.')).toBe('Sent.')
  expect(h.sent[0].url).toBe('https://api.telegram.org/bottok/sendMessage')
  expect(h.sent[0].text).toBe('Training finished; val loss 0.12.\n\nhttps://ampcode.com/threads/T-1')
})

test('a failed send is reported back to the agent', async () => {
  await configure()
  expect(await harness(401).notify('done')).toBe('Not sent: HTTP 401.')
})

test('errors are sent with the error text and the task; other endings stay quiet', async () => {
  await configure()
  const h = harness()
  await h.end('done')
  await h.end('cancelled')
  expect(h.sent).toEqual([])
  await h.end('error', [{ role: 'info', content: [{ type: 'text', text: 'Rate limit exceeded' }] }])
  expect(h.sent[0].text).toBe('Amp stopped with an error: Rate limit exceeded\n\nTask: deploy the docs\n\nhttps://ampcode.com/threads/T-1')
})
