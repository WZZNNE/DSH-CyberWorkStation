/**
 * Client for the optional local article extractor (`dsh-extract`).
 *
 * The service converts HTML into article text with trafilatura and NOTHING else:
 * it is handed markup the caller has already pulled through the address-pinned,
 * SSRF-guarded transport in `./fetch.js`, and it never fetches a URL of its own.
 * That split is deliberate — the URL comes from a model, so the decision to open
 * it stays inside the guard, and the extractor only ever sees bytes.
 *
 * Every failure returns `null` instead of throwing: the caller falls back to the
 * built-in `htmlToText`, so a stopped container degrades page text quality and
 * never breaks a search.
 */

/** Whether an extractor endpoint is syntactically usable (owner-configured, not model-supplied). */
export function isExtractorUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

/** The HTML budget sent to the service; more than this is boilerplate for any article. */
const MAX_HTML_CHARS = 2_000_000

/**
 * Extract article text from HTML through the local service.
 * @param {string} html
 * @param {{ url?: string, maxChars?: number, extractorUrl: string, signal?: AbortSignal, timeoutMs?: number, fetchFn?: typeof fetch }} opts
 * @returns {Promise<{ text: string, title?: string, date?: string } | null>} null when unusable
 */
export async function extractViaService(html, { url, maxChars = 4000, extractorUrl, signal, timeoutMs = 8000, fetchFn } = {}) {
  if (!isExtractorUrl(extractorUrl)) return null
  const call = fetchFn ?? globalThis.fetch
  if (typeof call !== 'function') return null
  const endpoint = extractorUrl.replace(/\/+$/, '') + '/extract'
  // A caller signal must not remove the deadline: a stalled service would hold the turn.
  const t = AbortSignal.timeout(timeoutMs)
  const bounded = signal ? AbortSignal.any([signal, t]) : t
  try {
    const r = await call(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: String(html).slice(0, MAX_HTML_CHARS), ...(url ? { url } : {}), max_chars: maxChars }),
      signal: bounded,
    })
    if (!r.ok) return null
    const j = JSON.parse((await r.text()).slice(0, 4_000_000))
    if (j?.ok !== true || typeof j.text !== 'string' || j.text.trim().length === 0) return null
    return {
      text: j.text,
      ...(typeof j.title === 'string' && j.title.length > 0 ? { title: j.title } : {}),
      ...(typeof j.date === 'string' && j.date.length > 0 ? { date: j.date } : {}),
    }
  } catch { return null }
}
