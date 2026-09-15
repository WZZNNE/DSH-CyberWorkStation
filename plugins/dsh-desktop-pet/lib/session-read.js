/**
 * Stored-session reads on the dsh 0.1.5 `sessionPersistence` surface. Since 0.1.3 the service
 * hands out lifecycle-held `SessionHandle`s: `list()` / `stat(id)` return
 * `{ header, revision, eventCount?, sizeBytes? }` snapshots and a full log is read through
 * `open(id, 'read')` → `read(0)` → `close()`; the 0.1.1 `inspect(id)` / `listSnapshots()` calls
 * are gone. The helpers below speak the new surface first and fall back to the old one, so an
 * older core or a test double keeps working. Copied verbatim into every suite plugin that reads
 * sessions (memory-lite, chat-editor, desktop-pet, drop-files, temp-chat, control-deck) — suite
 * plugins do not import each other.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** The detached header of one `list()` / `stat()` row, whatever shape the core hands out. */
export function snapshotHeader(row) {
  if (!row || typeof row !== 'object') return undefined
  if (row.header && typeof row.header === 'object') return row.header
  if (row.meta && typeof row.meta === 'object') return row.meta
  return typeof row.id === 'string' ? row : undefined
}

/** Every stored session as `{ header, revision, eventCount, sizeBytes }`; an absent store lists nothing. */
export async function listStoredSessions(persistence) {
  if (!persistence) return []
  let rows
  if (typeof persistence.list === 'function') rows = await persistence.list()
  else if (typeof persistence.listSnapshots === 'function') rows = await persistence.listSnapshots()
  else return []
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const header = snapshotHeader(row)
    if (!header || typeof header.id !== 'string') continue
    out.push({
      header,
      revision: row?.revision ?? null,
      eventCount: typeof row?.eventCount === 'number' ? row.eventCount : undefined,
      sizeBytes: typeof row?.sizeBytes === 'number' ? row.sizeBytes : undefined,
    })
  }
  return out
}

/** One stored session's snapshot, or undefined when the store has no such session. */
export async function statStoredSession(persistence, id) {
  if (!persistence || typeof id !== 'string') return undefined
  if (typeof persistence.stat === 'function') {
    const row = await persistence.stat(id)
    const header = snapshotHeader(row)
    return header ? { header, revision: row?.revision ?? null } : undefined
  }
  return (await listStoredSessions(persistence)).find(s => s.header.id === id)
}

/**
 * The complete validated log of one stored session: `{ header, events, inheritedEventCount }`.
 * A read handle never takes ownership, so this works while a live agent holds the write side.
 * Throws when the store is absent or the session cannot be read (callers map that to 404).
 * `raw: true` returns the events exactly as the core stores them (no sidecar merge) — the shape to
 * seed a fork or copy elsewhere.
 */
export async function readStoredSession(persistence, id, options = {}) {
  if (!persistence) throw new Error('session persistence is not available in this deployment')
  const readOptions = options.signal ? { signal: options.signal } : {}
  const finish = (header, events, inheritedEventCount) => ({
    header,
    events: options.raw ? events : restoreSourceExtras(id, events, { parentSessionId: header?.parentSession }),
    inheritedEventCount,
  })
  if (typeof persistence.open === 'function') {
    const handle = await persistence.open(id, 'read', readOptions)
    try {
      const result = await handle.read(0, undefined, readOptions)
      return finish(handle.header, [...(result?.events ?? [])], typeof handle.inheritedEventCount === 'number' ? handle.inheritedEventCount : 0)
    } finally {
      try { await handle.close() } catch { /* a closed handle is the goal either way */ }
    }
  }
  if (typeof persistence.inspect === 'function') {
    const inspection = await persistence.inspect(id)
    return finish(inspection.meta ?? inspection.header, [...(inspection.events ?? [])], typeof inspection.inheritedEventCount === 'number' ? inspection.inheritedEventCount : 0)
  }
  throw new Error('session persistence offers no read surface')
}

/**
 * Whether an agent still has queued input. 0.1.5 makes `Inbox` a type interface whose public face
 * is the `nextTurn` / `nextStep` queues; the 0.1.1 `hasPending` flag is honoured when present.
 */
export function inboxHasPending(agent) {
  const inbox = agent?.inbox
  if (!inbox || typeof inbox !== 'object') return false
  if (typeof inbox.hasPending === 'function') return inbox.hasPending() === true
  if (inbox.hasPending === true) return true
  return (Array.isArray(inbox.nextTurn) && inbox.nextTurn.length > 0)
    || (Array.isArray(inbox.nextStep) && inbox.nextStep.length > 0)
}

/**
 * The complete log of a LIVE session as a plain array. 0.1.2 removed the `Session.events` getter;
 * `snapshotEvents()` (0.1.2+) returns the frozen log from seq 0. An older core, or a test double, may still
 * expose `events`. `raw: true` skips the sidecar merge (the shape to seed a fork from).
 */
export function liveEvents(session, options = {}) {
  if (!session || typeof session !== 'object') return []
  const events = typeof session.snapshotEvents === 'function' ? [...session.snapshotEvents()] : Array.isArray(session.events) ? [...session.events] : []
  if (options.raw) return events
  return restoreSourceExtras(session.id ?? session.header?.id, events, { parentSessionId: session.header?.parentSession })
}

/** One event of a live session by seq (`eventAt` since 0.1.2; the array on older cores / doubles), sidecar merged. */
export function liveEventAt(session, seq) {
  if (!session || typeof session !== 'object') return undefined
  const event = typeof session.eventAt === 'function' ? session.eventAt(seq) : Array.isArray(session.events) ? session.events[seq] : undefined
  if (event === undefined) return undefined
  return restoreSourceExtras(session.id ?? session.header?.id, [event], { parentSessionId: session.header?.parentSession })[0]
}

// ---------------------------------------------------------------------------------------------------------------
// Source extras sidecar. The core's format migrations (every stage from v0→v1 on) validate plugin-authored
// `user/message` sources with an exact key list (`kind`, `plugin`, and the documented `form` / `sections` /
// `summary`), and the v1→v2 and v2→v3 stages renumber event seqs. Suite plugins therefore keep their own
// per-message metadata (chat-editor's editedSeq / editKind / …, memory-lite's memoryIds / memoryInvalidations /
// memoryRecallCallId) OUT of the log, in `$DSH_HOME/session-source-extras.json`, keyed by session id and
// MESSAGE id — the one identity a migration preserves. A fork copies the parent's messages (same ids) under a
// new session id, so the file also keeps `parents: { [childId]: parentId }` and a session's entries are looked
// up along that lineage (the entries themselves are never duplicated).
// Writers call `recordSourceExtras` before appending; readers get the members merged back by
// `restoreSourceExtras` (through `liveEvents` / `liveEventAt` / `readStoredSession`).
// Two dsh processes may share one home (the launcher's web instance and a headless run): every rewrite
// happens under an exclusive lock file (`session-source-extras.json.lock`, shared with the launcher's repair
// script) and starts from a fresh read of the document, so no write is lost.
// `launcher/repair-session-sources.mjs` moves the members of pre-sidecar logs into the same file.
export const SOURCE_EXTRAS_FILE = join(resolveDshHome(), 'session-source-extras.json')
const LOCK_FILE = SOURCE_EXTRAS_FILE + '.lock'
const LOCK_STALE_MS = 5000
const LOCK_WAIT_MS = 300
const PASSIVE_RETRY_MS = 30000
const MAX_LINEAGE = 16
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const isSafeKey = key => typeof key === 'string' && key.length > 0 && key.length <= 200 && !UNSAFE_KEYS.has(key)
let extrasCache = { stamp: '', sessions: {}, parents: {}, ok: true }
let passiveWriteFailedAt = 0

/** The identity of the file's current bytes: nanosecond mtime, size and inode (a same-size rewrite in the same tick still differs). */
function fileStamp() {
  const st = statSync(SOURCE_EXTRAS_FILE, { bigint: true })
  return `${st.mtimeNs}:${st.size}:${st.ino}`
}
function parseSidecar(text) {
  const doc = JSON.parse(text)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !doc.sessions || typeof doc.sessions !== 'object' || Array.isArray(doc.sessions)) return undefined
  const parents = doc.parents && typeof doc.parents === 'object' && !Array.isArray(doc.parents) ? doc.parents : {}
  return { sessions: doc.sessions, parents }
}

/** Refresh the in-process view when the file changed. `ok` is false when the file exists but cannot be trusted. */
function loadSidecar() {
  let stamp
  try {
    stamp = fileStamp()
  } catch (error) {
    // Only a missing file is "nothing recorded"; a permission or I/O error must not look like an empty sidecar,
    // or the next write would replace every session's members with one entry.
    const absent = error?.code === 'ENOENT'
    extrasCache = { stamp: '', sessions: {}, parents: {}, ok: absent }
    return { ok: absent, absent }
  }
  if (stamp === extrasCache.stamp) return { ok: extrasCache.ok }
  let parsed
  try { parsed = parseSidecar(readFileSync(SOURCE_EXTRAS_FILE, 'utf8')) } catch { parsed = undefined }
  extrasCache = { stamp, sessions: parsed?.sessions ?? {}, parents: parsed?.parents ?? {}, ok: parsed !== undefined }
  return { ok: parsed !== undefined }
}

/** The session and its recorded ancestors, oldest first (cycles and runaway chains cut). */
function lineageOf(sessionId, parents, extra) {
  const chain = []
  const seen = new Set()
  let id = sessionId
  while (isSafeKey(id) && !seen.has(id) && chain.length < MAX_LINEAGE) {
    seen.add(id)
    chain.unshift(id)
    const next = Object.hasOwn(parents, id) ? parents[id] : undefined
    id = next ?? (id === sessionId ? extra : undefined)
  }
  return chain
}

/**
 * `{ [messageId]: { ...members } }` recorded for one session, ancestors first so the session's own entries win;
 * undefined when nothing is recorded along its lineage.
 */
export function sourceExtrasFor(sessionId, parentSessionId) {
  if (!isSafeKey(sessionId)) return undefined
  loadSidecar()
  let merged
  for (const id of lineageOf(sessionId, extrasCache.parents, parentSessionId)) {
    const entry = Object.hasOwn(extrasCache.sessions, id) ? extrasCache.sessions[id] : undefined
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    merged = { ...(merged ?? {}), ...entry }
  }
  return merged
}

/**
 * Events with their recorded source members merged back (copies; the core's frozen events are never mutated).
 * A `parentSessionId` (from the session header, the core's own forks included) is remembered once, so later
 * reads — and forks of this fork — find the inherited members without the header at hand. That write is
 * passive: a read path never retries a sidecar that refused a write in the last 30 s.
 */
export function restoreSourceExtras(sessionId, events, options = {}) {
  const parentSessionId = isSafeKey(options.parentSessionId) ? options.parentSessionId : undefined
  // recorded when the parent has entries or is itself linked further up (a chain through a session without
  // entries of its own); a parent never opened by a suite plugin and without entries leaves nothing to inherit
  if (parentSessionId !== undefined && isSafeKey(sessionId) && loadSidecar().ok && !Object.hasOwn(extrasCache.parents, sessionId) && (Object.hasOwn(extrasCache.sessions, parentSessionId) || Object.hasOwn(extrasCache.parents, parentSessionId))) recordParentLink(sessionId, parentSessionId, { passive: true })
  const extras = sourceExtrasFor(sessionId, parentSessionId)
  if (!extras) return events
  return events.map(e => restoreOne(extras, e))
}
function restoreOne(extras, e) {
  if (!e || e.type !== 'user/message') return e
  const source = e.data?.source
  if (!source || typeof source !== 'object' || source.kind !== 'plugin') return e
  const messageId = e.data?.id
  const more = isSafeKey(messageId) && Object.hasOwn(extras, messageId) ? extras[messageId] : undefined
  if (!more || typeof more !== 'object' || Array.isArray(more)) return e
  // the recorded members never redefine what the log says the message is
  const { kind: _kind, plugin: _plugin, ...members } = more
  if (Object.keys(members).length === 0) return e
  return { ...e, data: { ...e.data, source: { ...source, ...members } } }
}

const sleepMs = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* no waiting primitive: retry at once */ } }
/**
 * Take the exclusive lock (a `wx` file holding pid + time). A lock older than 5 s belongs to a dead process and is
 * taken over by an atomic rename — only one waiter can win that rename, so two waiters never both proceed; a stale
 * lock that cannot be moved (held open by another program) counts as held. The wait is synchronous and short
 * (a rewrite takes milliseconds): every path reaches the deadline, and a writer that cannot get the lock in time
 * returns false rather than stalling the process.
 */
function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      writeFileSync(LOCK_FILE, `${process.pid} ${Date.now()}\n`, { flag: 'wx' })
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') {
        try { mkdirSync(dirname(LOCK_FILE), { recursive: true }) } catch { return false }
      } else if (error?.code !== 'EEXIST') {
        return false
      } else {
        let takenOver = false
        try {
          if (lockAge() > LOCK_STALE_MS) {
            const stale = `${LOCK_FILE}.stale-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
            renameSync(LOCK_FILE, stale)
            takenOver = true
            try { unlinkSync(stale) } catch { /* a leftover marker is harmless */ }
          }
        } catch { /* gone in the meantime, or immovable: treated as held */ }
        if (takenOver) continue
      }
    }
    if (Date.now() >= deadline) return false
    sleepMs(5)
  }
}
/**
 * How old the lock is: by the timestamp its holder wrote (the holder's own clock, on this host), else by the
 * file's mtime — a home on a network share carries the server's clock, which must not make live locks look dead.
 */
function lockAge() {
  try {
    const written = Number(readFileSync(LOCK_FILE, 'utf8').split(' ')[1])
    if (Number.isFinite(written) && written > 0) return Date.now() - written
  } catch { /* unreadable (a directory, a torn write): the mtime decides */ }
  return Date.now() - statSync(LOCK_FILE).mtimeMs
}
/** Release the lock, but only our own: a lock another process took over after a stall is not ours to remove. */
function releaseLock() {
  try { if (readFileSync(LOCK_FILE, 'utf8').split(' ')[0] === String(process.pid)) unlinkSync(LOCK_FILE) } catch { /* already gone */ }
}

/**
 * Rewrite the whole document atomically under the lock: a fresh read of the file (never the cache), the
 * mutation, a per-process temp file created exclusively, renamed over the document. Returns false when nothing
 * could be written; `passive` writes (from read paths) back off for 30 s after a failure.
 */
function writeSidecar(mutate, { passive = false } = {}) {
  if (passive && Date.now() - passiveWriteFailedAt < PASSIVE_RETRY_MS) return false
  const failed = () => { if (passive) passiveWriteFailedAt = Date.now(); return false }
  if (!acquireLock()) return failed()
  try {
    let sessions = {}
    let parents = {}
    try {
      const parsed = parseSidecar(readFileSync(SOURCE_EXTRAS_FILE, 'utf8'))
      if (parsed === undefined) return failed() // unreadable content: never overwrite it
      sessions = { ...parsed.sessions }
      parents = { ...parsed.parents }
    } catch (error) {
      if (error?.code !== 'ENOENT') return failed()
    }
    mutate(sessions, parents)
    const tmp = `${SOURCE_EXTRAS_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, sessions, parents }, null, 2) + '\n', { flag: 'wx' })
      renameSync(tmp, SOURCE_EXTRAS_FILE)
    } catch {
      try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* nothing to clean */ }
      return failed()
    }
    let stamp = ''
    try { stamp = fileStamp() } catch { /* the cache is refreshed on the next read */ }
    extrasCache = { stamp, sessions, parents, ok: true }
    passiveWriteFailedAt = 0
    return true
  } finally { releaseLock() }
}

/** Record the members a plugin wants to keep for one message it is about to append (or hand to the core). */
export function recordSourceExtras(sessionId, messageId, extras) {
  if (!isSafeKey(sessionId) || !isSafeKey(messageId)) return false
  if (!extras || typeof extras !== 'object' || Array.isArray(extras) || Object.keys(extras).length === 0) return false
  return writeSidecar(sessions => {
    const current = Object.hasOwn(sessions, sessionId) && sessions[sessionId] && typeof sessions[sessionId] === 'object' ? sessions[sessionId] : {}
    const previous = Object.hasOwn(current, messageId) && current[messageId] && typeof current[messageId] === 'object' ? current[messageId] : {}
    sessions[sessionId] = { ...current, [messageId]: { ...previous, ...extras } }
  })
}

/**
 * Remember that `childId` was forked from `parentId` (idempotent). A child has one parent: an existing link to a
 * different session is kept, not overwritten.
 */
export function recordParentLink(childId, parentId, options = {}) {
  if (!isSafeKey(childId) || !isSafeKey(parentId) || childId === parentId) return false
  if (loadSidecar().ok && Object.hasOwn(extrasCache.parents, childId)) return true
  return writeSidecar((_sessions, parents) => { if (!Object.hasOwn(parents, childId)) parents[childId] = parentId }, { passive: options.passive === true })
}

/**
 * A fork made by a suite plugin: the parent link is recorded so the child's reads find the parent's (whole
 * lineage's) members. Nothing is copied — the lookup walks the lineage, and copies would only grow the file.
 */
export function adoptSourceExtras(childId, parentId) {
  return recordParentLink(childId, parentId)
}
