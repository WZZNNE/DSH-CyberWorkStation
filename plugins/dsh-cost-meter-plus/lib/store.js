/**
 * Ledger store: atomic JSON persistence of daily totals, per-session records,
 * configuration (prices, display, balance, coding plans) and balance
 * reconciliation helpers.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_PEAK_EFFECTIVE_AT,
  DEFAULT_PEAK_WINDOWS,
  DEFAULT_PRICE_TABLE,
  isPre015FlashPrice,
  PRE_0_1_5_FLASH_IDS,
  DEFAULT_PROVIDER_PRICE_TABLE,
  costOf,
  normalizePrice,
  priceEntryFor,
  providerPriceEntryFor,
} from './pricing.js'
import { CODING_PLAN_PROVIDER_IDS } from './coding-plans.js'

const LEDGER_VERSION = 1
const MAX_SESSIONS_PER_DAY = 200
const DEFAULT_HISTORY_DAYS = 180

export function defaultConfig() {
  return {
    locale: 'auto',
    position: 'dock',
    sidebar: true,
    // 'auto' follows the currency the balance endpoint answers in (OpenRouter and OpenAI bill in
    // USD, DeepSeek official in CNY); 'manual' keeps whatever the owner set below.
    currencySource: 'auto',
    // Bumped when the pricing rules change in a way that old rows must be recomputed from tokens.
    repricedVersion: 0,
    currency: 'USD', // CNY | USD | EUR | custom
    symbol: '$',
    decimals: 4,
    exchangeRate: 1,
    peakEnabled: true,
    peakEffectiveAt: DEFAULT_PEAK_EFFECTIVE_AT,
    peakWindows: DEFAULT_PEAK_WINDOWS.map(w => ({ ...w })),
    peakNotice: true,
    peakAlertEnabled: true,
    peakAlertAhead: 2,
    peakAlertTarget: 'both',
    peakAlertPosition: 'corner',
    peakAlertWebNotify: false,
    showSessionId: false,
    legacyAutoImportedAt: 0,
    peakStyle: 'compact',
    priceMatch: 'auto',
    priceOverrides: {},
    priceTableDisplay: {},
    prices: {
      models: Object.fromEntries(
        Object.entries(DEFAULT_PRICE_TABLE.models).map(([id, entry]) => [id, { ...entry }]),
      ),
      default: { ...DEFAULT_PRICE_TABLE.default },
       providers: Object.fromEntries(
        Object.entries(DEFAULT_PROVIDER_PRICE_TABLE).map(([provider, table]) => [provider, {
          models: Object.fromEntries(Object.entries(table.models).map(([id, entry]) => [id, { ...entry }])),
        }]),
      ),
    },
    budget: {
      enabled: false,
      amount: 100,
      period: 'month',
      customStart: null,
      customEnd: null,
      detail: true,
    },
    codingPlans: {
      anthropic: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      zai: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      minimax: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      scnet: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '', planCredits: 240000, planStart: '' },
    },
    balance: {
      display: 'both',
      refreshMinutes: 5,
      showProgressBar: false,
      budgetCap: null,
      reconcile: true,
    },
    goQuota: {
      enabled: true,
      display: 'both',
      refreshMinutes: 15,
      apiKey: '',
      main: 'rolling',
      detail: true,
    },
    customBalance: {
      enabled: false,
      label: '',
      labelEn: '',
      display: 'both',
      unit: 'USD',
      refreshMinutes: 15,
      request: {
        url: '',
        method: 'GET',
        headers: {},
      },
      extract: {
        remaining: { op: 'subtract', paths: ['info.max_budget', 'info.spend'] },
        maxBudget: 'info.max_budget',
        spend: 'info.spend',
        unit: 'USD',
      },
    },
    corner: {
      enabled: false,
      goRolling: true,
      goWeekly: true,
      goMonthly: true,
      budget: true,
    },
    usage: {
      position: 'cost',
    },
    historyDays: DEFAULT_HISTORY_DAYS,
    fetchedAt: null,
    priceSource: 'bundled', // bundled | official
  }
}

const CONFIG_KEYS = Object.keys(defaultConfig())

export function localDayKey(ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function zeroDay(date) {
  return { date, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, byProviderModel: {}, sessions: [] }
}

function zeroSession(id) {
  return { id, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, byProviderModel: {} }
}

function sanitizeNum(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function sanitizeBuckets(target) {
  if (target === null || typeof target !== 'object') return null
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost']) {
    target[key] = sanitizeNum(target[key])
  }
  return target
}

export function sanitizeDays(days) {
  for (const day of Object.values(days)) {
    if (sanitizeBuckets(day) === null) continue
    day.byProviderModel = day.byProviderModel !== null && typeof day.byProviderModel === 'object' && !Array.isArray(day.byProviderModel)
      ? day.byProviderModel
      : {}
    for (const [key, entry] of Object.entries(day.byProviderModel)) {
      if (sanitizeBuckets(entry) === null) delete day.byProviderModel[key]
    }
    if (!Array.isArray(day.sessions)) {
      day.sessions = []
      continue
    }
    for (const session of day.sessions) {
      if (sanitizeBuckets(session) === null) continue
      session.id = typeof session.id === 'string' ? session.id : ''
      if (typeof session.title !== 'string' || session.title.length === 0) delete session.title
      if (!Number.isFinite(Number(session.at)) || Number(session.at) <= 0) delete session.at
      session.byProviderModel = session.byProviderModel !== null && typeof session.byProviderModel === 'object' && !Array.isArray(session.byProviderModel)
        ? session.byProviderModel
        : {}
      for (const [key, entry] of Object.entries(session.byProviderModel)) {
        if (sanitizeBuckets(entry) === null) delete session.byProviderModel[key]
      }
    }
  }
  return days
}

function mergeDeep(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    out[key] = current !== null && typeof current === 'object' && !Array.isArray(current)
      && value !== null && typeof value === 'object' && !Array.isArray(value)
      ? mergeDeep(current, value)
      : value
  }
  return out
}

const VALIDATION_MESSAGES = {
  zh: {
    patchObject: '配置补丁必须是对象',
    unknownKey: '未知配置项 "{key}"',
    position: 'position 必须是 dock / header / off',
    sidebar: 'sidebar 必须是布尔值',
    currency: 'currency 非法',
    symbol: 'symbol 非法',
    decimals: 'decimals 必须是 0-10 的整数',
    exchangeRate: 'exchangeRate 必须为正数',
    peakEnabled: 'peakEnabled 必须是布尔值',
    peakEffectiveAt: 'peakEffectiveAt 非法',
    peakWindows: 'peakWindows 必须是数组',
    peakNotice: 'peakNotice 必须是布尔值',
    peakAlertEnabled: 'peakAlertEnabled 必须是布尔值',
    peakAlertAhead: 'peakAlertAhead 必须是 1-30 的整数',
    peakAlertTarget: 'peakAlertTarget 必须是 peak / offpeak / both',
    peakAlertPosition: 'peakAlertPosition 必须是 corner / center',
    peakAlertWebNotify: 'peakAlertWebNotify 必须是布尔值',
    showSessionId: 'showSessionId 必须是布尔值',
    peakStyle: 'peakStyle 必须是 compact / classic',
    priceMatch: 'priceMatch 必须是 auto / exact',
    priceOverrides: 'priceOverrides 必须是字符串→字符串映射',
    historyDays: 'historyDays 必须是 7-3650 的整数',
    locale: 'locale 必须是 auto / zh / en',
    budget: 'budget 非法',
    budgetEnabled: 'budget.enabled 必须是布尔值',
    budgetAmount: 'budget.amount 必须为非负数',
    budgetPeriod: 'budget.period 必须是 day / month / all / custom',
    budgetDate: 'budget.{field} 必须是 YYYY-MM-DD 日期或 null',
    budgetCustomStart: 'budget 为 custom 周期时必须设置开始日期',
    budgetCustomEnd: 'budget.customEnd 不能早于 customStart',
    budgetDetail: 'budget.detail 必须是布尔值',
    balance: 'balance 非法',
    balanceDisplay: 'balance.display 必须是 sidebar / settings / both / off',
    balanceRefresh: 'balance.refreshMinutes 必须是 1-1440 的整数',
    balanceShowBar: 'balance.showProgressBar 必须是布尔值',
    balanceReconcile: 'balance.reconcile 必须是布尔值',
    balanceBudgetCap: 'balance.budgetCap 必须是非负数或 null',
    goQuota: 'goQuota 非法',
    customBalance: 'customBalance 非法',
    customBalanceEnabled: 'customBalance.enabled 必须是布尔值',
    customBalanceDisplay: 'customBalance.display 必须是 sidebar / settings / both / off',
    customBalanceRefresh: 'customBalance.refreshMinutes 必须是 1-1440 的整数',
    customBalanceLabel: 'customBalance.label 必须是字符串',
    customBalanceLabelEn: 'customBalance.labelEn 必须是字符串',
    customBalanceUnit: 'customBalance.unit 必须是 USD / CNY / EUR',
    customBalanceRequest: 'customBalance.request.url 必须是非空字符串',
    customBalanceHeaders: 'customBalance.request.headers 必须是字符串→字符串映射',
    customBalanceExtract: 'customBalance.extract 必须是对象',
    goQuotaEnabled: 'goQuota.enabled 必须是布尔值',
    goQuotaDisplay: 'goQuota.display 必须是 sidebar / settings / both / off',
    goQuotaRefresh: 'goQuota.refreshMinutes 必须是 1-1440 的整数',
    goQuotaKey: 'goQuota.apiKey 必须是字符串',
    goQuotaMain: 'goQuota.main 必须是 rolling / weekly / monthly',
    goQuotaDetail: 'goQuota.detail 必须是布尔值',
    corner: 'corner 非法',
    cornerEnabled: 'corner.enabled 必须是布尔值',
    cornerFlag: 'corner.{field} 必须是布尔值',
    usage: 'usage 非法',
    usagePosition: 'usage.position 必须是 cost / general / section',
    prices: 'prices 非法',
    pricesModels: 'prices.models 非法',
    pricesProviders: 'prices.providers 非法',
    modelPrice: '模型 "{id}" 的价格非法',
    pricesDefault: 'prices.default 非法',
  },
  en: {
    patchObject: 'Config patch must be an object',
    unknownKey: 'Unknown config key "{key}"',
    position: 'position must be dock / header / off',
    sidebar: 'sidebar must be a boolean',
    currency: 'Invalid currency',
    symbol: 'Invalid symbol',
    decimals: 'decimals must be an integer from 0 to 10',
    exchangeRate: 'exchangeRate must be a positive number',
    peakEnabled: 'peakEnabled must be a boolean',
    peakEffectiveAt: 'Invalid peakEffectiveAt',
    peakWindows: 'peakWindows must be an array',
    peakNotice: 'peakNotice must be a boolean',
    peakAlertEnabled: 'peakAlertEnabled must be a boolean',
    peakAlertAhead: 'peakAlertAhead must be an integer between 1 and 30',
    peakAlertTarget: 'peakAlertTarget must be peak / offpeak / both',
    peakAlertPosition: 'peakAlertPosition must be corner / center',
    peakAlertWebNotify: 'peakAlertWebNotify must be a boolean',
    showSessionId: 'showSessionId must be a boolean',
    peakStyle: 'peakStyle must be compact / classic',
    priceMatch: 'priceMatch must be auto / exact',
    priceOverrides: 'priceOverrides must be a string→string map',
    historyDays: 'historyDays must be an integer from 7 to 3650',
    locale: 'locale must be auto / zh / en',
    budget: 'Invalid budget',
    budgetEnabled: 'budget.enabled must be a boolean',
    budgetAmount: 'budget.amount must be a non-negative number',
    budgetPeriod: 'budget.period must be day / month / all / custom',
    budgetDate: 'budget.{field} must be a YYYY-MM-DD date or null',
    budgetCustomStart: 'budget.customStart is required for the custom period',
    budgetCustomEnd: 'budget.customEnd cannot be earlier than customStart',
    budgetDetail: 'budget.detail must be a boolean',
    balance: 'Invalid balance',
    balanceDisplay: 'balance.display must be sidebar / settings / both / off',
    balanceRefresh: 'balance.refreshMinutes must be an integer from 1 to 1440',
    balanceShowBar: 'balance.showProgressBar must be a boolean',
    balanceReconcile: 'balance.reconcile must be a boolean',
    balanceBudgetCap: 'balance.budgetCap must be a non-negative number or null',
    goQuota: 'Invalid goQuota',
    customBalance: 'Invalid customBalance',
    customBalanceEnabled: 'customBalance.enabled must be a boolean',
    customBalanceDisplay: 'customBalance.display must be sidebar / settings / both / off',
    customBalanceRefresh: 'customBalance.refreshMinutes must be an integer from 1 to 1440',
    customBalanceLabel: 'customBalance.label must be a string',
    customBalanceLabelEn: 'customBalance.labelEn must be a string',
    customBalanceUnit: 'customBalance.unit must be USD / CNY / EUR',
    customBalanceRequest: 'customBalance.request.url must be a non-empty string',
    customBalanceHeaders: 'customBalance.request.headers must be a string→string map',
    customBalanceExtract: 'customBalance.extract must be an object',
    goQuotaEnabled: 'goQuota.enabled must be a boolean',
    goQuotaDisplay: 'goQuota.display must be sidebar / settings / both / off',
    goQuotaRefresh: 'goQuota.refreshMinutes must be an integer from 1 to 1440',
    goQuotaKey: 'goQuota.apiKey must be a string',
    goQuotaMain: 'goQuota.main must be rolling / weekly / monthly',
    goQuotaDetail: 'goQuota.detail must be a boolean',
    corner: 'Invalid corner',
    cornerEnabled: 'corner.enabled must be a boolean',
    cornerFlag: 'corner.{field} must be a boolean',
    usage: 'Invalid usage',
    usagePosition: 'usage.position must be cost / general / section',
    prices: 'Invalid prices',
    pricesModels: 'Invalid prices.models',
    pricesProviders: 'Invalid prices.providers',
    modelPrice: 'Invalid price for model "{id}"',
    pricesDefault: 'Invalid prices.default',
  },
}

function vmsg(locale, code, vars) {
  const dict = locale === 'en' ? VALIDATION_MESSAGES.en : VALIDATION_MESSAGES.zh
  let text = dict[code] ?? code
  if (vars) for (const key of Object.keys(vars)) text = text.split(`{${key}}`).join(String(vars[key]))
  return text
}

function patchLocale(current, patch) {
  if (patch !== null && typeof patch === 'object' && (patch.locale === 'zh' || patch.locale === 'en')) return patch.locale
  return current?.locale === 'en' ? 'en' : 'zh'
}

export function applyConfigPatch(current, patch) {
  const locale = patchLocale(current, patch)
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { config: current, errors: [vmsg(locale, 'patchObject')] }
  }
  const errors = []
  for (const key of Object.keys(patch)) {
    if (!CONFIG_KEYS.includes(key)) errors.push(vmsg(locale, 'unknownKey', { key }))
  }
  if (errors.length > 0) return { config: current, errors }
  const candidate = mergeDeep(current, patch)
  if (patch.prices !== null && typeof patch.prices === 'object' && !Array.isArray(patch.prices)
    && patch.prices.models !== null && typeof patch.prices.models === 'object' && !Array.isArray(patch.prices.models)) {
    candidate.prices.models = patch.prices.models
  }
  if (!['auto', 'zh', 'en'].includes(candidate.locale)) errors.push(vmsg(locale, 'locale'))
  if (candidate.codingPlans === null || typeof candidate.codingPlans !== 'object' || Array.isArray(candidate.codingPlans)) {
    candidate.codingPlans = {}
  }
  for (const [id, raw] of Object.entries(candidate.codingPlans)) {
    if (!CODING_PLAN_PROVIDER_IDS.includes(id) || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      delete candidate.codingPlans[id]
      continue
    }
    const entry = raw
    entry.enabled = entry.enabled === true
    entry.display = ['sidebar', 'settings', 'both', 'off'].includes(entry.display) ? entry.display : 'settings'
    const minutes = Number(entry.refreshMinutes)
    entry.refreshMinutes = Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : 15
    entry.apiKey = typeof entry.apiKey === 'string' ? entry.apiKey : ''
    if (id === 'scnet') {
      const credits = Number(entry.planCredits)
      entry.planCredits = Number.isFinite(credits) && credits > 0 ? credits : 240000
      entry.planStart = typeof entry.planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.planStart) ? entry.planStart : ''
    }
  }
  if (!['dock', 'header', 'off'].includes(candidate.position)) errors.push(vmsg(locale, 'position'))
  if (typeof candidate.sidebar !== 'boolean') errors.push(vmsg(locale, 'sidebar'))
  if (typeof candidate.currency !== 'string' || candidate.currency.length === 0) errors.push(vmsg(locale, 'currency'))
  if (typeof candidate.symbol !== 'string') errors.push(vmsg(locale, 'symbol'))
  const decimals = Number(candidate.decimals)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) errors.push(vmsg(locale, 'decimals'))
  const rate = Number(candidate.exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) errors.push(vmsg(locale, 'exchangeRate'))
  if (typeof candidate.peakEnabled !== 'boolean') errors.push(vmsg(locale, 'peakEnabled'))
  if (typeof candidate.peakEffectiveAt !== 'string') errors.push(vmsg(locale, 'peakEffectiveAt'))
  if (!Array.isArray(candidate.peakWindows)) errors.push(vmsg(locale, 'peakWindows'))
  if (typeof candidate.peakNotice !== 'boolean') errors.push(vmsg(locale, 'peakNotice'))
  if (candidate.peakAlertEnabled !== undefined && typeof candidate.peakAlertEnabled !== 'boolean') errors.push(vmsg(locale, 'peakAlertEnabled'))
  const alertAhead = Number(candidate.peakAlertAhead)
  if (!Number.isInteger(alertAhead) || alertAhead < 1 || alertAhead > 30) errors.push(vmsg(locale, 'peakAlertAhead'))
  if (!['peak', 'offpeak', 'both'].includes(candidate.peakAlertTarget)) errors.push(vmsg(locale, 'peakAlertTarget'))
  if (!['corner', 'center'].includes(candidate.peakAlertPosition)) errors.push(vmsg(locale, 'peakAlertPosition'))
  if (typeof candidate.peakAlertWebNotify !== 'boolean') errors.push(vmsg(locale, 'peakAlertWebNotify'))
  if (candidate.showSessionId !== undefined && typeof candidate.showSessionId !== 'boolean') errors.push(vmsg(locale, 'showSessionId'))
  if (candidate.peakStyle !== 'compact' && candidate.peakStyle !== 'classic') errors.push(vmsg(locale, 'peakStyle'))
  if (candidate.priceMatch !== 'auto' && candidate.priceMatch !== 'exact') errors.push(vmsg(locale, 'priceMatch'))
  const overrides = candidate.priceOverrides
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)
    || Object.entries(overrides).some(([k, v]) => typeof k !== 'string' || typeof v !== 'string')) {
    errors.push(vmsg(locale, 'priceOverrides'))
  }
  const tableDisplay = candidate.priceTableDisplay
  if (tableDisplay === null || typeof tableDisplay !== 'object' || Array.isArray(tableDisplay)) {
    candidate.priceTableDisplay = {}
  } else {
    for (const [provider, value] of Object.entries(tableDisplay)) tableDisplay[provider] = value === true
  }
  const historyDays = Number(candidate.historyDays)
  if (!Number.isInteger(historyDays) || historyDays < 7 || historyDays > 3650) errors.push(vmsg(locale, 'historyDays'))
  const budget = candidate.budget
  if (budget === null || typeof budget !== 'object' || Array.isArray(budget)) {
    errors.push(vmsg(locale, 'budget'))
  } else {
    if (typeof budget.enabled !== 'boolean') errors.push(vmsg(locale, 'budgetEnabled'))
    if (typeof budget.detail !== 'boolean') errors.push(vmsg(locale, 'budgetDetail'))
    const amount = Number(budget.amount)
    if (!Number.isFinite(amount) || amount < 0) errors.push(vmsg(locale, 'budgetAmount'))
    else budget.amount = amount
    if (!['day', 'month', 'all', 'custom'].includes(budget.period)) errors.push(vmsg(locale, 'budgetPeriod'))
    const dateKey = /^\d{4}-\d{2}-\d{2}$/
    for (const field of ['customStart', 'customEnd']) {
      const value = budget[field]
      if (value !== null && (typeof value !== 'string' || !dateKey.test(value))) {
        errors.push(vmsg(locale, 'budgetDate', { field }))
      }
    }
    if (budget.period === 'custom') {
      if (budget.customStart === null || typeof budget.customStart !== 'string') {
        errors.push(vmsg(locale, 'budgetCustomStart'))
      } else if (typeof budget.customEnd === 'string' && budget.customEnd < budget.customStart) {
        errors.push(vmsg(locale, 'budgetCustomEnd'))
      }
    }
  }
  const balance = candidate.balance
  if (balance === null || typeof balance !== 'object' || Array.isArray(balance)) {
    errors.push(vmsg(locale, 'balance'))
  } else {
    if (!['sidebar', 'settings', 'both', 'off'].includes(balance.display)) errors.push(vmsg(locale, 'balanceDisplay'))
    const refreshMinutes = Number(balance.refreshMinutes)
    if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 1440) errors.push(vmsg(locale, 'balanceRefresh'))
    else balance.refreshMinutes = refreshMinutes
    if (balance.showProgressBar !== undefined && typeof balance.showProgressBar !== 'boolean') errors.push(vmsg(locale, 'balanceShowBar'))
    if (balance.reconcile !== undefined && typeof balance.reconcile !== 'boolean') errors.push(vmsg(locale, 'balanceReconcile'))
    if (balance.budgetCap !== undefined && balance.budgetCap !== null) {
      const cap = Number(balance.budgetCap)
      if (!Number.isFinite(cap) || cap < 0) errors.push(vmsg(locale, 'balanceBudgetCap'))
      else balance.budgetCap = cap > 0 ? cap : null
    }
  }
  const customBalance = candidate.customBalance
  if (customBalance !== undefined) {
    if (customBalance === null || typeof customBalance !== 'object' || Array.isArray(customBalance)) {
      errors.push(vmsg(locale, 'customBalance'))
    } else {
      if (typeof customBalance.enabled !== 'boolean') errors.push(vmsg(locale, 'customBalanceEnabled'))
      if (!['sidebar', 'settings', 'both', 'off'].includes(customBalance.display)) errors.push(vmsg(locale, 'customBalanceDisplay'))
      const refreshMinutes = Number(customBalance.refreshMinutes)
      if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 1440) errors.push(vmsg(locale, 'customBalanceRefresh'))
      else customBalance.refreshMinutes = refreshMinutes
      if (typeof customBalance.label !== 'string') errors.push(vmsg(locale, 'customBalanceLabel'))
      if (customBalance.labelEn !== undefined && typeof customBalance.labelEn !== 'string') errors.push(vmsg(locale, 'customBalanceLabelEn'))
      if (customBalance.unit !== undefined && !['USD', 'CNY', 'EUR'].includes(customBalance.unit)) errors.push(vmsg(locale, 'customBalanceUnit'))
      const request = customBalance.request
      if (request === null || typeof request !== 'object' || Array.isArray(request) || typeof request.url !== 'string' || (customBalance.enabled === true && request.url.length === 0)) {
        errors.push(vmsg(locale, 'customBalanceRequest'))
      } else if (request.headers !== undefined && (request.headers === null || typeof request.headers !== 'object' || Array.isArray(request.headers)
        || Object.values(request.headers).some(value => typeof value !== 'string'))) {
        errors.push(vmsg(locale, 'customBalanceHeaders'))
      }
      const extract = customBalance.extract
      if (extract === null || typeof extract !== 'object' || Array.isArray(extract)) errors.push(vmsg(locale, 'customBalanceExtract'))
    }
  }
  const goQuota = candidate.goQuota
  if (goQuota === null || typeof goQuota !== 'object' || Array.isArray(goQuota)) {
    errors.push(vmsg(locale, 'goQuota'))
  } else {
    if (typeof goQuota.enabled !== 'boolean') errors.push(vmsg(locale, 'goQuotaEnabled'))
    if (!['sidebar', 'settings', 'both', 'off'].includes(goQuota.display)) errors.push(vmsg(locale, 'goQuotaDisplay'))
    const refreshMinutes = Number(goQuota.refreshMinutes)
    if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 1440) errors.push(vmsg(locale, 'goQuotaRefresh'))
    else goQuota.refreshMinutes = refreshMinutes
    if (typeof goQuota.apiKey !== 'string') errors.push(vmsg(locale, 'goQuotaKey'))
    if (!['rolling', 'weekly', 'monthly'].includes(goQuota.main)) errors.push(vmsg(locale, 'goQuotaMain'))
    if (typeof goQuota.detail !== 'boolean') errors.push(vmsg(locale, 'goQuotaDetail'))
  }
  const corner = candidate.corner
  if (corner === null || typeof corner !== 'object' || Array.isArray(corner)) {
    errors.push(vmsg(locale, 'corner'))
  } else {
    if (typeof corner.enabled !== 'boolean') errors.push(vmsg(locale, 'cornerEnabled'))
    for (const field of ['goRolling', 'goWeekly', 'goMonthly', 'budget']) {
      if (typeof corner[field] !== 'boolean') errors.push(vmsg(locale, 'cornerFlag', { field }))
    }
  }
  const usage = candidate.usage
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    errors.push(vmsg(locale, 'usage'))
  } else {
    if (!['cost', 'general', 'section'].includes(usage.position)) errors.push(vmsg(locale, 'usagePosition'))
  }
  const prices = candidate.prices
  if (prices === null || typeof prices !== 'object') {
    errors.push(vmsg(locale, 'prices'))
  } else {
    if (prices.models === null || typeof prices.models !== 'object' || Array.isArray(prices.models)) {
      errors.push(vmsg(locale, 'pricesModels'))
    } else {
      for (const [id, raw] of Object.entries(prices.models)) {
        const entry = normalizePrice(raw)
        if (entry === null) errors.push(vmsg(locale, 'modelPrice', { id }))
        else prices.models[id] = entry
      }
    }
    const def = normalizePrice(prices.default)
    if (def === null) errors.push(vmsg(locale, 'pricesDefault'))
    else prices.default = def
    if (prices.providers !== undefined) {
      if (prices.providers === null || typeof prices.providers !== 'object' || Array.isArray(prices.providers)) {
        errors.push(vmsg(locale, 'pricesProviders'))
      } else {
        for (const [provider, providerTable] of Object.entries(prices.providers)) {
          if (providerTable === null || typeof providerTable !== 'object' || Array.isArray(providerTable)
            || providerTable.models === null || typeof providerTable.models !== 'object' || Array.isArray(providerTable.models)) {
            errors.push(vmsg(locale, 'pricesProviders'))
            continue
          }
          for (const [id, raw] of Object.entries(providerTable.models)) {
            if (normalizePrice(raw) === null) errors.push(vmsg(locale, 'modelPrice', { id: `${provider}:${id}` }))
          }
        }
      }
    }
  }
  if (errors.length > 0) return { config: current, errors }
  return { config: candidate, errors: [] }
}

export function sanitizeConfig(raw) {
  const base = defaultConfig()
  const cfg = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = mergeDeep(base, cfg)
  // 2026-09-15: the legacy `deepseek-v4-flash` name is billed at the Flash price now. A stored entry that still equals
  // the pre-upgrade default was never edited by the user and follows the new default (its legacy tier kept); a
  // hand-edited price stays exactly as written. The comparison reads the entry AS STORED (`cfg`): the merge above
  // fills tiers the old entry never had (off-peak) from the new default, which must not read as a user edit.
  const storedModels = cfg.prices && typeof cfg.prices === 'object' && cfg.prices.models && typeof cfg.prices.models === 'object' ? cfg.prices.models : {}
  // any member beyond the tier numbers (notes, sourceUrl, reasoning, …) means the user touched the entry
  const TIER_KEYS = new Set(['cacheHit', 'cacheMiss', 'output', 'offPeak', 'peak', 'legacyBase'])
  // the user's entry with its tier members as the price reader completes them (the `input` alias becomes cacheMiss,
  // an invalid tier such as `peak: null` is dropped rather than handed to the cost formula), other members as written
  const restoreAsWritten = stored => {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null
    const numbers = normalizePrice(stored)
    if (numbers === null) return null
    const { cacheHit: _h, cacheMiss: _m, output: _o, offPeak: _op, peak: _p, legacyBase: _lb, ...rest } = stored
    return { ...structuredClone(rest), ...numbers }
  }
  const untouchedLegacy = e => !!e && typeof e === 'object' && !Array.isArray(e) && Object.keys(e).every(k => TIER_KEYS.has(k)) && isPre015FlashPrice(e)
  if (out.prices && typeof out.prices === 'object' && out.prices.models && typeof out.prices.models === 'object') {
    for (const id of PRE_0_1_5_FLASH_IDS) {
      const stored = storedModels[id]
      const fresh = DEFAULT_PRICE_TABLE.models[id]
      if (fresh && untouchedLegacy(stored)) out.prices.models[id] = { ...structuredClone(fresh), ...(stored.legacyBase ? { legacyBase: structuredClone(stored.legacyBase) } : {}) }
    }
    // A hand-edited entry is used exactly as written: the merge above would graft the default's off-peak / peak
    // tiers onto it and peak billing would then never use the user's numbers. Only the historical legacy tier
    // (a fact about the vendor, not a price edit) is filled in when the entry lacks it.
    for (const [id, stored] of Object.entries(storedModels)) {
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) continue
      if (PRE_0_1_5_FLASH_IDS.includes(id) && untouchedLegacy(stored)) continue // re-priced above
      const fresh = DEFAULT_PRICE_TABLE.models[id]
      // the user's numbers, completed the way every price is read (the `input` alias becomes cacheMiss, nothing is
      // left undefined for the cost formula), every other member kept as written
      const restored = restoreAsWritten(stored)
      if (restored === null) continue
      out.prices.models[id] = { ...restored, ...(restored.legacyBase === undefined && fresh?.legacyBase ? { legacyBase: structuredClone(fresh.legacyBase) } : {}) }
    }
    const storedDefault = cfg.prices?.default
    if (untouchedLegacy(storedDefault)) out.prices.default = { ...DEFAULT_PRICE_TABLE.default }
    else { const restored = restoreAsWritten(storedDefault); if (restored !== null) out.prices.default = restored }
  }
  const isNum = v => typeof v === 'number' && Number.isFinite(v)
  const oneOf = (v, list, fallback) => (typeof v === 'string' && list.includes(v) ? v : fallback)
  for (const [key, def] of Object.entries(base)) {
    const v = out[key]
    const t = typeof def
    if (t === 'boolean' && typeof v !== 'boolean') out[key] = def
    else if (t === 'number' && !isNum(v)) out[key] = def
    else if (t === 'string' && typeof v !== 'string') out[key] = def
    else if (t === 'object' && def !== null && (v === null || typeof v !== 'object' || Array.isArray(v) !== Array.isArray(def))) out[key] = def
  }
  out.locale = oneOf(out.locale, ['auto', 'zh', 'en'], 'auto')
  out.currencySource = oneOf(out.currencySource, ['auto', 'manual'], 'auto')
  out.position = oneOf(out.position, ['dock', 'header', 'off'], 'dock')
  out.peakStyle = oneOf(out.peakStyle, ['compact', 'classic'], 'compact')
  out.priceMatch = oneOf(out.priceMatch, ['auto', 'exact'], 'auto')
  out.decimals = Math.max(0, Math.min(10, Math.floor(Number(out.decimals) || 0)))
  out.historyDays = Math.max(7, Math.min(3650, Math.floor(Number(out.historyDays) || 180)))
  out.showSessionId = out.showSessionId === true
  out.peakAlertEnabled = out.peakAlertEnabled !== false
  const alertAhead = Number(out.peakAlertAhead)
  out.peakAlertAhead = Number.isInteger(alertAhead) && alertAhead >= 1 && alertAhead <= 30 ? alertAhead : 2
  out.peakAlertTarget = oneOf(out.peakAlertTarget, ['peak', 'offpeak', 'both'], 'both')
  out.peakAlertPosition = oneOf(out.peakAlertPosition, ['corner', 'center'], 'corner')
  out.peakAlertWebNotify = out.peakAlertWebNotify === true
  out.legacyAutoImportedAt = isNum(Number(out.legacyAutoImportedAt)) && Number(out.legacyAutoImportedAt) > 0 ? Number(out.legacyAutoImportedAt) : 0
  if (!isNum(out.exchangeRate) || out.exchangeRate <= 0) out.exchangeRate = base.exchangeRate
  if (!Array.isArray(out.peakWindows)) out.peakWindows = base.peakWindows
  else out.peakWindows = out.peakWindows.filter(w => w !== null && typeof w === 'object' && isNum(Number(w.start)) && isNum(Number(w.end)))
  const overrides = {}
  if (out.priceOverrides !== null && typeof out.priceOverrides === 'object') {
    for (const [k, v] of Object.entries(out.priceOverrides)) if (typeof k === 'string' && typeof v === 'string') overrides[k] = v
  }
  out.priceOverrides = overrides
  const tableDisplay = {}
  if (out.priceTableDisplay !== null && typeof out.priceTableDisplay === 'object' && !Array.isArray(out.priceTableDisplay)) {
    for (const [k, v] of Object.entries(out.priceTableDisplay)) {
      if (typeof k === 'string') tableDisplay[k] = typeof v === 'boolean' ? v : base.priceTableDisplay[k] === true
    }
  }
  out.priceTableDisplay = { ...base.priceTableDisplay, ...tableDisplay }
  const budget = out.budget
  budget.enabled = budget.enabled === true
  budget.amount = isNum(budget.amount) && budget.amount >= 0 ? budget.amount : 100
  budget.period = oneOf(budget.period, ['day', 'month', 'all', 'custom'], 'month')
  budget.customStart = typeof budget.customStart === 'string' ? budget.customStart : null
  budget.customEnd = typeof budget.customEnd === 'string' ? budget.customEnd : null
  budget.detail = budget.detail !== false
  const balance = out.balance
  balance.display = oneOf(balance.display, ['sidebar', 'settings', 'both', 'off'], 'both')
  balance.refreshMinutes = Math.min(1440, Math.max(1, Math.floor(Number(balance.refreshMinutes) || 5)))
  if (balance.showProgressBar === undefined) {
    balance.showProgressBar = out.customBalance?.showProgressBar !== undefined
      ? out.customBalance.showProgressBar === true
      : base.balance.showProgressBar === true
  }
  balance.showProgressBar = balance.showProgressBar === true
  balance.reconcile = balance.reconcile !== false
  const cap = Number(balance.budgetCap)
  balance.budgetCap = Number.isFinite(cap) && cap > 0 ? cap : null
  const goQuota = out.goQuota
  goQuota.enabled = goQuota.enabled === true
  goQuota.display = oneOf(goQuota.display, ['sidebar', 'settings', 'both', 'off'], 'both')
  goQuota.refreshMinutes = Math.min(1440, Math.max(1, Math.floor(Number(goQuota.refreshMinutes) || 15)))
  goQuota.apiKey = typeof goQuota.apiKey === 'string' ? goQuota.apiKey : ''
  goQuota.main = oneOf(goQuota.main, ['rolling', 'weekly', 'monthly'], 'rolling')
  goQuota.detail = goQuota.detail !== false
  const customBalance = out.customBalance ?? base.customBalance
  customBalance.enabled = customBalance.enabled === true
  customBalance.display = oneOf(customBalance.display, ['sidebar', 'settings', 'both', 'off'], 'both')
  customBalance.refreshMinutes = Math.min(1440, Math.max(1, Math.floor(Number(customBalance.refreshMinutes) || 15)))
  customBalance.label = typeof customBalance.label === 'string' ? customBalance.label : base.customBalance.label
  customBalance.labelEn = typeof customBalance.labelEn === 'string' ? customBalance.labelEn : base.customBalance.labelEn
  customBalance.unit = oneOf(customBalance.unit, ['USD', 'CNY', 'EUR'], base.customBalance.unit)
  if (customBalance.request === null || typeof customBalance.request !== 'object' || Array.isArray(customBalance.request)) {
    customBalance.request = { ...base.customBalance.request }
  } else {
    const cleanedHeaders = {}
    for (const [key, value] of Object.entries(customBalance.request.headers ?? {})) {
      if (typeof key === 'string' && typeof value === 'string') cleanedHeaders[key] = value
    }
    customBalance.request = {
      ...base.customBalance.request,
      ...customBalance.request,
      url: typeof customBalance.request.url === 'string' ? customBalance.request.url : '',
      method: typeof customBalance.request.method === 'string' ? customBalance.request.method : 'GET',
      headers: {
        ...(base.customBalance.request?.headers ?? {}),
        ...cleanedHeaders,
      },
    }
  }
  if (customBalance.extract === null || typeof customBalance.extract !== 'object' || Array.isArray(customBalance.extract)) {
    customBalance.extract = { ...base.customBalance.extract }
  } else {
    customBalance.extract = { ...base.customBalance.extract, ...customBalance.extract }
  }
  out.customBalance = customBalance
  const corner = out.corner
  for (const key of ['enabled', 'goRolling', 'goWeekly', 'goMonthly', 'budget']) corner[key] = corner[key] === true || (corner[key] !== false && key !== 'enabled')
  const plans = {}
  if (out.codingPlans !== null && typeof out.codingPlans === 'object') {
    for (const [id, entry] of Object.entries(out.codingPlans)) {
      if (!CODING_PLAN_PROVIDER_IDS.includes(id) || entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      plans[id] = {
        enabled: entry.enabled === true,
        display: oneOf(entry.display, ['sidebar', 'settings', 'both', 'off'], 'settings'),
        refreshMinutes: Math.min(1440, Math.max(1, Math.floor(Number(entry.refreshMinutes) || 15))),
        apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : '',
      }
      if (id === 'scnet') {
        const credits = Number(entry.planCredits)
        plans[id].planCredits = Number.isFinite(credits) && credits > 0 ? credits : 240000
        plans[id].planStart = typeof entry.planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.planStart) ? entry.planStart : ''
      }
    }
  }
  out.codingPlans = plans
  const goModels = out.prices?.providers?.['opencode-go']?.models
  if (goModels !== null && typeof goModels === 'object') {
    delete goModels['deepseek-v4-flash']
    delete goModels['deepseek-v4-pro']
  }
  return out
}

export class Ledger {
  constructor(config, days, path) {
    this.config = config
    this.days = days
    this.path = path
    this.writeTimer = null
    this.closed = false
    this.pendingWrite = false
    this.balanceRef = null
  }

  static open() {
    const root = join(resolveDshHome(), 'storages', 'cost-meter')
    const path = join(root, 'ledger.json')
    let config = defaultConfig()
    let days = {}
    let balanceRef = null
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        if (parsed.version !== LEDGER_VERSION) {
          console.warn(`[dsh-cost-meter] 账本版本 ${String(parsed.version)} 不受支持,按空账本启动`)
        } else {
          const cfg = typeof parsed.config === 'object' && parsed.config !== null ? parsed.config : {}
          config = sanitizeConfig(cfg)
          if (parsed.days !== null && typeof parsed.days === 'object' && !Array.isArray(parsed.days)) {
            days = sanitizeDays(parsed.days)
          }
          const ref = parsed.balanceRef
          if (ref !== null && typeof ref === 'object' && typeof ref.date === 'string'
            && Number.isFinite(ref.total) && Number.isFinite(ref.granted) && Number.isFinite(ref.topped)) {
            balanceRef = { date: ref.date, total: ref.total, granted: ref.granted, topped: ref.topped, currency: typeof ref.currency === 'string' ? ref.currency : undefined, at: Number(ref.at) || 0 }
          }
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[dsh-cost-meter] 账本读取失败,按空账本启动: ${String(error?.message ?? error)}`)
      }
    }
    const ledger = new Ledger(config, days, path)
    ledger.balanceRef = balanceRef
    return ledger
  }

  /**
   * Zero what an earlier version charged for local routes (they were priced by the DeepSeek
   * default table). Day and per-session rows alike; returns how many rows changed.
   */
  forgiveLocal(isLocal) {
    let touched = 0
    const fix = row => {
      const by = row?.byProviderModel
      if (by === null || typeof by !== 'object') return
      for (const [key, v] of Object.entries(by)) {
        const provider = key.slice(0, key.indexOf(':'))
        if (!isLocal(provider) || !(Number(v?.cost) > 0)) continue
        row.cost = Math.max(0, (Number(row.cost) || 0) - Number(v.cost))
        v.cost = 0
        touched++
      }
    }
    for (const day of Object.values(this.days ?? {})) {
      fix(day)
      for (const s of Object.values(day?.sessions ?? {})) fix(s)
    }
    if (touched > 0) this.scheduleWrite()
    return touched
  }

  /**
   * Repair pass over day rows, per-model rows and per-session rows, limited to what the local-route
   * rule can decide: a row of a local provider becomes free; a row of a paid provider that has tokens
   * but no cost (zeroed by an earlier, wider local rule) is priced again from the current tables.
   * A row that already carries a paid cost is left alone — its per-call tier (peak windows) cannot
   * be rebuilt from a day-level timestamp. A holder without a breakdown keeps its cost. Returns the
   * number of rows touched.
   */
  repriceAll(isLocal = () => false) {
    let touched = 0
    const priceRow = (row, key, atMs) => {
      const sep = key.indexOf(':')
      const provider = sep > 0 ? key.slice(0, sep) : ''
      const modelId = sep > 0 ? key.slice(sep + 1) : key
      const hasTokens = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'].some(k => (Number(row[k]) || 0) > 0)
      const currentCost = Number(row.cost) || 0
      const local = isLocal(provider)
      if (!local && (currentCost > 0 || !hasTokens)) return   // paid and already priced (or empty): keep
      const resolved = providerPriceEntryFor(provider, modelId, this.config.prices, { mode: this.config.priceMatch === 'exact' ? 'exact' : 'auto', overrides: this.config.priceOverrides })
      const entry = resolved.entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
      const peak = { enabled: resolved.billingMode === 'deepseek-peak' && this.config.peakEnabled === true, effectiveAtMs: Date.parse(this.config.peakEffectiveAt), windows: this.config.peakWindows }
      const tokens = { input: Number(row.input) || 0, output: Number(row.output) || 0, cacheRead: Number(row.cacheRead) || 0, cacheWrite: Number(row.cacheWrite) || 0, reasoning: Number(row.reasoning) || 0 }
      const cost = resolved.priced ? costOf(tokens, entry, atMs, peak) : 0
      if (Math.abs((Number(row.cost) || 0) - cost) > 1e-9) { row.cost = cost; touched++ }
    }
    const repriceHolder = (holder, atMs) => {
      const by = holder?.byProviderModel
      if (by === null || typeof by !== 'object' || Object.keys(by).length === 0) return   // no breakdown: nothing to decide from
      let sum = 0
      for (const [key, row] of Object.entries(by)) { priceRow(row, key, atMs); sum += Number(row.cost) || 0 }
      if (Math.abs((Number(holder.cost) || 0) - sum) > 1e-9) { holder.cost = sum; touched++ }
    }
    for (const [date, day] of Object.entries(this.days ?? {})) {
      const atMs = Date.parse(date + 'T12:00:00Z') || Date.now()
      repriceHolder(day, atMs)
      for (const s of Object.values(day?.sessions ?? {})) repriceHolder(s, atMs)
    }
    if (touched > 0) this.scheduleWrite()
    return touched
  }

  /** Display currency from the API's own: symbol and rate follow, unless the owner chose manually. */
  followCurrency(currency) {
    const cur = String(currency ?? '').toUpperCase()
    if (this.config.currencySource === 'manual' || !['USD', 'CNY', 'EUR'].includes(cur) || this.config.currency === cur) return false
    const rate = cur === 'USD' ? 1 : cur === 'EUR' ? 0.92 : (Number(this.config.exchangeRate) > 1 ? Number(this.config.exchangeRate) : 7.2)
    this.config = { ...this.config, currency: cur, symbol: cur === 'USD' ? '$' : cur === 'EUR' ? '€' : '¥', exchangeRate: rate }
    this.scheduleWrite()
    return true
  }

  account(tokens, modelId, sessionId, atMs, provider) {
    if (this.closed) return
    const resolved = providerPriceEntryFor(provider, modelId, this.config.prices, {
      mode: this.config.priceMatch === 'exact' ? 'exact' : 'auto',
      overrides: this.config.priceOverrides,
    })
    const entry = resolved.entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
    const peak = {
      enabled: resolved.billingMode === 'deepseek-peak' && this.config.peakEnabled === true,
      effectiveAtMs: Date.parse(this.config.peakEffectiveAt),
      windows: this.config.peakWindows,
    }
    const cost = resolved.priced ? costOf(tokens, entry, atMs, peak) : 0
    const num = value => {
      const n = Number(value)
      return Number.isFinite(n) && n > 0 ? n : 0
    }
    const buckets = {
      input: num(tokens?.input),
      output: num(tokens?.output),
      cacheRead: num(tokens?.cacheRead),
      cacheWrite: num(tokens?.cacheWrite),
      reasoning: num(tokens?.reasoning),
    }
    const date = localDayKey(atMs)
    let day = this.days[date]
    if (day === undefined || day === null || typeof day !== 'object') {
      day = zeroDay(date)
      this.days[date] = day
    }
    day.input += buckets.input
    day.output += buckets.output
    day.cacheRead += buckets.cacheRead
    day.cacheWrite += buckets.cacheWrite
    day.reasoning += buckets.reasoning
    day.calls += 1
    day.cost += cost
    const providerKey = `${typeof provider === 'string' && provider.length > 0 ? provider : 'deepseek'}:${String(modelId ?? 'default')}`
    day.byProviderModel = day.byProviderModel ?? {}
    const dayProvider = day.byProviderModel[providerKey] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
    day.byProviderModel[providerKey] = {
      input: dayProvider.input + buckets.input,
      output: dayProvider.output + buckets.output,
      cacheRead: dayProvider.cacheRead + buckets.cacheRead,
      cacheWrite: dayProvider.cacheWrite + buckets.cacheWrite,
      reasoning: dayProvider.reasoning + buckets.reasoning,
      calls: dayProvider.calls + 1,
      cost: dayProvider.cost + cost,
    }
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      let sessions = Array.isArray(day.sessions) ? day.sessions : []
      let session = sessions.find(s => s.id === sessionId)
      if (session === undefined) {
        session = zeroSession(sessionId)
        session.at = atMs
        sessions.push(session)
        if (sessions.length > MAX_SESSIONS_PER_DAY) sessions = sessions.slice(-MAX_SESSIONS_PER_DAY)
        day.sessions = sessions
      }
      session.input += buckets.input
      session.output += buckets.output
      session.cacheRead += buckets.cacheRead
      session.cacheWrite += buckets.cacheWrite
      session.reasoning += buckets.reasoning
      session.calls += 1
      session.cost += cost
      session.byProviderModel = session.byProviderModel ?? {}
      const sessionProvider = session.byProviderModel[providerKey] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
      session.byProviderModel[providerKey] = {
        input: sessionProvider.input + buckets.input,
        output: sessionProvider.output + buckets.output,
        cacheRead: sessionProvider.cacheRead + buckets.cacheRead,
        cacheWrite: sessionProvider.cacheWrite + buckets.cacheWrite,
        reasoning: sessionProvider.reasoning + buckets.reasoning,
        calls: sessionProvider.calls + 1,
        cost: sessionProvider.cost + cost,
      }
    }
    this.prune()
    this.scheduleWrite()
  }

  prune() {
    const keep = Math.max(7, Math.min(3650, Number(this.config.historyDays) || DEFAULT_HISTORY_DAYS))
    const keys = Object.keys(this.days).sort()
    while (keys.length > keep) delete this.days[keys.shift()]
  }

  scheduleWrite() {
    this.pendingWrite = true
    if (this.writeTimer !== null) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.flush()
    }, 2000)
  }

  flush() {
    if (!this.pendingWrite || this.closed) return
    this.pendingWrite = false
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: LEDGER_VERSION, config: this.config, days: this.days, balanceRef: this.balanceRef ?? null }), 'utf8')
      renameSync(tmp, this.path)
    } catch (error) {
      console.warn(`[dsh-cost-meter] 账本写入失败: ${String(error?.message ?? error)}`)
    }
  }

  close() {
    this.closed = true
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.flush()
  }

  sumDays(prefix) {
    const total = zeroDay(prefix === undefined ? 'total' : prefix)
    for (const [date, day] of Object.entries(this.days)) {
      if (prefix !== undefined && !date.startsWith(prefix)) continue
      total.input += day.input ?? 0
      total.output += day.output ?? 0
      total.cacheRead += day.cacheRead ?? 0
      total.cacheWrite += day.cacheWrite ?? 0
      total.reasoning += day.reasoning ?? 0
      total.calls += day.calls ?? 0
      total.cost += day.cost ?? 0
      for (const [key, value] of Object.entries(day.byProviderModel ?? {})) {
        const current = total.byProviderModel[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
        total.byProviderModel[key] = {
          input: current.input + (value.input ?? 0), output: current.output + (value.output ?? 0),
          cacheRead: current.cacheRead + (value.cacheRead ?? 0), cacheWrite: current.cacheWrite + (value.cacheWrite ?? 0),
          reasoning: current.reasoning + (value.reasoning ?? 0),
          calls: current.calls + (value.calls ?? 0), cost: current.cost + (value.cost ?? 0),
        }
      }
    }
    total.date = prefix === undefined ? 'total' : prefix
    return total
  }

  sumRange(startKey, endKey) {
    const total = zeroDay(`${startKey}..${endKey}`)
    if (typeof startKey !== 'string' || typeof endKey !== 'string') return total
    for (const [date, day] of Object.entries(this.days)) {
      if (date < startKey || date > endKey) continue
      total.input += day.input ?? 0
      total.output += day.output ?? 0
      total.cacheRead += day.cacheRead ?? 0
      total.cacheWrite += day.cacheWrite ?? 0
      total.reasoning += day.reasoning ?? 0
      total.calls += day.calls ?? 0
      total.cost += day.cost ?? 0
      for (const [key, value] of Object.entries(day.byProviderModel ?? {})) {
        const current = total.byProviderModel[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
        total.byProviderModel[key] = {
          input: current.input + (value.input ?? 0), output: current.output + (value.output ?? 0),
          cacheRead: current.cacheRead + (value.cacheRead ?? 0), cacheWrite: current.cacheWrite + (value.cacheWrite ?? 0),
          reasoning: current.reasoning + (value.reasoning ?? 0),
          calls: current.calls + (value.calls ?? 0), cost: current.cost + (value.cost ?? 0),
        }
      }
    }
    return total
  }

  today() {
    const date = localDayKey(Date.now())
    const day = this.days[date]
    return day === undefined ? zeroDay(date) : this.copyDay(day)
  }

  history(limit = 60) {
    return Object.keys(this.days)
      .sort()
      .reverse()
      .slice(0, limit)
      .map(date => this.copyDay(this.days[date], true))
  }

  copyDay(day, withoutSessions = false) {
    const sessions = withoutSessions || !Array.isArray(day.sessions)
      ? []
      : day.sessions.slice().sort((a, b) => b.cost - a.cost).map(s => ({ ...s }))
    return {
      date: String(day.date),
      input: day.input ?? 0,
      output: day.output ?? 0,
      cacheRead: day.cacheRead ?? 0,
      cacheWrite: day.cacheWrite ?? 0,
      reasoning: day.reasoning ?? 0,
      calls: day.calls ?? 0,
      cost: day.cost ?? 0,
      byProviderModel: day.byProviderModel ?? {},
      sessions,
    }
  }
}

export function reconcileBalanceDelta(prevRef, balance, todayCost, dayKey, nowMs) {
  if (balance === null || typeof balance !== 'object' || !Number.isFinite(balance.totalBalance)) {
    return { ref: prevRef ?? null, event: null }
  }
  const snap = {
    date: dayKey,
    total: balance.totalBalance,
    granted: Number.isFinite(balance.grantedBalance) ? balance.grantedBalance : 0,
    topped: Number.isFinite(balance.toppedUpBalance) ? balance.toppedUpBalance : 0,
    currency: typeof balance.currency === 'string' ? balance.currency : '',
    at: nowMs,
  }
  if (prevRef === null || typeof prevRef !== 'object' || prevRef.date !== dayKey) {
    return { ref: snap, event: { kind: 'baseline' } }
  }
  if (prevRef.currency !== snap.currency) {
    return { ref: snap, event: { kind: 'structure-reset' } }
  }
  if (snap.granted > prevRef.granted + 0.009 || snap.topped > prevRef.topped + 0.009) {
    return { ref: snap, event: { kind: 'structure-reset' } }
  }
  const spent = prevRef.total - snap.total
  if (spent <= 0.009) return { ref: prevRef, event: { kind: 'flat' } }
  const dev = Math.abs(spent - todayCost)
  const threshold = Math.max(0.3, 0.15 * Math.max(spent, todayCost))
  if (dev > threshold) return { ref: prevRef, event: { kind: 'drift', spent, todayCost } }
  return { ref: prevRef, event: { kind: 'ok', spent, todayCost } }
}

export function pickBalanceInfo(infos) {
  const list = Array.isArray(infos) ? infos.filter(entry => entry !== null && typeof entry === 'object') : []
  const positive = list.filter(entry => Number(entry.total_balance) > 0)
  const cnyFirst = entries => entries.find(entry => String(entry.currency).toUpperCase() === 'CNY')
  return cnyFirst(positive) ?? positive[0] ?? cnyFirst(list) ?? list[0]
}
