/** Conversation text in current surface order; replacement sequence numbers do not change a message's position. */
export function visibleConversationHistory(events, depth, includeNames = false) {
  const nodes = []
  const bySeq = new Map()
  for (const event of events) {
    bySeq.set(event.seq, event)
    if (!['user/message', 'assistant/message', 'tool/result'].includes(event.type)) continue
    if (event.surfaceOp === 'append') nodes.push(event.seq)
    else if (event.surfaceOp?.op === 'replace') {
      // 0.1.5 replace ops carry startSeq / endSeq; a 0.1.1 log still in memory carries start / end
      const start = nodes.indexOf(event.surfaceOp.startSeq ?? event.surfaceOp.start)
      const end = nodes.indexOf(event.surfaceOp.endSeq ?? event.surfaceOp.end)
      if (start >= 0 && end >= start) nodes.splice(start, end - start + 1, event.seq)
    }
  }
  const history = []
  for (const seq of nodes) {
    const event = bySeq.get(seq)
    const source = event.data?.source
    let role
    let content
    if (event.type === 'assistant/message') { role = 'Assistant'; content = event.data?.message?.content }
    else if (event.type === 'user/message' && (source?.kind === 'user' || source === undefined)) { role = 'User'; content = event.data?.content }
    else if (event.type === 'user/message' && source?.kind === 'plugin' && source.plugin === 'chat-editor' && source.editKind === 'edit' && ['user', 'assistant'].includes(source.editedRole)) {
      role = source.editedRole === 'assistant' ? 'Assistant' : 'User'
      content = event.data?.content
    } else continue
    let text = (Array.isArray(content) ? content : []).filter(b => b?.type === 'text').map(b => b.text).join('\n')
    // This exact prefix belongs to the chat-editor replacement protocol, not to the user's text.
    if (source?.plugin === 'chat-editor' && source.editedRole === 'assistant') text = text.replace(/^\[The user corrected the assistant's earlier reply\. Treat the following as what the assistant said, and continue from it\.\]\n\n/, '')
    if (text.trim()) history.push(includeNames ? `${role}: ${text}` : text)
  }
  return depth > 0 ? history.slice(-depth) : []
}
