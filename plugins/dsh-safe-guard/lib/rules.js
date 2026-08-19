/**
 * Pure decision rules for dsh-safe-guard. No I/O, no clock, no state: one
 * command string in, one verdict out, so the whole policy is unit-testable in
 * milliseconds (pattern from dsh-handbook ch.4: separate pure logic from
 * injection points).
 */

/** Path-ish tokens whose recursive deletion is never a routine agent task. */
const CRITICAL_RM_TARGETS = new Set(['/', '/*', '~', '~/', '.', '..', '*'])

/** Windows drive-root forms like C:\ or D:/ (optionally quoted or starred). */
const DRIVE_ROOT = /^["']?[a-z]:[\\/]?\*?["']?$/i

/**
 * Built-in deny rules. Each rule: stable id, human reason, and a matcher over
 * the whole command text. Matchers stay conservative on purpose — a false
 * positive blocks legitimate work, so every pattern targets a form with no
 * routine use.
 */
const BUILTIN_RULES = [
  {
    id: 'rm-no-preserve-root',
    reason: 'rm --no-preserve-root has no legitimate agent use',
    test: cmd => /\brm\b[^|;&]*--no-preserve-root/.test(cmd),
  },
  {
    id: 'rm-rf-critical-target',
    reason: 'recursive force-delete of a critical path (/, ~, ., *, or a drive root)',
    test: cmd => {
      // Each simple command segment is inspected on its own so `a && rm -rf /` is caught.
      for (const segment of cmd.split(/[|;&]+/)) {
        const words = segment.trim().split(/\s+/)
        if (words[0] !== 'rm' && !(words[0] === 'sudo' && words[1] === 'rm')) continue
        const flags = words.filter(w => /^-[a-z]*$/i.test(w)).join('')
        if (!(flags.includes('r') && flags.includes('f')) && !flags.includes('R')) continue
        const targets = words.slice(1).filter(w => !w.startsWith('-'))
        if (targets.some(t => CRITICAL_RM_TARGETS.has(t) || DRIVE_ROOT.test(t))) return true
      }
      return false
    },
  },
  {
    id: 'git-push-force',
    reason: 'git push --force discards remote history; use --force-with-lease deliberately and manually',
    test: cmd => /\bgit\s+push\b/.test(cmd)
      && /(\s--force\b|\s-f\b)/.test(cmd)
      && !/--force-with-lease/.test(cmd),
  },
  {
    id: 'raw-device-write',
    reason: 'writing to a raw block device destroys the filesystem',
    test: cmd => /\bdd\b[^|;&]*\bof=\/dev\/(sd|hd|nvme|mmcblk|disk)/.test(cmd)
      || /(^|[|;&]\s*)[^|;&]*>\s*\/dev\/(sd|hd|nvme|mmcblk|disk)/.test(cmd),
  },
  {
    id: 'mkfs',
    reason: 'mkfs reformats a filesystem',
    test: cmd => /\bmkfs(\.[a-z0-9]+)?\b/.test(cmd),
  },
  {
    id: 'windows-drive-wipe',
    reason: 'recursive force-delete or format of a Windows drive root',
    test: cmd => {
      if (/\bformat\s+[a-z]:/i.test(cmd)) return true
      for (const segment of cmd.split(/[|;&]+/)) {
        const words = segment.trim().split(/\s+/)
        const head = (words[0] ?? '').toLowerCase()
        if (!['del', 'rd', 'rmdir', 'remove-item'].includes(head)) continue
        const recursive = words.some(w => /^\/s$/i.test(w))
          || words.some(w => /^-recurse$/i.test(w))
        const targets = words.slice(1).filter(w => !w.startsWith('/') && !w.startsWith('-'))
        if (recursive && targets.some(t => DRIVE_ROOT.test(t))) return true
      }
      return false
    },
  },
  {
    id: 'chmod-root',
    reason: 'recursive permission change on /',
    test: cmd => /\bchmod\b[^|;&]*-[a-z]*R[a-z]*\b[^|;&]*\s\/(\s|$)/.test(cmd),
  },
  {
    id: 'fork-bomb',
    reason: 'shell fork bomb',
    test: cmd => /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(cmd),
  },
]

/**
 * Compile user-supplied extra deny patterns. Invalid regex fails loud at load
 * (repo convention: misconfiguration fails at the earliest resolvable point).
 * @param {string[]} patterns - regex sources, evaluated case-insensitively.
 * @returns {{ id: string, reason: string, test: (cmd: string) => boolean }[]}
 */
export function compileExtraRules(patterns) {
  return patterns.map((source, index) => {
    const regex = new RegExp(source, 'i')
    return {
      id: `extra-${index}`,
      reason: `matched configured deny pattern ${JSON.stringify(source)}`,
      test: cmd => regex.test(cmd),
    }
  })
}

/**
 * Evaluate one command string against the built-in and extra rules.
 * @param {string} command - the full shell command text.
 * @param {{ id: string, reason: string, test: (cmd: string) => boolean }[]} [extraRules]
 * @returns {{ verdict: 'deny', rule: string, reason: string } | { verdict: 'allow' }}
 */
export function evaluate(command, extraRules = []) {
  const cmd = command.trim()
  for (const rule of [...BUILTIN_RULES, ...extraRules]) {
    if (rule.test(cmd)) return { verdict: 'deny', rule: rule.id, reason: rule.reason }
  }
  return { verdict: 'allow' }
}
