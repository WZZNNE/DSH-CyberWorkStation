/**
 * Pure helpers for the SillyTavern-style "inject" mode: trigger detection,
 * result formatting under a character budget, config normalisation.
 *
 * Trigger semantics follow SillyTavern/Extension-WebSearch `index.js`:
 *  - messages starting with "." are ignored and "!" stops the search (both
 *    skipped here); dsh additionally skips "/" (slash-command style input);
 *  - backticks: fenced ``` blocks are removed first, then the first `…` span
 *    is the query;
 *  - trigger phrases: the query is the text AFTER the first matching phrase
 *    (`message.substring(idx + phrase.length)`), limited to `maxWords` words;
 *  - regex: the query is built from a `$N` template over the capture groups
 *    (`$0` = whole match, `$1`… groups), like ST's `rule.query`;
 *  - `always` (search every message) is a dsh-only extra — ST has no such
 *    option; the `maxWords` cap applies to phrase and `always` queries (ST caps
 *    phrase queries only); template macros {{query}} and {{text}}; budget in characters.
 */

export const DEFAULT_TEMPLATE = '[Web search results for "{{query}}" — use them to answer and cite URLs when relevant]\n{{text}}'

export const MODE_CHOICES = ['off', 'tool', 'inject', 'provider']

export const DEFAULT_CONFIG = {
  mode: 'off',                  // off | tool | inject | provider (the API's own search)
  provider: 'serper',           // serper | serpapi | tavily | brave | searxng | deepseek-official (the core's own provider)
  maxResults: 6,
  searxngUrl: '',
  triggers: { backticks: true, regex: '', regexQuery: '$1', phrases: [], always: false, maxWords: 10 },
  template: DEFAULT_TEMPLATE,
  budgetChars: 1500,
  visitLinks: 0,                // inject mode: number of top results whose page text is fetched
  visitChars: 1200,             // inject mode: per-page text budget when visiting links
  // tool mode: the same page visiting, for the model's own web_search call. Snippets from any
  // search API are one or two sentences; opening the top results is what makes a result set
  // answerable without a second tool round trip.
  toolVisit: { links: 0, chars: 2000 },
  // Optional local article extractor (dsh-extract, .local/searxng/extract): the plugin fetches
  // through its own guarded transport and posts only the HTML. Empty = built-in htmlToText.
  extractorUrl: '',
  blacklist: [],                // hostnames never visited
  cacheTtlSec: 300,
  // provider-native mode: OpenRouter searches server-side through the `:online` model suffix
  // (openrouter.ai/docs/features/web-search — any model, billed per search). Routes without such a
  // switch fall back to the model's own `web_search` tool served by the source above.
  providerNative: { autoVariant: true, fallbackToTool: true, anthropicNative: false, testModel: '' },
  // web_fetch: the page reader the shipped presets keep off; mounted here (public http(s) only)
  fetch: { enabled: true, timeoutMs: 30000, maxOutputChars: 200000, maxResponseBytes: 5000000, maxBodyChars: 100000 },
}

export const PROVIDER_CHOICES = ['serper', 'serpapi', 'tavily', 'brave', 'searxng', 'deepseek-official']
const LIMITS = { template: 4000, regex: 500, regexQuery: 200, phrase: 100, phrases: 50, blacklist: 200, searxngUrl: 500, extractorUrl: 500 }

const clampInt = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d }
const strArr = (v, max, each) => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(x => x.length > 0 && x.length <= each).slice(0, max) : [])
const validRegex = src => { try { new RegExp(src, 'i'); return true } catch { return false } }

/** Normalise a raw config object; invalid fields fall back to defaults, never throws. */
export function normalizeConfig(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const t = o.triggers && typeof o.triggers === 'object' ? o.triggers : {}
  const regex = typeof t.regex === 'string' && t.regex.length <= LIMITS.regex && validRegex(t.regex) ? t.regex : ''
  return {
    mode: MODE_CHOICES.includes(o.mode) ? o.mode : 'off',
    provider: PROVIDER_CHOICES.includes(o.provider) ? o.provider : 'serper',
    maxResults: clampInt(o.maxResults, 1, 20, 6),
    searxngUrl: typeof o.searxngUrl === 'string' ? o.searxngUrl.trim().slice(0, LIMITS.searxngUrl) : '',
    triggers: {
      backticks: t.backticks !== false,
      regex,
      regexQuery: typeof t.regexQuery === 'string' && t.regexQuery.trim().length > 0 ? t.regexQuery.trim().slice(0, LIMITS.regexQuery) : '$1',
      phrases: strArr(t.phrases, LIMITS.phrases, LIMITS.phrase),
      always: t.always === true,
      maxWords: clampInt(t.maxWords, 1, 100, 10),
    },
    template: typeof o.template === 'string' && o.template.includes('{{text}}') && o.template.length <= LIMITS.template ? o.template : DEFAULT_TEMPLATE,
    budgetChars: clampInt(o.budgetChars, 200, 50000, 1500),
    visitLinks: clampInt(o.visitLinks, 0, 5, 0),
    visitChars: clampInt(o.visitChars, 200, 20000, 1200),
    toolVisit: {
      links: clampInt(o.toolVisit && typeof o.toolVisit === 'object' ? o.toolVisit.links : undefined, 0, 5, 0),
      chars: clampInt(o.toolVisit && typeof o.toolVisit === 'object' ? o.toolVisit.chars : undefined, 200, 20000, 2000),
    },
    extractorUrl: typeof o.extractorUrl === 'string' ? o.extractorUrl.trim().slice(0, LIMITS.extractorUrl) : '',
    blacklist: strArr(o.blacklist, LIMITS.blacklist, 253).map(h => h.toLowerCase()),
    cacheTtlSec: clampInt(o.cacheTtlSec, 0, 86400, 300),
    providerNative: {
      autoVariant: (o.providerNative && typeof o.providerNative === 'object' ? o.providerNative.autoVariant : undefined) !== false,
      fallbackToTool: (o.providerNative && typeof o.providerNative === 'object' ? o.providerNative.fallbackToTool : undefined) !== false,
      // Anthropic models + the harness's tool set never get an answer from OpenRouter's web plugin
      // (measured 2026-09-02: 93 tools / 87 KB stalls, 60 tools / 69 KB answers); off unless opted in.
      anthropicNative: (o.providerNative && typeof o.providerNative === 'object' ? o.providerNative.anthropicNative : undefined) === true,
      // the model "Test search" uses in provider-native mode; empty = pick a cheap non-Anthropic one
      testModel: (o.providerNative && typeof o.providerNative === 'object' && typeof o.providerNative.testModel === 'string' ? o.providerNative.testModel : '').trim().slice(0, 120),
    },
    fetch: normalizeFetch(o.fetch),
  }
}

/** The web_fetch knobs; anything outside the documented ranges falls back to the default. */
function normalizeFetch(raw) {
  const f = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: f.enabled !== false,
    timeoutMs: clampInt(f.timeoutMs, 1000, 300000, 30000),
    maxOutputChars: clampInt(f.maxOutputChars, 1000, 2000000, 200000),
    maxResponseBytes: clampInt(f.maxResponseBytes, 10000, 50000000, 5000000),
    maxBodyChars: clampInt(f.maxBodyChars, 1000, 2000000, 100000),
  }
}

/** Problems a human should hear about before the config is saved (normalizeConfig silently drops them). */
export function validateConfig(raw) {
  const problems = []
  const o = raw && typeof raw === 'object' ? raw : {}
  const t = o.triggers && typeof o.triggers === 'object' ? o.triggers : {}
  if (typeof t.regex === 'string' && t.regex.length > 0 && !validRegex(t.regex)) problems.push('triggers.regex is not a valid regular expression')
  if (typeof t.regex === 'string' && t.regex.length > LIMITS.regex) problems.push(`triggers.regex longer than ${LIMITS.regex} characters`)

  if (typeof o.template === 'string' && o.template.length > 0 && !o.template.includes('{{text}}')) problems.push('template must contain {{text}}')
  if (typeof o.template === 'string' && o.template.length > LIMITS.template) problems.push(`template longer than ${LIMITS.template} characters`)
  if (o.provider !== undefined && !PROVIDER_CHOICES.includes(o.provider)) problems.push(`unknown provider "${String(o.provider)}"`)
  if (o.fetch !== undefined && (o.fetch === null || typeof o.fetch !== 'object')) problems.push('fetch must be an object')
  if (o.fetch && typeof o.fetch === 'object' && o.fetch.enabled !== undefined && typeof o.fetch.enabled !== 'boolean') problems.push('fetch.enabled must be true or false')
  if (o.mode !== undefined && o.mode !== 'off' && o.provider === 'searxng' && !(typeof o.searxngUrl === 'string' && o.searxngUrl.trim().length > 0)) problems.push('SearXNG needs an instance URL')
  if (o.toolVisit !== undefined && (o.toolVisit === null || typeof o.toolVisit !== 'object')) problems.push('toolVisit must be an object')
  if (typeof o.extractorUrl === 'string' && o.extractorUrl.trim().length > 0 && !/^https?:\/\//i.test(o.extractorUrl.trim())) problems.push('extractorUrl must start with http:// or https://')
  return problems
}

/** Trim a query to N words (CJK text has no spaces: cap by characters instead). */
export function limitWords(text, maxWords) {
  const t = String(text).trim()
  if (/[㐀-鿿]/.test(t)) return t.slice(0, Math.max(8, maxWords * 6))
  return t.split(/\s+/).slice(0, maxWords).join(' ')
}

/**
 * Decide whether this user text triggers a search and with which query.
 * @returns {{ query: string, by: 'backticks'|'regex'|'phrase'|'always' } | null}
 */
/**
 * The trigger pattern is the user's, and it runs on the agent's hot path. The scan is bounded, and
 * the host hands in a match computed under a real deadline (see regex-guard.js) — a source-level
 * "is this pattern dangerous" heuristic cannot tell `(\w+) *(\w+)` (safe) from `((a+))+b`
 * (exponential), so the bound is on time, not on shape. Called without one, the match runs inline,
 * which is what the pure tests do.
 */
export const TRIGGER_SCAN_CHARS = 2000

/**
 * The exact string a trigger is matched against: fenced code blocks removed (ST semantics),
 * whitespace collapsed, capped at the scan bound. `null` when the message is not a candidate at all.
 * Exported so the host hands the very same string to the worker that runs the user's regex —
 * matching a different string there would miss multi-line messages and, worse, run the pattern over
 * content the user deliberately fenced, whose capture would then be sent to a search provider.
 */
export function normalizeTriggerText(text) {
  const raw = String(text ?? '').trim()
  if (raw.length === 0 || raw.startsWith('.') || raw.startsWith('!') || raw.startsWith('/')) return null
  return raw.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TRIGGER_SCAN_CHARS)
}

export function decideTrigger(text, triggers, { regexMatch } = {}) {
  const t = normalizeTriggerText(text)
  if (t === null) return null
  if (triggers.backticks) {
    const m = /`([^`\n]{1,200})`/.exec(t)
    if (m && m[1].trim().length > 0) return { query: m[1].trim(), by: 'backticks' }
  }
  if (triggers.regex) {
    try {
      const m = regexMatch === undefined ? new RegExp(triggers.regex, 'i').exec(t) : regexMatch
      if (m) {
        // ST applies the word limit to phrase triggers only; a regex query template is used as built.
        const template = typeof triggers.regexQuery === 'string' && triggers.regexQuery.length > 0 ? triggers.regexQuery : '$1'
        const query = template.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '').trim()
        if (query.length > 0) return { query, by: 'regex' }
      }
    } catch { /* invalid regex is ignored */ }
  }
  const lower = t.toLowerCase()
  for (const phrase of triggers.phrases) {
    const idx = lower.indexOf(phrase.toLowerCase())
    if (idx >= 0) {
      const rest = t.slice(idx + phrase.length).trim()
      if (rest.length > 0) return { query: limitWords(rest, triggers.maxWords), by: 'phrase' }
    }
  }
  if (triggers.always) return { query: limitWords(t, triggers.maxWords), by: 'always' }
  return null
}

/** Render a seam result into the injected text block, honouring the budget. */
export function formatResults(query, result, { template = DEFAULT_TEMPLATE, budgetChars = 1500, pages = [] } = {}) {
  const lines = []
  if (result.content) lines.push(result.content.trim())
  result.sources.forEach((s, i) => {
    const title = s.title ?? s.url
    const meta = [s.snippet, s.publishedAt ? `(${s.publishedAt})` : ''].filter(Boolean).join(' ')
    lines.push(`${i + 1}. ${title} — ${meta}${meta ? ' ' : ''}${s.url}`)
  })
  for (const p of pages) if (p?.text) lines.push(`--- ${p.url}\n${p.text}`)
  let text = lines.join('\n')
  if (text.length > budgetChars) text = text.slice(0, budgetChars - 1) + '…'
  return template.split('{{query}}').join(query).split('{{text}}').join(text)
}

/** Merge query results fairly while preserving provider and local truncation. */
export function mergeSearchResults(queries, results, maxResults) {
  const seen = new Set()
  const sources = []
  const ranks = Math.max(0, ...results.map(r => r.sources.length))
  let droppedUnique = false
  for (let rank = 0; rank < ranks; rank++) {
    for (const result of results) {
      const source = result.sources[rank]
      if (!source || seen.has(source.url)) continue
      seen.add(source.url)
      if (sources.length < maxResults) sources.push(source)
      else droppedUnique = true
    }
  }
  const contents = results.map((r, i) => r.content
    ? (queries.length > 1 ? `### ${queries[i]}\n\n${r.content}` : r.content)
    : '').filter(Boolean)
  return {
    ...(contents.length ? { content: contents.join('\n\n') } : {}),
    sources,
    truncated: results.some(r => r.truncated) || droppedUnique,
  }
}

/** One URL-labelled article block, suitable for the canonical web_search value.content. */
export function formatPageText(pages = []) {
  const opened = pages.filter(p => p && typeof p.text === 'string' && p.text.trim().length > 0)
  if (opened.length === 0) return ''
  const blocks = opened.map((p, i) => {
    const head = [p.title, p.date ? `(${p.date})` : ''].filter(Boolean).join(' ')
    return `--- [${i + 1}] ${head ? head + '\n' : ''}${p.url}\n\n${p.text.trim()}`
  })
  return `Page text — the top ${opened.length} result${opened.length === 1 ? ' was' : 's were'} opened and read:\n\n${blocks.join('\n\n')}`
}

/** Human-readable tool text; optional pages support standalone formatting callers. */
export function formatToolText(result, { pages = [] } = {}) {
  const parts = []
  if (result.content) parts.push(result.content)
  if (result.sources.length > 0) {
    parts.push('Sources:\n' + result.sources.map(s => {
      const label = s.title ?? s.url
      const meta = [s.snippet, s.publishedAt ? `(${s.publishedAt})` : ''].filter(Boolean).join(' ')
      return `- [${label}](${s.url})${meta ? ' — ' + meta : ''}`
    }).join('\n'))
  } else if (!result.content) parts.push('No results found.')
  const pageText = formatPageText(pages)
  if (pageText) parts.push(pageText)
  if (result.truncated) parts.push(`(Showing the first ${result.sources.length} sources. Refine the query for more.)`)
  parts.push('Cite the relevant URLs above as markdown links in your answer.')
  return parts.join('\n\n')
}
