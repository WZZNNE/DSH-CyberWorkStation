/**
 * Local backend detection and probing (LM Studio / Ollama). Network access goes
 * through an injectable `fetch` so the logic stays unit-testable.
 *
 * Sources:
 *  - LM Studio REST v0 `GET /api/v0/models` (id, type, arch, state,
 *    max_context_length; no loaded context) and v1 `GET /api/v1/models`
 *    (key, architecture, max_context_length, loaded_instances[].config.context_length,
 *    capabilities.reasoning.allowed_options / default).
 *  - Ollama `GET /api/tags`, `POST /api/show` (model_info.<arch>.context_length,
 *    capabilities incl. "thinking"), `GET /api/ps` (loaded models, context_length).
 */

const LOCAL_HOST_PATTERNS = [
  /^localhost$/i, /^127\./, /^0\.0\.0\.0$/, /^\[?::1\]?$/,
  /^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?f[cd][0-9a-f]{2}:/i, /^\[?fe[89ab][0-9a-f]:/i, // IPv6 unique-local and link-local
  /\.local$/i, /\.lan$/i, /\.internal$/i, /^host\.docker\.internal$/i,
]

/** Whether a provider baseURL points at a machine on the local network. */
export function isLocalBaseUrl(baseURL) {
  try {
    const host = new URL(String(baseURL)).hostname
    return LOCAL_HOST_PATTERNS.some(p => p.test(host))
  } catch { return false }
}

/** Origin (scheme://host:port) of a baseURL such as http://127.0.0.1:1234/v1. */
export function originOf(baseURL) {
  try { return new URL(String(baseURL)).origin } catch { return null }
}

async function getJson(fetchFn, url, init = {}, timeoutMs = 4000) {
  const r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.json()
}

/** Normalise the v1 `capabilities` object ({vision, trained_for_tool_use, reasoning:{allowed_options,default}}) or a legacy string list. */
function readCapabilities(raw) {
  if (Array.isArray(raw)) return { list: raw.map(String), reasoningOptions: undefined, reasoningDefault: undefined }
  if (!raw || typeof raw !== 'object') return { list: [], reasoningOptions: undefined, reasoningDefault: undefined }
  const list = Object.entries(raw).filter(([, v]) => v === true).map(([k]) => k)
  const reasoning = raw.reasoning && typeof raw.reasoning === 'object' ? raw.reasoning : undefined
  const options = Array.isArray(reasoning?.allowed_options) ? reasoning.allowed_options.map(String) : undefined
  if (options !== undefined && options.length > 0) list.push('reasoning')
  return { list, reasoningOptions: options, reasoningDefault: typeof reasoning?.default === 'string' ? reasoning.default : undefined }
}

/** Probe an LM Studio server. Returns null when the origin does not answer like LM Studio. */
export async function probeLmStudio(origin, { fetchFn = fetch, apiKey } = {}) {
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  let v0
  try { v0 = await getJson(fetchFn, `${origin}/api/v0/models`, { headers }) } catch { return null }
  if (!Array.isArray(v0?.data)) return null
  // v1 (the current REST API) carries loaded-instance config and reasoning capabilities; read defensively.
  let v1 = null
  try { v1 = await getJson(fetchFn, `${origin}/api/v1/models`, { headers }, 3000) } catch { /* older LM Studio */ }
  const v1ByKey = new Map()
  const v1List = Array.isArray(v1?.models) ? v1.models : (Array.isArray(v1?.data) ? v1.data : [])
  for (const m of v1List) if (m && typeof m === 'object') v1ByKey.set(String(m.key ?? m.id ?? m.model ?? ''), m)
  const models = v0.data
    .filter(m => m && typeof m === 'object' && (m.type === 'llm' || m.type === 'vlm' || m.type === undefined))
    .map(m => {
      const extra = v1ByKey.get(String(m.id)) ?? {}
      const instances = Array.isArray(extra.loaded_instances) ? extra.loaded_instances : []
      const loadedCtx = firstNumber(instances[0]?.config?.context_length, instances[0]?.context_length, extra.loaded_context_length, m.loaded_context_length)
      const caps = readCapabilities(extra.capabilities)
      return {
        id: String(m.id),
        type: m.type ?? 'llm',
        arch: String(m.arch ?? extra.architecture ?? ''),
        loaded: m.state === 'loaded' || instances.length > 0,
        maxContext: firstNumber(m.max_context_length, extra.max_context_length),
        loadedContext: loadedCtx,
        capabilities: caps.list,
        reasoningOptions: caps.reasoningOptions,
        reasoningDefault: caps.reasoningDefault,
      }
    })
  return { backend: 'lmstudio', origin, models }
}

/** Probe an Ollama server. Returns null when the origin does not answer like Ollama. */
export async function probeOllama(origin, { fetchFn = fetch, showConcurrency = 4, showTimeoutMs = 6000 } = {}) {
  let tags
  try { tags = await getJson(fetchFn, `${origin}/api/tags`) } catch { return null }
  if (!Array.isArray(tags?.models)) return null
  let ps = { models: [] }
  try { ps = await getJson(fetchFn, `${origin}/api/ps`) } catch { /* optional */ }
  const loadedByName = new Map()
  for (const m of Array.isArray(ps?.models) ? ps.models : []) loadedByName.set(String(m.name ?? m.model), m)
  const names = tags.models.map(t => String(t.name ?? t.model))
  // /api/show per model, a few in flight at a time, each bounded — a 30-model library must not take 30 × 6 s.
  const shows = new Array(names.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < names.length) {
      const i = cursor++
      try { shows[i] = await getJson(fetchFn, `${origin}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: names[i] }) }, showTimeoutMs) } catch { shows[i] = {} }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(showConcurrency, names.length)) }, worker))
  const models = names.map((name, i) => {
    const t = tags.models[i]
    const show = shows[i] ?? {}
    const info = show?.model_info && typeof show.model_info === 'object' ? show.model_info : {}
    const ctxKey = Object.keys(info).find(k => /\.context_length$/.test(k))
    const loaded = loadedByName.get(name)
    return {
      id: name,
      type: 'llm',
      arch: String(show?.details?.family ?? t?.details?.family ?? ''),
      loaded: loaded !== undefined,
      maxContext: ctxKey ? firstNumber(info[ctxKey]) : undefined,
      loadedContext: loaded ? firstNumber(loaded.context_length) : undefined,
      capabilities: Array.isArray(show?.capabilities) ? show.capabilities.map(String) : [],
    }
  })
  return { backend: 'ollama', origin, models }
}

/** Probe an origin: LM Studio first, then Ollama; null when neither answers. */
export async function probeOrigin(origin, opts = {}) {
  return (await probeLmStudio(origin, opts)) ?? (await probeOllama(origin, opts))
}

function firstNumber(...values) {
  for (const v of values) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n }
  return undefined
}
