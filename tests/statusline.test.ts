import { expect, test } from 'bun:test'

import { claudeText, contextText } from '../amp/plugins/statusline'

test('context is measured against the compaction point, not the whole window', () => {
  // 872k window compacts at 784.8k; 73193 of that is 9.3%.
  expect(contextText({ totalTokens: 73193, maxContextTokens: 872000 })).toBe('ctx 9%')
  // Past the compaction point it stays at 100%.
  expect(contextText({ totalTokens: 800000, maxContextTokens: 872000 })).toBe('ctx 100%')
  expect(contextText({ totalTokens: 450000, maxContextTokens: 1000000 })).toBe('ctx 50%')
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
