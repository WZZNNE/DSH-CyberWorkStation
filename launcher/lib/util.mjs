/**
 * Small helpers the launcher server shares across its modules: JSON replies, the capped JSON body
 * reader, file existence, the zh/en message picker, a loopback port probe, a child-process runner, and
 * atomic JSON files. Nothing here knows the launcher's paths or state.
 */
import { execFile } from 'node:child_process'
import { createConnection } from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

export const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }

// A malformed JSON body is a client error: surface it as HTTP 400 instead of silently acting on {}.
// Body reader: collects Buffers and decodes UTF-8 once (a multibyte character split across socket reads
// must never become U+FFFD), caps by BYTES (1 MB), drains oversized bodies so the 413 is still delivered,
// and rejects when the client goes away mid-body.
export const BODY_LIMIT = 1048576
export const readBody = (req, limit = BODY_LIMIT) => new Promise((resolve, reject) => {
  const chunks = []
  let bytes = 0
  let over = false
  let settled = false
  const fail = (status, message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status })) } }
  req.on('data', c => {
    if (over) return
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
    bytes += buf.length
    if (bytes > limit) { over = true; chunks.length = 0; req.resume(); fail(413, `body too large (${Math.round(limit / 1048576)} MB max)`); return }
    chunks.push(buf)
  })
  req.on('end', () => {
    if (over || settled) return
    settled = true
    const text = Buffer.concat(chunks).toString('utf8')
    try {
      const value = text ? JSON.parse(text) : {}
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { reject(Object.assign(new Error('JSON body must be an object'), { status: 400 })); return }
      resolve(value)
    } catch { reject(Object.assign(new Error('invalid JSON body'), { status: 400 })) }
  })
  req.on('aborted', () => fail(400, 'request aborted'))
  req.on('error', () => fail(400, 'request error'))
})

export const exists = p => { try { fs.accessSync(p); return true } catch { return false } }

/** Pick the zh/en variant of a user-visible message for the request language. */
export const pick = (lang, zh, en) => (lang === 'en' ? en : zh)

/** Whether something accepts connections on a loopback port (900 ms budget). */
export function checkPort(port) {
  return new Promise(resolve => {
    const s = createConnection({ host: '127.0.0.1', port, timeout: 900 })
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })
}

/** Run a command to completion: `{ ok, code, stdout, stderr }`, never throws. */
export function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 60000, cwd: opts.cwd, maxBuffer: 8 * 1024 * 1024, ...(opts.env ? { env: opts.env } : {}) }, (error, stdout, stderr) => {
      // a timeout kill has no exit code (KILLED + signal), a maxBuffer overflow is TRUNCATED, a spawn failure keeps
      // its string code (ENOENT …): never a false 0, never a bare 1 that hides the cause
      const code = error === null ? 0
        : typeof error.code === 'number' ? error.code
        : error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'TRUNCATED'
        : error.killed || error.signal ? 'KILLED'
        : typeof error.code === 'string' ? error.code : 1
      resolve({ ok: error === null, code, ...(error?.signal ? { signal: error.signal } : {}), ...(code === 'TRUNCATED' ? { truncated: true } : {}), stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }

/** Atomic: a torn config file reads back as "nothing configured" on the next hot reload. */
export const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // The tmp name carries this process id and a random suffix: the launcher and dsh write some of
  // these files, and a shared name would let one process rename the other's half-written file
  // into place. A failed rename takes its tmp file with it.
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
    fs.renameSync(tmp, file)
  } catch (error) {
    try { fs.unlinkSync(tmp) } catch { /* already gone */ }
    throw error
  }
}

/**
 * Recursive directory size in bytes with a 60 s cache. The walk is asynchronous
 * (fs.promises, one await per directory) so a 1.4 GB core tree does not freeze
 * the dashboard poll while it is being measured.
 */
const sizeCache = new Map()
export async function dirSize(p) {
  const hit = sizeCache.get(p)
  if (hit !== undefined && Date.now() - hit.at < 60000) return hit.size
  let total = 0
  const walk = async d => {
    let entries = []
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const fp = path.join(d, e.name)
      try {
        if (e.isSymbolicLink()) continue
        if (e.isDirectory()) await walk(fp)
        else total += (await fs.promises.stat(fp)).size
      } catch { /* busy or permission-denied entries are skipped */ }
    }
  }
  if (exists(p)) await walk(p)
  sizeCache.set(p, { at: Date.now(), size: total })
  return total
}
