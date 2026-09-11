// dsh-vision-bridge — channels driver.
//
// Resolves a description for one image by walking a list of channels. Each
// channel knows how to push bytes+prompt to a vision model and read the answer.
//
// Channel shapes (config.channels[]):
//   {type:'dsh-catalog', provider, model}
//   {type:'openai-compatible', baseURL, apiKey?, model, protocol?: 'openai-chat'|'openai-responses'}
//   {type:'ollama', baseURL?, model}
//   {type:'custom', baseURL, apiKey?, requestTemplate, responsePath}
//
// Keys are resolved in this order per channel:
//   1. apiKey from the channel entry (if non-empty string)
//   2. process.env[KEY_NAME] where KEY_NAME is each name in config.keysFromEnv
//      (case-sensitive; <PROVIDER>_API_KEY placeholders must be set by the user)
// If both are empty, the channel is treated as anonymous / local.
//
// All network errors are non-fatal: the next channel is tried. When all channels
// fail, the driver returns {ok:false, reason} for the host to decide between
// placeholder text (failureMode='placeholder') and an exception
// (failureMode='error').
//
// ponytail: pure stdlib (fetch + AbortController); no SDK per provider. If we
// ever need streaming of intermediate tokens, that is a bigger rewrite — for
// now, one request, one final string, and the host collects it.

const DEFAULT_KEYS_FROM_ENV = ['VISION_API_KEY', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'ZHIPUAI_API_KEY']

/** Split a possibly comma-separated key string into a clean list. */
function splitKeys(value) {
  return String(value || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

/** All keys for a channel, in priority order: entry apiKey first, then each env var (comma-split). */
export function resolveApiKeys(channelEntry, keysFromEnv = DEFAULT_KEYS_FROM_ENV) {
  const out = []
  if (channelEntry && typeof channelEntry.apiKey === 'string' && channelEntry.apiKey.trim()) {
    out.push(...splitKeys(channelEntry.apiKey))
  }
  for (const name of keysFromEnv) {
    const v = process.env[name]
    if (typeof v === 'string' && v.trim()) out.push(...splitKeys(v))
  }
  return [...new Set(out)] // dedupe, keep order
}

/** Legacy single-key resolver, kept for API compat. */
export function resolveApiKey(channelEntry, keysFromEnv = DEFAULT_KEYS_FROM_ENV) {
  return resolveApiKeys(channelEntry, keysFromEnv)[0] || ''
}

export async function probeOllama(baseURL = 'http://localhost:11434/v1') {
  try {
    const res = await fetch(baseURL.replace(/\/v1\/?$/, '') + '/api/tags', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const models = Array.isArray(data && data.models) ? data.models : []
    const first = models.find((m) => m && m.name)
    return first ? first.name : null
  } catch {
    return null
  }
}

/** Single attempt: send bytes+prompt to one channel, return {ok, description} or {ok:false, reason, status}. */
export async function runChannel(channel, {bytes, contentType, images, catalog, prompt, model, timeoutMs, signal, detail, stream}) {
  const t = channel && channel.type
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('vision channel timeout')), Math.max(1, timeoutMs || 30000))
  try {
    if (controller.signal.aborted) throw controller.signal.reason
    const bounded = controller.signal
    if (t === 'dsh-catalog') return typeof catalog === 'function'
      ? await catalog(channel, { images, prompt, signal: bounded })
      : {ok: false, reason: 'dsh-catalog runs through ctx.llm, not here'}
    if (t === 'openai-compatible' || t === 'ollama') return await runOpenAIChat({channel, bytes, contentType, images, prompt, model, signal: bounded, detail, stream})
    if (images?.length > 1) return {ok: false, reason: `${t}: multiple image input is not supported by this channel protocol`}
    if (t === 'custom') return await runCustom({channel, bytes, contentType, prompt, model, signal: bounded})
    if (t === 'webhook') return await runWebhook({channel, bytes, contentType, prompt, model, signal: bounded})
    return {ok: false, reason: 'unknown channel type: ' + String(t)}
  } catch (error) {
    return {ok: false, reason: error && error.message ? error.message : String(error), ...(signal?.aborted ? { cancelled: true } : {})}
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

// Block 0.4.0 (#84): webhook channel — POST image to user-provided URL, expect {description} JSON.
async function runWebhook({channel, bytes, contentType, prompt, model, timeoutMs, signal}) {
  const url = channel.baseURL || channel.url
  if (!url) return {ok: false, reason: 'webhook: baseURL (or url) is required'}
  const apiKey = resolveApiKey(channel)
  const headers = {'Content-Type': 'application/json'}
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey
  const body = JSON.stringify({
    image: buildDataUrl(bytes, contentType),
    mime: contentType || 'image/png',
    prompt: prompt || '',
    ...(model ? {model} : {}),
  })
  const res = await fetch(url, { method: 'POST', headers, body, signal })
  if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
    return {ok: false, reason: 'http ' + res.status, status: res.status}
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {ok: false, reason: 'http ' + res.status + ': ' + text.slice(0, 200)}
  }
  const data = await res.json().catch(() => null)
  // Accept {description}, {text}, or {result} as response shapes.
  const description = data?.description ?? data?.text ?? data?.result
  if (typeof description !== 'string' || !description.trim()) {
    return {ok: false, reason: 'webhook returned no description'}
  }
  return {ok: true, description: description.trim()}
}

function buildDataUrl(bytes, contentType) {
  const mime = contentType || 'image/png'
  return 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64')
}

// #93: map endpoint content-safety rejections to VISION_CONTENT_FILTERED instead
// of a generic backend error. Matched on common markers in the response body.
const CONTENT_FILTERED_RE = /content_?filter|safety|inappropriate|violat(?:e|ion)|refus|blocked by our/i

async function runOpenAIChat({channel, bytes, contentType, images, prompt, model, signal, detail, stream}) {
  const baseURL = (channel.baseURL || (channel.type === 'ollama' ? 'http://localhost:11434/v1' : '')).replace(/\/+$/, '')
  if (!baseURL) return {ok: false, reason: 'openai-compatible: baseURL is required'}
  const keys = resolveApiKeys(channel)
  const useModel = model || channel.model
  if (!useModel) return {ok: false, reason: 'openai-compatible: model is required'}
  const inputs = images?.length ? images : [{ bytes, contentType }]
  const body = {
    model: useModel,
    messages: [{role: 'user', content: [
      {type: 'text', text: prompt},
      ...inputs.map(image => ({type: 'image_url', image_url: {url: buildDataUrl(image.bytes, image.contentType), ...(detail ? {detail} : {})}})),
    ]}],
    max_tokens: 1024,
    // #106: streaming — faster first token, better UX. Non-stream fallback kept.
    ...(stream ? {stream: true} : {}),
  }
  // #86/#89/#92: rotate keys on auth/rate-limit/quota; Retry-After-aware backoff.
  const keysToTry = keys.length ? keys : ['']
  let lastStatus = 0, lastRetry = 0
  for (let i = 0; i < keysToTry.length; i++) {
    const apiKey = keysToTry[i]
    const headers = {'Content-Type': 'application/json'}
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey
    const res = await fetch(baseURL + '/chat/completions', {
      method: 'POST', headers, body: JSON.stringify(body),
      signal,
    })
    if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
      lastStatus = res.status
      const ra = Number(res.headers?.get?.('retry-after'))
      if (Number.isFinite(ra) && ra > 0 && ra > lastRetry) lastRetry = ra
      if (i < keysToTry.length - 1) continue // try next key
      return {ok: false, reason: 'http ' + res.status + (lastRetry ? ' (retry-after ' + lastRetry + 's)' : ''), status: res.status, retryAfterSec: lastRetry || undefined}
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (CONTENT_FILTERED_RE.test(text)) {
        return {ok: false, reason: 'VISION_CONTENT_FILTERED', code: 'VISION_CONTENT_FILTERED', status: res.status}
      }
      return {ok: false, reason: 'http ' + res.status + ': ' + text.slice(0, 200)}
    }
    // #106: stream path — collect SSE deltas.
    if (stream) {
      const {content, usage} = await collectStreamDeltas(res)
      if (content === null) {
        return {ok: false, reason: 'empty completion'}
      }
      return {ok: true, description: content, keyUsed: apiKey ? apiKey.slice(0, 8) + '…' : '(no key)', usage}
    }
    const data = await res.json().catch(() => null)
    if (CONTENT_FILTERED_RE.test(JSON.stringify(data || {}))) {
      return {ok: false, reason: 'VISION_CONTENT_FILTERED', code: 'VISION_CONTENT_FILTERED', status: res.status}
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (typeof content !== 'string' || !content.trim()) {
      return {ok: false, reason: 'empty completion'}
    }
    // #98: label which key this read consumed for quota attribution.
    // #107: real token usage from the provider response (accurate cost).
    const usage = data && data.usage
    return {ok: true, description: content.trim(), keyUsed: apiKey ? apiKey.slice(0, 8) + '…' : '(no key)', usage}
  }
  return {ok: false, reason: 'openai-compatible: no keys succeeded', status: lastStatus || undefined, retryAfterSec: lastRetry || undefined}
}

// #106: read an SSE stream of chat.completion.chunk events and concatenate the
// text deltas. Returns {content, usage} where content is null when no text was
// produced. Handles both `data:` lines and the final `[DONE]` sentinel;
// tolerates providers that omit it. Some providers include `usage` in the last
// chunk — captured when present (#107).
async function collectStreamDeltas(res) {
  if (!res || !res.body) return {content: null, usage: undefined}
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let out = ''
  let usage
  try {
    for (;;) {
      const {done, value} = await reader.read()
      if (done) break
      buffer += decoder.decode(value, {stream: true})
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return {content: out.trim() || null, usage}
        let chunk
        try { chunk = JSON.parse(payload) } catch { continue }
        if (chunk && chunk.usage) usage = chunk.usage
        const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content
        if (typeof delta === 'string') out += delta
      }
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
  return {content: out.trim() || null, usage}
}

async function runCustom({channel, bytes, contentType, prompt, model, timeoutMs, signal}) {
  if (!channel.baseURL) return {ok: false, reason: 'custom: baseURL is required'}
  if (!channel.requestTemplate) return {ok: false, reason: 'custom: requestTemplate is required'}
  if (!channel.responsePath) return {ok: false, reason: 'custom: responsePath is required'}
  const apiKey = resolveApiKey(channel)
  const useModel = model || channel.model || ''
  const dataUrl = buildDataUrl(bytes, contentType)
  const pureBase64 = Buffer.from(bytes).toString('base64')
  const mime = contentType || 'image/png'
  const rawTemplate = String(channel.requestTemplate)
  // Ponytail: very small placeholder substitution. JSON values must be written
  // unquoted in the template ({{model}}, {{prompt}}, {{image}}, {{dataUrl}},
  // {{mime}}). Quoting them in the template yields ""..."" — user's bug, not ours.
  const bodyStr = rawTemplate
    .replace(/\{\{model\}\}/g, () => JSON.stringify(useModel))
    .replace(/\{\{prompt\}\}/g, () => JSON.stringify(prompt))
    .replace(/\{\{dataUrl\}\}/g, () => JSON.stringify(dataUrl))
    .replace(/\{\{image\}\}/g, () => JSON.stringify(pureBase64))
    .replace(/\{\{mime\}\}/g, () => JSON.stringify(mime))
  const headers = {'Content-Type': 'application/json'}
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey
  const res = await fetch(channel.baseURL, {
    method: 'POST',
    headers,
    body: bodyStr,
    signal,
  })
  if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
    return {ok: false, reason: 'http ' + res.status, status: res.status}
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {ok: false, reason: 'http ' + res.status + ': ' + text.slice(0, 200)}
  }
  const data = await res.json().catch(() => null)
  const value = pickByPath(data, channel.responsePath)
  if (typeof value !== 'string' || !value.trim()) return {ok: false, reason: 'responsePath did not yield a string'}
  return {ok: true, description: value.trim()}
}

function pickByPath(obj, path) {
  if (!obj || !path) return undefined
  const parts = String(path).split('.').filter(Boolean)
  let cur = obj
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined
    cur = /^\d+$/.test(p) ? cur[Number(p)] : cur[p]
  }
  return cur
}

/**
 * Walk a list of channels sequentially until one returns ok=true. Per-channel
 * cooldown: a channel that failed recently is skipped for cooldownMs.
 *
 * @param {Array<object>} channels  config.channels[]
  * @param {object} ctx  {bytes, contentType, prompt, timeoutMs, cooldownMs, signal, llm, attachments, fallback}
 * @returns {Promise<{ok:boolean, description?:string, provider?:string, model?:string, channel?:object, reason?:string, attempts?:Array}>}
 */
export async function runChannels(channels, ctx) {
  const cooldowns = ctx.cooldowns instanceof Map ? ctx.cooldowns : new Map()
  const mode = ctx.fallback || 'sequential'
  const attempts = []

  // #87: prioritized failover — stable sort by tier (higher = preferred), then keep declaration order.
  channels = channels.slice().sort((a, b) => (b.tier || 0) - (a.tier || 0))

  // Block 5 (0.2.10): parallel-race — all channels at once, first ok wins.
  if (mode === 'parallel-race') {
    const eligible = []
    for (const channel of channels) {
      const key = channelKey(channel)
      const expiresAt = cooldowns.get(key) || 0
      if (Date.now() < expiresAt) { attempts.push({channel: key, skipped: 'cooldown'}); continue }
      eligible.push({channel, key})
    }
    if (eligible.length === 0) return {ok: false, reason: 'all channels failed', attempts}
    const controllers = eligible.map(() => new AbortController())
    const runners = eligible.map(({channel, key}, index) => runChannel(channel, {
      bytes: ctx.bytes,
      contentType: ctx.contentType,
      images: ctx.images,
      catalog: ctx.catalog,
      prompt: ctx.prompt,
      model: ctx.model,
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal ? AbortSignal.any([ctx.signal, controllers[index].signal]) : controllers[index].signal,
      detail: ctx.detail,
      stream: ctx.stream,
    }).then(r => {
      const cancelled = r.cancelled || ctx.signal?.aborted || controllers[index].signal.aborted
      attempts.push({ channel: key, ok: !!r.ok && !cancelled, ...(r.reason ? { reason: r.reason } : {}), ...(cancelled ? { cancelled: true } : {}) })
      if (r.ok && !cancelled) return { ...r, channel, key, index }
      if (!cancelled && ctx.cooldownMs > 0) cooldowns.set(key, Date.now() + ctx.cooldownMs)
      throw new Error(r.reason || (cancelled ? 'cancelled' : 'channel failed'))
    }))
    try {
      const winner = await Promise.any(runners)
      for (let index = 0; index < controllers.length; index++) if (index !== winner.index) controllers[index].abort(new Error('another vision channel succeeded'))
      return {ok: true, description: winner.description, channel: winner.channel, attempts: attempts.map(a => ({ ...a })), keyUsed: winner.keyUsed, usage: winner.usage}
    } catch (e) {
      return {ok: false, reason: ctx.signal?.aborted ? 'cancelled' : 'all channels failed', attempts: attempts.map(a => ({ ...a }))}
    }
  }

  for (const channel of channels) {
    const key = channelKey(channel)
    const expiresAt = cooldowns.get(key) || 0
    if (Date.now() < expiresAt) {
      attempts.push({channel: key, skipped: 'cooldown'})
      continue
    }
    const attempt = await runChannel(channel, {
      bytes: ctx.bytes,
      contentType: ctx.contentType,
      images: ctx.images,
      catalog: ctx.catalog,
      prompt: ctx.prompt,
      model: ctx.model,
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      detail: ctx.detail,
      stream: ctx.stream,
    })
    // #98: tag each read with the key/quota it spent.
    const entry = {channel: key, ok: !!attempt.ok, reason: attempt.reason, status: attempt.status}
    if (attempt.ok && attempt.keyUsed) entry.key = attempt.keyUsed
    if (attempt.ok) entry.code = attempt.code
    attempts.push(entry)
    if (attempt.ok) {
      return {ok: true, description: attempt.description, channel, attempts, keyUsed: attempt.keyUsed, usage: attempt.usage}
    }
    if (!attempt.cancelled && !ctx.signal?.aborted && ctx.cooldownMs > 0) {
      cooldowns.set(key, Date.now() + ctx.cooldownMs)
    }
  }
  return {ok: false, reason: 'all channels failed', attempts}
}

export function channelKey(channel) {
  if (!channel) return '?'
  const t = channel.type || '?'
  if (t === 'dsh-catalog') return 'dsh-catalog:' + (channel.provider || '') + '/' + (channel.model || '')
  if (t === 'ollama') return 'ollama:' + (channel.baseURL || 'http://localhost:11434/v1') + '/' + (channel.model || '')
  if (t === 'openai-compatible') return 'openai-compatible:' + (channel.baseURL || '') + '/' + (channel.model || '')
  if (t === 'custom') return 'custom:' + (channel.baseURL || '') + '/' + (channel.model || '')
  if (t === 'webhook') return 'webhook:' + (channel.baseURL || channel.url || '')
  return t + ':?'
}
