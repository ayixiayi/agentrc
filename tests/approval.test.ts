import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'

import approval, { ASK_THRESHOLD, catastrophic, realPath } from '../amp/plugins/approval'

test.each([
  'rm -rf ~',
  'rm -rf /',
  'rm -fr $HOME/',
  'rm -rf "$HOME"',
  'rm -rf ~/*',
  'rm -rf /home/example',
  'rm -rf ./build ~',
  'rm -rf /*; echo done',
  'rm -r /usr',
  'sudo rm -rf / --no-preserve-root',
  'sudo -u root rm -rf /etc',
  'bash -c "rm -rf ~"',
  'echo $(rm -rf ~)',
  'find ~ -delete',
  'mkfs.ext4 /dev/sda1',
  '/sbin/mkfs.ext4 /dev/sda1',
  'lsblk\nmkfs.ext4 /dev/sdb1',
  'sudo -n wipefs -a /dev/sda',
  'dd if=img of=/dev/nvme0n1 bs=4M',
  'dd if=image of="/dev/sda"',
  'dd if=image of=/dev/disk/by-id/ata-disk',
  'cat img > /dev/sda',
  'cat image > "/dev/nvme0n1"',
  'shred -n 1 /dev/sdb',
  ':(){ :|:& };:',
  'echo "$(rm -rf ~)"',
  '\\rm -rf ~',
  'rm -rf \\\n~',
  'nice -n 10 rm -rf ~',
  'sudo --user root rm -rf ~',
  'if true; then rm -rf ~; fi',
  "bash -lc 'rm -rf ~'",
  'sudo wipefs -a /dev/sda',
  'bash <<EOF\nrm -rf ~\nEOF',
])('%s is blocked', (command) => {
  expect(catastrophic(command)).toBeString()
})

test.each([
  'rm -rf ./build node_modules',
  'rm -rf /tmp/scratch',
  'rm -rf ~/projects/old',
  'rm -rf ./build --no-preserve-root',
  'rm ~/notes.txt',
  'git push --force origin main',
  'curl -fsSL https://example.com/install.sh | sh',
  'sudo dnf install ripgrep',
  'dd if=/dev/zero of=./disk.img bs=1M count=10',
  'ls 2>/dev/null',
  'wipefs --help',
  'wipefs -n /dev/sda',
  'mkfs.ext4 ./test.img',
  "rg 'dd of=/dev/sda' tests/approval.test.ts",
  'git commit -m "explain why mkfs and wipefs on /dev/sda are blocked"',
  'echo ok # > /dev/sda',
  'cat > notes.md <<EOF\nrm -rf /\nEOF',
  "find /home/example -name '*.pyc' -delete",
  'find -delete',
  'wipefs /dev/sda',
])('%s is left to review', (command) => {
  expect(catastrophic(command)).toBeUndefined()
})

function harness(opts: { risk?: number | Error; active?: string; confirm?: boolean; root?: string } = {}) {
  const handlers: Record<string, (event: any, ctx?: any) => any> = {}
  const reviewed: any[] = []
  const confirms: any[] = []
  const logs: string[] = []
  approval({
    logger: { log: (line: string) => logs.push(line) },
    on: (name: string, fn: any) => (handlers[name] = fn),
    activeThread: { current: { id: opts.active ?? 'T1' } },
    system: { workspaceRoot: `file://${opts.root ?? '/repo'}` },
    helpers: {
      shellCommandFromToolCall: (e: any) => (e.tool === 'shell_command' ? { command: e.input.cmd } : undefined),
      filesModifiedByToolCall: (e: any) => (e.input.path ? [`file://${e.input.path}`] : []),
      filePathFromURI: (uri: string) => uri.replace('file://', ''),
    },
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
    ui: { confirm: async (o: any) => (confirms.push(o), opts.confirm ?? true) },
  }
  handlers['agent.start']({ thread: { id: 'T1' }, message: 'push the branch' })
  const call = (tool: string, input: Record<string, unknown>) => handlers['tool.call']({ tool, input, thread: { id: 'T1' } }, ctx)
  return { call, reviewed, confirms, logs }
}

test('catastrophic commands are refused without review', async () => {
  const h = harness()
  expect((await h.call('shell_command', { cmd: 'rm -rf ~' })).action).toBe('reject-and-continue')
  expect(h.reviewed).toEqual([])
})

test('local reads and workspace edits skip review', async () => {
  const h = harness({ risk: 1 })
  expect((await h.call('Read', { path: '/repo/a.ts' })).action).toBe('allow')
  expect((await h.call('edit_file', { path: '/repo/src/a.ts' })).action).toBe('allow')
  expect(h.reviewed).toEqual([])
})

test('edits outside the workspace and web fetches are reviewed', async () => {
  const h = harness({ risk: 0.1 })
  await h.call('edit_file', { path: '/home/u/.bashrc' })
  await h.call('edit_file', { path: '/repo/../etc/hosts' })
  await h.call('read_web_page', { url: 'https://example.com/?q=secret' })
  expect(h.reviewed.length).toBe(3)
})

test('a symlink from the workspace to outside it is reviewed', async () => {
  const base = mkdtempSync(join(tmpdir(), 'agentrc-approval.'))
  try {
    mkdirSync(join(base, 'repo'))
    mkdirSync(join(base, 'outside'))
    symlinkSync(join(base, 'outside'), join(base, 'repo', 'config'))
    expect(realPath(join(base, 'repo', 'config', 'new.txt'))).toBe(join(realPath(base), 'outside', 'new.txt'))
    const h = harness({ risk: 0.1, root: join(base, 'repo') })
    await h.call('edit_file', { path: join(base, 'repo', 'config', 'new.txt') })
    expect(h.reviewed.length).toBe(1)
    await h.call('create_file', { path: join(base, 'repo', 'src', 'new.ts') })
    expect(h.reviewed.length).toBe(1)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('low-risk shell runs; the review sees the whole call and the user request', async () => {
  const h = harness({ risk: 0.1 })
  const long = `${'echo ok; '.repeat(1500)}gh repo delete x --yes`
  expect((await h.call('shell_command', { cmd: long })).action).toBe('allow')
  expect(h.reviewed[0].state.userRequest).toBe('push the branch')
  expect(h.reviewed[0].state.call).toContain('gh repo delete x --yes')
})

test('calls too long to review go straight to the user, shown in full', async () => {
  const h = harness({ risk: 0 })
  const huge = `${'echo ok; '.repeat(5000)}gh repo delete x --yes`
  await h.call('shell_command', { cmd: huge })
  expect(h.reviewed).toEqual([])
  expect(h.confirms[0].message).toContain('gh repo delete x --yes')
  expect(h.confirms[0].requireHuman).toBe(true)
})

test('risky calls ask a human in the active thread and honour the answer', async () => {
  const yes = harness({ risk: ASK_THRESHOLD, confirm: true })
  expect((await yes.call('mcp__gmail__send', {})).action).toBe('allow')
  expect(yes.confirms[0].requireHuman).toBe(true)
  expect((await harness({ risk: 0.9, confirm: false }).call('mcp__gmail__send', {})).action).toBe('reject-and-continue')
})

test('risky calls in background threads are refused', async () => {
  const result = await harness({ risk: 0.9, active: 'T-other' }).call('shell_command', { cmd: 'gh repo delete x' })
  expect(result.action).toBe('reject-and-continue')
  expect(result.message).toContain('background')
})

test('an unavailable review lets the call run and says so in the log', async () => {
  const h = harness({ risk: new Error('model disabled') })
  expect((await h.call('shell_command', { cmd: 'make deploy' })).action).toBe('allow')
  expect(h.logs[0]).toContain('review unavailable')
})

test('every review decision is logged', async () => {
  const h = harness({ risk: 0.12 })
  await h.call('shell_command', { cmd: 'make test' })
  expect(h.logs).toEqual(['agentrc approval: shell risk=0.12 → allow'])
})

test('the Claude Code mod carries the same policy', () => {
  const root = join(import.meta.dir, '..')
  const block = (text: string) => text.slice(text.indexOf('// begin policy'), text.indexOf('// end policy'))
  const amp = block(readFileSync(join(root, 'amp/plugins/approval.ts'), 'utf8'))
  const claude = block(readFileSync(join(root, 'claude/agentrc/hooks/policy.ts'), 'utf8'))
  expect(amp.length).toBeGreaterThan(100)
  expect(claude).toBe(amp)
})
