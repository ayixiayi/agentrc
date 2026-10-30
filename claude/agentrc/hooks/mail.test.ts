import { expect, mock, test } from 'claude-code/testing'

const SESSION = '0b8f7a52-3c1d-4e9a-9f00-1234567890ab'
const THREAD = 'T-01a18ced-1358-767c-8af4-d0e674777796'
const ROOT = '/home/u/.local/state/agentrc/mail'

// Each hook here stands for the engine beneath the mod; a call on `$` is answered `{ value }`.
function engine(on: any, opts: { inbox?: Record<string, string>; run?: (argv: string[]) => { exitCode: number; stdout: string }; drop?: string } = {}) {
  const inbox = { ...opts.inbox }
  const prompts: string[] = []
  const runs: string[][] = []
  const writes: Record<string, string> = {}
  const registered: string[] = []
  const status: (string | undefined)[] = []
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 30, 12) })
  mock.env(on, { HOME: '/home/u' })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', (_: any, e: any) => ({
    value: e.path === `${ROOT}/claude/${SESSION}` ? Object.keys(inbox).map((name) => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) : [],
  }))
  on('fs.read', (_: any, e: any) => ({ value: inbox[e.path.split('/').pop()] ?? '' }))
  on('fs.write', (_: any, e: any) => ((writes[e.path] = e.text), { value: undefined }))
  on('process.run', (_: any, e: any) => {
    runs.push([...e.argv])
    if (e.argv[0] === 'rm') delete inbox[e.argv.at(-1).split('/').pop()]
    const answer = opts.run?.(e.argv) ?? { exitCode: 0, stdout: '' }
    return { value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer } }
  })
  on('session.id', () => ({ value: SESSION }))
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('tool.register', (_: any, e: any) => (registered.push(e.name), { value: { tool: `mcp__agentrc__${e.name}` } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: any, e: any) => (opts.drop && e.origin?.kind !== 'composer' ? { drop: opts.drop } : (prompts.push(e.text), { text: e.text })))
  on('ui.status', (_: any, e: any) => (status.push(e.text), { value: undefined }))
  return { prompts, runs, writes, registered, inbox, clock, status }
}

test('notices from Amp are submitted as prompts in order, then removed', async ($, on) => {
  const h = engine(on, { inbox: { '20261030T120001-b': 'second', '20261030T120000-a': 'You have mail from Amp thread T-1.', '.tmp': 'skip' } })
  await $.session.start({ cwd: '/home/u/repo', surface: null, isInteractive: true })
  expect(h.registered).toContain('message_amp')
  expect(h.prompts).toEqual([])
  await h.clock.advance(2_000)
  expect(h.prompts).toEqual(['You have mail from Amp thread T-1.', 'second'])
  expect(Object.keys(h.inbox)).toEqual(['.tmp'])
})

test('a message to a thread an Amp has open is written down and handed over', async ($, on) => {
  const h = engine(on, { run: (argv) => (argv[0] === 'sh' && argv[2].startsWith('log=') ? { exitCode: 0, stdout: 'delivered\n' } : { exitCode: 0, stdout: '' }) })
  const ran = await $.tool.call({ tool: 'mcp__agentrc__message_amp', to: `https://ampcode.com/threads/${THREAD}`, message: 'Review src/x.ts.' } as any)
  expect(ran.result).toStartWith(`Sent to ${THREAD}, delivered to the Amp that has it open. Letter: ${ROOT}/`)
  const [letter, text] = Object.entries(h.writes)[0]!
  expect(text).toContain(`From: Claude Code session ${SESSION} (/home/u/repo)`)
  expect(text).toContain(`Reply: message_claude tool, to "${SESSION}"`)
  expect(text).toEndWith('\n\nReview src/x.ts.\n')
  expect(h.runs[0]).toEqual(['sh', '-c', 'mkdir -p "$0/.logs" && chmod 700 "$0" "$0/.logs"', ROOT])
  const wake = h.runs.find((argv) => argv[0] === 'sh' && argv[2] !== undefined && argv[2].startsWith('log='))!
  expect(wake.slice(5)).toEqual([THREAD, `You have mail from Claude Code session ${SESSION} (in /home/u/repo). Read ${letter}. Reply with the message_claude tool to "${SESSION}" only if you have a result, a question or work for it; never just to acknowledge.`, ''])
})

test('leaving out `to` starts a thread in the given mode', async ($, on) => {
  const h = engine(on, {
    run: (argv) =>
      argv[1] === 'threads' ? { exitCode: 0, stdout: `https://ampcode.com/threads/${THREAD}\n` } : argv[0] === 'sh' && argv[2].startsWith('log=') ? { exitCode: 0, stdout: 'started\n' } : { exitCode: 0, stdout: '' },
  })
  const ran = await $.tool.call({ tool: 'mcp__agentrc__message_amp', message: 'Port the parser.', mode: 'high' } as any)
  expect(ran.result).toStartWith(`Sent to new thread ${THREAD}, on its way (run headless, or handed to an Amp that has it open).`)
  expect(h.runs[0]).toEqual(['amp', 'threads', 'new', '-m', 'high'])
  expect(h.runs.find((argv) => argv[0] === 'sh' && argv[2].startsWith('log='))!.at(-1)).toBe('high')
})

test('bad input and a failed wake come back as errors', async ($, on) => {
  engine(on, { run: (argv) => (argv[0] === 'sh' && argv[2].startsWith('log=') ? { exitCode: 1, stdout: 'Error: Thread not found\n' } : { exitCode: 0, stdout: '' }) })
  const call = async (input: object) => {
    const ran: any = await $.tool.call({ tool: 'mcp__agentrc__message_amp', ...input } as any)
    return String(ran.text ?? ran.deny)
  }
  expect((await call({ to: 'T-123', message: 'x' }))).toContain('to must be an Amp thread ID')
  expect((await call({ to: THREAD, message: ' ' }))).toContain('message is required.')
  expect((await call({ message: 'x', mode: 'rm -rf' }))).toContain('mode must be an Amp mode name')
  expect((await call({ to: THREAD, message: 'x' }))).toContain(`Could not reach ${THREAD}: Error: Thread not found`)
})

test('no tool and no polling without amp on PATH', async ($, on) => {
  const h = engine(on, { run: (argv) => (argv[2] === 'command -v amp' ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: '' }) })
  await $.session.start({ cwd: '/home/u/repo', surface: null, isInteractive: true })
  await h.clock.advance(4_000)
  expect(h.registered).not.toContain('message_amp')
  expect(h.runs).toEqual([['sh', '-c', 'command -v amp']])
})

test('a second session.start (as after /clear) keeps one poll, so nothing is delivered twice', async ($, on) => {
  const h = engine(on, { inbox: { n1: 'only once' } })
  await $.session.start({ cwd: '/home/u/repo', surface: null, isInteractive: true })
  await $.session.start({ cwd: '/home/u/repo', surface: null, isInteractive: true })
  await h.clock.advance(4_000)
  expect(h.prompts).toEqual(['only once'])
})

test('a notice the engine drops stays in the inbox and pauses delivery with the reason', async ($, on) => {
  const h = engine(on, { inbox: { n1: 'kept' }, drop: 'blocked by a hook' })
  await $.session.start({ cwd: '/home/u/repo', surface: null, isInteractive: true })
  await h.clock.advance(4_000)
  expect(h.prompts).toEqual([])
  expect(Object.keys(h.inbox)).toEqual(['n1'])
  expect(h.status.at(-1)).toContain('was not let in (blocked by a hook)')
  await $.prompt.submit({ text: 'retry', origin: { kind: 'composer' } } as any)
  expect(h.status.at(-1)).toBeUndefined()
})
