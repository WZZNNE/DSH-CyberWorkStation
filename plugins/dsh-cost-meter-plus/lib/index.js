/**
 * dsh-cost-meter-plus host plugin (fork of Han-1413141/dsh-cost-meter, MIT).
 * One loader row (see cordis.patch.yml) mounts this module, which:
 *  1. opens and maintains the ledger ($DSH_HOME/storages/cost-meter/ledger.json);
 *  2. wraps the `llm/stream` waterfall to capture every usage chunk and bill it
 *     against the official / synced price tables;
 *  3. registers the `costUsage` session projection (pure token buckets split by
 *     model; the client prices them);
 *  4. provides the `costMeter` service (hand-written typertRemote binding backed
 *     by ./typert.host.js) that the client reaches as remote.costMeter.*.
 * Fork additions: provider-aware balances (OpenRouter / local endpoints) and
 * OpenRouter price auto-sync. Only ctx APIs and Node built-ins are used so the
 * plugin shares the host runtime instances; dsh-credentials is only used for the
 * pure credentialRef() constructor.
 */
import { z } from 'zod'
import fs from 'node:fs'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Ledger, applyConfigPatch, localDayKey, pickBalanceInfo, reconcileBalanceDelta, zeroDay } from './store.js'
import { backfillLegacyLedger, importLegacyHistory } from './backfill.js'
import { OFFICIAL_PRICING_URL, normalizePrice, parsePricingHtml, costOf, priceEntryFor, providerPriceEntryFor, buildPriceCatalog, paidVendorRoute } from './pricing.js'
import { CODING_PLAN_PROVIDERS, CODING_PLAN_PROVIDER_IDS, queryCodingPlan, scnetTokenPlanWindows, emptyCustomBalance, queryCustomBalance } from './coding-plans.js'
import { stateSchema } from './typert.host.js'
import { detectProviders, queryOpenRouterBalance, fetchOpenRouterPriceEntries } from './provider-balance.js'
import { isLocalProvider, markLocalProviders } from './pricing.js'

export const name = 'cost-meter'


const SERVER_MESSAGES = {
  zh: {
    apiKeyMissing: '未配置 DeepSeek API Key(请在 设置→模型 中配置,或导出 {env} 环境变量)',
    balanceHttp: '余额接口 HTTP {code}',
    balanceNoInfos: '余额接口响应缺少 balance_infos',
    balanceEndpointNotOfficial: '余额查询仅支持官方端点(api.deepseek.com):当前配置的 baseURL {url} 不是官方域名,为保护 API Key 已拒绝发起请求',
    pageTooShort: '页面内容过短,可能被网关拦截',
    noModelsParsed: '官方页面中未解析出任何模型价格,页面结构可能已变化,请稍后重试或手动编辑价格',
    configRejected: '配置更新被拒绝:{errors}',
    balanceDisplayOff: '余额显示已关闭,请先在 显示设置 中开启',
    balanceRefreshed: '余额已刷新',
    balanceQueryFailed: '余额查询失败:{message}',
    balanceLocalOnly: '当前仅配置了本地模型端点(LM Studio/Ollama 等):本地推理无余额概念,仅统计 token 用量(缓存命中/未命中与总量)',
    balanceOpenAiNoApi: 'OpenAI 未提供 API Key 可查询的余额端点(仅控制台可见),已跳过余额;费用按本地账本估算',
    reconcileWarn: '对账提示:本地账本今日合计 {cost} 与官方余额当日变动 {delta} 偏差较大,请核对价格表或近期账单',
    goQuotaKeyMissing: '未找到 OpenCode Go API Key。有 Go 订阅的话:运行 opencode login、导出 OPENCODE_GO_API_KEY 环境变量,或在显示设置中填写 Key;没有订阅可关闭上方「启用」开关。',
    goQuotaHttp: 'OpenCode Go 额度接口 HTTP {code}',
    goQuotaNoSub: '没有检测到生效的 OpenCode Go 订阅(接口返回 {code}),或 API Key 无效。没有订阅可关闭上方「启用」开关。',
    goQuotaNoUsage: 'OpenCode Go 额度响应缺少 usage 字段',
    goQuotaDisabled: 'OpenCode Go 额度未启用,请先在 费用设置 中开启',
    goQuotaDisplayOff: 'OpenCode Go 额度显示已关闭,请先在 显示设置 中开启',
    goQuotaRefreshed: 'OpenCode Go 额度已刷新',
    goQuotaQueryFailed: 'OpenCode Go 额度查询失败:{message}',
    customBalanceDisabled: '自定义 Provider 余额未启用',
    customBalanceDisplayOff: '自定义 Provider 余额显示已关闭',
    customBalanceRefreshed: '自定义 Provider 余额已刷新',
    customBalanceQueryFailed: '自定义 Provider 余额查询失败:{message}',
    pricesSynced: '已从官方文档同步 {ids} 的价格',
    priceSyncFailed: '官方价格同步失败:{error}',
    codingPlanKeyMissing: '未找到 {provider} 的凭据。请在下方填写 API Key,或配置对应环境变量/CLI 登录态;没有订阅可关闭该家的「启用」开关。',
    codingPlanUnauthorized: '{provider} 凭据无效或没有生效的订阅(接口返回 {code})。没有订阅可关闭该家的「启用」开关。',
    codingPlanHttp: '{provider} 额度接口 HTTP {code}({url})',
    codingPlanNoUsage: '{provider} 额度响应中未解析出用量窗口,接口结构可能已变化',
    codingPlanUnknown: '未知的 coding plan 提供商:{provider}',
    codingPlanDisplayOff: '{provider} 额度显示已关闭,请先在面板中开启',
    codingPlanDisabled: '{provider} 额度未启用,请先在面板中开启',
    codingPlanRefreshed: '{provider} 额度已刷新',
    codingPlanQueryFailed: '{provider} 额度查询失败:{message}',
    scnetPlanCreditsInvalid: 'SCNet 月度 Credits 额度无效,请填写大于 0 的数值。',
    legacyImportDone: '导入完成:更新 {days} 天、新增 {sessions} 个会话(扫描 {scanned} 份会话日志)。',
    legacyImportNone: '没有可导入的安装前历史(扫描 {scanned} 份会话日志,缺失日期为空或已导入)。',
    legacyImportFailed: '导入安装前历史失败:{message}',
  },
  en: {
    apiKeyMissing: 'DeepSeek API key not configured (configure it in Settings → Models, or export the {env} environment variable)',
    balanceHttp: 'Balance API returned HTTP {code}',
    balanceNoInfos: 'Balance API response is missing balance_infos',
    balanceEndpointNotOfficial: 'Balance lookup only supports the official endpoint (api.deepseek.com): the configured baseURL {url} is not an official host, so the API key will not be sent there',
    pageTooShort: 'Page content too short; the request may have been blocked by the gateway',
    noModelsParsed: 'No model prices could be parsed from the official page; the page structure may have changed — try again later or edit the price table manually.',
    configRejected: 'Config update rejected: {errors}',
    balanceDisplayOff: 'Balance display is off; enable it in Display settings first',
    balanceRefreshed: 'Balance refreshed',
    balanceQueryFailed: 'Balance query failed: {message}',
    balanceLocalOnly: 'Only local model endpoints are configured (LM Studio/Ollama etc.): local inference has no balance; token usage (cache hit/miss and totals) is still tracked',
    balanceOpenAiNoApi: 'OpenAI offers no API-key balance endpoint (dashboard only); balance skipped. Cost is estimated from the local ledger',
    reconcileWarn: 'Reconciliation notice: today\'s local ledger cost ({cost}) deviates significantly from the official balance change ({delta}); please check the price table or recent bills',
    goQuotaKeyMissing: 'OpenCode Go API key not found. If you have a Go subscription: run opencode login, export OPENCODE_GO_API_KEY, or set the key in Display settings; otherwise turn off the Enable switch above.',
    goQuotaHttp: 'OpenCode Go quota API returned HTTP {code}',
    goQuotaNoSub: 'No active OpenCode Go subscription detected (API returned {code}), or the API key is invalid. Turn off the Enable switch above if you have no subscription.',
    goQuotaNoUsage: 'OpenCode Go quota response is missing the usage field',
    goQuotaDisabled: 'OpenCode Go quota is disabled; enable it in the Cost settings first',
    goQuotaDisplayOff: 'OpenCode Go quota display is off; enable it in Display settings first',
    goQuotaRefreshed: 'OpenCode Go quota refreshed',
    goQuotaQueryFailed: 'OpenCode Go quota query failed: {message}',
    customBalanceDisabled: 'Custom provider balance is disabled',
    customBalanceDisplayOff: 'Custom provider balance display is off',
    customBalanceRefreshed: 'Custom provider balance refreshed',
    customBalanceQueryFailed: 'Custom provider balance query failed: {message}',
    pricesSynced: 'Synced prices for {ids} from the official docs',
    priceSyncFailed: 'Official price sync failed: {error}',
    codingPlanKeyMissing: 'No credentials found for {provider}. Enter the API key below, or configure the matching environment variable / CLI login; turn off the Enable switch if you have no subscription.',
    codingPlanUnauthorized: '{provider} credentials are invalid or no active subscription was detected (API returned {code}). Turn off the Enable switch if you have no subscription.',
    codingPlanHttp: '{provider} quota API returned HTTP {code} ({url})',
    codingPlanNoUsage: 'No usage windows could be parsed from the {provider} quota response; the API shape may have changed',
    codingPlanUnknown: 'Unknown coding plan provider: {provider}',
    codingPlanDisplayOff: '{provider} quota display is off; enable it in the panel first',
    codingPlanDisabled: '{provider} quota is disabled; enable it in the panel first',
    codingPlanRefreshed: '{provider} quota refreshed',
    codingPlanQueryFailed: '{provider} quota query failed: {message}',
    scnetPlanCreditsInvalid: 'Invalid SCNet monthly credits quota; enter a value greater than 0.',
    legacyImportDone: 'Import finished: {days} day(s) updated, {sessions} session(s) added (scanned {scanned} session logs).',
    legacyImportNone: 'No pre-install history to import (scanned {scanned} session logs; missing dates are empty or already imported).',
    legacyImportFailed: 'Failed to import pre-install history: {message}',
  },
}

function tmsg(locale, code, vars) {
  const dict = locale === 'en' ? SERVER_MESSAGES.en : SERVER_MESSAGES.zh
  let text = dict[code] ?? code
  if (vars) for (const key of Object.keys(vars)) text = text.split(`{${key}}`).join(String(vars[key]))
  return text
}

function localeOf(config) {
  return config?.locale === 'en' ? 'en' : 'zh'
}


const usageProjectionSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  cost: z.number(),
  byModel: z.record(z.string(), z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    reasoning: z.number().optional(),
    cost: z.number(),
  })),
  byProviderModel: z.record(z.string(), z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    reasoning: z.number(),
    cost: z.number(),
  })).optional(),
})

const usageBucketsSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number().optional(),
  cost: z.number(),
})

/** Host fold state of the costUsage unit (validated before a persisted checkpoint seeds a fold). */
const usageStateSchema = z.object({
  provider: z.string(),
  model: z.string(),
  totals: usageBucketsSchema,
  byModel: z.record(z.string(), usageBucketsSchema),
  byProviderModel: z.record(z.string(), usageBucketsSchema).optional(),
  last: z.object({
    key: z.string(),
    provider: z.string(),
    model: z.string(),
    buckets: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), reasoning: z.number() }),
    cost: z.number(),
  }).nullable(),
})

/**
 * costUsage session projection. The definition carries both projection
 * contracts: `schema`/`view` for dsh <= 0.1.0-rc.8 and `stateSchema`/`wire`
 * for dsh >= 0.1.1-rc.1 (session-projection split host state from the client
 * view); each host reads the fields it knows and ignores the rest.
 */
function makeCostUsageProjection(ledger) {
  const zeroBuckets = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 })
  const peakConfig = () => ({
    enabled: ledger.config?.peakEnabled === true,
    effectiveAtMs: Date.parse(ledger.config?.peakEffectiveAt ?? ''),
    windows: ledger.config?.peakWindows,
  })
  // Older checkpoints (same stateVersion) may lack the reasoning bucket; the wire
  // schema requires it, so the view fills zeros instead of failing validation.
  const withReasoning = buckets => Object.fromEntries(Object.entries(buckets ?? {}).map(([k, v]) => [k, { ...v, reasoning: v.reasoning ?? 0 }]))
  const view = state => ({
    input: state.totals.input,
    output: state.totals.output,
    cacheRead: state.totals.cacheRead,
    cacheWrite: state.totals.cacheWrite,
    reasoning: state.totals.reasoning ?? 0,
    cost: state.totals.cost,
    byModel: state.byModel,
    byProviderModel: withReasoning(state.byProviderModel),
  })
  return {
    key: 'costUsage',
    schema: usageProjectionSchema,
    stateSchema: usageStateSchema,
    wire: { viewSchema: usageProjectionSchema, view },
    view,
    stateVersion: 3,
    init: () => ({ provider: 'deepseek', model: 'default', totals: zeroBuckets(), byModel: {}, byProviderModel: {}, last: null }),
    apply(state, event) {
      if (event.type === 'request/header') {
        const model = event.data?.header?.config?.model
        const provider = event.data?.header?.config?.provider
        const nextModel = typeof model === 'string' && model.length > 0 ? model : 'default'
        const nextProvider = typeof provider === 'string' && provider.length > 0 ? provider : 'deepseek'
        return nextModel === state.model && nextProvider === state.provider ? state : { ...state, model: nextModel, provider: nextProvider }
      }
      let usage = null
      let turn = 0
      let step = 0
      if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage !== undefined) {
        usage = event.data.chunk.usage
        turn = event.data.turn
        step = event.data.step
      } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
        usage = event.data.usage
        turn = event.data.turn
        step = event.data.step
      } else {
        return state
      }
      const buckets = {
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
        reasoning: usage.reasoningTokens ?? 0,
      }
      const key = `${turn}:${step}`
      const prev = state.last !== null && state.last.key === key ? state.last : null
      if (prev !== null && prev.provider === state.provider && prev.model === state.model
        && prev.buckets.input === buckets.input && prev.buckets.output === buckets.output
        && prev.buckets.cacheRead === buckets.cacheRead && prev.buckets.cacheWrite === buckets.cacheWrite
        && prev.buckets.reasoning === buckets.reasoning) {
        return state
      }
      const atMs = Number.isFinite(Number(event.time)) && Number(event.time) > 0 ? Number(event.time) : Date.now()
      const resolved = providerPriceEntryFor(state.provider, state.model, ledger.config?.prices, {
        mode: ledger.config?.priceMatch === 'exact' ? 'exact' : 'auto',
        overrides: ledger.config?.priceOverrides,
      })
      const peak = peakConfig()
      peak.enabled = resolved.billingMode === 'deepseek-peak' && peak.enabled
      const billed = resolved.priced ? costOf(buckets, resolved.entry, atMs, peak) : 0
      const totals = { ...state.totals, reasoning: state.totals.reasoning ?? 0 }
      const byModel = { ...state.byModel }
      const byProviderModel = { ...(state.byProviderModel ?? {}) }
      const shift = (provider, model, bucket, cost, sign) => {
        totals.input += sign * bucket.input
        totals.output += sign * bucket.output
        totals.cacheRead += sign * bucket.cacheRead
        totals.cacheWrite += sign * bucket.cacheWrite
        totals.reasoning += sign * bucket.reasoning
        totals.cost += sign * cost
        const current = byModel[model] ?? zeroBuckets()
        byModel[model] = {
          input: current.input + sign * bucket.input,
          output: current.output + sign * bucket.output,
          cacheRead: current.cacheRead + sign * bucket.cacheRead,
          cacheWrite: current.cacheWrite + sign * bucket.cacheWrite,
          reasoning: (current.reasoning ?? 0) + sign * bucket.reasoning,
          cost: current.cost + sign * cost,
        }
        const providerKey = `${provider}:${model}`
        const providerCurrent = byProviderModel[providerKey] ?? zeroBuckets()
        byProviderModel[providerKey] = {
          input: providerCurrent.input + sign * bucket.input,
          output: providerCurrent.output + sign * bucket.output,
          cacheRead: providerCurrent.cacheRead + sign * bucket.cacheRead,
          cacheWrite: providerCurrent.cacheWrite + sign * bucket.cacheWrite,
          reasoning: providerCurrent.reasoning + sign * bucket.reasoning,
          cost: providerCurrent.cost + sign * cost,
        }
      }
      if (prev !== null) shift(prev.provider, prev.model, prev.buckets, prev.cost, -1)
      shift(state.provider, state.model, buckets, billed, 1)
      return { provider: state.provider, model: state.model, totals, byModel, byProviderModel, last: { key, provider: state.provider, model: state.model, buckets, cost: billed } }
    },
  }
}


function emptyBalance() {
  return { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 }
}

const GO_QUOTA_URL = 'https://opencode.ai/zen/go/v1/usage'

function emptyGoQuota() {
  return { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null }
}

function findGoKeyInAuthJson() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const candidates = [
    home ? `${home}/.local/share/opencode/auth.json` : '',
    process.env.XDG_CONFIG_HOME ? `${process.env.XDG_CONFIG_HOME}/opencode/auth.json` : '',
    home ? `${home}/.config/opencode/auth.json` : '',
  ].filter(Boolean)
  for (const path of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(path, 'utf8'))
      const key = data?.['opencode-go']?.key
      if (typeof key === 'string' && key.length > 0) return key
    } catch {
    }
  }
  return null
}

async function resolveGoKey(ctx, config) {
  const explicit = String(config?.goQuota?.apiKey ?? '').trim()
  if (explicit.length > 0) return explicit
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(credentialRef('OPENCODE_GO_API_KEY'))
      if (typeof hit?.value === 'string' && hit.value.length > 0) return hit.value
    } catch {
    }
  }
  for (const name of ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY']) {
    const value = String(process.env[name] ?? '').trim()
    if (value.length > 0) return value
  }
  return findGoKeyInAuthJson()
}

function normalizeGoWindow(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const percent = Number(raw.percent)
  if (!Number.isFinite(percent)) return null
  return { percent, resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : '' }
}

async function queryGoQuota(ctx, config, locale) {
  const key = await resolveGoKey(ctx, config)
  if (key === null) {
    const error = new Error(tmsg(locale, 'goQuotaKeyMissing'))
    error.soft = true
    throw error
  }
  const response = await fetch(GO_QUOTA_URL, {
    headers: {
      authorization: `Bearer ${key}`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      const error = new Error(tmsg(locale, 'goQuotaNoSub', { code: String(response.status) }))
      error.soft = true
      throw error
    }
    throw new Error(tmsg(locale, 'goQuotaHttp', { code: String(response.status) }))
  }
  const data = await response.json()
  const usage = data?.usage
  if (usage === null || typeof usage !== 'object') throw new Error(tmsg(locale, 'goQuotaNoUsage'))
  return {
    rolling: normalizeGoWindow(usage.rolling),
    weekly: normalizeGoWindow(usage.weekly),
    monthly: normalizeGoWindow(usage.monthly),
  }
}

function emptyCodingPlan() {
  return { status: 'off', message: '', fetchedAt: 0, windows: {} }
}

function findAnthropicOAuthToken() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  if (home.length === 0) return null
  try {
    const data = JSON.parse(fs.readFileSync(`${home}/.claude/.credentials.json`, 'utf8'))
    const token = data?.claudeAiOauth?.accessToken
    if (typeof token === 'string' && token.length > 0) return token
  } catch {
  }
  return null
}

async function resolveCodingPlanKey(ctx, provider, config) {
  const explicit = String(config?.codingPlans?.[provider]?.apiKey ?? '').trim()
  if (explicit.length > 0) return explicit
  const envs = CODING_PLAN_PROVIDERS[provider]?.credentialEnvs ?? []
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    for (const name of envs) {
      try {
        const hit = await credentials.resolve(credentialRef(name))
        if (typeof hit?.value === 'string' && hit.value.length > 0) return hit.value
      } catch {
      }
    }
  }
  for (const name of envs) {
    const value = String(process.env[name] ?? '').trim()
    if (value.length > 0) return value
  }
  if (provider === 'anthropic') return findAnthropicOAuthToken()
  return null
}

function balanceEndpoint(baseURL) {
  let base = String(baseURL ?? '').trim().replace(/\/+$/, '')
  if (base.length === 0) base = String(process.env.DEEPSEEK_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (base.length === 0) base = 'https://api.deepseek.com'
  if (/\/v\d+$/i.test(base)) base = base.replace(/\/v\d+$/i, '')
  let host = ''
  try { host = new URL(base).host.toLowerCase() } catch { return null }
  if (host !== 'api.deepseek.com') return null
  return `${base}/user/balance`
}

async function queryBalance(ctx, locale) {
  const settings = ctx.get('settings')
  const resolveKey = async apiKeyEnv => {
    let apiKey = null
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(credentialRef(apiKeyEnv))
        if (hit?.value !== undefined && hit.value.length > 0) apiKey = hit.value
      } catch {
      }
    }
    if (apiKey === null && typeof process.env[apiKeyEnv] === 'string' && process.env[apiKeyEnv].length > 0) apiKey = process.env[apiKeyEnv]
    return apiKey
  }
  const providers = detectProviders(settings)
  const section = typeof settings?.get === 'function' ? settings.get('llm-deepseek') : undefined
  const dsEnv = typeof section?.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0 ? section.apiKeyEnv : 'DEEPSEEK_API_KEY'
  const dsKey = await resolveKey(dsEnv)
  if (dsKey !== null) {
    const endpoint = balanceEndpoint(section?.baseURL)
    if (endpoint === null) {
      throw new Error(tmsg(locale, 'balanceEndpointNotOfficial', { url: String(section?.baseURL ?? '') }))
    }
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${dsKey}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(tmsg(locale, 'balanceHttp', { code: String(response.status) }))
    const data = await response.json()
    const info = pickBalanceInfo(data?.balance_infos)
    if (info === undefined) throw new Error(tmsg(locale, 'balanceNoInfos'))
    const num = value => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return {
      currency: typeof info.currency === 'string' ? info.currency : '',
      totalBalance: num(info.total_balance),
      grantedBalance: num(info.granted_balance),
      toppedUpBalance: num(info.topped_up_balance),
    }
  }
  const openrouter = providers.find(p => p.kind === 'openrouter')
  if (openrouter !== undefined) {
    const key = await resolveKey(openrouter.apiKeyEnv ?? 'OPENROUTER_API_KEY')
    if (key !== null) return queryOpenRouterBalance(key)
  }
  const effective = providers.filter(p => !(p.kind === 'deepseek' && dsKey === null))
  if (effective.length > 0 && effective.every(p => p.kind === 'local')) {
    throw new Error(tmsg(locale, 'balanceLocalOnly'))
  }
  if (effective.some(p => p.kind === 'openai')) throw new Error(tmsg(locale, 'balanceOpenAiNoApi'))
  throw new Error(tmsg(locale, 'apiKeyMissing', { env: dsEnv }))
}

async function syncOpenRouterPrices(ctx, ledger) {
  let settings
  for (let attempt = 0; attempt < 24; attempt++) {
    settings = ctx.get('settings')
    if (settings !== undefined) break
    await new Promise(resolve => { const t = setTimeout(resolve, 5000); t.unref?.() })
  }
  if (settings === undefined) {
    console.warn('[dsh-cost-meter] OpenRouter price auto-sync skipped: settings service never became available')
    return
  }
  const providers = detectProviders(settings)
  const openrouter = providers.find(p => p.kind === 'openrouter')
  if (openrouter === undefined || openrouter.modelIds.length === 0) {
    console.log('[dsh-cost-meter] OpenRouter price auto-sync: no openrouter provider/models configured')
    return
  }
  const existing = ledger.config?.prices?.providers?.openrouter?.models ?? {}
  const missing = openrouter.modelIds.filter(id => existing[id] === undefined)
  if (missing.length === 0) return
  const { entries } = await fetchOpenRouterPriceEntries(missing)
  const normalized = {}
  for (const [id, raw] of Object.entries(entries)) {
    const entry = normalizePrice(raw)
    if (entry !== null) normalized[id] = entry
  }
  if (Object.keys(normalized).length === 0) return
  const prices = ledger.config?.prices ?? {}
  ledger.config = {
    ...ledger.config,
    prices: {
      ...prices,
      providers: {
        ...prices?.providers,
        openrouter: {
          ...prices?.providers?.openrouter,
          models: { ...existing, ...normalized },
        },
      },
    },
  }
  ledger.scheduleWrite()
  console.log(`[dsh-cost-meter] auto-synced ${Object.keys(normalized).length} OpenRouter model prices (USD/1M)`)
}
const PRICE_CATALOG = buildPriceCatalog()

function buildState(ledger, balance = emptyBalance(), goQuota = emptyGoQuota(), codingPlans = {}, customBalance = emptyCustomBalance(), reconcile = { ok: true, message: '' }) {
  const now = Date.now()
  const dayKey = localDayKey(now)
  const monthKey = dayKey.slice(0, 7)
  const budget = ledger.config?.budget ?? {}
  let budgetUsed
  if (budget.period === 'day') budgetUsed = ledger.today().cost
  else if (budget.period === 'all') budgetUsed = ledger.sumDays(undefined).cost
  else if (budget.period === 'custom') {
    const start = typeof budget.customStart === 'string' ? budget.customStart : null
    const end = typeof budget.customEnd === 'string' && budget.customEnd.length > 0 ? budget.customEnd : dayKey
    budgetUsed = start === null ? 0 : ledger.sumRange(start, end).cost
  } else budgetUsed = ledger.sumDays(monthKey).cost
  const state = {
    today: ledger.today(),
    month: ledger.sumDays(monthKey),
    total: ledger.sumDays(undefined),
    budgetUsed,
    balance,
    goQuota,
    customBalance,
    reconcile,
    codingPlans,
    history: ledger.history(90),
    config: ledger.config,
    priceCatalog: PRICE_CATALOG,
    meta: {
      now,
      timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
      dayKey,
      monthKey,
    },
  }
  const check = stateSchema.safeParse(state)
  if (check.success) return state
  console.warn('[dsh-cost-meter] state 与 codec 漂移,尝试降级恢复可用性:', JSON.stringify(check.error.issues?.slice(0, 3) ?? check.error))
  const { priceCatalog: _dropped, ...stateNoCatalog } = state
  const attempts = [
    stateNoCatalog,
    { ...stateNoCatalog, codingPlans: {} },
    { ...stateNoCatalog, codingPlans: {}, balance: emptyBalance(), goQuota: emptyGoQuota(), customBalance: emptyCustomBalance() },
  ]
  for (const fallback of attempts) {
    if (stateSchema.safeParse(fallback).success) return fallback
  }
  return state
}

async function fetchPricingHtml(locale) {
  const response = await fetch(OFFICIAL_PRICING_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { 'user-agent': 'dsh-cost-meter/0.4 (DeepSeek Harness plugin)' },
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const text = await response.text()
  if (text.length < 500) throw new Error(tmsg(locale, 'pageTooShort'))
  return text
}

// Set once the first balance answer has been seen: from then on the balance decides the currency.
// Module level on purpose: the service (below) writes it, apply() reads it.
let balanceSeen = false

function createService(ctx, ledger) {
  let balanceCache = { fetchedAt: 0, value: emptyBalance() }
  let goQuotaCache = { fetchedAt: 0, value: emptyGoQuota() }
  let customBalanceCache = { fetchedAt: 0, value: emptyCustomBalance() }
  let codingPlanCaches = {}
  let reconcileNotice = { ok: true, message: '' }

  const balanceConfig = () => ledger.config?.balance ?? { display: 'both', refreshMinutes: 5 }
  const goQuotaConfig = () => ledger.config?.goQuota ?? { enabled: false, display: 'off', refreshMinutes: 15, apiKey: '' }
  const customBalanceConfig = () => ledger.config?.customBalance ?? { enabled: false, display: 'off', refreshMinutes: 15, label: '', request: { url: '' }, extract: {} }
  const codingPlanConfigOf = id => ({
    enabled: id === 'openrouter',
    display: 'settings',
    refreshMinutes: 15,
    apiKey: '',
    ...(ledger.config?.codingPlans?.[id] ?? {}),
  })

  const ensureBalance = async (force = false) => {
    const config = balanceConfig()
    if (config.display === 'off') {
      balanceCache = { fetchedAt: Date.now(), value: emptyBalance() }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 5) * 60_000
    if (!force && Date.now() - balanceCache.fetchedAt < interval) return
    if (balanceCache.inFlight !== undefined) {
      await balanceCache.inFlight
      return
    }
    const task = queryBalance(ctx, localeOf(ledger.config)).then(result => {
      balanceCache = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result } }
      balanceSeen = true
      if (typeof result?.currency === 'string' && ledger.followCurrency(result.currency)) console.log(`[dsh-cost-meter] display currency follows the balance: ${result.currency}`)
      if ((ledger.config?.balance?.reconcile ?? true) === true && balanceCache.value.status === 'ok') {
        const nowMs = Date.now()
        const usd = v => '$' + Number(v).toFixed(4)
        const { ref, event } = reconcileBalanceDelta(ledger.balanceRef, balanceCache.value, ledger.today().cost, localDayKey(nowMs), nowMs)
        if (ref !== ledger.balanceRef) {
          ledger.balanceRef = ref
          ledger.scheduleWrite()
        }
        reconcileNotice = event !== null && event.kind === 'drift'
          ? { ok: false, message: tmsg(localeOf(ledger.config), 'reconcileWarn', { cost: usd(event.todayCost), delta: usd(event.spent) }) }
          : { ok: true, message: '' }
      }
    }, error => {
      balanceCache = {
        fetchedAt: Date.now(),
        value: {
          ...emptyBalance(),
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          fetchedAt: Date.now(),
        },
      }
    }).finally(() => {
      if (balanceCache.inFlight === task) delete balanceCache.inFlight
    })
    balanceCache.inFlight = task
    await task
  }

  const ensureGoQuota = async (force = false) => {
    const config = goQuotaConfig()
    if (config.enabled === false || config.display === 'off') {
      goQuotaCache = { fetchedAt: Date.now(), value: emptyGoQuota() }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 15) * 60_000
    if (!force && Date.now() - goQuotaCache.fetchedAt < interval) return
    if (goQuotaCache.inFlight !== undefined) {
      await goQuotaCache.inFlight
      return
    }
    const task = queryGoQuota(ctx, ledger.config, localeOf(ledger.config)).then(result => {
      goQuotaCache = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result } }
    }, error => {
      goQuotaCache = {
        fetchedAt: Date.now(),
        value: {
          ...emptyGoQuota(),
          status: (error && error.soft === true) ? 'off' : 'error',
          message: error instanceof Error ? error.message : String(error),
          fetchedAt: Date.now(),
        },
      }
    }).finally(() => {
      if (goQuotaCache.inFlight === task) delete goQuotaCache.inFlight
    })
    goQuotaCache.inFlight = task
    await task
  }

  const ensureCustomBalance = async (force = false) => {
    const config = customBalanceConfig()
    if (config.enabled !== true || config.display === 'off') {
      customBalanceCache = { fetchedAt: Date.now(), value: emptyCustomBalance() }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 15) * 60_000
    if (!force && Date.now() - customBalanceCache.fetchedAt < interval) return
    if (customBalanceCache.inFlight !== undefined) {
      await customBalanceCache.inFlight
      return
    }
    const task = queryCustomBalance(ctx, ledger.config).then(result => {
      customBalanceCache = {
        fetchedAt: Date.now(),
        value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result },
      }
    }, error => {
      customBalanceCache = {
        fetchedAt: Date.now(),
        value: {
          ...emptyCustomBalance(),
          label: typeof config.label === 'string' ? config.label : '',
          status: (error && error.soft === true) ? 'off' : 'error',
          message: error instanceof Error ? error.message : String(error),
          fetchedAt: Date.now(),
        },
      }
    }).finally(() => {
      if (customBalanceCache.inFlight === task) delete customBalanceCache.inFlight
    })
    customBalanceCache.inFlight = task
    await task
  }

  const mergedCodingPlans = () => {
    const out = {}
    for (const id of CODING_PLAN_PROVIDER_IDS) {
      const cfg = codingPlanConfigOf(id)
      const cached = codingPlanCaches[id]?.value ?? emptyCodingPlan()
      out[id] = {
        enabled: cfg.enabled === true,
        display: typeof cfg.display === 'string' ? cfg.display : 'settings',
        refreshMinutes: Number.isFinite(Number(cfg.refreshMinutes)) && Number(cfg.refreshMinutes) > 0 ? Number(cfg.refreshMinutes) : 15,
        apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey : '',
        ...cached,
        windows: cached.windows !== null && typeof cached.windows === 'object' ? cached.windows : {},
      }
    }
    return out
  }

  const ensureCodingPlan = async (id, force = false) => {
    const config = codingPlanConfigOf(id)
    if (config.enabled !== true || config.display === 'off') {
      codingPlanCaches[id] = { fetchedAt: Date.now(), value: emptyCodingPlan() }
      return
    }
    if (id === 'scnet') {
      const result = scnetTokenPlanWindows(ledger.days ?? {}, config, Date.now())
      codingPlanCaches[id] = {
        fetchedAt: Date.now(),
        value: result === null
          ? { ...emptyCodingPlan(), status: 'off', fetchedAt: Date.now(), message: tmsg(localeOf(ledger.config), 'scnetPlanCreditsInvalid') }
          : { status: 'ok', message: '', fetchedAt: Date.now(), windows: result.windows },
      }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 15) * 60_000
    const cache = codingPlanCaches[id]
    if (!force && cache !== undefined && Date.now() - cache.fetchedAt < interval) return
    if (cache !== undefined && cache.inFlight !== undefined) {
      await cache.inFlight
      return
    }
    const locale = localeOf(ledger.config)
    const task = (async () => {
      const key = await resolveCodingPlanKey(ctx, id, ledger.config)
      return queryCodingPlan(id, key, locale, tmsg)
    })().then(result => {
      codingPlanCaches[id] = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), windows: result.windows } }
    }, error => {
      codingPlanCaches[id] = {
        fetchedAt: Date.now(),
        value: {
          ...emptyCodingPlan(),
          status: (error && error.soft === true) ? 'off' : 'error',
          message: error instanceof Error ? error.message : String(error),
          fetchedAt: Date.now(),
        },
      }
    }).finally(() => {
      if (codingPlanCaches[id]?.inFlight === task) delete codingPlanCaches[id].inFlight
    })
    codingPlanCaches[id] = { ...(codingPlanCaches[id] ?? { fetchedAt: 0, value: emptyCodingPlan() }), inFlight: task }
    await task
  }

  const ensureCodingPlans = async (force = false) => {
    await Promise.all(CODING_PLAN_PROVIDER_IDS.map(id => ensureCodingPlan(id, force)))
  }

  const build = async (forceBalance = false) => {
    await Promise.all([ensureBalance(forceBalance), ensureGoQuota(false), ensureCustomBalance(false), ensureCodingPlans(false)])
    return buildState(ledger, balanceCache.value, goQuotaCache.value, mergedCodingPlans(), customBalanceCache.value, reconcileNotice)
  }

  const service = {
    async getState() {
      return build(false)
    },

    async updateConfig(patch) {
      const { config, errors } = applyConfigPatch(ledger.config, patch)
      if (errors.length > 0) {
        const locale = patch !== null && typeof patch === 'object' && patch.locale === 'en' ? 'en' : localeOf(ledger.config)
        throw new Error(tmsg(locale, 'configRejected', { errors: errors.join(locale === 'zh' ? ';' : '; ') }))
      }
      // Touching the currency fields by hand is the choice to stop following the API.
      const choseCurrency = patch !== null && typeof patch === 'object' && patch.currencySource === undefined
        && ['currency', 'symbol', 'exchangeRate'].some(k => patch[k] !== undefined)
      ledger.config = choseCurrency ? { ...config, currencySource: 'manual' } : config
      if (config.balance?.reconcile !== true) reconcileNotice = { ok: true, message: '' }
      ledger.scheduleWrite()
      return build(false)
    },

    async refreshBalance() {
      const locale = localeOf(ledger.config)
      if (balanceConfig().display === 'off') {
        return { ok: false, message: tmsg(locale, 'balanceDisplayOff') }
      }
      await ensureBalance(true)
      const value = balanceCache.value
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'balanceRefreshed') : tmsg(locale, 'balanceQueryFailed', { message: value.message }),
        state: buildState(ledger, value, goQuotaCache.value, mergedCodingPlans(), customBalanceCache.value, reconcileNotice),
      }
    },

    async refreshCustomBalance() {
      const locale = localeOf(ledger.config)
      if (customBalanceConfig().enabled !== true) {
        return { ok: false, message: tmsg(locale, 'customBalanceDisabled') }
      }
      if (customBalanceConfig().display === 'off') {
        return { ok: false, message: tmsg(locale, 'customBalanceDisplayOff') }
      }
      await ensureCustomBalance(true)
      const value = customBalanceCache.value
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'customBalanceRefreshed')
          : value.status === 'off' && value.message ? value.message
            : tmsg(locale, 'customBalanceQueryFailed', { message: value.message }),
        state: buildState(ledger, balanceCache.value, goQuotaCache.value, mergedCodingPlans(), value, reconcileNotice),
      }
    },

    async refreshGoQuota() {
      const locale = localeOf(ledger.config)
      if (goQuotaConfig().enabled === false) {
        return { ok: false, message: tmsg(locale, 'goQuotaDisabled') }
      }
      if (goQuotaConfig().display === 'off') {
        return { ok: false, message: tmsg(locale, 'goQuotaDisplayOff') }
      }
      await ensureGoQuota(true)
      const value = goQuotaCache.value
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'goQuotaRefreshed')
          : value.status === 'off' && value.message ? value.message
            : tmsg(locale, 'goQuotaQueryFailed', { message: value.message }),
        state: buildState(ledger, balanceCache.value, value, mergedCodingPlans(), customBalanceCache.value, reconcileNotice),
      }
    },

    async refreshCodingPlan(provider) {
      const locale = localeOf(ledger.config)
      const id = typeof provider === 'string' ? provider : ''
      if (!CODING_PLAN_PROVIDER_IDS.includes(id)) {
        return { ok: false, message: tmsg(locale, 'codingPlanUnknown', { provider: id }) }
      }
      const label = CODING_PLAN_PROVIDERS[id].label
      const config = codingPlanConfigOf(id)
      if (config.enabled !== true) {
        return { ok: false, message: tmsg(locale, 'codingPlanDisabled', { provider: label }) }
      }
      if (config.display === 'off') {
        return { ok: false, message: tmsg(locale, 'codingPlanDisplayOff', { provider: label }) }
      }
      await ensureCodingPlan(id, true)
      const value = codingPlanCaches[id]?.value ?? emptyCodingPlan()
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'codingPlanRefreshed', { provider: label })
          : value.status === 'off' && value.message ? value.message
            : tmsg(locale, 'codingPlanQueryFailed', { provider: label, message: value.message }),
        state: buildState(ledger, balanceCache.value, goQuotaCache.value, mergedCodingPlans(), customBalanceCache.value, reconcileNotice),
      }
    },

    async fetchPrices() {
      const locale = localeOf(ledger.config)
      try {
        const html = await fetchPricingHtml(locale)
        const parsed = parsePricingHtml(html)
        const models = { ...ledger.config.prices.models }
        for (const [id, raw] of Object.entries(parsed.models)) {
          const entry = normalizePrice(raw)
          if (entry === null) continue
          models[id] = { ...(models[id] ?? {}), ...entry }
        }
        const patch = {
          prices: { ...ledger.config.prices, models },
          priceSource: 'official',
          fetchedAt: new Date().toISOString(),
        }
        if (typeof parsed.effectiveAt === 'string') patch.peakEffectiveAt = parsed.effectiveAt
        else patch.peakEffectiveAt = new Date().toISOString()
        if (Array.isArray(parsed.peakWindows) && parsed.peakWindows.length > 0) {
          patch.peakWindows = parsed.peakWindows
        }
        const { config, errors } = applyConfigPatch(ledger.config, patch)
        if (errors.length > 0) throw new Error(errors.join(';'))
        ledger.config = config
        ledger.scheduleWrite()
        const ids = Object.keys(parsed.models)
        return {
          ok: true,
          message: tmsg(locale, 'pricesSynced', { ids: ids.join(locale === 'zh' ? '、' : ', ') }),
          state: await build(false),
        }
      } catch (error) {
        const detail = error?.code === 'ERR_NO_MODELS'
          ? tmsg(locale, 'noModelsParsed')
          : (error instanceof Error ? error.message : String(error))
        return {
          ok: false,
          message: tmsg(locale, 'priceSyncFailed', { error: detail }),
        }
      }
    },

    async resetHistory() {
      ledger.days = {}
      ledger.scheduleWrite()
      return build(false)
    },

    async importLegacyHistory() {
      const locale = localeOf(ledger.config)
      try {
        const stats = await importLegacyHistory(ledger, join(resolveDshHome(), 'sessions'))
        const message = stats.days === 0 && stats.sessions === 0
          ? tmsg(locale, 'legacyImportNone', { scanned: stats.scanned })
          : tmsg(locale, 'legacyImportDone', stats)
        return {
          ok: true,
          message,
          state: await build(false),
        }
      } catch (error) {
        return {
          ok: false,
          message: tmsg(locale, 'legacyImportFailed', { message: error instanceof Error ? error.message : String(error) }),
        }
      }
    },

    async getDaySessions(date) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('invalid date')
      }
      const day = ledger.days[date]
      return day === undefined ? zeroDay(date) : ledger.copyDay(day)
    },

    async getTopSessions(limit, sort = 'cost', dir = 'desc') {
      const n = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 100))
      const sortKey = sort === 'time' || sort === 'recent' ? sort : 'cost'
      const asc = dir === 'asc'
      const all = []
      const dateKeys = Object.keys(ledger.days)
      if (sortKey === 'recent' && !asc) dateKeys.reverse()
      for (const date of dateKeys) {
        const day = ledger.days[date]
        if (!Array.isArray(day.sessions)) continue
        const rows = day.sessions.slice()
        if (sortKey === 'recent' && !asc) rows.reverse()
        for (const s of rows) {
          if (s === null || typeof s !== 'object') continue
          const row = {
            date,
            id: String(s.id ?? ''),
            input: s.input ?? 0,
            output: s.output ?? 0,
            cacheRead: s.cacheRead ?? 0,
            cacheWrite: s.cacheWrite ?? 0,
            reasoning: s.reasoning ?? 0,
            calls: s.calls ?? 0,
            cost: s.cost ?? 0,
            byProviderModel: s.byProviderModel ?? {},
          }
          if (typeof s.title === 'string' && s.title.length > 0) row.title = s.title
          const at = Number(s.at)
          if (Number.isFinite(at) && at > 0) row.at = at
          all.push(row)
        }
      }
      if (sortKey === 'cost') all.sort((a, b) => asc ? a.cost - b.cost : b.cost - a.cost)
      else if (sortKey === 'time') {
        all.sort((a, b) => {
          const ta = Number.isFinite(a.at) ? a.at : asc ? Number.MAX_SAFE_INTEGER : 0
          const tb = Number.isFinite(b.at) ? b.at : asc ? Number.MAX_SAFE_INTEGER : 0
          return asc ? ta - tb : tb - ta
        })
      }
      return { sessions: all.slice(0, n) }
    },
  }
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'costMeter', namespace: 'costMeter' },
  })
  return service
}


export async function runStartupImports(ledger, sessionsRoot) {
  const filled = await backfillLegacyLedger(ledger, sessionsRoot)
  if (filled.days > 0 || filled.sessions > 0 || filled.titles > 0) {
    const extras = [
      filled.days > 0 || filled.sessions > 0 ? `${filled.days} 天 / ${filled.sessions} 个会话` : null,
      filled.titles > 0 ? `${filled.titles} 个会话标题` : null,
      filled.recosted > 0 ? `重算 ${filled.recosted} 天金额` : null,
    ].filter(Boolean).join(',')
    console.log(`[dsh-cost-meter] 历史按模型统计回填完成:${extras}(扫描 ${filled.scanned} 份会话日志)`)
  }
  if (!(Number(ledger.config?.legacyAutoImportedAt) > 0)) {
    const stats = await importLegacyHistory(ledger, sessionsRoot)
    if (stats.days > 0 || stats.sessions > 0) {
      console.log(`[dsh-cost-meter] 安装前历史自动导入完成:${stats.days} 天 / ${stats.sessions} 个会话(扫描 ${stats.scanned} 份会话日志)`)
    }
    ledger.config.legacyAutoImportedAt = Date.now()
    ledger.scheduleWrite()
  }
}

export function apply(ctx) {
  const ledger = Ledger.open()
  console.log(`[dsh-cost-meter] 已加载,账本:${ledger.path}`)

  // Local routes are free and the display currency follows the API: both need the settings
  // service, which may arrive after this plugin, so they are refreshed on a timer as well.
  const refreshRouteFacts = () => {
    try {
      const providers = detectProviders(ctx.get('settings'))
      if (providers.length === 0) return
      // A paid vendor's route pointed at a loopback gateway or proxy is still that vendor's bill —
      // when it names the vendor AND carries the vendor's credential (pricing.js paidVendorRoute).
      markLocalProviders(providers.filter(p => p.kind === 'local' && !paidVendorRoute(p)).map(p => p.id))
      // Once per rule version: local rows come out free, and paid rows that an earlier local rule
      // zeroed (tokens but no money) get their money back from the current tables. Rows that
      // already carry a paid cost are never touched: their per-call tier (peak pricing) is not
      // reconstructible from a day row.
      if (ledger.config.repricedVersion < 1) {
        const touched = ledger.repriceAll(isLocalProvider)
        ledger.config = { ...ledger.config, repricedVersion: 1 }
        ledger.scheduleWrite()
        console.log(`[dsh-cost-meter] ledger repriced from tokens (rule v1): ${touched} row(s) changed`)
      } else {
        const zeroed = ledger.forgiveLocal(isLocalProvider)
        if (zeroed > 0) console.log(`[dsh-cost-meter] local routes are free: ${zeroed} ledger row(s) zeroed`)
      }
      // The balance endpoint is the authority on currency; the guess below only stands in until
      // the first balance answer has been seen.
      if (ledger.config.currencySource !== 'manual' && !balanceSeen) {
        const paid = providers.filter(p => p.kind !== 'local')
        const guess = paid.length > 0 && paid.every(p => p.kind === 'deepseek') ? 'CNY' : 'USD'
        if (ledger.followCurrency(guess)) console.log(`[dsh-cost-meter] display currency follows the API: ${guess}`)
      }
    } catch (error) {
      console.warn(`[dsh-cost-meter] route facts skipped: ${String(error?.message ?? error)}`)
    }
  }
  refreshRouteFacts()
  const routeFactsTimer = setInterval(refreshRouteFacts, 60000)
  routeFactsTimer.unref?.()
  ctx.effect(() => () => clearInterval(routeFactsTimer), 'cost-meter: route facts')

  ctx.effect(() => () => ledger.close(), 'cost-meter: ledger close')

  const backfillTimer = setTimeout(() => {
    runStartupImports(ledger, join(resolveDshHome(), 'sessions')).catch(error => {
      console.warn(`[dsh-cost-meter] 启动期历史导入失败: ${String(error?.message ?? error)}`)
    })
  }, 3000)
  backfillTimer.unref?.()

  ctx.on('llm/stream', (options, next) => {
    const downstream = next()
    return (async function* costMeterStream() {
      let usage = null
      try {
        for await (const chunk of downstream) {
          if (chunk !== null && chunk !== undefined && chunk.type === 'usage' && chunk.usage !== undefined) {
            usage = chunk.usage
          }
          yield chunk
        }
      } finally {
        if (usage !== null) {
          try {
            ledger.account({
              input: usage.inputTokens ?? 0,
              output: usage.outputTokens ?? 0,
              cacheRead: usage.cacheReadTokens ?? 0,
              cacheWrite: usage.cacheWriteTokens ?? 0,
              reasoning: usage.reasoningTokens ?? 0,
            }, options?.model, options?.sessionId, Date.now(), options?.provider)
            ledger.flush()
          } catch (error) {
            ctx.logger?.warn?.(`[dsh-cost-meter] 计费失败: ${String(error)}`)
          }
        }
      }
    })()
  })

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(makeCostUsageProjection(ledger))
  })

  syncOpenRouterPrices(ctx, ledger).catch(error => {
    console.warn(`[dsh-cost-meter] OpenRouter price auto-sync failed: ${error?.stack ?? String(error)}`)
  })
  process.once('beforeExit', () => { try { if (ledger.pendingWrite) ledger.flush() } catch { } })
  ctx.effect(() => () => { try { ledger.close() } catch { } }, 'cost-meter: flush ledger on dispose')
  ctx.provide('costMeter', createService(ctx, ledger))
}
