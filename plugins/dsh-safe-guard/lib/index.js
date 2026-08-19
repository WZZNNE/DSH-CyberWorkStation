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
 */

import { compileExtraRules, evaluate } from './rules.js'

/** Tool name → the argument field carrying the command text. */
const COMMAND_FIELDS = new Map([
  ['bash', 'command'],
  ['pwsh', 'command'],
  ['terminal_send', 'text'],
])

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

export const name = 'dsh-safe-guard'

/**
 * Mount the guard.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ extraDenyPatterns?: string[] }} [config]
 */
export function apply(ctx, config = {}) {
  // Invalid regex throws here — misconfiguration fails loud at load.
  const extraRules = compileExtraRules(config.extraDenyPatterns ?? [])

  ctx.on('tools/pre-execute', (exec, next) => {
    const command = commandTextOf(exec)
    if (command === undefined) return next()
    const result = evaluate(command, extraRules)
    if (result.verdict === 'deny') {
      return {
        kind: 'deny',
        reason: `dsh-safe-guard [${result.rule}]: ${result.reason}. Command was NOT run.`,
      }
    }
    return next()
  })
}
