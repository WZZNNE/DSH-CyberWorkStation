/**
 * JSON-file memory store: $DSH_HOME/memory/memory.json holds the items, vectors.json the
 * optional embedding vectors (keyed by item id, tagged with the embedding model).
 * Writes are atomic (temp file + rename). Small by design: a few thousand short items.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

export const KINDS = ['summary', 'fact', 'note']
export const SCOPES = ['workspace', 'global']
export const SOURCES = ['compaction', 'extract', 'tool', 'user', 'import']
export const MAX_TEXT = 4000
/** Compaction summaries keep the core's whole 8-section checkpoint (the tail sections are the actionable ones). */
export const MAX_SUMMARY_TEXT = 20000
export const STORE_VERSION = 1

const newId = () => 'm_' + randomBytes(5).toString('hex')
const clampText = (t, max = MAX_TEXT) => String(t ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max)
const capFor = kind => (kind === 'summary' ? MAX_SUMMARY_TEXT : MAX_TEXT)

const readJsonFile = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))

function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, file)
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* nothing to clean */ }
    if (error && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
      const locked = new Error(`memory.json cannot be replaced right now (${error.code}); write refused so the stored memory is not overwritten`)
      locked.code = 'MEMORY_STORE_LOCKED'
      throw locked
    }
    throw error
  }
}

/** Normalise one stored / imported item; returns null when it cannot be a memory item. */
export function normalizeItem(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'note'
  const text = clampText(raw.text, capFor(kind))
  if (text.length === 0) return null
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : now
  return {
    id: typeof raw.id === 'string' && /^m_[0-9a-f]{6,16}$/.test(raw.id) ? raw.id : newId(),
    kind,
    text,
    // a workspace item without a directory would be visible nowhere: it becomes global
    scope: raw.scope === 'workspace' && typeof raw.cwd === 'string' && raw.cwd ? 'workspace' : raw.scope === 'global' ? 'global' : (typeof raw.cwd === 'string' && raw.cwd ? 'workspace' : 'global'),
    cwd: typeof raw.cwd === 'string' ? raw.cwd.slice(0, 500) : '',
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId.slice(0, 120) : '',
    source: SOURCES.includes(raw.source) ? raw.source : 'user',
    pinned: raw.pinned === true,
    createdAt,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt,
    meta: raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : {},
  }
}

export class MemoryStore {
  /** @param {string} dir directory holding memory.json / vectors.json */
  constructor(dir) {
    this.dir = dir
    this.file = join(dir, 'memory.json')
    this.vectorFile = join(dir, 'vectors.json')
    this.items = []
    /** Per-session extraction watermark: { lastSeq, userTurns } */
    this.watermarks = {}
    this.vectors = { model: '', byId: {} }
    this.loadError = null
    this.lastSavedAt = 0
    /** mtime of memory.json as of the last load / save; an external write in between is merged before the next save. */
    this.lastSeenMtime = 0
    /** Ids removed in memory since the last save: a merge of an external write must not resurrect them. */
    this.removedSinceSave = new Set()
    /** Ids added / updated by the last save-time merge (the plugin embeds them). */
    this.mergedIds = []
    /** 'parse' = the file exists but is not a valid store document (moved aside on save); 'read' = transient I/O error. */
    this.loadErrorKind = null
    /** Bumps on every mutation / reload; recall caches its BM25 index by it. */
    this.version = 0
    this.load()
  }

  /**
   * (Re)load memory.json. The file is parsed into locals first: an unparsable file (a torn external write, a hand
   * edit) leaves the in-memory store untouched and only sets `loadError`; `save()` then moves the bad file aside
   * instead of overwriting it. Returns true when the file was applied.
   */
  load() {
    let items = []
    let watermarks = {}
    try {
      if (existsSync(this.file)) {
        let raw = readJsonFile(this.file)
        if (Array.isArray(raw)) raw = { items: raw }
        if (!raw || typeof raw !== 'object' || (raw.items !== undefined && !Array.isArray(raw.items))) throw new Error('memory.json is not a { items: [...] } document')
        const seen = new Set()
        for (const r of raw.items ?? []) {
          const item = normalizeItem(r)
          if (item && !seen.has(item.id)) { seen.add(item.id); items.push(item) }
        }
        if (raw.watermarks && typeof raw.watermarks === 'object') watermarks = raw.watermarks
      }
    } catch (error) {
      this.loadError = String(error?.message ?? error)
      this.loadErrorKind = error instanceof SyntaxError || /not a \{ items/.test(this.loadError) ? 'parse' : 'read'
      this.version++
      return false
    }
    this.items = items
    this.watermarks = watermarks
    this.loadError = null
    this.loadErrorKind = null
    this.removedSinceSave.clear()
    this.version++
    try { this.lastSeenMtime = existsSync(this.file) ? statSync(this.file).mtimeMs : 0 } catch { this.lastSeenMtime = 0 }
    try {
      if (existsSync(this.vectorFile)) {
        const raw = JSON.parse(readFileSync(this.vectorFile, 'utf8'))
        this.vectors = { model: typeof raw?.model === 'string' ? raw.model : '', byId: raw?.byId && typeof raw.byId === 'object' ? raw.byId : {} }
      }
    } catch { this.vectors = { model: '', byId: {} } }
    return true
  }

  /**
   * Write the store. The decision is taken at save time from the file on disk, never from a stale load result:
   *  - the file parses and was written by someone else since our last load / save (or we never read it successfully)
   *    → its items are merged first (newer by id wins, unknown ids added, ids deleted in memory stay deleted);
   *  - the file exists but is not a valid store document → it is moved aside as `memory.json.corrupt-<stamp>`;
   *  - the file exists but cannot be read (lock, permission) → the write is REFUSED (throws) so nothing is lost.
   */
  save() {
    this.mergedIds = []
    if (existsSync(this.file)) {
      let raw
      let problem = null
      try { raw = readJsonFile(this.file); if (Array.isArray(raw)) raw = { items: raw } } catch (error) { problem = error }
      // a rename-replace in flight between existsSync and the read: nothing to merge, nothing to refuse
      if (problem && problem.code === 'ENOENT') { problem = null; raw = { items: [] } }
      if (problem === null && (!raw || typeof raw !== 'object' || (raw.items !== undefined && !Array.isArray(raw.items)))) problem = new SyntaxError('memory.json is not a { items: [...] } document')
      if (problem instanceof SyntaxError) {
        try { renameSync(this.file, `${this.file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`) } catch { /* the atomic write below still replaces it */ }
      } else if (problem !== null) {
        const err = new Error(`memory.json cannot be read right now (${problem.code ?? problem.message}); write refused so the stored memory is not overwritten`)
        err.code = 'MEMORY_STORE_LOCKED'
        throw err
      } else {
        let cur = 0
        try { cur = statSync(this.file).mtimeMs } catch { cur = 0 }
        if (cur !== this.lastSeenMtime) {
          // ids removed in memory since the last save are tombstoned: the external copy must not bring them back
          const before = new Map(this.items.map(i => [i.id, i.updatedAt]))
          this.importJson({ items: (raw.items ?? []).filter(r => !(r && typeof r === 'object' && this.removedSinceSave.has(r.id))) })
          this.mergedIds = this.items.filter(i => before.get(i.id) !== i.updatedAt).map(i => i.id)
          if (this.mergedIds.length) this.mergedExternal = (this.mergedExternal ?? 0) + 1
        }
      }
    }
    writeAtomic(this.file, JSON.stringify({ version: STORE_VERSION, savedAt: Date.now(), watermarks: this.watermarks, items: this.items }, null, 1))
    this.loadError = null
    this.loadErrorKind = null
    try { this.lastSavedAt = statSync(this.file).mtimeMs } catch { this.lastSavedAt = Date.now() }
    this.lastSeenMtime = this.lastSavedAt
    this.removedSinceSave.clear()
  }

  saveVectors() {
    writeAtomic(this.vectorFile, JSON.stringify(this.vectors))
  }

  /** Drop every stored vector (model changed / embeddings disabled). */
  resetVectors(model = '') {
    this.vectors = { model, byId: {} }
    try { if (model === '' && existsSync(this.vectorFile)) unlinkSync(this.vectorFile) } catch { /* keep file */ }
    if (model !== '') this.saveVectors()
  }

  get(id) { return this.items.find(i => i.id === id) }

  /** Add one item; returns the stored item. */
  add(fields) {
    const item = normalizeItem({ ...fields, id: undefined })
    if (!item) throw new Error('memory item text must not be empty')
    this.items.push(item)
    this.version++
    return item
  }

  update(id, patch) {
    const item = this.get(id)
    if (!item) return null
    // validate the whole patch before touching the item
    const nextKind = KINDS.includes(patch.kind) ? patch.kind : item.kind
    const nextText = typeof patch.text === 'string' ? clampText(patch.text, capFor(nextKind)) : clampText(item.text, capFor(nextKind))
    if (nextText.length === 0) throw new Error('memory item text must not be empty')
    const nextCwd = typeof patch.cwd === 'string' ? patch.cwd.slice(0, 500) : item.cwd
    const nextScope = SCOPES.includes(patch.scope) ? patch.scope : item.scope
    if (nextScope === 'workspace' && !nextCwd) throw new Error('workspace scope needs a cwd')
    if (nextText !== item.text) { item.text = nextText; delete this.vectors.byId[id] }
    if (typeof patch.pinned === 'boolean') item.pinned = patch.pinned
    item.cwd = nextCwd
    item.scope = nextScope
    item.kind = nextKind
    item.updatedAt = Date.now()
    this.version++
    return item
  }

  remove(id) {
    const idx = this.items.findIndex(i => i.id === id)
    if (idx < 0) return false
    this.items.splice(idx, 1)
    delete this.vectors.byId[id]
    this.removedSinceSave.add(id)
    this.version++
    return true
  }

  /** Replace the stored summary of one session (a newer compaction consolidates the earlier one); pinned summaries are kept. */
  replaceSessionSummary(sessionId, fields) {
    for (const old of this.items.filter(i => i.kind === 'summary' && i.sessionId === sessionId && !i.pinned)) this.remove(old.id)
    return this.add({ ...fields, kind: 'summary', sessionId })
  }

  /** Items visible from a workspace (global + that cwd); `cwd` undefined lists everything. */
  list({ cwd, kind, q, limit } = {}) {
    let out = this.items
    if (kind && KINDS.includes(kind)) out = out.filter(i => i.kind === kind)
    if (cwd !== undefined) {
      const norm = p => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      out = out.filter(i => i.scope === 'global' || (i.cwd && norm(i.cwd) === norm(cwd)))
    }
    if (q) { const needle = q.toLowerCase(); out = out.filter(i => i.text.toLowerCase().includes(needle)) }
    out = [...out].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
    return Number.isFinite(limit) ? out.slice(0, limit) : out
  }

  /** Keep the store bounded: drop the oldest unpinned items beyond `maxItems` (summaries first, then facts/notes). */
  prune(maxItems) {
    if (this.items.length <= maxItems) return 0
    const order = { summary: 0, fact: 1, note: 2 }
    const victims = this.items.filter(i => !i.pinned).sort((a, b) => order[a.kind] - order[b.kind] || a.updatedAt - b.updatedAt)
    let removed = 0
    for (const v of victims) {
      if (this.items.length <= maxItems) break
      if (this.remove(v.id)) removed++
    }
    return removed
  }

  stats() {
    const byKind = { summary: 0, fact: 0, note: 0 }
    let pinned = 0
    for (const i of this.items) { byKind[i.kind] = (byKind[i.kind] ?? 0) + 1; if (i.pinned) pinned++ }
    return { total: this.items.length, byKind, pinned, vectors: Object.keys(this.vectors.byId).length, vectorModel: this.vectors.model, file: this.file, loadError: this.loadError }
  }

  exportJson() {
    return { version: STORE_VERSION, exportedAt: Date.now(), items: this.items }
  }

  /** Merge imported items (by id; an existing id is updated only when the import is newer). Returns counts. */
  importJson(raw) {
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null
    if (list === null) throw new Error('import expects { items: [...] } or an array')
    let added = 0
    let updated = 0
    let skipped = 0
    for (const r of list) {
      const item = normalizeItem(r)
      if (!item) { skipped++; continue }
      item.source = SOURCES.includes(r?.source) ? r.source : 'import'
      const cur = this.get(item.id)
      if (!cur) { this.items.push(item); added++ }
      else if (item.updatedAt > cur.updatedAt) { Object.assign(cur, item); delete this.vectors.byId[item.id]; updated++ }
      else skipped++
    }
    this.version++
    return { added, updated, skipped }
  }
}
