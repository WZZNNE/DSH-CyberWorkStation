/** Bootstrap equivalent of the core home resolver, available before core is installed. */
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Match @deepseek-ai/dsh-home-paths; relative paths use the caller's initial cwd. */
export function resolveDshHome(configured, env = process.env, cwd = process.cwd()) {
  const fromEnv = env.DSH_HOME
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : path.join(os.homedir(), '.dsh'))
  const expanded = selected === '~' ? os.homedir()
    : selected.startsWith('~/') || selected.startsWith('~\\') ? path.join(os.homedir(), selected.slice(2)) : selected
  return path.resolve(cwd, expanded)
}

/** Persist the absolute root in the inherited environment before changing child cwd. */
export function normalizeDshHome(env = process.env, cwd = process.cwd()) {
  return env.DSH_HOME = resolveDshHome(undefined, env, cwd)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const home = normalizeDshHome()
    console.log(process.argv[2] === '--json' ? JSON.stringify(home) : home)
  } catch {
    console.error('Unable to resolve DSH_HOME; check its path and the launcher installation')
    process.exitCode = 1
  }
}
