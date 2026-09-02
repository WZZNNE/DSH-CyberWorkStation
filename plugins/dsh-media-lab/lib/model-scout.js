/**
 * Model discovery: ask a provider for its model list and sort it by what each model can do, so
 * the image page only offers image models, the TTS page only offers speech models, and so on.
 *
 * Two wire shapes are understood:
 *  - OpenRouter `GET {base}/v1/models`: `data[]` carries `architecture.input_modalities` /
 *    `output_modalities` and `pricing` (USD per token / per image / per request, as strings) —
 *    modality is authoritative and prices are shown per million tokens.
 *  - plain OpenAI-compatible `GET {base}/v1/models`: `data[]` is ids only, so the kind is read
 *    from the id (dall-e / tts / whisper / sora …) and there is no price to show.
 *
 * Pure request/response mapping; `fetchFn` is injectable and the caller owns the credential.
 */

export const SCOUT_KINDS = ['chat', 'image', 'video', 'tts', 'stt']

const str = v => (typeof v === 'string' ? v : '')
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : undefined }

/** USD per token → USD per million tokens, rounded to something readable. */
const perMillion = v => {
  const n = num(v)
  if (n === undefined || n <= 0) return undefined
  return Math.round(n * 1e6 * 1000) / 1000
}

/** What an id alone says about a model, for providers whose list has no modality metadata. */
export function kindFromId(id) {
  const s = str(id).toLowerCase()
  if (/whisper|transcribe|\bstt\b|asr/.test(s)) return 'stt'
  if (/\btts\b|speech|voice|audio-gen/.test(s)) return 'tts'
  if (/sora|veo|video|hailuo|kling|runway|pika/.test(s)) return 'video'
  if (/dall-e|dalle|image|flux|stable-diffusion|\bsdxl\b|imagen|midjourney|banana|photon/.test(s)) return 'image'
  if (/embed|rerank|moderation|guard/.test(s)) return 'other'
  return 'chat'
}

/** OpenRouter `data[]` rows → the scout shape, classified by declared modalities. */
export function normalizeOpenRouterModels(json) {
  const rows = Array.isArray(json?.data) ? json.data : []
  return rows.map(m => {
    const id = str(m?.id)
    if (!id) return null
    const arch = m?.architecture && typeof m.architecture === 'object' ? m.architecture : {}
    const inMod = Array.isArray(arch.input_modalities) ? arch.input_modalities.map(str) : []
    const outMod = Array.isArray(arch.output_modalities) ? arch.output_modalities.map(str) : []
    const pricing = m?.pricing && typeof m.pricing === 'object' ? m.pricing : {}
    const kinds = new Set()
    if (outMod.includes('image')) kinds.add('image')
    if (outMod.includes('video')) kinds.add('video')
    if (outMod.includes('audio')) kinds.add('tts')
    if (inMod.includes('audio') && outMod.includes('text')) kinds.add('stt')
    if (outMod.includes('text')) kinds.add('chat')
    if (kinds.size === 0) kinds.add(kindFromId(id))
    return {
      id,
      name: str(m?.name) || id,
      kinds: [...kinds],
      promptUsdPerM: perMillion(pricing.prompt),
      completionUsdPerM: perMillion(pricing.completion),
      imageUsd: num(pricing.image) || undefined,
      requestUsd: num(pricing.request) || undefined,
    }
  }).filter(Boolean)
}

/** Plain OpenAI-compatible `data[]` rows (ids only) → the scout shape, classified by id. */
export function normalizeOpenAIModels(json) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : []
  return rows.map(m => {
    const id = str(typeof m === 'string' ? m : m?.id ?? m?.name)
    if (!id) return null
    return { id, name: id, kinds: [kindFromId(id)] }
  }).filter(Boolean)
}

/** The rows that belong on one settings page. `kind` outside the roster returns everything. */
export function filterByKind(models, kind) {
  if (!SCOUT_KINDS.includes(kind)) return models
  return models.filter(m => m.kinds.includes(kind))
}

/** One human line of price, or '' when the provider told us nothing. Locale-neutral: the UI localizes its own. */
export function priceLabel(m) {
  if (m.imageUsd !== undefined) return `$${m.imageUsd}/image`
  if (m.promptUsdPerM !== undefined || m.completionUsdPerM !== undefined) {
    return `$${m.promptUsdPerM ?? '?'} in / $${m.completionUsdPerM ?? '?'} out per M`
  }
  if (m.requestUsd !== undefined) return `$${m.requestUsd}/request`
  return ''
}

/**
 * Fetch and classify one provider's models. `baseURL` is the provider host WITHOUT `/v1`
 * (the same convention the adapters use); the key is only attached when given, and the caller
 * decides which credential belongs to this host.
 */
export async function scoutModels({ baseURL, kind, apiKey, fetchFn = fetch, timeoutMs = 15000 }) {
  const base = str(baseURL).replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) throw new Error('the model list needs an http(s) base URL')
  const url = `${base}${base.endsWith('/v1') ? '' : '/v1'}/models`
  const r = await fetchFn(url, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = (await r.text()).slice(0, 8_000_000)
  if (!r.ok) throw new Error(`${new URL(url).hostname} HTTP ${r.status}: ${text.slice(0, 160)}`)
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`${new URL(url).hostname}: non-JSON model list`) }
  const looksOpenRouter = Array.isArray(json?.data) && json.data.some(m => m?.architecture || m?.pricing)
  const models = looksOpenRouter ? normalizeOpenRouterModels(json) : normalizeOpenAIModels(json)
  return filterByKind(models, kind).slice(0, 500)
}
