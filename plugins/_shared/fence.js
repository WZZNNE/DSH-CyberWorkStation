/**
 * The loopback write fence every suite plugin puts in front of its HTTP routes, in one place.
 *
 * A plugin route on the dsh web port is reachable by any page the browser has open: a DNS-rebinding page
 * (foreign Host header), another local server's page (a foreign Origin, or `sec-fetch-site: same-site`),
 * or a plain HTML form. The fence refuses all of them the way the core's own `/api` trust check does:
 * the Host must name a loopback address, the request must not be cross-site or same-site, an Origin must
 * match the whole request authority (another port is another origin), and a POST must be JSON. A route that a
 * launcher page reads directly passes `allowLoopbackOrigins: true`: any loopback origin is then accepted.
 *
 * Reads are pure functions of the request; nothing here writes a response except `refuse`.
 */
export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
export const DEFAULT_BODY_LIMIT = 256 * 1024

/** The host part of the request's Host header, lower-cased, port stripped, an IPv6 literal kept in brackets. */
export function hostOf(req) {
  const headers = req?.headers ?? req ?? {}
  const h = String(headers.host ?? '').trim().toLowerCase()
  const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h)
  return m ? `[${m[1]}]` : h.replace(/:\d+$/, '')
}

/** Whether the request really came to a loopback address (a rebinding page arrives with a foreign Host). */
export function isLoopbackRequest(req) {
  return LOOPBACK_HOSTS.has(hostOf(req))
}

/**
 * True when the request must be refused: foreign Host, cross-site or same-site fetch, an Origin that is not
 * this authority, or a POST without a JSON content type (`requireJson: false` lifts the last rule for routes
 * that take other bodies).
 */
export function rejectCrossSite(req, { requireJson = true, allowLoopbackOrigins = false } = {}) {
  const headers = req?.headers ?? {}
  if (!LOOPBACK_HOSTS.has(hostOf(req))) return true
  const site = String(headers['sec-fetch-site'] ?? '')
  if (site === 'cross-site') return true
  // another local port is another origin (`same-site`); routes a launcher page reads directly opt in to loopback origins
  if (site === 'same-site' && !allowLoopbackOrigins) return true
  const origin = headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      const parsed = new URL(origin)
      // compare the whole authority, like the core's own trust check, unless any loopback origin is welcome
      if (allowLoopbackOrigins ? !LOOPBACK_HOSTS.has(parsed.hostname) : parsed.host.toLowerCase() !== String(headers.host ?? '').toLowerCase()) return true
    } catch { return true }
  }
  if (requireJson && req.method === 'POST' && !/^application\/json/i.test(String(headers['content-type'] ?? ''))) return true
  return false
}

/** Answer a refused request without reading it. */
export function refuse(req, res, status = 403) {
  req?.resume?.()
  res.writeHead(status)
  res.end()
}

/** JSON reply with the headers every plugin route uses. */
export function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

/**
 * Read a JSON object body of at most `limit` bytes. Rejects with `{ status }` on the error: 413 when the
 * declared or streamed length exceeds the limit (the stream is drained, never buffered), 400 for an aborted
 * request, a body that is not JSON, or a JSON value that is not a plain object. An empty body is `{}`.
 */
export function readBody(req, limit = DEFAULT_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let over = false
    let settled = false
    const fail = (status, message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status })) } }
    // A declared length over the limit is refused before a byte is buffered or drained.
    const declared = Number(req.headers?.['content-length'])
    if (Number.isFinite(declared) && declared > limit) { req.resume(); fail(413, 'body too large'); return }
    req.on('data', c => {
      if (over) return
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
      bytes += buf.length
      if (bytes > limit) { over = true; chunks.length = 0; req.resume(); fail(413, 'body too large'); return }
      chunks.push(buf)
    })
    req.on('aborted', () => fail(400, 'request aborted'))
    req.on('error', () => fail(400, 'request error'))
    req.on('end', () => {
      if (over || settled) return
      settled = true
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        const value = text ? JSON.parse(text) : {}
        if (value === null || typeof value !== 'object' || Array.isArray(value)) { reject(Object.assign(new Error('JSON body must be an object'), { status: 400 })); return }
        resolve(value)
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { status: 400 }))
      }
    })
  })
}
