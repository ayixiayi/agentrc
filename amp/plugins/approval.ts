/**
 * agentrc approval: AI-reviewed tool use for Amp.
 *
 * - A short regex list refuses the few shell commands whose damage is catastrophic and can't be
 *   undone. That list is shared with claude/agentrc/hooks/policy.ts (scripts/sync-policy.sh copies
 *   it; tests/approval.test.ts checks they match).
 * - Shell commands, MCP tools and unknown tools go to a fast decision model, which judges them
 *   against the user's request for this turn. A risky call is put to the user in the active
 *   thread and refused in background threads. Read-only tools and project file edits run unreviewed.
 * - If the model is unavailable, the call runs: the regex list is the hard floor.
 */
import type { PluginAPI } from '@ampcode/plugin'

// begin policy (shared with claude/agentrc/hooks/policy.ts)
const CATASTROPHIC: Array<[RegExp, string]> = [
  [/\brm\s+(-\S*\s+)*-\S*[rR]\S*\s+(-\S*\s+)*(\/\*?|~\/?|\$HOME\/?|\$\{HOME\}\/?)(\s|$)/, 'rm -r on / or home'],
  [/\brm\s+.*--no-preserve-root/, 'rm --no-preserve-root'],
  [/(^|[;&|(]\s*|\bsudo\s+)mkfs(\.\w+)?\s/, 'mkfs'],
  [/(^|[;&|(]\s*|\bsudo\s+)wipefs\s/, 'wipefs'],
  [/\bdd\b[^|;&]*\bof=\/dev\/(sd|nvme|hd|mmcblk|vd)/, 'dd onto a disk'],
  [/>\s*\/dev\/(sd|nvme|hd|mmcblk|vd)/, 'overwrite a disk'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'fork bomb'],
]

/** Why the command must not run, or undefined when it is not catastrophic. */
export function catastrophic(command: string): string | undefined {
  return CATASTROPHIC.find(([re]) => re.test(command))?.[1]
}
// end policy

/** Built-in tools that only read, coordinate, or edit files the user can diff and revert. */
const UNREVIEWED = new Set([
  'Read', 'Grep', 'glob', 'finder', 'view_media', 'web_search', 'read_web_page', 'read_mcp_resource',
  'read_thread', 'find_thread', 'get_thread_status', 'wait_for_threads', 'list_agent_modes',
  'oracle', 'librarian', 'Task', 'skill', 'painter', 'ask_user_choice',
  'create_thread', 'send_thread_message', 'shell_command_status', 'shell_command_kill',
  'edit_file', 'create_file', 'apply_patch',
])

export const ASK_THRESHOLD = 0.7

const INSTRUCTIONS =
  'An autonomous coding agent is about to make this tool call. The user wants as few interruptions as possible. ' +
  'Would a careful user want to be asked before it runs?'
const CRITERIA = {
  true:
    'Serious harm that is hard to undo and that the user\'s request does not clearly call for: deleting or overwriting data ' +
    'outside the project or not under version control, sending secrets or private data to a third party, changing ' +
    'system-wide configuration, spending money, messaging or emailing other people, publishing or deploying to production, ' +
    'or destroying remote resources such as repositories, databases or cloud infrastructure.',
  false:
    'Routine development: reading anything, editing project files, running builds, tests and scripts, installing ' +
    'dependencies, git operations including commit, push and force-push when they fit the request, opening pull requests, ' +
    'and anything the user\'s request directly asks for.',
}

export default function (amp: PluginAPI) {
  const requests = new Map<string, string>()

  amp.on('agent.start', (event) => {
    requests.set(event.thread.id, event.message)
    return {}
  })

  amp.on('tool.call', async (event, ctx) => {
    const shell = amp.helpers.shellCommandFromToolCall(event)
    const blocked = shell && catastrophic(shell.command)
    if (blocked) {
      return { action: 'reject-and-continue', message: `agentrc: blocked ${blocked}. If it is really intended, ask the user to run it themselves.` }
    }
    if (!shell && UNREVIEWED.has(event.tool)) return { action: 'allow' }

    const call = shell ? { tool: 'shell', command: shell.command, dir: shell.dir } : { tool: event.tool, input: event.input }
    let risk: number
    try {
      const state = { userRequest: (requests.get(event.thread.id) ?? '').slice(0, 4000), call: JSON.stringify(call).slice(0, 8000) }
      risk = (await ctx.ai.noul({ state, instructions: INSTRUCTIONS, criteria: CRITERIA })).noul
    } catch (err) {
      ctx.logger.log(`agentrc approval: review unavailable, allowing: ${String(err)}`)
      return { action: 'allow' }
    }
    if (risk < ASK_THRESHOLD) return { action: 'allow' }

    const summary = shell ? shell.command : `${event.tool} ${JSON.stringify(event.input)}`
    if (amp.activeThread.current?.id !== event.thread.id) {
      return { action: 'reject-and-continue', message: `agentrc: this needs the user's approval (review risk ${risk.toFixed(2)}), which a background thread can't get. Report back instead.` }
    }
    const approved = await ctx.ui
      .confirm({ title: 'Allow this action?', message: `Review risk ${risk.toFixed(2)}\n\n\`\`\`\n${summary.slice(0, 1500)}\n\`\`\``, confirmButtonText: 'Allow' })
      .catch(() => false)
    return approved ? { action: 'allow' } : { action: 'reject-and-continue', message: 'agentrc: the user declined this action.' }
  })
}
