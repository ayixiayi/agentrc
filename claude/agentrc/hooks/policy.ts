// Copied from amp/plugins/approval.ts by scripts/sync-policy.sh; edit it there.
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
