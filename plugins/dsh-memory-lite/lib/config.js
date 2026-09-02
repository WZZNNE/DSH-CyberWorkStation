/**
 * Configuration shape of dsh-memory-lite ($DSH_HOME/memory-lite.json, hot-reloaded).
 * Pure: no I/O, so the launcher and the maintainer tests can share the normaliser.
 */

export const INJECT_MODES = ['relevant', 'first-turn', 'off']

export const DEFAULTS = Object.freeze({
  enabled: true,
  /** Store the latest compaction summary of every top-level session as a `summary` item. */
  depositSummaries: true,
  /** Ask the session's own routed model for durable facts every `extractEveryTurns` user turns. */
  extractFacts: true,
  extractEveryTurns: 8,
  /** Transcript budget (characters) handed to the extraction call. */
  extractMaxChars: 12000,
  /** relevant = pinned + relevant items on the first turn, relevant-only later; first-turn = once per session; off = never. */
  inject: 'relevant',
  topK: 5,
  /** Character budget of one injected block and of one item inside it. */
  maxInjectChars: 4000,
  itemChars: 700,
  /** Per-summary cap inside an injection (summaries keep their line structure). */
  summaryChars: 2000,
  /** Register the memory_recall / memory_note tools. */
  tools: true,
  maxItems: 2000,
  /** Optional local vector recall through an OpenAI-compatible /v1/embeddings endpoint (LM Studio, Ollama). */
  embeddings: Object.freeze({ enabled: false, baseURL: 'http://127.0.0.1:1234/v1', model: '', apiKeyEnv: '' }),
})

const int = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const str = (value, fallback, max = 400) => (typeof value === 'string' ? value.trim().slice(0, max) : fallback)

/**
 * Normalise a raw config object (file contents or a launcher POST) into the effective shape.
 * Unknown keys are dropped, numbers clamped, enums validated; `null`/non-objects give the defaults.
 * @param {unknown} raw
 */
export function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const e = r.embeddings && typeof r.embeddings === 'object' ? r.embeddings : {}
  const baseURL = str(e.baseURL, DEFAULTS.embeddings.baseURL, 300).replace(/\/+$/, '')
  return {
    enabled: bool(r.enabled, DEFAULTS.enabled),
    depositSummaries: bool(r.depositSummaries, DEFAULTS.depositSummaries),
    extractFacts: bool(r.extractFacts, DEFAULTS.extractFacts),
    extractEveryTurns: int(r.extractEveryTurns, DEFAULTS.extractEveryTurns, 1, 200),
    extractMaxChars: int(r.extractMaxChars, DEFAULTS.extractMaxChars, 1000, 100000),
    inject: INJECT_MODES.includes(r.inject) ? r.inject : DEFAULTS.inject,
    topK: int(r.topK, DEFAULTS.topK, 1, 20),
    maxInjectChars: int(r.maxInjectChars, DEFAULTS.maxInjectChars, 600, 20000),
    itemChars: int(r.itemChars, DEFAULTS.itemChars, 80, 4000),
    summaryChars: int(r.summaryChars, DEFAULTS.summaryChars, 200, 20000),
    tools: bool(r.tools, DEFAULTS.tools),
    maxItems: int(r.maxItems, DEFAULTS.maxItems, 50, 50000),
    embeddings: {
      enabled: bool(e.enabled, DEFAULTS.embeddings.enabled),
      baseURL: baseURL || DEFAULTS.embeddings.baseURL,
      model: str(e.model, DEFAULTS.embeddings.model, 200),
      apiKeyEnv: str(e.apiKeyEnv, DEFAULTS.embeddings.apiKeyEnv, 100),
    },
  }
}

/** The subset of a normalised config that differs from the defaults — what the settings file should hold. */
export function minimalConfig(cfg) {
  const out = {}
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'embeddings') {
      const e = {}
      for (const [ek, ev] of Object.entries(v)) if (ev !== DEFAULTS.embeddings[ek]) e[ek] = ev
      if (Object.keys(e).length) out.embeddings = e
    } else if (v !== DEFAULTS[k]) out[k] = v
  }
  return out
}

/** Validate a config candidate for the settings route; returns a list of human-readable problems. */
export function validateConfig(raw) {
  const problems = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['config must be a JSON object']
  if (raw.inject !== undefined && !INJECT_MODES.includes(raw.inject)) problems.push(`inject must be one of ${INJECT_MODES.join(', ')}`)
  const e = raw.embeddings
  if (e !== undefined) {
    if (!e || typeof e !== 'object') problems.push('embeddings must be an object')
    else {
      if (e.baseURL !== undefined && typeof e.baseURL === 'string' && e.baseURL.trim() !== '') {
        try {
          const u = new URL(e.baseURL)
          if (u.protocol !== 'http:' && u.protocol !== 'https:') problems.push('embeddings.baseURL must be http(s)')
        } catch { problems.push('embeddings.baseURL is not a valid URL') }
      }
      if (e.enabled === true && (typeof e.model !== 'string' || e.model.trim() === '')) problems.push('embeddings.model is required when embeddings are enabled')
    }
  }
  return problems
}
