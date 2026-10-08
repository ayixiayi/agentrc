import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import approval, { ASK_THRESHOLD, catastrophic } from '../amp/plugins/approval'

test.each([
  'rm -rf ~',
  'rm -rf /',
  'rm -fr $HOME/',
  'sudo rm -rf / --no-preserve-root',
  'mkfs.ext4 /dev/sda1',
  'sudo wipefs -a /dev/sdb',
  'lsblk && mkfs -t ext4 /dev/sdb1',
  'dd if=img of=/dev/nvme0n1 bs=4M',
  'cat img > /dev/sda',
  ':(){ :|:& };:',
])('%s is blocked by regex', (command) => {
  expect(catastrophic(command)).toBeString()
})

test.each([
  'rm -rf ./build node_modules',
  'rm -rf /tmp/scratch',
  'rm -rf ~/projects/old',
  'git push --force origin main',
  'curl -fsSL https://example.com/install.sh | sh',
  'sudo dnf install ripgrep',
  'dd if=/dev/zero of=./disk.img bs=1M count=10',
  'git commit -m "explain why mkfs and wipefs are blocked"',
])('%s is left to review', (command) => {
  expect(catastrophic(command)).toBeUndefined()
})

function harness(opts: { risk?: number | Error; active?: string; confirm?: boolean } = {}) {
  const handlers: Record<string, (event: any, ctx?: any) => any> = {}
  const reviewed: any[] = []
  approval({
    on: (name: string, fn: any) => (handlers[name] = fn),
    activeThread: { current: { id: opts.active ?? 'T1' } },
    helpers: { shellCommandFromToolCall: (e: any) => (e.tool === 'shell_command' ? { command: e.input.cmd } : undefined) },
  } as any)
  const ctx = {
    logger: { log() {} },
    ai: {
      noul: async (req: any) => {
        reviewed.push(req)
        if (opts.risk instanceof Error) throw opts.risk
        return { type: 'noul', noul: opts.risk ?? 0 }
      },
    },
    ui: { confirm: async () => opts.confirm ?? true },
  }
  handlers['agent.start']({ thread: { id: 'T1' }, message: 'push the branch' })
  const call = (tool: string, input: Record<string, unknown>) => handlers['tool.call']({ tool, input, thread: { id: 'T1' } }, ctx)
  return { call, reviewed }
}

test('catastrophic commands are refused without review', async () => {
  const h = harness()
  expect((await h.call('shell_command', { cmd: 'rm -rf ~' })).action).toBe('reject-and-continue')
  expect(h.reviewed).toEqual([])
})

test('read-only tools and file edits skip review', async () => {
  const h = harness({ risk: 1 })
  expect((await h.call('Read', { path: '/repo/a.ts' })).action).toBe('allow')
  expect((await h.call('edit_file', { path: '/repo/a.ts' })).action).toBe('allow')
  expect(h.reviewed).toEqual([])
})

test('low-risk shell runs; the review sees the user request', async () => {
  const h = harness({ risk: 0.1 })
  expect((await h.call('shell_command', { cmd: 'git push --force origin main' })).action).toBe('allow')
  expect(h.reviewed[0].state.userRequest).toBe('push the branch')
  expect(h.reviewed[0].state.call).toContain('git push --force origin main')
})

test('risky calls ask in the active thread and honour the answer', async () => {
  expect((await harness({ risk: ASK_THRESHOLD, confirm: true }).call('mcp__gmail__send', {})).action).toBe('allow')
  expect((await harness({ risk: 0.9, confirm: false }).call('mcp__gmail__send', {})).action).toBe('reject-and-continue')
})

test('risky calls in background threads are refused', async () => {
  const result = await harness({ risk: 0.9, active: 'T-other' }).call('shell_command', { cmd: 'gh repo delete x' })
  expect(result.action).toBe('reject-and-continue')
  expect(result.message).toContain('background')
})

test('an unavailable review lets the call run', async () => {
  expect((await harness({ risk: new Error('model disabled') }).call('shell_command', { cmd: 'make deploy' })).action).toBe('allow')
})

test('the Claude Code mod carries the same regex policy', () => {
  const root = join(import.meta.dir, '..')
  const block = (text: string) => text.slice(text.indexOf('// begin policy'), text.indexOf('// end policy'))
  const amp = block(readFileSync(join(root, 'amp/plugins/approval.ts'), 'utf8'))
  const claude = block(readFileSync(join(root, 'claude/agentrc/hooks/policy.ts'), 'utf8'))
  expect(amp.length).toBeGreaterThan(100)
  expect(claude).toBe(amp)
})
