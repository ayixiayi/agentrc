import { expect, test } from 'bun:test'

import { claudeText, contextText } from '../amp/plugins/statusline'

test('context is measured against the compaction point, not the whole window', () => {
  // 872k window compacts at 784.8k; 73193 of that is 9.3%.
  expect(contextText({ totalTokens: 73193, maxContextTokens: 872000 })).toBe('ctx 9%')
  expect(contextText({ totalTokens: 450000, maxContextTokens: 1000000 })).toBe('ctx 50%')
})

test('context shows ! prefix at 70% of the compaction budget', () => {
  // 70% of (1M * 0.9) = 630k → exactly at the warn threshold → "! "
  expect(contextText({ totalTokens: 630000, maxContextTokens: 1000000 })).toBe('! ctx 70%')
  // Just under 70% → no prefix (629999/900000 rounds to 70%, so use a clearly-below value)
  expect(contextText({ totalTokens: 620000, maxContextTokens: 1000000 })).toBe('ctx 69%')
  // Between 70% and 90% → "! "
  expect(contextText({ totalTokens: 750000, maxContextTokens: 1000000 })).toBe('! ctx 83%')
})

test('context shows !! prefix at 90% of the compaction budget (near-compaction)', () => {
  // 90% of (1M * 0.9) = 810k → exactly at crit threshold → "!! "
  expect(contextText({ totalTokens: 810000, maxContextTokens: 1000000 })).toBe('!! ctx 90%')
  // Past the compaction point it stays at 100% with "!! "
  expect(contextText({ totalTokens: 800000, maxContextTokens: 872000 })).toBe('!! ctx 100%')
})

test('claude shows the subscription left, not used, from claude -p /usage', () => {
  const out = [
    'You are currently using your subscription to power your Claude Code usage',
    '',
    'Current session: 80% used · resets Oct 31, 2:40am (Asia/Shanghai)',
    'Current week (all models): 84% used · resets Nov 3, 6pm (Asia/Shanghai)',
    '',
    'Last 24h · 474 requests · 8 sessions',
    '  95%  Start fresh when you switch tasks · run /clear',
  ].join('\n')
  expect(claudeText(out)).toBe('5h 20% ↻2:40 · wk 16%')
  expect(claudeText('Current session: 5% used · resets Oct 31, 12:15pm (Asia/Shanghai)')).toBe('5h 95% ↻12:15')
  expect(claudeText('Current session: 5% used · resets Oct 31, 6pm (Asia/Shanghai)')).toBe('5h 95% ↻18:00')
  expect(claudeText('Current session: 5% used · resets Oct 31, 12am (Asia/Shanghai)')).toBe('5h 95% ↻0:00')
  expect(claudeText('Current week (all models): 3% used')).toBe('wk 97%')
  expect(claudeText('Not logged in')).toBe('')
})
