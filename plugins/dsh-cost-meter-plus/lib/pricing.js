/**
 * Price tables and billing: the built-in multi-vendor model price catalog,
 * official DeepSeek pricing page parsing and sync, peak / off-peak windows,
 * model matching (exact / auto) and the cost-of-usage computation.
 */
export const OFFICIAL_PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing'

export const DEFAULT_PEAK_EFFECTIVE_AT = '2026-08-01T00:00:00Z'

export const LEGACY_BASE_BOUNDARY = '2026-08-16T16:00:00Z'

export const LEGACY_BASE_PRICES = {
  'deepseek-v4-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  'deepseek-v4-pro': { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
  'deepseek-chat': { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
  'deepseek-reasoner': { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
}

export const DEFAULT_PEAK_WINDOWS = [
  { start: 1, end: 4 },
  { start: 6, end: 10 },
]

export const DEFAULT_PROVIDER_PRICE_TABLE = {
  openai: {
    models: {
      'gpt-5.6-sol': { input: 5, cachedInput: 0.5, output: 30, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 输入按 $10/$45 计;缓存写入 $6.25' },
      'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 按 $4/$18 计;缓存写入 $2.50' },
      'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 按 $0.40/$1.80 计;缓存写入 $0.25' },
      'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 按 $10/$45 计' },
      'gpt-5.5-pro': { input: 30, output: 180, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 按 $5/$22.5 计' },
      'gpt-5.4-pro': { input: 30, output: 180, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.3-codex-spark': { input: 1.75, cachedInput: 0.175, output: 14, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5.1': { input: 1.07, cachedInput: 0.107, output: 8.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.1-codex': { input: 1.07, cachedInput: 0.107, output: 8.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5': { input: 1.07, cachedInput: 0.107, output: 8.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5-codex': { input: 1.07, cachedInput: 0.107, output: 8.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5-2025-08-07': { input: 1.25, cachedInput: 0.13, output: 10, billingMode: 'flat', notes: '2025-08 首发价;当前同名 gpt-5 已调价,历史 id 保留' },
      'gpt-4.1-2025-04-14': { input: 2, cachedInput: 0.5, output: 8, billingMode: 'flat' },
      'gpt-4.1-mini-2025-04-14': { input: 0.4, cachedInput: 0.1, output: 1.6, billingMode: 'flat' },
    },
  },
  anthropic: {
    models: {
      'claude-fable-5': { input: 10, cachedInput: 1, output: 50, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $12.50' },
      'claude-opus-5': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $6.25' },
      'claude-opus-4-8': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $6.25' },
      'claude-opus-4-7': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'claude-opus-4-6': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'claude-opus-4-5': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', notes: '缓存写入 $6.25' },
      'claude-sonnet-5': { input: 2, cachedInput: 0.2, output: 10, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '早鸟价(至 2026-08-31);标准价 $3/$15' },
      'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, output: 15, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $3.75' },
      'claude-sonnet-4-5': { input: 3, cachedInput: 0.3, output: 15, billingMode: 'flat', notes: '≤200K 档;>200K 按 $6/$22.5 计;缓存写入 $3.75' },
      'claude-haiku-4-5': { input: 1, cachedInput: 0.1, output: 5, billingMode: 'flat', notes: '缓存写入 $1.25' },
    },
  },
  google: {
    models: {
      'gemini-3.7-flash': { input: 0.75, output: 3.75, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17', notes: '2026 年底前促销价;2027 起 $1.5/$7.5;Go 网关按 $1.5/$7.5' },
      'gemini-3.6-flash': { input: 1.5, cachedInput: 0.15, output: 7.5, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
      'gemini-3.5-flash': { input: 1.5, cachedInput: 0.15, output: 9, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
      'gemini-3.5-flash-lite': { input: 0.3, cachedInput: 0.03, output: 2.5, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
      'gemini-3.1-pro-preview': { input: 2, cachedInput: 0.2, output: 12, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17', notes: '≤200K 档;>200K 按 $4/$18 计' },
      'gemini-3-flash': { input: 0.5, cachedInput: 0.05, output: 3, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17', notes: 'Preview' },
      'gemini-2.5-pro': { input: 1.25, cachedInput: 0.125, output: 10, billingMode: 'flat', notes: '≤200K 档;>200K 按 $2.5/$15 计' },
      'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
      'gemini-2.5-flash-lite': { input: 0.1, cachedInput: 0.01, output: 0.4, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
    },
  },
  moonshot: {
    models: {
      'kimi-k3': { input: 3, cachedInput: 0.3, output: 15, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '官方人民币价 ¥20/¥100/缓存¥2 每百万;此处为 Go 网关美元价' },
      'kimi-k2.7-code': { input: 0.95, cachedInput: 0.19, output: 4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k2.6': { input: 0.95, cachedInput: 0.16, output: 4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k2.5': { input: 0.6, cachedInput: 0.1, output: 3, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-08-05 起弃用' },
    },
  },
  'z-ai': {
    models: {
      'glm-5.3': { unpriced: true, billingMode: 'flat', notes: 'OpenCode Go 目录在册;官方/Zen 均未公布单价,不编造价格' },
      'glm-5.2': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'glm-5.1': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'glm-5': { input: 1, cachedInput: 0.2, output: 3.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-05-14 起弃用' },
    },
  },
  xai: {
    models: {
      'grok-4.6': { input: 2, cachedInput: 0.5, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤200K 档;>200K 按 $4/$12 计' },
      'grok-4.5': { input: 2, cachedInput: 0.3, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤200K 档;>200K 按 $4/$12 计' },
      'grok-4.3': { input: 1.25, output: 2.5, billingMode: 'flat', sourceUrl: 'https://docs.x.ai/developers/models/grok-4.3' },
      'grok-build-0.1': { input: 1, cachedInput: 0.2, output: 2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
    },
  },
  alibaba: {
    models: {
      'qwen3.8-max': { input: 2, cachedInput: 0.25, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '缓存写入 $2.50' },
      'qwen3.7-max': { input: 2.5, cachedInput: 0.5, output: 7.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '缓存写入 $3.125' },
      'qwen3.7-plus': { input: 0.4, cachedInput: 0.04, output: 1.6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '≤256K 档;>256K 按 $1.2/$4.8 计;缓存写入 $0.50' },
      'qwen3.6-plus': { input: 0.5, cachedInput: 0.05, output: 3, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '≤256K 档;>256K 按 $2/$6 计;缓存写入 $0.625' },
      'qwen3.5-plus': { input: 0.2, cachedInput: 0.02, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $0.25' },
      'qwen3-plus': { input: 0.4, output: 1.2, billingMode: 'flat', sourceUrl: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing' },
    },
  },
  minimax: {
    models: {
      'minimax-m3': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'minimax-m2.7': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'minimax-m2.5': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-08-05 起弃用' },
    },
  },
  tencent: {
    models: {
      'hunyuan-a13b': { input: 0.5, output: 2, billingMode: 'flat', notes: 'Official price is CNY; catalog value requires currency conversion before use.' },
      'hy3': { input: 0.14, cachedInput: 0.035, output: 0.58, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: 'OpenCode Go 目录价;厂商归属未官宣' },
    },
  },
  xiaomi: {
    models: {
      'mimo-v2.5': { input: 0.14, cachedInput: 0.0028, output: 0.28, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'mimo-v2.5-pro': { input: 0.435, cachedInput: 0.003625, output: 0.87, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
    },
  },
  upstage: {
    models: {
      'solar-pro4': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://www.upstage.ai/pricing/api' },
      'solar-pro3': { input: 0.15, cachedInput: 0.015, output: 0.6, billingMode: 'flat', sourceUrl: 'https://www.upstage.ai/pricing/api' },
    },
  },
  nvidia: { models: { 'nvidia/nemotron-3-ultra-550b-a55b': { unpriced: true, billingMode: 'flat', notes: 'Official catalog does not publish token price.' } } },
  mistral: {
    models: {
      'mistral-large-2512': { input: 0.5, cachedInput: 0.05, output: 1.5, billingMode: 'flat' },
      'mistral-medium-3.5': { input: 1.5, cachedInput: 0.15, output: 7.5, billingMode: 'flat' },
      'mistral-small-4.0': { input: 0.15, cachedInput: 0.015, output: 0.6, billingMode: 'flat' },
    },
  },
  'opencode-go': {
    models: {
      'grok-4.5': { input: 2, cachedInput: 0.3, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'glm-5.3': { unpriced: true, billingMode: 'flat', notes: 'Go 目录在册;官方未公布单价' },
      'glm-5.2': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'glm-5.1': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k3': { input: 3, cachedInput: 0.3, output: 15, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k2.7-code': { input: 0.95, cachedInput: 0.19, output: 4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k2.6': { input: 0.95, cachedInput: 0.16, output: 4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'mimo-v2.5': { input: 0.14, cachedInput: 0.0028, output: 0.28, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'mimo-v2.5-pro': { input: 0.435, cachedInput: 0.003625, output: 0.87, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'minimax-m3': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'minimax-m2.7': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'qwen3.8-max': { input: 2, cachedInput: 0.25, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'qwen3.7-max': { input: 2.5, cachedInput: 0.5, output: 7.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'qwen3.7-plus': { input: 0.4, cachedInput: 0.04, output: 1.6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'qwen3.6-plus': { input: 0.5, cachedInput: 0.05, output: 3, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'hy3': { input: 0.14, cachedInput: 0.035, output: 0.58, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
    },
  },
}

export const PROVIDER_MODEL_FAMILIES = {
  deepseek: { 'deepseek-v4-flash': 'DeepSeek v4', 'deepseek-v4-pro': 'DeepSeek v4' },
  openai: {
    'gpt-5.6-sol': 'GPT-5.6', 'gpt-5.6-terra': 'GPT-5.6', 'gpt-5.6-luna': 'GPT-5.6',
    'gpt-5.5': 'GPT-5.5', 'gpt-5.5-pro': 'GPT-5.5',
    'gpt-5.4': 'GPT-5.4', 'gpt-5.4-pro': 'GPT-5.4', 'gpt-5.4-mini': 'GPT-5.4', 'gpt-5.4-nano': 'GPT-5.4',
    'gpt-5.3-codex': 'GPT-5.3 Codex', 'gpt-5.3-codex-spark': 'GPT-5.3 Codex',
    'gpt-5.2': 'GPT-5.2', 'gpt-5.2-codex': 'GPT-5.2',
    'gpt-5.1': 'GPT-5.1', 'gpt-5.1-codex': 'GPT-5.1', 'gpt-5.1-codex-max': 'GPT-5.1', 'gpt-5.1-codex-mini': 'GPT-5.1',
    'gpt-5': 'GPT-5', 'gpt-5-codex': 'GPT-5', 'gpt-5-nano': 'GPT-5', 'gpt-5-2025-08-07': 'GPT-5',
    'gpt-4.1': 'GPT-4.1', 'gpt-4.1-mini': 'GPT-4.1',
  },
  anthropic: {
    'claude-fable-5': 'Claude Fable',
    'claude-opus-5': 'Claude Opus', 'claude-opus-4-8': 'Claude Opus', 'claude-opus-4-7': 'Claude Opus', 'claude-opus-4-6': 'Claude Opus', 'claude-opus-4-5': 'Claude 4.5',
    'claude-sonnet-5': 'Claude Sonnet', 'claude-sonnet-4-6': 'Claude Sonnet', 'claude-sonnet-4-5': 'Claude 4.5',
    'claude-haiku-4-5': 'Claude 4.5',
  },
  google: {
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-3.5-flash': 'Gemini 3.5 Flash', 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
    'gemini-3-flash': 'Gemini 3 Flash',
    'gemini-2.5-pro': 'Gemini 2.5', 'gemini-2.5-flash': 'Gemini 2.5', 'gemini-2.5-flash-lite': 'Gemini 2.5',
  },
  moonshot: { 'kimi-k3': 'Kimi K3', 'kimi-k2.7-code': 'Kimi K2', 'kimi-k2.6': 'Kimi K2', 'kimi-k2.5': 'Kimi K2' },
  'z-ai': { 'glm-5.3': 'GLM-5', 'glm-5.2': 'GLM-5', 'glm-5.1': 'GLM-5', 'glm-5': 'GLM-5' },
  xai: { 'grok-4.6': 'Grok 4', 'grok-4.5': 'Grok 4', 'grok-4.3': 'Grok 4', 'grok-build-0.1': 'Grok Build' },
  alibaba: { 'qwen3.8-max': 'Qwen3.8', 'qwen3.7-max': 'Qwen3.7', 'qwen3.7-plus': 'Qwen3.7', 'qwen3.6-plus': 'Qwen3.6', 'qwen3.5-plus': 'Qwen3.5', 'qwen3-plus': 'Qwen3' },
  minimax: { 'minimax-m3': 'MiniMax M3', 'minimax-m2.7': 'MiniMax M2', 'minimax-m2.5': 'MiniMax M2' },
  tencent: { 'hunyuan-a13b': '混元', 'hy3': 'Hy3' },
  xiaomi: { 'mimo-v2.5': 'MiMo V2.5', 'mimo-v2.5-pro': 'MiMo V2.5' },
  upstage: { 'solar-pro4': 'Solar', 'solar-pro3': 'Solar' },
  nvidia: { 'nvidia/nemotron-3-ultra-550b-a55b': 'Nemotron' },
  mistral: { 'mistral-large-2512': 'Mistral Large', 'mistral-medium-3.5': 'Mistral Medium', 'mistral-small-4.0': 'Mistral Small' },
  'opencode-go': {
    'gpt-5.6-luna': 'GPT', 'grok-4.5': 'Grok', 'glm-5.3': 'GLM', 'glm-5.2': 'GLM', 'glm-5.1': 'GLM',
    'kimi-k3': 'Kimi', 'kimi-k2.7-code': 'Kimi', 'kimi-k2.6': 'Kimi',
    'mimo-v2.5': 'MiMo', 'mimo-v2.5-pro': 'MiMo', 'minimax-m3': 'MiniMax', 'minimax-m2.7': 'MiniMax',
    'qwen3.8-max': 'Qwen', 'qwen3.7-max': 'Qwen', 'qwen3.7-plus': 'Qwen', 'qwen3.6-plus': 'Qwen',
    'hy3': 'Hy3',
  },
}

export function buildPriceCatalog() {
  const catalog = Object.create(null)
  const isUnsafeKey = (key) => key === '__proto__' || key === 'constructor' || key === 'prototype'
  const put = (provider, id, entry) => {
    const family = PROVIDER_MODEL_FAMILIES[provider]?.[id] ?? id
    if (isUnsafeKey(provider) || isUnsafeKey(family) || isUnsafeKey(id)) return
    if (catalog[provider] === undefined) catalog[provider] = Object.create(null)
    if (catalog[provider][family] === undefined) catalog[provider][family] = Object.create(null)
    catalog[provider][family][id] = entry
  }
  for (const [id, entry] of Object.entries(DEFAULT_PRICE_TABLE.models)) put('deepseek', id, entry)
  for (const [provider, table] of Object.entries(DEFAULT_PROVIDER_PRICE_TABLE)) {
    for (const [id, entry] of Object.entries(table.models)) put(provider, id, entry)
  }
  return catalog
}

export const DEFAULT_PRICE_TABLE = {
  models: {
    'deepseek-v4-flash': {
      cacheHit: 0.007,
      cacheMiss: 0.22,
      output: 0.66,
      offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
      peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
      legacyBase: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    },
    'deepseek-v4-pro': {
      cacheHit: 0.022,
      cacheMiss: 0.66,
      output: 1.98,
      offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
      peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
      legacyBase: { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
    },
  },
  default: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
}

function completeTier(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const n = key => {
    const v = raw[key]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  }
  const cacheMiss = n('cacheMiss') ?? n('input') ?? 0
  const cacheHit = n('cacheHit') ?? n('cachedInput') ?? n('cacheRead') ?? cacheMiss
  const output = n('output') ?? 0
  const reasoning = n('reasoning')
  return reasoning === undefined ? { cacheHit, cacheMiss, output } : { cacheHit, cacheMiss, output, reasoning }
}

export function normalizePrice(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.unpriced === true) {
    const entry = { unpriced: true }
    for (const key of ['billingMode', 'sourceUrl', 'checkedAt', 'notes']) if (typeof value[key] === 'string') entry[key] = value[key]
    return entry
  }
  if (!('cacheHit' in value) && !('cacheMiss' in value) && !('output' in value) && !('input' in value)) return null
  const entry = completeTier(value)
  if (value.legacy === true) entry.legacy = true
  if (value.billingMode === 'flat' || value.billingMode === 'deepseek-peak' || value.billingMode === 'batch') entry.billingMode = value.billingMode
  for (const key of ['sourceUrl', 'checkedAt', 'notes']) if (typeof value[key] === 'string') entry[key] = value[key]
  const offPeak = completeTier(value.offPeak)
  if (offPeak !== undefined) entry.offPeak = offPeak
  const peak = completeTier(value.peak)
  if (peak !== undefined) entry.peak = peak
  const legacyBase = completeTier(value.legacyBase)
  if (legacyBase !== undefined) entry.legacyBase = legacyBase
  return entry
}

export function isZeroPrice(entry) {
  return entry !== null && entry.cacheHit === 0 && entry.cacheMiss === 0 && entry.output === 0
}

export function priceEntryFor(modelId, table) {
  const models = table?.models ?? {}
  if (typeof modelId === 'string' && modelId.length > 0) {
    const exact = models[modelId]
    if (exact !== undefined) return exact
  }
  return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
}


export function canonModelId(id) {
  return String(id ?? '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
}

function stripIdDecor(id) {
  let out = String(id).toLowerCase()
  out = out.replace(/[-@]\d{4}-?\d{2}-?\d{2}$/, '')
  out = out.replace(/[-@]v\d+(\.\d+)*$/, '')
  return out
}

const tokensOf = id => stripIdDecor(id).split(/[-_./:]+/).filter(Boolean)

export function matchModelId(modelId, candidates) {
  if (typeof modelId !== 'string' || modelId.length === 0) return null
  const list = Array.isArray(candidates) ? candidates.filter(c => typeof c === 'string' && c.length > 0) : []
  if (list.length === 0) return null
  const exact = list.find(c => c === modelId)
  if (exact !== undefined) return exact
  const canon = canonModelId(modelId)
  if (canon.length === 0) return null
  const byCanon = list.find(c => canonModelId(c) === canon)
  if (byCanon !== undefined) return byCanon
  let containHit = null
  let containLen = 0
  for (const c of list) {
    const cc = canonModelId(c)
    if (cc.length < 4 || cc === canon) continue
    if (canon.includes(cc) && cc.length > containLen) { containHit = c; containLen = cc.length }
  }
  if (containHit !== null) return containHit
  const stripped = stripIdDecor(modelId)
  const byStripped = list.find(c => stripIdDecor(c) === stripped)
  if (byStripped !== undefined) return byStripped
  let prefixHit = null
  for (const c of list) {
    const cs = stripIdDecor(c)
    if (cs.length === 0 || cs === stripped) continue
    if (stripped.startsWith(cs) && /^[\-_./:]/.test(stripped.slice(cs.length))) {
      if (prefixHit === null || stripIdDecor(prefixHit).length < cs.length) prefixHit = c
    }
  }
  if (prefixHit !== null) return prefixHit
  const mt = tokensOf(modelId)
  if (mt.length < 2) return null
  let best = null
  let bestLen = 0
  for (const c of list) {
    const ct = tokensOf(c)
    let n = 0
    while (n < mt.length && n < ct.length && mt[n] === ct[n]) n += 1
    if (n < mt.length && n < ct.length && /^\d+$/.test(mt[n]) && /^\d+$/.test(ct[n])) continue
    if (n >= 2 && (n > bestLen || (n === bestLen && best !== null && c.length < best.length))) {
      best = c
      bestLen = n
    }
  }
  return best
}

// A local inference route (LM Studio, Ollama, vLLM, …) is billed by nobody. Without this it fell
// through to the DeepSeek default table — a 27B on this machine "cost" $5.78 in one day.
const LOCAL_PROVIDER_ID = /^(lmstudio|lm-studio|ollama|vllm|local|localai|llama\.?cpp|koboldcpp|oobabooga|text-generation-webui)$/i
const localProviderIds = new Set()
/** Route ids the caller has classified as local (by their loopback/LAN base URL). */
export function markLocalProviders(ids) {
  localProviderIds.clear()
  for (const id of ids ?? []) localProviderIds.add(String(id).trim().toLowerCase().replace(/^llm-/, ''))
}
export function isLocalProvider(provider) {
  const key = String(provider ?? '').trim().toLowerCase().replace(/^llm-/, '')
  return key.length > 0 && (LOCAL_PROVIDER_ID.test(key) || localProviderIds.has(key))
}
export const FREE_ENTRY = Object.freeze({ cacheHit: 0, cacheMiss: 0, output: 0 })

// A paid vendor's route pointed at a loopback gateway or proxy is still that vendor's bill — but
// only when the route also names that vendor's credential: a local server named after the model
// it serves ("deepseek-r1" on Ollama, "kimi-local") carries no vendor key and stays free.
const PAID_VENDOR_NAME = /^(openrouter|openai|deepseek|anthropic|claude|google|gemini|xai|grok|moonshot|kimi|zhipu|zai|minimax|siliconflow|together|groq|mistral|cohere|perplexity|opencode)(?:[-_.:]|$)/i
const PAID_VENDOR_KEY = /^(OPENROUTER|OPENAI|DEEPSEEK|ANTHROPIC|CLAUDE|GOOGLE|GEMINI|XAI|GROK|MOONSHOT|KIMI|ZHIPU|ZAI|MINIMAX|SILICONFLOW|TOGETHER|GROQ|MISTRAL|COHERE|PERPLEXITY|OPENCODE)[A-Z0-9_]*_(API_)?(KEY|TOKEN)$/i
/** True for a route that is a paid vendor's even behind a loopback host: vendor name AND vendor credential. */
export function paidVendorRoute(route) {
  const id = String(route?.id ?? '').trim()
  const env = String(route?.apiKeyEnv ?? '').trim()
  return PAID_VENDOR_NAME.test(id) && PAID_VENDOR_KEY.test(env)
}

export function providerPriceEntryFor(provider, modelId, prices, options) {
  const rawProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
  const normalized = rawProvider.startsWith('llm-') ? rawProvider.slice(4) : rawProvider
  const mode = options?.mode === 'exact' ? 'exact' : 'auto'
  const overrides = options?.overrides !== null && typeof options?.overrides === 'object' ? options.overrides : {}
  let targetModel = modelId
  let targetProvider = normalized
  const overrideKey = (normalized === '' ? 'deepseek' : normalized) + ':' + modelId
  const override = overrides[overrideKey]
  if (typeof override === 'string' && override.length > 0) {
    const sep = override.indexOf(':')
    if (sep > 0 && override.slice(sep + 1).length > 0) {
      targetProvider = override.slice(0, sep).trim().toLowerCase()
      targetModel = override.slice(sep + 1)
    } else {
      targetModel = override
    }
    if (targetProvider === 'deepseek' && targetModel === '__default__') {
      return { entry: prices?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, billingMode: 'deepseek-peak', priced: true }
    }
  }
  // An explicit override may still price a local route on purpose; otherwise it is free.
  if (override === undefined && isLocalProvider(targetProvider)) return { entry: { ...FREE_ENTRY }, billingMode: 'flat', priced: true, local: true }
  if (targetProvider === '' || targetProvider === 'deepseek' || targetProvider.includes('deepseek')) {
    const models = prices?.models ?? {}
    const hit = models[targetModel] !== undefined
      ? targetModel
      : (mode === 'auto' ? matchModelId(targetModel, Object.keys(models)) : null)
    if (hit !== null && hit !== undefined) {
      return { entry: models[hit], billingMode: 'deepseek-peak', priced: true }
    }
    const entry = priceEntryFor(targetModel, prices)
    return { entry, billingMode: 'deepseek-peak', priced: entry?.unpriced !== true }
  }
  const providerTable = prices?.providers?.[targetProvider]
  const catalog = providerTable?.models ?? {}
  let hit = catalog[targetModel] !== undefined ? targetModel : null
  if (hit === null && mode === 'auto') hit = matchModelId(targetModel, Object.keys(catalog))
  if (hit === null && mode === 'auto') {
    const dsModels = prices?.models ?? {}
    const dsHit = matchModelId(targetModel, Object.keys(dsModels))
    if (dsHit !== null) return { entry: dsModels[dsHit], billingMode: 'deepseek-peak', priced: true }
    let bestEntry = null
    let bestLen = 0
    let bestMode = 'flat'
    for (const [prov, table] of Object.entries(prices?.providers ?? {})) {
      if (prov === targetProvider) continue
      const models = table?.models ?? {}
      const h = matchModelId(targetModel, Object.keys(models))
      if (h === null) continue
      const entry = normalizePrice(models[h])
      if (entry === null || entry.unpriced === true) continue
      const score = canonModelId(h).length
      if (score > bestLen) {
        bestEntry = entry
        bestLen = score
        bestMode = models[h]?.billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat'
      }
    }
    if (bestEntry !== null) return { entry: bestEntry, billingMode: bestMode, priced: true }
  }
  if (hit === null) return { entry: null, billingMode: 'flat', priced: false }
  const entry = normalizePrice(catalog[hit])
  if (entry === null || entry.unpriced === true) return { entry: null, billingMode: 'flat', priced: false }
  return { entry, billingMode: catalog[hit].billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat', priced: true }
}

export function isPeakHour(atMs, effectiveAtMs, windows) {
  if (!Array.isArray(windows) || windows.length === 0) return false
  if (Number.isFinite(effectiveAtMs) && atMs < effectiveAtMs) return false
  const hour = new Date(atMs).getUTCHours()
  return windows.some(w => {
    const start = Number(w?.start)
    const end = Number(w?.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false
    if (start < end) return hour >= start && hour < end
    return hour >= start || hour < end
  })
}

export function peakPhaseAt(atMs, windows) {
  if (!Array.isArray(windows) || windows.length === 0 || !Number.isFinite(atMs)) return null
  const hourAt = (dayOffset, hour) => {
    const date = new Date(atMs)
    date.setUTCDate(date.getUTCDate() + dayOffset)
    date.setUTCHours(hour, 0, 0, 0)
    return date.getTime()
  }
  const points = []
  for (let day = -1; day <= 1; day += 1) {
    for (const w of windows) {
      const start = Number(w?.start)
      const end = Number(w?.end)
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      points.push({ at: hourAt(day, start), intoPeak: true })
      points.push({ at: hourAt(end <= start ? day + 1 : day, end), intoPeak: false })
    }
  }
  const inPeak = isPeakHour(atMs, undefined, windows)
  let prev = null
  let next = null
  for (const p of points) {
    if (p.at <= atMs && (prev === null || p.at > prev.at)) prev = p
    if (p.at > atMs && (next === null || p.at < next.at)) next = p
  }
  if (prev === null || next === null) return null
  return { inPeak, prevAtMs: prev.at, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
}

export function tierFor(entry, atMs, peak) {
  const base = entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
  const asTier = price => price.reasoning === undefined
    ? { cacheHit: price.cacheHit, cacheMiss: price.cacheMiss, output: price.output }
    : { cacheHit: price.cacheHit, cacheMiss: price.cacheMiss, output: price.output, reasoning: price.reasoning }
  if (Number.isFinite(atMs) && atMs < Date.parse(LEGACY_BASE_BOUNDARY)) {
    const lb = base.legacyBase
    return lb === undefined ? asTier(base) : asTier(lb)
  }
  if (peak?.enabled !== true) return asTier(base)
  const effectiveAtMs = typeof peak.effectiveAtMs === 'number' ? peak.effectiveAtMs : undefined
  if (isPeakHour(atMs, effectiveAtMs, peak.windows)) {
    const p = base.peak
    return p === undefined ? asTier(base) : asTier(p)
  }
  if (effectiveAtMs !== undefined && atMs >= effectiveAtMs) {
    const off = base.offPeak
    return off === undefined ? asTier(base) : asTier(off)
  }
  return asTier(base)
}

export function costOf(tokens, entry, atMs, peak) {
  const tier = tierFor(entry, atMs, peak)
  const input = Math.max(0, Number(tokens?.input) || 0)
  const output = Math.max(0, Number(tokens?.output) || 0)
  const cacheRead = Math.max(0, Number(tokens?.cacheRead) || 0)
  const cacheWrite = Math.max(0, Number(tokens?.cacheWrite) || 0)
  const reasoning = Math.max(0, Number(tokens?.reasoning) || 0)
  const reasoningPrice = typeof tier.reasoning === 'number' ? tier.reasoning : 0
  const cost = (input * tier.cacheMiss
    + output * tier.output
    + (cacheRead + cacheWrite) * tier.cacheHit
    + reasoning * reasoningPrice) / 1_000_000
  return Math.max(0, cost)
}

export function formatMoney(usdCost, display) {
  const rate = Number(display?.exchangeRate)
  const value = usdCost * (Number.isFinite(rate) && rate > 0 ? rate : 1)
  const symbol = typeof display?.symbol === 'string' && display.symbol.length > 0 ? display.symbol : '$'
  const decimals = Math.max(0, Math.min(10, Math.floor(Number(display?.decimals) || 2)))
  let effective = decimals
  if (value > 0 && value < 10 ** -decimals) effective = decimals + 2
  const fixed = value.toFixed(effective)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return `${symbol}${trimmed}`
}


function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function parseTables(html) {
  const blocks = String(html).match(/<table[\s\S]*?<\/table>/gi) ?? []
  return blocks.map(block => {
    const rows = []
    const trs = block.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
    for (const tr of trs) {
      const cells = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? []
      const row = cells.map(cell => stripTags(cell.replace(/^<t[dh][^>]*>/, '').replace(/<\/t[dh]>$/, '')))
      if (row.length > 0) rows.push(row)
    }
    return rows
  })
}

function cellMoney(cell) {
  const m = /(?:^|\s)\$([0-9]+(?:\.[0-9]+)?)/.exec(cell ?? '')
  if (m === null) return null
  const value = Number(m[1])
  return Number.isFinite(value) ? value : null
}

const MODEL_ID = /deepseek-[a-z0-9_.-]+/i

export function parsePricingHtml(html) {
  const tables = parseTables(html)
  const modelIds = []
  const tiers = {}
  const metricOf = cell => {
    const text = (cell ?? '').trim().toUpperCase()
    if (text.includes('CACHE HIT')) return 'cacheHit'
    if (text.includes('CACHE MISS')) return 'cacheMiss'
    if (text.includes('OUTPUT TOKENS')) return 'output'
    return null
  }

  for (const rows of tables) {
    let lastMetric = null
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      const first = (row[0] ?? '').trim()
      if (/^MODEL$/i.test(first)) {
        const ids = row.slice(1).map(cell => (MODEL_ID.exec(cell ?? '') ?? [])[0]).filter(Boolean)
        if (ids.length > 0) modelIds.splice(0, modelIds.length, ...ids)
        continue
      }
      const metric = metricOf(row.join(' ')) ?? lastMetric
      if (metric !== null) lastMetric = metric
      const tierIdx = row.findIndex(cell => /^OFF-PEAK$/i.test((cell ?? '').trim()) || /^PEAK$/i.test((cell ?? '').trim()))
      if (tierIdx < 0) continue
      if (metric === null || modelIds.length === 0) continue
      const label = /^PEAK$/i.test((row[tierIdx] ?? '').trim()) ? 'peak' : 'offPeak'
      const prices = row.slice(tierIdx + 1, tierIdx + 1 + modelIds.length).map(cellMoney)
      if (prices.some(v => v === null)) continue
      if (tiers[metric] === undefined) tiers[metric] = { offPeak: [], peak: [] }
      tiers[metric][label] = prices
    }
  }

  const models = {}
  for (let k = 0; k < modelIds.length; k += 1) {
    const id = modelIds[k].toLowerCase()
    const off = {
      cacheHit: tiers.cacheHit?.offPeak?.[k],
      cacheMiss: tiers.cacheMiss?.offPeak?.[k],
      output: tiers.output?.offPeak?.[k],
    }
    const pk = {
      cacheHit: tiers.cacheHit?.peak?.[k],
      cacheMiss: tiers.cacheMiss?.peak?.[k],
      output: tiers.output?.peak?.[k],
    }
    if (off.cacheHit === undefined || off.cacheMiss === undefined || off.output === undefined) continue
    models[id] = {
      cacheHit: off.cacheHit,
      cacheMiss: off.cacheMiss,
      output: off.output,
      offPeak: off,
      peak: {
        cacheHit: pk.cacheHit ?? off.cacheHit,
        cacheMiss: pk.cacheMiss ?? off.cacheMiss,
        output: pk.output ?? off.output,
      },
    }
    const legacy = LEGACY_BASE_PRICES[id]
    if (legacy !== undefined) models[id].legacyBase = { ...legacy }
  }

  if (Object.keys(models).length === 0) {
    const error = new Error('官方页面中未解析出任何模型价格,页面结构可能已变化,请稍后重试或手动编辑价格')
    error.code = 'ERR_NO_MODELS'
    throw error
  }
  const effectiveAt = null
  let peakWindows = null
  const plain = stripTags(html)
  const win = /Peak hours are\s+(.+?)\s+UTC/.exec(plain)
  if (win !== null) {
    const pairs = win[1].match(/\d{1,2}:\d{2}/g) ?? []
    peakWindows = []
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const start = Number(pairs[i].split(':')[0])
      const end = Number(pairs[i + 1].split(':')[0])
      if (Number.isFinite(start) && Number.isFinite(end)) peakWindows.push({ start, end })
    }
  }
  return { models, effectiveAt, peakWindows }
}
