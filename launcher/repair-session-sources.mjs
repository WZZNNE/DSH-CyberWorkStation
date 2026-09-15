/**
 * Repair stored sessions that dsh 0.1.5 refuses to migrate.
 *
 * The 0.1.5 core migrates every stored session log to format V3 on first open. Its v0→v1 stage validates
 * plugin-authored `user/message` sources with an exact key list (`kind`, `plugin`, optional `form` /
 * `sections` / `summary`, plus `compactionId` / `sourceCommandId` for `compact`) and refuses the whole
 * session when a source carries anything else. Suite plugins wrote such members on 0.1.1:
 * chat-editor (`editedSeq`, `editKind`, `deletedCount`, `editedRole`) and memory-lite (`memoryIds`,
 * `memoryInvalidations`, `memoryRecallCallId`). Those sessions cannot be opened until the members leave the log.
 *
 * This script rewrites affected format v0 logs (`session.jsonl(.zstd)`): the extra members move into
 * `$DSH_HOME/session-source-extras.json` — `{ sessions: { [sessionId]: { [messageId]: {...} } }, parents }`,
 * keyed by the message id because every later migration stage renumbers event seqs. A v0 message without an
 * id is keyed by the id the core's v0→v1 stage mints for it (`legacy-message:<sessionId>:<seq>`), and an
 * `editedSeq` member gets its `editedMessageId` companion from the same log. The suite plugins merge the
 * members back when they read the session.
 *
 * Every migration stage runs the same key check (v1→v2 through `assertReleasedEventPayload(event, 1)`, v2→v3
 * through `assertReleasedPayloadSemantics(event, 2)`), so a `session.v1` / `session.v2` log (the core reads the
 * highest canonical N in a directory) is repaired the same way; its messages always carry ids. A v3 log is the
 * current format and is left alone.
 *
 * The original log is kept beside the rewritten one as `session.jsonl.zstd.bak-<date>`, the rewritten
 * container keeps the core's framing (first zstd frame = the header line alone, checksum flag set), the
 * sidecar is written atomically and its `parents` map (fork lineage recorded by the plugins) is preserved.
 * A sidecar that cannot be parsed is set aside as `session-source-extras.json.corrupt-<date>-<pid>[-n]`, never
 * overwritten. The script refuses to run while a dsh listens on the web port (`DSH_WEB_PORT`, default 3080):
 * live plugins rewrite the same sidecar; `--force` overrides that check. For the length of the run it also holds
 * the plugins' own lock (`session-source-extras.json.lock`), so a dsh on another port or a headless run cannot
 * interleave a write (its writers wait briefly, then report the sidecar as unwritable and withhold). A sidecar from the first version of this script (numeric seq keys) is re-keyed from the legacy
 * log's message ids on the next run.
 *
 * Usage: node launcher/repair-session-sources.mjs [--dry-run] [--force]
 * Exit codes: 0 done, 2 a dsh is listening on the web port, 3 the sidecar lock is held or was lost, 1 other errors.
 * Env:   DSH_HOME overrides the dsh home (default ~/.dsh).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HOME = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh')
const ROOT = path.join(HOME, 'sessions')
const SIDECAR = path.join(HOME, 'session-source-extras.json')
const LOCK = SIDECAR + '.lock'
const LOCK_STALE_MS = 5000
const DRY = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const WEB_PORT = Number(process.env.DSH_WEB_PORT) || 3080
// the core's v0→v1 rule (session-format-v0-to-v1/src/payload-validation.ts pluginSourceValue): kind + plugin, the
// optional form / sections / summary, and compactionId / sourceCommandId on the `compact` plugin's sources only
const ALLOWED = new Set(['kind', 'plugin', 'form', 'sections', 'summary'])
const ALLOWED_COMPACT = new Set(['compactionId', 'sourceCommandId'])
const allowedKey = (source, key) => ALLOWED.has(key) || (source.plugin === 'compact' && ALLOWED_COMPACT.has(key))
const ZSTD_MAGIC = 0xfd2fb528
// the core's canonical grammar (session-format/src/filename.ts): no `.v0`, no leading zeros
const GENERATION_LOG = /^session\.v([1-9][0-9]*)\.jsonl(\.zstd)?$/
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])

function zstdFrames(buf) {
  const frames = []
  for (let i = 0; i + 4 <= buf.length;) {
    if (buf.readUInt32LE(i) === ZSTD_MAGIC) { if (frames.length > 0) frames[frames.length - 1].end = i; frames.push({ start: i, end: buf.length }); i += 4 } else i += 1
  }
  return frames
}
function readLog(file) {
  const buf = fs.readFileSync(file)
  if (!file.endsWith('.zstd')) return buf.toString('utf8')
  const frames = zstdFrames(buf)
  if (frames.length === 0) throw new Error('no zstd frames')
  return Buffer.concat(frames.map(f => zlib.zstdDecompressSync(buf.subarray(f.start, f.end)))).toString('utf8')
}
/**
 * The core's jsonl-zstd backend stores a concatenated-frame container whose FIRST frame must decode to exactly the
 * header line (`assertZstdHeaderFrame`); later frames hold append batches. Write the header alone, then the rest,
 * both with the content checksum the core's writer sets.
 */
const ZSTD_OPTIONS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
function writeLog(file, text) {
  let bytes
  if (!file.endsWith('.zstd')) bytes = Buffer.from(text, 'utf8')
  else {
    const nl = text.indexOf('\n')
    if (nl < 0) throw new Error('log has no header line')
    const head = Buffer.from(text.slice(0, nl + 1), 'utf8')
    const rest = Buffer.from(text.slice(nl + 1), 'utf8')
    const frames = [zlib.zstdCompressSync(head, ZSTD_OPTIONS)]
    if (rest.length > 0) frames.push(zlib.zstdCompressSync(rest, ZSTD_OPTIONS))
    bytes = Buffer.concat(frames)
  }
  // never a torn log: the bytes land in a sibling temp file and replace the original in one rename
  const tmp = `${file}.repair-${process.pid}.tmp`
  fs.writeFileSync(tmp, bytes)
  fs.renameSync(tmp, file)
}

/**
 * The identity a message keeps through the core's migrations: its own id, else — for a format v0 log — the id the
 * v0→v1 stage mints (`legacy-message:<sessionId>:<seq>`, session-format-v0-to-v1/src/migration.ts). Undefined when
 * neither applies (a later-generation message without an id: the core never writes one).
 */
export function messageIdentity(event, sessionId, version) {
  if (!event || typeof event !== 'object' || !MESSAGE_TYPES.has(event.type)) return undefined
  const own = event.type === 'user/message' ? event.data?.id : event.data?.message?.id
  if (typeof own === 'string' && own.length > 0) return own
  if (version === 0 && typeof sessionId === 'string' && sessionId.length > 0 && Number.isSafeInteger(event.seq)) return `legacy-message:${sessionId}:${event.seq}`
  return undefined
}

/**
 * Split a log into lines and strip the extra source members; returns null when nothing had to move.
 * `extras` is keyed by message identity; a message that has none is reported under `unkeyed` and its members
 * are dropped with the line rewritten all the same. A chat-editor `editedSeq` gains the edited message's identity
 * as `editedMessageId` (seqs are renumbered by the migrations, ids are not).
 */
export function repairLogText(text) {
  const lines = text.split('\n')
  const parsed = lines.map(line => { if (line.length === 0) return null; try { return JSON.parse(line) } catch { return undefined } })
  const header = parsed.find(e => e?.type === 'session') ?? null
  const sessionId = typeof header?.id === 'string' ? header.id : undefined
  const version = typeof header?.version === 'number' ? header.version : 0
  const identityBySeq = new Map()
  for (const e of parsed) {
    if (!e || (e.type !== 'user/message' && e.type !== 'assistant/message')) continue
    const id = messageIdentity(e, sessionId, version)
    if (id !== undefined && Number.isSafeInteger(e.seq)) identityBySeq.set(e.seq, id)
  }
  const extras = {}
  const unkeyed = []
  let changed = false
  const out = lines.map((line, i) => {
    const event = parsed[i]
    if (!event) return line
    const source = event.type === 'user/message' ? event.data?.source : undefined
    if (!source || typeof source !== 'object' || source.kind !== 'plugin') return line
    const moved = {}
    for (const key of Object.keys(source)) if (!allowedKey(source, key)) { moved[key] = source[key]; delete source[key] }
    if (Object.keys(moved).length === 0) return line
    if (Number.isSafeInteger(moved.editedSeq) && moved.editedMessageId === undefined && identityBySeq.has(moved.editedSeq)) moved.editedMessageId = identityBySeq.get(moved.editedSeq)
    const messageId = messageIdentity(event, sessionId, version)
    if (messageId !== undefined) extras[messageId] = moved
    else unkeyed.push(event.seq)
    changed = true
    return JSON.stringify(event)
  })
  if (!changed) return null
  return { text: out.join('\n'), extras, unkeyed, id: sessionId, version }
}

/** The highest-generation log the core would read from a directory listing, or null when only a v0 log can be there. */
export function latestGeneration(names) {
  let latest = null
  for (const name of names) {
    const m = GENERATION_LOG.exec(name)
    if (!m) continue
    const version = Number(m[1])
    if (latest === null || version > latest.version) latest = { name, version }
  }
  return latest
}

const validSidecar = doc => !!doc && typeof doc === 'object' && !Array.isArray(doc)
  && !!doc.sessions && typeof doc.sessions === 'object' && !Array.isArray(doc.sessions)
  && (doc.parents === undefined || (!!doc.parents && typeof doc.parents === 'object' && !Array.isArray(doc.parents)))
/**
 * Read the sidecar. An absent file starts a fresh document; one that cannot be parsed (or has the wrong shape)
 * is set aside under a dated name — its content may still be recoverable by hand — and a fresh document starts.
 */
export function loadSidecar(file, { dryRun = false, stamp = 'now' } = {}) {
  if (!fs.existsSync(file)) return { doc: { version: 1, sessions: {} }, setAside: null }
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (validSidecar(doc)) return { doc, setAside: null }
  } catch { /* set aside below */ }
  let setAside = `${file}.corrupt-${stamp}-${process.pid}`
  for (let n = 2; fs.existsSync(setAside); n++) setAside = `${file}.corrupt-${stamp}-${process.pid}-${n}`
  if (!dryRun) fs.renameSync(file, setAside)
  return { doc: { version: 1, sessions: {} }, setAside }
}
/** The same lock protocol as the kit's session-read.js (@dsh-suite/kit): `wx` file, a lock older than 5 s is a dead process's. */
function acquireSidecarLock() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { fs.writeFileSync(LOCK, `${process.pid} ${Date.now()}\n`, { flag: 'wx' }); return true } catch (error) {
      if (error?.code === 'ENOENT') { fs.mkdirSync(path.dirname(LOCK), { recursive: true }); continue }
      if (error?.code !== 'EEXIST') return false
      try {
        if (lockAge() > LOCK_STALE_MS) {
          const stale = `${LOCK}.stale-${process.pid}`
          try { fs.renameSync(LOCK, stale); fs.unlinkSync(stale) } catch { /* another process took it over */ }
          continue
        }
      } catch { continue }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
  return false
}
/** The lock's age by the holder's own timestamp (the plugins read the same field), else by mtime. */
function lockAge() {
  try { const written = Number(fs.readFileSync(LOCK, 'utf8').split(' ')[1]); if (Number.isFinite(written) && written > 0) return Date.now() - written } catch { /* mtime decides */ }
  return Date.now() - fs.statSync(LOCK).mtimeMs
}
const holdsLock = () => { try { return fs.readFileSync(LOCK, 'utf8').split(' ')[0] === String(process.pid) } catch { return false } }
/** The plugins treat a lock older than 5 s as a dead process's: a long run rewrites its timestamp as it goes. */
function heartbeatSidecarLock() { if (holdsLock()) { try { fs.writeFileSync(LOCK, `${process.pid} ${Date.now()}\n`) } catch { /* the save checks the lock again */ } } }
function releaseSidecarLock() { try { if (holdsLock()) fs.unlinkSync(LOCK) } catch { /* already gone */ } }
/** Sessions this run has rewritten: their sidecar entries are this run's; every other session is the file's. */
const repairedIds = new Set()
/**
 * Write the document under a lock this process verifiably holds (a lock stolen after a stall is re-acquired or
 * the run stops before touching anything). The file's current content is the base: only the sessions this run
 * repaired come from memory, every other session and every parent link is whatever the file holds now.
 */
function saveSidecar(doc) {
  if (!holdsLock() && !acquireSidecarLock()) throw Object.assign(new Error('the sidecar lock was taken over by another process; nothing more is written — run again'), { code: 'ELOCKLOST' })
  heartbeatSidecarLock()
  let current
  try { current = JSON.parse(fs.readFileSync(SIDECAR, 'utf8')) } catch { current = undefined }
  if (validSidecar(current)) {
    for (const [id, entry] of Object.entries(current.sessions)) if (!repairedIds.has(id)) doc.sessions[id] = entry
    for (const id of Object.keys(doc.sessions)) if (!repairedIds.has(id) && current.sessions[id] === undefined) delete doc.sessions[id]
    doc.parents = { ...(doc.parents ?? {}), ...(current.parents ?? {}) }
  }
  const tmp = `${SIDECAR}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
  fs.renameSync(tmp, SIDECAR)
}
/** Merge one session's moved members into the sidecar; returns how many existing entries were replaced by different content. */
export function mergeExtras(doc, sessionId, extras) {
  const existing = doc.sessions[sessionId] ?? {}
  let replaced = 0
  for (const [messageId, members] of Object.entries(extras)) {
    if (existing[messageId] !== undefined && JSON.stringify(existing[messageId]) !== JSON.stringify(members)) replaced += 1
  }
  doc.sessions[sessionId] = { ...existing, ...extras }
  return replaced
}
const legacyLogOf = dir => ['session.jsonl.zstd', 'session.jsonl'].map(n => path.join(dir, n)).find(f => fs.existsSync(f))

/**
 * Entries written by the first version of this script were keyed by event seq. Re-key them by message identity
 * from the legacy log (still on disk beside the migrated one, its ids intact). Returns the number of sessions re-keyed.
 */
export function rekeyLegacyEntries(doc, dirs, { tick } = {}) {
  let rekeyed = 0
  for (const [sessionId, entry] of Object.entries(doc.sessions)) {
    if (typeof tick === 'function') tick()
    if (!entry || typeof entry !== 'object') continue
    const seqKeys = Object.keys(entry).filter(k => /^\d+$/.test(k))
    if (seqKeys.length === 0) continue
    const dir = dirs.get(sessionId)
    const file = dir ? legacyLogOf(dir) : undefined
    if (!file) continue
    const byId = {}
    try {
      const parsed = readLog(file).split('\n').map(line => { if (line.length === 0) return null; try { return JSON.parse(line) } catch { return null } })
      const header = parsed.find(e => e?.type === 'session')
      const logSessionId = typeof header?.id === 'string' ? header.id : sessionId
      const version = typeof header?.version === 'number' ? header.version : 0
      for (const event of parsed) {
        if (event?.type !== 'user/message' || !seqKeys.includes(String(event.seq))) continue
        const id = messageIdentity(event, logSessionId, version)
        if (id !== undefined) byId[id] = entry[String(event.seq)]
      }
    } catch { continue }
    const rest = Object.fromEntries(Object.entries(entry).filter(([k]) => !/^\d+$/.test(k)))
    doc.sessions[sessionId] = { ...rest, ...byId }
    repairedIds.add(sessionId)
    rekeyed += 1
  }
  return rekeyed
}

/** Whether something listens on the dsh web port (a live dsh rewrites the sidecar this script rewrites). */
function portListening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = value => { socket.destroy(); resolve(value) }
    socket.setTimeout(700, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

async function main() {
  if (!fs.existsSync(ROOT)) { console.log(`[repair] no session store at ${ROOT}`); return }
  if (!FORCE && await portListening(WEB_PORT)) { console.error(`[repair] a dsh is listening on 127.0.0.1:${WEB_PORT}; stop it first (its plugins write the same sidecar), or pass --force`); process.exitCode = 2; return }
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  if (!acquireSidecarLock()) { console.error(`[repair] the sidecar lock ${LOCK} is held by another process; try again later`); process.exitCode = 3; return }
  try { await repairAll(stamp) } finally { releaseSidecarLock() }
}

async function repairAll(stamp) {
  const { doc: sidecar, setAside } = loadSidecar(SIDECAR, { dryRun: DRY, stamp })
  if (setAside) console.log(`[repair] the sidecar could not be parsed; ${DRY ? 'would set it aside' : 'set aside'} as ${path.basename(setAside)} and started a fresh one`)
  let scanned = 0, repaired = 0, laterGeneration = 0, replacedTotal = 0, droppedTotal = 0
  const notes = []
  const dirs = new Map()
  const repairFile = (session, file) => {
    const result = repairLogText(readLog(file))
    if (result === null) return
    const id = result.id ?? session.name
    const count = Object.keys(result.extras).length
    droppedTotal += result.unkeyed.length
    const lost = result.unkeyed.length > 0 ? `; ${result.unkeyed.length} message(s) without an identity lost their members (seq ${result.unkeyed.join(', ')})` : ''
    if (DRY) { notes.push(`${session.name}: would move ${count} source member set(s) out of ${path.basename(file)} (format v${result.version})${lost}`); repaired += 1; return }
    const backup = `${file}.bak-${stamp}`
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
    const replaced = mergeExtras(sidecar, id, result.extras)
    replacedTotal += replaced
    repairedIds.add(id)
    saveSidecar(sidecar)
    writeLog(file, result.text)
    repaired += 1
    notes.push(`${session.name}: moved ${count} source member set(s) out of ${path.basename(file)} (format v${result.version}) into the sidecar${replaced > 0 ? ` (${replaced} existing entr${replaced === 1 ? 'y' : 'ies'} replaced by the log's own members)` : ''}; backup ${path.basename(backup)}${lost}`)
  }
  let lockLost = null
  scan: for (const project of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    for (const session of fs.readdirSync(path.join(ROOT, project.name), { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const dir = path.join(ROOT, project.name, session.name)
      dirs.set(session.name, dir)
      let names
      try { names = fs.readdirSync(dir) } catch { continue }
      heartbeatSidecarLock()
      const latest = latestGeneration(names)
      if (latest !== null && latest.version >= 3) continue // the current format: the core has migrated (or written) this one
      const file = latest !== null ? path.join(dir, latest.name) : legacyLogOf(dir)
      if (!file) continue
      if (latest !== null) laterGeneration += 1
      scanned += 1
      try { repairFile(session, file) } catch (error) {
        if (error?.code === 'ELOCKLOST') { lockLost = error; break scan }
        notes.push(`${session.name}: skipped (${String(error?.message ?? error)})`)
      }
    }
  }
  let rekeyed = 0
  if (lockLost === null) {
    rekeyed = rekeyLegacyEntries(sidecar, dirs, { tick: heartbeatSidecarLock })
    if (rekeyed > 0 && !DRY) { try { saveSidecar(sidecar) } catch (error) { if (error?.code === 'ELOCKLOST') lockLost = error; else throw error } }
  }
  for (const n of notes) console.log(`[repair] ${n}`)
  if (lockLost !== null) { console.error(`[repair] stopped: ${lockLost.message}`); process.exitCode = 3 }
  console.log(`[repair] scanned ${scanned} session(s) (${laterGeneration} on a v1/v2 log); ${DRY ? 'would repair' : 'repaired'} ${repaired} (${replacedTotal} sidecar entr${replacedTotal === 1 ? 'y' : 'ies'} replaced, ${droppedTotal} member set(s) dropped); ${DRY ? 'would re-key' : 're-keyed'} ${rekeyed} seq-keyed sidecar session(s); sidecar ${SIDECAR}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
