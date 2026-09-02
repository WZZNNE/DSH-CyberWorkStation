/**
 * dsh-media-lab configuration: one JSON file at `$DSH_HOME/media-lab.json`, four independent
 * sections (image / video / tts / stt), each naming an adapter from `adapters.js`. Pure module —
 * the launcher and the tests import it directly.
 */
import { ADAPTERS, adapterFor, KINDS, templatedHost } from './adapters.js'

export const KEY_ENVS = {
  'OPENAI_API_KEY': 'OpenAI (images, speech, transcription, Sora video)',
  'GEMINI_API_KEY': 'Google Gemini / Veo',
  'REPLICATE_API_TOKEN': 'Replicate',
  'FAL_KEY': 'fal.ai',
  'ELEVENLABS_API_KEY': 'ElevenLabs',
  'FISH_AUDIO_API_KEY': 'Fish Audio',
  'MINIMAX_API_KEY': 'MiniMax (speech + Hailuo video)',
  'OPENROUTER_API_KEY': 'OpenRouter (images and video through one key)',
  'MEDIA_LAB_CUSTOM_KEY': 'custom HTTP endpoint',
}

/** The adapters a harness-sourced section may speak: bearer-token OpenAI-style wires only. */
export const HARNESS_ADAPTERS = {
  image: ['openai-compatible', 'openrouter'],
  video: ['openai-video', 'openrouter'],
  tts: ['openai-compatible'],
  stt: ['openai-compatible'],
}

const SECTION_DEFAULTS = {
  image: { enabled: false, provider: 'openai-compatible', baseURL: '', model: '', size: '1024x1024', quality: '', timeoutMs: 180000, pollMs: 3000 },
  video: { enabled: false, provider: 'openai-video', baseURL: '', model: '', size: '', resolution: '', aspectRatio: '16:9', seconds: '', timeoutMs: 900000, pollMs: 6000 },
  tts: { enabled: false, provider: 'openai-compatible', baseURL: '', model: '', voice: '', format: 'mp3', speed: 1, timeoutMs: 120000, pollMs: 2000 },
  stt: { enabled: false, provider: 'openai-compatible', baseURL: '', model: '', language: '', timeoutMs: 120000, pollMs: 2000 },
}

export const DEFAULT_CONFIG = {
  image: { ...SECTION_DEFAULTS.image },
  video: { ...SECTION_DEFAULTS.video },
  tts: { ...SECTION_DEFAULTS.tts },
  stt: { ...SECTION_DEFAULTS.stt },
  // Which tools the model may call. A kind that is not enabled never registers its tool.
  // `prompt`: whether the short "you have these media tools" section is appended to the system
  // prompt (appended as its own section — it never replaces another prompt).
  tools: { image: true, video: true, tts: true, stt: false, prompt: true },
  keepDays: 0,        // 0 keeps generated files forever
  maxFileMB: 96,      // refuse to keep anything larger (a runaway video)
}

const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? fallback : String(v).trim())
const num = (v, fallback, min, max) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Fill in every field, drop unknown providers, and keep per-provider `extra` objects verbatim. */
export function normalizeConfig(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const kind of KINDS) {
    const d = SECTION_DEFAULTS[kind]
    const s = o[kind] && typeof o[kind] === 'object' ? o[kind] : {}
    const provider = adapterFor(kind, str(s.provider)) ? str(s.provider) : d.provider
    const section = {
      ...d,
      enabled: s.enabled === true,
      provider,
      // `custom` keeps this section exactly as configured; `harness` resolves the host and the
      // credential from the harness provider named by `harnessRoute` at request time — key and
      // host always travel together, so no stored keyEnv is involved on that path.
      source: str(s.source) === 'harness' ? 'harness' : 'custom',
      harnessRoute: str(s.harnessRoute).slice(0, 80),
      baseURL: str(s.baseURL).replace(/\/+$/, ''),
      model: str(s.model),
      timeoutMs: num(s.timeoutMs, d.timeoutMs, 5000, 3600000),
      pollMs: num(s.pollMs, d.pollMs, 500, 60000),
    }
    if (kind === 'image') {
      section.size = str(s.size, d.size)
      section.quality = str(s.quality)
    }
    if (kind === 'video') {
      section.size = str(s.size)
      section.resolution = str(s.resolution)
      section.aspectRatio = str(s.aspectRatio, d.aspectRatio)
      section.seconds = str(s.seconds)
    }
    if (kind === 'tts') {
      section.voice = str(s.voice)
      section.format = ['mp3', 'wav', 'opus', 'flac', 'aac', 'pcm'].includes(str(s.format)) ? str(s.format) : 'mp3'
      section.speed = num(s.speed, 1, 0.25, 4)
      section.bitrate = s.bitrate === undefined ? undefined : num(s.bitrate, undefined, 1, 320000)
      section.sampleRate = s.sampleRate === undefined ? undefined : num(s.sampleRate, undefined, 8000, 48000)
      section.volume = s.volume === undefined ? undefined : num(s.volume, undefined, 0.01, 10)
      section.pitch = s.pitch === undefined ? undefined : num(s.pitch, undefined, -12, 12)
      section.latency = ['normal', 'balanced', 'low'].includes(str(s.latency)) ? str(s.latency) : ''
      section.groupId = str(s.groupId)
      section.outputFormat = str(s.outputFormat)
      section.instructions = str(s.instructions).slice(0, 2000)
      // Saved voice ids by name, so a Fish Audio / MiniMax voice can be recalled with one click.
      const presets = Array.isArray(s.voicePresets) ? s.voicePresets : []
      const seen = new Set()
      section.voicePresets = presets.map(p => ({ name: str(p?.name).slice(0, 40), voice: str(p?.voice).slice(0, 120) }))
        .filter(p => p.name && p.voice && !seen.has(p.name) && seen.add(p.name))
        .slice(0, 50)
    }
    if (kind === 'stt') section.language = str(s.language)
    // Only a credential this plugin declares may be named — and a section that points somewhere
    // other than its provider's own documented host (a custom endpoint, or any provider given a
    // `baseURL`) may only carry that provider's own credential or the one minted for custom
    // endpoints. Otherwise a config write could send one provider's key to another provider's
    // server, or to any host at all.
    const named = str(s.keyEnv)
    if (named && KEY_ENVS[named] !== undefined && mayCarryKey(kind, section, named)) section.keyEnv = named
    // A harness-sourced section never stores a credential name OR a host: both are resolved
    // together from the same harness provider at request time, and a stored baseURL here would
    // be a second place for the host to come from — which is how keys end up on foreign servers.
    if (section.source === 'harness') { delete section.keyEnv; section.baseURL = '' }
    if (s.extra && typeof s.extra === 'object' && !Array.isArray(s.extra)) section.extra = s.extra
    // The custom adapter carries its own request description.
    if (provider === 'custom') {
      section.url = str(s.url)
      section.method = ['POST', 'GET', 'PUT'].includes(String(s.method ?? '').toUpperCase()) ? String(s.method).toUpperCase() : 'POST'
      section.headers = s.headers && typeof s.headers === 'object' && !Array.isArray(s.headers) ? s.headers : {}
      section.body = s.body !== undefined && s.body !== null ? s.body : { prompt: '{{prompt}}' }
      section.resultType = ['base64', 'url', 'hex', 'binary', 'text'].includes(str(s.resultType)) ? str(s.resultType) : 'base64'
      section.resultPath = str(s.resultPath)
      section.mime = str(s.mime)
      section.authHeader = s.authHeader !== false
    }
    out[kind] = section
  }
  const tools = o.tools && typeof o.tools === 'object' ? o.tools : {}
  // Only a real boolean counts; anything else keeps the shipped default rather than reading as "on".
  const toolFlag = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
  out.tools = {
    image: toolFlag(tools.image, true), video: toolFlag(tools.video, true),
    tts: toolFlag(tools.tts, true), stt: toolFlag(tools.stt, false),
    prompt: toolFlag(tools.prompt, true),
  }
  out.keepDays = num(o.keepDays, 0, 0, 3650)
  // 256, not 2048: past roughly 380 MB `toString('base64')` throws V8's string limit and the
  // caller sees that instead of the cap message this number exists to produce.
  out.maxFileMB = num(o.maxFileMB, DEFAULT_CONFIG.maxFileMB, 1, 256)
  return out
}

/**
 * May this section carry `named`? A section left on its provider's own host may name any credential
 * A section carries its own provider's credential, or the one
 * minted for endpoints you host yourself (`MEDIA_LAB_CUSTOM_KEY`, which is also the answer for an
 * aggregator or a gateway). Anything else is one provider's key being handed to another's server —
 * which is what a `baseURL` plus a borrowed `keyEnv` used to do.
 */
export function mayCarryKey(kind, section, named) {
  const adapter = adapterFor(kind, section.provider)
  return named === (adapter?.keyEnv ?? '') || named === 'MEDIA_LAB_CUSTOM_KEY'
}

/** Problems that should stop a save, in the user's words. */
export function validateConfig(raw) {
  const problems = []
  for (const kind of KINDS) {
    const s = raw?.[kind]
    // The same rule the adapter applies at request time, so a bad URL is refused where it is typed.
    // `url` belongs to the custom adapter; a leftover one under another provider is discarded by
    // normalizeConfig anyway, and refusing the save over it only wedges a provider switch.
    if (s && typeof s === 'object' && String(s.provider) === 'custom' && templatedHost(s.url)) {
      problems.push(`the custom ${kind} endpoint URL may not put a template variable in its host`)
    }
  }
  const o = raw && typeof raw === 'object' ? raw : {}
  for (const kind of KINDS) {
    const named = String(o[kind]?.keyEnv ?? '').trim()
    if (!named) continue
    if (KEY_ENVS[named] === undefined) problems.push('unknown credential "' + named + '" for ' + kind)
    else if (String(o[kind]?.provider) === 'custom' && named !== 'MEDIA_LAB_CUSTOM_KEY') {
      problems.push('a custom ' + kind + ' endpoint may only use MEDIA_LAB_CUSTOM_KEY, not ' + named)
    } else if (!mayCarryKey(kind, { provider: String(o[kind]?.provider ?? '') }, named)) {
      problems.push('a ' + kind + ' section may only use ' + (adapterFor(kind, String(o[kind]?.provider))?.keyEnv ?? 'its own credential') + ' or MEDIA_LAB_CUSTOM_KEY, not ' + named)
    }
  }
  for (const kind of KINDS) {
    const s = o[kind] && typeof o[kind] === 'object' ? o[kind] : {}
    if (s.provider !== undefined && s.provider !== '' && !adapterFor(kind, String(s.provider))) {
      problems.push(`unknown ${kind} provider "${String(s.provider)}"`)
      continue
    }
    if (String(s.source) === 'harness') {
      // The host and the key come from the harness provider, so the section only has to name the
      // route and speak a wire an arbitrary OpenAI-style host understands.
      if (!HARNESS_ADAPTERS[kind]?.includes(String(s.provider ?? SECTION_DEFAULTS[kind].provider))) {
        problems.push(`a harness-sourced ${kind} section must use one of: ${(HARNESS_ADAPTERS[kind] ?? []).join(', ')}`)
      }
      if (s.enabled === true && !String(s.harnessRoute ?? '').trim()) problems.push(`the harness-sourced ${kind} section needs a provider route`)
      if (s.enabled === true && !String(s.model ?? '').trim()) problems.push(`${kind} needs a model id`)
      continue
    }
    if (s.enabled !== true) continue
    const adapter = adapterFor(kind, String(s.provider ?? SECTION_DEFAULTS[kind].provider))
    const baseURL = String(s.baseURL ?? '').trim() || adapter?.defaultBaseURL || ''
    if (String(s.provider) === 'custom') {
      const url = String(s.url ?? '').trim()
      if (!url) problems.push(`the custom ${kind} endpoint needs a URL`)
      else if (!/^https?:\/\//i.test(url)) problems.push(`the custom ${kind} URL must start with http:// or https://`)
    } else if (!baseURL) {
      problems.push(`${kind} needs a base URL`)
    } else if (!/^https?:\/\//i.test(baseURL)) {
      problems.push(`the ${kind} base URL must start with http:// or https://`)
    }
    const model = String(s.model ?? '').trim() || adapter?.defaultModel || ''
    if (!model && String(s.provider) !== 'custom') problems.push(`${kind} needs a model id`)
  }
  return problems
}

/** What the settings UI needs to draw the menus: providers per kind and the key each one uses. */
export function describeProviders() {
  const out = {}
  for (const kind of KINDS) {
    out[kind] = Object.entries(ADAPTERS[kind]).map(([id, adapter]) => ({
      id,
      keyEnv: adapter.keyEnv ?? '',
      defaultBaseURL: adapter.defaultBaseURL ?? '',
      defaultModel: adapter.defaultModel ?? '',
      defaultVoice: adapter.defaultVoice ?? '',
    }))
  }
  return out
}

/** The credential name a section resolves its key from. */
export function keyEnvFor(kind, config) {
  const section = config?.[kind] ?? {}
  if (section.keyEnv) return section.keyEnv
  return adapterFor(kind, section.provider)?.keyEnv ?? ''
}
