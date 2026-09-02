/**
 * dsh-drop-files — drop any file onto the chat.
 *
 * The core's composer only takes images from a drop (ComposerAttachments → onAddImages). This
 * plugin's browser half catches drops that carry other files, sends them here, and writes an
 * `@.dsh-uploads/<name>` reference into the composer; the agent then reads the file with its
 * own file tools inside the workspace it is already allowed to touch.
 *
 * Route (loopback, same-origin, JSON):
 *   POST /dsh-drop-files/upload { workspace, name, base64, sessionId? }
 *     → { ok, relative: '.dsh-uploads/<name>', absolute, bytes }
 *     → { ok: false, code, message } — code ∈ cross-site | bad-json | no-workspace | unknown-workspace |
 *       not-a-directory | empty | too-big | refused-path (the browser half turns the code into its own language)
 *
 * Rules: the workspace must be the working directory of a session this dsh knows — the session
 * the browser names (live, or a persisted snapshot), else any session with that directory — the
 * browser names it, the server checks it; the file lands under <workspace>/.dsh-uploads/ with a
 * sanitised name (a clash gets -2, -3 …); at most MAX_MB per file; nothing is ever written outside
 * that folder, and the folder carries its own `.gitignore` so uploads never enter the workspace's
 * repository. The route carries the suite's loopback + same-origin fence.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

export const name = 'drop-files'
export const inject = ['webServer', 'sessions']

const MAX_MB = 25
const MAX_BODY = Math.ceil(MAX_MB * 1024 * 1024 * 4 / 3) + 64 * 1024   // base64 growth + JSON envelope
const FOLDER = '.dsh-uploads'
const NAME_MAX = 120

/** A file name that cannot escape the folder or upset Windows: no path separators, no reserved names. */
export function safeName(raw) {
  let base = basename(String(raw ?? '')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
  base = base.replace(/^\.+/, '').replace(/[. ]+$/, '')   // Windows drops trailing dots and spaces; a name that keeps them cannot be opened by Explorer
  if (base.length > NAME_MAX) {
    // Keep the extension when shortening: the agent's tools and editors go by it.
    const ext = extname(base).slice(0, 16)
    base = base.slice(0, NAME_MAX - ext.length) + ext
  }
  if (!base) base = 'file'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base)) base = '_' + base
  return base
}

/** The first free name in the folder: file.txt, file-2.txt, file-3.txt … */
export function freeName(dir, wanted) {
  const ext = extname(wanted)
  const stem = wanted.slice(0, wanted.length - ext.length)
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`
    // The suffix must not push the name past the cap: shorten the stem, keep the extension.
    const candidate = stem.slice(0, Math.max(1, NAME_MAX - ext.length - suffix.length)) + suffix + ext
    if (!existsSync(join(dir, candidate))) return candidate
  }
}

/** Two paths name the same directory (Windows: case-insensitive, either separator). */
export function samePath(a, b) {
  const norm = p => { const r = resolve(String(p ?? '')); return process.platform === 'win32' ? r.toLowerCase() : r }
  if (!a || !b) return false
  try { return norm(a) === norm(b) } catch { return false }
}

/**
 * Whether `workspace` is the working directory of a session dsh knows. The named session first
 * (live, then the persisted snapshot header — `listSnapshots()` is async in the core), then any
 * live session with that directory, then any snapshot with it.
 */
export async function knownWorkspace({ sessions, persistence }, workspace, sessionId) {
  const cwdOf = s => s?.header?.cwd
  const live = () => { try { return [...(sessions?.list?.() ?? [])] } catch { return [] } }
  if (sessionId) {
    try { if (samePath(cwdOf(sessions?.get?.(sessionId)), workspace)) return true } catch { /* not live */ }
  }
  if (live().some(s => samePath(cwdOf(s), workspace))) return true
  let snapshots = []
  try { snapshots = await persistence?.listSnapshots?.() ?? [] } catch { snapshots = [] }
  if (!Array.isArray(snapshots)) return false
  if (sessionId) { const own = snapshots.find(s => s?.header?.id === sessionId); if (own && samePath(cwdOf(own), workspace)) return true }
  return snapshots.some(s => samePath(cwdOf(s), workspace))
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
  const refuse = (res, status, code, message) => json(res, status, { ok: false, code, message })
  const readBody = req => new Promise((resolvePromise, reject) => {
    const chunks = []
    let bytes = 0
    let over = false
    req.on('data', c => {
      if (over) return
      bytes += c.length
      if (bytes > MAX_BODY) { over = true; chunks.length = 0; req.resume(); reject(Object.assign(new Error(`file over the ${MAX_MB} MB limit`), { status: 413, code: 'too-big' })); return }
      chunks.push(c)
    })
    req.on('end', () => { if (over) return; try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(Object.assign(new Error('invalid JSON body'), { status: 400, code: 'bad-json' })) } })
    req.on('error', reject)
  })

  // The suite's fence (dsh-media-lab, dsh-web-search-plus, dsh-desktop-pet carry the same block).
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  const hostOf = req => { const h = String(req.headers.host ?? '').trim().toLowerCase(); const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h); return m ? `[${m[1]}]` : h.replace(/:\d+$/, '') }
  const rejectCrossSite = req => {
    if (!LOOPBACK_HOSTS.has(hostOf(req))) return true
    const site = String(req.headers['sec-fetch-site'] ?? '')
    if (site === 'cross-site' || site === 'same-site') return true   // another local port is not us
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin.length > 0) {
      try { if (new URL(origin).host.toLowerCase() !== String(req.headers.host ?? '').toLowerCase()) return true } catch { return true }
    }
    if (req.method === 'POST' && !/^application\/json/i.test(String(req.headers['content-type'] ?? ''))) return true
    return false
  }

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method === 'POST' && url.pathname === '/dsh-drop-files/upload') {
        if (rejectCrossSite(req)) return refuse(res, 403, 'cross-site', 'cross-site request refused')
        const body = await readBody(req)
        const workspace = typeof body.workspace === 'string' ? body.workspace.trim() : ''
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        if (!workspace) return refuse(res, 400, 'no-workspace', 'no workspace: open a session inside a workspace first')
        const known = await knownWorkspace({ sessions: ctx.sessions, persistence: ctx.get?.('sessionPersistence') }, workspace, sessionId)
        if (!known) return refuse(res, 403, 'unknown-workspace', 'that folder is not the workspace of any session here')
        let root
        try { root = resolve(workspace); if (!statSync(root).isDirectory()) throw new Error('not a directory') } catch { return refuse(res, 400, 'not-a-directory', `workspace is not a directory: ${workspace}`) }
        const b64 = typeof body.base64 === 'string' ? body.base64 : ''
        if (!b64) return refuse(res, 400, 'empty', 'empty file')
        const bytes = Buffer.from(b64, 'base64')
        if (bytes.length > MAX_MB * 1024 * 1024) return refuse(res, 413, 'too-big', `file over the ${MAX_MB} MB limit`)
        const dir = join(root, FOLDER)
        const fresh = !existsSync(dir)
        mkdirSync(dir, { recursive: true })
        // Uploads are the owner's scratch material, not part of their project: the folder ignores itself.
        if (fresh || !existsSync(join(dir, '.gitignore'))) { try { writeFileSync(join(dir, '.gitignore'), '*\n') } catch { /* read-only folder: the upload below will tell */ } }
        const wanted = safeName(body.name)
        let fileName = ''
        let target = ''
        // Exclusive create: two drops racing for the same name each get their own file.
        for (let attempt = 0; attempt < 5; attempt++) {
          fileName = freeName(dir, wanted)
          target = join(dir, fileName)
          // Belt and braces: the resolved target must stay inside the folder.
          if (!resolve(target).startsWith(resolve(dir) + (process.platform === 'win32' ? '\\' : '/'))) return refuse(res, 400, 'refused-path', 'refused path')
          try { writeFileSync(target, bytes, { flag: 'wx' }); break } catch (error) { if (error?.code !== 'EEXIST' || attempt === 4) throw error }
        }
        return json(res, 200, { ok: true, relative: `${FOLDER}/${fileName}`, absolute: target, bytes: bytes.length })
      }
      res.writeHead(404); res.end()
    } catch (error) {
      refuse(res, error?.status === 400 || error?.status === 413 ? error.status : 500, error?.code ?? 'error', String(error?.message ?? error).slice(0, 300))
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-drop-files', handler: route }), 'drop-files: routes')
  console.log(`[drop-files] ready: drops land in <workspace>/${FOLDER}/ (≤ ${MAX_MB} MB each)`)
}
