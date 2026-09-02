/**
 * Turning the harness's own chat history into what the pet knows about its owner.
 *
 * Pure: the host hands over `{ header, events }` inspections (read through
 * `ctx.sessionPersistence`), this module keeps only what the user themselves typed — never the
 * assistant's words, never tool output — and folds it into one digest the pet's model summarises.
 * The result is stored on the pet as an editable block, so the owner can read, correct or delete
 * everything the pet believes about them.
 */

/** Text of a content array/blocks value, mirroring the session vocabulary. */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('')
}

/** Was this `user/message` typed by the person (not injected by a plugin or a compaction)? */
export function isHumanMessage(event) {
  return event?.type === 'user/message' && event.data?.source?.kind === 'user'
}

/** One session → the lines its owner typed, newest last. */
export function userLines(inspection, { maxPerSession = 40, maxChars = 600 } = {}) {
  const events = Array.isArray(inspection?.events) ? inspection.events : []
  const out = []
  for (const event of events) {
    if (!isHumanMessage(event)) continue
    const text = textOf(event.data?.content).trim()
    if (text.length === 0) continue
    out.push(text.length > maxChars ? text.slice(0, maxChars) + '…' : text)
  }
  return out.slice(-maxPerSession)
}

/**
 * Newest sessions first, so a budget-limited digest keeps the recent ones.
 * `SessionHeader.createdAt` is epoch milliseconds (core/packages/core/session/src/types.ts), not a
 * date string — a string is tolerated only because test fixtures and future backends may use one.
 */
export function startedAt(header) {
  const raw = header?.createdAt
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const parsed = Date.parse(String(raw ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}
export function orderSessions(headers) {
  return [...(Array.isArray(headers) ? headers : [])].sort((a, b) => startedAt(b) - startedAt(a))
}

/** The session's title lives in the log (`session/title`, last one wins), never on the header. */
export function titleOf(inspection, header) {
  const events = Array.isArray(inspection?.events) ? inspection.events : []
  for (let i = events.length - 1; i >= 0; i--) {
    const title = events[i]?.type === 'session/title' ? events[i]?.data?.title : undefined
    if (typeof title === 'string' && title.trim().length > 0) return title.trim()
  }
  const cwd = String(header?.cwd ?? '')
  if (cwd) return cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return String(header?.id ?? '')
}

/**
 * Fold inspections into one prompt-sized digest.
 * `sessions` is `[{ header, inspection }]`, already ordered.
 */
export function buildDigest(sessions, { maxChars = 12000, maxPerSession = 30 } = {}) {
  const parts = []
  let used = 0
  let read = 0
  for (const entry of sessions ?? []) {
    const lines = userLines(entry.inspection, { maxPerSession })
    if (lines.length === 0) continue
    const title = titleOf(entry.inspection, entry.header).slice(0, 80)
    const cwd = String(entry.header?.cwd ?? '').slice(0, 120)
    const started = startedAt(entry.header)
    const when = started > 0 ? new Date(started).toISOString().slice(0, 10) : ''
    const block = `## ${when} ${title}${cwd ? ` (${cwd})` : ''}\n` + lines.map(l => '- ' + l.replace(/\s+/g, ' ')).join('\n')
    if (used + block.length > maxChars) break
    parts.push(block)
    used += block.length
    read += 1
  }
  return { text: parts.join('\n\n'), sessionsRead: read, chars: used }
}

export const PROFILE_INSTRUCTION = [
  '下面是主人在这台机器上跟 AI 助手说过的话(只有他自己打的字,没有助手的回复)。',
  '请写一份「主人画像」,给桌宠自己看,要求:',
  '1) 只写你能从这些话里看出来的:他在做什么项目、常用什么技术栈、习惯怎么说话(语气/语言/称呼)、在意什么、什么时候容易烦躁;',
  '2) 不要编造年龄、性别、住址、职业头衔这类没证据的东西,没看出来就不写;',
  '3) 用中文,分条,总共不超过 300 字;',
  '4) 不要写成给用户看的报告,写成你自己的记事本(“他……”)。',
].join('\n')

/** The two messages the profile refresh sends to the pet's own model. */
export function profileMessages(digest) {
  return [{ role: 'user', text: `${PROFILE_INSTRUCTION}\n\n---\n${digest.text}` }]
}
