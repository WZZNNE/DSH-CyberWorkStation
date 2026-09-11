/**
 * dsh-credentials-center — every API credential the harness and the suite use, in one list, and
 * the place where dsh's own default model is chosen.
 *
 * What a reference is: the environment-style name a feature stores instead of a secret
 * (`OPENROUTER_API_KEY`, `SERPER_API_KEY`, …). The core credential service keeps the values
 * (`ctx.get('credentials')`: resolve / describe / set / unset — the same store the Models page
 * writes; with dsh-credentials-keyring installed that is the Windows Credential Manager).
 *
 * This plugin only joins two things the owner otherwise has to hunt for feature by feature:
 *   1. which references exist and where they are bound — read from the settings service
 *      (`llm-pi-ai` routes, `llm-deepseek`) and the suite's config files (media-lab, web-search,
 *      desktop-pet, memory-lite), plus the search vendors' fixed names;
 *   2. what the store says about each (configured? from which source? writable?) — and an
 *      owner-given alias / note kept in `$DSH_HOME/credential-aliases.json` (never the value).
 *
 * The default model: `agent-default-model` ({ provider, model }) is the settings namespace the
 * core reads for new sessions. `/models` lists every route of the `llm-*` namespaces with its model
 * ids so a picker can offer route → model; `/default-model` writes the pair through the settings
 * service (revision-checked) after validating it against that list.
 *
 * Routes (loopback + same-origin fence; a non-browser caller such as the launcher passes because
 * it carries a loopback Host, no Origin and a JSON body):
 *   GET  /dsh-credentials-center/list                      → { ok, refs: [...] }
 *   POST /dsh-credentials-center/set    { ref, value }     → store the secret
 *   POST /dsh-credentials-center/unset  { ref }            → remove it
 *   POST /dsh-credentials-center/alias  { ref, alias, note } → label it (an owner-added reference stays listed); { ref, create: true } → list it if absent (never overwrites); { ref, remove: true } → forget it
 *   GET  /dsh-credentials-center/slots?ref=REF             → { ok, ref, activeSlot, slots: [{ id, label, createdAt, configured }] } — spare secrets
 *   POST /dsh-credentials-center/slots/add    { ref, label, value } → store a spare under REF__SLOT_<id>
 *   POST /dsh-credentials-center/slots/keep   { ref, label }        → copy the current secret into a new spare
 *   POST /dsh-credentials-center/slots/use    { ref, id }           → make that spare the secret (the one it replaces is kept as a spare unless it already is one)
 *   POST /dsh-credentials-center/slots/rename { ref, id, label }
 *   POST /dsh-credentials-center/slots/remove { ref, id }
 *   GET  /dsh-credentials-center/models                    → { ok, routes: [{ route, ns, displayName, baseURL, models: [{id,name,fromCatalog?}] }], default }
 *   POST /dsh-credentials-center/default-model { provider, model } → write agent-default-model
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'credentials-center'
export const inject = ['webServer']

const DSH_HOME = resolveDshHome()
const ALIAS_FILE = join(DSH_HOME, 'credential-aliases.json')
const MAX_BODY = 64 * 1024
const REF = /^[A-Z][A-Z0-9_]{1,99}$/
// Spare secrets live in the same store under REF__SLOT_<id>; the list never shows those names.
const SLOT_ID = /^[A-Z0-9]{4,12}$/
const SLOT_SUFFIX = /__SLOT_[A-Z0-9]{4,12}$/
const slotRefOf = (ref, id) => `${ref}__SLOT_${id}`
const newSlotId = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0')
const SLOT_LABEL_MAX = 60
const DEFAULT_NS = 'agent-default-model'

// The search vendors' fixed references (dsh-web-search-plus/lib/providers.js).
const SEARCH_VENDORS = { serper: 'SERPER_API_KEY', serpapi: 'SERPAPI_API_KEY', tavily: 'TAVILY_API_KEY', brave: 'BRAVE_API_KEY' }
// The media adapters' fixed references (dsh-media-lab/lib/adapters.js keyEnv per provider).
const MEDIA_VENDORS = { 'openai-compatible': 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', replicate: 'REPLICATE_API_TOKEN', fal: 'FAL_KEY', 'openai-video': 'OPENAI_API_KEY', veo: 'GEMINI_API_KEY', 'minimax-video': 'MINIMAX_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY', 'fish-audio': 'FISH_AUDIO_API_KEY', minimax: 'MINIMAX_API_KEY', custom: 'MEDIA_LAB_CUSTOM_KEY' }

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }

/** Every reference the deployment points at, with the features bound to it. Pure over its inputs. */
export function collectBindings({ settings, mediaLab, webSearch, pets, memory }) {
  const refs = new Map()
  const bind = (ref, feature, detail) => {
    const key = String(ref ?? '').trim()
    if (!REF.test(key)) return
    const row = refs.get(key) ?? { ref: key, bindings: [] }
    row.bindings.push({ feature, detail })
    refs.set(key, row)
  }
  const get = ns => { try { return typeof settings?.get === 'function' ? settings.get(ns) : undefined } catch { return undefined } }
  const pi = get('llm-pi-ai')
  const providers = pi?.providers && typeof pi.providers === 'object' ? pi.providers : {}
  const ds = get('llm-deepseek')
  /** The credential a route implies: its own apiKeyEnv, else the vendor default the core applies (OpenRouter, DeepSeek official). */
  const envOfRoute = route => {
    const cfg = providers[String(route)]
    if (cfg && typeof cfg === 'object' && typeof cfg.apiKeyEnv === 'string' && cfg.apiKeyEnv) return cfg.apiKeyEnv
    if (route === 'openrouter') return 'OPENROUTER_API_KEY'
    if (route === 'deepseek-official' || route === 'deepseek') return typeof ds?.apiKeyEnv === 'string' && ds.apiKeyEnv ? ds.apiKeyEnv : 'DEEPSEEK_API_KEY'
    return ''
  }
  for (const [route, cfg] of Object.entries(providers)) {
    if (!cfg || typeof cfg !== 'object') continue
    const models = Array.isArray(cfg.models) ? cfg.models.length : 0
    bind(envOfRoute(route), 'model-route', `${route}${cfg.baseURL ? ' · ' + cfg.baseURL : ''}${models ? ` · ${models} ${models === 1 ? 'model' : 'models'}` : ''}`)
  }
  if (ds !== undefined) bind(envOfRoute('deepseek-official'), 'model-route', 'deepseek-official' + (ds?.baseURL ? ' · ' + ds.baseURL : ''))
  if (mediaLab && typeof mediaLab === 'object') {
    for (const kind of ['image', 'video', 'tts', 'stt']) {
      const s = mediaLab[kind]
      if (!s || typeof s !== 'object') continue
      if (s.source === 'harness') {
        const route = String(s.harnessRoute ?? '')
        bind(envOfRoute(route), 'media', `${kind} · borrows route ${route || '?'}`)
        continue
      }
      const env = typeof s.keyEnv === 'string' && s.keyEnv ? s.keyEnv : MEDIA_VENDORS[String(s.provider)] ?? ''
      bind(env, 'media', `${kind} · ${s.provider ?? '?'}${s.enabled === false ? ' (off)' : ''}`)
    }
  }
  if (webSearch && typeof webSearch === 'object') {
    const chosen = String(webSearch.provider ?? '')
    for (const [id, env] of Object.entries(SEARCH_VENDORS)) bind(env, 'web-search', `${id}${id === chosen ? ' (selected)' : ''}`)
    if (chosen === 'deepseek-official') bind('DEEPSEEK_API_KEY', 'web-search', 'deepseek-official (selected)')
  }
  for (const pet of Array.isArray(pets) ? pets : []) {
    const llm = pet?.llm ?? {}
    if (llm.source === 'own') bind(llm.keyEnv || 'DESKTOP_PET_API_KEY', 'desktop-pet', `${pet.id} · own endpoint`)
    if (llm.source === 'harness') bind(envOfRoute(llm.harnessRoute), 'desktop-pet', `${pet.id} · borrows route ${llm.harnessRoute}`)
    if (llm.source === 'follow') bind(envOfRoute(get(DEFAULT_NS)?.provider), 'desktop-pet', `${pet.id} · follows dsh default`)
  }
  if (memory?.embeddings?.enabled === true) bind(memory.embeddings.apiKeyEnv, 'memory-embeddings', String(memory.embeddings.baseURL ?? ''))
  return [...refs.values()]
}

const modelRows = cfg => (Array.isArray(cfg?.models)
  ? cfg.models.map(m => (typeof m === 'string' ? { id: m, name: m } : { id: String(m?.id ?? ''), name: String(m?.name ?? m?.id ?? '') })).filter(m => m.id.length > 0)
  : [])
const routeRow = (route, ns, cfg, displayName) => ({
  route, ns, displayName: displayName || route,
  baseURL: typeof cfg?.baseURL === 'string' ? cfg.baseURL : '',
  keyEnv: typeof cfg?.apiKeyEnv === 'string' ? cfg.apiKeyEnv : '',
  models: modelRows(cfg).slice(0, 600),
})

/**
 * Every configurable route with the model ids its own settings list: first the routes the llm
 * service registers (`listConfigurableProviders()`: provider, displayName, settingsNs and the
 * settingsPath from that namespace's section to the route's profile — empty for DeepSeek's
 * official route, whose whole section is the profile), then every `llm-pi-ai` provider the
 * service did not name. Pure over its inputs; the first entry that names a route wins.
 */
export function listRoutes({ settings, llm }) {
  const get = ns => { try { return typeof settings?.get === 'function' ? settings.get(ns) : undefined } catch { return undefined } }
  const out = []
  const dir = (() => { try { const d = llm?.listConfigurableProviders?.(); return Array.isArray(d) ? d : [] } catch { return [] } })()
  for (const entry of dir) {
    const route = typeof entry?.provider === 'string' ? entry.provider : ''
    const ns = typeof entry?.settingsNs === 'string' ? entry.settingsNs : ''
    if (!route || !ns || out.some(r => r.route === route)) continue
    let cfg = get(ns)
    for (const step of Array.isArray(entry.settingsPath) ? entry.settingsPath : []) cfg = cfg && typeof cfg === 'object' ? cfg[step] : undefined
    if (cfg === undefined) continue   // registered by the adapter, not configured here
    out.push(routeRow(route, ns, cfg && typeof cfg === 'object' ? cfg : {}, entry.displayName))
  }
  const providers = get('llm-pi-ai')?.providers
  if (providers && typeof providers === 'object') {
    for (const [route, cfg] of Object.entries(providers)) {
      if (!cfg || typeof cfg !== 'object' || out.some(r => r.route === route)) continue
      out.push(routeRow(route, 'llm-pi-ai', cfg))
    }
  }
  return out
}

/**
 * The routes with the catalog the llm service advertises for them (`llm.listModels(route)`,
 * async, adapter-owned): ids the route's own list does not carry are appended and marked
 * `fromCatalog`, so a catalog-only route (DeepSeek official, a stock OpenAI route) still offers
 * something to pick. A route whose adapter answers nothing keeps its own list.
 */
export async function routesWithCatalog({ settings, llm }) {
  const routes = listRoutes({ settings, llm })
  if (typeof llm?.listModels !== 'function') return routes
  await Promise.all(routes.map(async r => {
    let catalog = []
    try { catalog = await llm.listModels(r.route) } catch { catalog = [] }
    if (!Array.isArray(catalog)) return
    const seen = new Set(r.models.map(m => m.id))
    for (const m of catalog) {
      const id = typeof m?.id === 'string' ? m.id : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      r.models.push({ id, name: typeof m?.name === 'string' && m.name ? m.name : id, fromCatalog: true })
    }
  }))
  return routes
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  let credentialRef = v => v
  import('@deepseek-ai/dsh-credentials').then(m => { credentialRef = m.credentialRef }).catch(() => { /* identity keeps the ref usable */ })
  const credentials = () => ctx.get('credentials')
  const aliases = () => { const v = readJson(ALIAS_FILE, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} }
  const saveAliases = value => {
    mkdirSync(DSH_HOME, { recursive: true })
    const tmp = ALIAS_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(value, null, 2))
    renameSync(tmp, ALIAS_FILE)
  }

  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let refused = false
    req.on('data', c => { if (refused) return; bytes += c.length; if (bytes > MAX_BODY) { refused = true; chunks.length = 0; reject(Object.assign(new Error('body too large'), { status: 413 })) } else chunks.push(c) })
    req.on('aborted', () => reject(Object.assign(new Error('request aborted'), { status: 400 })))
    req.on('end', () => { try { const text = Buffer.concat(chunks).toString('utf8'); resolve(text ? JSON.parse(text) : {}) } catch { reject(Object.assign(new Error('invalid JSON body'), { status: 400 })) } })
    req.on('error', reject)
  })
  // The suite's fence (dsh-media-lab, dsh-web-search-plus, dsh-desktop-pet carry the same block).
  // A non-browser caller on this machine (the launcher, curl) has a loopback Host, no Origin and a
  // JSON body, so it passes; a page on another origin or a rebinding host does not.
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

  async function list() {
    const rows = collectBindings({
      settings: ctx.get('settings'),
      mediaLab: readJson(join(DSH_HOME, 'media-lab.json'), null),
      webSearch: readJson(join(DSH_HOME, 'web-search.json'), null),
      pets: readJson(join(DSH_HOME, 'desktop-pet.json'), null)?.pets,
      memory: readJson(join(DSH_HOME, 'memory-lite.json'), null),
    })
    const named = aliases()
    // Aliased references that no feature binds any more are still listed: the owner named them.
    for (const ref of Object.keys(named)) if (REF.test(ref) && !SLOT_SUFFIX.test(ref) && !rows.some(r => r.ref === ref)) rows.push({ ref, bindings: [] })
    const store = credentials()
    const out = []
    for (const row of rows.sort((a, b) => a.ref.localeCompare(b.ref))) {
      if (SLOT_SUFFIX.test(row.ref)) continue
      let info = { configured: null, source: '', writable: null, error: '' }
      if (store?.describe) {
        try {
          const d = await store.describe(credentialRef(row.ref))
          info = { configured: d?.configured === true, source: String(d?.source ?? d?.supplier ?? ''), writable: d?.writable !== false, error: '' }
        } catch (error) { info = { configured: null, source: '', writable: null, error: String(error?.message ?? error).slice(0, 120) } }
      } else info.error = 'credentials service unavailable'
      const a = named[row.ref] && typeof named[row.ref] === 'object' ? named[row.ref] : {}
      const slots = Array.isArray(a.slots) ? a.slots.filter(s => s && typeof s === 'object' && SLOT_ID.test(String(s.id ?? ''))) : []
      out.push({ ...row, ...info, alias: typeof a.alias === 'string' ? a.alias : '', note: typeof a.note === 'string' ? a.note : '', slots: slots.length })
    }
    return out
  }

  const currentDefault = () => {
    try { const d = ctx.get('settings')?.get?.(DEFAULT_NS); return { provider: typeof d?.provider === 'string' ? d.provider : '', model: typeof d?.model === 'string' ? d.model : '' } } catch { return { provider: '', model: '' } }
  }

  /** The spare records of one reference: [{ id, label, createdAt }]. */
  const slotMeta = (all, ref) => {
    const a = all[ref] && typeof all[ref] === 'object' ? all[ref] : {}
    return Array.isArray(a.slots) ? a.slots.filter(s => s && typeof s === 'object' && SLOT_ID.test(String(s.id ?? ''))).map(s => ({ id: String(s.id), label: String(s.label ?? '').slice(0, SLOT_LABEL_MAX), createdAt: String(s.createdAt ?? '') })) : []
  }
  /** Re-read the file right before writing, so a save never carries another request's stale view. */
  const saveSlotMeta = (ref, slots) => {
    const all = aliases()
    const a = all[ref] && typeof all[ref] === 'object' ? all[ref] : {}
    all[ref] = { alias: typeof a.alias === 'string' ? a.alias : '', note: typeof a.note === 'string' ? a.note : '', slots }
    saveAliases(all)
  }
  const freshSlotId = slots => { for (;;) { const id = newSlotId(); if (!slots.some(s => s.id === id)) return id } }
  const resolveValue = async (store, name) => { try { return (await store.resolve?.(credentialRef(name)))?.value } catch { return undefined } }
  /** Which spare holds the secret in force — by value, at view time; a hand-set secret matches none. */
  async function activeSlotOf(store, ref, slots, valueOf) {
    const current = await resolveValue(store, ref)
    if (!current) return ''
    for (const s of slots) if ((await valueOf(s.id)) === current) return s.id
    return ''
  }
  async function slotsView(store, ref) {
    const slots = slotMeta(aliases(), ref)
    // One read per spare for the whole view: with the keyring store every read shells out.
    const seen = new Map()
    const valueOf = async id => {
      if (!seen.has(id)) seen.set(id, await resolveValue(store, slotRefOf(ref, id)))
      return seen.get(id)
    }
    const out = []
    for (const s of slots) {
      let configured = null
      if (store?.resolve) configured = (await valueOf(s.id)) !== undefined
      else { try { configured = (await store?.describe?.(credentialRef(slotRefOf(ref, s.id))))?.configured === true } catch { configured = null } }
      out.push({ ...s, configured })
    }
    return { ok: true, ref, activeSlot: store?.resolve ? await activeSlotOf(store, ref, slots, valueOf) : '', slots: out }
  }
  // Every write that touches a reference's secret or its spare records is a read-modify-write across
  // awaits: they run one at a time, in order, so a /set landing inside a /slots/use cannot be lost.
  let slotChain = Promise.resolve()
  const serialized = work => {
    const run = slotChain.then(work, work)
    // A credential store that never answers (a wedged keyring helper) must not block every later
    // write for the life of the process: the chain moves on after a minute, the caller still waits.
    slotChain = Promise.race([run.catch(() => {}), new Promise(resolve => { const t = setTimeout(resolve, 60_000); t.unref?.() })])
    return run
  }
  /** Spare secrets: same store, one extra name per spare; a switch keeps the secret it replaces. */
  async function slotsRoute(req, res, url, p) {
    const store = credentials()
    if (req.method === 'GET' && p === '/dsh-credentials-center/slots') {
      const ref = String(url.searchParams.get('ref') ?? '').trim()
      if (!REF.test(ref) || SLOT_SUFFIX.test(ref)) return json(res, 400, { ok: false, message: 'a reference is an environment-style name: A-Z, digits, underscores' })
      return json(res, 200, await slotsView(store, ref))
    }
    if (req.method !== 'POST') { res.writeHead(405); return res.end() }
    if (!/^\/dsh-credentials-center\/slots\/(add|keep|use|rename|remove)$/.test(p)) return json(res, 404, { ok: false, message: `no such spare-key operation: ${p.split('/').pop()}` })
    const body = await readBody(req)
    const ref = String(body.ref ?? '').trim()
    if (!REF.test(ref) || SLOT_SUFFIX.test(ref)) return json(res, 400, { ok: false, message: 'a reference is an environment-style name: A-Z, digits, underscores' })
    if (!store?.set || !store.unset || !store.resolve) return json(res, 503, { ok: false, message: 'credentials service unavailable' })
    return serialized(async () => {
      const slots = slotMeta(aliases(), ref)
      const label = String(body.label ?? '').trim().slice(0, SLOT_LABEL_MAX)
      const stamp = new Date().toISOString()
      // The highest number ever used, not the count: deleting #2 must not mint a second "spare 3".
      const defaultLabel = () => `spare ${slots.reduce((n, s) => Math.max(n, Number((/^spare (\d+)$/.exec(s.label) ?? [])[1] ?? 0)), slots.length) + 1}`
      if (p === '/dsh-credentials-center/slots/add') {
        const value = typeof body.value === 'string' ? body.value.trim() : ''
        if (!value) return json(res, 400, { ok: false, message: 'empty value' })
        if (slots.length >= 20) return json(res, 400, { ok: false, message: 'at most 20 spares per reference' })
        const id = freshSlotId(slots)
        await store.set(credentialRef(slotRefOf(ref, id)), value)
        saveSlotMeta(ref, [...slots, { id, label: label || defaultLabel(), createdAt: stamp }])
        console.log(`[credentials-center] ${ref}: spare ${id} added`)
        return json(res, 200, { ...(await slotsView(store, ref)), added: id })
      }
      if (p === '/dsh-credentials-center/slots/keep') {
        const current = await resolveValue(store, ref)
        if (!current) return json(res, 409, { ok: false, message: `${ref} has no secret to keep` })
        for (const s of slots) if ((await resolveValue(store, slotRefOf(ref, s.id))) === current) return json(res, 200, { ...(await slotsView(store, ref)), existed: s.id })
        if (slots.length >= 20) return json(res, 400, { ok: false, message: 'at most 20 spares per reference' })
        const id = freshSlotId(slots)
        await store.set(credentialRef(slotRefOf(ref, id)), current)
        saveSlotMeta(ref, [...slots, { id, label: label || `kept ${stamp.slice(0, 16).replace('T', ' ')}`, createdAt: stamp }])
        console.log(`[credentials-center] ${ref}: current secret kept as spare ${id}`)
        return json(res, 200, { ...(await slotsView(store, ref)), added: id })
      }
      const id = String(body.id ?? '').trim().toUpperCase()
      const slot = slots.find(s => s.id === id)
      if (!slot) return json(res, 404, { ok: false, message: 'no such spare' })
      if (p === '/dsh-credentials-center/slots/rename') {
        if (!label) return json(res, 400, { ok: false, message: 'empty label' })
        saveSlotMeta(ref, slots.map(s => (s.id === id ? { ...s, label } : s)))
        return json(res, 200, await slotsView(store, ref))
      }
      if (p === '/dsh-credentials-center/slots/remove') {
        try { await store.unset(credentialRef(slotRefOf(ref, id))) } catch { /* the record may already be gone */ }
        saveSlotMeta(ref, slots.filter(s => s.id !== id))
        console.log(`[credentials-center] ${ref}: spare ${id} removed`)
        return json(res, 200, await slotsView(store, ref))
      }
      if (p === '/dsh-credentials-center/slots/use') {
        let info = null
        try { info = await store.describe(credentialRef(ref)) } catch { info = null }
        if (info && info.writable === false) return json(res, 409, { ok: false, message: `${ref} is read-only here (${info.source || 'set outside the store'}); the spare cannot replace it` })
        const value = await resolveValue(store, slotRefOf(ref, id))
        if (!value) return json(res, 409, { ok: false, message: 'that spare holds no secret any more; remove it and add it again' })
        let current = await resolveValue(store, ref)
        let kept = ''
        let nextSlots = slots
        if (current && current !== value) {
          // Never lose the secret being replaced: it becomes a spare unless it already is one.
          let existing = ''
          for (const s of slots) if ((await resolveValue(store, slotRefOf(ref, s.id))) === current) { existing = s.id; break }
          if (!existing) {
            if (slots.length >= 20) return json(res, 400, { ok: false, message: 'at most 20 spares per reference: the secret in force would need a spare of its own — delete one first' })
            kept = freshSlotId(slots)
            await store.set(credentialRef(slotRefOf(ref, kept)), current)
            nextSlots = [...slots, { id: kept, label: `previous ${stamp.slice(0, 16).replace('T', ' ')}`, createdAt: stamp }]
            saveSlotMeta(ref, nextSlots)
          }
        }
        // Read once more: nothing else can run inside this chain, but the value may have changed
        // between the caller's decision and this write (an env change, another process).
        const atWrite = await resolveValue(store, ref)
        if (atWrite !== current) {
          current = atWrite
          if (current && current !== value && !slots.some(s => s.id === kept)) {
            const extra = freshSlotId(nextSlots)
            await store.set(credentialRef(slotRefOf(ref, extra)), current)
            nextSlots = [...nextSlots, { id: extra, label: `previous ${stamp.slice(0, 16).replace('T', ' ')}`, createdAt: stamp }]
            saveSlotMeta(ref, nextSlots)
          }
        }
        try { await store.set(credentialRef(ref), value) } catch (error) {
          // The main write failed: the copy made a moment ago must not stay behind as an untracked record.
          if (kept) { try { await store.unset(credentialRef(slotRefOf(ref, kept))) } catch { /* best effort */ } saveSlotMeta(ref, slots) }
          return json(res, 500, { ok: false, message: 'could not make the spare the secret in force: ' + String(error?.message ?? error).slice(0, 200) })
        }
        console.log(`[credentials-center] ${ref}: spare ${id} is now the secret${kept ? ` (previous kept as ${kept})` : ''}`)
        return json(res, 200, { ...(await slotsView(store, ref)), kept })
      }
      res.writeHead(404); return res.end()
    })
  }

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const p = url.pathname
    try {
      if (rejectCrossSite(req)) return json(res, 403, { ok: false, message: 'cross-site request refused' })
      if (req.method === 'GET' && p === '/dsh-credentials-center/list') return json(res, 200, { ok: true, refs: await list(), storeAvailable: !!credentials()?.describe })
      if (req.method === 'GET' && p === '/dsh-credentials-center/models') {
        return json(res, 200, { ok: true, routes: await routesWithCatalog({ settings: ctx.get('settings'), llm: ctx.get('llm') }), default: currentDefault() })
      }
      if (req.method === 'POST' && p === '/dsh-credentials-center/default-model') {
        const body = await readBody(req)
        const provider = String(body.provider ?? '').trim()
        const model = String(body.model ?? '').trim()
        if (!provider || !model) return json(res, 400, { ok: false, message: 'provider and model are both required' })
        const settings = ctx.get('settings')
        if (!settings?.describe || !settings.mutate) return json(res, 503, { ok: false, message: 'the settings service is not writable here' })
        const routes = await routesWithCatalog({ settings, llm: ctx.get('llm') })
        const r = routes.find(x => x.route === provider)
        if (!r) return json(res, 400, { ok: false, message: `unknown provider route: ${provider}` })
        const listed = r.models.some(m => m.id === model && m.fromCatalog !== true)
        if (r.models.length > 0 && !r.models.some(m => m.id === model) && body.allowUnlisted !== true) return json(res, 400, { ok: false, message: `${model} is not in the model list of route ${provider}` })
        // Only an llm-pi-ai route has a list of its own to add to; a registered adapter route
        // (deepseek-official) offers a fixed set, and an id outside it fails in the next session.
        if (r.models.length > 0 && !r.models.some(m => m.id === model) && r.ns !== 'llm-pi-ai') return json(res, 400, { ok: false, message: `route ${provider} offers a fixed model set; ${model} is not in it and cannot be added` })
        // A route with an explicit list (llm-pi-ai) rejects ids outside it: an unlisted or catalog-only
        // id is appended to that list first, so the new default actually works in the next session.
        if (!listed && r.ns === 'llm-pi-ai') {
          for (let attempt = 0; attempt < 3; attempt++) {
            const described = settings.describe().find(x => x.ns === 'llm-pi-ai')
            const cfg = described?.user?.providers?.[provider]
            const current = Array.isArray(cfg?.models) ? cfg.models.map(m => (typeof m === 'string' ? { id: m } : { ...m })) : []
            // A catalog-only route (no list of its own) cannot gain an id: pi-ai resolves ids through
            // the catalog there, and an unknown one fails the next session with UNKNOWN_MODEL.
            if (current.length === 0 && !r.models.some(m => m.id === model)) return json(res, 400, { ok: false, message: `route ${provider} has no model list of its own; a catalog-only route cannot gain an id (add a models list to the route first)` })
            if (current.length === 0 || current.some(m => m.id === model)) break
            current.push({ id: model })
            try { await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', provider, 'models'], value: current }], described?.revision); console.log(`[credentials-center] ${model} added to the model list of route ${provider}`); break } catch (error) {
              if (error?.code === 'SETTINGS_CONFLICT' && attempt < 2) continue
              return json(res, 500, { ok: false, message: 'could not add the model to the route list: ' + String(error?.message ?? error).slice(0, 200) })
            }
          }
        }
        for (let attempt = 0; attempt < 3; attempt++) {
          const described = settings.describe().find(x => x.ns === DEFAULT_NS)
          try {
            await settings.mutate(DEFAULT_NS, [{ op: 'set', path: ['provider'], value: provider }, { op: 'set', path: ['model'], value: model }], described?.revision)
            console.log(`[credentials-center] dsh default model set: ${provider} / ${model}`)
            return json(res, 200, { ok: true, default: { provider, model } })
          } catch (error) {
            if (error?.code === 'SETTINGS_CONFLICT' && attempt < 2) continue
            return json(res, 500, { ok: false, message: String(error?.message ?? error).slice(0, 300) })
          }
        }
        return json(res, 409, { ok: false, message: 'the settings namespace stayed contended' })
      }
      if (p === '/dsh-credentials-center/slots' || p.startsWith('/dsh-credentials-center/slots/')) return await slotsRoute(req, res, url, p)
      if (req.method === 'POST' && (p === '/dsh-credentials-center/set' || p === '/dsh-credentials-center/unset' || p === '/dsh-credentials-center/alias')) {
        const body = await readBody(req)
        const ref = String(body.ref ?? '').trim()
        if (!REF.test(ref) || SLOT_SUFFIX.test(ref)) return json(res, 400, { ok: false, message: 'a reference is an environment-style name: A-Z, digits, underscores (spare records are managed through /slots)' })
        if (p.endsWith('/alias')) {
          const all = aliases()
          // A reference the owner added stays listed (even with no alias and no note) until it is
          // removed on purpose: { remove: true }. Clearing the two fields only clears them.
          if (body.remove === true) {
            return serialized(() => {
              const fresh = aliases()
              if (slotMeta(fresh, ref).length > 0) return json(res, 409, { ok: false, message: `${ref} still holds spare keys; delete them first so no secret is left behind in the store` })
              delete fresh[ref]; saveAliases(fresh); return json(res, 200, { ok: true, removed: true })
            })
          }
          // "Add" is create-if-absent: re-adding a listed reference must not wipe its alias and note.
          if (body.create === true) {
            const existed = Object.prototype.hasOwnProperty.call(all, ref) || collectBindings({ settings: ctx.get('settings'), mediaLab: readJson(join(DSH_HOME, 'media-lab.json'), null), webSearch: readJson(join(DSH_HOME, 'web-search.json'), null), pets: readJson(join(DSH_HOME, 'desktop-pet.json'), null)?.pets, memory: readJson(join(DSH_HOME, 'memory-lite.json'), null) }).some(r => r.ref === ref)
            if (!existed) { all[ref] = { alias: '', note: '' }; saveAliases(all) }
            return json(res, 200, { ok: true, existed })
          }
          const alias = String(body.alias ?? '').trim().slice(0, 60)
          const note = String(body.note ?? '').trim().slice(0, 300)
          const kept = all[ref] && typeof all[ref] === 'object' ? all[ref] : {}
          all[ref] = { ...kept, alias, note }
          saveAliases(all)
          return json(res, 200, { ok: true })
        }
        const store = credentials()
        if (!store?.set || !store.unset) return json(res, 503, { ok: false, message: 'credentials service unavailable' })
        return serialized(async () => {
          if (p.endsWith('/set')) {
            const value = typeof body.value === 'string' ? body.value.trim() : ''
            if (!value) return json(res, 400, { ok: false, message: 'empty value' })
            let info = null
            try { info = await store.describe(credentialRef(ref)) } catch { info = null }
            if (info && info.writable === false) return json(res, 409, { ok: false, message: `${ref} is read-only here (${info.source || 'set outside the store'})` })
            await store.set(credentialRef(ref), value)
            console.log(`[credentials-center] ${ref} set`)
            return json(res, 200, { ok: true })
          }
          await store.unset(credentialRef(ref))
          console.log(`[credentials-center] ${ref} removed`)
          return json(res, 200, { ok: true })
        })
      }
      res.writeHead(404); res.end()
    } catch (error) {
      json(res, error?.status === 400 || error?.status === 413 ? error.status : 500, { ok: false, message: String(error?.message ?? error).slice(0, 300) })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-credentials-center', handler: route }), 'credentials-center: routes')
  console.log('[credentials-center] ready')
}
