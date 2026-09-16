/**
 * dsh-web-search-plus host plugin.
 *
 * Modes (config `mode` in $DSH_HOME/web-search.json, hot-reloaded):
 *  - off    : the model's `web_search` tool is denied; nothing is injected.
 *  - tool   : the native `web_search` tool stays available; when the chosen
 *             provider is not DeepSeek's own, the call is served by this plugin
 *             through the `tools/execute` waterfall (same result shape as
 *             dsh-tool-web, so the registry re-renders the web card).
 *  - inject : SillyTavern-style — the plugin searches when a trigger matches the
 *             user's own message (backticks / regex / phrases / always) and adds
 *             the formatted results as a SEPARATE plugin-sourced user-role
 *             message right after it at agent/pre-step (the user's words stay
 *             untouched; the row renders as context, not as a user bubble); the
 *             `web_search` tool is denied so the model cannot double-search.
 *             With provider `deepseek-official` the search goes through the
 *             core's own web seam (`ctx.web.search`).
 *
 * Providers are also registered on the dsh web seam (`ctx.web`), so a profile
 * patch may pin one as the deployment's `searchProvider`. API keys are
 * credential references (SERPER_API_KEY, …) resolved through `ctx.credentials`;
 * the launcher stores them with `POST /dsh-web-search-plus/key`.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, watchFile, unwatchFile } from 'node:fs'
import { join, dirname } from 'node:path'
import { PROVIDERS, PROVIDER_IDS, searchWith } from './providers.js'
import { normalizeConfig, validateConfig, decideTrigger, formatResults, formatToolText, formatPageText, mergeSearchResults, normalizeTriggerText } from './inject.js'
import { createRegexMatcher } from './regex-guard.js'
import { fetchPageText, boundedSignal } from './page.js'
import { fetchPinned } from './fetch.js'
import { rejectCrossSite, json, readBody as kitReadBody } from 'dsh-cyberworkstation-kit/fence'

export const name = 'web-search-plus'
export const inject = ['web', 'tools', 'systemPrompt', 'webServer']
// `settings` and `llm` are read optionally through ctx.get: the provider-native mode needs them to
// create the <model>:online entry; no other mode touches them.

const DSH_HOME = resolveDshHome()
const CONFIG_FILE = join(DSH_HOME, 'web-search.json')
const SEARCH_TIMEOUT_MS = 25000
// Tool-mode page visiting runs after the search inside the same tool call. The shipped
// web_search budget is 60 s (agent presets, tool-web searchTimeoutMs), so the visits get a
// bounded slice of what is left rather than the whole remainder.
const VISIT_BUDGET_MS = 15000
const VISIT_PAGE_TIMEOUT_MS = 12000
const MAX_BODY = 64 * 1024
const readBody = (req, limit = MAX_BODY) => kitReadBody(req, limit)

/** @param {import('@deepseek-ai/cordis').Context} ctx */
/**
 * The model the native test searches with: the owner's `providerNative.testModel` when set, else
 * the dsh default when it is on this route and not Anthropic, else the first plain id of a
 * vendor known to answer :online (replay 2026-09-02: kimi / deepseek / gpt-5-mini / gemini flash /
 * qwen / mistral), else the first non-Anthropic id. Anthropic ids are never chosen: they hang.
 */
export function pickTestModel(ids, dflt, preferred) {
  const anthropic = new RegExp('^~?anthropic/', 'i')
  const plain = ids.map(id => String(id).replace(/:online$/, '')).filter(id => id && !anthropic.test(id))
  if (typeof preferred === 'string' && preferred && !anthropic.test(preferred)) return preferred.replace(/:online$/, '')
  const d = typeof dflt === 'string' ? dflt.replace(/:online$/, '') : ''
  if (d && !anthropic.test(d)) return d
  const cheap = ['moonshotai/kimi', 'deepseek/deepseek-chat', 'openai/gpt-5-mini', 'google/gemini-3-flash', 'qwen/qwen3', 'mistralai/mistral-medium']
  for (const prefix of cheap) { const hit = plain.find(id => id.startsWith(prefix)); if (hit) return hit }
  return plain[0] ?? ''
}
export function apply(ctx) {
  let config = normalizeConfig(null)
  let promptDisposer = null
  const cache = new Map()
  // The trigger regex is user-written and runs on every user message: it is matched inside a worker
  // with a deadline, so a pattern that backtracks exponentially costs one killed worker instead of
  // freezing the whole harness. A pattern that overruns is reported once and treated as "no match".
  const reportedSlowPatterns = new Set()
  const regexMatcher = createRegexMatcher({
    timeoutMs: 60,
    onTimeout: pattern => {
      if (reportedSlowPatterns.has(pattern)) return
      reportedSlowPatterns.add(pattern)
      console.warn(`[web-search-plus] the trigger regex took too long and was abandoned; searches will not trigger on it: ${pattern.slice(0, 120)}`)
    },
  })

  const credentials = () => ctx.get('credentials')
  let credentialRef = v => v
  import('@deepseek-ai/dsh-credentials').then(m => { credentialRef = m.credentialRef }).catch(() => { /* keep identity */ })
  // createUserMessage mints the id / role / frozen shape the loop expects for an appended message.
  // The import is awaited inside the pre-step handler, so there is no window in which the fallback runs by accident.
  let createUserMessage = null
  let fallbackWarned = false
  const llmReady = import('@deepseek-ai/dsh-llm').then(m => { createUserMessage = typeof m.createUserMessage === 'function' ? m.createUserMessage : null }).catch(() => { createUserMessage = null })

  // ── web_fetch: the page reader. This plugin mounts the core's own tool at the host plane (visible to every
  // agent whose preset does not mount tool-web fetch itself) with the core's HTTP provider called directly and a
  // public-address guard in front (no loopback / private / link-local names or addresses, no blacklisted hosts);
  // the execute hook below applies the same guard to the per-session registration the 0.1.5 shipped presets
  // (standard / cordis / ptc, tool-web fetch: true) resolve instead. Nothing here goes through the Windows sandbox, so HTTPS works.
  const fetchDeps = Promise.all([
    import('@deepseek-ai/dsh-tool-web').catch(() => null),
    import('@deepseek-ai/dsh-tools').catch(() => null),
  ])
  let fetchDisposers = []
  let fetchMissing = []
  let fetchGeneration = 0
  let fetchReason = ''
  let disposed = false
  const unmountFetch = () => { for (const d of fetchDisposers.splice(0)) { try { d() } catch { /* already gone */ } } }
  /** The guarded page read: every hop validated and connected to the address the check saw, no second lookup of the name. */
  async function guardedFetch(toolWeb, args, signal) {
    const f = config.fetch
    const input = toolWeb.parseFetchArgs(args)
    const result = await fetchPinned(input.url, { blacklist: config.blacklist, timeoutMs: f.timeoutMs + 5000, maxResponseBytes: f.maxResponseBytes, maxBodyChars: f.maxBodyChars, signal })
    // The core re-renders a middleware result from `value` with the RESOLVED tool's own output cap (a preset's
    // web_fetch: 200,000 characters), so this deployment's cap travels inside the value.
    const cap = Math.min(f.maxBodyChars, f.maxOutputChars)
    const content = typeof result.body.content === 'string' && result.body.content.length > cap ? result.body.content.slice(0, cap) : result.body.content
    return { url: result.url, statusCode: result.statusCode, body: { kind: result.body.kind, content }, truncated: result.truncated || content !== result.body.content }
  }
  // Since 0.1.5 the shipped presets (standard / cordis / ptc) mount the core's own `web_fetch` per session, which
  // shadows the host-plane registration below. The reader is therefore also an execute hook: whichever
  // `web_fetch` registration a session resolves, the call runs through the same guarded read while the switch is on.
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name !== 'web_fetch' || !config.fetch.enabled || config.mode === 'off') return next()
    // a malformed call goes to the resolved tool, whose schema check raises the canonical argument error
    if (typeof exec.arguments?.url !== 'string') return next()
    const [toolWebModule] = await fetchDeps
    if (!toolWebModule) return next()
    try {
      const value = await guardedFetch(toolWebModule, exec.arguments, exec.signal)
      return { isError: false, value, content: [{ type: 'text', text: toolWebModule.formatFetchOutput(value, config.fetch.maxOutputChars) }], meta: toolWebModule.fetchMetaFromValue(value, config.fetch.maxOutputChars) }
    } catch (error) {
      const reason = String(error?.message ?? error)
      const message = reason.startsWith('web_fetch ') ? reason : `web_fetch failed: ${reason}`
      return { isError: true, error: { message, info: { name: 'WebSearchPlusError', code: 'WEB_FETCH_PLUS_FAILED' } }, content: [{ type: 'text', text: message }] }
    }
  })
  async function mountFetch() {
    const generation = ++fetchGeneration
    unmountFetch()
    fetchMissing = []
    fetchReason = ''
    if (!config.fetch.enabled) { fetchReason = 'switched off'; return }
    // "Web search: off" means the model works offline; the page reader stays down with it.
    if (config.mode === 'off') { fetchReason = 'web search mode is off'; return }
    const [toolWeb, tools] = await fetchDeps
    if (generation !== fetchGeneration || disposed) return
    fetchMissing = [['@deepseek-ai/dsh-tool-web', toolWeb], ['@deepseek-ai/dsh-tools', tools]].filter(([, m]) => !m).map(([n]) => n)
    if (typeof ctx.tools?.register !== 'function' || typeof ctx.systemPrompt?.section !== 'function') fetchMissing.push('tools / systemPrompt service')
    if (fetchMissing.length > 0) { fetchReason = `${fetchMissing.join(', ')} unavailable`; console.warn(`[web-search-plus] web_fetch not mounted: ${fetchReason}`); return }
    // Since 0.1.2 the base bundle mounts tool-web with `fetch: true`; the web-app bundle disables that row at the
    // host plane, but a headless or custom profile keeps it, and `tools.register` throws on a second `web_fetch`.
    let existing
    try { existing = typeof ctx.tools.get === 'function' ? ctx.tools.get('web_fetch') : undefined } catch { existing = undefined }
    if (existing) { fetchReason = 'the core already mounts web_fetch in this profile'; console.warn(`[web-search-plus] web_fetch not mounted: ${fetchReason}`); return }
    const f = config.fetch
    const disposers = []
    const undo = () => { for (const d of disposers.splice(0)) { try { d() } catch { /* gone */ } } }
    try {
    disposers.push(ctx.systemPrompt.section({
      name: 'web-search-plus:fetch',
      order: 112,
      text: 'Use the web_fetch tool to read the content of a specific public HTTP(S) URL (for example a result from web_search); it returns the page decoded to text. Prefer it over downloading pages through the shell. Cite the URL as a markdown link when you use its content.',
    }))
    disposers.push(ctx.tools.register(tools.defineTool({
      name: 'web_fetch',
      description: 'Fetch the content of a specific public HTTP(S) URL and return it decoded to text.',
      parameters: { url: { type: 'string', required: true, description: 'The HTTP(S) URL to fetch.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', required: true },
            statusCode: { type: 'integer', required: true },
            body: {
              required: true,
              oneOf: [
                { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'html' }, content: { type: 'string', required: true } } },
                { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'text' }, content: { type: 'string', required: true } } },
              ],
            },
            truncated: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: toolWeb.formatFetchOutput(value, f.maxOutputChars) }],
        presentationMeta: (_args, value) => toolWeb.fetchMetaFromValue(value, f.maxOutputChars),
      },
      timeoutMs: f.timeoutMs,
      isConcurrencySafe: () => true,
      execute: (args, exec) => guardedFetch(toolWeb, args, exec?.signal),
      presentCall: toolWeb.presentFetchCall,
      presentResult: (args, result) => toolWeb.presentFetchResult(args, result),
    })))
    } catch (error) {
      // A registry that already holds web_fetch (a preset with fetch: true) or any other failure: nothing half-mounted stays behind.
      undo()
      fetchReason = 'mount failed: ' + String(error?.message ?? error).slice(0, 200)
      console.warn('[web-search-plus] web_fetch not mounted: ' + fetchReason)
      return
    }
    if (generation !== fetchGeneration || disposed) { undo(); return }
    fetchDisposers = disposers
    console.log('[web-search-plus] web_fetch mounted: public http(s) pages, ' + f.timeoutMs + ' ms budget')
  }

  async function apiKeyFor(providerId) {
    const env = PROVIDERS[providerId]?.keyEnv
    if (!env) return undefined
    try { return (await credentials()?.resolve?.(credentialRef(env)))?.value } catch { return undefined }
  }
  async function keyConfigured(providerId) {
    const env = PROVIDERS[providerId]?.keyEnv
    if (!env) return true
    try { return (await credentials()?.describe?.(credentialRef(env)))?.configured === true } catch { return false }
  }

  /** One search through the selected provider; `deepseek-official` rides the core's own seam. Always time-bounded. */
  async function searchOnce(providerId, query, maxResults, signal) {
    const bounded = boundedSignal(signal, SEARCH_TIMEOUT_MS)
    if (providerId === 'deepseek-official') return ctx.web.search({ query, maxResults }, bounded)
    return searchWith(providerId, { query, maxResults, apiKey: await apiKeyFor(providerId), searxngUrl: config.searxngUrl, signal: bounded })
  }
  async function runSearch(query, providerId = config.provider, maxResults = config.maxResults, signal) {
    const key = `${providerId}|${maxResults}|${query.toLowerCase()}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < config.cacheTtlSec * 1000) return hit.result
    const result = await searchOnce(providerId, query, maxResults, signal)
    cache.set(key, { at: Date.now(), result })
    if (cache.size > 200) cache.delete(cache.keys().next().value)
    return result
  }

  /**
   * Tool mode: open the top results and return their article text.
   *
   * Snippets from any search API are a sentence or two; without this the model needs a second
   * round trip through `web_fetch` for anything it actually has to read — and a local model is
   * exactly the kind that does not reliably take that second step. Opt-in through
   * `toolVisit.links` (0 = off), bounded in total and per page, and every failure is dropped:
   * a page that will not open must never fail the search that found it.
   * @returns {Promise<Array<{ url: string, text: string, title?: string }>>}
   */
  async function visitSources(sources, signal) {
    const { links, chars } = config.toolVisit
    if (links <= 0 || sources.length === 0) return []
    const bounded = boundedSignal(signal, VISIT_BUDGET_MS)
    const targets = sources.slice(0, links)
    // The label is attached per target, before the failures are dropped: filtering first and
    // zipping by index afterwards would put one page's title on another page's text.
    const visited = await Promise.all(targets.map(async source => {
      const page = await fetchPageText(source.url, {
        maxChars: chars,
        blacklist: config.blacklist,
        extractorUrl: config.extractorUrl,
        signal: bounded,
        timeoutMs: VISIT_PAGE_TIMEOUT_MS,
      }).catch(() => null)
      if (page === null || typeof page.text !== 'string' || page.text.trim().length === 0) return null
      const title = page.title ?? source.title
      return { ...page, ...(title ? { title } : {}) }
    }))
    return visited.filter(Boolean)
  }

  // Which <model>:online variants exist (or are known impossible); cleared whenever the config reloads.
  const onlineReady = new Set()
  const onlineFailed = new Map()
  const loadConfig = () => {
    if (disposed) return
    // the model catalog may have changed with the config (the launcher can remove an :online entry)
    onlineReady.clear()
    onlineFailed.clear()
    let raw = null
    try { raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) } catch { /* missing = defaults */ }
    const hadFetchBlock = raw !== null && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'fetch')
    config = normalizeConfig(raw)
    cache.clear()
    // An upgrade finds a config written before the page reader existed. Its resolved state is
    // written down once, so the switch in both UIs reflects a value that is actually stored rather
    // than a default the owner never saw.
    if (raw !== null && !hadFetchBlock) {
      try {
        mkdirSync(dirname(CONFIG_FILE), { recursive: true })
        const tmp = `${CONFIG_FILE}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
        writeFileSync(tmp, JSON.stringify(config, null, 2))
        renameSync(tmp, CONFIG_FILE)
        console.log('[web-search-plus] web-search.json had no "fetch" section; the page reader state was written into it')
      } catch (error) { console.warn('[web-search-plus] could not record the page reader state: ' + String(error?.message ?? error)) }
    }
    if (promptDisposer) { try { promptDisposer() } catch { /* disposed */ } promptDisposer = null }
    if (config.mode === 'inject') {
      promptDisposer = ctx.systemPrompt.section({
        name: 'web-search-plus:mode',
        order: 111,
        text: 'Web search runs automatically in this deployment: when a message carrying "[Web search results …]" follows the user message, treat it as fresh context and cite its URLs. The web_search tool is disabled here — calling it is denied; answer from the provided results or say what is missing.',
      })
    } else if (config.mode === 'off') {
      promptDisposer = ctx.systemPrompt.section({ name: 'web-search-plus:mode', order: 111, text: 'Web search is turned off for this deployment: the web_search tool is denied, do not call it; answer from your own knowledge and say when something may be outdated.' })
    } else if (config.mode === 'tool') {
      promptDisposer = ctx.systemPrompt.section({
        name: 'web-search-plus:mode',
        order: 111,
        text: `Web search in this deployment is the \`web_search\` tool, answered by ${config.provider}: call it when the answer depends on something current, then cite the URLs you used. Do not claim you cannot search.`,
      })
    } else if (config.mode === 'provider') {
      promptDisposer = ctx.systemPrompt.section({
        name: 'web-search-plus:mode',
        order: 111,
        text: 'Web search in this deployment is served by the model provider itself when the route supports it (OpenRouter searches server-side for every request); otherwise the web_search tool below is served by the configured search source. Cite the URLs you use.',
      })
    }
    const visitNote = config.toolVisit.links > 0
      ? ` toolVisit=${config.toolVisit.links}×${config.toolVisit.chars} via ${config.extractorUrl ? 'extractor ' + config.extractorUrl : 'built-in extraction'}`
      : ''
    console.log(`[web-search-plus] mode=${config.mode} provider=${config.provider} fetch=${config.fetch.enabled ? 'on' : 'off'}${visitNote}`)
    mountFetch().catch(error => console.warn('[web-search-plus] web_fetch mount failed: ' + String(error?.message ?? error)))
  }
  loadConfig()
  ctx.effect(() => {
    watchFile(CONFIG_FILE, { interval: 1500 }, loadConfig).unref?.()
    return () => { disposed = true; unwatchFile(CONFIG_FILE, loadConfig); regexMatcher.dispose(); fetchGeneration++; unmountFetch(); if (promptDisposer) { try { promptDisposer() } catch { /* noop */ } } }
  }, 'web-search-plus: config watch')

  // ── providers on the dsh web seam ──
  for (const id of PROVIDER_IDS) {
    let configured = false
    const refresh = () => { keyConfigured(id).then(v => { configured = v }).catch(() => { configured = false }) }
    refresh()
    ctx.on('credentials/reference-updated', () => refresh())
    ctx.effect(() => ctx.web.registerSearchProvider({
      id,
      available: () => (PROVIDERS[id].needsUrl ? config.searxngUrl.length > 0 : configured),
      search: (request, signal) => runSearch(request.query, id, request.maxResults ?? config.maxResults, signal),
    }), `web-search-plus: provider ${id}`)
  }

  // ── tool gating and tool-mode routing ──
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'web_search') return next()
    if (config.mode === 'off') return { kind: 'deny', reason: 'web_search is switched off for this deployment (DSH Control Deck → Web search → mode). Do not retry; answer without live search and say when information may be outdated.' }
    if (config.mode === 'inject') return { kind: 'deny', reason: 'web_search is disabled because search results are injected automatically next to the user message in this deployment. Do not retry; use the "[Web search results …]" context when present.' }
    if (config.mode === 'provider' && !config.providerNative.fallbackToTool && nativeByAgent.get(exec?.agent) === true) {
      return { kind: 'deny', reason: 'this deployment lets the model provider search on its own; the results are already in the answer stream. Do not call web_search.' }
    }
    return next()
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name !== 'web_search' || (config.mode !== 'tool' && config.mode !== 'provider') || config.provider === 'deepseek-official') return next()
    const queries = Array.isArray(exec.arguments?.queries) ? exec.arguments.queries.map(String).filter(q => q.trim().length > 0) : []
    if (queries.length === 0) return next()
    try {
      const results = await Promise.all(queries.slice(0, 4).map(q => runSearch(q, config.provider, config.maxResults, exec.signal)))
      const merged = mergeSearchResults(queries, results, config.maxResults)
      const pages = await visitSources(merged.sources, exec.signal)
      // Core re-renders successful middleware results from value. Keep article text in the
      // schema-approved content field so model text, code-mode values and replay agree.
      const articleText = formatPageText(pages)
      const content = [merged.content, articleText].filter(Boolean).join('\n\n')
      const value = { ...(content ? { content } : {}), sources: merged.sources.map(s => ({ url: s.url, ...(s.title ? { title: s.title } : {}), ...(s.snippet ? { snippet: s.snippet } : {}), ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}) })), truncated: merged.truncated }
      return {
        isError: false,
        value,
        content: [{ type: 'text', text: formatToolText(value) }],
        meta: { sources: value.sources, truncated: value.truncated, ...(value.content ? { answer: value.content } : {}) },
      }
    } catch (error) {
      const message = `web_search via ${config.provider} failed: ${String(error?.message ?? error)}`
      // ToolFailure shape: { message, info?: { name, code } } (core/packages/core/tools ToolFailure / ToolErrorInfo)
      return { isError: true, error: { message, info: { name: 'WebSearchPlusError', code: 'WEB_SEARCH_PLUS_FAILED' } }, content: [{ type: 'text', text: message }] }
    }
  })

  // ── provider-native mode (OpenRouter's own search) ──
  // OpenRouter searches server-side when the model id carries the `:online` suffix
  // (openrouter.ai/docs/features/web-search: equivalent to plugins:[{id:'web'}], any model,
  // billed per search). pi-ai refuses a model id its materialised catalog does not hold
  // (UNKNOWN_MODEL), so the suffixed entry is created in settings first — cloned from the base
  // model — and only then does the request switch to it. Routes with no native switch keep the
  // `web_search` tool, served by the source configured above.
  const ONLINE = ':online'
  // Per agent, not per plugin: two live sessions must not read each other's last request.
  const nativeByAgent = new WeakMap()
  const skippedOnce = new Set()
  /**
   * Null for a non-Anthropic model; else whether it must stay off OpenRouter's web plugin. The hook
   * sees no messages or tools, and the harness always ships dozens of tool schemas — exactly the
   * request size at which the plugin never answers for Anthropic (measured 2026-09-02) — so the
   * rule is the owner's explicit opt-in, not a measurement.
   */
  /**
   * Whether this request must keep its plain model id in provider-native mode. OpenRouter's web
   * plugin never answers an Anthropic model once the harness's tool schemas are attached (2026-09-02
   * replay: 93 tools / 87 KB hangs, 60 tools / 69 KB answers in 2 s), and the agent/request hook
   * cannot see the messages or tools to size the request — so the rule is by model family, with
   * `providerNative.anthropicNative` as the opt-in for owners who want the variant anyway.
   */
  // Plain ids and the `~anthropic/…-latest` alias ids OpenRouter accepts are both Anthropic.
  const ANTHROPIC_ID = new RegExp('^~?anthropic/', 'i')
  function keepsPlainModel(request) {
    const model = String(request?.model ?? '').replace(new RegExp(ONLINE + '$'), '')
    if (!ANTHROPIC_ID.test(model)) return false
    return config.providerNative.anthropicNative !== true
  }
  /** OpenRouter is recognised by its host; the bare route name counts only when no baseURL is set. */
  const isOpenRouterRoute = (route, cfg) => {
    const host = (() => { try { return new URL(String(cfg?.baseURL ?? '')).hostname } catch { return '' } })()
    if (host) return /(^|\.)openrouter\.ai$/i.test(host)
    return route === 'openrouter'
  }
  /** Make sure `<model>:online` exists on an llm-pi-ai route that lists its own models. */
  async function ensureOnlineVariant(route, modelId) {
    const key = route + '/' + modelId
    if (onlineReady.has(key)) return true
    if ((onlineFailed.get(key) ?? 0) > Date.now() - 300000) return false
    const settings = ctx.get('settings')
    const llm = ctx.get('llm')
    const give = why => { onlineFailed.set(key, Date.now()); console.warn(`[web-search-plus] provider-native is off for ${route}/${modelId}: ${why}`); return false }
    if (!settings?.describe || !settings.mutate) return give('this deployment exposes no writable settings service')
    try {
      const dir = llm?.listConfigurableProviders?.() ?? []
      const entry = dir.find(d => d.provider === route)
      if (entry && entry.settingsNs !== 'llm-pi-ai') return give(`its settings live in ${entry.settingsNs}, not llm-pi-ai`)
      const section = settings.get('llm-pi-ai')
      const cfg = section?.providers?.[route]
      if (!isOpenRouterRoute(route, cfg)) return give('the route is not OpenRouter, so it has no :online switch')
      for (let attempt = 0; attempt < 3; attempt++) {
        const described = settings.describe().find(x => x.ns === 'llm-pi-ai')
        const user = described?.user && typeof described.user === 'object' ? described.user : {}
        const ucfg = user.providers?.[route]
        const models = Array.isArray(ucfg?.models) ? ucfg.models.map(m => (typeof m === 'string' ? { id: m } : { ...m })) : []
        if (models.length === 0) return give('the route carries no models list of its own (a catalog-only route cannot gain an id)')
        const base = models.find(m => m.id === modelId)
        if (!base) return give('the route does not declare this model')
        if (models.some(m => m.id === modelId + ONLINE)) { onlineReady.add(key); return true }
        const variant = { ...base, id: modelId + ONLINE }
        // The provider-sync Claude note sits at the end of an Anthropic name; " (online)" goes before it, not after.
        if (typeof base.name === 'string' && base.name.length > 0) {
          const [plain, ...noteParts] = base.name.split('【claude系')
          variant.name = plain.trim() + ' (online)' + (noteParts.length ? ' 【claude系' + noteParts.join('【claude系') : '')
        }
        models.splice(models.indexOf(base) + 1, 0, variant)
        try {
          await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', route, 'models'], value: models }], described?.revision)
          onlineReady.add(key)
          console.log(`[web-search-plus] provider-native: added ${modelId}${ONLINE} to route ${route}`)
          return true
        } catch (error) {
          if (error?.code === 'SETTINGS_CONFLICT' && attempt < 2) continue
          throw error
        }
      }
      return give('the settings namespace stayed contended across three attempts')
    } catch (error) {
      onlineFailed.set(key, Date.now())
      console.warn(`[web-search-plus] provider-native is unavailable for ${route}/${modelId}: ${String(error?.message ?? error)}`)
      return false
    }
  }
  /**
   * One real `<model>:online` request through OpenRouter with the route's own credential. The
   * model is the harness default when it lives on an OpenRouter route, else the first model of the
   * first OpenRouter route. Answers the citations OpenRouter attached, so the panel shows that the
   * search actually happened — and what one such call costs.
   */
  async function testNative(query) {
    const settings = ctx.get('settings')
    const section = settings?.get?.('llm-pi-ai')
    const providers = section?.providers && typeof section.providers === 'object' ? section.providers : {}
    const dflt = settings?.get?.('agent-default-model')
    let route = typeof dflt?.provider === 'string' && isOpenRouterRoute(dflt.provider, providers[dflt.provider]) ? dflt.provider : ''
    if (!route) route = Object.keys(providers).find(r => isOpenRouterRoute(r, providers[r])) ?? ''
    if (!route) return { ok: false, native: true, message: 'no OpenRouter route is configured under llm-pi-ai' }
    const cfg = providers[route] ?? {}
    const ids = Array.isArray(cfg.models) ? cfg.models.map(m => (typeof m === 'string' ? m : m?.id)).filter(v => typeof v === 'string' && v.length > 0) : []
    const modelId = pickTestModel(ids, route === dflt?.provider ? dflt?.model : '', config.providerNative.testModel)
    if (!modelId) return { ok: false, native: true, message: `route ${route} lists no model to search with (Anthropic ids are skipped: they never answer :online with tools)` }
    const env = typeof cfg.apiKeyEnv === 'string' && cfg.apiKeyEnv ? cfg.apiKeyEnv : 'OPENROUTER_API_KEY'
    let key
    try { key = (await credentials()?.resolve?.(credentialRef(env)))?.value } catch { key = undefined }
    if (!key) return { ok: false, native: true, message: `credential ${env} is not configured` }
    const base = (typeof cfg.baseURL === 'string' && cfg.baseURL ? cfg.baseURL : 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90000)
    try {
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId + ONLINE, messages: [{ role: 'user', content: query || 'deepseek harness' }], max_tokens: 200 }),
        signal: controller.signal,
      })
      const text = await r.text()
      let data = {}
      try { data = JSON.parse(text) } catch { /* the error body below */ }
      if (r.status >= 400) return { ok: false, native: true, model: modelId + ONLINE, message: `HTTP ${r.status}: ${String(data?.error?.message ?? text).slice(0, 300)}` }
      const msg = data?.choices?.[0]?.message ?? {}
      const cites = (Array.isArray(msg.annotations) ? msg.annotations : [])
        .filter(a => a?.type === 'url_citation' && a.url_citation?.url)
        .map(a => ({ url: a.url_citation.url, title: a.url_citation.title ?? '' }))
      return { ok: true, native: true, model: modelId + ONLINE, sources: cites, answer: String(msg.content ?? '').slice(0, 400), cost: data?.usage?.cost ?? null }
    } catch (error) {
      return { ok: false, native: true, model: modelId + ONLINE, message: String(error?.message ?? error) }
    } finally { clearTimeout(timer) }
  }
  ctx.on('agent/request', async (payload, next) => {
    const request = await next()
    const agent = payload?.agent
    if (agent) nativeByAgent.set(agent, false)
    try {
      if (config.mode !== 'provider' || typeof request?.model !== 'string') return request
      // A session that already carries the :online variant (it was chosen or persisted) gets the
      // same Anthropic size rule: an oversized request goes back to the plain model.
      if (request.model.endsWith(ONLINE)) {
        if (!keepsPlainModel(request)) return request
        const plain = request.model.slice(0, -ONLINE.length)
        const key = request.model
        if (!skippedOnce.has(key)) { skippedOnce.add(key); console.log(`[web-search-plus] ${request.model} stripped back to ${plain}: Anthropic models are kept off OpenRouter's web plugin (it never answers them with the harness's tool set); the web_search tool serves instead — set providerNative.anthropicNative=true in web-search.json to opt in`) }
        return { ...request, model: plain }
      }
      const section = ctx.get('settings')?.get?.('llm-pi-ai')
      const routeCfg = section?.providers?.[request.provider]
      if (!isOpenRouterRoute(request.provider, routeCfg)) return request // no native switch on this route: the tool stays
      if (config.providerNative.autoVariant === false) return request
      // OpenRouter's web plugin + an Anthropic model + a large request = no answer, ever (the
      // harness's ~90 tool schemas alone are ~74 KB). Keep the plain model; the tool search serves.
      {
        if (keepsPlainModel(request)) {
          const key = request.model
          if (!skippedOnce.has(key)) { skippedOnce.add(key); console.log(`[web-search-plus] provider-native skipped for ${request.model}: Anthropic models are kept off OpenRouter's web plugin (it never answers them with the harness's tool set); the web_search tool serves instead — set providerNative.anthropicNative=true in web-search.json to opt in`) }
          return request
        }
      }
      if (!(await ensureOnlineVariant(request.provider, request.model))) return request
      if (agent) nativeByAgent.set(agent, true)
      return { ...request, model: request.model + ONLINE }
    } catch (error) {
      console.warn(`[web-search-plus] provider-native rewrite skipped: ${String(error?.message ?? error)}`)
      return request
    }
  })

  // ── inject mode ──
  const isUserTyped = m => m && m.role !== 'assistant' && (m.source === undefined || m.source?.kind === 'user') && Array.isArray(m.content)
  // Delegated sub-agents receive their task prompt as a user-sourced message too; only the top-level conversation searches.
  const isSubagent = agent => agent?.options?.meta?.origin === 'subagent' || agent?.options?.meta?.parentSession !== undefined
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (config.mode !== 'inject' || decision.kind !== 'enter' || decision.messages.length === 0 || isSubagent(payload.agent)) return decision
    // Only the user's own message triggers a search — never plugin context snapshots or tool results.
    let at = -1
    for (let i = decision.messages.length - 1; i >= 0; i--) if (isUserTyped(decision.messages[i])) { at = i; break }
    if (at < 0) return decision
    const userMsg = decision.messages[at]
    const textBlock = userMsg.content.find(b => b.type === 'text')
    if (!textBlock) return decision
    // The one user-written regex runs under a deadline in a worker; everything else is inline.
    // The same string decideTrigger will match against — never the raw message.
    const scanText = normalizeTriggerText(textBlock.text)
    // One snapshot of the whole config, not just the triggers: `loadConfig` may replace it during
    // the await, and a turn must not search with a provider the user has just switched away from,
    // or inject under a mode that is now off.
    const cfg = config
    const triggers = cfg.triggers
    const regexMatch = triggers.regex && scanText !== null
      ? await regexMatcher.match(triggers.regex, 'i', scanText)
      : undefined
    const trigger = decideTrigger(textBlock.text, triggers, { regexMatch })
    if (trigger === null) return decision
    let block = ''
    try {
      const result = await runSearch(trigger.query, cfg.provider, cfg.maxResults, payload.signal)
      let pages = []
      if (cfg.visitLinks > 0) {
        // Visits run concurrently, each bounded by its own timeout, so the step waits for the slowest page only once.
        const visited = await Promise.all(result.sources.slice(0, cfg.visitLinks).map(s => fetchPageText(s.url, { maxChars: cfg.visitChars, blacklist: cfg.blacklist, extractorUrl: cfg.extractorUrl, signal: payload.signal })))
        pages = visited.filter(Boolean)
      }
      block = formatResults(trigger.query, result, { template: cfg.template, budgetChars: cfg.budgetChars, pages })
    } catch (error) {
      console.warn(`[web-search-plus] inject search failed (${trigger.by}: ${trigger.query}): ${String(error?.message ?? error)}`)
      return decision
    }
    await llmReady
    if (createUserMessage === null) {
      // dsh-llm not resolvable (no peer link): fall back to prefixing the user's text so the feature still works.
      if (!fallbackWarned) { fallbackWarned = true; console.warn('[web-search-plus] @deepseek-ai/dsh-llm not resolvable: injecting search results into the user text instead of a separate context message (run launcher/peer-links.mjs)') }
      const content = userMsg.content.map(b => (b === textBlock ? { ...b, text: `${block}\n\n${b.text}` } : b))
      return { kind: 'enter', messages: decision.messages.map((m, i) => (i === at ? { ...m, content } : m)) }
    }
    const injected = createUserMessage({ content: [{ type: 'text', text: block }], source: { kind: 'plugin', plugin: name } })
    return { kind: 'enter', messages: [...decision.messages.slice(0, at + 1), injected, ...decision.messages.slice(at + 1)] }
  })

  // ── HTTP routes for the launcher ──
  const status = async () => {
    const providers = {}
    for (const id of PROVIDER_IDS) providers[id] = { ...PROVIDERS[id], configured: PROVIDERS[id].needsUrl ? config.searxngUrl.length > 0 : await keyConfigured(id) }
    let keyWritable = false
    try { keyWritable = (await credentials()?.describe?.(credentialRef('SERPER_API_KEY')))?.writable === true } catch { /* unknown */ }
    return { config, providers, keyWritable, cacheEntries: cache.size, providerNative: { ready: [...onlineReady], unavailable: [...onlineFailed.keys()] }, fetch: { enabled: config.fetch.enabled, mounted: fetchDisposers.length > 0, hooked: config.fetch.enabled && config.mode !== 'off' && !!(await fetchDeps)[0], missing: fetchMissing, reason: fetchDisposers.length > 0 ? '' : fetchReason } }
  }
  const route = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname
    try {
      if (rejectCrossSite(req)) { req.resume?.(); return json(res, 403, { ok: false, message: 'same-origin JSON requests only' }) }
      if (req.method === 'GET' && p === '/dsh-web-search-plus/status') return json(res, 200, await status())
      if (req.method === 'GET' && p === '/dsh-web-search-plus/dsh-credentials') {
        // The unified "DSH credentials" view: which credentials the harness's own Models page holds, and
        // whether each is configured. Read-only here — search vendors use their own keys; the
        // media and pet panels are where a DSH credential can be borrowed outright.
        const settings = ctx.get('settings')
        const out = []
        if (settings && typeof settings.get === 'function') {
          const dir = ctx.get('llm')?.listConfigurableProviders?.()
          const namespaces = Array.isArray(dir) && dir.length > 0
            ? [...new Set(dir.map(d => d.settingsNs).filter(ns => typeof ns === 'string' && ns.length > 0))]
            : ['llm-pi-ai']
          for (const ns of namespaces) {
            const providers = settings.get(ns)?.providers
            if (!providers || typeof providers !== 'object') continue
            for (const [route, cfg] of Object.entries(providers)) {
              if (!cfg || typeof cfg !== 'object') continue
              if (out.some(existing => existing.route === route)) continue
              const env = typeof cfg.apiKeyEnv === 'string' ? cfg.apiKeyEnv : ''
              let configured = false
              // describe, not resolve: a yes/no view has no business touching the secret's value.
              if (env) { try { configured = (await credentials()?.describe?.(credentialRef(env)))?.configured === true } catch { configured = false } }
              out.push({ route, keyEnv: env, configured })
            }
          }
        }
        return json(res, 200, { ok: true, providers: out })
      }
      if (req.method === 'POST' && p === '/dsh-web-search-plus/test') {
        const body = await readBody(req)
        const providerId = typeof body.provider === 'string' && body.provider ? body.provider : config.provider
        const query = String(body.query ?? '').slice(0, 500)
        const t0 = Date.now()
        if (body.native === true) {
          // The provider-native path: the very request the agent/request hook would make, so a
          // failure here is the failure the chat would see — not the tool source's health.
          const out = await testNative(query)
          return json(res, out.ok ? 200 : 200, { ...out, ms: Date.now() - t0 })
        }
        const result = await searchOnce(providerId, query, config.maxResults)
        return json(res, 200, { ok: true, ms: Date.now() - t0, result, preview: formatResults(query, result, { template: config.template, budgetChars: config.budgetChars }) })
      }
      if (req.method === 'POST' && p === '/dsh-web-search-plus/config') {
        // The one place the deployment is configured: the dsh Settings section and the launcher's
        // Control Deck tab both write this file, and the watcher hot-loads it within 1.5 s.
        const body = await readBody(req)
        const merged = { ...config, ...body }
        const problems = validateConfig(merged)
        if (problems.length > 0) return json(res, 400, { ok: false, message: problems.join('; ') })
        const next = normalizeConfig(merged)
        mkdirSync(dirname(CONFIG_FILE), { recursive: true })
        const tmp = `${CONFIG_FILE}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
        try {
          writeFileSync(tmp, JSON.stringify(next, null, 2))
          renameSync(tmp, CONFIG_FILE)
        } catch (error) {
          try { unlinkSync(tmp) } catch { /* already gone */ }
          throw error
        }
        loadConfig()
        return json(res, 200, { ok: true, ...(await status()) })
      }
      if (req.method === 'POST' && p === '/dsh-web-search-plus/key') {
        const body = await readBody(req)
        const env = PROVIDERS[body.provider]?.keyEnv
        if (!env) return json(res, 400, { ok: false, message: 'provider has no API key' })
        const creds = credentials()
        if (!creds || typeof creds.set !== 'function') return json(res, 503, { ok: false, message: 'credentials service unavailable' })
        const value = String(body.value ?? '')
        if (value.length === 0) await creds.unset(credentialRef(env))
        else await creds.set(credentialRef(env), value)
        return json(res, 200, { ok: true, ...(await status()) })
      }
      res.writeHead(404); res.end()
    } catch (error) {
      const msg = String(error?.message ?? error) + (error?.cause?.code ? ` (${error.cause.code})` : '')
      if (res.headersSent) { console.warn(`[web-search-plus] ${p} failed after the response started: ${msg.slice(0, 200)}`); try { res.end() } catch { /* already closed */ } return }
      json(res, error?.status === 400 || error?.status === 413 ? error.status : 500, { ok: false, message: msg.slice(0, 300) })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-web-search-plus', handler: route }), 'dsh-web-search-plus: routes')
}
