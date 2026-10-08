import { expect, test } from 'claude-code/testing'

test('denies wiping home', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' as const }))
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf ~' } })
  expect(verdict.decision).toBe('deny')
})

test('leaves everything else to the engine', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask' as const, reason: 'engine' }))
  expect(await $.tool.check({ tool: 'Bash', input: { command: 'git push --force origin main' } })).toEqual({ decision: 'ask', reason: 'engine' })
  expect(await $.tool.check({ tool: 'Read', input: { file_path: 'project/.env' } })).toEqual({ decision: 'ask', reason: 'engine' })
})
