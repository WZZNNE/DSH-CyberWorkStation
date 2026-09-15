/**
 * Pure helpers over a session event log: compaction history, the active checkpoint
 * on the model-visible surface, the checkpoint framing the core uses, and the small
 * projections the launcher page shows. No I/O, no core imports (testable standalone).
 */

/** Tags and preamble of the core's compaction checkpoint (dsh-compaction-basic/summarizer.ts). */
export const SUMMARY_OPEN_TAG = '<compacted-summary>'
export const SUMMARY_CLOSE_TAG = '</compacted-summary>'
export const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/** Provider / model stamped on the `compaction/summary` record of a human edit made through this plugin. */
export const EDIT_PROVIDER = 'dsh-memory-lite'
export const EDIT_MODEL = 'manual-edit'

export const textOf = content => (Array.isArray(content) ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') : typeof content === 'string' ? content : '')

/** A surface replacement carrying the core's checkpoint provenance (`{ kind: 'plugin', plugin: 'compact' }`). */
export function isCheckpointEvent(event) {
  if (!event || event.type !== 'user/message' || event.surfaceOp === undefined || event.surfaceOp === 'append') return false
  const source = event.data?.source
  return !!source && source.kind === 'plugin' && source.plugin === 'compact'
}

/**
 * Split a checkpoint message into its framing and the summary text between the tags.
 * @returns {{ summary: string, preamble: string, close: string, recognized: boolean }}
 */
export function parseFramedSummary(content) {
  const blocks = Array.isArray(content) ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string') : []
  if (blocks.length >= 3 && blocks[0].text.endsWith(SUMMARY_OPEN_TAG) && blocks[blocks.length - 1].text.trim() === SUMMARY_CLOSE_TAG) {
    return { summary: blocks.slice(1, -1).map(b => b.text).join('\n'), preamble: blocks[0].text, close: blocks[blocks.length - 1].text, recognized: true }
  }
  const joined = textOf(content)
  const open = joined.indexOf(SUMMARY_OPEN_TAG)
  const close = joined.lastIndexOf(SUMMARY_CLOSE_TAG)
  if (open >= 0 && close > open) {
    return { summary: joined.slice(open + SUMMARY_OPEN_TAG.length, close).replace(/^\n+|\n+$/g, ''), preamble: joined.slice(0, open + SUMMARY_OPEN_TAG.length), close: joined.slice(close), recognized: true }
  }
  return { summary: joined, preamble: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}`, close: SUMMARY_CLOSE_TAG, recognized: false }
}

/** Re-frame an edited summary with the framing of the checkpoint it replaces (or the core's default framing). */
export function frameSummary(summary, framing) {
  const preamble = framing && typeof framing.preamble === 'string' && framing.preamble.endsWith(SUMMARY_OPEN_TAG) ? framing.preamble : `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}`
  const close = framing && typeof framing.close === 'string' && framing.close.trim() === SUMMARY_CLOSE_TAG ? framing.close : SUMMARY_CLOSE_TAG
  return [{ type: 'text', text: preamble }, { type: 'text', text: summary }, { type: 'text', text: close }]
}

/**
 * Open-turn and compaction-lock state read backwards from the log tail, the way
 * compaction-basic does before it writes a bracket: an unmatched `compaction/start`
 * counts as active unless a later `session/end-seed` proves it belongs to an earlier lifecycle.
 */
export function inspectOpenState(events) {
  let openTurn = null
  let turnKnown = false
  let unmatchedStart
  let compactionKnown = false
  let latestEndSeed
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (latestEndSeed === undefined && e.type === 'session/end-seed') latestEndSeed = e.seq
    if (!compactionKnown) {
      if (e.type === 'compaction/start') { unmatchedStart = e; compactionKnown = true }
      else if (e.type === 'compaction/end') compactionKnown = true
    }
    if (!turnKnown) {
      if (e.type === 'turn/start') { openTurn = e.data?.turn ?? null; turnKnown = true }
      else if (e.type === 'turn/end') turnKnown = true
    }
    if (turnKnown && compactionKnown && latestEndSeed !== undefined) break
  }
  const activeCompaction = unmatchedStart !== undefined && !(latestEndSeed !== undefined && latestEndSeed > unmatchedStart.seq)
  return { openTurn, activeCompaction }
}

/**
 * Every compaction bracket in the log with its summary text, replacement checkpoint and
 * whether that checkpoint is still on the current surface (`nodes`).
 */
export function compactionHistory(events, nodes) {
  const onSurface = new Set(Array.isArray(nodes) ? nodes : [])
  const byId = new Map()
  const order = []
  let prunes = 0
  for (const e of events) {
    if (e.type === 'compaction/prune') { prunes++; continue }
    if (e.type === 'compaction/start') {
      const id = e.data?.compactionId
      if (typeof id !== 'string') continue
      const entry = { compactionId: id, startSeq: e.seq, startedAt: e.time, turn: e.data.turn ?? null, sourceCommandId: e.data.sourceCommandId, status: 'running' }
      byId.set(id, entry)
      order.push(entry)
      continue
    }
    if (e.type === 'compaction/summary') {
      const entry = byId.get(e.data?.compactionId)
      if (!entry) continue
      Object.assign(entry, {
        summarySeq: e.seq,
        summary: textOf(e.data.summary),
        provider: e.data.provider,
        model: e.data.model,
        shadowedRange: e.data.shadowedRange,
        shadowedCount: Array.isArray(e.data.shadowedSeqs) ? e.data.shadowedSeqs.length : 0,
        shadowedTokenCount: e.data.shadowedTokenCount,
        usage: e.data.usage,
      })
      continue
    }
    if (isCheckpointEvent(e)) {
      const entry = byId.get(e.data.source.compactionId)
      if (!entry) continue
      entry.checkpointSeq = e.seq
      entry.checkpointAt = e.time
      continue
    }
    if (e.type === 'compaction/end') {
      const entry = byId.get(e.data?.compactionId)
      if (!entry) continue
      entry.endSeq = e.seq
      entry.status = e.data.error === undefined ? 'complete' : 'error'
      if (e.data.error !== undefined) entry.error = String(e.data.error).slice(0, 500)
    }
  }
  for (const entry of order) {
    entry.active = entry.checkpointSeq !== undefined && onSurface.has(entry.checkpointSeq)
    entry.kind = entry.provider === EDIT_PROVIDER ? 'manual-edit' : entry.sourceCommandId !== undefined ? 'command' : 'auto'
  }
  return { entries: order, prunes }
}

/** Checkpoints currently on the surface, with the editable summary text, in surface order. */
export function activeCheckpoints(events, nodes) {
  const out = []
  for (const seq of nodes ?? []) {
    const e = events[seq]
    if (!e || e.seq !== seq || !isCheckpointEvent(e)) continue
    const parsed = parseFramedSummary(e.data.content)
    out.push({ seq, time: e.time, compactionId: e.data.source.compactionId, summary: parsed.summary, recognized: parsed.recognized, chars: parsed.summary.length })
  }
  return out
}

/**
 * Minimal surface fold (append / replace by position) for a full log when the core's
 * validating `foldSurface` is not resolvable. Mirrors dsh-session/surface.ts without the checks.
 */
export function foldSurfaceBasic(events) {
  const nodes = []
  for (const e of events) {
    if (!e || (e.type !== 'user/message' && e.type !== 'assistant/message' && e.type !== 'tool/result')) continue
    const op = e.surfaceOp
    if (op === 'append') { nodes.push(e.seq); continue }
    if (!op || typeof op !== 'object' || op.op !== 'replace') continue
    // 0.1.5 replace ops carry startSeq/endSeq; 0.1.1 logs still in memory carry start/end
    const startIdx = nodes.indexOf(op.startSeq ?? op.start)
    const endIdx = nodes.indexOf(op.endSeq ?? op.end)
    if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) continue
    nodes.splice(startIdx, endIdx - startIdx + 1, e.seq)
  }
  return nodes
}

/** Latest `session/title` text, if any. */
export function sessionTitle(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'session/title' && typeof e.data?.title === 'string') return e.data.title
  }
  return ''
}

/** Number of human prompts appended so far (user/message with source.kind === 'user' that entered the surface by append). */
export function userTurnCount(events) {
  let n = 0
  for (const e of events) if (e.type === 'user/message' && e.surfaceOp === 'append' && e.data?.source?.kind === 'user') n++
  return n
}

/** Time of the latest human prompt, or 0. */
export function lastUserTime(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') return e.time
  }
  return 0
}

/** First human prompt text (for a list preview when the session has no title). */
export function firstUserText(events, max = 120) {
  for (const e of events) {
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      const t = textOf(e.data.content).replace(/\s+/g, ' ').trim()
      if (t) return t.slice(0, max)
    }
  }
  return ''
}

/** Role composition of the current surface. */
export function surfaceComposition(events, nodes) {
  const out = { nodes: 0, user: 0, assistant: 0, tool: 0, context: 0, checkpoints: 0 }
  for (const seq of nodes ?? []) {
    const e = events[seq]
    if (!e) continue
    out.nodes++
    if (e.type === 'assistant/message') out.assistant++
    else if (e.type === 'tool/result') out.tool++
    else if (e.type === 'user/message') {
      if (isCheckpointEvent(e)) out.checkpoints++
      else if (e.data?.source?.kind === 'user') out.user++
      else out.context++
    }
  }
  return out
}

/** Ids of memory items this plugin already injected into a session (read back from its own plugin-sourced messages). */
export function injectedMemoryIds(events, pluginName) {
  const ids = new Set()
  for (const e of events) {
    if (e.type !== 'user/message') continue
    const s = e.data?.source
    if (s && s.kind === 'plugin' && s.plugin === pluginName && Array.isArray(s.memoryIds)) for (const id of s.memoryIds) if (typeof id === 'string') ids.add(id)
  }
  return ids
}

/** Plain-text transcript of human prompts and assistant replies after `fromSeq` (tool results excluded), newest last. */
export function transcriptAfter(events, fromSeq, maxChars) {
  const parts = []
  const lastSeq = events.at(-1)?.seq ?? fromSeq
  let chars = 0
  const bySeq = new Map(events.map(e => [e.seq, e]))
  for (const seq of foldSurfaceBasic(events)) {
    const e = bySeq.get(seq)
    if (!e) continue
    if (e.seq <= fromSeq) continue
    let line = ''
    const source = e.data?.source
    if (e.type === 'user/message' && (!source || source.kind === 'user')) line = 'User: ' + textOf(e.data.content)
    else if (isChatEdit(e) && source.editKind === 'edit' && ['user', 'assistant'].includes(source.editedRole)) {
      let text = textOf(e.data.content)
      if (source.editedRole === 'assistant') text = text.replace(/^\[The user corrected the assistant's earlier reply\. Treat the following as what the assistant said, and continue from it\.\]\n\n/, '')
      line = (source.editedRole === 'assistant' ? 'Assistant: ' : 'User: ') + text
    }
    else if (e.type === 'assistant/message') line = 'Assistant: ' + textOf(e.data.message?.content)
    if (!line.trim() || line.trim().endsWith(':')) continue
    line = line.replace(/\s+\n/g, '\n').trim()
    parts.push(line)
    chars += line.length + 2
  }
  let text = parts.join('\n\n')
  if (text.length > maxChars) text = '…' + text.slice(text.length - maxChars)
  return { text, lastSeq, chars }
}

export const isChatEdit = e => e?.type === 'user/message' && e.surfaceOp?.op === 'replace'
  && e.data?.source?.kind === 'plugin' && e.data.source.plugin === 'chat-editor'
export const replacementRevision = events => events.reduce((seq, e) => e.surfaceOp?.op === 'replace' ? Math.max(seq, e.seq) : seq, -1)
export const chatEditRevision = events => events.reduce((seq, e) => isChatEdit(e) ? Math.max(seq, e.seq) : seq, -1)
export const automaticItem = item => ['extract', 'compaction'].includes(item.source)
export const staleItem = item => automaticItem(item) && Number.isSafeInteger(item.meta?.staleAfterEdit)

/** Retain records (including pins), but withdraw automatic assertions derived before an edit. */
export function invalidateSource(store, sessionId, revision) {
  if (revision < 0) return false
  store.withdrawals ??= {}
  let changed = false
  for (const item of store.items) {
    if (item.sessionId !== sessionId || !automaticItem(item) || (item.meta?.sourceRevision ?? -1) >= revision) continue
    if ((item.meta?.staleAfterEdit ?? -1) < revision) {
      item.meta = { ...item.meta, staleAfterEdit: revision }
      item.updatedAt = Date.now()
      changed = true
    }
    const previous = store.withdrawals[item.id]
    if (!previous || (previous.sourceEditSeq ?? -1) < revision) {
      store.withdrawals[item.id] = { revision: Math.max(revision, (previous?.revision ?? -1) + 1), sourceEditSeq: revision, text: item.text.slice(0, 500) }
      changed = true
    }
  }
  const mark = store.watermarks[sessionId]
  if (mark && (mark.invalidatedAtSeq ?? -1) < revision) {
    store.watermarks[sessionId] = { lastSeq: -1, userTurns: 0, invalidatedAtSeq: revision, at: Date.now() }
    changed = true
  }
  if (changed) store.version++
  return changed
}

export function pendingInvalidations(events, items, pluginName, withdrawals = {}) {
  const seen = injectedMemoryIds(events, pluginName)
  const notified = new Set()
  const notifiedIds = new Set()
  for (const e of events) {
    const source = e.type === 'user/message' ? e.data?.source : null
    if (source?.kind !== 'plugin' || source.plugin !== pluginName) continue
    for (const entry of source.memoryInvalidations ?? []) { notified.add(entry.id + ':' + entry.revision); notifiedIds.add(entry.id) }
  }
  const records = new Map(Object.entries(withdrawals))
  for (const item of items) {
    if (records.has(item.id)) continue
    const legacy = staleItem(item) ? { revision: item.meta.staleAfterEdit, text: item.text } : item.meta?.withdrawnRecall
    if (legacy) records.set(item.id, { ...legacy, ...(item.source === 'user' ? { correctedText: item.text } : {}) })
  }
  for (const id of toolRecalledMemoryIds(events, pluginName, records)) seen.add(id)
  return [...records].flatMap(([id, record]) => {
    if (!seen.has(id) || notified.has(id + ':' + record.revision) || (record.confirmed && !notifiedIds.has(id))) return []
    return [{ id, ...record }]
  })
}

/** Read durable, identified recall results; never infer exposure from arbitrary chat text. */
export function toolRecalledMemoryIds(events, pluginName, records = new Map()) {
  const ids = new Set()
  const bySeq = new Map(events.map(event => [event.seq, event]))
  const calls = new Map(events.filter(event => event.type === 'tool/call').map(event => [event.data?.callId, event]))
  const validId = id => typeof id === 'string' && /^m_[0-9a-f]{6,16}$/.test(id)
  // The historical renderer had no escaped entry separator. Matching its header AND
  // the retained old assertion is a conservative migration, not an unambiguous codec.
  const legacy = content => {
    const text = textOf(content).replace(/\r\n?/g, '\n')
    const header = /^- \((m_[0-9a-f]{6,16}) · (?:fact|note|summary) · \d{4}-\d{2}-\d{2}(?: · pinned)?\) /gm
    for (const match of text.matchAll(header)) {
      const old = records.get(match[1])?.text?.replace(/\r\n?/g, '\n').slice(0, 500)
      if (old && text.slice(match.index + match[0].length).startsWith(old)) ids.add(match[1])
    }
  }
  for (const event of events) {
    if (event.type === 'tool/result') {
      const message = event.data?.message
      const block = message?.content?.[0]
      if (message?.source?.kind !== 'tool' || block?.type !== 'tool-result' || block.isError !== false) continue
      const callId = message.source.callId
      if (typeof callId !== 'string' || block.toolCallId !== callId) continue
      const call = (event.sourceEventSeqs ?? []).map(seq => bySeq.get(seq)).find(candidate =>
        candidate?.type === 'tool/call' && candidate.data?.name === 'memory_recall' && candidate.data.callId === callId && candidate.seq < event.seq)
      if (!call) continue
      const meta = event.data.meta
      if (meta?.plugin === pluginName && Array.isArray(meta.memoryIds)) {
        for (const id of meta.memoryIds) if (validId(id)) ids.add(id)
      } else legacy(block.content)
    } else if (event.type === 'tool/code-dispatch') {
      const data = event.data
      if (data?.name !== 'memory_recall' || data.isError !== false) continue
      const root = calls.get(data.rootCallId)
      const parent = calls.get(data.parentCallId)
      // Current core's code mode dispatch is owned by one top-level run_code call.
      // Logs from other transports or missing identities cannot prove exposure.
      if (!root || root !== parent || root.data?.name !== 'run_code' || root.seq >= event.seq) continue
      if (typeof data.subCallId !== 'string' || !data.subCallId.startsWith(data.parentCallId + ':code:')) continue
      legacy(data.content)
    }
  }
  return ids
}
