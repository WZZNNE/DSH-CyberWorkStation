/**
 * How the launcher invokes the dsh CLI and inspects its processes: the built entry under plain Node when
 * the core has been built, the corepack / pnpm source launch otherwise; the pids listening on the dsh web
 * port; the process table used to verify identities before a stop.
 */
import { listeningPids } from '../process-identity.mjs'
import { exists, run } from './util.mjs'

/**
 * @param {{ repo: string, builtCli: string, dshPort: number }} env
 */
export function createDshCli({ repo, builtCli, dshPort }) {
  /**
   * How to invoke the dsh CLI: the built entry under plain Node when the core
   * has been built (`pnpm build:lib`), else the source launch via corepack/pnpm.
   */
  function dshCommand(args) {
    if (exists(builtCli)) return { cmd: process.execPath, args: [builtCli, ...args], mode: 'built' }
    return { cmd: 'cmd.exe', args: ['/c', 'corepack', 'pnpm', 'dsh', ...args], mode: 'source' }
  }
  /**
   * `dsh plugin …` forwards to a bare `pnpm` on PATH (apps/cli/src/plugin.ts).
   * When corepack has not been enabled system-wide that lookup fails under the
   * built CLI, while `corepack pnpm dsh plugin …` still works because pnpm puts
   * itself on PATH for the script it runs — so plugin operations fall back to the
   * source launch whenever bare pnpm is missing. Checked once per process.
   */
  let pnpmOnPath = null
  async function resolveDshCommand(args) {
    let c = dshCommand(args)
    if (args[0] === 'plugin' && c.mode === 'built') {
      if (pnpmOnPath === null) pnpmOnPath = (await run('cmd.exe', ['/c', 'where', 'pnpm'])).ok
      if (!pnpmOnPath) c = { cmd: 'cmd.exe', args: ['/c', 'corepack', 'pnpm', 'dsh', ...args], mode: 'source' }
    }
    return c
  }
  async function runDsh(args, opts = {}) {
    const c = await resolveDshCommand(args)
    return run(c.cmd, c.args, { cwd: repo, ...opts })
  }

  /** PID listening on the dsh web port (Windows netstat). */
  async function dshPids() {
    const r = await run('netstat', ['-ano'])
    if (!r.ok) throw new Error('Cannot inspect listening processes (netstat failed)')
    return listeningPids(r.stdout, dshPort)
  }

  /** One CIM query → pid → { ppid, name } for every process (walking parent chains is then local). */
  async function processTable() {
    const r = await run('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress'])
    const table = new Map()
    try {
      const rows = JSON.parse(r.stdout)
      for (const p of Array.isArray(rows) ? rows : [rows]) {
        table.set(Number(p.ProcessId), { ppid: Number(p.ParentProcessId), name: String(p.Name ?? '').toLowerCase().replace(/\.exe$/, ''), commandLine: String(p.CommandLine ?? ''), created: p.CreationDate ? String(p.CreationDate) : '' })
      }
    } catch { /* an unreadable table just disables console reaping */ }
    return table
  }

  return { dshCommand, resolveDshCommand, runDsh, dshPids, processTable }
}
