import { expect, test } from 'claude-code/testing'

const CONFIG = '/home/u/.config/agentrc/telegram.json'

// Each hook here stands for the engine beneath the mod; a call on `$` is answered `{ value }`.
function engine(on: any, opts: { configured?: boolean; status?: number } = {}) {
  const sent: { url: string; text: string }[] = []
  const registered: string[] = []
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.exists', (_: any, e: any) => ({ value: opts.configured !== false && e.path === CONFIG }))
  on('fs.read', (_: any, e: any) => {
    if (opts.configured === false || e.path !== CONFIG) throw new Error('ENOENT')
    return { value: JSON.stringify({ bot_token: 'tok', chat_id: 1 }) }
  })
  on('http.fetch', (_: any, e: any) => {
    sent.push({ url: e.url, text: JSON.parse(e.init.body).text })
    const status = opts.status ?? 200
    return { value: { status, ok: status < 300, headers: {}, text: '{}' } }
  })
  on('session.cwd', () => ({ value: '/home/u/projects/demo' }))
  on('session.id', () => ({ value: '0b8f7a52-3c1d-4e9a-9f00-1234567890ab' }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.register', (_: any, e: any) => (registered.push(e.name), { value: { tool: `mcp__agentrc__${e.name}` } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  return { sent, registered }
}

test('off without telegram.json: no notify_user tool', async ($, on) => {
  const h = engine(on, { configured: false })
  await $.session.start({ cwd: '/home/u/projects/demo', surface: null, isInteractive: true })
  expect(h.registered).not.toContain('notify_user')
})

test('the model can message the user, unreviewed', async ($, on) => {
  const h = engine(on)
  await $.session.start({ cwd: '/home/u/projects/demo', surface: null, isInteractive: true })
  expect(h.registered).toContain('notify_user')
  expect((await $.tool.check({ tool: 'mcp__agentrc__notify_user', input: { message: 'x' } })).decision).toBe('allow')
  const ran = await $.tool.call({ tool: 'mcp__agentrc__notify_user', message: '**Training** finished.' } as any)
  expect(ran.result).toBe('Sent.')
  expect(h.sent).toEqual([{ url: 'https://api.telegram.org/bottok/sendMessage', text: 'Training finished.\n\nClaude Code · demo' }])
})

test('a failed send is reported back to the model', async ($, on) => {
  engine(on, { status: 401 })
  const ran = await $.tool.call({ tool: 'mcp__agentrc__notify_user', message: 'done' } as any)
  expect(ran.text ?? ran.deny).toContain('Not sent: HTTP 401.')
})

test('API errors on the main loop are sent with the task; other endings stay quiet', async ($, on) => {
  const h = engine(on)
  await $.prompt.submit({ text: 'deploy the docs' } as any)
  const turn = { answer: '', durationMs: 1, isAborted: false, turnId: 't1' }
  await $.turn.complete({ ...turn, reason: 'answer' } as any)
  await $.turn.complete({ ...turn, reason: 'error', agentId: 'a1' } as any)
  expect(h.sent).toEqual([])
  await $.turn.complete({ ...turn, reason: 'error' } as any)
  expect(h.sent[0].text).toBe('Claude Code · demo stopped with an API error.\n\nTask: deploy the docs')
})
