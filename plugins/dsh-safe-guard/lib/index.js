/**
 * dsh-safe-guard — deny destructive shell commands at the tools/pre-execute
 * gate, before the tool body runs.
 *
 * Second development of the official permission-gate shape
 * (docs/cookbook/extension-cookbook.md § "A hook plugin"): a waterfall
 * listener returns a typed { kind: 'deny', reason } to short-circuit, and
 * delegates every other call through next() so downstream policy (sandbox,
 * permission, plan mode) still runs. Registration goes through ctx.on(), so
 * disposing the plugin fiber unregisters the listener (registrations are
 * effects).
 *
 * Rules come from two places: the plugin config (`extraDenyPatterns`, loaded
 * once, invalid regex fails loud) and the hot-reloaded user file
 * $DSH_HOME/safe-guard.json edited from the DSH Launcher Control Deck:
 *   { "denyPatterns": [...regex], "askPatterns": [...regex], "allowPatterns": [...regex] }
 * `denyPatterns` deny outright; `askPatterns` turn the call into an approval
 * request (`{ kind: 'ask' }`), so the user confirms once in the Web UI;
 * `allowPatterns` auto-approve a matching command. Precedence is fixed and
 * cautious: an allow match still runs the rest of the chain first and yields
 * to ANY downstream deny — a user PreToolUse hook, the sandbox — so an allow
 * pattern can never turn a refusal into an execution. What it does is
 * downgrade a confirmation: where the chain would otherwise ask, an allow
 * match approves. Patterns are unanchored substring tests over the whole
 * command, so an allow rule must be written tightly (anchor with `^`): a bare
 * `git` would match `git … && curl x | sh` and approve the lot.
 */

import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileSync, watchFile, unwatchFile } from 'node:fs'
import { join } from 'node:path'
import { compileExtraRules, evaluate } from './rules.js'

/** Tool name → the argument field carrying the command text. */
const COMMAND_FIELDS = new Map([
  ['bash', 'command'],
  ['pwsh', 'command'],
  ['terminal_send', 'text'],
])

const RULES_FILE = join(resolveDshHome(), 'safe-guard.json')

/**
 * Extract the command text this execution would run, or undefined when the
 * tool is not a shell surface (then the guard must delegate untouched).
 * @param {{ name: string, arguments: unknown }} exec
 * @returns {string | undefined}
 */
function commandTextOf(exec) {
  const field = COMMAND_FIELDS.get(exec.name)
  if (field === undefined) return undefined
  const args = exec.arguments
  if (typeof args !== 'object' || args === null) return undefined
  const value = /** @type {Record<string, unknown>} */ (args)[field]
  return typeof value === 'string' ? value : undefined
}

/** Compile the user rules file; invalid patterns are skipped (hot reload must never take the guard down). */
function loadUserRules() {
  let raw = null
  try { raw = JSON.parse(readFileSync(RULES_FILE, 'utf8')) } catch { return { deny: [], ask: [], allow: [] } }
  const compile = (list, prefix) => {
    const out = []
    for (const [i, source] of (Array.isArray(list) ? list : []).entries()) {
      if (typeof source !== 'string' || source.length === 0) continue
      try { const regex = new RegExp(source, 'i'); out.push({ id: `${prefix}-${i}`, reason: `matched user ${prefix} pattern ${JSON.stringify(source)}`, test: cmd => regex.test(cmd) }) } catch { /* skipped */ }
    }
    return out
  }
  return { deny: compile(raw?.denyPatterns, 'deny'), ask: compile(raw?.askPatterns, 'ask'), allow: compile(raw?.allowPatterns, 'allow') }
}

export const name = 'dsh-safe-guard'

/**
 * Mount the guard.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ extraDenyPatterns?: string[] }} [config]
 */
export function apply(ctx, config = {}) {
  // Invalid regex throws here — misconfiguration fails loud at load.
  const extraRules = compileExtraRules(config.extraDenyPatterns ?? [])
  let userRules = loadUserRules()
  const reload = () => { userRules = loadUserRules() }
  ctx.effect(() => { watchFile(RULES_FILE, { interval: 1500 }, reload).unref?.(); return () => unwatchFile(RULES_FILE, reload) }, 'dsh-safe-guard: rules file watch')

  ctx.on('tools/pre-execute', async (exec, next) => {
    const command = commandTextOf(exec)
    if (command === undefined) return next()
    const result = evaluate(command, [...extraRules, ...userRules.deny])
    if (result.verdict === 'deny') {
      return {
        kind: 'deny',
        reason: `dsh-safe-guard [${result.rule}]: ${result.reason}. Command was NOT run.`,
      }
    }
    // safe-guard's own verdict for a command that survived the deny rules: `ask` (raise a
    // confirmation) or `allow` (downgrade one). Ask outranks allow when both match. Either way
    // the rest of the chain — a user PreToolUse hook, then the built-in permission gate — runs
    // FIRST, and a downstream `deny` from any listener is returned untouched: neither tier can
    // downgrade a refusal, only a confirmation. The deny tier above still short-circuits, which
    // is fail-closed. Only shell surfaces reach here (commandTextOf gated above).
    const ask = userRules.ask.find(rule => rule.test(command.trim()))
    const allow = ask === undefined ? userRules.allow.find(rule => rule.test(command.trim())) : undefined
    const verdict = ask !== undefined
      ? { kind: 'ask', reason: `dsh-safe-guard [${ask.id}]: ${ask.reason}` }
      : allow !== undefined
        ? { kind: 'allow', reason: `dsh-safe-guard [${allow.id}]: ${allow.reason}` }
        : undefined
    if (verdict === undefined) return next()
    const downstream = await next()
    if (downstream && downstream.kind === 'deny') return downstream
    return verdict
  })
}
