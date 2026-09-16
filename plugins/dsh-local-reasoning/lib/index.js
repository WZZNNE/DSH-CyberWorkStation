/**
 * dsh-local-reasoning host plugin — per-model parameters for EVERY llm-pi-ai
 * route (context window, max output, thinking levels) with extra help for
 * locally served models.
 *
 * What it does:
 *  1. Lists every registered provider route (`ctx.llm.listProviders()`), its
 *     models (`ctx.llm.listModels`) and the EFFECTIVE context window / max
 *     output / thinking levels (`ctx.llm.resolveModelInfo`) next to what the
 *     user layer of `llm-pi-ai` declares for it.
 *  2. Writes per-model `contextWindow` / `maxTokens` / `reasoningEfforts` /
 *     `compat.supportsReasoningEffort` through `ctx.settings.mutate(ns, ops,
 *     revision)`: a route whose user profile carries a `models` list (local /
 *     hand-declared routes) gets the entry edited; a catalog route (DeepSeek,
 *     OpenRouter, …) gets a `modelOverrides.<id>` entry, which reshapes one
 *     catalog model and leaves the rest of the catalog serving (llm-pi-ai
 *     README "modelOverrides"); the official DeepSeek route (`llm-deepseek`
 *     adapter) gets its `models` list rewritten with the edited contextWindow /
 *     maxTokens (image limits and modalities preserved, levels are adapter-owned).
 *     A concurrent edit is refused and retried, never overwritten. Nothing in the
 *     core is patched.
 *  3. For local routes (LM Studio / Ollama / other local gateways): probes the
 *     backend for loaded state, context length and reasoning capabilities,
 *     classifies the model family and recommends levels; on boot it teaches the
 *     levels of local models that declare none (auto-teach, can be switched off),
 *     so the native model picker offers them without a visit to the launcher.
 *  4. Bridges prompt-toggle families (Qwen3 on LM Studio) at `agent/pre-step` by
 *     appending the soft switch ("/no_think" / "/think") to the last user-typed
 *     message of the step — never to plugin context snapshots or tool results.
 *
 * HTTP routes (prefix /dsh-local-reasoning) feed the DSH Launcher page:
 *   GET  /status                → every route with models, effective values and user overrides
 *   POST /probe                 → probe every local route's backend
 *   POST /apply                 → { route, modelId, changes }
 *   POST /apply-recommended     → { route, modelId }   (local routes)
 *   POST /route-api             → { route, api }        (local routes)
 *   POST /settings              → { autoTeach }
 *
 * Per-model thinking mode and the auto-teach switch live in $DSH_HOME/local-reasoning.json (hot reload).
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileSync, writeFileSync, mkdirSync, watchFile, unwatchFile } from 'node:fs'
import { join, dirname } from 'node:path'
import { classifyModel, recommend, recommendContext, toggleSuffix, parseEffortSpec, assertServiceableEfforts, LEVELS } from './families.js'
import { isLocalBaseUrl, originOf, probeOrigin } from './detect.js'
import { rejectCrossSite, json, readBody as kitReadBody } from 'dsh-cyberworkstation-kit/fence'

export const name = 'local-reasoning'
export const inject = ['settings', 'webServer', 'llm']

const DSH_HOME = resolveDshHome()
const CONFIG_FILE = join(DSH_HOME, 'local-reasoning.json')
const NS = 'llm-pi-ai'
/** The official DeepSeek adapter: its `models` list (id, name, contextWindow, maxTokens, image limits) lives in this namespace; levels are fixed by the adapter. */
const DS_NS = 'llm-deepseek'
// The adapter's own catalog is read from the settings schema default at call time (0.1.5-rc.1 added
// `deepseek-flash`, the new default model); this literal list is only the fallback when no schema is described.
/**
 * The adapter's default model list out of a settings descriptor. `SettingsDescriptor.schema` is schemastery's
 * `toJSON()` reference graph — `{ uid, refs }`, the object schema at `refs[uid]`, every `dict` member either inline
 * or a ref id — so the list sits at `refs[refs[uid].dict.models].meta.default`; a descriptor that carries the live
 * schema object (a test double) is read through the plain path.
 */
export function deepseekSchemaDefaults(schema) {
  if (!schema || typeof schema !== 'object') return undefined
  const refs = schema.refs && typeof schema.refs === 'object' ? schema.refs : undefined
  const deref = node => (node !== null && typeof node === 'object' ? node : refs && node !== undefined ? refs[node] : undefined)
  const root = refs && schema.uid !== undefined ? refs[schema.uid] : schema
  const list = deref(root?.dict?.models)?.meta?.default
  return Array.isArray(list) && list.length > 0 && list.every(m => m && typeof m.id === 'string') ? list : undefined
}
// Without the schema's default list the catalog cannot be recognised: a reset then leaves the list pinned (safe,
// but silent unless said once).
let fallbackWarned = false
const fallbackCatalog = () => { if (!fallbackWarned) { fallbackWarned = true; console.warn('[local-reasoning] the llm-deepseek settings schema exposes no default model list; an edited list cannot be recognised as the adapter catalog and stays pinned after a reset') } return DS_FALLBACK_DEFAULTS }
const DS_FALLBACK_DEFAULTS = [
  { id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Flash-Vision-Exp' },
]
const THINKING_MODES = ['auto', 'on', 'off', 'follow-picker']
const ROUTE_APIS = ['openai-completions', 'openai-responses']
const MAX_BODY = 64 * 1024
const readBody = (req, limit = MAX_BODY) => kitReadBody(req, limit)
const AUTO_TEACH_DELAY_MS = 4000

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  // ── per-model thinking mode (auto | on | off | follow-picker) + auto-teach switch ──
  let config = { thinking: {}, autoTeach: true }
  const loadConfig = () => {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
      const thinking = {}
      for (const [k, v] of Object.entries(raw?.thinking && typeof raw.thinking === 'object' ? raw.thinking : {})) if (THINKING_MODES.includes(v) && v !== 'auto') thinking[k] = v
      config = { thinking, autoTeach: raw?.autoTeach !== false }
    } catch { config = { thinking: {}, autoTeach: true } }
  }
  const saveConfig = () => { mkdirSync(dirname(CONFIG_FILE), { recursive: true }); writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)) }
  loadConfig()
  ctx.effect(() => { watchFile(CONFIG_FILE, { interval: 1500 }, loadConfig).unref?.(); return () => unwatchFile(CONFIG_FILE, loadConfig) }, 'dsh-local-reasoning: config watch')

  let lastProbe = {}
  let autoTaught = []
  /** Effort seen on the latest request per agent id (bounded; agents are short-lived objects). */
  const effortByAgent = new Map()
  const EFFORT_MEMORY = 256

  const settingsSection = () => {
    const s = ctx.settings.get(NS)
    return s && typeof s === 'object' ? s : {}
  }
  const isLocalRoute = cfg => cfg && typeof cfg === 'object' && typeof cfg.baseURL === 'string' && isLocalBaseUrl(cfg.baseURL)
  const localRoutes = () => {
    const providers = settingsSection().providers
    const out = []
    if (!providers || typeof providers !== 'object') return out
    for (const [route, cfg] of Object.entries(providers)) if (isLocalRoute(cfg)) out.push({ route, cfg })
    return out
  }
  const modelsOf = cfg => (cfg && Array.isArray(cfg.models) ? cfg.models.map(m => (typeof m === 'string' ? { id: m } : m)).filter(m => m && typeof m.id === 'string') : [])
  const directory = () => { try { return ctx.llm?.listConfigurableProviders?.() ?? [] } catch { return [] } }
  const registeredRoutes = () => { try { return (ctx.llm?.listProviders?.() ?? []).map(p => p.id) } catch { return [] } }
  const catalogModels = async route => { try { return await ctx.llm.listModels(route) } catch { return null } }
  const resolvedInfo = async (route, id) => { try { return await ctx.llm.resolveModelInfo(route, id) } catch { return null } }

  async function resolveApiKey(cfg) {
    if (typeof cfg.apiKeyEnv !== 'string' || cfg.apiKeyEnv.length === 0) return undefined
    try {
      const creds = ctx.get('credentials')
      const { credentialRef } = await import('@deepseek-ai/dsh-credentials').catch(() => ({ credentialRef: v => v }))
      const hit = await creds?.resolve?.(credentialRef(cfg.apiKeyEnv))
      return hit?.value
    } catch { return undefined }
  }

  const classify = (route, modelId) => {
    const probe = lastProbe[route]
    const p = probe?.models?.find(x => x.id === modelId)
    return { probe, p, classification: classifyModel({ id: modelId, arch: p?.arch, capabilities: p?.capabilities, reasoningOptions: p?.reasoningOptions, backend: probe?.backend ?? 'unknown' }) }
  }

  /** The raw user layer of the namespace (what settings.yaml holds) plus its revision. */
  const userSection = () => {
    const d = ctx.settings.describe?.()?.find(x => x.ns === NS)
    if (d?.user && typeof d.user === 'object') return { section: d.user, revision: typeof d.revision === 'number' ? d.revision : undefined }
    throw new Error('llm-pi-ai has no user settings layer to edit (declare the route in settings.yaml first)')
  }
  const userSectionOrEmpty = () => { try { return userSection().section } catch { return {} } }
  /** User layer + revision of the DeepSeek adapter namespace (an absent user section is an empty one). */
  const dsUserSection = () => {
    const d = ctx.settings.describe?.()?.find(x => x.ns === DS_NS)
    if (!d) throw new Error('llm-deepseek settings namespace is not registered')
    return { section: d.user && typeof d.user === 'object' ? d.user : {}, revision: typeof d.revision === 'number' ? d.revision : undefined }
  }
  const dsResolvedModels = () => { const s = ctx.settings.get(DS_NS); return s && Array.isArray(s.models) ? s.models.filter(m => m && typeof m.id === 'string') : [] }
  /** Minimal user entry for a DeepSeek catalog model: identity + image capability copied, only user numbers kept. */
  const dsMinimal = (resolvedEntry, userEntry) => {
    const out = { id: resolvedEntry.id }
    if (typeof resolvedEntry.name === 'string') out.name = resolvedEntry.name
    if (typeof resolvedEntry.description === 'string') out.description = resolvedEntry.description
    // 0.1.5: `deepseek-flash` declares in-history system-prompt updates; a rewritten list must keep the declaration
    // the route resolves (the user's own list, else the catalog); one the user's list dropped is never re-added
    const spu = resolvedEntry.systemPromptUpdate ?? userEntry?.systemPromptUpdate
    if (typeof spu === 'string') out.systemPromptUpdate = spu
    const mods = Array.isArray(resolvedEntry.inputModalities) ? resolvedEntry.inputModalities : []
    if (mods.includes('image')) {
      out.inputModalities = [...mods]
      // (0.1.5 rejects the old `imageDetail` member, so it is never copied)
      for (const k of ['imagePixelBudget', 'imageMaxBytes']) if (resolvedEntry[k] !== undefined) out[k] = resolvedEntry[k]
    }
    if (userEntry && Number.isFinite(userEntry.contextWindow)) out.contextWindow = userEntry.contextWindow
    if (userEntry && Number.isFinite(userEntry.maxTokens)) out.maxTokens = userEntry.maxTokens
    return out
  }
  const isOpenRouterRoute = (route, cfg) => route === 'openrouter' || /(^|\.)openrouter\.ai$/i.test((() => { try { return new URL(String(cfg?.baseURL ?? '')).hostname } catch { return '' } })())
  const ONLINE_SUFFIX = ':online'
  /** Where a route's per-model fields live in the user layer: its own `models` list, or `modelOverrides` on a catalog route. */
  const storageOf = (route, ucfg, dir) => {
    if (ucfg && Array.isArray(ucfg.models) && ucfg.models.length > 0) return 'models'
    if (dir?.declared === true) return 'models' // hand-declared elsewhere (base layer): the entry must be copied into the user layer first
    return 'modelOverrides'
  }
  const userEntryOf = (ucfg, storage, id) => (storage === 'models' ? modelsOf(ucfg).find(m => m.id === id) : ucfg?.modelOverrides?.[id]) ?? undefined

  /** Every route with its models, the effective values the core resolved, and the user-layer overrides. */
  async function statusView() {
    const resolved = settingsSection()
    const providers = resolved.providers && typeof resolved.providers === 'object' ? resolved.providers : {}
    const user = userSectionOrEmpty()
    const userProviders = user.providers && typeof user.providers === 'object' ? user.providers : {}
    const dirs = directory()
    const ids = [...new Set([...registeredRoutes(), ...Object.keys(providers)])]
    const routes = []
    for (const route of ids) {
      const dir = dirs.find(d => d.provider === route)
      const cfg = providers[route] && typeof providers[route] === 'object' ? providers[route] : {}
      const ucfg = userProviders[route] && typeof userProviders[route] === 'object' ? userProviders[route] : {}
      const isDs = dir?.settingsNs === DS_NS
      const editable = dir ? (dir.settingsNs === NS || isDs) : providers[route] !== undefined
      const local = isLocalRoute(cfg)
      const storage = isDs ? 'deepseek-models' : storageOf(route, ucfg, dir)
      const dsUser = isDs ? (() => { try { return dsUserSection().section } catch { return {} } })() : null
      const dsUserList = Array.isArray(dsUser?.models) ? dsUser.models : []
      const probe = local ? lastProbe[route] : undefined
      const infos = (await catalogModels(route)) ?? modelsOf(cfg).map(m => ({ id: m.id, name: m.name ?? m.id }))
      const models = []
      for (const info of infos) {
        const r = await resolvedInfo(route, info.id)
        const ue = (isDs ? dsUserList.find(m => m?.id === info.id) : userEntryOf(ucfg, storage, info.id)) ?? {}
        const declaredEntry = modelsOf(cfg).find(m => m.id === info.id) ?? {}
        const row = {
          id: info.id, name: info.name ?? info.id,
          contextWindow: r?.context?.contextWindow ?? declaredEntry.contextWindow ?? ue.contextWindow,
          maxTokens: r?.defaultMaxTokens ?? declaredEntry.maxTokens ?? ue.maxTokens,
          effortIds: Array.isArray(r?.reasoning?.efforts) ? r.reasoning.efforts.map(e => e.id) : [],
          reasoningEfforts: ue.reasoningEfforts ?? declaredEntry.reasoningEfforts,
          supportsReasoningEffort: ue.compat?.supportsReasoningEffort ?? declaredEntry.compat?.supportsReasoningEffort,
          userSet: { contextWindow: ue.contextWindow !== undefined, maxTokens: ue.maxTokens !== undefined, reasoningEfforts: ue.reasoningEfforts !== undefined },
          effortsEditable: !isDs, // the DeepSeek adapter owns its levels (thinking / reasoningEffort are route-level settings there)
        }
        if (local) {
          const { p, classification } = classify(route, info.id)
          const rec = recommend({ backend: probe?.backend ?? 'unknown', classification, api: cfg.api ?? 'openai-completions' })
          const recCtx = recommendContext({ loadedContext: p?.loadedContext, maxContext: p?.maxContext })
          Object.assign(row, {
            family: classification.family, kind: classification.kind,
            thinkingMode: config.thinking[`${route}/${info.id}`] ?? 'auto',
            backend: p ? { loaded: p.loaded, maxContext: p.maxContext, loadedContext: p.loadedContext, arch: p.arch, capabilities: p.capabilities, reasoningOptions: p.reasoningOptions, reasoningDefault: p.reasoningDefault } : null,
            recommended: { ...rec, ...recCtx },
          })
        }
        models.push(row)
      }
      const unregistered = local ? (probe?.models ?? []).filter(p => !infos.some(m => m.id === p.id)).map(p => ({ id: p.id, loaded: p.loaded, maxContext: p.maxContext, loadedContext: p.loadedContext })) : []
      routes.push({
        route, displayName: dir?.displayName ?? cfg.displayName ?? route, api: cfg.api ?? (local ? 'openai-completions' : null), baseURL: cfg.baseURL ?? '',
        local, editable, storage, backend: probe?.backend ?? null, probedAt: probe?.at ?? null, probeError: probe?.error ?? null, models, unregistered,
        // OpenRouter web search rides the `:online` model-slug suffix (docs: openrouter.ai/docs/features/web-search); a variant entry can be
        // added only to a route that already lists its models (a catalog route's modelOverrides cannot introduce new ids).
        onlineEligible: !isDs && editable && storage === 'models' && isOpenRouterRoute(route, cfg),
      })
    }
    routes.sort((a, b) => Number(b.local) - Number(a.local) || a.route.localeCompare(b.route))
    const dm = ctx.settings.get('agent-default-model')
    return { routes, autoTeach: config.autoTeach, autoTaught, defaultModel: dm && typeof dm === 'object' ? { provider: dm.provider, model: dm.model, reasoningEffort: dm.reasoningEffort } : null }
  }

  async function probeAll() {
    const results = {}
    await Promise.all(localRoutes().map(async ({ route, cfg }) => {
      const origin = originOf(cfg.baseURL)
      if (origin === null) return
      const apiKey = await resolveApiKey(cfg)
      try {
        const r = await probeOrigin(origin, { apiKey })
        results[route] = r ? { ...r, at: Date.now() } : { backend: null, origin, models: [], at: Date.now(), error: 'no LM Studio / Ollama answer' }
      } catch (error) {
        results[route] = { backend: null, origin, models: [], at: Date.now(), error: String(error?.message ?? error) }
      }
    }))
    lastProbe = results
    return results
  }

  /** Drop schema-materialised empties so the user file stays minimal. */
  const tidyModel = m => {
    const out = { ...m }
    if (Array.isArray(out.input) && out.input.length === 0) delete out.input
    if (out.compat && typeof out.compat === 'object') {
      const compat = { ...out.compat }
      for (const [k, v] of Object.entries(compat)) if (v && typeof v === 'object' && Object.keys(v).length === 0) delete compat[k]
      if (Object.keys(compat).length === 0) delete out.compat; else out.compat = compat
    }
    return out
  }
  /** Validate a reasoningEfforts value coming from the launcher: false, or {level: wire|null} with known level names. */
  const validEfforts = v => {
    if (v === false) return false
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('reasoningEfforts must be false or an object of levels')
    const out = {}
    for (const [k, w] of Object.entries(v)) {
      if (!LEVELS.includes(k)) throw new Error(`unknown thinking level "${k}" (use ${LEVELS.join('/')})`)
      if (w !== null && typeof w !== 'string') throw new Error(`level "${k}" must map to a wire string or null`)
      out[k] = w
    }
    if (Object.keys(out).length === 0) throw new Error('reasoningEfforts must declare at least one level (or be false)')
    assertServiceableEfforts(out)
    return out
  }
  const positiveInt = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null }

  /**
   * Apply one model's changes in the user settings layer (revision-checked, retried on conflict):
   * `models[]` entry for routes that declare their list, `modelOverrides.<id>` for catalog routes.
   */
  async function applyChanges(route, modelId, changes) {
    const dir = directory().find(d => d.provider === route)
    if (dir && dir.settingsNs === DS_NS) return applyDeepSeek(modelId, changes)
    if (dir && dir.settingsNs !== NS) throw new Error(`route "${route}" is managed by another adapter (${dir.settingsNs}); this page edits llm-pi-ai and llm-deepseek routes only`)
    let efforts = changes.reasoningEfforts
    if (typeof changes.effortSpec === 'string') efforts = parseEffortSpec(changes.effortSpec)
    if (efforts !== undefined && efforts !== null) efforts = validEfforts(efforts)
    if (typeof changes.routeApi === 'string' && changes.routeApi.length > 0 && !ROUTE_APIS.includes(changes.routeApi)) throw new Error(`api must be one of ${ROUTE_APIS.join(', ')}`)
    if (typeof changes.routeApi === 'string') throw new Error('route api is switched through /route-api (it also strips the chat-completions-only compat), not through /apply')
    if (changes.supportsReasoningEffort !== undefined && changes.supportsReasoningEffort !== null) {
      const rcfg = settingsSection().providers?.[route]
      // A profile that names a non-completions api is refused here; a catalog route without an explicit api is left to the
      // core's own write-time validation (it refuses the compat on every protocol but chat-completions, mapped to 400 below).
      const api = rcfg?.api ?? (isLocalRoute(rcfg) ? 'openai-completions' : null)
      if (api !== null && api !== 'openai-completions') throw new Error(`compat.supportsReasoningEffort is a chat-completions switch; route "${route}" uses ${api} (the core refuses it there) — leave the wire box untouched`)
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { section, revision } = userSection()
      const ucfg = section.providers?.[route]
      const storage = storageOf(route, ucfg && typeof ucfg === 'object' ? ucfg : {}, dir)
      const ops = []
      if (storage === 'models') {
        if (!ucfg || typeof ucfg !== 'object') throw new Error(`route "${route}" not found in the llm-pi-ai user settings`)
        const models = modelsOf(ucfg).map(m => tidyModel(m))
        const idx = models.findIndex(m => m.id === modelId)
        if (idx < 0) throw new Error(`model "${modelId}" is not declared on route "${route}"`)
        const m = models[idx]
        if (efforts !== undefined) { if (efforts === null) delete m.reasoningEfforts; else m.reasoningEfforts = efforts }
        if (changes.supportsReasoningEffort !== undefined) {
          const compat = { ...(m.compat && typeof m.compat === 'object' ? m.compat : {}) }
          if (changes.supportsReasoningEffort === null) delete compat.supportsReasoningEffort
          else compat.supportsReasoningEffort = Boolean(changes.supportsReasoningEffort)
          if (Object.keys(compat).length === 0) delete m.compat; else m.compat = compat
        }
        for (const key of ['contextWindow', 'maxTokens']) {
          if (changes[key] === undefined) continue
          const n = positiveInt(changes[key])
          if (changes[key] === null || n === null) delete m[key]; else m[key] = n
        }
        models[idx] = m
        ops.push({ op: 'set', path: ['providers', route, 'models'], value: models })
      } else {
        // catalog route: the model must exist in the catalog the route serves
        const known = await catalogModels(route)
        if (!known || !known.some(m => m.id === modelId)) throw new Error(`model "${modelId}" is not declared on route "${route}"`)
        const base = ['providers', route, 'modelOverrides', modelId]
        const cur = ucfg && typeof ucfg === 'object' && ucfg.modelOverrides && typeof ucfg.modelOverrides[modelId] === 'object' ? { ...ucfg.modelOverrides[modelId] } : {}
        if (efforts !== undefined) { if (efforts === null) delete cur.reasoningEfforts; else cur.reasoningEfforts = efforts }
        if (changes.supportsReasoningEffort !== undefined) {
          const compat = { ...(cur.compat && typeof cur.compat === 'object' ? cur.compat : {}) }
          if (changes.supportsReasoningEffort === null) delete compat.supportsReasoningEffort; else compat.supportsReasoningEffort = Boolean(changes.supportsReasoningEffort)
          if (Object.keys(compat).length === 0) delete cur.compat; else cur.compat = compat
        }
        for (const key of ['contextWindow', 'maxTokens']) {
          if (changes[key] === undefined) continue
          const n = positiveInt(changes[key])
          if (changes[key] === null || n === null) delete cur[key]; else cur[key] = n
        }
        const tidy = tidyModel(cur)
        ops.push(Object.keys(tidy).length === 0 ? { op: 'unset', path: base } : { op: 'set', path: base, value: tidy })
      }
      if (ops.length === 0) break
      try {
        await ctx.settings.mutate(NS, ops, revision)
        break
      } catch (error) {
        if (error?.code === 'SETTINGS_CONFLICT' && attempt < 2) continue // someone else wrote meanwhile: re-read and re-apply
        throw error
      }
    }
    if (typeof changes.thinkingMode === 'string') {
      if (!THINKING_MODES.includes(changes.thinkingMode)) throw new Error(`thinkingMode must be one of ${THINKING_MODES.join(', ')}`)
      if (changes.thinkingMode === 'auto') delete config.thinking[`${route}/${modelId}`]
      else config.thinking[`${route}/${modelId}`] = changes.thinkingMode
      saveConfig()
    }
    return { ok: true }
  }

  /**
   * Add or remove the OpenRouter `<model>:online` variant (OpenRouter's own web search, billed per request) as a models-list
   * entry cloned from the base model. Only routes that already carry a `models` list qualify: on a catalog route the list
   * would replace the whole catalog, and modelOverrides cannot name an id the catalog lacks (llm-pi-ai catalog.ts).
   */
  async function onlineVariant(route, modelId, action) {
    if (action !== 'add' && action !== 'remove') throw new Error('action must be add or remove')
    const dir = directory().find(d => d.provider === route)
    if (dir && dir.settingsNs !== NS) throw new Error(`route "${route}" is managed by another adapter (${dir.settingsNs}); :online variants are an OpenRouter (llm-pi-ai) feature`)
    const baseId = modelId.endsWith(ONLINE_SUFFIX) ? modelId.slice(0, -ONLINE_SUFFIX.length) : modelId
    const variantId = baseId + ONLINE_SUFFIX
    for (let attempt = 0; attempt < 3; attempt++) {
      const { section, revision } = userSection()
      const ucfg = section.providers?.[route]
      if (!ucfg || typeof ucfg !== 'object') throw new Error(`route "${route}" not found in the llm-pi-ai user settings`)
      if (!isOpenRouterRoute(route, settingsSection().providers?.[route] ?? ucfg)) throw new Error(`route "${route}" is not an OpenRouter route (:online is OpenRouter's web-search suffix)`)
      const models = modelsOf(ucfg).map(m => tidyModel(m))
      if (models.length === 0) throw new Error(`route "${route}" serves the built-in catalog; a :online variant needs the route's own models list (generate it from the dsh settings page first), because modelOverrides cannot add a model the catalog does not describe`)
      const base = models.find(m => m.id === baseId)
      const idx = models.findIndex(m => m.id === variantId)
      if (action === 'add') {
        if (!base) throw new Error(`model "${baseId}" is not declared on route "${route}"`)
        if (idx >= 0) return { ok: true, variantId, existed: true }
        const entry = { ...base, id: variantId }
        if (typeof base.name === 'string' && base.name.length > 0) entry.name = base.name + ' (online)'
        models.splice(models.indexOf(base) + 1, 0, entry)
      } else {
        if (idx < 0) return { ok: true, variantId, existed: false }
        models.splice(idx, 1)
      }
      try {
        await ctx.settings.mutate(NS, [{ op: 'set', path: ['providers', route, 'models'], value: models }], revision)
        return { ok: true, variantId, existed: action === 'add' ? false : true }
      } catch (error) {
        if (error?.code === 'SETTINGS_CONFLICT' && attempt < 2) continue
        throw error
      }
    }
    throw new Error('settings conflict: the llm-pi-ai section changed three times while writing')
  }

  /** Official DeepSeek route: rewrite the adapter's `models` list with the edited contextWindow / maxTokens (levels are adapter-owned). */
  async function applyDeepSeek(modelId, changes) {
    if ((changes.reasoningEfforts !== undefined && changes.reasoningEfforts !== null) || (typeof changes.effortSpec === 'string' && changes.effortSpec.trim() !== '') || changes.supportsReasoningEffort === true) {
      throw new Error('thinking levels of the official DeepSeek route are fixed by its adapter (llm-deepseek: thinking / reasoningEffort); only contextWindow and maxTokens can be set here')
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { section, revision } = dsUserSection()
      const resolved = dsResolvedModels()
      if (!resolved.some(m => m.id === modelId)) throw new Error(`model "${modelId}" is not declared on route "deepseek-official"`)
      const userList = Array.isArray(section.models) ? section.models : []
      const dsDefaults = deepseekSchemaDefaults(ctx.settings.describe?.()?.find(x => x.ns === DS_NS)?.schema) ?? fallbackCatalog()
      const list = resolved.map(m => dsMinimal(m, userList.find(u => u?.id === m.id)))
      const entry = list.find(m => m.id === modelId)
      for (const key of ['contextWindow', 'maxTokens']) {
        if (changes[key] === undefined) continue
        const n = positiveInt(changes[key])
        if (changes[key] === null || n === null) delete entry[key]; else entry[key] = n
      }
      const anyNumber = list.some(m => m.contextWindow !== undefined || m.maxTokens !== undefined)
      // the list is still the adapter's own catalog when every entry says exactly what the default entry says on
      // every field this plugin carries (name, description, image fields, prompt-update flag); any other edit keeps the list pinned
      const CATALOG_FIELDS = ['name', 'description', 'inputModalities', 'imagePixelBudget', 'imageMaxBytes', 'systemPromptUpdate']
      const projection = e => JSON.stringify(Object.fromEntries(CATALOG_FIELDS.filter(k => e?.[k] !== undefined).map(k => [k, e[k]])))
      const isDefaultCatalog = list.length === dsDefaults.length && dsDefaults.every(d => list.some(m => m.id === d.id && projection(m) === projection(d)))
      // no numbers left AND the list is the adapter's own catalog → unset (defaults return); a narrowed / extended list is kept
      const ops = anyNumber || !isDefaultCatalog ? [{ op: 'set', path: ['models'], value: list }] : [{ op: 'unset', path: ['models'] }]
      try { await ctx.settings.mutate(DS_NS, ops, revision); break } catch (error) { if (error?.code === 'SETTINGS_CONFLICT' && attempt < 2) continue; throw error }
    }
    return { ok: true }
  }

  /** Teach the levels of local models that declare none, so the picker offers them without a launcher visit. */
  async function autoTeach() {
    if (!config.autoTeach) return []
    const taught = []
    try {
      await probeAll()
      const user = userSectionOrEmpty()
      for (const { route, cfg } of localRoutes()) {
        const ucfg = user.providers?.[route]
        for (const m of modelsOf(cfg)) {
          const ue = modelsOf(ucfg).find(x => x.id === m.id)
          if (!ue || ue.reasoningEfforts !== undefined) continue // declared by the user (or not editable here): leave it alone
          const { probe, classification } = classify(route, m.id)
          if (!['prompt-toggle', 'effort-levels'].includes(classification.kind)) continue
          const rec = recommend({ backend: probe?.backend ?? 'unknown', classification, api: cfg.api ?? 'openai-completions' })
          if (!rec.reasoningEfforts) continue
          try {
            await applyChanges(route, m.id, { reasoningEfforts: rec.reasoningEfforts, ...(rec.supportsReasoningEffort === undefined ? {} : { supportsReasoningEffort: rec.supportsReasoningEffort }), thinkingMode: rec.thinkingMode ?? 'auto' })
            taught.push({ route, modelId: m.id, levels: Object.keys(rec.reasoningEfforts), at: Date.now() })
            console.log(`[local-reasoning] auto-taught ${route}/${m.id}: levels ${Object.keys(rec.reasoningEfforts).join('/')} (turn off in the launcher → Model parameters)`)
          } catch (error) {
            console.warn(`[local-reasoning] auto-teach ${route}/${m.id} skipped: ${String(error?.message ?? error)}`)
          }
        }
      }
    } catch (error) {
      console.warn(`[local-reasoning] auto-teach skipped: ${String(error?.message ?? error)}`)
    }
    autoTaught = [...autoTaught, ...taught].slice(-50)
    return taught
  }
  ctx.effect(() => { const t = setTimeout(() => { autoTeach() }, AUTO_TEACH_DELAY_MS); t.unref?.(); return () => clearTimeout(t) }, 'dsh-local-reasoning: auto-teach')

  // ── prompt soft switch for prompt-toggle families ──
  ctx.on('agent/request', async (payload, next) => {
    const cfg = await next()
    if (payload?.agent?.id !== undefined && cfg && typeof cfg === 'object') {
      const key = String(payload.agent.id)
      effortByAgent.delete(key)
      effortByAgent.set(key, { provider: cfg.provider, model: cfg.model, effort: cfg.reasoningEffort })
      if (effortByAgent.size > EFFORT_MEMORY) effortByAgent.delete(effortByAgent.keys().next().value)
    }
    return cfg
  })
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || decision.messages.length === 0) return decision
    const agent = payload.agent
    const header = agent?.session?.requestHeader?.()?.config
    const remembered = agent?.id !== undefined ? effortByAgent.get(String(agent.id)) : undefined
    const provider = header?.provider ?? remembered?.provider ?? agent?.options?.provider
    const model = header?.model ?? remembered?.model ?? agent?.options?.model
    if (typeof provider !== 'string' || typeof model !== 'string') return decision
    const mode = config.thinking[`${provider}/${model}`] ?? 'auto'
    if (mode === 'auto') return decision
    if (classify(provider, model).classification.kind !== 'prompt-toggle') return decision
    // follow-picker: the level the picker applied to the latest request (the selection itself is private to
    // the web host); before the first request the default-model level stands in. A level changed in the
    // picker therefore reaches the soft switch from the next request on.
    let effort = header?.reasoningEffort ?? remembered?.effort
    if (header === undefined && remembered === undefined) {
      const dm = ctx.settings.get('agent-default-model')
      if (dm && typeof dm === 'object' && dm.provider === provider && dm.model === model) effort = dm.reasoningEffort
    }
    const suffix = toggleSuffix({ mode, effort })
    if (suffix === '') return decision
    // Only the last user-typed message: context snapshots (plugin source) must stay byte-identical for the
    // runtime-context projection to dedupe them, and tool results are not instructions.
    let target = -1
    for (let i = decision.messages.length - 1; i >= 0; i--) {
      const src = decision.messages[i]?.source
      if (src === undefined || src?.kind === 'user') { target = i; break }
    }
    if (target < 0) return decision
    const messages = decision.messages.map((m, i) => {
      if (i !== target || !Array.isArray(m.content)) return m
      let done = false
      const content = m.content.map(b => {
        if (done || b.type !== 'text') return b
        done = true
        return { ...b, text: b.text.endsWith(suffix) ? b.text : `${b.text}\n${suffix}` }
      })
      return done ? { ...m, content } : m
    })
    return { kind: 'enter', messages }
  })

  // ── HTTP routes for the launcher ──
  const route = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname
    try {
      if (rejectCrossSite(req, { allowLoopbackOrigins: true })) return json(res, 403, { ok: false, message: 'same-origin JSON requests only' })
      if (req.method === 'GET' && p === '/dsh-local-reasoning/status') return json(res, 200, await statusView())
      if (req.method === 'POST' && p === '/dsh-local-reasoning/probe') { await probeAll(); return json(res, 200, { ok: true, ...(await statusView()) }) }
      if (req.method === 'POST' && p === '/dsh-local-reasoning/apply') {
        const body = await readBody(req)
        await applyChanges(String(body.route ?? ''), String(body.modelId ?? ''), body.changes && typeof body.changes === 'object' ? body.changes : {})
        return json(res, 200, { ok: true, ...(await statusView()) })
      }
      if (req.method === 'POST' && p === '/dsh-local-reasoning/apply-recommended') {
        const body = await readBody(req)
        const view = (await statusView()).routes.find(r => r.route === body.route)
        const m = view?.models.find(x => x.id === body.modelId)
        if (!m || !m.recommended) return json(res, 404, { ok: false, message: 'local model not found' })
        const rec = m.recommended
        await applyChanges(String(body.route), String(body.modelId), {
          reasoningEfforts: rec.reasoningEfforts,
          ...(rec.supportsReasoningEffort === undefined ? {} : { supportsReasoningEffort: rec.supportsReasoningEffort }),
          contextWindow: rec.contextWindow, maxTokens: rec.maxTokens,
          thinkingMode: rec.thinkingMode ?? 'auto',
        })
        return json(res, 200, { ok: true, ...(await statusView()) })
      }
      if (req.method === 'POST' && p === '/dsh-local-reasoning/route-api') {
        const body = await readBody(req)
        const api = String(body.api ?? '')
        const routeName = String(body.route ?? '')
        if (!ROUTE_APIS.includes(api)) return json(res, 400, { ok: false, message: `api must be one of ${ROUTE_APIS.join(', ')}` })
        for (let attempt = 0; ; attempt++) {
          const { section, revision } = userSection()
          if (!isLocalRoute(section.providers?.[routeName])) return json(res, 404, { ok: false, message: `route "${routeName}" is not a local route` })
          const ops = [{ op: 'set', path: ['providers', routeName, 'api'], value: api }]
          if (api !== 'openai-completions') {
            // compat.supportsReasoningEffort is refused on non-completions protocols: drop it from every entry first
            const models = modelsOf(section.providers[routeName]).map(m => tidyModel(m))
            let touched = false
            for (const m of models) { if (m.compat && 'supportsReasoningEffort' in m.compat) { const compat = { ...m.compat }; delete compat.supportsReasoningEffort; if (Object.keys(compat).length === 0) delete m.compat; else m.compat = compat; touched = true } }
            if (touched) ops.unshift({ op: 'set', path: ['providers', routeName, 'models'], value: models })
            if (section.providers[routeName]?.compat && 'supportsReasoningEffort' in section.providers[routeName].compat) ops.push({ op: 'unset', path: ['providers', routeName, 'compat', 'supportsReasoningEffort'] })
          }
          try { await ctx.settings.mutate(NS, ops, revision); break }
          catch (error) { if (error?.code === 'SETTINGS_CONFLICT' && attempt < 2) continue; throw error }
        }
        return json(res, 200, { ok: true, ...(await statusView()) })
      }
      if (req.method === 'POST' && p === '/dsh-local-reasoning/online-variant') {
        const body = await readBody(req)
        const result = await onlineVariant(String(body.route ?? ''), String(body.modelId ?? ''), String(body.action ?? 'add'))
        return json(res, 200, { ...result, ...(await statusView()) })
      }
      if (req.method === 'POST' && p === '/dsh-local-reasoning/settings') {
        const body = await readBody(req)
        if (typeof body.autoTeach === 'boolean') { config.autoTeach = body.autoTeach; saveConfig() }
        const taught = body.teachNow === true ? await autoTeach() : []
        return json(res, 200, { ok: true, taught, ...(await statusView()) })
      }
      res.writeHead(404); res.end()
    } catch (error) {
      if (error?.code === 'SETTINGS_CONFLICT') return json(res, 409, { ok: false, message: String(error?.message ?? error).slice(0, 300) })
      json(res, error?.status === 400 || error?.status === 413 ? error.status : (/not found|not declared|not a local|managed by another|fixed by its adapter|chat-completions switch|switched through|sets compat|its api is|unknown thinking level|must be|at least one level|reasoningEfforts|wire value|no user settings layer|not registered|action must be|not an OpenRouter|serves the built-in catalog/.test(String(error?.message)) ? 400 : 500), { ok: false, message: String(error?.message ?? error).slice(0, 600) })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-local-reasoning', handler: route }), 'dsh-local-reasoning: routes')
  console.log('[local-reasoning] loaded')
}
