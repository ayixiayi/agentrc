import { expect, test } from 'bun:test'

import goal from '../amp/plugins/goal'

type UI = { confirm?: (opts: any) => Promise<boolean>; input?: () => Promise<string | undefined>; select?: () => Promise<string | undefined> }

function harness(ui: UI = {}, state: () => Promise<string> = async () => 'idle') {
  const handlers: Record<string, (event: any) => any> = {}
  let command: (ctx: any) => Promise<void> = async () => {}
  let tool: any
  const appended: string[] = []
  const notices: string[] = []
  const amp: any = {
    on: (name: string, fn: any) => (handlers[name] = fn),
    registerCommand: (_id: string, _opts: unknown, fn: any) => (command = fn),
    registerTool: (def: any) => (tool = def),
    threads: {
      get: () => ({ state: { get: state }, appendUserMessage: async (m: { content: string }) => void appended.push(m.content) }),
    },
  }
  goal(amp)
  const ctx = (thread: string) => ({
    thread: { id: thread },
    ui: {
      confirm: ui.confirm ?? (async () => true),
      input: ui.input ?? (async () => undefined),
      select: ui.select ?? (async () => undefined),
      notify: async (text: string) => void notices.push(text),
    },
  })
  return {
    end: (status = 'done', thread = 'T1') => handlers['agent.end']({ thread: { id: thread }, status }),
    call: (input: Record<string, unknown>, thread = 'T1') => tool.execute(input, ctx(thread)),
    command: (thread = 'T1') => command(ctx(thread)),
    set: async (objective: string, thread = 'T1') => Number(/#(\d+)/.exec(await tool.execute({ action: 'set', objective }, ctx(thread)))![1]),
    appended,
    notices,
  }
}

test('no goal, no continuation', () => {
  expect(harness().end()).toBeUndefined()
})

test('command sets a goal, kicks off an idle thread and continues until complete', async () => {
  const h = harness({ input: async () => 'all tests green' })
  await h.command()
  expect(h.appended[0]).toContain('Goal #1 still open: all tests green')
  const result = h.end()
  expect(result).toMatchObject({ action: 'continue', maxContinuations: 20 })
  expect(result.userMessage).toContain('id=1')
  expect(await h.call({ action: 'complete', id: 1 })).toContain('complete')
  expect(h.end()).toBeUndefined()
})

test('model-proposed goals need a human confirmation', async () => {
  let asked: any
  const refused = harness({ confirm: async (opts) => ((asked = opts), false) })
  expect(await refused.call({ action: 'set', objective: 'x' })).toContain('did not set')
  expect(asked.requireHuman).toBe(true)
  expect(refused.end()).toBeUndefined()

  const failing = harness({ confirm: async () => Promise.reject(new Error('no ui')) })
  expect(await failing.call({ action: 'set', objective: 'x' })).toContain('did not set')
})

test('completing a stale goal id leaves the current goal running', async () => {
  const h = harness()
  const first = await h.set('A')
  await h.set('B')
  expect(await h.call({ action: 'complete', id: first })).toContain('not the current goal')
  expect(h.end().userMessage).toContain('B')
})

test('goals are per thread', async () => {
  const h = harness()
  await h.set('A', 'T1')
  expect(h.end('done', 'T2')).toBeUndefined()
  expect(h.end('done', 'T1').action).toBe('continue')
})

test('pause, cancel and errors stop continuations', async () => {
  const h = harness()
  await h.call({ action: 'pause', id: await h.set('x') })
  expect(h.end()).toBeUndefined()

  const c = harness()
  await c.set('x')
  expect(c.end('cancelled')).toBeUndefined()
  expect(c.end()).toBeUndefined()
  expect(await c.call({ action: 'get' })).toContain('paused')

  const e = harness()
  await e.set('x')
  expect(e.end('error')).toBeUndefined()
})

test('a cancel that lands while checking thread state prevents the kick-off', async () => {
  let h: ReturnType<typeof harness>
  h = harness({ input: async () => 'x' }, async () => {
    h.end('cancelled')
    return 'idle'
  })
  await h.command()
  expect(h.appended).toEqual([])
})

test('a dialog answered after the goal changed does not touch the new goal', async () => {
  let h: ReturnType<typeof harness>
  h = harness({
    select: async () => {
      await h.set('B')
      return 'Clear'
    },
  })
  await h.set('A')
  await h.command()
  expect(h.notices[0]).toContain('changed meanwhile')
  expect(h.end().userMessage).toContain('B')
})

test('a confirmation accepted after the goal changed does not overwrite it', async () => {
  let h: ReturnType<typeof harness>
  let inner = false
  h = harness({
    confirm: async () => {
      if (!inner) {
        inner = true
        await h.set('B')
      }
      return true
    },
  })
  expect(await h.call({ action: 'set', objective: 'A' })).toContain('changed while')
  expect(h.end().userMessage).toContain('B')
})

test('a thread stopped on an error is kicked off too', async () => {
  const h = harness({ input: async () => 'x' }, async () => 'error')
  await h.command()
  expect(h.appended.length).toBe(1)
})
