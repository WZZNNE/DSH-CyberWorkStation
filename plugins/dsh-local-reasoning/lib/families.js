/**
 * Model-family knowledge for local reasoning control. Pure functions only.
 *
 * Kinds:
 *  - effort-levels  : the backend takes a wire effort. Ollama's OpenAI endpoint
 *                     accepts `reasoning_effort` none/low/medium/high/max for
 *                     thinking-capable models (level semantics per its thinking
 *                     docs); LM Studio documents `reasoning.effort` on /v1/responses (gpt-oss).
 *  - prompt-toggle  : thinking is switched with a prompt soft switch
 *                     (Qwen3 on LM Studio: "/think" / "/no_think", Qwen3 model card).
 *  - always         : the model always reasons and the backend offers no switch.
 *  - template-toggle: toggled only through chat_template_kwargs (GLM-4.5+ on
 *                     vLLM / llama.cpp); the core can send it through
 *                     compat.thinkingFormat, but LM Studio / Ollama OpenAI
 *                     endpoints do not document it, so nothing is recommended.
 *  - none           : not a reasoning model.
 */

/** dsh/pi-ai thinking level ids a picker may offer (subset used here). */
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Classify a model from its id, backend architecture hints and backend capabilities.
 * `reasoningOptions` is LM Studio v1's `capabilities.reasoning.allowed_options`
 * (e.g. ["off","on"] or ["low","medium","high"]); Ollama exposes a "thinking"
 * capability string instead.
 */
export function classifyModel({ id = '', arch = '', capabilities = [], reasoningOptions, backend = 'unknown' } = {}) {
  const s = `${id} ${arch}`.toLowerCase()
  const caps = Array.isArray(capabilities) ? capabilities.map(c => String(c).toLowerCase()) : []
  const opts = Array.isArray(reasoningOptions) ? reasoningOptions.map(o => String(o).toLowerCase()) : []
  const hasLevels = opts.some(o => ['low', 'medium', 'high'].includes(o))
  if (/gpt[-_]?oss/.test(s) || (backend === 'lmstudio' && hasLevels)) return { family: 'gpt-oss', kind: 'effort-levels' }
  // Ollama maps reasoning_effort to its native think switch for every thinking-capable model (docs.ollama.com/api/openai-compatibility).
  if (backend === 'ollama' && caps.includes('thinking')) return { family: /qwen3/.test(s) ? 'qwen3' : /deepseek[-_]?r1|qwq/.test(s) ? 'always-thinking' : 'ollama-thinking', kind: 'effort-levels' }
  if (/qwen3|qwen-3|qwen_3/.test(s)) {
    if (/thinking/.test(s)) return { family: 'qwen3-thinking', kind: 'always' }
    if (/instruct|coder/.test(s)) return { family: 'qwen3-instruct', kind: 'none' }
    return { family: 'qwen3', kind: 'prompt-toggle' }
  }
  if (/deepseek[-_]?r1|r1[-_]distill|qwq|magistral|phi-4-reasoning|phi4-reasoning|-reasoning|_reasoning|thinking/.test(s)) {
    return { family: 'always-thinking', kind: 'always' }
  }
  // GLM-4.5 and later toggle thinking through chat_template_kwargs; GLM-4 (9B chat) does not reason.
  if (/glm[-_]?4\.[5-9]|glm[-_]?[5-9]/.test(s)) return { family: 'glm', kind: 'template-toggle' }
  if (backend === 'lmstudio' && opts.includes('on') && opts.includes('off')) {
    // LM Studio knows an on/off switch for this model, but only its native /api/v1/chat `reasoning` field carries it.
    return { family: 'lmstudio-toggle', kind: 'template-toggle' }
  }
  return { family: 'plain', kind: 'none' }
}

/**
 * Recommended dsh settings for one model on one backend.
 * @returns { reasoningEfforts?: object|false, supportsReasoningEffort?: boolean, routeApiHint?: string, thinkingMode?: string, notes: string[] }
 */
export function recommend({ backend, classification, api = 'openai-completions' }) {
  const notes = []
  const kind = classification?.kind ?? 'none'
  const family = classification?.family ?? 'plain'
  // compat.supportsReasoningEffort is a chat-completions switch: the core refuses it on every other protocol
  // (llm-pi-ai catalog compat gates), and openai-responses sends reasoning.effort whenever the model reasons.
  const completions = api === 'openai-completions'
  const wire = v => (completions ? { supportsReasoningEffort: v } : {})
  if (kind === 'effort-levels') {
    if (backend === 'ollama') {
      if (family === 'gpt-oss') {
        notes.push('Ollama: reasoning_effort low/medium/high maps to think for gpt-oss; true/false (and therefore "none") are ignored by that model, so no off level is offered.')
        return { reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' }, ...wire(true), notes }
      }
      notes.push('Ollama\'s OpenAI endpoint accepts reasoning_effort none/low/medium/high/max (openai-compatibility docs); level semantics follow its thinking docs (true/false or low/medium/high/max). "off" sends none. Edit the levels if this model rejects a value.')
      return { reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' }, ...wire(true), notes }
    }
    notes.push('gpt-oss always reasons (no off). LM Studio documents reasoning.effort on /v1/responses; the chat-completions docs list no reasoning field. Switch the route api to openai-responses if levels have no effect.')
    return { reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' }, ...wire(true), routeApiHint: 'openai-responses', notes }
  }
  if (kind === 'prompt-toggle') {
    notes.push(completions
      ? 'Thinking is switched with the Qwen3 soft switch: off → "/no_think", high → "/think" appended to your message by dsh-local-reasoning; nothing is sent on the wire (chat-completions). The switch text becomes part of the logged message.'
      : 'Thinking is switched with the Qwen3 soft switch: off → "/no_think", high → "/think" appended to your message by dsh-local-reasoning. On openai-responses pi-ai also sends reasoning.effort whenever the model declares levels; LM Studio ignores it for models without effort support. The switch text becomes part of the logged message.')
    return { reasoningEfforts: { off: null, high: 'high' }, ...wire(false), thinkingMode: 'follow-picker', notes }
  }
  if (kind === 'always') {
    notes.push('This family always reasons on this backend; no switch is available through the OpenAI-compatible API.')
    return { reasoningEfforts: false, notes }
  }
  if (kind === 'template-toggle') {
    notes.push(family === 'lmstudio-toggle'
      ? 'LM Studio reports an on/off reasoning switch for this model, but only its native /api/v1/chat carries it; the OpenAI-compatible route cannot toggle it.'
      : 'Toggled only through chat_template_kwargs (vLLM / llama.cpp / SGLang). dsh can send it via compat.thinkingFormat (qwen-chat-template / chat-template), but LM Studio and Ollama do not document that field on their OpenAI endpoints, so nothing is recommended here.')
    return { reasoningEfforts: false, notes }
  }
  notes.push('Not a reasoning model.')
  return { reasoningEfforts: false, notes }
}

/** Recommend a context window and output cap from what the backend reports. */
export function recommendContext({ loadedContext, maxContext }) {
  const ctx = Number.isFinite(loadedContext) && loadedContext > 0 ? loadedContext : (Number.isFinite(maxContext) && maxContext > 0 ? maxContext : undefined)
  if (ctx === undefined) return {}
  const maxTokens = Math.min(8192, Math.max(1024, Math.floor(ctx / 4)))
  return { contextWindow: ctx, maxTokens }
}

/** Resolve the soft-switch suffix for a prompt-toggle model given the effective mode. */
export function toggleSuffix({ mode, effort }) {
  const m = mode === 'follow-picker' ? (effort === 'off' ? 'off' : effort === undefined ? 'auto' : 'on') : mode
  if (m === 'off') return '/no_think'
  if (m === 'on') return '/think'
  return ''
}

/**
 * Parse the launcher's compact level syntax into a reasoningEfforts value:
 * "false" → false (not a reasoning model); "" → undefined (leave unchanged);
 * "off,low,medium,high" → {off:null,low:'low',…}; "off=none,high" → {off:'none',high:'high'};
 * a bare "level" or "level=" sends the level name itself (off= → null, i.e. send nothing);
 * "inherit" → null (drop the override, back to the catalog's levels).
 * Unknown level names throw so a typo never reaches the settings file.
 */
export function parseEffortSpec(spec) {
  const s = String(spec ?? '').trim()
  if (s === '') return undefined
  if (/^(false|none|no|-)$/i.test(s)) return false
  if (/^(inherit|catalog|default)$/i.test(s)) return null // remove the declaration: the installed catalog's capability applies again
  const out = {}
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const [key, wire] = part.split('=').map(x => x.trim())
    const level = key.toLowerCase()
    if (!LEVELS.includes(level)) throw new Error(`unknown thinking level "${key}" (use ${LEVELS.join('/')})`)
    out[level] = wire === undefined || wire === '' ? (level === 'off' ? null : level) : wire
  }
  if (Object.keys(out).length === 0) return undefined
  assertServiceableEfforts(out)
  return out
}

/** The core's write-time rules (llm-pi-ai catalog): a non-off level needs a non-empty wire value, and off alone offers nothing. */
export function assertServiceableEfforts(efforts) {
  const levels = Object.keys(efforts)
  if (levels.length === 1 && levels[0] === 'off') throw new Error('reasoningEfforts offers no level beyond off (declare at least one of low/medium/high/… or use false)')
  for (const [k, v] of Object.entries(efforts)) {
    if (k === 'off') { if (v !== null && (typeof v !== 'string' || v.length === 0)) throw new Error('level "off" must be null (send nothing) or a non-empty wire value such as none'); continue }
    if (typeof v !== 'string' || v.length === 0) throw new Error(`level "${k}" needs a non-empty wire value (e.g. ${k}=${k})`)
  }
}

/** Inverse of parseEffortSpec for display. */
export function formatEffortSpec(efforts) {
  if (efforts === false) return 'false'
  if (!efforts || typeof efforts !== 'object') return ''
  return Object.entries(efforts).map(([k, v]) => (v === null || v === k ? k : `${k}=${v}`)).join(',')
}
