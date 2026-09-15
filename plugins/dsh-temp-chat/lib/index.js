/**
 * dsh-temp-chat host plugin — conversations that belong to no project.
 *
 * A dsh session always has a working directory (the core falls back to the launch cwd),
 * so a "temporary chat" is a session whose directory is a scratch folder under
 * `$DSH_HOME/scratch/`, grouped in its own workspace ("临时对话" / "Temporary chats") and
 * composed with the shipped `temp-chat` preset — no file, shell, job, subagent or workflow
 * tools, so nothing on the machine can be touched from it. The preset is copied to
 * `$DSH_HOME/.agent-presets/temp-chat/` on first load and never overwritten afterwards.
 *
 * Temp sessions are kept (never auto-deleted); `POST /clean` removes the scratch folders
 * of sessions the user selects, and the launcher lists them.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { inboxHasPending } from './session-read.js'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const name = 'temp-chat'
export const inject = ['sessions', 'agents', 'workspaceRegistry']

const DSH_HOME = resolveDshHome()
const SCRATCH_ROOT = join(DSH_HOME, 'scratch')
const PRESET_ID = 'temp-chat'
const USER_PRESET_DIR = join(DSH_HOME, '.agent-presets', PRESET_ID)
const HERE = dirname(fileURLToPath(import.meta.url))
const SHIPPED_PRESET = join(HERE, '..', 'presets', PRESET_ID, 'agent.cordis.yml')
const MAX_BODY = 64 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const FOLDER = /^tmp-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/
// Above this many resident temp agents, the plugin starts releasing the ones whose session has left
// the store (the user closed it) — a handle is never disposed while its session is still open.
const MAX_OWNED_HANDLES = 8

/** `tmp-YYYYMMDD-HHmmss-xxxxxx`, sortable and unique. */
function scratchName(now = new Date()) {
  const p = n => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `tmp-${stamp}-${randomUUID().slice(0, 6)}`
}

/**
 * dsh 0.1.3 renamed the persona config key `text` to `prefix` (+ optional `suffix`); a preset that still
 * says `text` fails schema validation when the agent mounts. The user's copy is never overwritten, so
 * the key is migrated in place once, keeping a dated backup next to it. Returns true when it rewrote.
 */
export function migratePersonaKey(file, now = new Date()) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return false }
  const lines = text.split(/\r?\n/)
  const row = lines.findIndex(l => /^\s*name:\s*['"]?@deepseek-ai\/dsh-persona['"]?\s*(#.*)?$/.test(l))
  if (row < 0) return false
  const indentOf = l => /^(\s*)/.exec(l)[1].length
  const rowIndent = indentOf(lines[row])
  for (let i = row + 1; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue
    // the row's own keys sit at the `name:` indentation; anything shallower is the next list item
    if (indentOf(lines[i]) < rowIndent) break
    const m = /^(\s+)text:(\s|$)/.exec(lines[i])
    // only the config child (one level below `name:`) is the persona key; deeper lines are prose
    if (!m || m[1].length !== rowIndent + 2) continue
    const stamp = now.toISOString().slice(0, 10).replaceAll('-', '')
    writeFileSync(file + '.bak-' + stamp, text)
    lines[i] = m[1] + 'prefix:' + lines[i].slice(m[0].length - m[2].length)
    writeFileSync(file, lines.join(text.includes('\r\n') ? '\r\n' : '\n'))
    return true
  }
  return false
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const log = (level, msg) => { (level === 'warn' ? console.warn : console.log)(`[temp-chat] ${msg}`) }
  const fail = (status, message) => Object.assign(new Error(message), { status })

  // ── the shipped preset lands in the user's preset root once ──
  let presetReady = false
  try {
    mkdirSync(SCRATCH_ROOT, { recursive: true })
    const target = join(USER_PRESET_DIR, 'agent.cordis.yml')
    if (!existsSync(target)) {
      mkdirSync(USER_PRESET_DIR, { recursive: true })
      writeFileSync(target, readFileSync(SHIPPED_PRESET, 'utf8'))
      log('info', `installed the ${PRESET_ID} preset into ${USER_PRESET_DIR}`)
    }
    if (migratePersonaKey(target)) log('info', `migrated the ${PRESET_ID} persona key text -> prefix (dsh 0.1.3+); a dated backup sits beside it`)
    presetReady = existsSync(target)
  } catch (error) { log('warn', `could not install the ${PRESET_ID} preset: ${String(error?.message ?? error)}`) }

  const presetsService = () => ctx.get('agentPresets')
  const agentOptions = () => {
    const sel = ctx.get('agentDefaultModel')?.currentSelection?.()
    return sel && sel.provider && sel.model ? { provider: sel.provider, model: sel.model } : {}
  }
  /**
   * Sessions this plugin created. `dispose()` also removes the session from the store, so a handle
   * is only released once that session is gone from `ctx.sessions` (the user closed it) and its
   * agent is idle — a temp chat someone is still typing in is never torn down underneath them.
   */
  const ownedHandles = []
  function releaseIdleHandles() {
    if (ownedHandles.length <= MAX_OWNED_HANDLES) return
    for (let i = 0; i < ownedHandles.length && ownedHandles.length > MAX_OWNED_HANDLES; i++) {
      const handle = ownedHandles[i]
      const agent = handle?.agent
      const id = agent?.session?.id
      const live = id !== undefined && ctx.sessions.list().some(session => session?.id === id)
      if (live || agent?.status === 'running' || inboxHasPending(agent)) continue
      ownedHandles.splice(i, 1)
      i -= 1
      handle?.dispose?.().catch(() => {})
    }
  }

  /** The workspace every temp chat joins, created on first use. */
  async function tempWorkspace() {
    const registry = ctx.workspaceRegistry
    mkdirSync(SCRATCH_ROOT, { recursive: true })
    const existing = await registry.resolveByPath?.(SCRATCH_ROOT)
    if (existing) return existing
    const found = registry.list().find(w => w.path === SCRATCH_ROOT)
    if (found) return found
    // the registry canonicalises the path and takes an optional title
    return registry.create(SCRATCH_ROOT, '临时对话 / Temporary chats')
  }

  /** Create one temp session: fresh scratch folder + the temp-chat preset + workspace. */
  async function createTemp({ preset, label, tools } = {}) {
    const folder = scratchName()
    const cwd = join(SCRATCH_ROOT, folder)
    mkdirSync(cwd, { recursive: true })
    const ps = presetsService()
    let presetId
    if (preset !== 'default' && ps && typeof ps.mount === 'function') {
      try { presetId = (await ps.resolve(preset ?? PRESET_ID)).id } catch (error) {
        log('warn', `preset "${preset ?? PRESET_ID}" is unavailable (${String(error?.message ?? error)}); composing the deployment default`)
      }
    }
    // A preset only controls what the PRESET mounts: a tool another plugin (or the deployment's
    // own profile) registered globally is visible to every agent, including this one. A temp chat is
    // documented as having no file / shell / job / subagent tools, so this agent's own context masks
    // the global set — `{ tools: 'all' }` on /new opts out for a caller that wants them.
    const sandboxed = tools !== 'all'
    const setup = async agentCtx => {
      if (presetId !== undefined && ps) await ps.mount(agentCtx, presetId)
      if (!sandboxed) return
      try {
        agentCtx.tools.restrict({ allow: [] })
      } catch (error) {
        log('warn', `temp chat could not mask global tools (${String(error?.message ?? error).slice(0, 160)}); it is NOT sandboxed`)
      }
    }
    const sessionId = `session-${randomUUID()}`
    const handle = await ctx.agents.create({
      sessionId,
      agentOptions: agentOptions(),
      meta: { cwd, ...(presetId === undefined ? {} : { agentPreset: presetId }) },
      setup,
    })
    ownedHandles.push(handle)
    releaseIdleHandles()
    let workspaceId
    try {
      const ws = await tempWorkspace()
      await ws.attachSession(sessionId)
      workspaceId = ws.id
    } catch (error) { log('warn', `temp session ${sessionId} could not join the scratch workspace: ${String(error?.message ?? error)}`) }
    try { await ctx.sessions.flush(handle.agent.session) } catch { /* persistence drains on its own */ }
    log('info', `temp chat ${sessionId} in ${cwd}${presetId ? ` (preset ${presetId})` : ''}`)
    return { ok: true, sessionId, cwd, folder, preset: presetId ?? null, workspaceId, label: label ?? '', sandboxed }
  }

  /** Scratch folders on disk, with the session ids that name them (if any) and their size. */
  function listScratch() {
    const out = []
    let entries = []
    try { entries = readdirSync(SCRATCH_ROOT, { withFileTypes: true }) } catch { return out }
    for (const entry of entries) {
      if (!entry.isDirectory() || !FOLDER.test(entry.name)) continue
      const path = join(SCRATCH_ROOT, entry.name)
      let files = 0
      let bytes = 0
      let mtime = 0
      const walk = (dir, depth) => {
        let items = []
        try { items = readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const item of items) {
          const p = join(dir, item.name)
          try {
            const st = statSync(p)
            mtime = Math.max(mtime, st.mtimeMs)
            if (item.isDirectory()) { if (depth < 3) walk(p, depth + 1) } else { files++; bytes += st.size }
          } catch { /* vanished */ }
        }
      }
      try { mtime = statSync(path).mtimeMs } catch { /* keep 0 */ }
      walk(path, 1)
      out.push({ folder: entry.name, path, files, bytes, mtime })
    }
    out.sort((a, b) => b.mtime - a.mtime)
    return out
  }

  /** Delete one scratch folder (never a live session's, never anything outside the scratch root). */
  function cleanScratch(folder) {
    if (!FOLDER.test(String(folder ?? ''))) throw fail(400, 'not a scratch folder name')
    const path = join(SCRATCH_ROOT, folder)
    for (const session of ctx.sessions.list()) {
      const open = String(session.header?.cwd ?? '').replace(/[\\/]+$/, '')
      const here = path.replace(/[\\/]+$/, '')
      // Windows paths differ only by case: comparing case-sensitively would let /clean delete the
      // folder of a session that is still open.
      if (open.localeCompare(here, undefined, { sensitivity: 'accent' }) === 0) {
        throw fail(409, 'that temp chat is still open in dsh; close it first')
      }
    }
    if (!existsSync(path)) return { ok: true, removed: false }
    rmSync(path, { recursive: true, force: true })
    return { ok: true, removed: true, path }
  }

  // ── HTTP ──
  const hostOf = req => { const h = String(req.headers.host ?? '').trim().toLowerCase(); const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h); return m ? `[${m[1]}]` : h.replace(/:\d+$/, '') }
  const rejectCrossSite = req => {
    if (!LOOPBACK_HOSTS.has(hostOf(req))) return true
    const site = String(req.headers['sec-fetch-site'] ?? '')
    if (site === 'cross-site' || site === 'same-site') return true   // another local port is not us
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin.length > 0) {
      // the whole authority, like the core's own trust check: another port is another origin
      try { if (new URL(origin).host.toLowerCase() !== String(req.headers.host ?? '').toLowerCase()) return true } catch { return true }
    }
    if (req.method === 'POST' && !/^application\/json/i.test(String(req.headers['content-type'] ?? ''))) return true
    return false
  }
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let over = false
    let settled = false
    const failWith = (status, message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status })) } }
    req.on('data', c => {
      if (over) return
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
      bytes += buf.length
      if (bytes > MAX_BODY) { over = true; chunks.length = 0; req.resume(); failWith(413, 'body too large'); return }
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
    req.on('aborted', () => failWith(400, 'request aborted'))
    req.on('error', () => failWith(400, 'request error'))
  })
  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }

  const route = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname
    try {
      if (rejectCrossSite(req)) { req.resume?.(); return json(res, 403, { ok: false, message: 'same-origin JSON requests only' }) }
      if (req.method === 'GET' && p === '/dsh-temp-chat/status') {
        return json(res, 200, {
          ok: true, scratchRoot: SCRATCH_ROOT, presetId: PRESET_ID, presetInstalled: presetReady,
          presetDir: USER_PRESET_DIR, folders: listScratch(), agentPresets: !!presetsService(),
        })
      }
      if (req.method === 'POST' && p === '/dsh-temp-chat/new') {
        const body = await readBody(req)
        const preset = typeof body.preset === 'string' && body.preset.trim() ? body.preset.trim().slice(0, 80) : undefined
        return json(res, 200, await createTemp({ preset, tools: body.tools === 'all' ? 'all' : undefined, label: typeof body.label === 'string' ? body.label.slice(0, 120) : '' }))
      }
      if (req.method === 'POST' && p === '/dsh-temp-chat/clean') {
        const body = await readBody(req)
        return json(res, 200, cleanScratch(body.folder))
      }
      res.writeHead(404); res.end()
    } catch (error) {
      const st = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500
      const msg = String(error?.message ?? error).slice(0, 400)
      if (res.headersSent) { log('warn', `${p} failed after the response started: ${msg}`); try { res.end() } catch { /* already closed */ } return }
      json(res, st, { ok: false, message: msg })
    }
  }

  ctx.effect(() => () => {
    // Same rule as at runtime: a temp chat that is still open is flushed, never disposed.
    // A live session is flushed and KEPT: dropping the handle here would mean nothing ever
    // disposes it. Only handles whose session has already left the store are released.
    const live = []
    for (const handle of ownedHandles.splice(0)) {
      const id = handle?.agent?.session?.id
      if (id !== undefined && ctx.sessions.list().some(session => session?.id === id)) {
        ctx.sessions.flush(handle.agent.session).catch(() => {})
        live.push(handle)
        continue
      }
      handle.dispose().catch(() => {})
    }
    ownedHandles.push(...live)
  }, 'temp-chat: owned sessions')
  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: '/dsh-temp-chat', handler: route }), 'temp-chat: routes')
  })
  log('info', `scratch root ${SCRATCH_ROOT}${presetReady ? '' : ' (preset not installed)'}`)
}
