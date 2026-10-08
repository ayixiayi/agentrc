import { expect, test } from 'claude-code/testing'

const allow = () => ({ decision: 'allow' as const })

test('denies reading a private key', async ($, on) => {
  on('tool.check', allow)
  const verdict = await $.tool.check({ tool: 'Read', input: { file_path: '~/.ssh/id_ed25519' } })
  expect(verdict.decision).toBe('deny')
})

test('denies cat of the Amp settings file in Bash', async ($, on) => {
  on('tool.check', allow)
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'cat ~/.config/amp/settings.json | head' } })
  expect(verdict.decision).toBe('deny')
})

test('turns an engine allow into ask for git push', async ($, on) => {
  on('tool.check', allow)
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push origin slim' } })
  expect(verdict.decision).toBe('ask')
})

test('leaves ordinary commands to the engine', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask' as const, reason: 'engine' }))
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'bun test' } })
  expect(verdict).toEqual({ decision: 'ask', reason: 'engine' })
})

const turn = { answer: 'All tests pass.', turnId: 't1', isAborted: false, reason: 'answer' as const }

test('notifies the desktop after a long turn', async ($, on) => {
  const argv: string[][] = []
  on('turn.complete', () => ({ text: '' }))
  on('process.run', (_$, e) => {
    argv.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.turn.complete({ ...turn, durationMs: 120_000 })
  expect(argv[0]?.[0]).toBe('notify-send')
  expect(argv[0]).toContain('Claude done · 2m0s')
})

test('stays quiet for short turns and subagents', async ($, on) => {
  let calls = 0
  on('turn.complete', () => ({ text: '' }))
  on('process.run', () => {
    calls++
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.turn.complete({ ...turn, durationMs: 5_000 })
  await $.turn.complete({ ...turn, durationMs: 120_000, agentId: 'a1' })
  expect(calls).toBe(0)
})
