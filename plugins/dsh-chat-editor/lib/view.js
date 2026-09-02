/**
 * Pure projections over a session event log for the chat editor: the message list the
 * panel shows, identity lookups, fork boundaries and the framing used by context edits.
 * No I/O and no core imports, so the launcher and the maintainer tests can share it.
 */

/** Roles the panel distinguishes. */
export const ROLES = ['user', 'assistant', 'context', 'tool', 'checkpoint']

export const textOf = content => (Array.isArray(content)
  ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
  : typeof content === 'string' ? content : '')

const SURFACE_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])

/** A compaction checkpoint: a replacement user message carrying the core's `compact` provenance. */
export const isCheckpoint = e => e?.type === 'user/message' && e.surfaceOp !== undefined && e.surfaceOp !== 'append'
  && e.data?.source?.kind === 'plugin' && e.data.source.plugin === 'compact'

/**
 * Minimal surface fold (append / positional replace), mirroring dsh-session/surface.ts
 * without its validation — the log it folds was already validated when it was written.
 * @param {readonly object[]} events contiguous log
 * @returns {number[]} current surface node seqs, in model order
 */
export function foldNodes(events) {
  const nodes = []
  for (const e of events) {
    if (!e || !SURFACE_TYPES.has(e.type)) continue
    const op = e.surfaceOp
    if (op === 'append') { nodes.push(e.seq); continue }
    if (!op || typeof op !== 'object' || op.op !== 'replace') continue
    const si = nodes.indexOf(op.start)
    const ei = nodes.indexOf(op.end)
    if (si < 0 || ei < 0 || si > ei) continue
    nodes.splice(si, ei - si + 1, e.seq)
  }
  return nodes
}

/** Role of one surface event as the panel labels it. */
export function roleOf(event) {
  if (event.type === 'assistant/message') return 'assistant'
  if (event.type === 'tool/result') return 'tool'
  if (event.type !== 'user/message') return 'context'
  if (isCheckpoint(event)) return 'checkpoint'
  return event.data?.source?.kind === 'user' ? 'user' : 'context'
}

/** Text a message shows / the model reads. */
export function messageText(event) {
  if (event.type === 'user/message') return textOf(event.data?.content)
  if (event.type === 'assistant/message') return textOf(event.data?.message?.content)
  if (event.type === 'tool/result') {
    const block = event.data?.message?.content?.[0]
    return textOf(block?.content)
  }
  return ''
}

/** Stable message identity as the browser sees it (assistant slots pass this id). */
export function messageIdOf(event) {
  if (event.type === 'user/message') return typeof event.data?.id === 'string' ? event.data.id : ''
  if (event.type === 'assistant/message') return typeof event.data?.message?.id === 'string' ? event.data.message.id : ''
  return ''
}

/**
 * Turn / step bookkeeping and the fork boundary (the last `turn/end` strictly before a seq).
 * @returns {{ turnOf: Map<number, number|null>, forkBoundaryBefore: (seq: number) => number|undefined, lastTurnEnd: number|undefined, openTurn: number|null }}
 */
export function turnIndex(events) {
  const turnOf = new Map()
  const turnEnds = []
  let openTurn = null
  for (const e of events) {
    if (e.type === 'turn/start') openTurn = e.data?.turn ?? null
    else if (e.type === 'turn/end') { turnEnds.push(e.seq); openTurn = null }
    turnOf.set(e.seq, openTurn)
  }
  const forkBoundaryBefore = seq => {
    let found
    for (const end of turnEnds) { if (end < seq) found = end; else break }
    return found
  }
  return { turnOf, forkBoundaryBefore, lastTurnEnd: turnEnds.at(-1), openTurn }
}

/**
 * The message list for one session: every append-origin surface message plus the
 * replacement nodes that are currently live (a landed edit or compaction checkpoint).
 * `onSurface` says whether the model still sees it; `shadowedBy` names the replacement.
 */
export function messageList(events, { limit = 500 } = {}) {
  const nodes = new Set(foldNodes(events))
  const { turnOf, forkBoundaryBefore } = turnIndex(events)
  const out = []
  const replacedBy = new Map()
  for (const e of events) {
    if (!SURFACE_TYPES.has(e.type)) continue
    const op = e.surfaceOp
    if (op && typeof op === 'object' && op.op === 'replace') {
      const si = op.start
      const ei = op.end
      for (const prev of events) {
        if (prev.seq < si || prev.seq > ei || !SURFACE_TYPES.has(prev.type)) continue
        replacedBy.set(prev.seq, e.seq)
      }
    }
  }
  const surfaceIndex = new Map(foldNodes(events).map((seq, i) => [seq, i]))
  for (const e of events) {
    if (!SURFACE_TYPES.has(e.type)) continue
    const role = roleOf(e)
    const text = messageText(e)
    if (e.type === 'assistant/message' && (e.data?.message?.content ?? []).length === 0) continue
    // A replacement is anchored where its shadowed range sat, so an edited message stays in place
    // in the transcript instead of jumping to the end of the log.
    const op = e.surfaceOp
    const anchor = op && typeof op === 'object' && op.op === 'replace' ? op.start : e.seq
    out.push({
      seq: e.seq,
      anchor,
      ...(surfaceIndex.has(e.seq) ? { surfaceIndex: surfaceIndex.get(e.seq) } : {}),
      time: e.time,
      role,
      messageId: messageIdOf(e),
      appended: e.surfaceOp === 'append',
      onSurface: nodes.has(e.seq),
      ...(replacedBy.has(e.seq) ? { shadowedBy: replacedBy.get(e.seq) } : {}),
      turn: turnOf.get(e.seq) ?? null,
      forkBoundary: forkBoundaryBefore(e.seq),
      chars: text.length,
      text,
    })
  }
  out.sort((a, b) => a.anchor - b.anchor || a.seq - b.seq)
  return out.slice(-limit)
}

/** Locate one message by seq or by the browser-visible message id. */
export function findMessage(events, { seq, messageId }) {
  if (Number.isSafeInteger(seq)) {
    const e = events[seq]
    return e && e.seq === seq && SURFACE_TYPES.has(e.type) ? e : undefined
  }
  if (typeof messageId === 'string' && messageId.length > 0) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (SURFACE_TYPES.has(e.type) && messageIdOf(e) === messageId) return e
    }
  }
  return undefined
}

/** Framing of a context edit / deletion, so the model always knows the text is a human correction. */
export const EDIT_PLUGIN = 'chat-editor'
export const EDIT_PREFIX_USER = ''
export const EDIT_PREFIX_ASSISTANT = '[The user corrected the assistant\'s earlier reply. Treat the following as what the assistant said, and continue from it.]\n\n'
export const DELETED_TEXT = '[A message here was deleted by the user. Continue without it.]'
export const DELETED_RANGE_TEXT = '[{n} messages here were deleted by the user. Continue without them.]'

/**
 * Content blocks for the replacement node of a context edit.
 * A user message keeps the user's voice; an assistant message is re-framed as a correction
 * (the core forbids appending an `assistant/message` outside an open step, so the replacement
 * is a user-role node — see the plugin README).
 */
export function editedContent(role, text) {
  const prefix = role === 'assistant' ? EDIT_PREFIX_ASSISTANT : EDIT_PREFIX_USER
  return [{ type: 'text', text: prefix + text }]
}

/** Content blocks for a deletion placeholder. */
export function deletedContent(count = 1) {
  return [{ type: 'text', text: count > 1 ? DELETED_RANGE_TEXT.replace('{n}', String(count)) : DELETED_TEXT }]
}

/**
 * The inclusive surface range a "delete this turn" covers: from the message through the
 * last surface node of its turn, clipped to the current surface.
 */
export function turnRange(events, seq, nodes = foldNodes(events)) {
  const { turnOf } = turnIndex(events)
  const turn = turnOf.get(seq)
  if (turn === null || turn === undefined) return { start: seq, end: seq, count: 1 }
  const inTurn = nodes.filter(s => turnOf.get(s) === turn)
  if (inTurn.length === 0) return { start: seq, end: seq, count: 1 }
  const start = Math.min(...inTurn)
  const end = Math.max(...inTurn)
  return { start, end, count: inTurn.length }
}
