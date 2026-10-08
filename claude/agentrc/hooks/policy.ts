// Copied from amp/plugins/approval.ts by scripts/sync-policy.sh; edit it there.
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
