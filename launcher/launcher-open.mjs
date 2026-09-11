import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { serverPorts } from './runtime-config.mjs'
import { normalizeDshHome } from './home-paths.mjs'

export function isLauncherStatus(value) {
  return value && typeof value === 'object' && typeof value.dshRunning === 'boolean'
    && typeof value.dshUrl === 'string' && ['built', 'source'].includes(value.launchMode)
    && typeof value.node === 'string'
}

/** Authentication and response shape both must succeed before a browser is opened. */
export async function waitForLauncher({ home, port, timeoutMs = 60000, readFile = fs.readFile, request = fetch,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const deadline = now() + timeoutMs
  const base = `http://127.0.0.1:${port}`
  do {
    try {
      const token = String(await readFile(path.join(home, 'launcher.token'), 'utf8')).trim()
      if (/^[0-9a-f]{32,64}$/.test(token)) {
        const response = await request(base + '/api/status', { headers: { 'x-launcher-token': token }, redirect: 'error', signal: AbortSignal.timeout(1500) })
        if (response.ok && isLauncherStatus(await response.json())) return { base, token }
      }
    } catch { /* server, token file or authenticated status is not ready yet */ }
    if (now() >= deadline) break
    await sleep(500)
  } while (now() < deadline)
  throw new Error(`Launcher is not ready at ${base}; check DSH_HOME, the port and .local/logs (no browser was opened)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { launcher: port } = serverPorts()
    const home = normalizeDshHome()
    const { base, token } = await waitForLauncher({ home, port })
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', `${base}/?t=${token}`], { windowsHide: true, detached: true, stdio: 'ignore' })
    child.on('error', () => { console.error('Could not open the default browser'); process.exitCode = 1 })
    child.unref()
    console.log('DSH Launcher: ' + base)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
