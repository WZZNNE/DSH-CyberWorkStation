/**
 * Display-layer overrides: what the browser shows for a message without touching the
 * session log or the model's context. Keyed by session id and immutable event seq;
 * original text is retained for inspection and legacy pure-helper compatibility. Pure: no I/O.
 */

export const MAX_TEXT = 20000
export const MAX_SESSIONS = 200
export const MAX_PER_SESSION = 500

const clamp = t => String(t ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_TEXT)

/** Normalise the stored document (`$DSH_HOME/chat-edits.json`). */
export function normalizeDoc(raw) {
  const doc = { version: 1, sessions: {} }
  const sessions = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.sessions : null
  if (!sessions || typeof sessions !== 'object') return doc
  const bySession = Object.entries(sessions)
  // A hand-edited or restored file can hold any number of sessions: the cap applies on load too,
  // keeping the most recently touched.
  // A reduce, not a spread: a hand-edited file with 100k entries in one session would blow the
  // argument limit, and the bare catch upstream would then throw the whole store away.
  const touchedAt = entries => {
    let latest = 0
    for (const entry of Object.values(entries ?? {})) { const at = Number(entry?.at) || 0; if (at > latest) latest = at }
    return latest
  }
  const ordered = bySession.length > MAX_SESSIONS
    ? [...bySession].sort((a, b) => touchedAt(b[1]) - touchedAt(a[1])).slice(0, MAX_SESSIONS)
    : bySession
  for (const [sessionId, entries] of ordered) {
    if (typeof sessionId !== 'string' || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    const kept = {}
    let n = 0
    for (const [seq, entry] of Object.entries(entries)) {
      if (!/^\d{1,9}$/.test(seq) || !entry || typeof entry !== 'object') continue
      const original = clamp(entry.original)
      if (original.length === 0) continue
      const hidden = entry.hidden === true
      const collapsed = entry.collapsed === true
      const text = typeof entry.text === 'string' ? clamp(entry.text) : ''
      if (!hidden && !collapsed && text.length === 0) continue
      kept[seq] = {
        original,
        ...(hidden ? { hidden: true } : {}),
        ...(collapsed ? { collapsed: true } : {}),
        ...(text.length > 0 ? { text } : {}),
        role: typeof entry.role === 'string' ? entry.role.slice(0, 20) : '',
        ...(Number.isSafeInteger(entry.baseEditSeq) ? { baseEditSeq: entry.baseEditSeq } : {}),
        at: Number.isFinite(entry.at) ? entry.at : Date.now(),
      }
      if (++n >= MAX_PER_SESSION) break
    }
    if (Object.keys(kept).length > 0) doc.sessions[sessionId] = kept
  }
  return doc
}

/** Set (or clear, when both text and hidden are absent) one override. */
export function setOverride(doc, sessionId, seq, { original, text, hidden, collapsed, role, baseEditSeq }) {
  const next = { version: 1, sessions: { ...doc.sessions } }
  const entries = { ...(next.sessions[sessionId] ?? {}) }
  const key = String(seq)
  const wantsText = typeof text === 'string' && text.trim().length > 0
  if (hidden !== true && collapsed !== true && !wantsText) delete entries[key]
  else {
    if (typeof original !== 'string' || original.trim().length === 0) throw new Error('an override needs the original text as its anchor')
    if (Object.keys(entries).length >= MAX_PER_SESSION && entries[key] === undefined) throw new Error(`at most ${MAX_PER_SESSION} display overrides per session`)
    entries[key] = {
      original: clamp(original),
      // Hidden, collapsed and rewritten are independent: a message can be collapsed and rewritten,
      // and clearing one of them must not silently clear the others.
      ...(hidden === true ? { hidden: true } : {}),
      ...(collapsed === true ? { collapsed: true } : {}),
      ...(wantsText ? { text: clamp(text) } : {}),
      role: typeof role === 'string' ? role.slice(0, 20) : '',
      ...(Number.isSafeInteger(baseEditSeq) ? { baseEditSeq } : {}),
      at: Date.now(),
    }
  }
  if (Object.keys(entries).length === 0) delete next.sessions[sessionId]
  else next.sessions[sessionId] = entries
  // The store is rewritten whole on every change, so it cannot be allowed to grow without end:
  // once there are more sessions than the cap, the least recently touched ones are dropped.
  const ids = Object.keys(next.sessions)
  if (ids.length > MAX_SESSIONS) {
    const touched = id => {
      let latest = 0
      for (const entry of Object.values(next.sessions[id])) { const at = Number(entry?.at) || 0; if (at > latest) latest = at }
      return latest
    }
    for (const id of ids.sort((x, y) => touched(x) - touched(y)).slice(0, ids.length - MAX_SESSIONS)) {
      if (id !== sessionId) delete next.sessions[id]
    }
  }
  return next
}

/** Drop every override of one session (or of one seq). */
export function clearOverrides(doc, sessionId, seq) {
  const next = { version: 1, sessions: { ...doc.sessions } }
  if (seq === undefined) delete next.sessions[sessionId]
  else if (next.sessions[sessionId]) {
    const entries = { ...next.sessions[sessionId] }
    delete entries[String(seq)]
    if (Object.keys(entries).length === 0) delete next.sessions[sessionId]
    else next.sessions[sessionId] = entries
  }
  return next
}

/**
 * The browser-side payload: one entry per override, anchored on the original text.
 * `original` is what the DOM currently shows; `text` replaces it, `hidden` removes the row.
 */
export function overridesFor(doc, sessionId) {
  const entries = doc.sessions?.[sessionId] ?? {}
  return Object.entries(entries).map(([seq, e]) => ({
    seq: Number(seq),
    role: e.role ?? '',
    original: e.original,
    ...(Number.isSafeInteger(e.baseEditSeq) ? { baseEditSeq: e.baseEditSeq } : {}),
    // Only the switches that are actually set: the browser reads `text` as "there is a rewrite",
    // so sending an undefined one would make a collapsed message render as empty.
    ...(e.hidden === true ? { hidden: true } : {}),
    ...(e.collapsed === true ? { collapsed: true } : {}),
    ...(typeof e.text === 'string' && e.text.length > 0 ? { text: e.text } : {}),
  }))
}

/**
 * Apply the display overrides to one rendered text (the browser calls this per bubble).
 * Exact whole-text match first, then a trimmed match; returns `null` when the bubble is hidden.
 * @returns {{ text: string, seq: number } | { hidden: true, seq: number } | undefined}
 */
export function applyOverride(overrides, renderedText) {
  const raw = String(renderedText ?? '')
  const trimmed = raw.trim()
  for (const o of overrides) {
    const original = o.original
    if (original === raw || original.trim() === trimmed) {
      if (o.hidden === true) return { hidden: true, seq: o.seq }
      // A collapsed message with no rewrite keeps its own words: the folding is done by the page.
      return { seq: o.seq, ...(o.collapsed === true ? { collapsed: true } : {}), ...(typeof o.text === 'string' && o.text.length > 0 ? { text: o.text } : {}) }
    }
  }
  return undefined
}
