/**
 * agentrc approval: AI-reviewed tool use for Amp.
 *
 * - A short deterministic policy refuses the few shell commands whose damage is catastrophic and
 *   can't be undone. It is shared with claude/agentrc/hooks/policy.ts (scripts/sync-policy.sh copies
 *   it; tests/approval.test.ts checks they match).
 * - Shell commands, MCP tools, web fetches, edits outside the workspace and unknown tools go to a
 *   fast decision model, which judges them against the user's request for this turn. A risky call
 *   is put to the user in the active thread and refused in background threads.
 * - Read-only local tools and edits inside the workspace run unreviewed. If the model is
 *   unavailable, the call runs: the deterministic policy is the hard floor.
 */
import type { PluginAPI } from '@ampcode/plugin'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename as pathBasename, dirname, join } from 'node:path'

// begin policy (shared with claude/agentrc/hooks/policy.ts)
const TOP_LEVEL = new Set(['bin', 'boot', 'dev', 'etc', 'home', 'lib', 'lib64', 'opt', 'proc', 'root', 'sbin', 'srv', 'sys', 'usr', 'var', 'Users'])
const DISK = /^\/dev\/(sd[a-z]|nvme\d|hd[a-z]|mmcblk\d|vd[a-z]|xvd[a-z]|disk\/)/
/** Wrappers that run the command after them, with their options that take a separate value. */
const WRAPPERS: Record<string, string[]> = {
  sudo: ['-u', '--user', '-g', '--group', '-U', '--other-user', '-C', '--close-from', '-p', '--prompt', '-D', '--chdir', '-h', '--host'],
  doas: ['-u', '-C'],
  env: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
  nice: ['-n', '--adjustment'],
  exec: ['-a'], command: [], nohup: [], time: ['-f', '--format', '-o', '--output'], xargs: ['-I', '-n', '-P', '-d'],
}
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish'])
const FIND_HARMLESS = new Set(['-delete', '-depth', '-xdev', '-mount', '-mindepth', '-maxdepth'])
const FORK_BOMB = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/

type Segment = { words: string[]; redirects: string[] }

/** Drops heredoc bodies, except those fed to a shell, which run as commands. */
function withoutHeredocBodies(command: string): string {
  const kept: string[] = []
  let end = ''
  for (const line of command.split('\n')) {
    if (end) {
      if (line.trim() === end) end = ''
      continue
    }
    kept.push(line)
    const m = HEREDOC.exec(line)
    if (m && !/(^|[;&|]\s*)(sudo\s+)?(\S*\/)?(ba|z|da)?sh\b/.test(line)) end = m[2] ?? ''
  }
  return kept.join('\n')
}

/** Splits a command line into simple commands, honouring quotes, escapes and comments, with unquoted redirect targets. */
function segments(command: string): Segment[] {
  const out: Segment[] = []
  let words: string[] = [], redirects: string[] = [], word = '', quote = '', closer = '', inWord = false, redirect = false
  const endWord = () => {
    if (inWord) (redirect ? redirects : words).push(word)
    if (inWord) redirect = false
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length || redirects.length) out.push({ words, redirects })
    words = []
    redirects = []
    redirect = false
  }
  const text = withoutHeredocBodies(command)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? ''
    if (quote === "'") {
      if (ch === "'") quote = ''
      else word += ch
    } else if (ch === '\\') {
      const next = text[++i] ?? ''
      if (next !== '\n') word += next
      inWord = true
    } else if (quote === '"') {
      if (ch === '"') quote = ''
      else if (ch === '`' || (ch === '(' && text[i - 1] === '$')) {
        endSegment()
        quote = ''
        closer = ch === '`' ? '`' : ')'
      } else word += ch
    } else if (closer && ch === closer) {
      endSegment()
      quote = '"'
      closer = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
      inWord = true
    } else if (ch === '#' && !inWord) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++
    } else if (';&|()`\n'.includes(ch)) endSegment()
    else if (ch === '>') {
      endWord()
      redirect = true
    } else if (/\s/.test(ch)) endWord()
    else {
      word += ch
      inWord = true
    }
  }
  endSegment()
  return out
}

/** The command and its arguments, past keywords, variable assignments and wrappers such as sudo or nice. */
function commandWords(words: string[]): string[] {
  let i = 0
  while (i < words.length && (KEYWORDS.has(words[i] ?? '') || /^[A-Za-z_]\w*=/.test(words[i] ?? ''))) i++
  const valued = WRAPPERS[basename(words[i] ?? '')]
  if (!valued) return words.slice(i)
  i++
  while (i < words.length && (words[i] ?? '').startsWith('-')) i += valued.includes(words[i] ?? '') ? 2 : 1
  return commandWords(words.slice(i))
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** /, a top-level system directory, a home directory, or everything inside one of those. */
function isProtectedTarget(target: string): boolean {
  const path = target.replace(/(\/\*|\/\.)+$/, '').replace(/\/+$/, '')
  if (path === '' || path === '~' || path === '$HOME' || path === '${HOME}') return true
  return /^\/[^/]+$/.test(path) ? TOP_LEVEL.has(path.slice(1)) : /^\/(home|Users)\/[^/]+$/.test(path)
}

/** Why the command must not run, or undefined when it is not catastrophic. */
export function catastrophic(command: string): string | undefined {
  if (FORK_BOMB.test(command)) return 'fork bomb'
  for (const { words, redirects } of segments(command)) {
    if (redirects.some((target) => DISK.test(target))) return 'overwrite a disk'
    const [cmd = '', ...args] = commandWords(words)
    const name = basename(cmd)
    const flags = args.filter((a) => a.startsWith('-'))
    const operands = args.filter((a) => !a.startsWith('-'))
    const scriptFlag = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a))
    const nested = SHELLS.has(name) && scriptFlag >= 0 ? args[scriptFlag + 1] : name === 'eval' ? args.join(' ') : undefined
    const nestedReason = nested && catastrophic(nested)
    if (nestedReason) return nestedReason
    if (name === 'rm' && flags.some((f) => f === '--recursive' || /^-[^-]*[rR]/.test(f)) && operands.some(isProtectedTarget)) {
      return 'recursive delete of /, a system directory or a home directory'
    }
    const root = operands[0]
    if (name === 'find' && args.includes('-delete') && root !== undefined && isProtectedTarget(root)
      && args.slice(1).every((a) => FIND_HARMLESS.has(a) || /^\d+$/.test(a))) return 'find -delete on / or home'
    if (name === 'dd' && args.some((a) => a.startsWith('of=') && DISK.test(a.slice(3)))) return 'dd onto a disk'
    if (/^mkfs(\..+)?$/.test(name) && operands.some((a) => DISK.test(a))) return 'mkfs on a disk'
    if (name === 'wipefs' && operands.some((a) => DISK.test(a)) && flags.some((f) => /^-[^-]*a/.test(f) || f === '--all' || /^(-o|--offset)/.test(f))
      && !flags.some((f) => f === '-n' || f === '--no-act')) return 'wipefs on a disk'
    if (name === 'shred' && operands.some((a) => DISK.test(a))) return 'shred a disk'
  }
  return undefined
}
// end policy

/** Built-in tools that only read locally or coordinate other threads. */
const UNREVIEWED = new Set([
  'Read', 'Grep', 'glob', 'finder', 'view_media', 'web_search', 'read_mcp_resource',
  'read_thread', 'find_thread', 'get_thread_status', 'wait_for_threads', 'list_agent_modes',
  'oracle', 'librarian', 'Task', 'skill', 'painter', 'ask_user_choice',
  'create_thread', 'send_thread_message', 'shell_command_status', 'shell_command_kill',
])
/** File edits run unreviewed when every path they touch is inside the workspace. */
const EDITS = new Set(['edit_file', 'create_file', 'apply_patch'])

export const ASK_THRESHOLD = 0.7
const MAX_REVIEW_CHARS = 40_000

const INSTRUCTIONS =
  'An autonomous coding agent is about to make this tool call. The user wants as few interruptions as possible. ' +
  'Would a careful user want to be asked before it runs?'
const CRITERIA = {
  true:
    'Serious harm that is hard to undo and that the user\'s request does not clearly call for: deleting or overwriting data ' +
    'outside the project or not under version control, sending secrets or private data to a third party (including in a URL), ' +
    'changing system-wide or shell configuration, spending money, messaging or emailing other people, publishing or deploying ' +
    'to production, or destroying remote resources such as repositories, databases or cloud infrastructure.',
  false:
    'Routine development: reading anything, editing project files, running builds, tests and scripts, installing ' +
    'dependencies, git operations including commit, push and force-push when they fit the request, opening pull requests, ' +
    'fetching public documentation, and anything the user\'s request directly asks for.',
}

export default function (amp: PluginAPI) {
  const requests = new Map<string, string>()

  amp.on('agent.start', (event) => {
    requests.set(event.thread.id, event.message)
    return {}
  })

  const insideWorkspace = (event: Parameters<PluginAPI['helpers']['filesModifiedByToolCall']>[0]): boolean => {
    try {
      if (!amp.system.workspaceRoot) return false
      const root = realPath(amp.helpers.filePathFromURI(amp.system.workspaceRoot))
      // A workspace at / or the home directory is no boundary: every edit there is reviewed.
      if (root === '/' || root === realPath(homedir())) return false
      const paths = amp.helpers.filesModifiedByToolCall(event).map((uri) => realPath(amp.helpers.filePathFromURI(uri)))
      return paths.length > 0 && paths.every((p) => p.startsWith(`${root}/`))
    } catch {
      return false
    }
  }

  amp.on('tool.call', async (event, ctx) => {
    const shell = amp.helpers.shellCommandFromToolCall(event)
    const blocked = shell && catastrophic(shell.command)
    if (blocked) {
      return { action: 'reject-and-continue', message: `agentrc: blocked ${blocked}. If it is really intended, ask the user to run it themselves.` }
    }
    if (!shell && UNREVIEWED.has(event.tool)) return { action: 'allow' }
    if (!shell && EDITS.has(event.tool) && insideWorkspace(event)) return { action: 'allow' }

    const call = JSON.stringify(shell ? { tool: 'shell', command: shell.command, dir: shell.dir } : { tool: event.tool, input: event.input })
    const userRequest = requests.get(event.thread.id) ?? ''
    let risk = 1
    if (call.length + userRequest.length <= MAX_REVIEW_CHARS) {
      try {
        risk = (await ctx.ai.noul({ state: { userRequest, call }, instructions: INSTRUCTIONS, criteria: CRITERIA })).noul
      } catch (err) {
        amp.logger.log(`agentrc approval: review unavailable, allowing ${shell ? 'shell' : event.tool}: ${String(err)}`)
        return { action: 'allow' }
      }
    }
    amp.logger.log(`agentrc approval: ${shell ? 'shell' : event.tool} risk=${risk.toFixed(2)} → ${risk < ASK_THRESHOLD ? 'allow' : 'ask'}`)
    if (risk < ASK_THRESHOLD) return { action: 'allow' }

    const why = risk === 1 && call.length + userRequest.length > MAX_REVIEW_CHARS ? 'too long to review automatically' : `review risk ${risk.toFixed(2)}`
    if (amp.activeThread.current?.id !== event.thread.id) {
      return { action: 'reject-and-continue', message: `agentrc: this needs the user's approval (${why}), which a background thread can't get. Report back instead.` }
    }
    const shown = shell ? shell.command : `${event.tool} ${JSON.stringify(event.input, null, 2)}`
    const approved = await ctx.ui
      .confirm({ title: 'Allow this action?', message: `${why}\n\n\`\`\`\n${shown}\n\`\`\``, confirmButtonText: 'Allow', requireHuman: true })
      .catch(() => false)
    return approved ? { action: 'allow' } : { action: 'reject-and-continue', message: 'agentrc: the user declined this action.' }
  })
}

/** The path with symlinks resolved, through the nearest existing ancestor for a file not created yet. */
export function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPath(parent), pathBasename(path))
  }
}
