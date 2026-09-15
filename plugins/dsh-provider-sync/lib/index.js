/**
 * dsh-provider-sync — the OpenRouter model list in `llm-pi-ai` stays current on its own.
 *
 * What it fixes: the list is a snapshot in settings.yaml (hundreds of entries pulled once), so a
 * model released after that day never shows up, and no entry declares `reasoningEfforts` — which
 * is why the reasoning picker answered "does not support reasoning effort" for Claude Opus 5 on
 * OpenRouter although the API accepts `reasoning.effort` for it.
 *
 * How: on boot (once the settings service is up, when the last sync is older than the interval),
 * every `intervalHours`, and on demand, `GET https://openrouter.ai/api/v1/models` (public, no key)
 * is merged into every OpenRouter route of `llm-pi-ai` through the settings service — the same
 * write the Models page makes, validated by the core.
 *
 * Merge rules (mergeRoute, pure):
 *   - a catalog id the route does not list yet is appended (sorted among the new ones); the
 *     owner's existing order is kept;
 *   - name / contextWindow / maxTokens are refreshed only while the field still holds what this
 *     plugin wrote last time (or the catalog value, or nothing) — a hand edit stays;
 *   - a model whose `supported_parameters` include `reasoning` gets the OpenRouter effort ladder
 *     unless a hand-written `reasoningEfforts` exists; a ladder this plugin wrote is repaired or
 *     withdrawn when the catalog changes its mind;
 *   - a `:online` variant follows its base entry;
 *   - every Anthropic id (plain or the `~anthropic/…-latest` aliases, hand-written entries too)
 *     carries a name suffix saying OpenRouter's native web search does not work for them (see
 *     dsh-web-search-plus): the model picker shows it without touching the core UI — the one
 *     case where a hand-written name is touched, and only by appending;
 *   - ids that left the catalog, `compat` and any extra field are never touched.
 *
 * Sources: openrouter.ai/docs/api-reference/list-available-models (fields), openrouter.ai/docs/
 * use-cases/reasoning-tokens (effort values max/xhigh/high/medium/low/minimal/none), the core's
 * llm-pi-ai catalog rules (reasoningEfforts: off may be null = send nothing; every other level
 * names the wire value).
 *
 * Routes (loopback + same-origin fence, the same block every suite router carries):
 *   GET  /dsh-provider-sync/status   — last sync / attempt, interval, per-route counts
 *   POST /dsh-provider-sync/sync     — run now
 *   POST /dsh-provider-sync/settings — { intervalHours?, anthropicNote? } (a bad interval is a 400, never a reset)
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'provider-sync'
export const inject = ['webServer']

const DSH_HOME = resolveDshHome()
const CONFIG_FILE = join(DSH_HOME, 'provider-sync.json')
const CATALOG_URL = 'https://openrouter.ai/api/v1/models'
// OpenRouter speaks the OpenAI chat-completions protocol. Since 0.1.5 pi-ai refuses a route whose `models[]` names
// an id its installed catalog does not describe unless the route declares its `api`, so the sync writes it once.
export const OPENROUTER_API = 'openai-completions'
const NS = 'llm-pi-ai'
const ONLINE = ':online'
// openrouter.ai/docs/use-cases/reasoning-tokens — `none` exists too, but "off" sends nothing at
// all (the core's rule for a null), which every model accepts; `none` does not.
const EFFORTS = Object.freeze({ off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
const MAX_BODY = 16 * 1024
// A failed sync is retried after 5, then 15, then 60 minutes — not every minute (the tick).
const RETRY_LADDER_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]
/** Shown in the model picker after the catalog name of every Anthropic id (dsh-web-search-plus keeps them off :online). */
const ANTHROPIC_NOTE = '【claude系模型不可走openrouter原生api搜索,建议自己配置api】'
// Plain ids and the `~anthropic/…-latest` alias ids OpenRouter accepts are both Anthropic.
const ANTHROPIC_ID = new RegExp('^~?anthropic/', 'i')

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }
const writeJson = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2)) }

function normalizeConfig(raw) {
  const c = raw !== null && typeof raw === 'object' ? raw : {}
  const hours = Number(c.intervalHours)
  return {
    intervalHours: Number.isFinite(hours) && hours >= 1 && hours <= 720 ? Math.floor(hours) : 24,
    lastSyncAt: typeof c.lastSyncAt === 'string' ? c.lastSyncAt : '',
    lastAttemptAt: typeof c.lastAttemptAt === 'string' ? c.lastAttemptAt : '',
    failures: Number.isInteger(c.failures) && c.failures > 0 ? c.failures : 0,
    // The Claude note in Anthropic model names (see ANTHROPIC_NOTE); off strips it on the next sync.
    anthropicNote: c.anthropicNote !== false,
    routes: c.routes !== null && typeof c.routes === 'object' ? c.routes : {},
    // ids whose reasoningEfforts THIS plugin wrote: only those may be rewritten on the next sync.
    autoEfforts: Array.isArray(c.autoEfforts) ? c.autoEfforts.filter(v => typeof v === 'string') : [],
    // per id, the name / contextWindow / maxTokens this plugin wrote last: a field that still holds
    // that value (or nothing) may be refreshed; any other value is a hand edit and stays.
    written: c.written !== null && typeof c.written === 'object' ? c.written : {},
  }
}

/** OpenRouter is recognised by its host; the bare route name counts only when no baseURL is set. */
function isOpenRouterRoute(route, cfg) {
  const host = (() => { try { return new URL(String(cfg?.baseURL ?? '')).hostname } catch { return '' } })()
  if (host) return /(^|\.)openrouter\.ai$/i.test(host)
  return route === 'openrouter'
}

/** A name without the note (and without the doubled space it leaves). */
function stripNote(name) {
  return String(name ?? '').split(ANTHROPIC_NOTE).join('').replace(/\s{2,}/g, ' ').trim()
}
/** The name this plugin gives a catalog entry: the catalog name, (online) for variants, the Anthropic note when on. */
function displayName(cat, isVariant, withNote = true) {
  let n = isVariant ? cat.name + ' (online)' : cat.name
  if (withNote && ANTHROPIC_ID.test(cat.id)) n += ' ' + ANTHROPIC_NOTE
  return n
}

/**
 * Merge the catalog into one route's user-layer model list. Pure: returns the new list and counts.
 * `state` = { autoEfforts: string[], written: { [id]: { name, contextWindow, maxTokens } } }.
 */
function mergeRoute(models, catalog, state = {}) {
  const list = models.map(m => (typeof m === 'string' ? { id: m } : { ...m }))
  const seen = new Set(list.map(m => m.id))
  const auto = new Set(Array.isArray(state.autoEfforts) ? state.autoEfforts : [])
  const written = { ...(state.written && typeof state.written === 'object' ? state.written : {}) }
  const withNote = state.anthropicNote !== false
  const changed = new Set()
  let added = 0, reasoning = 0, noted = 0
  const applyCatalog = (entry, cat, isVariant) => {
    let changed = false
    const mine = written[entry.id] ?? {}
    const wanted = { name: displayName(cat, isVariant, withNote), contextWindow: cat.contextWindow, maxTokens: cat.maxTokens }
    const catalogValue = { name: isVariant ? cat.name + ' (online)' : cat.name, contextWindow: cat.contextWindow, maxTokens: cat.maxTokens }
    const next = { ...mine }
    for (const k of ['name', 'contextWindow', 'maxTokens']) {
      const v = wanted[k]
      if (v === undefined) continue
      const current = entry[k]
      // Refreshable: absent, what we wrote last time, or the bare catalog value (a list synced by an
      // older version that kept no record). Anything else is the owner's and stays.
      const ours = current === undefined || current === mine[k] || current === catalogValue[k] || current === wanted[k]
      if (!ours) continue
      if (current !== v) { entry[k] = v; changed = true }
      next[k] = v
    }
    written[entry.id] = next
    if (cat.reasoning) {
      reasoning++
      // Hand-written efforts stay; only an absent map, or one this plugin wrote, is (re)written.
      if (entry.reasoningEfforts === undefined || auto.has(entry.id)) {
        const ladder = { ...EFFORTS }
        if (JSON.stringify(entry.reasoningEfforts) !== JSON.stringify(ladder)) { entry.reasoningEfforts = ladder; changed = true }
        auto.add(entry.id)
      }
    } else if (auto.has(entry.id)) {
      // The catalog no longer says it reasons: take back what we wrote, never a hand-written map.
      delete entry.reasoningEfforts
      auto.delete(entry.id)
      changed = true
    }
    return changed
  }
  for (const entry of list) {
    const base = entry.id.endsWith(ONLINE) ? entry.id.slice(0, -ONLINE.length) : entry.id
    const cat = catalog.get(entry.id) ?? (entry.id.endsWith(ONLINE) ? catalog.get(base) : undefined)
    if (!cat) continue
    if (applyCatalog(entry, cat, entry.id.endsWith(ONLINE))) changed.add(entry.id)
  }
  const fresh = []
  for (const cat of catalog.values()) {
    if (seen.has(cat.id)) continue
    const entry = { id: cat.id, name: displayName(cat, false, withNote) }
    if (cat.contextWindow) entry.contextWindow = cat.contextWindow
    if (cat.maxTokens) entry.maxTokens = cat.maxTokens
    if (cat.reasoning) { entry.reasoningEfforts = { ...EFFORTS }; auto.add(cat.id); reasoning++ }
    written[cat.id] = { name: entry.name, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens }
    fresh.push(entry)
    seen.add(cat.id)
    added++
  }
  // The one exception to "a hand-written name stays": every Anthropic entry — hand-written alias
  // ids included — carries the note, appended to whatever name it has (nothing else is touched);
  // with the switch off the note is taken back from every name that carries it.
  for (const entry of list) {
    if (!ANTHROPIC_ID.test(String(entry.id))) continue
    const current = typeof entry.name === 'string' && entry.name ? entry.name : String(entry.id)
    if (withNote && !current.includes(ANTHROPIC_NOTE)) { entry.name = current + ' ' + ANTHROPIC_NOTE; noted++; changed.add(entry.id) }
    if (!withNote && current.includes(ANTHROPIC_NOTE)) { entry.name = stripNote(current); changed.add(entry.id) }
  }
  fresh.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return { list: [...list, ...fresh], added, updated: changed.size, noted, reasoning, autoEfforts: [...auto], written }
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  let config = normalizeConfig(readJson(CONFIG_FILE, null))
  let running = null
  let lastError = ''
  const save = () => { try { writeJson(CONFIG_FILE, config) } catch (error) { console.warn(`[provider-sync] config not saved: ${String(error?.message ?? error)}`) } }

  async function fetchCatalog(fetchImpl = fetch) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000)
    try {
      const r = await fetchImpl(CATALOG_URL, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      const list = Array.isArray(data?.data) ? data.data : []
      const byId = new Map()
      for (const m of list) {
        if (typeof m?.id !== 'string' || !m.id) continue
        const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : []
        byId.set(m.id, {
          id: m.id,
          name: typeof m.name === 'string' ? m.name : m.id,
          contextWindow: Number(m.context_length) > 0 ? Number(m.context_length) : undefined,
          maxTokens: Number(m?.top_provider?.max_completion_tokens) > 0 ? Number(m.top_provider.max_completion_tokens) : undefined,
          reasoning: params.includes('reasoning'),
        })
      }
      return byId
    } finally { clearTimeout(timer) }
  }

  async function syncOnce(reason) {
    if (running) return running
    running = (async () => {
      config = { ...config, lastAttemptAt: new Date().toISOString() }
      const settings = ctx.get('settings')
      if (!settings?.describe || !settings.mutate) throw new Error('the settings service is not writable here')
      const catalog = await fetchCatalog()
      if (catalog.size === 0) throw new Error('the catalog answered with no models')
      const routesDone = {}
      let state = { autoEfforts: config.autoEfforts, written: config.written, anthropicNote: config.anthropicNote }
      for (let attempt = 0; attempt < 3; attempt++) {
        const described = settings.describe().find(x => x.ns === NS)
        const user = described?.user && typeof described.user === 'object' ? described.user : {}
        const providers = user.providers && typeof user.providers === 'object' ? user.providers : {}
        const ops = []
        state = { autoEfforts: config.autoEfforts, written: config.written, anthropicNote: config.anthropicNote }
        for (const [route, cfg] of Object.entries(providers)) {
          if (!isOpenRouterRoute(route, cfg)) continue
          const models = Array.isArray(cfg?.models) ? cfg.models : []
          if (models.length === 0) continue   // a catalog-only route lists nothing of its own: nothing to keep current
          const merged = mergeRoute(models, catalog, state)
          state = { autoEfforts: merged.autoEfforts, written: merged.written, anthropicNote: config.anthropicNote }
          routesDone[route] = { models: merged.list.length, added: merged.added, updated: merged.updated, noted: merged.noted, reasoning: merged.reasoning, at: new Date().toISOString() }
          if (merged.added > 0 || merged.updated > 0) ops.push({ op: 'set', path: ['providers', route, 'models'], value: merged.list })
          // the resolved value (user over base layer) decides: a protocol composed in the base layer is left alone
          const resolvedApi = described?.value?.providers?.[route]?.api ?? cfg?.api
          if (resolvedApi === undefined && merged.list.length > 0) ops.push({ op: 'set', path: ['providers', route, 'api'], value: OPENROUTER_API })
        }
        if (ops.length === 0) break
        try {
          await settings.mutate(NS, ops, described?.revision)
          break
        } catch (error) {
          if (error?.code === 'SETTINGS_CONFLICT' && attempt < 2) continue
          throw error
        }
      }
      // The record is this run's, route by route: a route that left the settings leaves the record.
      config = { ...config, lastSyncAt: new Date().toISOString(), failures: 0, routes: routesDone, autoEfforts: state.autoEfforts, written: state.written }
      save()
      lastError = ''
      const summary = Object.entries(routesDone).map(([r, v]) => `${r}: ${v.models} models (+${v.added} new, ${v.updated} changed of which ${v.noted} Claude notes, ${v.reasoning} with reasoning)`).join('; ')
      console.log(`[provider-sync] ${reason}: ${summary || 'no OpenRouter route with its own model list'}`)
      return routesDone
    })().catch(error => {
      lastError = String(error?.message ?? error)
      config = { ...config, failures: config.failures + 1 }
      save()   // the attempt time and the failure count: a failing sync backs off 5 → 15 → 60 min
      console.warn(`[provider-sync] ${reason} failed: ${lastError}`)
      throw error
    }).finally(() => { running = null })
    return running
  }

  // Boot: wait for the settings service, then sync when the last one is older than the interval.
  let booted = false
  const tick = () => {
    if (!booted) {
      if (!ctx.get('settings')?.mutate) return
      booted = true
    }
    const now = Date.now()
    const due = !config.lastSyncAt || now - Date.parse(config.lastSyncAt) > config.intervalHours * 3600000
    const wait = RETRY_LADDER_MS[Math.min(config.failures, RETRY_LADDER_MS.length) - 1] ?? 0
    const backoff = config.failures > 0 && config.lastAttemptAt && now - Date.parse(config.lastAttemptAt) < wait
    if (due && !backoff) void syncOnce('scheduled sync').catch(() => {})
  }
  const timer = setInterval(tick, 60000)
  timer.unref?.()
  setTimeout(tick, 8000).unref?.()
  ctx.effect(() => () => clearInterval(timer), 'provider-sync: schedule')

  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    req.on('data', c => { bytes += c.length; if (bytes > MAX_BODY) reject(Object.assign(new Error('body too large'), { status: 413 })); else chunks.push(c) })
    req.on('end', () => { try { const text = Buffer.concat(chunks).toString('utf8'); resolve(text ? JSON.parse(text) : {}) } catch { reject(Object.assign(new Error('invalid JSON body'), { status: 400 })) } })
    req.on('error', reject)
  })
  // The suite's fence (dsh-media-lab, dsh-web-search-plus, dsh-desktop-pet carry the same block).
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  const hostOf = req => { const h = String(req.headers.host ?? '').trim().toLowerCase(); const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h); return m ? `[${m[1]}]` : h.replace(/:\d+$/, '') }
  const rejectCrossSite = req => {
    if (!LOOPBACK_HOSTS.has(hostOf(req))) return true
    const site = String(req.headers['sec-fetch-site'] ?? '')
    if (site === 'cross-site' || site === 'same-site') return true
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin.length > 0) {
      try { if (new URL(origin).host.toLowerCase() !== String(req.headers.host ?? '').toLowerCase()) return true } catch { return true }
    }
    if (req.method === 'POST' && !/^application\/json/i.test(String(req.headers['content-type'] ?? ''))) return true
    return false
  }
  const status = () => ({ ok: true, intervalHours: config.intervalHours, anthropicNote: config.anthropicNote, lastSyncAt: config.lastSyncAt, lastAttemptAt: config.lastAttemptAt, failures: config.failures, running: running !== null, lastError, routes: config.routes, catalogUrl: CATALOG_URL })

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const p = url.pathname
    try {
      if (rejectCrossSite(req)) return json(res, 403, { ok: false, message: 'cross-site request refused' })
      if (req.method === 'GET' && p === '/dsh-provider-sync/status') return json(res, 200, status())
      if (req.method === 'POST' && p === '/dsh-provider-sync/sync') {
        try { await syncOnce('manual sync') } catch (error) { return json(res, 200, { ...status(), ok: false, message: String(error?.message ?? error) }) }
        return json(res, 200, status())
      }
      if (req.method === 'POST' && p === '/dsh-provider-sync/settings') {
        const body = await readBody(req)
        // Only the interval and the note switch are the owner's to set; the rest is the plugin's record.
        const next = { ...config }
        if (body.intervalHours !== undefined) {
          const hours = body.intervalHours
          if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 720) return json(res, 400, { ok: false, message: 'intervalHours must be a whole number of hours between 1 and 720' })
          next.intervalHours = hours
        }
        if (body.anthropicNote !== undefined) {
          if (typeof body.anthropicNote !== 'boolean') return json(res, 400, { ok: false, message: 'anthropicNote must be true or false' })
          next.anthropicNote = body.anthropicNote
        }
        config = normalizeConfig(next)
        save()
        return json(res, 200, status())
      }
      res.writeHead(404); res.end()
    } catch (error) {
      json(res, error?.status === 400 || error?.status === 413 ? error.status : 500, { ok: false, message: String(error?.message ?? error).slice(0, 300) })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-provider-sync', handler: route }), 'provider-sync: routes')
  console.log(`[provider-sync] every ${config.intervalHours}h, last ${config.lastSyncAt || 'never'}`)
}

export { mergeRoute, isOpenRouterRoute, displayName, stripNote, normalizeConfig, EFFORTS, ANTHROPIC_NOTE }
