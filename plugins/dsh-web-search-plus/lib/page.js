/**
 * Page visiting for inject mode: SSRF guard + minimal HTML → text extraction.
 * Only public http(s) hostnames are fetched: IP literals (IPv4, bracketed IPv6,
 * IPv4-mapped / NAT64 forms) and private / loopback / link-local / ULA names are
 * refused syntactically, the hostname is then resolved and every address is
 * checked against the same private ranges before the request goes out, and
 * redirects are followed manually with the same checks per hop. Bodies are
 * read as a stream and cut at a byte cap. A resolve-then-fetch check still
 * leaves a DNS-rebinding window; the visitor is opt-in (visitLinks > 0).
 */
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

const PRIVATE_NAME = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.lan$/i, /\.internal$/i, /\.home\.arpa$/i, /^host\.docker\.internal$/i]
const MAX_BODY_BYTES = 1_500_000

/** Whether an IP address (v4 or v6, any textual form Node accepts) is loopback / private / link-local / ULA / unspecified / multicast. */
export function isPrivateAddress(ip) {
  const s = String(ip).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const v = isIP(s)
  if (v === 4) return isPrivateV4(s)
  if (v !== 6) return true // not an address at all → treat as unsafe
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:xxxx:xxxx), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96)
  const mapped = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(s) ?? /^(?:0*:)+(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (mapped) return isPrivateV4(mapped[1])
  const hexMapped = /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s)
  if (hexMapped) { const a = parseInt(hexMapped[1], 16), b = parseInt(hexMapped[2], 16); return isPrivateV4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`) }
  if (s === '::' || s === '::1') return true
  // 6to4 (2002:AABB:CCDD::) and Teredo (2001:0:…) embed an IPv4 address; judge that address
  const embedded = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(s) ?? /^2001:0{1,4}:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/.exec(s)
  if (embedded) { const a = parseInt(embedded[1], 16), b = parseInt(embedded[2], 16); return isPrivateV4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`) }
  if (/^(?:0*:)+[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(s)) { const parts = s.split(':').filter(Boolean); const a = parseInt(parts[parts.length - 2], 16), b = parseInt(parts[parts.length - 1], 16); return isPrivateV4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`) }
  if (/^f[cd][0-9a-f]{2}:/.test(s)) return true          // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(s)) return true          // fe80::/10 link local
  if (/^ff[0-9a-f]{2}:/.test(s)) return true             // multicast
  if (/^64:ff9b:/.test(s)) return true                   // NAT64 with non-dotted tail
  if (/^2001:db8:/.test(s)) return true                  // documentation
  return false
}
function isPrivateV4(s) {
  const p = s.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  const c = p[2]
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
}

/** Syntactic check: http(s), no userinfo, no IP literal, no private-looking name, not blacklisted. */
export function isSafeUrl(value, blacklist = []) {
  let u
  try { u = new URL(String(value)) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  const host = u.hostname.replace(/\.+$/, '').toLowerCase()
  if (host.length === 0) return false
  if (host.startsWith('[') || isIP(host) !== 0) return false // bare IP literals are never public pages we want
  if (PRIVATE_NAME.some(p => p.test(host))) return false
  if (blacklist.some(b => host === b || host.endsWith('.' + b))) return false
  return true
}

/**
 * Resolve the hostname and refuse it when ANY address is private (a name that
 * resolves to both a public and a private address is treated as private).
 * @param {string} host
 * @param {(host: string) => Promise<Array<{address: string}>>} [lookupFn]
 */
export async function resolvesPublic(host, lookupFn) {
  const lookup = lookupFn ?? (h => dns.lookup(h, { all: true, verbatim: true }))
  let addrs
  try { addrs = await lookup(host.replace(/\.+$/, '')) } catch { return false }
  if (!Array.isArray(addrs) || addrs.length === 0) return false
  return addrs.every(a => !isPrivateAddress(a?.address ?? a))
}

/** The elements whose contents are never readable text. */
const DROPPED_ELEMENTS = ['script', 'style', 'noscript', 'svg', 'canvas', 'iframe', 'nav', 'footer', 'header', 'aside', 'form']

/**
 * Remove every `open … close` span in one forward pass. A lazy regex (`<script[\s\S]*?</script>`)
 * re-scans to the end of the input for every unclosed opener, which is quadratic in a page an
 * attacker controls; `indexOf` walks the string once.
 */
function stripSpans(text, open, close, requireBoundary = false) {
  const lower = text.toLowerCase()
  let out = ''
  let at = 0
  for (;;) {
    let start = lower.indexOf(open, at)
    // `<scripting>` is not `<script>`: the next character has to end the tag name.
    while (requireBoundary && start >= 0 && !/[\s/>]/.test(lower[start + open.length] ?? '>')) {
      start = lower.indexOf(open, start + 1)
    }
    if (start < 0) break
    const end = lower.indexOf(close, start + open.length)
    if (end < 0) return out + text.slice(at, start) + ' '        // unclosed: drop the rest
    const stop = close.endsWith('>') ? end + close.length : (lower.indexOf('>', end) + 1 || text.length)
    out += text.slice(at, start) + ' '
    at = stop
  }
  return out + text.slice(at)
}

/**
 * Strip markup into readable text (scripts/styles/nav removed, whitespace collapsed). The input is
 * capped: the caller wants ~1200 characters, and a megabyte of markup only costs time.
 */
export function htmlToText(html, { maxInput = 200_000 } = {}) {
  let s = String(html).slice(0, maxInput)
  s = stripSpans(s, '<!--', '-->')
  for (const tag of DROPPED_ELEMENTS) s = stripSpans(s, '<' + tag, '</' + tag, true)
  s = s.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, '\n')
  // Bounded: an unterminated `<` used to start a scan to the end of the input, so 200 000 of them
  // took 14 seconds. No real tag is 4 KB of attributes, and what is left over is dropped below.
  s = s.replace(/<[^>]{0,4096}>/g, ' ').replace(/<[^>]*$/, ' ')
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  // Every whitespace character, not only the ASCII ones: a run of U+00A0 (&nbsp;, which real
  // pages are full of) or U+2028 used to survive the first collapse and then meet `\s*\n\s*`,
  // which is quadratic on a long run — 160 000 of them measured at 13 seconds, on the one thread
  // the harness has.
  s = s.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n')
  return s.trim()
}

/** Combine the caller's signal with a hard timeout. */
export function boundedSignal(signal, timeoutMs) {
  const t = AbortSignal.timeout(timeoutMs)
  if (!signal) return t
  // No fallback: returning the caller's signal alone would drop the deadline this function exists
  // for. `AbortSignal.any` is Node ≥ 20.3, and the core requires ^22.19 || >=24.
  return AbortSignal.any([signal, t])
}

/** Read at most `cap` bytes of a response body (stream-aware), decoding as UTF-8. */
export async function readCapped(r, cap = MAX_BODY_BYTES) {
  const body = r.body
  if (!body || typeof body.getReader !== 'function') return (await r.text()).slice(0, cap)
  const reader = body.getReader()
  const chunks = []
  let total = 0
  try {
    while (total < cap) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) { chunks.push(value); total += value.byteLength }
    }
  } finally { try { await reader.cancel() } catch { /* closed */ } }
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)))
  return buf.subarray(0, cap).toString('utf8')
}

/**
 * Fetch one page and return its text, or null when blocked/failed.
 *
 * With no injected `fetchFn` this rides the same address-pinned transport as `web_fetch`
 * (`./fetch.js`), so the visitor cannot be walked into a private address by a name that answers
 * differently on the second lookup. A test that injects `fetchFn` keeps the older path.
 * @param {string} url
 * @param {{ fetchFn?: typeof fetch, lookupFn?: Function, maxChars?: number, blacklist?: string[], signal?: AbortSignal, timeoutMs?: number }} opts
 */
export async function fetchPageText(url, { fetchFn, lookupFn, maxChars = 1200, blacklist = [], signal, timeoutMs = 12000 } = {}) {
  if (fetchFn === undefined) {
    const { fetchPinned } = await import('./fetch.js')
    let page
    try { page = await fetchPinned(url, { blacklist, lookupFn, signal, timeoutMs, maxBodyChars: Math.max(64_000, maxChars * 8) }) } catch { return null }
    if (page.statusCode < 200 || page.statusCode >= 300) return null
    const text = page.body.kind === 'html' ? htmlToText(page.body.content, { maxInput: Math.max(64_000, maxChars * 8) }) : page.body.content
    return { url: page.url, text: text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text }
  }
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    if (!isSafeUrl(current, blacklist)) return null
    if (!(await resolvesPublic(new URL(current).hostname, lookupFn))) return null
    let r
    try {
      r = await fetchFn(current, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 dsh-web-search-plus', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' }, signal: boundedSignal(signal, timeoutMs) })
    } catch { return null }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location')
      if (!loc) return null
      try { current = new URL(loc, current).toString() } catch { return null }
      try { await r.body?.cancel?.() } catch { /* ignore */ }
      continue
    }
    if (!r.ok) return null
    const type = r.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) return null
    const body = await readCapped(r)
    // Eight times the character budget is far more markup than 1 200 characters of text needs.
    const text = /text\/plain/i.test(type) ? body : htmlToText(body, { maxInput: Math.max(64_000, maxChars * 8) })
    return { url: current, text: text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text }
  }
  return null
}
