/**
 * Coding-plan quota providers (Anthropic, OpenCode Go, SCNet Token Plan, ...):
 * per-provider endpoints, credential discovery, response parsing into usage
 * windows, plus the configurable custom-balance HTTP adapter entry points.
 */
export const CODING_PLAN_PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude Pro/Max)',
    credentialEnvs: ['ANTHROPIC_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
    keyHint: 'Claude Code OAuth access token(~/.claude/.credentials.json)',
  },
  zai: {
    label: 'Z.ai / 智谱 GLM Coding Plan',
    credentialEnvs: ['ZAI_API_KEY', 'BIGMODEL_API_KEY'],
    keyHint: 'Coding Plan 专属 API Key(z.ai / bigmodel.cn 控制台)',
  },
  minimax: {
    label: 'MiniMax Token Plan',
    credentialEnvs: ['MINIMAX_API_KEY'],
    keyHint: 'MiniMax API Key(sk-* / sk-cp-*)',
  },
  kimi: {
    label: 'Kimi / Moonshot',
    credentialEnvs: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    keyHint: 'Moonshot 开放平台 API Key(sk-*;Kimi Code 订阅周窗暂无 API-Key 化端点,此处显示 PAYG 余额)',
  },
  openrouter: {
    label: 'OpenRouter',
    credentialEnvs: ['OPENROUTER_API_KEY'],
    keyHint: 'OpenRouter API Key(sk-or-*;显示预付 credits 已用%)',
  },
  siliconflow: {
    label: 'SiliconFlow 硅基流动',
    credentialEnvs: ['SILICONFLOW_API_KEY'],
    keyHint: 'SiliconFlow API Key(sk-*;显示账户余额)',
  },
  scnet: {
    label: 'SCNet 超算互联网 Token Plan',
    credentialEnvs: [],
    keyHint: '无需凭据:按官方 Credits 抵扣表(2026-08-11 生效)由本地账本估算月度用量',
  },
}

export const CODING_PLAN_PROVIDER_IDS = Object.keys(CODING_PLAN_PROVIDERS)

export function normalizePercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  const pct = n <= 1 ? n * 100 : n
  return Math.min(100, Math.round(pct * 10) / 10)
}

export function normalizeResetAt(value) {
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
    const asNum = Number(value)
    if (Number.isFinite(asNum) && asNum > 0) return new Date(asNum > 1e12 ? asNum : asNum * 1000).toISOString()
    return ''
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return new Date(n > 1e12 ? n : n * 1000).toISOString()
}

function windowOf(percent, resetsAt) {
  const pct = normalizePercent(percent)
  if (pct === null) return null
  return { percent: pct, resetsAt: normalizeResetAt(resetsAt) }
}

function textWindowOf(text) {
  const s = typeof text === 'string' ? text.trim() : String(text ?? '').trim()
  return s.length > 0 ? { resetsAt: '', text: s } : null
}

export function parseAnthropicUsage(data) {
  if (data === null || typeof data !== 'object') return null
  const windows = {}
  for (const [name, raw] of Object.entries(data)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const win = windowOf(raw.utilization ?? raw.used_percentage, raw.resets_at ?? raw.reset_at)
    if (win !== null) windows[name] = win
  }
  return Object.keys(windows).length > 0 ? windows : null
}

export function parseZaiUsage(data) {
  if (data === null || typeof data !== 'object') return null
  const windows = {}
  if (Array.isArray(data.plans)) {
    for (const plan of data.plans) {
      if (plan === null || typeof plan !== 'object') continue
      const total = Number(plan.total_units)
      const used = Number(plan.used_units)
      let pct = null
      if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) {
        pct = Math.min(100, (used / total) * 100)
      } else {
        pct = normalizePercent(plan.utilization ?? plan.percent ?? plan.used_percentage)
      }
      if (pct === null) continue
      const spanMs = Number(plan.period_end) * 1000 - Date.now()
      const key = Number.isFinite(spanMs) && spanMs > 24 * 3600_000 ? 'weekly' : 'fiveHour'
      windows[key] = { percent: Math.round(pct * 10) / 10, resetsAt: normalizeResetAt(plan.period_end) }
    }
  }
  for (const [name, raw] of Object.entries(data)) {
    if (name === 'plans' || raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const win = windowOf(raw.utilization ?? raw.percent ?? raw.used_percentage, raw.resets_at ?? raw.reset_at ?? raw.resetsAt)
    if (win !== null) windows[name] = win
  }
  return Object.keys(windows).length > 0 ? windows : null
}

function clampPct(p) {
  return Math.max(0, Math.min(100, Math.round(p * 10) / 10))
}

function remainingPercentOf(row, remainPctKey, totalKey, usedKey, remainKey) {
  if (row === null || typeof row !== 'object') return null
  const rp = Number(row[remainPctKey])
  if (Number.isFinite(rp)) return Math.min(100, Math.max(0, rp <= 1 ? rp * 100 : rp))
  const total = Number(row[totalKey])
  const used = Number(row[usedKey])
  const remain = Number(row[remainKey])
  if (Number.isFinite(total) && total > 0) {
    if (Number.isFinite(remain)) return (remain / total) * 100
    if (Number.isFinite(used)) return ((total - used) / total) * 100
  }
  return null
}

function windowsFromMiniMaxRecord(row) {
  if (row === null || typeof row !== 'object') return {}
  const windows = {}
  if (Number(row.current_interval_status) !== 3) {
    const remain = remainingPercentOf(
      row,
      'current_interval_remaining_percent',
      'current_interval_total_count',
      'current_interval_usage_count',
      'current_interval_remain_count',
    )
    if (remain !== null) {
      windows['5h'] = {
        percent: clampPct(100 - remain),
        resetsAt: normalizeResetAt(row.end_time ?? row.reset_time ?? row.next_reset_time),
      }
    }
  }
  if (Number(row.current_weekly_status) !== 3) {
    const remain = remainingPercentOf(
      row,
      'current_weekly_remaining_percent',
      'current_weekly_total_count',
      'current_weekly_usage_count',
      'current_weekly_remain_count',
    )
    if (remain !== null) {
      windows['7d'] = {
        percent: clampPct(100 - remain),
        resetsAt: normalizeResetAt(row.weekly_end_time),
      }
    }
  }
  return windows
}

function pickMiniMaxModelRow(rows) {
  const list = rows.filter(row => row !== null && typeof row === 'object')
  const byName = name => list.find(row => String(row.model_name ?? '').toLowerCase() === name)
  return byName('general')
    ?? list.find(row => /^minimax-m/i.test(String(row.model_name ?? '')))
    ?? list.find(row => Object.keys(windowsFromMiniMaxRecord(row)).length > 0)
    ?? list[0]
    ?? null
}

export function parseMiniMaxRemains(data) {
  if (data === null || typeof data !== 'object') return null
  const payload = data.data !== null && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data
  const pickArray = (...keys) => {
    for (const key of keys) {
      const direct = Array.isArray(data?.[key]) ? data[key] : null
      const nested = Array.isArray(data?.data?.[key]) ? data.data[key] : null
      if (direct !== null) return direct
      if (nested !== null) return nested
    }
    return null
  }

  const modelRows = pickArray('model_remains')
  if (modelRows !== null) {
    const row = pickMiniMaxModelRow(modelRows)
    const fromRow = windowsFromMiniMaxRecord(row)
    if (Object.keys(fromRow).length > 0) return fromRow
    let total = 0
    let used = 0
    let found = false
    for (const item of modelRows) {
      if (item === null || typeof item !== 'object') continue
      const t = Number(item.current_interval_total_count ?? item.total)
      const u = Number(item.current_interval_usage_count ?? item.used)
      if (!Number.isFinite(t) || t <= 0) continue
      found = true
      total += t
      used += Number.isFinite(u) ? u : 0
    }
    if (found && total > 0) {
      return { current: { percent: Math.min(100, Math.round((used / total) * 1000) / 10), resetsAt: '' } }
    }
  }

  const flat = windowsFromMiniMaxRecord(payload)
  if (Object.keys(flat).length > 0) return flat

  const windows = {}
  const planRows = pickArray('token_plan_remains', 'plan_remains', 'remains', 'windows')
  if (planRows !== null) {
    planRows.forEach((row, index) => {
      if (row === null || typeof row !== 'object') return
      const total = Number(row.current_interval_total_count ?? row.total_count ?? row.total ?? row.limit)
      const used = Number(row.current_interval_usage_count ?? row.used_count ?? row.usage_count ?? row.used)
      const remain = Number(row.current_interval_remain_count ?? row.remain_count ?? row.remain ?? row.remaining)
      let pct = null
      if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) pct = (used / total) * 100
      else if (Number.isFinite(total) && total > 0 && Number.isFinite(remain)) pct = ((total - remain) / total) * 100
      else pct = normalizePercent(row.utilization ?? row.percent ?? row.used_percentage)
      if (pct === null) return
      const labelRaw = row.interval ?? row.interval_type ?? row.window_type ?? row.type ?? row.name
      const label = typeof labelRaw === 'string' && labelRaw.length > 0 ? labelRaw : 'window' + String(index + 1)
      windows[label] = {
        percent: Math.max(0, Math.min(100, Math.round(pct * 10) / 10)),
        resetsAt: normalizeResetAt(row.reset_time ?? row.resets_at ?? row.next_reset_time ?? row.reset_at),
      }
    })
  }
  return Object.keys(windows).length > 0 ? windows : null
}

export function parseKimiBalance(data) {
  if (data === null || typeof data !== 'object') return null
  const raw = data.available_balance ?? data.balance ?? data.cash_balance ?? data.data?.available_balance
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  const cny = n >= 100 ? n / 100 : n
  const text = '余额 ¥' + (Math.round(cny * 100) / 100).toFixed(2)
  const win = textWindowOf(text)
  return win === null ? null : { balance: win }
}

export function parseOpenRouterCredits(data) {
  if (data === null || typeof data !== 'object') return null
  const d = data.data !== null && typeof data.data === 'object' ? data.data : data
  const total = Number(d.total_credits ?? d.credits)
  const used = Number(d.total_usage ?? d.usage)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null
  const pct = Math.max(0, Math.min(100, Math.round((used / total) * 1000) / 10))
  return { credits: { percent: pct, resetsAt: normalizeResetAt(d.resets_at ?? d.next_reset_time) } }
}

export function parseSiliconFlowInfo(data) {
  if (data === null || typeof data !== 'object') return null
  const d = data.data !== null && typeof data.data === 'object' ? data.data : data
  const raw = d.balance ?? d.amount ?? d.remain ?? d.remaining
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  const win = textWindowOf('余额 ¥' + (Math.round(n * 100) / 100).toFixed(2))
  return win === null ? null : { balance: win }
}

//

export const SCNET_CREDIT_RATES = {
  'GLM-5.2': { input: 7543, cachedInput: 189, output: 26400 },
  'GLM-5.1': { input: 8743, cachedInput: 175, output: 32057 },
  'GLM-5': { input: 8743, cachedInput: 175, output: 32057 },
  'DeepSeek-V4-Pro': { input: 10286, cachedInput: 86, output: 20571 },
  'DeepSeek-V4-Flash': { input: 1200, cachedInput: 24, output: 2400 },
  'DeepSeek-V4-Flash-0731': { input: 1543, cachedInput: 31, output: 3086 },
  'Kimi-K3': { input: 34286, cachedInput: 343, output: 171429 },
  'Kimi-K2.7-Code': { input: 8357, cachedInput: 167, output: 34714 },
  'Kimi-K2.6': { input: 8357, cachedInput: 167, output: 34714 },
  'Kimi-K2.5': { input: 5143, cachedInput: 103, output: 27000 },
  'MiniMax-M3': { input: 3600, cachedInput: 72, output: 14400 },
  'MiniMax-M2.7': { input: 3600, cachedInput: 72, output: 14400 },
  'MiniMax-M2.5': { input: 2520, cachedInput: 50, output: 10080 },
  'Qwen3.8-max': { input: 18514, cachedInput: 231, output: 49371 },
}

export const SCNET_TOKEN_PLANS = [
  { id: 'basic', credits: 60000 },
  { id: 'standard', credits: 240000 },
  { id: 'pro', credits: 600000 },
]

export function scnetCanonModelId(modelId) {
  return String(modelId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const SCNET_RATE_BY_CANON = Object.fromEntries(
  Object.entries(SCNET_CREDIT_RATES).map(([id, rate]) => [scnetCanonModelId(id), rate]),
)

export function scnetModelCredits(tokens, rate) {
  const num = value => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const missInput = num(tokens?.input) + num(tokens?.cacheWrite)
  return (missInput * rate.input + num(tokens?.cacheRead) * rate.cachedInput + num(tokens?.output) * rate.output) / 1_000_000
}

export function scnetPlanPeriod(nowMs, planStart) {
  const now = new Date(Number.isFinite(Number(nowMs)) ? nowMs : Date.now())
  const pad = n => String(n).padStart(2, '0')
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  let start = null
  if (typeof planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(planStart)) {
    const parsed = new Date(`${planStart}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) start = parsed
  }
  if (start === null) start = new Date(now.getFullYear(), now.getMonth(), 1)
  const addMonth = d => {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const day = Math.min(d.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())
    next.setDate(day)
    return next
  }
  let end = addMonth(start)
  let guard = 0
  while (now.getTime() >= end.getTime() && guard < 1200) {
    start = end
    end = addMonth(start)
    guard += 1
  }
  const last = new Date(end.getTime() - 1)
  return { fromKey: keyOf(start), toKeyInclusive: keyOf(last), resetsAt: last.toISOString() }
}

export function scnetTokenPlanWindows(days, entry, nowMs) {
  const total = Number(entry?.planCredits)
  if (!Number.isFinite(total) || total <= 0) return null
  const period = scnetPlanPeriod(nowMs, entry?.planStart)
  const byModel = {}
  let used = 0
  for (const [date, day] of Object.entries(days ?? {})) {
    if (typeof date !== 'string' || date < period.fromKey || date > period.toKeyInclusive) continue
    for (const [pmKey, buckets] of Object.entries(day?.byProviderModel ?? {})) {
      const model = pmKey.includes(':') ? pmKey.slice(pmKey.indexOf(':') + 1) : pmKey
      const canon = scnetCanonModelId(model)
      const rate = SCNET_RATE_BY_CANON[canon]
      if (rate === undefined || buckets === null || typeof buckets !== 'object') continue
      const credits = scnetModelCredits(buckets, rate)
      used += credits
      byModel[canon] = (byModel[canon] ?? 0) + credits
    }
  }
  const percent = Math.min(100, Math.round((used / total) * 1000) / 10)
  const fmt = n => Math.round(n).toLocaleString('en-US')
  return {
    used,
    total,
    percent,
    resetsAt: period.resetsAt,
    byModel,
    windows: {
      monthly: { percent, resetsAt: period.resetsAt },
      credits: { resetsAt: '', text: `${fmt(used)} / ${fmt(total)} Credits (est.)` },
    },
  }
}

export const CODING_PLAN_ENDPOINTS = {
  anthropic: ['https://api.anthropic.com/api/oauth/usage'],
  zai: [
    'https://api.z.ai/api/coding/paas/v3/dashboard/billing/coding_plan/usage',
    'https://open.bigmodel.cn/api/coding/paas/v3/dashboard/billing/coding_plan/usage',
    'https://api.z.ai/api/coding/paas/v4/dashboard/billing/coding_plan/usage',
    'https://open.bigmodel.cn/api/coding/paas/v4/dashboard/billing/coding_plan/usage',
  ],
  minimax: [
    'https://www.minimaxi.com/v1/token_plan/remains',
    'https://www.minimax.io/v1/token_plan/remains',
    'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains',
  ],
  kimi: ['https://api.moonshot.cn/v1/users/me/balance'],
  openrouter: ['https://openrouter.ai/api/v1/credits'],
  siliconflow: ['https://api.siliconflow.cn/v1/user/info'],
  scnet: [],
}

const CODING_PLAN_PARSERS = {
  anthropic: parseAnthropicUsage,
  minimax: parseMiniMaxRemains,
  zai: parseZaiUsage,
  kimi: parseKimiBalance,
  openrouter: parseOpenRouterCredits,
  siliconflow: parseSiliconFlowInfo,
}

export async function queryCodingPlan(provider, key, locale, t) {
  const meta = CODING_PLAN_PROVIDERS[provider]
  if (meta === undefined) throw new Error(t(locale, 'codingPlanUnknown', { provider: String(provider) }))
  if (key === null || typeof key !== 'string' || key.trim().length === 0) {
    const error = new Error(t(locale, 'codingPlanKeyMissing', { provider: meta.label }))
    error.soft = true
    throw error
  }
  const urls = CODING_PLAN_ENDPOINTS[provider]
  const parse = CODING_PLAN_PARSERS[provider]
  let lastError = null
  for (const url of urls) {
    let response
    try {
      response = await fetch(url, {
        headers: {
          authorization: `Bearer ${key.trim()}`,
          'user-agent': 'dsh-cost-meter/1.4 (DeepSeek Harness plugin)',
        },
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      lastError = error
      continue
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error(t(locale, 'codingPlanUnauthorized', { provider: meta.label, code: String(response.status) }))
      error.soft = true
      throw error
    }
    if (!response.ok) {
      lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
      continue
    }
    const data = await response.json()
    const windows = parse(data)
    if (windows === null) {
      const envelope = data !== null && typeof data === 'object' && typeof data.code === 'number' && data.code !== 0
        && typeof (data.msg ?? data.message) === 'string' ? (data.msg ?? data.message) : null
      lastError = envelope !== null
        ? new Error(`${meta.label}: ${envelope}`)
        : new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
      continue
    }
    return { windows, endpoint: url }
  }
  throw lastError ?? new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
}

export { CUSTOM_BALANCE_ADAPTER_ID, emptyCustomBalance, extractByRule, queryCustomBalance } from './custom-balance.js'
