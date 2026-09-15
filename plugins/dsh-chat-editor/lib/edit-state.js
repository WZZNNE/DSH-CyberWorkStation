import { EDIT_PLUGIN, EDIT_PREFIX_ASSISTANT, messageList, messageText, roleOf, turnIndex } from './view.js'

const surfaceType = e => ['user/message', 'assistant/message', 'tool/result'].includes(e.type)
const isEdit = e => e.type === 'user/message' && e.data?.source?.kind === 'plugin' && e.data.source.plugin === EDIT_PLUGIN && e.surfaceOp?.op === 'replace'

/** Follow replacements in surface order. A seq is a log identity, not a surface position. */
export function editState(events) {
  const nodes = []
  const rootsByNode = new Map()
  const records = new Map()
  const synthetic = new Map()
  for (const e of events) {
    if (!surfaceType(e)) continue
    const op = e.surfaceOp
    let roots = new Set()
    if (op === 'append') nodes.push(e.seq)
    else if (op?.op === 'replace') {
      const first = nodes.indexOf(op.startSeq ?? op.start), last = nodes.indexOf(op.endSeq ?? op.end)
      if (first < 0 || last < first) continue
      for (const seq of nodes.slice(first, last + 1)) for (const root of rootsByNode.get(seq) ?? []) roots.add(root)
      nodes.splice(first, last - first + 1, e.seq)
    } else continue
    if (isEdit(e)) {
      synthetic.set(e.seq, roots)
      for (const root of roots) {
        const previous = records.get(root)
        if (!previous) continue
        let text = messageText(e)
        if (previous.role === 'assistant' && text.startsWith(EDIT_PREFIX_ASSISTANT)) text = text.slice(EDIT_PREFIX_ASSISTANT.length)
        records.set(root, { ...previous, activeSeq: e.seq, revision: e.seq, text, hidden: e.data.source.editKind === 'delete' || previous.hidden })
      }
    } else {
      roots = new Set([e.seq])
      records.set(e.seq, { seq: e.seq, activeSeq: e.seq, revision: -1, text: messageText(e), original: messageText(e), role: roleOf(e), hidden: false })
    }
    rootsByNode.set(e.seq, roots)
  }
  const live = new Set(nodes)
  for (const record of records.values()) record.onSurface = live.has(record.activeSeq) && !record.hidden
  return { nodes, records, synthetic, rootsByNode }
}

/** Session-log edits are authoritative. Only an explicitly newer display-only write can override them. */
export function effectiveOverrides(events, sidecar = []) {
  const state = editState(events)
  const result = new Map(sidecar.map(o => [o.seq, { ...o }]))
  for (const record of state.records.values()) {
    if (record.revision < 0) continue
    const side = result.get(record.seq)
    const newer = side?.baseEditSeq === record.revision
    result.set(record.seq, {
      seq: record.seq, role: record.role, original: record.original,
      ...(side?.collapsed ? { collapsed: true } : {}),
      ...(record.hidden ? { hidden: true } : newer && side.hidden ? { hidden: true } : {}),
      ...(!record.hidden ? { text: newer && typeof side.text === 'string' ? side.text : record.text } : {}),
    })
  }
  // The core also renders replacement context nodes. Their original rows already carry the
  // effective text above; hide the duplicate correction/placeholder using its own exact seq.
  for (const [seq, roots] of state.synthetic) {
    if ([...roots].some(root => state.records.has(root))) result.set(seq, { seq, hidden: true, original: '', role: 'context' })
  }
  return [...result.values()]
}

export function editableMessages(events, options) {
  const state = editState(events)
  return messageList(events, { limit: Infinity }).filter(m => !state.synthetic.has(m.seq)).map(m => {
    const record = state.records.get(m.seq)
    return record ? { ...m, onSurface: record.onSurface, contextDeleted: record.hidden, activeSeq: record.activeSeq } : m
  }).slice(-(options?.limit ?? 500))
}

export function resolveEditTarget(events, seq) {
  const record = editState(events).records.get(seq)
  if (!record) throw Object.assign(new Error('no original message at this seq'), { status: 404 })
  if (record.hidden) throw Object.assign(new Error('this message was deleted; it cannot be edited or restored into context'), { status: 400 })
  if (!record.onSurface) throw Object.assign(new Error('this message is no longer on the current surface; only display changes are available'), { status: 409 })
  return record
}

export function activeTurnRange(events, seq) {
  const state = editState(events)
  const record = resolveEditTarget(events, seq)
  const { turnOf } = turnIndex(events)
  const turn = turnOf.get(seq)
  if (turn == null) return { start: record.activeSeq, end: record.activeSeq, count: 1 }
  const positions = state.nodes.flatMap((node, at) => [...state.rootsByNode.get(node) ?? []].some(root => turnOf.get(root) === turn) ? [at] : [])
  const first = positions[0], last = positions.at(-1)
  const selected = state.nodes.slice(first, last + 1)
  for (const node of selected) {
    const roots = [...state.rootsByNode.get(node) ?? []]
    if (!roots.length || roots.some(root => turnOf.get(root) !== turn)) throw Object.assign(new Error('the turn now spans another turn or a compaction checkpoint; reload and select individual messages'), { status: 409 })
  }
  return { start: selected[0], end: selected.at(-1), count: selected.length }
}
