// Copied from amp/plugins/guard.ts by scripts/sync-policy.sh; edit it there.
// begin policy (shared with claude/agentrc/hooks/policy.ts)
export type Verdict = { decision: 'allow' } | { decision: 'deny' | 'ask'; reason: string }

const SECRET_PATHS: RegExp[] = [
  /(^|\/)\.env(\.[^/]+)?$/,
  /(^|\/)\.envrc$/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.pgpass$/,
  /(^|\/)kubeconfig$/,
  /(^|\/)(credentials|secrets?)\.(json|ya?ml|toml)$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)\.config\/amp\/(settings|telegram)\.json$/,
  /(^|\/)\.claude\/\.credentials\.json$/,
]
const SECRET_PATH_EXCEPTIONS = /\.(example|sample|template)(\.[^/]*)?$/

const DENY_COMMANDS: Array<[RegExp, string]> = [
  [/\brm\s+(-\S*\s+)*-\S*[rR]\S*\s+(-\S*\s+)*(\/\*?|~\/?|\$HOME\/?|\$\{HOME\}\/?)(\s|$)/, 'rm -r on / or home'],
  [/\brm\s+.*--no-preserve-root/, 'rm --no-preserve-root'],
  [/\bmkfs(\.\w+)?\b/, 'mkfs'],
  [/\bwipefs\b/, 'wipefs'],
  [/\bdd\b[^|;&]*\bof=\/dev\/(sd|nvme|hd|mmcblk|vd)/, 'dd onto a disk'],
  [/>\s*\/dev\/(sd|nvme|hd|mmcblk|vd)/, 'overwrite a disk'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'fork bomb'],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, 'pipe download into a shell'],
  [/\bgit\s+push\b.*\s(-f|--force(-with-lease)?)\b.*\b(main|master)\b/, 'force push to main'],
  [/\bgit\s+push\b.*\b(main|master)\b.*\s(-f|--force(-with-lease)?)\b/, 'force push to main'],
  [/\b(chmod|chown)\s+-R\b.*\s\/(etc|usr|boot|bin|sbin|lib)?(\s|$)/, 'recursive chmod/chown on system dirs'],
]

const ASK_COMMANDS: Array<[RegExp, string]> = [
  [/\bsudo\b/, 'sudo'],
  [/\bgit\s+push\b/, 'git push'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
  [/\bgit\s+clean\s+-\S*f/, 'git clean -f'],
  [/\b(npm|pnpm|yarn|bun|cargo)\s+publish\b|\btwine\s+upload\b|\bpoetry\s+publish\b/, 'package publish'],
  [/\bgh\s+(pr\s+(merge|close)|release\s+(create|delete)|repo\s+(delete|edit|rename))\b/, 'GitHub mutation'],
  [/\bkubectl\s+delete\b/, 'kubectl delete'],
  [/\bdocker\s+system\s+prune\b/, 'docker system prune'],
  [/\b(shutdown|reboot|poweroff)\b/, 'shutdown/reboot'],
  [/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, 'SQL drop/truncate'],
]

export function isSecretPath(path: string, home: string): boolean {
  const p = expandHome(path, home)
  if (SECRET_PATH_EXCEPTIONS.test(p)) return false
  return SECRET_PATHS.some((re) => re.test(p))
}

export function checkPath(path: string, home: string): Verdict {
  return isSecretPath(path, home)
    ? { decision: 'deny', reason: `${path} may hold secrets; ask the user to inspect or edit it locally.` }
    : { decision: 'allow' }
}

export function checkShell(command: string, home: string): Verdict {
  for (const token of command.split(/[\s'"`;|&<>()]+/)) {
    if (token && isSecretPath(token.replace(/^[A-Za-z_]+=/, ''), home)) {
      return { decision: 'deny', reason: `command touches ${token}, which may hold secrets; ask the user to do this locally.` }
    }
  }
  for (const [re, what] of DENY_COMMANDS) {
    if (re.test(command)) return { decision: 'deny', reason: `blocked: ${what}. Ask the user to run it themselves if it is really intended.` }
  }
  for (const [re, what] of ASK_COMMANDS) {
    if (re.test(command)) return { decision: 'ask', reason: what }
  }
  return { decision: 'allow' }
}

function expandHome(path: string, home: string): string {
  return path.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home)
}

const MCP_MUTATION = /^mcp__.+__\w*(create|send|delete|remove|update|merge|push|write|post|publish|move|modify|share|upload)\w*$/i

/** MCP tools whose name says they change something outside this machine. */
export function checkToolName(tool: string): Verdict {
  return MCP_MUTATION.test(tool) ? { decision: 'ask', reason: tool } : { decision: 'allow' }
}

const PATH_KEYS = ['path', 'file_path', 'filePath', 'filePattern', 'notebook_path']

export function checkToolInput(input: Record<string, unknown> | undefined, home: string): Verdict {
  for (const key of PATH_KEYS) {
    const value = input?.[key]
    if (typeof value === 'string') {
      const verdict = checkPath(value, home)
      if (verdict.decision !== 'allow') return verdict
    }
  }
  return { decision: 'allow' }
}

// end policy
