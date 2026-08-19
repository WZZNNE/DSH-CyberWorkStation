/**
 * Fork addition (MIT, upstream Han-1413141/dsh-cost-meter 1.5.19):
 * provider-aware balance + OpenRouter price auto-sync.
 *
 * 纯函数与网络助手分离:detectProviders/classifyProvider/isLocalEndpoint/
 * openRouterPriceEntry/perMillion 为纯函数(毫秒级可测),两个 query/fetch
 * 助手只对官方固定域名发起请求(openrouter.ai),凭据永不发往其他主机。
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

/** 判断 baseURL 是否指向本地/内网端点(LM Studio、Ollama、vLLM 等)。 */
export function isLocalEndpoint(baseURL) {
  try {
    const host = new URL(String(baseURL)).hostname
    return LOCAL_HOST_PATTERNS.some(re => re.test(host))
  } catch {
    return false
  }
}

/**
 * 按 provider id 与 baseURL 归类:deepseek | openrouter | openai | local | custom。
 * 主机名优先于 id(自定义 id 也能按域名识别);无 baseURL 时按知名 id 兜底。
 */
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

/**
 * 从 DSH settings 读取全部已配置 provider(llm-deepseek 段 + llm-pi-ai.providers 表)。
 * @param settings - 宿主 settings 服务(可为 undefined)。
 * @returns [{ id, kind, baseURL, apiKeyEnv, modelIds }],deepseek 恒在首位(若配置)。
 */
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

/** OpenRouter 官方固定端点(凭据只发往这里)。 */
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/**
 * 查询 OpenRouter 预付 credits(GET /api/v1/credits,官方文档端点)。
 * @param apiKey - OpenRouter API Key(sk-or-*)。
 * @returns 与官方余额同构:{ currency, totalBalance(剩余), grantedBalance(已用), toppedUpBalance(总充值) }。
 */
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
  // totalBalance=剩余,toppedUpBalance=总充值;grantedBalance 固定 0(客户端把该字段
  // 显示为「赠送」,OpenRouter 无此概念;已用 = 充值 − 剩余,且账本另有今日/预算显示)。
  return {
    currency: 'USD',
    totalBalance: round2(Math.max(0, total - used)),
    grantedBalance: 0,
    toppedUpBalance: round2(total),
  }
}

/** USD/token(字符串或数字)→ USD/1M tokens;非法 → null。 */
export function perMillion(perToken) {
  const n = Number(perToken)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 1e6 * 1e6) / 1e6
}

/**
 * 把 OpenRouter models API 的一行映射为价格表条目(input/cachedInput/output,
 * USD per 1M;经上游 normalizePrice 转成 cacheHit/cacheMiss/output 计费字段)。
 */
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

/**
 * 拉取 OpenRouter 全模型目录(公开端点,无需凭据),取出 wanted 模型的价格条目。
 * @param modelIds - 需要定价的模型 id 列表(如 'ai21/jamba-large-1.7')。
 * @returns { entries: { [id]: rawEntry }, missing: string[] }。
 */
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
