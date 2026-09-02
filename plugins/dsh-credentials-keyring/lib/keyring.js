/**
 * Windows Credential Manager access through one persistent PowerShell helper
 * (ps/credman.ps1): JSON lines in, JSON lines out, values base64 across the
 * pipe. Requests are serialized; a timeout or crash kills the child, fails
 * the in-flight call, and opens a cooldown during which every call reports
 * "unavailable" so the caller can fall back — the keyring must never be able
 * to hang a credential resolve.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ps', 'credman.ps1')
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,120}$/

/**
 * @param {{ spawnFn?: typeof spawn, platform?: string, timeoutMs?: number, cooldownMs?: number, log?: (msg: string) => void }} [options]
 */
export function createKeyring({ spawnFn = spawn, platform = process.platform, timeoutMs = 10000, cooldownMs = 30000, log = () => {} } = {}) {
  let child = null
  let buffer = ''
  let queue = Promise.resolve()
  let brokenUntil = 0
  let pending = null

  const available = () => platform === 'win32' && Date.now() >= brokenUntil

  function breakDown(reason) {
    brokenUntil = Date.now() + cooldownMs
    log(`keyring helper unavailable (${reason}); falling back for ${Math.round(cooldownMs / 1000)}s`)
    if (pending) { pending.reject(new Error(`keyring helper: ${reason}`)); pending = null }
    if (child) {
      // Drop the dead child's listeners before nulling it: a late line from a killed helper must
      // never reach the buffer a future child shares and settle the wrong request.
      try { child.stdout.removeAllListeners('data') } catch { /* already gone */ }
      try { child.kill() } catch { /* already gone */ }
      child = null
    }
    buffer = ''
  }

  function ensureChild() {
    if (child) return child
    child = spawnFn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    child.on('error', () => breakDown('spawn failed'))
    child.on('exit', () => { if (child) breakDown('helper exited') })
    // A write to a helper that died between the exit event and the next request breaks the pipe
    // ASYNCHRONOUSLY on some platforms; with no listener that is an uncaughtException that takes
    // the harness down — the one thing this fail-open transport must never do. Route it to the
    // same cooldown as every other failure so the call falls back instead.
    child.stdin.on('error', () => breakDown('stdin broken'))
    child.stdout.on('data', chunk => {
      buffer += String(chunk)
      let at
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        if (!line || !pending) continue
        const settle = pending
        pending = null
        try { settle.resolve(JSON.parse(line)) } catch { settle.reject(new Error('keyring helper: unreadable reply')) }
      }
    })
    child.unref?.()
    child.stdout.unref?.()
    child.stdin.unref?.()
    return child
  }

  function request(body) {
    // One at a time: the helper answers strictly in order, so interleaving
    // two requests would pair answers with the wrong callers.
    const run = queue.then(() => new Promise((resolve, reject) => {
      if (!available()) { reject(new Error('keyring unavailable')); return }
      const proc = ensureChild()
      pending = { resolve, reject }
      const timer = setTimeout(() => breakDown('timed out'), timeoutMs)
      const settle = pending
      pending = {
        resolve: value => { clearTimeout(timer); settle.resolve(value) },
        reject: error => { clearTimeout(timer); settle.reject(error) },
      }
      try { proc.stdin.write(JSON.stringify(body) + '\n') } catch (error) { breakDown(`write failed: ${String(error?.message ?? error)}`) }
    }))
    queue = run.catch(() => {})
    return run
  }

  return {
    get available() { return available() },
    /** The stored value, or undefined when nothing is stored under this name. */
    async get(name) {
      if (!NAME_RE.test(String(name))) return undefined
      const reply = await request({ op: 'get', name })
      if (reply?.ok !== true) throw new Error(String(reply?.error ?? 'keyring get failed'))
      if (reply.found !== true) return undefined
      return Buffer.from(String(reply.value ?? ''), 'base64').toString('utf8')
    },
    async set(name, value) {
      if (!NAME_RE.test(String(name))) throw new Error('keyring: bad credential name')
      const reply = await request({ op: 'set', name, value: Buffer.from(String(value), 'utf8').toString('base64') })
      if (reply?.ok !== true) throw new Error(String(reply?.error ?? 'keyring set failed'))
    },
    async remove(name) {
      if (!NAME_RE.test(String(name))) return
      const reply = await request({ op: 'delete', name })
      if (reply?.ok !== true) throw new Error(String(reply?.error ?? 'keyring delete failed'))
    },
    dispose() {
      const proc = child
      child = null
      if (proc) { try { proc.stdin.end() } catch { /* gone */ } try { proc.kill() } catch { /* gone */ } }
    },
  }
}
