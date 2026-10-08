/**
 * agentrc goal: opt-in "keep going until it's done" for one Amp thread.
 *
 * Set a goal with the `goal` command, or ask the agent to set one (you confirm it). While the
 * goal is active, every turn that finishes normally is continued with a reminder until the agent
 * marks the goal complete or paused. Cancelling a turn pauses the goal. Goals live in memory
 * and end with the plugin process.
 */
import type { PluginAPI } from '@ampcode/plugin'

const MAX_CONTINUATIONS = 20

export interface Goal {
  id: number
  objective: string
  status: 'active' | 'paused'
}

export function continuationMessage(goal: Goal): string {
  return [
    `Goal #${goal.id} still open: ${goal.objective}`,
    `Keep working toward it. When it is fully achieved and verified, call the goal tool with action=complete and id=${goal.id}.`,
    `If you are blocked on something only the user can give you, say what you need and call the goal tool with action=pause and id=${goal.id}.`,
  ].join('\n')
}

export default function (amp: PluginAPI) {
  const goals = new Map<string, Goal>()
  let nextID = 1

  const set = (threadID: string, objective: string): Goal => {
    const goal: Goal = { id: nextID++, objective, status: 'active' }
    goals.set(threadID, goal)
    return goal
  }

  // Starts work on a stopped thread; a turn already running picks the goal up when it ends.
  const kickOff = async (threadID: string, goal: Goal) => {
    const thread = amp.threads.get(threadID as any)
    const state = await thread.state.get()
    const stopped = state === 'idle' || state === 'error'
    if (stopped && goals.get(threadID) === goal && goal.status === 'active') {
      await thread.appendUserMessage({ type: 'user-message', content: continuationMessage(goal) })
    }
  }

  amp.registerCommand('goal', { title: 'goal', category: 'agentrc', description: 'Set, pause, resume or clear this thread\'s goal' }, async (ctx) => {
    const threadID = ctx.thread?.id
    if (!threadID) return void (await ctx.ui.notify('Open a thread first.'))
    const goal = goals.get(threadID)

    const changedMeanwhile = () => goals.get(threadID) !== goal

    if (goal) {
      const toggle = goal.status === 'active' ? 'Pause' : 'Resume'
      const choice = await ctx.ui.select({ title: `Goal #${goal.id} (${goal.status}): ${goal.objective}`, options: ['Change objective', toggle, 'Clear'] })
      if (!choice) return
      if (changedMeanwhile()) return void (await ctx.ui.notify('The goal changed meanwhile; run the command again.'))
      if (choice === 'Clear') return void goals.delete(threadID)
      if (choice === 'Pause') return void (goal.status = 'paused')
      if (choice === 'Resume') {
        goal.status = 'active'
        return kickOff(threadID, goal)
      }
    }

    const objective = (await ctx.ui.input({ title: 'Goal for this thread', initialValue: goal?.objective, placeholder: 'What does done look like?' }))?.trim()
    if (!objective) return
    if (changedMeanwhile()) return void (await ctx.ui.notify('The goal changed meanwhile; run the command again.'))
    await kickOff(threadID, set(threadID, objective))
  })

  amp.registerTool({
    name: 'goal',
    description:
      'Read or update the thread goal that keeps you working across turns. action=get shows it; action=set proposes one (only when the user asked for a goal; they must confirm); action=complete when the objective is achieved and verified; action=pause when blocked on the user. complete and pause take the goal id.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'complete', 'pause'] },
        objective: { type: 'string', description: 'For action=set: what done looks like.' },
        id: { type: 'number', description: 'For action=complete or pause: the goal id.' },
      },
      required: ['action'],
    },
    async execute(input, ctx) {
      const threadID = ctx.thread.id
      const goal = goals.get(threadID)
      switch (input.action) {
        case 'set': {
          const objective = String(input.objective ?? '').trim()
          if (!objective) return 'Error: objective is required.'
          const ok = await ctx.ui.confirm({ title: 'Set thread goal?', message: objective, confirmButtonText: 'Set goal', requireHuman: true }).catch(() => false)
          if (!ok) return 'The user did not set the goal.'
          if (goals.get(threadID) !== goal) return 'The goal changed while the user was confirming; check it with action=get.'
          return `Goal #${set(threadID, objective).id} set: ${objective}`
        }
        case 'complete':
        case 'pause': {
          if (!goal) return 'No goal is set.'
          if (Number(input.id) !== goal.id) return `That is not the current goal. Current goal #${goal.id} (${goal.status}): ${goal.objective}`
          if (input.action === 'pause') {
            goal.status = 'paused'
            return 'Goal paused. The user can resume it with the goal command.'
          }
          goals.delete(threadID)
          return `Goal #${goal.id} complete: ${goal.objective}`
        }
        default:
          return goal ? `Goal #${goal.id} (${goal.status}): ${goal.objective}` : 'No goal is set.'
      }
    },
  })

  amp.on('agent.end', (event) => {
    const goal = goals.get(event.thread.id)
    if (!goal || goal.status !== 'active') return
    if (event.status === 'cancelled') {
      goal.status = 'paused'
      return
    }
    if (event.status !== 'done') return
    return { action: 'continue', userMessage: continuationMessage(goal), maxContinuations: MAX_CONTINUATIONS }
  })
}
