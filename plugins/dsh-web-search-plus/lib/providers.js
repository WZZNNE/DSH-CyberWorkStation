/**
 * Search providers (pure request/response mapping; `fetchFn` is injectable).
 * Every provider maps into the dsh web seam result shape
 * `{ content?: string, sources: [{ url, title?, snippet?, publishedAt? }], truncated }`.
 *
 * Wire formats follow each vendor's public documentation:
 *  - Serper:  POST https://google.serper.dev/search, header X-API-KEY, body { q, num }
 *             → organic[] { title, link, snippet, date }, answerBox, knowledgeGraph
 *  - SerpApi: GET https://serpapi.com/search.json?engine=google&q=&num=&api_key=
 *             → organic_results[] { title, link, snippet, date }, answer_box
 *  - Tavily:  POST https://api.tavily.com/search, Authorization: Bearer, body { query, max_results, include_answer }
 *             → answer, results[] { title, url, content }
 *  - Brave:   GET https://api.search.brave.com/res/v1/web/search?q=&count=, header X-Subscription-Token
 *             → web.results[] { title, url, description, age / page_age }
 *  - SearXNG: GET {instance}/search?q=&format=json (JSON format must be enabled in settings.yml)
 *             → results[] { title, url, content, publishedDate }, answers[]
 */

export const PROVIDERS = {
  serper: { label: 'Serper (Google)', keyEnv: 'SERPER_API_KEY', needsKey: true, docs: 'https://serper.dev' },
  serpapi: { label: 'SerpApi (Google)', keyEnv: 'SERPAPI_API_KEY', needsKey: true, docs: 'https://serpapi.com/search-api' },
  tavily: { label: 'Tavily', keyEnv: 'TAVILY_API_KEY', needsKey: true, docs: 'https://docs.tavily.com/documentation/api-reference/endpoint/search' },
  brave: { label: 'Brave Search', keyEnv: 'BRAVE_API_KEY', needsKey: true, docs: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started' },
  searxng: { label: 'SearXNG (self-hosted)', keyEnv: null, needsKey: false, needsUrl: true, docs: 'https://docs.searxng.org/dev/search_api.html' },
}

export const PROVIDER_IDS = Object.keys(PROVIDERS)

const str = v => (typeof v === 'string' && v.length > 0 ? v : undefined)
/** The seam documents publishedAt as ISO-8601: keep only values that parse as a date (Brave's "3 days ago" is dropped). */
const iso = v => { if (typeof v !== 'string' || v.length === 0) return undefined; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : undefined }

function cap(sources, maxResults) {
  const n = Number.isFinite(maxResults) && maxResults > 0 ? maxResults : 8
  return { sources: sources.slice(0, n), truncated: sources.length > n }
}

async function requestJson(fetchFn, url, init, signal, timeoutMs = 20000) {
  // A caller signal (the turn's abort) must not remove the hard timeout: a stalled provider would block the step.
  const t = AbortSignal.timeout(timeoutMs)
  // No fallback: returning the caller's signal alone would drop the timeout. `AbortSignal.any` is
  // Node ≥ 20.3, and the core requires ^22.19 || >=24.
  const bounded = signal ? AbortSignal.any([signal, t]) : t
  const r = await fetchFn(url, { ...init, signal: bounded })
  // Capped like every other body this suite reads: a SearXNG instance URL is arbitrary user input,
  // and a search answer is never more than a few hundred KB.
  const text = (await r.text()).slice(0, 2_000_000)
  if (!r.ok) {
    const hint = r.status === 403 && /searxng|\/search\?/i.test(url) && !/serper|serpapi|tavily|brave/.test(url) ? ' (SearXNG returns 403 when the json format is not enabled in settings.yml → search.formats)' : ''
    throw new Error(`${new URL(url).hostname} HTTP ${r.status}: ${text.slice(0, 160)}${hint}`)
  }
  try { return JSON.parse(text) } catch { throw new Error(`${new URL(url).hostname}: non-JSON response`) }
}

/**
 * Run one search with the named provider.
 * @param {string} providerId
 * @param {{ query: string, maxResults?: number, apiKey?: string, searxngUrl?: string, fetchFn?: typeof fetch, signal?: AbortSignal }} opts
 */
export async function searchWith(providerId, { query, maxResults = 8, apiKey, searxngUrl, fetchFn = fetch, signal } = {}) {
  const q = String(query ?? '').trim()
  if (q.length === 0) throw new Error('empty query')
  const def = PROVIDERS[providerId]
  if (def === undefined) throw new Error(`unknown provider "${providerId}"`)
  if (def.needsKey && !apiKey) throw new Error(`${def.label}: API key not configured (${def.keyEnv})`)
  if (def.needsUrl && !searxngUrl) throw new Error(`${def.label}: instance URL not configured`)

  if (providerId === 'serper') {
    const j = await requestJson(fetchFn, 'https://google.serper.dev/search', {
      method: 'POST', headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ q, num: maxResults }),
    }, signal)
    const sources = (Array.isArray(j.organic) ? j.organic : []).map(o => ({ url: str(o.link), title: str(o.title), snippet: str(o.snippet), publishedAt: iso(o.date) })).filter(s => s.url)
    const content = str(j.answerBox?.answer) ?? str(j.answerBox?.snippet) ?? str(j.knowledgeGraph?.description)
    return { ...(content ? { content } : {}), ...cap(sources, maxResults) }
  }
  if (providerId === 'serpapi') {
    const u = new URL('https://serpapi.com/search.json')
    u.searchParams.set('engine', 'google'); u.searchParams.set('q', q); u.searchParams.set('num', String(maxResults)); u.searchParams.set('api_key', apiKey)
    const j = await requestJson(fetchFn, u.toString(), { method: 'GET' }, signal)
    const sources = (Array.isArray(j.organic_results) ? j.organic_results : []).map(o => ({ url: str(o.link), title: str(o.title), snippet: str(o.snippet), publishedAt: iso(o.date) })).filter(s => s.url)
    const content = str(j.answer_box?.answer) ?? str(j.answer_box?.snippet)
    return { ...(content ? { content } : {}), ...cap(sources, maxResults) }
  }
  if (providerId === 'tavily') {
    const j = await requestJson(fetchFn, 'https://api.tavily.com/search', {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, max_results: Math.min(20, maxResults), include_answer: true }),
    }, signal)
    const sources = (Array.isArray(j.results) ? j.results : []).map(o => ({ url: str(o.url), title: str(o.title), snippet: str(o.content), publishedAt: iso(o.published_date) })).filter(s => s.url)
    const content = str(j.answer)
    return { ...(content ? { content } : {}), ...cap(sources, maxResults) }
  }
  if (providerId === 'brave') {
    const u = new URL('https://api.search.brave.com/res/v1/web/search')
    u.searchParams.set('q', q); u.searchParams.set('count', String(Math.min(20, maxResults)))
    const j = await requestJson(fetchFn, u.toString(), { method: 'GET', headers: { 'X-Subscription-Token': apiKey, accept: 'application/json' } }, signal)
    const sources = (Array.isArray(j.web?.results) ? j.web.results : []).map(o => ({ url: str(o.url), title: str(o.title), snippet: str(o.description), publishedAt: iso(o.page_age) ?? iso(o.age) })).filter(s => s.url)
    return cap(sources, maxResults)
  }
  if (providerId === 'searxng') {
    const base = String(searxngUrl).replace(/\/+$/, '')
    const u = new URL(base + '/search')
    u.searchParams.set('q', q); u.searchParams.set('format', 'json')
    const j = await requestJson(fetchFn, u.toString(), { method: 'GET' }, signal)
    const sources = (Array.isArray(j.results) ? j.results : []).map(o => ({ url: str(o.url), title: str(o.title), snippet: str(o.content), publishedAt: iso(o.publishedDate) })).filter(s => s.url)
    const content = Array.isArray(j.answers) && j.answers.length > 0 ? j.answers.map(a => (typeof a === 'string' ? a : str(a?.answer) ?? '')).filter(Boolean).join('\n') : undefined
    return { ...(content ? { content } : {}), ...cap(sources, maxResults) }
  }
  throw new Error(`provider "${providerId}" has no implementation`)
}
