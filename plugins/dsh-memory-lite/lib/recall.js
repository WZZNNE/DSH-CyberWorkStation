/**
 * Lexical recall for the memory store: a small Okapi BM25 (k1 = 1.2, b = 0.75) over
 * ASCII words and CJK character bigrams, with pin / workspace / recency boosts and an
 * optional cosine blend when item vectors are available. Pure: no I/O.
 */

const K1 = 1.2
const B = 0.75
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+/g
const WORD = /[a-z0-9_][a-z0-9_.+#-]*/g
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that', 'with', 'as', 'at', 'by', 'from', 'i', 'you', 'we', 'he', 'she', 'they', 'my', 'your', 'our', 'me', 'us', 'do', 'does', 'did', 'not', 'no', 'yes', 'please', 'can', 'could', 'would', 'should', 'will', 'just', 'so', 'if', 'then', 'than', 'but', 'about', 'into', 'how', 'what', 'which', 'who', 'when', 'where', 'why'])
/** CJK function characters: a bigram containing one of them carries almost no topical signal. */
const CJK_STOP = new Set('的了是在和就都也吗呢吧啊哦嗯与及或而之其把被让给对从向到为以于着过我你他她它您这那个们要会能可请帮')

/**
 * Tokenise text into lexical units: lowercase ASCII words (length ≥ 2, stop words removed)
 * and CJK character bigrams (a lone CJK character stays a unigram).
 * @param {string} text
 * @returns {string[]} tokens in order (duplicates kept so term frequencies can be counted)
 */
export function tokenize(text) {
  const out = []
  const s = String(text ?? '').normalize('NFKC').toLowerCase()
  for (const m of s.matchAll(WORD)) {
    const w = m[0].replace(/^[.+#-]+|[.+#-]+$/g, '')
    if (w.length >= 2 && !STOP_WORDS.has(w)) out.push(w)
  }
  for (const m of s.matchAll(CJK)) {
    const run = [...m[0]]
    if (run.length === 1) { if (!CJK_STOP.has(run[0])) out.push(run[0]); continue }
    for (let i = 0; i + 1 < run.length; i++) {
      if (CJK_STOP.has(run[i]) || CJK_STOP.has(run[i + 1])) continue
      out.push(run[i] + run[i + 1])
    }
  }
  return out
}

/** Build the BM25 index over items (`{ id, text }`). */
export function buildIndex(items) {
  const docs = []
  const df = new Map()
  let total = 0
  for (const item of items) {
    const tokens = tokenize(item.text)
    const tf = new Map()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    docs.push({ id: item.id, tf, len: tokens.length })
    total += tokens.length
  }
  return { docs, df, avgLen: docs.length ? total / docs.length : 0, N: docs.length }
}

/** BM25 score of one query (distinct tokens) against every indexed document. */
export function scoreAll(index, queryTokens) {
  const out = new Map()
  const terms = [...new Set(queryTokens)]
  for (const doc of index.docs) {
    let score = 0
    let matched = 0
    for (const t of terms) {
      const tf = doc.tf.get(t)
      if (!tf) continue
      matched++
      const df = index.df.get(t) ?? 0
      const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5))
      const denom = tf + K1 * (1 - B + B * (index.avgLen ? doc.len / index.avgLen : 1))
      score += idf * (tf * (K1 + 1)) / denom
    }
    if (matched > 0) out.set(doc.id, { score, matched })
  }
  return out
}

/** Cosine similarity of two equal-length numeric vectors (0 when either is empty or degenerate). */
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const normPath = p => (typeof p === 'string' ? p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '')

/** Whether an item is visible from a session working in `cwd`: global items everywhere, workspace items in their own cwd. */
export function visibleIn(item, cwd) {
  if (item.scope === 'global') return true
  const itemCwd = normPath(item.cwd)
  const here = normPath(cwd)
  return itemCwd !== '' && itemCwd === here
}

/**
 * Rank memory items for a query.
 * @param {Array<{id:string,text:string,pinned?:boolean,cwd?:string,scope?:string,createdAt?:number}>} items candidate items (already scope-filtered by the caller when needed)
 * @param {string} query
 * @param {{topK?:number,cwd?:string,now?:number,strict?:boolean,vectors?:Map<string,number[]>,queryVector?:number[]|null,index?:object}} opts
 *   strict: require ≥ 2 matched query tokens (or all tokens of a 1–2 token query) so a single common word does not surface memories;
 *   vectors/queryVector: optional cosine blend (0.5 lexical normalised + 0.5 cosine) — an item without a vector keeps its lexical score;
 *   index: a prebuilt BM25 index over a superset of `items` (cached by the caller); only `items` are ranked.
 * @returns {Array<{item:object,score:number,matched:number,cos:number}>}
 */
export function rank(items, query, opts = {}) {
  const topK = Math.max(1, opts.topK ?? 5)
  const now = opts.now ?? Date.now()
  const qTokens = [...new Set(tokenize(query))]
  const queryVector = Array.isArray(opts.queryVector) && opts.queryVector.length > 0 ? opts.queryVector : null
  if (qTokens.length === 0 && queryVector === null) return []
  const index = opts.index ?? buildIndex(items)
  const lexicalAll = qTokens.length > 0 ? scoreAll(index, qTokens) : new Map()
  const lexical = new Map()
  for (const item of items) { const hit = lexicalAll.get(item.id); if (hit) lexical.set(item.id, hit) }
  let maxLex = 0
  for (const v of lexical.values()) if (v.score > maxLex) maxLex = v.score
  const results = []
  for (const item of items) {
    const lex = lexical.get(item.id)
    const vec = queryVector && opts.vectors ? opts.vectors.get(item.id) : undefined
    const cos = vec ? cosine(queryVector, vec) : 0
    const matched = lex?.matched ?? 0
    const lexGate = opts.strict
      ? matched >= 2 || (matched >= 1 && qTokens.length <= 2)
      : matched >= 1
    const vecGate = cos >= (opts.strict ? 0.6 : 0.5)
    if (!lexGate && !vecGate) continue
    const lexNorm = lex && maxLex > 0 ? lex.score / maxLex : 0
    let score = vec ? 0.5 * lexNorm + 0.5 * Math.max(0, cos) : lexNorm
    if (item.pinned) score *= 1.25
    if (opts.cwd && normPath(item.cwd) === normPath(opts.cwd) && item.scope !== 'global') score *= 1.15
    const ageDays = Math.max(0, (now - (item.createdAt ?? now)) / 86400000)
    score *= 1 + 0.1 * Math.exp(-ageDays / 30)
    results.push({ item, score, matched, cos })
  }
  results.sort((a, b) => b.score - a.score || (b.item.createdAt ?? 0) - (a.item.createdAt ?? 0))
  return results.slice(0, topK)
}

/** Token-set Jaccard similarity, used to drop near-duplicate facts. */
export function jaccard(a, b) {
  const sa = new Set(tokenize(a))
  const sb = new Set(tokenize(b))
  if (sa.size === 0 || sb.size === 0) return a.trim() === b.trim() ? 1 : 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}
