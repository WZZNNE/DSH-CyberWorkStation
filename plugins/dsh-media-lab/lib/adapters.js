/**
 * dsh-media-lab adapters — one pure description per media API, plus the small runner that
 * drives them. Nothing here touches the filesystem or the plugin context, so every adapter is
 * testable offline by handing `runTask` a fake fetch.
 *
 * An adapter is
 *   { id, kinds, keyEnv, keyHeader?, defaultBaseURL, defaultModel, ...
 *     submit(task, cfg, key) -> { url, method, headers, body?, form?, expect },
 *     read(payload, task, cfg, key) -> Result,
 *     readPoll?(payload, task, cfg, key) -> Result }
 * where Result is
 *   { done: true, media: { base64?, url?, mime?, ext? } }
 * | { done: false, poll: { url, method?, headers? } }
 * | { error: 'message' }
 *
 * Wire shapes are taken from the official documentation of each provider (August 2026):
 *   OpenAI images / speech / transcriptions / videos — github.com/openai/openai-openapi
 *     (`/v1/images/generations` → data[].b64_json | url, `/v1/audio/speech` → audio bytes,
 *      `/v1/audio/transcriptions` → multipart + {text}, `/v1/videos` → job, `/v1/videos/{id}/content`)
 *   Google Gemini images — ai.google.dev/gemini-api/docs/image-generation (`/v1beta/interactions`,
 *     header `x-goog-api-key`, base64 image in the output)
 *   Google Veo — ai.google.dev/gemini-api/docs/veo (`:predictLongRunning` + operation polling)
 *   Replicate — replicate.com/docs/topics/predictions/create-a-prediction (`Prefer: wait`, urls.get)
 *   fal — fal.ai/docs/model-endpoints/queue (queue.fal.run, `Authorization: Key`)
 *   ElevenLabs — elevenlabs.io/docs/api-reference/text-to-speech/convert (`xi-api-key`, binary)
 *   Fish Audio — docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech (`model:` header)
 *   MiniMax speech — platform.minimax.io/docs/api-reference/speech-t2a-http (hex audio in data.audio)
 *   MiniMax video — platform.minimax.io/docs/api-reference/video-generation-v2-create (task + poll)
 */

export const KINDS = ['image', 'video', 'tts', 'stt']

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/opus': 'opus', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/pcm': 'pcm',
}
const DEFAULT_MIME = { image: 'image/png', video: 'video/mp4', tts: 'audio/mpeg', stt: 'text/plain' }

/** File extension for a media type, falling back to the kind's usual one. */
export function extFor(mime, kind) {
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase()
  return MIME_EXT[base] ?? MIME_EXT[DEFAULT_MIME[kind] ?? 'image/png'] ?? 'bin'
}

/** Join a base URL with a path, tolerating a trailing slash or an embedded /v1 in the base. */
export function joinUrl(base, path) {
  const b = String(base ?? '').replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : '/' + path
  if (b.endsWith('/v1') && p.startsWith('/v1/')) return b + p.slice(3)
  return b + p
}

/** Read a dotted path out of a JSON value (`data.0.b64_json`); undefined when any hop is missing. */
export function readPath(value, path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  let cur = value
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : cur[part]
  }
  return cur
}

const B64 = /^[A-Za-z0-9+/\r\n]+={0,2}$/
const URLISH = /^https?:\/\/[^\s"']+$/i
const HEX = /^[0-9a-fA-F]+$/

/**
 * Walk a response body for the first plausible media payload. Providers keep moving the field
 * around (`b64_json`, `inlineData.data`, `output_image.data`, `content.url`, `video.url`), so the
 * adapters that have a stable documented path use it, and this is the safety net for the rest.
 */
// Fields a provider echoes back: never the media, however long they are.
const ECHOED_KEYS = ['prompt', 'text', 'input', 'negative_prompt', 'instructions', 'error', 'logs']

export function findMedia(value, { kind = 'image', wantUrl = true, wantBase64 = true, minBase64 = 512, skipKeys = [] } = {}) {
  const skip = new Set([...ECHOED_KEYS, ...PLUMBING_KEYS, ...skipKeys])
  const seen = new Set()
  const urlHints = kind === 'video' ? /\.(mp4|webm|mov)(\?|$)/i : kind === 'tts' ? /\.(mp3|wav|ogg|opus|flac|aac)(\?|$)/i : /\.(png|jpe?g|webp|gif)(\?|$)/i
  let looseUrl
  const walk = (node, keyName) => {
    if (node === null || node === undefined) return undefined
    if (typeof node === 'string') {
      // A long base64-ish string is only media when it decodes cleanly and sits under a key that
      // sounds like a payload — otherwise an opaque job token wins over the real URL beside it.
      const payloadish = /b64|base64|image|audio|video|media|data|content|file|bytes|result|output/i.test(String(keyName ?? ''))
      if (wantBase64 && payloadish && node.length >= minBase64 && node.replace(/\s+/g, '').length % 4 === 0 && B64.test(node) && !URLISH.test(node)) {
        return { base64: node.replace(/\s+/g, '') }
      }
      if (node.startsWith('data:') && node.includes(';base64,')) {
        const [head, data] = node.split(';base64,')
        return { base64: data, mime: head.slice(5) }
      }
      if (wantUrl && URLISH.test(node)) {
        const key = String(keyName ?? '')
        // `callback_url`, `webhook_uri`, `terms_link`: named like a URL, and never the media.
        const plumbing = /callback|webhook|cancel|terms|docs|support|status|report|privacy|policy|home/i.test(key)
        const named = !plumbing && /url|uri|link|download/i.test(key)
        if (!plumbing && (urlHints.test(node) || named)) return { url: node }
        // A URL under a key that says nothing about a payload is not the result either: only a
        // payloadish key earns the fallback.
        if (!plumbing && /image|audio|video|media|data|content|file|result|output/i.test(key)) looseUrl ??= { url: node }
      }
      return undefined
    }
    if (typeof node !== 'object') return undefined
    if (seen.has(node)) return undefined
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) { const hit = walk(item, keyName); if (hit) return hit }
      return undefined
    }
    // Documented payload fields first, so a body that also carries a thumbnail resolves correctly.
    for (const key of ['b64_json', 'bytesBase64Encoded', 'base64', 'imageBytes']) {
      if (typeof node[key] === 'string' && node[key].length > 0) return { base64: node[key].replace(/\s+/g, ''), mime: node.mimeType ?? node.mime_type }
    }
    // `{ data, mime_type }` (Gemini's inline images) is a payload however short it is.
    const mimeHint = node.mimeType ?? node.mime_type ?? node.mediaType
    if (typeof node.data === 'string' && node.data.length > 0 && typeof mimeHint === 'string' && !node.data.startsWith('http')) {
      return { base64: node.data.includes(';base64,') ? node.data.split(';base64,')[1] : node.data.replace(/\s+/g, ''), mime: mimeHint }
    }
    for (const [key, child] of Object.entries(node)) {
      if (skip.has(key)) continue
      const hit = walk(child, key)
      if (hit) return { ...hit, mime: hit.mime ?? (typeof node.mimeType === 'string' ? node.mimeType : undefined) ?? (typeof node.mime_type === 'string' ? node.mime_type : undefined) }
    }
    return undefined
  }
  return walk(value, undefined) ?? looseUrl
}

// Everything else is treated as a credential. A denylist could not work: the custom adapter's
// documented idiom puts the key in a header the user names (`x-token: {{key}}`).
const PORTABLE_HEADERS = ['content-type', 'accept', 'accept-encoding', 'user-agent']
/** Keys whose subtree is never the media: a callback block can hold a `url` of its own. */
const PLUMBING_KEYS = ['callback', 'callback_url', 'webhook', 'webhook_url', 'cancel', 'cancel_url', 'terms', 'docs', 'support', 'status', 'status_url', 'privacy', 'policy', 'home', 'report']
export const originOf = url => { try { return new URL(String(url)).origin } catch { return '' } }

/**
 * Does this URL template put a variable in its host? `{{prompt}}`, `{{size}}` and friends are chosen
 * by the model, so they may fill a path or a query — but a host they can move is a host the key can
 * be sent to. Two fillings that differ only in the variables must give the same origin.
 * Exported so the settings route refuses such a URL at save time, with the same rule.
 */
export function templatedHost(url) {
  const raw = String(url ?? '')
  if (!/\{\{\w+\}\}/.test(raw)) return false
  const a = originOf(raw.replace(/\{\{\w+\}\}/g, 'aaa'))
  const b = originOf(raw.replace(/\{\{\w+\}\}/g, 'bbb'))
  // Fail closed on a filling that will not parse: a template in the PORT makes both fillings
  // unparseable, so comparing origins alone said "same" and let it through.
  if (a === '' || b === '' || a !== b) return true
  const authority = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0]
  return /\{\{\w+\}\}/.test(authority)      // userinfo or port
}

/**
 * Addresses only this machine (or this network) can reach. A poll or download URL comes out of a
 * provider's response body, so following one to `127.0.0.1` or `169.254.169.254` would turn the
 * plugin into the provider's window onto the deployment's own network — and the reply is reflected
 * back to the model. A configured local endpoint is a different matter: that origin is home, and
 * home is checked before this is.
 */
/** True for a dotted-quad literal that belongs to this machine or a private network. */
function isPrivateV4(host) {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!v4) return false
  const parts = v4.slice(1).map(Number)
  if (parts.some(n => n > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 || parts.every(n => n === 255)      // multicast, reserved, and the broadcast address
}

/** True for an IPv6 literal that is loopback, unspecified, unique-local or link-local. */
function isPrivateV6(host) {
  if (host === '::1' || host === '::') return true
  // `new URL` normalises an IPv4-mapped address to hex (`::ffff:7f00:1`), so both forms are read.
  const mapped = /^::ffff:(.+)$/.exec(host)
  if (mapped) {
    if (isPrivateV4(mapped[1])) return true
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped[1])
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)
      return isPrivateV4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))
    }
  }
  const translated = /^(?:::ffff:0:|64:ff9b::)(.+)$/.exec(host)      // IPv4-translated, NAT64
  if (translated && isPrivateAddress('http://[' + '::ffff:' + translated[1] + ']')) return true
  // 2002::/16 wraps a v4 address in the two hextets after the prefix — and `new URL` compresses
  // zeros, so `2002:7f00::1` is the same address as `2002:7f00:0:...` with the second one elided.
  // Either hextet may be elided (`2002::7f00:1`, `2002:7f00::1`), and `new URL` will have done so.
  const sixToFour = /^2002:([0-9a-f]{1,4})?:([0-9a-f]{1,4})?(?::|$)/.exec(host)
  if (sixToFour) {
    const n = ((parseInt(sixToFour[1] ?? '0', 16) << 16) | parseInt(sixToFour[2] ?? '0', 16)) >>> 0
    if (isPrivateV4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))) return true
  }
  // RFC 4291 §2.5.5.1 IPv4-compatible (`::7f00:1`) and RFC 8215 local-use NAT64 (`64:ff9b:1::`).
  const compat = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (compat) {
    const n = ((parseInt(compat[1], 16) << 16) | parseInt(compat[2], 16)) >>> 0
    if (isPrivateV4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))) return true
  }
  const nat64 = /^64:ff9b(?::[0-9a-f]{1,4})?::(.+)$/.exec(host)
  if (nat64) return isPrivateAddress('http://[::ffff:' + nat64[1] + ']')
  if (/^fe[cdef][0-9a-f]:/.test(host)) return true                   // fec0::/10, deprecated site-local
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true                   // fe80::/10, not just fe80:
  return /^f[cd][0-9a-f]{2}:/.test(host)                             // fc00::/7, and only as a literal
}

/**
 * Addresses only this machine (or this network) can reach, judged from the URL alone. A poll or
 * download URL comes out of a provider's response body, so following one to `127.0.0.1` or
 * `169.254.169.254` would turn the plugin into that provider's window onto the deployment's own
 * network. A configured local endpoint is a different matter: that origin is home, and home is
 * checked before this is. A name is resolved separately — see `resolvesPrivate`.
 */
export function isPrivateAddress(url) {
  let host
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/^\[|\]$/g, '') } catch { return false }
  host = host.replace(/\.$/, '')             // "localhost." is a valid FQDN for localhost
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host.includes(':')) return isPrivateV6(host)
  return isPrivateV4(host)
}

/**
 * What the name resolves to. A literal check cannot see `cdn.example.com A 127.0.0.1`, so every
 * scoped URL is also looked up before it is fetched. This narrows the window rather than closing
 * it — the resolver is asked once and the connection is made separately, so a record that changes
 * between the two is not caught. Injectable, and `setAddressLookup` swaps it in the tests.
 */
let addressLookup = async host => {
  const { lookup } = await import('node:dns/promises')
  return lookup(host, { all: true })
}

/** Test seam: replace the DNS lookup used by the private-address check. */
export function setAddressLookup(fn) { addressLookup = fn }

export async function resolvesPrivate(url) {
  let host
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '') } catch { return false }
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false   // a literal: already judged
  let addresses
  try { addresses = await addressLookup(host) } catch { return false }             // it will not connect either
  return (Array.isArray(addresses) ? addresses : [addresses]).some(entry => {
    const address = String(entry?.address ?? entry ?? '')
    return address.includes(':') ? isPrivateV6(address.toLowerCase()) : isPrivateV4(address)
  })
}
/**
 * Strip credentials from a request whose URL did not come from the configuration. Poll and download
 * URLs are read out of the provider's own response body, so a compromised, mirrored or mistyped
 * endpoint could otherwise point them at a host of its choosing and be handed the API key. The
 * "home" set holds the configured base URL and the adapter's own documented host, so a deployment
 * behind a proxy still authenticates the provider's real download host.
 */
function scopeHeaders(headers, url, homeOrigins, secret, userNamed = []) {
  // An empty home set means nothing was configured to trust: strip, never pass.
  if (homeOrigins && homeOrigins.size > 0 && homeOrigins.has(originOf(url))) return { ...headers }
  const out = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (!PORTABLE_HEADERS.includes(key.toLowerCase())) continue
    // Even a portable header is a credential when the key was templated into it — or when the user
    // wrote the header at all, since a pasted literal secret is not recognisable as one.
    if (secret && String(value).includes(secret)) continue
    if (userNamed.includes(key.toLowerCase())) continue
    out[key] = value
  }
  return out
}

/** Provider error text out of the usual envelopes. */
export function errorText(json, status) {
  const m = readPath(json, 'error.message') ?? readPath(json, 'base_resp.status_msg') ?? readPath(json, 'message')
    ?? readPath(json, 'detail') ?? readPath(json, 'error') ?? readPath(json, 'task.error.message')
  const text = typeof m === 'string' ? m : m === undefined ? '' : JSON.stringify(m)
  return `HTTP ${status}${text ? ': ' + text.slice(0, 300) : ''}`
}

const bearer = key => ({ authorization: `Bearer ${key}` })
const jsonHeaders = key => ({ 'content-type': 'application/json', ...bearer(key) })

// ── image ───────────────────────────────────────────────────────────────────

/** OpenAI-compatible images endpoint: OpenAI itself, SiliconFlow, Together, most gateways. */
const openaiImage = {
  id: 'openai-compatible',
  kinds: ['image'],
  keyEnv: 'OPENAI_API_KEY',
  defaultBaseURL: 'https://api.openai.com',
  defaultModel: 'gpt-image-1.5',
  submit(task, cfg, key) {
    const body = { model: cfg.model, prompt: task.prompt, n: 1 }
    if (cfg.size) body.size = cfg.size
    // The task's word beats the stored config: /generate lets a caller ask per request.
    if (task.quality || cfg.quality) body.quality = task.quality || cfg.quality
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(body, cfg.extra)
    return { url: joinUrl(cfg.baseURL, '/v1/images/generations'), method: 'POST', headers: jsonHeaders(key), body, expect: 'json' }
  },
  read(payload) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const b64 = readPath(payload.json, 'data.0.b64_json')
    if (typeof b64 === 'string') {
      // github.com/openai/openai-openapi: ImagesResponse carries `output_format` (png | webp | jpeg).
      const format = String(readPath(payload.json, 'output_format') ?? 'png').toLowerCase()
      const mime = format === 'webp' ? 'image/webp' : format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/png'
      return { done: true, media: { base64: b64, mime } }
    }
    const url = readPath(payload.json, 'data.0.url')
    if (typeof url === 'string') return { done: true, media: { url } }
    const found = findMedia(payload.json, { kind: 'image' })
    return found ? { done: true, media: found } : { error: 'the response carried no image' }
  },
}

/**
 * OpenRouter's own image API — one key for every image model it fronts.
 *
 * openrouter.ai/docs/features/multimodal/image-generation: `POST /api/v1/images` with `{model,
 * prompt}`, answering `{data:[{b64_json, media_type}]}`. It is NOT the OpenAI-compatible
 * `/v1/images/generations` path, which is why this is its own adapter rather than a base URL.
 */
/** openrouter.ai/docs/features/multimodal/image-generation: the normalized tiers, exactly this spelling. */
export const IMAGE_RESOLUTION_TIERS = ['512', '1K', '2K', '4K']

const openrouterImage = {
  id: 'openrouter',
  kinds: ['image'],
  keyEnv: 'OPENROUTER_API_KEY',
  defaultBaseURL: 'https://openrouter.ai/api',
  defaultModel: 'openai/gpt-5.4-image-2',
  submit(task, cfg, key) {
    const body = { model: cfg.model || openrouterImage.defaultModel, prompt: task.prompt }
    if (cfg.size) body.size = cfg.size
    // openrouter.ai/docs/features/multimodal/image-generation: `resolution` is the normalized tier
    // (512 / 1K / 2K / 4K), `seed` pins the sampler, and `input_references` guides image-to-image —
    // the way a character stays the same character across a run of frames. A lowercase "1k" is
    // folded; anything outside the documented tiers is not sent.
    if (task.resolution) {
      const tier = String(task.resolution).trim().toUpperCase()
      if (IMAGE_RESOLUTION_TIERS.includes(tier)) body.resolution = tier
    }
    if (Number.isSafeInteger(task.seed) && task.seed >= 0) body.seed = task.seed
    if (Array.isArray(task.references) && task.references.length > 0) {
      body.input_references = task.references.map(url => ({ type: 'image_url', image_url: { url } }))
    }
    // openrouter.ai/docs/features/multimodal/image-generation: "transparent" needs an alpha-capable
    // format. Asking for it without one — or with jpeg — gives an opaque picture and no explanation,
    // so a format that cannot carry alpha is corrected rather than sent.
    if (task.background) {
      body.background = task.background
      const format = String(task.format || 'png').toLowerCase()
      body.output_format = task.background === 'transparent' && format !== 'png' && format !== 'webp' ? 'png' : format
    } else if (task.format) body.output_format = task.format
    if (task.quality || cfg.quality) body.quality = task.quality || cfg.quality
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(body, cfg.extra)
    return { url: joinUrl(cfg.baseURL, '/v1/images'), method: 'POST', headers: jsonHeaders(key), body, expect: 'json' }
  },
  read(payload) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const b64 = readPath(payload.json, 'data.0.b64_json')
    // `media_type`, not `mime_type`: the generic search does not know that spelling.
    if (typeof b64 === 'string') return { done: true, media: { base64: b64, mime: readPath(payload.json, 'data.0.media_type') ?? 'image/png' } }
    const url = readPath(payload.json, 'data.0.url')
    if (typeof url === 'string') return { done: true, media: { url } }
    const found = findMedia(payload.json, { kind: 'image' })
    return found ? { done: true, media: found } : { error: 'the response carried no image' }
  },
}

/**
 * OpenRouter's video API: `POST /api/v1/videos` answers `{id, polling_url, status}`, and the poll
 * answers `{status, unsigned_urls:[…]}` once it is `completed`. The download URL is on OpenRouter's
 * own host, so it stays inside `homeOrigins` and keeps its credential.
 */
const openrouterVideo = {
  id: 'openrouter',
  kinds: ['video'],
  keyEnv: 'OPENROUTER_API_KEY',
  defaultBaseURL: 'https://openrouter.ai/api',
  defaultModel: 'minimax/hailuo-3',
  submit(task, cfg, key) {
    const body = { model: cfg.model || openrouterVideo.defaultModel, prompt: task.prompt }
    const seconds = Number(task.seconds ?? cfg.seconds)
    if (Number.isFinite(seconds) && seconds > 0) body.duration = seconds
    // openrouter.ai/docs/features/multimodal/video-generation: a picture to start from goes in
    // `frame_images`, tagged with which end of the clip it is.
    if (typeof task.image === 'string' && task.image.length > 0) {
      body.frame_images = [{ type: 'image_url', image_url: { url: task.image }, frame_type: 'first_frame' }]
    }
    // The gateway validates this against 480p|720p|768p|1080p|1K|2K|4K and rejects any other
    // spelling with a 400. MiniMax's own documentation writes the same values as "768P"/"1080P",
    // so the case a user copies in from there is folded to the case the gateway accepts.
    if (cfg.resolution) body.resolution = String(cfg.resolution).replace(/^(\d+)[pP]$/, '$1p').replace(/^(\d)[kK]$/, '$1K')
    if (cfg.aspectRatio) body.aspect_ratio = cfg.aspectRatio
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(body, cfg.extra)
    return { url: joinUrl(cfg.baseURL, '/v1/videos'), method: 'POST', headers: jsonHeaders(key), body, expect: 'json' }
  },
  read(payload, task, cfg) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const id = readPath(payload.json, 'id')
    if (typeof id !== 'string') return { error: 'the video job carried no id' }
    const polling = readPath(payload.json, 'polling_url')
    const url = typeof polling === 'string' ? polling : joinUrl(cfg.baseURL, `/v1/videos/${encodeURIComponent(id)}`)
    return { done: false, poll: { url, method: 'GET', headers: bearer(task.key) } }
  },
  readPoll(payload, task) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const status = String(readPath(payload.json, 'status') ?? '').toLowerCase()
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      return { error: String(readPath(payload.json, 'error') ?? `the video job ${status || 'failed'}`) }
    }
    if (status === 'completed' || status === 'succeeded') {
      const url = readPath(payload.json, 'unsigned_urls.0') ?? readPath(payload.json, 'urls.0')
      if (typeof url !== 'string') return { error: 'the finished video job carried no URL' }
      return { done: true, media: { url, headers: bearer(task.key), mime: 'video/mp4' } }
    }
    return { done: false, poll: null }
  },
}

/** Google Gemini image generation (the /v1beta/interactions surface). */
const geminiImage = {
  id: 'gemini',
  kinds: ['image'],
  keyEnv: 'GEMINI_API_KEY',
  defaultBaseURL: 'https://generativelanguage.googleapis.com',
  defaultModel: 'gemini-3.1-flash-image',
  submit(task, cfg, key) {
    return {
      url: joinUrl(cfg.baseURL, '/v1beta/interactions'),
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: {
        model: cfg.model,
        input: [{ type: 'text', text: task.prompt }],
        // ai.google.dev/gemini-api/docs/image-generation: aspect ratio and size live in
        // `response_format` ("16:9", "2K"), not in the WxH size the rest of the plugin uses — a WxH
        // value is dropped rather than sent as a ratio the API would reject.
        ...(/^\d+:\d+$/.test(String(cfg.size ?? '')) ? { response_format: { type: 'image', aspect_ratio: cfg.size } } : {}),
        ...(cfg.extra && typeof cfg.extra === 'object' ? cfg.extra : {}),
      },
      expect: 'json',
    }
  },
  read(payload) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    // ai.google.dev/gemini-api/docs/image-generation shows this nested under `interaction`; the flat
    // form is what the endpoint returns today, so both are read before the generic search below.
    const direct = readPath(payload.json, 'output_image.data') ?? readPath(payload.json, 'interaction.output_image.data')
    const mime = readPath(payload.json, 'output_image.mime_type') ?? readPath(payload.json, 'interaction.output_image.mime_type')
    if (typeof direct === 'string') return { done: true, media: { base64: direct, mime: mime ?? 'image/png' } }
    const found = findMedia(payload.json, { kind: 'image' })
    return found ? { done: true, media: found } : { error: 'the response carried no image' }
  },
}

// ── replicate / fal (image and video) ───────────────────────────────────────

const replicate = {
  id: 'replicate',
  kinds: ['image', 'video'],
  keyEnv: 'REPLICATE_API_TOKEN',
  defaultBaseURL: 'https://api.replicate.com',
  defaultModel: 'black-forest-labs/flux-schnell',
  submit(task, cfg, key) {
    const model = String(cfg.model ?? '')
    const input = { prompt: task.prompt, ...(cfg.extra && typeof cfg.extra === 'object' ? cfg.extra : {}) }
    if (task.kind === 'video') {
      const seconds = task.seconds ?? cfg.seconds
      if (seconds) input.duration ??= Number(seconds)
      const shape = cfg.size || cfg.resolution
      if (shape) input.resolution ??= shape
      if (cfg.aspectRatio) input.aspect_ratio ??= cfg.aspectRatio
    }
    if (task.kind === 'image' && cfg.size && /^\d+x\d+$/.test(cfg.size)) {
      const [w, h] = cfg.size.split('x').map(Number)
      input.width ??= w
      input.height ??= h
    }
    const headers = { ...jsonHeaders(key), prefer: 'wait=55' }
    // `owner/name` runs the official-model endpoint; `owner/name:version` and a bare version hash
    // both go to /v1/predictions with the version id.
    if (model.includes(':') || /^[0-9a-f]{40,}$/i.test(model)) {
      const version = model.includes(':') ? model.split(':').pop() : model
      return { url: joinUrl(cfg.baseURL, '/v1/predictions'), method: 'POST', headers, body: { version, input }, expect: 'json' }
    }
    return { url: joinUrl(cfg.baseURL, `/v1/models/${model}/predictions`), method: 'POST', headers, body: { input }, expect: 'json' }
  },
  read(payload, task) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const status = readPath(payload.json, 'status')
    if (status === 'failed' || status === 'canceled') return { error: String(readPath(payload.json, 'error') ?? 'the prediction ' + status) }
    if (status === 'succeeded') {
      const output = readPath(payload.json, 'output')
      const media = findMedia(output, { kind: task.kind })
      return media ? { done: true, media } : { error: 'the prediction produced no file' }
    }
    const url = readPath(payload.json, 'urls.get')
    if (typeof url !== 'string') return { error: 'the prediction has no polling URL' }
    return { done: false, poll: { url, method: 'GET', headers: bearer(task.key) } }
  },
  readPoll(payload, task) { return replicate.read(payload, task) },
}

const FAL_CONTROL_KEYS = ['status_url', 'response_url', 'cancel_url', 'request_id']

const fal = {
  id: 'fal',
  kinds: ['image', 'video'],
  keyEnv: 'FAL_KEY',
  keyHeader: key => ({ authorization: `Key ${key}` }),
  defaultBaseURL: 'https://queue.fal.run',
  defaultModel: 'fal-ai/flux/schnell',
  submit(task, cfg, key) {
    const body = { prompt: task.prompt, ...(cfg.extra && typeof cfg.extra === 'object' ? cfg.extra : {}) }
    if (task.kind === 'image' && cfg.size) body.image_size ??= cfg.size
    if (task.kind === 'video') {
      const seconds = task.seconds ?? cfg.seconds
      if (seconds) body.duration ??= Number(seconds)
      const shape = cfg.size || cfg.resolution
      if (shape) body.resolution ??= shape
      if (cfg.aspectRatio) body.aspect_ratio ??= cfg.aspectRatio
    }
    return {
      url: joinUrl(cfg.baseURL, '/' + String(cfg.model ?? '').replace(/^\/+/, '')),
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${key}` },
      body,
      expect: 'json',
    }
  },
  // A queue envelope (request_id / status_url) is never the result: its own control URLs would
  // otherwise be picked up as "the media". Only the body behind response_url is.
  read(payload, task) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const status = readPath(payload.json, 'status')
    if (status === 'FAILED') return { error: String(readPath(payload.json, 'error') ?? 'the queued request failed') }
    const statusUrl = readPath(payload.json, 'status_url')
    const responseUrl = readPath(payload.json, 'response_url')
    const queued = typeof statusUrl === 'string' || typeof readPath(payload.json, 'request_id') === 'string'
    if (!queued) {
      // a direct (non-queued) answer: the body itself carries the file
      const media = findMedia(payload.json, { kind: task.kind, skipKeys: FAL_CONTROL_KEYS })
      return media ? { done: true, media } : { error: 'the response carried no file' }
    }
    if (typeof statusUrl !== 'string') return { error: 'the queue returned no status URL' }
    return { done: false, poll: { url: statusUrl, method: 'GET', headers: { authorization: `Key ${task.key}` } }, then: responseUrl }
  },
  readPoll(payload, task) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const status = readPath(payload.json, 'status')
    if (status === 'FAILED') return { error: String(readPath(payload.json, 'error') ?? 'the queued request failed') }
    const statusUrl = readPath(payload.json, 'status_url')
    const QUEUE_STATES = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']
    // fal echoes `request_id` in the RESULT body too, so once the response_url leg has been taken
    // (`task.onResult`) the body is the result whatever it echoes — re-deriving queue state from it
    // would poll the same finished URL until the deadline.
    if (task.onResult === true) {
      const media = findMedia(payload.json, { kind: task.kind, skipKeys: FAL_CONTROL_KEYS })
      return media ? { done: true, media } : { error: 'the finished request carried no file' }
    }
    const stillQueued = typeof statusUrl === 'string' || typeof readPath(payload.json, 'request_id') === 'string' || QUEUE_STATES.includes(status)
    if (!stillQueued) {
      // this is the result body fetched from response_url
      const media = findMedia(payload.json, { kind: task.kind, skipKeys: FAL_CONTROL_KEYS })
      return media ? { done: true, media } : { error: 'the finished request carried no file' }
    }
    if (status === 'COMPLETED') {
      const responseUrl = readPath(payload.json, 'response_url') ?? task.then
      if (typeof responseUrl === 'string') {
        task.onResult = true
        return { done: false, poll: { url: responseUrl, method: 'GET', headers: { authorization: `Key ${task.key}` } }, ready: true }
      }
      return { error: 'the finished request carried no response URL' }
    }
    return { done: false, poll: null }
  },
}

// ── video ───────────────────────────────────────────────────────────────────

/** OpenAI video jobs (Sora): create, poll the job, then download /content. */
const openaiVideo = {
  id: 'openai-video',
  kinds: ['video'],
  keyEnv: 'OPENAI_API_KEY',
  defaultBaseURL: 'https://api.openai.com',
  defaultModel: 'sora-2',
  submit(task, cfg, key) {
    const body = { model: cfg.model, prompt: task.prompt }
    // github.com/openai/openai-openapi: `seconds` is a string enum ("4"|"8"|"12") and `size` one of
    // four values; the tool advertises a free integer, so the nearest legal one is sent.
    const asked = task.seconds ?? cfg.seconds
    if (asked) body.seconds = String(nearest(asked, [4, 8, 12], 4))
    if (cfg.size) body.size = ['720x1280', '1280x720', '1024x1792', '1792x1024'].includes(String(cfg.size)) ? String(cfg.size) : '1280x720'
    return { url: joinUrl(cfg.baseURL, '/v1/videos'), method: 'POST', headers: jsonHeaders(key), body, expect: 'json' }
  },
  read(payload, task, cfg) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const status = readPath(payload.json, 'status')
    const id = readPath(payload.json, 'id')
    if (status === 'failed') return { error: String(readPath(payload.json, 'error.message') ?? 'the video job failed') }
    if (typeof id !== 'string') return { error: 'the video job carried no id' }
    if (status === 'completed') {
      return { done: true, media: { url: joinUrl(cfg.baseURL, `/v1/videos/${encodeURIComponent(id)}/content`), headers: bearer(task.key), mime: 'video/mp4' } }
    }
    return { done: false, poll: { url: joinUrl(cfg.baseURL, `/v1/videos/${encodeURIComponent(id)}`), method: 'GET', headers: bearer(task.key) } }
  },
  readPoll(payload, task, cfg) { return openaiVideo.read(payload, task, cfg) },
}

/** Google Veo: predictLongRunning, then poll the operation and download the file URI. */
const veo = {
  id: 'veo',
  kinds: ['video'],
  keyEnv: 'GEMINI_API_KEY',
  defaultBaseURL: 'https://generativelanguage.googleapis.com',
  defaultModel: 'veo-3.1-generate-preview',
  submit(task, cfg, key) {
    const parameters = { ...(cfg.extra && typeof cfg.extra === 'object' ? cfg.extra : {}) }
    if (cfg.aspectRatio) parameters.aspectRatio = cfg.aspectRatio
    if (cfg.resolution) parameters.resolution = cfg.resolution
    if (task.seconds ?? cfg.seconds) parameters.durationSeconds = Number(task.seconds ?? cfg.seconds)
    return {
      url: joinUrl(cfg.baseURL, `/v1beta/models/${cfg.model}:predictLongRunning`),
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: { instances: [{ prompt: task.prompt }], parameters },
      expect: 'json',
    }
  },
  read(payload, task, cfg) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    if (readPath(payload.json, 'error.message')) return { error: String(readPath(payload.json, 'error.message')) }
    if (readPath(payload.json, 'done') === true) {
      const media = findMedia(readPath(payload.json, 'response') ?? payload.json, { kind: 'video' })
      if (!media) return { error: 'the finished operation carried no video' }
      return { done: true, media: { ...media, headers: { 'x-goog-api-key': task.key }, mime: media.mime ?? 'video/mp4' } }
    }
    const name = readPath(payload.json, 'name')
    if (typeof name !== 'string') return { error: 'the operation carried no name' }
    // The name is a path fragment from the response: only the shape Google documents is followed.
    const safeName = name.replace(/^\/+/, '')
    if (!/^[\w.\-/]+$/.test(safeName) || safeName.split('/').includes('..')) {
      return { error: `the operation name is not a plain path: ${safeName.slice(0, 80)}` }
    }
    return { done: false, poll: { url: joinUrl(cfg.baseURL, '/v1beta/' + safeName), method: 'GET', headers: { 'x-goog-api-key': task.key } } }
  },
  readPoll(payload, task, cfg) { return veo.read(payload, task, cfg) },
}

/** MiniMax (Hailuo) video: create a task, poll it, download the returned URL. */
const minimaxVideo = {
  id: 'minimax-video',
  kinds: ['video'],
  keyEnv: 'MINIMAX_API_KEY',
  defaultBaseURL: 'https://api.minimax.io',
  defaultModel: 'MiniMax-H3',
  submit(task, cfg, key) {
    const body = { model: cfg.model, content: [{ type: 'text', text: task.prompt }] }
    if (cfg.resolution) body.resolution = cfg.resolution
    if (task.seconds ?? cfg.seconds) body.duration = Number(task.seconds ?? cfg.seconds)
    if (cfg.aspectRatio) body.ratio = cfg.aspectRatio
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(body, cfg.extra)
    return { url: joinUrl(cfg.baseURL, '/v2/video_generation'), method: 'POST', headers: jsonHeaders(key), body, expect: 'json' }
  },
  read(payload, task, cfg) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const code = readPath(payload.json, 'base_resp.status_code')
    if (typeof code === 'number' && code !== 0) return { error: errorText(payload.json, payload.status) }
    const taskId = readPath(payload.json, 'task_id') ?? readPath(payload.json, 'task.id')
    if (typeof taskId !== 'string') return { error: 'the video task carried no id' }
    const safeId = encodeURIComponent(taskId)
    // platform.minimax.io/docs/api-reference/video-generation-v2-query documents exactly one
    // query path; the older create-path form is kept only as a 404 fallback.
    return { done: false, poll: { url: joinUrl(cfg.baseURL, `/v2/query/video_generation/${safeId}`), method: 'GET', headers: bearer(task.key), fallbackUrl: joinUrl(cfg.baseURL, `/v2/video_generation/${safeId}`) } }
  },
  readPoll(payload, task) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const code = readPath(payload.json, 'base_resp.status_code')
    if (typeof code === 'number' && code !== 0) return { error: errorText(payload.json, payload.status) }
    const status = String(readPath(payload.json, 'task.status') ?? readPath(payload.json, 'status') ?? '').toLowerCase()
    if (['failed', 'fail', 'cancelled', 'canceled', 'error'].includes(status)) return { error: 'the video task ' + status }
    if (status === 'succeeded' || status === 'success') {
      const media = findMedia(payload.json, { kind: 'video' })
      return media ? { done: true, media: { ...media, headers: bearer(task.key), mime: media.mime ?? 'video/mp4' } } : { error: 'the finished task carried no video URL' }
    }
    return { done: false, poll: null }
  },
}

// ── speech ──────────────────────────────────────────────────────────────────

/** OpenAI-compatible speech: OpenAI, SiliconFlow, Groq, and local servers (Kokoro-FastAPI, …). */
const openaiTts = {
  id: 'openai-compatible',
  kinds: ['tts'],
  keyEnv: 'OPENAI_API_KEY',
  defaultBaseURL: 'https://api.openai.com',
  defaultModel: 'gpt-4o-mini-tts',
  defaultVoice: 'alloy',
  submit(task, cfg, key) {
    const body = { model: cfg.model, input: task.text, voice: task.voice ?? cfg.voice ?? 'alloy', response_format: cfg.format ?? 'mp3' }
    if (task.instructions ?? cfg.instructions) body.instructions = task.instructions ?? cfg.instructions
    if (cfg.speed) body.speed = Number(cfg.speed)
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(body, cfg.extra)
    const headers = { 'content-type': 'application/json' }
    if (key) headers.authorization = `Bearer ${key}` // local servers accept an empty key
    return { url: joinUrl(cfg.baseURL, '/v1/audio/speech'), method: 'POST', headers, body, expect: 'binary' }
  },
  read(payload, task, cfg) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    if (!payload.base64) return { error: payload.json ? errorText(payload.json, payload.status) : 'the speech endpoint returned no audio' }
    return { done: true, media: { base64: payload.base64, mime: payload.contentType ?? mimeForFormat(cfg.format) } }
  },
}

const elevenlabsTts = {
  id: 'elevenlabs',
  kinds: ['tts'],
  keyEnv: 'ELEVENLABS_API_KEY',
  defaultBaseURL: 'https://api.elevenlabs.io',
  defaultModel: 'eleven_multilingual_v2',
  defaultVoice: '21m00Tcm4TlvDq8ikWAM',
  submit(task, cfg, key) {
    const voice = encodeURIComponent(task.voice ?? cfg.voice ?? elevenlabsTts.defaultVoice)
    const format = cfg.outputFormat ?? 'mp3_44100_128'
    const body = { text: task.text, model_id: cfg.model }
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(body, cfg.extra)
    return {
      url: joinUrl(cfg.baseURL, `/v1/text-to-speech/${voice}`) + `?output_format=${encodeURIComponent(format)}`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': key },
      body,
      expect: 'binary',
    }
  },
  read(payload) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    if (!payload.base64) return { error: payload.json ? errorText(payload.json, payload.status) : 'ElevenLabs returned no audio' }
    return { done: true, media: { base64: payload.base64, mime: payload.contentType ?? 'audio/mpeg' } }
  },
}

const fishTts = {
  id: 'fish-audio',
  kinds: ['tts'],
  keyEnv: 'FISH_AUDIO_API_KEY',
  defaultBaseURL: 'https://api.fish.audio',
  defaultModel: 's2.1-pro',
  submit(task, cfg, key) {
    // docs.fish.audio: format is one of wav/pcm/mp3/opus, mp3_bitrate one of 64/128/192, latency
    // one of normal/balanced/low. The plugin's own config is wider (it is shared across providers),
    // so a value this API would reject becomes the nearest one it accepts.
    const format = fishFormat(cfg)
    const body = { text: task.text, format }
    const reference = task.voice ?? cfg.voice
    if (reference) body.reference_id = reference
    if (format === 'mp3') {
      const asked = Number(cfg.bitrate ?? 128)
      const kbps = asked > 1000 ? asked / 1000 : asked            // 128000 left over from MiniMax
      body.mp3_bitrate = [64, 128, 192].reduce((best, v) => (Math.abs(v - kbps) < Math.abs(best - kbps) ? v : best), 128)
    }
    if (['normal', 'balanced', 'low'].includes(String(cfg.latency))) body.latency = String(cfg.latency)
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(body, cfg.extra)
    return {
      url: joinUrl(cfg.baseURL, '/v1/tts'),
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, model: cfg.model ?? fishTts.defaultModel },
      body,
      expect: 'binary',
    }
  },
  read(payload, task, cfg) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    if (!payload.base64) return { error: payload.json ? errorText(payload.json, payload.status) : 'Fish Audio returned no audio' }
    return { done: true, media: { base64: payload.base64, mime: payload.contentType ?? mimeForFormat(fishFormat(cfg)) } }
  },
}

/** The format Fish Audio is actually sent (docs.fish.audio: wav / pcm / mp3 / opus). */
const fishFormat = cfg => (['wav', 'pcm', 'mp3', 'opus'].includes(String(cfg?.format)) ? String(cfg.format) : 'mp3')
/** The format MiniMax is actually sent (platform.minimax.io: mp3 / pcm / flac / wav / opus). */
const minimaxFormat = cfg => (['mp3', 'pcm', 'flac', 'wav', 'opus'].includes(String(cfg?.format)) ? String(cfg.format) : 'mp3')

/** Snap to the nearest value an API documents, so a knob shared across providers cannot 400. */
const nearest = (asked, allowed, fallback) => {
  const n = Number(asked)
  if (!Number.isFinite(n)) return fallback
  return allowed.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), fallback)
}

const minimaxTts = {
  id: 'minimax',
  kinds: ['tts'],
  keyEnv: 'MINIMAX_API_KEY',
  defaultBaseURL: 'https://api.minimax.io',
  defaultModel: 'speech-2.8-hd',
  defaultVoice: 'English_expressive_narrator',
  submit(task, cfg, key) {
    // platform.minimax.io/docs/api-reference/speech-t2a-http: speed [0.5,2], vol (0,10],
    // pitch [-12,12]; sample_rate and bitrate are enumerations, and format is one of seven.
    const format = minimaxFormat(cfg)
    const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }
    const body = {
      model: cfg.model,
      text: task.text,
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: task.voice ?? cfg.voice ?? minimaxTts.defaultVoice,
        speed: clamp(cfg.speed ?? 1, 0.5, 2, 1),
        vol: clamp(cfg.volume ?? 1, 0.01, 10, 1),
        pitch: Math.round(clamp(cfg.pitch ?? 0, -12, 12, 0)),
      },
      audio_setting: {
        sample_rate: nearest(cfg.sampleRate ?? 32000, [8000, 16000, 22050, 24000, 32000, 44100], 32000),
        bitrate: nearest(cfg.bitrate ?? 128000, [32000, 64000, 128000, 256000], 128000),
        format,
        channel: 1,
      },
    }
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(body, cfg.extra)
    const url = joinUrl(cfg.baseURL, '/v1/t2a_v2') + (cfg.groupId ? `?GroupId=${encodeURIComponent(cfg.groupId)}` : '')
    return { url, method: 'POST', headers: jsonHeaders(key), body, expect: 'json' }
  },
  read(payload, task, cfg) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const code = readPath(payload.json, 'base_resp.status_code')
    if (typeof code === 'number' && code !== 0) return { error: errorText(payload.json, payload.status) }
    const hex = readPath(payload.json, 'data.audio')
    if (typeof hex === 'string' && hex.length > 0 && HEX.test(hex)) {
      return { done: true, media: { base64: Buffer.from(hex, 'hex').toString('base64'), mime: mimeForFormat(minimaxFormat(cfg)) } }
    }
    const media = findMedia(payload.json, { kind: 'tts' })
    return media ? { done: true, media: { ...media, mime: media.mime ?? mimeForFormat(minimaxFormat(cfg)) } } : { error: 'MiniMax returned no audio' }
  },
}

// ── transcription ───────────────────────────────────────────────────────────

/** OpenAI-compatible transcription: OpenAI, Groq, and local Whisper servers. */
const openaiStt = {
  id: 'openai-compatible',
  kinds: ['stt'],
  keyEnv: 'OPENAI_API_KEY',
  defaultBaseURL: 'https://api.openai.com',
  defaultModel: 'whisper-1',
  submit(task, cfg, key) {
    const headers = {}
    if (key) headers.authorization = `Bearer ${key}`
    const language = task.language || cfg.language
    const form = { model: cfg.model, file: task.file, ...(language ? { language } : {}) }
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(form, cfg.extra)
    return { url: joinUrl(cfg.baseURL, '/v1/audio/transcriptions'), method: 'POST', headers, form, expect: 'json' }
  },
  read(payload) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const text = readPath(payload.json, 'text')
    if (typeof text === 'string') return { done: true, media: { text } }
    return { error: 'the transcription endpoint returned no text' }
  },
}

// ── custom HTTP ─────────────────────────────────────────────────────────────

/**
 * Anything else: a single JSON POST described by the user. `{{prompt}}`, `{{text}}`, `{{model}}`,
 * `{{voice}}`, `{{size}}` and `{{seconds}}` are substituted into the body template, and
 * `resultPath` + `resultType` say where the media is (`base64`, `hex`, `url`, or `binary` for a
 * body that is the file itself).
 */
const custom = {
  id: 'custom',
  kinds: ['image', 'video', 'tts', 'stt'],
  keyEnv: 'MEDIA_LAB_CUSTOM_KEY',
  defaultBaseURL: '',
  defaultModel: '',
  submit(task, cfg, key) {
    const vars = {
      prompt: task.prompt ?? task.text ?? '', text: task.text ?? task.prompt ?? '', model: cfg.model ?? '',
      voice: task.voice ?? cfg.voice ?? '', size: cfg.size ?? '', seconds: String(task.seconds ?? cfg.seconds ?? ''),
    }
    const fill = (value, escape = v => v) => {
      if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? escape(vars[k]) : m))
      if (Array.isArray(value)) return value.map(v => fill(v, escape))
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, escape)]))
      return value
    }
    // a replacer function, so a key containing `$&` is not read as a replacement pattern
    const headers = { 'content-type': 'application/json', ...Object.fromEntries(Object.entries(cfg.headers ?? {}).map(([k, v]) => [k.toLowerCase(), fill(String(v)).replace(/\{\{key\}\}/g, () => key ?? '')])) }
    if (key && !('authorization' in headers) && cfg.authHeader !== false) headers.authorization = `Bearer ${key}`
    const url = fill(cfg.url ?? cfg.baseURL ?? '', encodeURIComponent)
    if (!/^https?:\/\//i.test(url)) throw new Error('the custom endpoint URL must start with http:// or https://')
    if (templatedHost(cfg.url ?? cfg.baseURL ?? '')) throw new Error('the custom endpoint URL may not put a template variable in its host')
    const body = fill(cfg.body ?? { prompt: '{{prompt}}' })
    // Transcription is an upload: without this the endpoint received a JSON body and no audio, and
    // whatever it answered was reported as the transcript.
    if (task.file) {
      const form = {}
      for (const [k, v] of Object.entries(body && typeof body === 'object' && !Array.isArray(body) ? body : {})) {
        // The default body template is `{ prompt: '{{prompt}}' }`, which fills to '' for a
        // transcription: an empty field is not something to post.
        if (v !== undefined && v !== null && typeof v !== 'object' && String(v).length > 0) form[k] = v
      }
      form[cfg.fileField || 'file'] = task.file
      const language = task.language || cfg.language
      if (language) form.language = language
      // A form is a body, and a GET has none: the configured method is ignored for an upload.
      return { url, method: 'POST', headers, form, expect: cfg.resultType === 'binary' ? 'binary' : 'json' }
    }
    return {
      url,
      method: cfg.method ?? 'POST',
      headers,
      body,
      expect: cfg.resultType === 'binary' ? 'binary' : 'json',
    }
  },
  read(payload, task, cfg, _key) {
    if (payload.status >= 400) return { error: errorText(payload.json, payload.status) }
    const type = cfg.resultType ?? 'base64'
    if (type === 'binary') {
      if (payload.base64) return { done: true, media: { base64: payload.base64, mime: payload.contentType } }
      return { error: payload.json ? errorText(payload.json, payload.status) : 'the custom endpoint returned no body' }
    }
    const raw = cfg.resultPath ? readPath(payload.json, cfg.resultPath) : undefined
    if (type === 'text') {
      const text = typeof raw === 'string' ? raw : readPath(payload.json, 'text')
      return typeof text === 'string' ? { done: true, media: { text } } : { error: 'the custom endpoint returned no text' }
    }
    if (typeof raw === 'string' && raw.length > 0) {
      // The download is on the endpoint's own host in every real deployment: carry its headers, which
      // `scopeHeaders` will still strip if the URL turns out to point somewhere else.
      if (type === 'url') return { done: true, media: { url: raw, headers: task.submitHeaders ?? {} } }
      if (type === 'hex') return { done: true, media: { base64: Buffer.from(raw, 'hex').toString('base64'), mime: cfg.mime } }
      return { done: true, media: { base64: raw.includes(';base64,') ? raw.split(';base64,')[1] : raw, mime: cfg.mime } }
    }
    const media = findMedia(payload.json, { kind: task.kind })
    return media ? { done: true, media } : { error: 'the custom endpoint returned nothing readable at ' + (cfg.resultPath ?? '(no resultPath)') }
  },
}

function mimeForFormat(format) {
  const f = String(format ?? 'mp3').toLowerCase()
  return f === 'wav' ? 'audio/wav' : f === 'opus' ? 'audio/opus' : f === 'flac' ? 'audio/flac' : f === 'aac' ? 'audio/aac' : f === 'pcm' ? 'audio/pcm' : 'audio/mpeg'
}

export const ADAPTERS = {
  image: { 'openai-compatible': openaiImage, openrouter: openrouterImage, gemini: geminiImage, replicate, fal, custom },
  video: { 'openai-video': openaiVideo, openrouter: openrouterVideo, veo, replicate, fal, 'minimax-video': minimaxVideo, custom },
  tts: { 'openai-compatible': openaiTts, elevenlabs: elevenlabsTts, 'fish-audio': fishTts, minimax: minimaxTts, custom },
  stt: { 'openai-compatible': openaiStt, custom },
}

/** Adapter ids offered for a kind, in menu order. */
export function providersFor(kind) {
  return Object.keys(ADAPTERS[kind] ?? {})
}

export function adapterFor(kind, providerId) {
  return ADAPTERS[kind]?.[providerId]
}

/**
 * Drive one adapter to a finished media payload.
 * `fetchImpl(url, init)` must resolve to a Response-like object; `sleep(ms)` is injected so tests
 * run instantly. Returns `{ base64, mime, ext }` or `{ text }` for transcription.
 */
export async function runTask({ kind, task, config, key, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(), signal } = {}) {
  const adapter = adapterFor(kind, config.provider)
  if (!adapter) throw new Error(`no ${kind} adapter named "${config.provider}"`)
  const cfg = {
    ...config,
    baseURL: config.baseURL || adapter.defaultBaseURL,
    model: config.model || adapter.defaultModel,
    // what the caller asked for wins over the configured default (the tools expose these)
    voice: task?.voice || config.voice || adapter.defaultVoice,
    size: task?.size || config.size,
    language: task?.language || config.language,
  }
  if (adapter.keyEnv && !key && !isLocal(cfg.baseURL) && adapter.id !== 'custom') throw new Error(`${config.provider} needs ${adapter.keyEnv}; set it in the media settings`)
  const state = { ...task, kind, key, then: undefined }
  const deadline = now() + Math.max(5000, Number(config.timeoutMs ?? 300000))
  const pollMs = Math.max(500, Number(config.pollMs ?? 3000))
  const maxBytes = Math.max(1, Number(config.maxFileMB ?? 96)) * 1024 * 1024
  // Header names the configuration itself wrote (the custom adapter's idiom): they never travel.
  const userHeaderNames = Object.keys(cfg.headers ?? {}).map(name => name.toLowerCase())
  // Home is what the configuration named: the base URL, the adapter's own documented host, and —
  // for the custom adapter, whose only address is `url` — that endpoint's origin.
  // For the custom adapter the endpoint IS the configuration: a leftover `baseURL` must not
  // nominate a second origin that receives the key on a poll or a download.
  const homeOrigins = adapter.id === 'custom'
    ? new Set([originOf(cfg.url)].filter(Boolean))
    : new Set([originOf(cfg.baseURL), originOf(adapter.defaultBaseURL)].filter(Boolean))

  const request = adapter.submit(state, cfg, key)
  state.submitHeaders = request.headers
  // For a custom endpoint the URL may be templated ({{model}}): home is what submit() produced.
  if (adapter.id === 'custom') { homeOrigins.clear(); if (originOf(request.url)) homeOrigins.add(originOf(request.url)) }
  let payload = await send(request)
  /** An error built from a body a host we did not name returned says the status, not the body. */
  const describe = (result, payload) => (result?.error && payload?.foreign
    ? { error: `the provider's job endpoint answered HTTP ${payload.status}${payload.contentType ? ', ' + payload.contentType : ''}` }
    : result)
  let result = describe(adapter.read(payload, state, cfg, key), payload)
  let poll = null
  while (result && result.done !== true) {
    if (result.error) throw new Error(result.error)
    if (result.poll) { poll = result.poll; state.then = result.then ?? state.then }
    if (!poll) throw new Error('the provider gave no way to poll the job')
    if (now() > deadline) throw new Error(`timed out after ${Math.round(Math.max(5000, Number(config.timeoutMs ?? 300000)) / 1000)}s waiting for the ${kind} job`)
    await sleep(pollMs)
      payload = await send({ url: poll.url, method: poll.method ?? 'GET', headers: poll.headers ?? {}, expect: 'json' }, poll.fallbackUrl, { scope: true })
    result = describe((adapter.readPoll ?? adapter.read)(payload, state, cfg, key), payload)
  }
  const media = result.media
  if (media.text !== undefined) return { text: media.text }
  if (!media.base64 && media.url) {
    const file = await send({ url: media.url, method: 'GET', headers: media.headers ?? {}, expect: 'binary' }, undefined, { scope: true })
    if (file.status >= 400) {
      // Only a host the configuration named may have its body quoted: anywhere else, what came back
      // is whatever that URL served, and this message reaches the model and the panel.
      // `file.foreign` is the answer after redirects; `media.url` is only where the leg started, so
      // a home URL that 302s to another host used to have that host's body quoted back.
      const own = file.foreign !== true
      throw new Error(own
        ? `downloading the result failed: ${errorText(file.json, file.status)}`
        : `downloading the result failed (HTTP ${file.status}${file.contentType ? ', ' + file.contentType : ''})`)
    }
    // Deliberately not the body: what came back is whatever that URL served, and this message
    // reaches the model and the panel.
    if (!file.base64) throw new Error(`the download returned no media (HTTP ${file.status}${file.contentType ? ', ' + file.contentType : ''})`)
    const downloaded = file.contentType || media.mime || DEFAULT_MIME[kind]
    return { base64: file.base64, mime: downloaded, ext: extFor(downloaded, kind), sourceUrl: String(media.url).slice(0, 500) }
  }
  if (!media.base64) throw new Error('the provider returned neither bytes nor a URL')
  const mime = media.mime || DEFAULT_MIME[kind]
  return { base64: media.base64, mime, ext: extFor(mime, kind) }

  /**
   * One request. `scope` is set for every URL that came out of a provider response (polls,
   * downloads): those carry credentials only to a host the configuration named. Redirects are
   * followed by hand — `fetch` would replay the headers on the new host, and undici only strips
   * `Authorization`, not `x-goog-api-key` and friends.
   */
  async function send(req, fallbackUrl, { scope = false } = {}) {
    // `scope` marks a URL that came out of a provider response (a poll or a download): it is checked
    // before the first request, not only on redirect hops.
    if (scope) {
      for (const candidate of [req.url, fallbackUrl].filter(Boolean)) {
        let parsed
        try { parsed = new URL(String(candidate)) } catch { throw new Error(`the provider gave an unreadable URL: ${String(candidate).slice(0, 120)}`) }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`the provider gave a ${parsed.protocol} URL`)
        if (!homeOrigins.has(originOf(candidate)) && (isPrivateAddress(candidate) || await resolvesPrivate(candidate))) {
          throw new Error('the provider pointed at an address on this machine or network; refused')
        }
      }
    }
    const headers = scope ? scopeHeaders(req.headers, req.url, homeOrigins, key, userHeaderNames) : { ...req.headers }

    const init = { method: req.method ?? 'POST', headers, signal, redirect: 'manual' }
    if (req.form) {
      const form = new FormData()
      for (const [k, v] of Object.entries(req.form)) {
        if (v === undefined || v === null) continue
        if (v && typeof v === 'object' && v.bytes) form.append(k, new Blob([v.bytes], { type: v.type ?? 'application/octet-stream' }), v.name ?? 'audio.mp3')
        else form.append(k, String(v))
      }
      init.body = form
      delete init.headers['content-type'] // fetch sets the multipart boundary itself
    } else if (req.body !== undefined && init.method !== 'GET') {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    }
    let url = req.url
    let response = await fetchImpl(url, init)
    let legInit = init
    if (response.status === 404 && fallbackUrl) {
      try { await response.body?.cancel?.() } catch { /* nothing to release */ }
      url = fallbackUrl
      // The fallback is its own leg: a redirect after it must re-scope from these headers, not from
      // the ones the first URL was given.
      legInit = { ...init, headers: scope ? scopeHeaders(req.headers, url, homeOrigins, key, userHeaderNames) : { ...req.headers } }
      response = await fetchImpl(url, legInit)
    }
    // Redirects are followed by hand because `fetch` replays every header on the new host and undici
    // only strips `Authorization` (not `x-goog-api-key` and friends). A hop target is never a URL the
    // configuration named, so the credential rule applies to every hop regardless of `scope`.
    let hopInit = legInit
    for (let hop = 0; response.status >= 300 && response.status < 400; hop++) {
      // Released first: every exit from this block used to leave a redirect's body unconsumed, which
      // in undici can hold the socket until the garbage collector notices.
      const location = response.headers?.get?.('location')
      try { await response.body?.cancel?.() } catch { /* nothing to release */ }
      if (hop >= 5) throw new Error('the provider redirected more than five times')
      if (!location) throw new Error(`the provider answered ${response.status} without a Location header`)
      let next
      try { next = new URL(location, url) } catch { throw new Error('the provider redirected to an unreadable location') }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error(`the provider redirected to a ${next.protocol} URL`)
      url = next.toString()
      if (!homeOrigins.has(originOf(url)) && (isPrivateAddress(url) || await resolvesPrivate(url))) {
        throw new Error('the provider redirected to an address on this machine or network; refused')
      }
      const headers = scopeHeaders(hopInit.headers, url, homeOrigins, key, userHeaderNames)
      hopInit = { ...hopInit, headers }
      // 303, and 301/302 after a POST, continue as a bodyless GET (Fetch semantics): a paid
      // generate call must not be submitted twice, and an audio upload must not be replayed.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && String(hopInit.method).toUpperCase() === 'POST')) {
        hopInit = { ...hopInit, method: 'GET' }
        delete hopInit.body
        delete hopInit.headers['content-type']
      } else if ((response.status === 307 || response.status === 308) && hopInit.body !== undefined && !homeOrigins.has(originOf(url))) {
        // 307/308 keep the method and the body: a prompt, or an uploaded audio file, would be
        // re-sent to a host the configuration never named.
        throw new Error('the provider redirected the request body to another host')
      }
      response = await fetchImpl(url, hopInit)
    }
    const contentType = String(response.headers?.get?.('content-type') ?? '')
    // Where this leg ENDED, and not gated on `scope`: the submit leg is home by construction, so
    // this is only ever true when a redirect took the request somewhere the configuration did not
    // name — and what such a host says is never quoted back to the model.
    const out = { status: response.status, contentType, foreign: !homeOrigins.has(originOf(url)) }
    // Whatever the shape, an oversized body is refused before it is read: the JSON path carries
    // base64 images, which are larger than the file they encode.
    const declaredLength = Number(response.headers?.get?.('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes * 2) {
      try { await response.body?.cancel?.() } catch { /* nothing to release */ }
      throw new Error(`the provider returned ${(declaredLength / 1048576).toFixed(1)} MB, over the ${Math.round(maxBytes / 1048576)} MB limit`)
    }
    const looksLikeText = /application\/json|text\/html|text\/plain|application\/xml/i.test(contentType)
    if (req.expect === 'binary' && response.status < 400 && !looksLikeText) {
      const declared = Number(response.headers?.get?.('content-length') ?? '')
      if (Number.isFinite(declared) && declared > maxBytes) {
        try { await response.body?.cancel?.() } catch { /* nothing to release */ }
        throw new Error(`the provider returned ${(declared / 1048576).toFixed(1)} MB, over the ${Math.round(maxBytes / 1048576)} MB limit`)
      }
      const buf = await readCapped(response, maxBytes)
      out.base64 = buf.toString('base64')
      return out
    }
    // JSON carries base64, which is ~4/3 of the file: allow that much and no more (twice the cap
    // would let a 96 MB setting buffer ~200 MB of text plus its copies).
    const text = (await readCapped(response, Math.ceil(maxBytes * 1.4) + 65536, { as: 'text', limitBytes: maxBytes })).toString('utf8')
    try { out.json = JSON.parse(text) } catch { out.json = { message: text.slice(0, 300) } }
    return out
  }
}

/**
 * Read a response body with a hard cap. A stream is counted as it arrives and aborted the moment it
 * crosses the limit, so a hostile endpoint that declares no length cannot make the harness buffer
 * gigabytes; a body-less response object (the tests, and any fetch shim) falls back to buffering
 * with the same check applied afterwards.
 */
async function readCapped(response, maxBytes, { as = 'bytes', limitBytes = maxBytes } = {}) {
  const over = () => new Error(`the provider returned more than the ${Math.round(limitBytes / 1048576)} MB limit`)
  const reader = response.body?.getReader?.()
  if (!reader) {
    // No stream to count (a fetch shim, or a test double): read the body in the shape asked for.
    if (as === 'text') {
      const text = await response.text()
      const bytes = Buffer.from(text, 'utf8')
      if (bytes.length > maxBytes) throw over()
      return bytes
    }
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.length > maxBytes) throw over()
    return buf
  }
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength ?? (typeof value === 'string' ? Buffer.byteLength(value) : value.length ?? 0)
    if (total > maxBytes) { try { await reader.cancel() } catch { /* already closed */ } throw over() }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function isLocal(url) {
  try { const h = new URL(String(url)).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local') } catch { return false }
}
