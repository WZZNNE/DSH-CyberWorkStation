/**
 * Fork module: provider detection from the llm-pi-ai settings (OpenRouter, OpenAI,
 * local endpoints such as LM Studio / Ollama), OpenRouter balance and price lookups.
 */
const LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/i,
  /\.lan$/i,
  /^host\.docker\.internal$/i,
]

export function isLocalEndpoint(baseURL) {
  try {
    const host = new URL(String(baseURL)).hostname
    return LOCAL_HOST_PATTERNS.some(re => re.test(host))
  } catch {
    return false
  }
}

export function classifyProvider(id, baseURL) {
  let host = ''
  try { host = new URL(String(baseURL ?? '')).hostname.toLowerCase() } catch { host = '' }
  if (host === 'api.deepseek.com') return 'deepseek'
  if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter'
  if (host === 'api.openai.com') return 'openai'
  if (host !== '' && isLocalEndpoint(baseURL)) return 'local'
  if (host === '') {
    const key = String(id ?? '').toLowerCase()
    if (key === 'deepseek' || key === 'deepseek-official') return 'deepseek'
    if (key === 'openrouter') return 'openrouter'
    if (key === 'openai') return 'openai'
    if (key === 'lmstudio' || key === 'lm-studio' || key === 'ollama' || key === 'vllm' || key === 'local') return 'local'
  }
  return 'custom'
}

export function detectProviders(settings) {
  const get = name => (typeof settings?.get === 'function' ? settings.get(name) : undefined)
  const out = []
  const ds = get('llm-deepseek')
  if (ds !== null && typeof ds === 'object') {
    out.push({
      id: 'deepseek',
      kind: 'deepseek',
      baseURL: ds.baseURL,
      apiKeyEnv: typeof ds.apiKeyEnv === 'string' && ds.apiKeyEnv.length > 0 ? ds.apiKeyEnv : 'DEEPSEEK_API_KEY',
      modelIds: [],
    })
  }
  const providers = get('llm-pi-ai')?.providers
  if (providers !== null && typeof providers === 'object') {
    for (const [id, cfg] of Object.entries(providers)) {
      if (cfg === null || typeof cfg !== 'object') continue
      const modelIds = Array.isArray(cfg.models)
        ? cfg.models.map(m => (typeof m === 'string' ? m : m?.id)).filter(v => typeof v === 'string' && v.length > 0)
        : []
      out.push({
        id,
        kind: classifyProvider(id, cfg.baseURL),
        baseURL: cfg.baseURL,
        apiKeyEnv: typeof cfg.apiKeyEnv === 'string' && cfg.apiKeyEnv.length > 0 ? cfg.apiKeyEnv : undefined,
        modelIds,
      })
    }
  }
  return out
}

export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

export async function queryOpenRouterBalance(apiKey) {
  const response = await fetch(OPENROUTER_CREDITS_URL, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`OpenRouter credits API HTTP ${response.status}`)
  const data = await response.json()
  const d = data?.data !== null && typeof data?.data === 'object' ? data.data : data
  const total = Number(d?.total_credits)
  const used = Number(d?.total_usage)
  if (!Number.isFinite(total) || !Number.isFinite(used)) {
    throw new Error('OpenRouter credits response is missing total_credits/total_usage')
  }
  const round2 = v => Math.round(v * 100) / 100
  return {
    currency: 'USD',
    totalBalance: round2(Math.max(0, total - used)),
    grantedBalance: 0,
    toppedUpBalance: round2(total),
  }
}

export function perMillion(perToken) {
  const n = Number(perToken)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 1e6 * 1e6) / 1e6
}

export function openRouterPriceEntry(row) {
  const pricing = row?.pricing
  if (pricing === null || typeof pricing !== 'object') return null
  const input = perMillion(pricing.prompt)
  const output = perMillion(pricing.completion)
  if (input === null || output === null) return null
  const cached = perMillion(pricing.input_cache_read)
  return {
    input,
    ...(cached !== null ? { cachedInput: cached } : {}),
    output,
    billingMode: 'flat',
    sourceUrl: OPENROUTER_MODELS_URL,
    checkedAt: new Date().toISOString().slice(0, 10),
    notes: 'auto-synced from OpenRouter models API',
  }
}

export async function fetchOpenRouterPriceEntries(modelIds) {
  const wanted = new Set(modelIds)
  const response = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`OpenRouter models API HTTP ${response.status}`)
  const data = await response.json()
  const rows = Array.isArray(data?.data) ? data.data : []
  const entries = {}
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id : ''
    if (!wanted.has(id)) continue
    const entry = openRouterPriceEntry(row)
    if (entry !== null) entries[id] = entry
  }
  const missing = [...wanted].filter(id => entries[id] === undefined)
  return { entries, missing }
}
