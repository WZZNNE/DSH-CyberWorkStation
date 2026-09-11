/**
 * The page reader's transport: one GET with the address pinned to what the guard validated.
 *
 * A resolve-then-fetch check leaves a window (DNS rebinding: the name answers public for the check
 * and private for the connection). Here the hostname is resolved once, every address is checked
 * against the private ranges, and the socket is opened to one of those addresses with `lookup`
 * overridden — the name never resolves a second time. A redirect is followed to any target that passes
 * the whole guard again (so http→https and apex→www work, while a hop into a private address does
 * not); no cookies or credentials are ever sent. Bodies are capped in bytes and in decoded characters,
 * the declared content-encoding is undone, and only text-like content is returned.
 */
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import { isSafeUrl, isPrivateAddress, boundedSignal } from './page.js'
import { promises as dns } from 'node:dns'

export const FETCH_USER_AGENT = 'dsh-web-search-plus/0.5.0 (+web_fetch; DeepSeek Harness)'
const MAX_URL_LENGTH = 2048

/** Text-like content types the tool can hand to the model; anything else is refused before the body is read. */
export function classifyContentType(header) {
  const type = String(header ?? '').split(';')[0].trim().toLowerCase()
  // No content type at all: decide from the bytes (classifySniff), not from optimism.
  if (type === '') return 'unknown'
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html'
  if (type.startsWith('text/')) return 'text'
  if (type === 'application/json' || type === 'application/xml' || type === 'application/javascript' || type === 'application/ecmascript' || type === 'application/x-yaml' || type === 'application/yaml') return 'text'
  if (/\+(json|xml)$/.test(type)) return 'text'
  return null
}
/**
 * A body with no declared type: text when it decodes without NULs and is mostly printable.
 * @param {Buffer} buf
 */
export function looksTextual(buf) {
  const head = buf.subarray(0, 4096)
  if (head.includes(0)) return false
  let odd = 0
  for (const byte of head) if (byte < 9 || (byte > 13 && byte < 32)) odd++
  return head.length === 0 || odd / head.length < 0.02
}
function charsetOf(header) {
  const m = /charset=["']?([\w.-]+)/i.exec(String(header ?? ''))
  return m ? m[1].toLowerCase() : 'utf-8'
}
/** Undo the encoding the server actually used; an encoding we cannot undo is refused, never guessed. */
function decompress(buf, encodingHeader) {
  const encodings = String(encodingHeader ?? '').split(',').map(e => e.trim().toLowerCase()).filter(e => e && e !== 'identity')
  let out = buf
  for (const encoding of encodings.reverse()) {
    if (encoding === 'gzip' || encoding === 'x-gzip') out = zlib.gunzipSync(out)
    else if (encoding === 'deflate') out = zlib.inflateSync(out)
    else if (encoding === 'br') out = zlib.brotliDecompressSync(out)
    else throw new Error(`web_fetch stopped: the server replied with content-encoding "${encoding}", which this reader cannot decode`)
  }
  return out
}
function decoderFor(charset) {
  try { return new TextDecoder(charset, { fatal: false }) } catch { return new TextDecoder('utf-8', { fatal: false }) }
}

/** Resolve a hostname; every address must be public. Returns the addresses, or a refusal string. */
export async function resolvePublic(host, lookupFn, isPrivate = isPrivateAddress) {
  const name = host.replace(/\.+$/, '')
  const lookup = lookupFn ?? (h => dns.lookup(h, { all: true, verbatim: true }))
  let addrs
  try { addrs = await lookup(name) } catch (error) { return { refusal: `DNS lookup failed for ${name} (${String(error?.code ?? error?.message ?? error)})` } }
  const list = (Array.isArray(addrs) ? addrs : []).map(a => (typeof a === 'string' ? { address: a, family: a.includes(':') ? 6 : 4 } : { address: String(a?.address ?? ''), family: a?.family === 6 || String(a?.address ?? '').includes(':') ? 6 : 4 })).filter(a => a.address)
  if (list.length === 0) return { refusal: `DNS lookup returned no address for ${name}` }
  if (list.some(a => isPrivate(a.address))) return { refusal: `${name} resolves to a private or loopback address` }
  return { addresses: list }
}

/** The guard the tool runs before anything is sent: syntax, blacklist, then DNS with every address public. */
export async function fetchRefusal(url, { blacklist = [], lookupFn, isPrivate } = {}) {
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return `web_fetch refused: the URL is missing or longer than ${MAX_URL_LENGTH} characters`
  if (!isSafeUrl(url, blacklist)) return `web_fetch refused ${url.slice(0, 200)}: only public http(s) URLs are fetched (no credentials in the URL, no IP literals, no private / loopback names, no blacklisted hosts)`
  const host = new URL(url).hostname
  const r = await resolvePublic(host, lookupFn, isPrivate)
  return r.refusal ? `web_fetch refused ${url.slice(0, 200)}: ${r.refusal}` : ''
}

function requestOnce(target, address, { userAgent, signal }) {
  return new Promise((resolve, reject) => {
    const mod = target.protocol === 'https:' ? https : http
    const req = mod.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: 'GET',
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5', 'accept-encoding': 'identity' },
      // The pinned address: the validated one, not a second lookup of the name.
      lookup: (_host, options, cb) => (options?.all ? cb(null, [{ address: address.address, family: address.family }]) : cb(null, address.address, address.family)),
      servername: target.hostname,
      signal,
    }, resolve)
    req.on('error', reject)
    req.end()
  })
}

/**
 * Fetch one public page. Returns { url, statusCode, body: { kind, content }, truncated } — the
 * shape the core's tool-web helpers render. Throws with a readable message on refusal, redirect
 * across origins, unsupported content, oversize bodies, or a timeout.
 */
export async function fetchPinned(url, { blacklist = [], lookupFn, isPrivate, userAgent = FETCH_USER_AGENT, timeoutMs = 30000, maxRedirects = 5, maxResponseBytes = 5_000_000, maxBodyChars = 100_000, signal } = {}) {
  const bounded = boundedSignal(signal, timeoutMs)
  let current = url
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // One lookup per hop: the guard's answer is the address the socket opens to.
    if (typeof current !== 'string' || current.length > MAX_URL_LENGTH) throw new Error(`web_fetch refused: the URL is missing or longer than ${MAX_URL_LENGTH} characters`)
    if (!isSafeUrl(current, blacklist)) throw new Error(`web_fetch refused ${current.slice(0, 200)}: only public http(s) URLs are fetched (no credentials in the URL, no IP literals, no private / loopback names, no blacklisted hosts)`)
    const target = new URL(current)
    const resolved = await resolvePublic(target.hostname, lookupFn, isPrivate)
    if (resolved.refusal) throw new Error(`web_fetch refused ${current.slice(0, 200)}: ${resolved.refusal}`)
    const address = resolved.addresses.find(a => a.family === 4) ?? resolved.addresses[0]
    let res
    try { res = await requestOnce(target, address, { userAgent, signal: bounded }) } catch (error) {
      if (bounded.aborted) throw new Error(`web_fetch stopped: ${target.host} did not answer within ${timeoutMs} ms`)
      // Node appends its own --use-openssl-ca advice to TLS failures; the model has no use for it.
      throw new Error(`web_fetch could not reach ${target.host}: ${String(error?.message ?? error).split('\n')[0].replace(/\s*Consider using .*$/, '').slice(0, 200)}`)
    }
    const status = res.statusCode ?? 0
    if (status >= 300 && status < 400) {
      res.destroy()
      if (!res.headers.location) throw new Error(`web_fetch stopped: ${target.href} answered ${status} with no redirect target`)
      if (hop === maxRedirects) throw new Error(`web_fetch stopped: more than ${maxRedirects} redirects`)
      let next
      try { next = new URL(res.headers.location, target) } catch { throw new Error('web_fetch stopped: the redirect target is not a valid URL') }
      // Any hop is followed, and every hop runs the whole guard again (scheme, blacklist, DNS,
      // pinning) — so http→https and apex→www work, while a redirect into a private address does
      // not. No cookies or credentials are ever sent, so a cross-origin hop carries nothing along.
      current = next.href
      continue
    }
    const kind = classifyContentType(res.headers['content-type'])
    if (kind === null) { res.destroy(); throw new Error(`web_fetch refused: unsupported content type ${String(res.headers['content-type'] ?? '').split(';')[0] || '(none)'} — only text and HTML pages are read`) }
    const chunks = []
    let bytes = 0
    let cut = false
    await new Promise((resolve, reject) => {
      res.on('data', c => {
        if (cut) return
        if (bytes + c.length > maxResponseBytes) { cut = true; chunks.push(c.subarray(0, Math.max(0, maxResponseBytes - bytes))); bytes = maxResponseBytes; res.destroy(); resolve(); return }
        bytes += c.length
        chunks.push(c)
      })
      res.on('end', resolve)
      res.on('error', error => (cut ? resolve() : reject(bounded.aborted ? new Error(`web_fetch stopped: no complete reply within ${timeoutMs} ms`) : error)))
      res.on('close', resolve)
    })
    const raw = decompress(Buffer.concat(chunks), res.headers['content-encoding'])
    if (kind === 'unknown' && !looksTextual(raw)) throw new Error('web_fetch refused: the reply declared no content type and does not look like text')
    let text = decoderFor(charsetOf(res.headers['content-type'])).decode(raw)
    let truncated = cut
    if (text.length > maxBodyChars) {
      // never split a surrogate pair: the model would receive a lone half
      let end = maxBodyChars
      const code = text.charCodeAt(end - 1)
      if (code >= 0xd800 && code <= 0xdbff) end--
      text = text.slice(0, end)
      truncated = true
    }
    return { url: target.href, statusCode: status, body: { kind: kind === 'unknown' ? 'text' : kind, content: text }, truncated }
  }
  throw new Error('web_fetch stopped: redirect loop')
}
