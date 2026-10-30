import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import mail, { KEEP_MS, mailRoot, pruneMail } from '../amp/plugins/mail'

const SESSION = '0b8f7a52-3c1d-4e9a-9f00-1234567890ab'
let base = ''
const saved = { state: process.env.XDG_STATE_HOME, claude: process.env.CLAUDE_CONFIG_DIR }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agentrc-mail.'))
  process.env.XDG_STATE_HOME = join(base, 'state')
  process.env.CLAUDE_CONFIG_DIR = join(base, 'claude')
  mkdirSync(join(base, 'claude', 'projects', '-home-u-repo'), { recursive: true })
  writeFileSync(join(base, 'claude', 'projects', '-home-u-repo', `${SESSION}.jsonl`), '')
})
afterEach(() => {
  for (const [key, value] of [['XDG_STATE_HOME', saved.state], ['CLAUDE_CONFIG_DIR', saved.claude]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(base, { recursive: true, force: true })
})

function tool() {
  let def: any
  mail({
    registerTool: (d: any) => (def = d),
    system: { workspaceRoot: 'file:///home/u/repo' },
    helpers: { filePathFromURI: (uri: string) => uri.replace('file://', '') },
  } as any)
  return (input: Record<string, unknown>) => def.execute(input, { thread: { id: 'T-1' } })
}

test('a message becomes a letter plus a one-line notice in the session inbox', async () => {
  const result = await tool()({ to: SESSION, message: 'Tests pass; the diff is in /home/u/repo/out.patch.' })
  expect(result).toStartWith('Sent (')
  const inbox = join(mailRoot(), 'claude', SESSION)
  const [notice] = readdirSync(inbox)
  const text = readFileSync(join(inbox, notice!), 'utf8')
  const letter = text.match(/Read (\S+\.md)/)![1]!
  expect(text).toStartWith('You have mail from Amp thread T-1 (in /home/u/repo).')
  expect(text).toContain('Reply with the message_amp tool to "T-1" only if you have a result, a question or work for it; never just to acknowledge.')
  const body = readFileSync(letter, 'utf8')
  expect(body).toContain('From: Amp thread T-1 (/home/u/repo)')
  expect(body).toContain(`To: Claude Code session ${SESSION}`)
  expect(body).toEndWith('Tests pass; the diff is in /home/u/repo/out.patch.\n')
  expect(statSync(letter).mode & 0o777).toBe(0o600)
  expect(statSync(mailRoot()).mode & 0o777).toBe(0o700)
  expect(readdirSync(join(mailRoot(), '.tmp'))).toEqual([])
})

test('bad addresses are refused without writing anything', async () => {
  const send = tool()
  expect(await send({ to: '../../etc', message: 'x' })).toStartWith('Error: to must be')
  expect(await send({ to: SESSION.replace('0b8f', '0000'), message: 'x' })).toStartWith('Error: no Claude Code session')
  expect(await send({ to: SESSION, message: '  ' })).toBe('Error: message is required.')
  expect(() => readdirSync(join(mailRoot(), 'claude'))).toThrow()
})

test('no tool without Claude Code on this machine', () => {
  rmSync(join(base, 'claude'), { recursive: true })
  let registered = false
  mail({ registerTool: () => (registered = true) } as any)
  expect(registered).toBe(false)
})

test('mail older than the retention window is pruned, recent mail and live inboxes stay', () => {
  const root = mailRoot()
  const aged = (path: string, text = 'x') => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    const then = (Date.now() - KEEP_MS - 86_400_000) / 1000
    utimesSync(path, then, then)
  }
  aged(join(root, 'old.md'))
  aged(join(root, '.logs', 'old.log'))
  aged(join(root, 'claude', 'gone', 'n1'))
  const then = (Date.now() - KEEP_MS - 86_400_000) / 1000
  utimesSync(join(root, 'claude', 'gone'), then, then)
  writeFileSync(join(root, 'new.md'), 'x')
  mkdirSync(join(root, 'claude', 'live'))
  pruneMail()
  expect(readdirSync(root).sort()).toEqual(['.logs', 'claude', 'new.md'])
  expect(readdirSync(join(root, '.logs'))).toEqual([])
  expect(readdirSync(join(root, 'claude'))).toEqual(['live'])
})
