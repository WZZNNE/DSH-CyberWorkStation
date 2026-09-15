/**
 * dsh-memory-lite host plugin — memory across compaction and across sessions, plus a view
 * of every session's current compaction summary that the user can edit.
 *
 * What it does (config `$DSH_HOME/memory-lite.json`, hot-reloaded):
 *  - deposit : every `compaction/summary` the core lands for a top-level session is stored
 *              (latest per session) as a `summary` memory item;
 *  - extract : every N human turns the session's own routed model is asked for durable
 *              facts (preferences, conventions, commitments) → `fact` items;
 *  - recall  : BM25 over ASCII words + CJK bigrams (optional cosine blend through a local
 *              OpenAI-compatible /v1/embeddings endpoint), scoped global / workspace;
 *  - inject  : at `agent/pre-step`, pinned + relevant items go in as ONE separate
 *              plugin-sourced context message after the user's message (first turn),
 *              relevant-only later, each item at most once per session; the user's words
 *              are never rewritten (same pattern as dsh-time-context / web-search-plus);
 *  - tools   : `memory_recall` / `memory_note` for the model;
 *  - context : `/dsh-memory-lite/session*` lists sessions, shows the active checkpoint(s),
 *              compaction history and pressure, and lets the user EDIT the active summary.
 *              An edit is written as a genuine compaction bracket (`compaction/start` →
 *              `compaction/summary` → checkpoint replace → `compaction/end`, `turn: null`)
 *              under `agent.runMaintenance`, which is the only shape the session surface,
 *              the token meter's shadow-price protocol and the compaction invariant accept.
 *              Cold sessions are resumed, edited, flushed and disposed again.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { inboxHasPending, listStoredSessions, liveEvents, readStoredSession, recordSourceExtras, statStoredSession } from '@dsh-suite/kit/session-read'
import { readFileSync, writeFileSync, mkdirSync, watchFile, unwatchFile } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeConfig, validateConfig, minimalConfig } from './config.js'
import { MemoryStore, KINDS, SCOPES, MAX_SUMMARY_TEXT } from './store.js'
import { rank, visibleIn, buildIndex } from './recall.js'
import { EXTRACTION_INSTRUCTION, parseFacts, dedupeFacts } from './extract.js'
import { embedTexts } from './embeddings.js'
import * as C from './context.js'
import { rejectCrossSite, json, readBody as kitReadBody } from '@dsh-suite/kit/fence'

export const name = 'memory-lite'
export const inject = ['sessions', 'agents', 'llm', 'tools', 'systemPrompt']

const DSH_HOME = resolveDshHome()
const CONFIG_FILE = join(DSH_HOME, 'memory-lite.json')
const MEMORY_DIR = join(DSH_HOME, 'memory')
const MAX_BODY = 256 * 1024
const readBody = (req, limit = MAX_BODY) => kitReadBody(req, limit)
const MAX_IMPORT_BODY = 8 * 1024 * 1024
const MAX_SUMMARY_CHARS = 60000
const LIST_INSPECT_BUDGET = 25
const LIST_INSPECT_MS = 4000
const EXTRACT_MAX_TOKENS = 700
const EXTRACT_TIMEOUT_MS = 90000
const COMPACT_TIMEOUT_MS = 240000
/** Session ids: the JSONL backend encodes any id, so only path separators, whitespace and absurd lengths are refused. */
const SESSION_ID = /^[^\s/\\]{1,200}$/

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  // ── optional core modules (resolved through the suite's peer links; features degrade with a clear message) ──
  const peers = { llm: null, compaction: null, session: null, tools: null, credentials: null }
  const ready = Promise.all([
    import('@deepseek-ai/dsh-llm').then(m => { peers.llm = m }).catch(() => {}),
    import('@deepseek-ai/dsh-compaction').then(m => { peers.compaction = m }).catch(() => {}),
    import('@deepseek-ai/dsh-session').then(m => { peers.session = m }).catch(() => {}),
    import('@deepseek-ai/dsh-tools').then(m => { peers.tools = m }).catch(() => {}),
    import('@deepseek-ai/dsh-credentials').then(m => { peers.credentials = m }).catch(() => {}),
  ])
  const peerState = () => ({ llm: !!peers.llm?.createUserMessage, compaction: !!peers.compaction?.compactCheckpointSource, session: !!peers.session?.foldSurface, tools: !!peers.tools?.defineTool })

  // ── config + store ──
  let config = normalizeConfig(null)
  const store = new MemoryStore(MEMORY_DIR)
  let toolsDisposer = null
  let promptDisposer = null
  const log = (level, msg) => { (level === 'warn' ? console.warn : console.log)(`[memory-lite] ${msg}`) }
  if (store.loadError) log('warn', `memory.json could not be loaded (${store.loadErrorKind}: ${store.loadError}); starting empty — the next write merges the file if it parses by then, moves it aside if it is unparsable, and is refused while it cannot be read`)
  /** Save the store and embed whatever a save-time merge of an external write brought in. */
  const persist = () => { store.save(); if (store.mergedIds.length) { log('info', `merged ${store.mergedIds.length} externally written item(s)`); scheduleEmbed(store.mergedIds.splice(0)); void reconcileSources() } }
  const uncheckedSources = new Set()
  let reconcileReady = Promise.resolve()
  const available = item => !C.staleItem(item) && !(C.automaticItem(item) && uncheckedSources.has(item.sessionId))
  // Resolve legacy provenance before anything can recall it. Unreadable sources remain visible
  // in the manager but are withheld from the model until an explicit refresh can verify them.
  function reconcileSources() {
    // Migrate v5 metadata before a later prune can remove its only copy.
    let migrated = false
    for (const item of store.items) {
      if (store.withdrawals[item.id]) continue
      const legacy = C.staleItem(item) ? { revision: item.meta.staleAfterEdit, sourceEditSeq: item.meta.staleAfterEdit, text: item.text.slice(0, 500) }
        : item.meta?.withdrawnRecall ? { ...item.meta.withdrawnRecall, text: item.meta.withdrawnRecall.text.slice(0, 500), correctedText: item.text.slice(0, 4000) } : null
      if (legacy) { store.withdrawals[item.id] = legacy; migrated = true }
    }
    for (const item of store.items) if (C.automaticItem(item)) uncheckedSources.add(item.sessionId)
    store.version++
    reconcileReady = reconcileReady.then(async () => {
      let changed = migrated || store.withdrawalsDirty
      for (const id of [...uncheckedSources]) {
        try {
          const live = ctx.sessions.get(id)
          const events = live ? liveEvents(live) : (await readStoredSession(persistence(), id)).events
          if (!Array.isArray(events)) throw new Error('source session is unavailable')
          changed = C.invalidateSource(store, id, C.chatEditRevision(events)) || changed
          uncheckedSources.delete(id)
        } catch (error) { log('warn', `automatic memory from ${id || '(unknown source)'} is withheld: ${String(error?.message ?? error)}`) }
      }
      store.version++
      if (changed) { persist(); log('info', 'withdrawn automatic memories from edited source sessions; records and pins were retained for review') }
    }).catch(error => log('warn', `source reconciliation failed: ${String(error?.message ?? error)}`))
    return reconcileReady
  }

  const loadConfig = () => {
    let raw = null
    try { raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) } catch { /* missing = defaults */ }
    const next = normalizeConfig(raw)
    const toolsChanged = next.tools !== config.tools || next.enabled !== config.enabled
    config = next
    if (!config.embeddings.enabled && store.vectors.model !== '') store.resetVectors('')
    else if (config.embeddings.enabled && store.vectors.model !== config.embeddings.model) store.resetVectors(config.embeddings.model)
    if (toolsChanged || toolsDisposer === null) registerTools()
    registerPrompt()
    log('info', `enabled=${config.enabled} inject=${config.inject} extract=${config.extractFacts} tools=${config.tools} embeddings=${config.embeddings.enabled ? config.embeddings.model : 'off'}`)
  }
  // only the values that differ from the defaults are written, so a later default change still reaches this deployment
  const saveConfigFile = cfg => { mkdirSync(dirname(CONFIG_FILE), { recursive: true }); writeFileSync(CONFIG_FILE, JSON.stringify(minimalConfig(cfg), null, 2)) }

  // ── helpers ──
  const persistence = () => ctx.get('sessionPersistence')
  const tokenMeter = () => ctx.get('tokenMeter')
  /**
   * The compaction engine of one agent. In the web profile the engine rows are disabled on the
   * host plane and mounted inside the agent preset's `isolate` realm (packages/preset/agent-presets/presets/<preset>/agent.cordis.yml since 0.1.2),
   * so it is read through `agentPresets.serviceFor(agent, 'compaction')`; a rosterless deployment keeps it on the host.
   */
  const presetsService = () => ctx.get('agentPresets')
  const engineFor = agent => {
    const ps = presetsService()
    let viaPreset
    try { viaPreset = ps && typeof ps.serviceFor === 'function' && agent ? ps.serviceFor(agent, 'compaction') : undefined } catch { viaPreset = undefined }
    return viaPreset ?? ctx.get('compaction')
  }
  /** Resume-time setup that mounts the preset the session's log recorded (the way the web UI's cold resume does). */
  async function resumeSetupFor(header, events) {
    const ps = presetsService()
    if (!ps || typeof ps.mount !== 'function') return undefined
    // the same rule as dsh-agent-presets resolveSessionPreset: the last `agent-preset/selected` event wins, else the header value
    let stored = header?.agentPreset
    for (let i = events.length - 1; i >= 0; i--) { const e = events[i]; if (e?.type === 'agent-preset/selected' && typeof e.data?.agentPreset === 'string') { stored = e.data.agentPreset; break } }
    let resolved
    try { resolved = await ps.resolve(stored) } catch (error) { throw fail(409, `the preset this session recorded (${stored ?? 'default'}) cannot be composed: ${String(error?.message ?? error).slice(0, 200)}`) }
    return async agentCtx => { await ps.mount(agentCtx, resolved.id) }
  }
  const isSubagentSession = header => header?.origin === 'subagent'
  const isSubagent = agent => isSubagentSession(agent?.session?.header)
  const cwdOf = session => (typeof session?.header?.cwd === 'string' ? session.header.cwd : '')
  const isUserTyped = m => m && m.role !== 'assistant' && (m.source === undefined || m.source?.kind === 'user') && Array.isArray(m.content)
  const fail = (status, message) => Object.assign(new Error(message), { status })

  async function apiKey(env) {
    if (!env) return undefined
    try {
      const creds = ctx.get('credentials')
      const ref = peers.credentials?.credentialRef ? peers.credentials.credentialRef(env) : env
      return (await creds?.resolve?.(ref))?.value
    } catch { return undefined }
  }

  /** Routed provider/model of a session (latest request), falling back to the agent options, then the deployment default. */
  const routedTarget = (session, agent) => {
    const cfg = session?.requestHeader?.()?.config
    if (cfg && cfg.provider && cfg.model) return { provider: cfg.provider, model: cfg.model }
    if (agent?.options?.provider && agent?.options?.model) return { provider: agent.options.provider, model: agent.options.model }
    const sel = ctx.get('agentDefaultModel')?.currentSelection?.()
    return sel && sel.provider && sel.model ? { provider: sel.provider, model: sel.model } : null
  }
  const defaultAgentOptions = () => {
    const sel = ctx.get('agentDefaultModel')?.currentSelection?.()
    return sel && sel.provider && sel.model ? { provider: sel.provider, model: sel.model } : {}
  }

  // ── embeddings (best effort, never blocks the conversation) ──
  let embedQueue = Promise.resolve()
  const vectorsFor = () => (config.embeddings.enabled && store.vectors.model === config.embeddings.model ? new Map(Object.entries(store.vectors.byId)) : undefined)
  function scheduleEmbed(ids) {
    if (!config.embeddings.enabled || ids.length === 0) return
    embedQueue = embedQueue.then(async () => {
      const items = ids.map(id => store.get(id)).filter(i => i && !store.vectors.byId[i.id])
      if (items.length === 0) return
      try {
        const vectors = await embedTexts(config.embeddings, items.map(i => i.text), { apiKey: await apiKey(config.embeddings.apiKeyEnv) })
        if (store.vectors.model !== config.embeddings.model) store.resetVectors(config.embeddings.model)
        items.forEach((item, i) => { store.vectors.byId[item.id] = vectors[i] })
        store.saveVectors()
      } catch (error) { log('warn', `embeddings failed: ${String(error?.message ?? error)}`) }
    }).catch(() => {})
  }
  const QUERY_EMBED_TIMEOUT_MS = 2500
  async function queryVector(text) {
    if (!config.embeddings.enabled || !config.embeddings.model) return null
    try { return (await embedTexts(config.embeddings, [text], { apiKey: await apiKey(config.embeddings.apiKeyEnv), timeoutMs: QUERY_EMBED_TIMEOUT_MS }))[0] ?? null } catch { return null }
  }

  // ── recall ──
  let indexCache = { version: -1, index: null }
  const lexicalIndex = () => { if (indexCache.version !== store.version) indexCache = { version: store.version, index: buildIndex(store.items.filter(available)) }; return indexCache.index }
  function recall(query, { cwd, topK, strict, qv } = {}) {
    const candidates = store.items.filter(i => available(i) && visibleIn(i, cwd))
    return rank(candidates, query, { topK: topK ?? config.topK, cwd, strict, vectors: vectorsFor(), queryVector: qv ?? null, index: lexicalIndex() })
  }
  const fmtDate = ts => new Date(ts).toISOString().slice(0, 10)
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
  function formatInjection(picks) {
    const lines = ['[Memory recall] Items saved from earlier sessions of this deployment (source: compaction summary / extracted fact / note by the user or the assistant). Use them only when relevant to the current request; do not restate or acknowledge them.']
    let chars = lines[0].length
    const used = []
    for (const { item } of picks) {
      const head = `- (${item.id} · ${item.kind} · ${item.source}${item.pinned ? ' · pinned' : ''} · ${fmtDate(item.createdAt)}) `
      // summaries keep their section structure (the core's checkpoint is Markdown); facts and notes are one line
      const body = item.kind === 'summary'
        ? clip(item.text.replace(/\n{3,}/g, '\n\n').trim(), config.summaryChars).replace(/\n/g, '\n  ')
        : clip(item.text.replace(/\s+/g, ' '), config.itemChars)
      const line = head + body
      if (chars + line.length + 1 > config.maxInjectChars) break
      lines.push(line)
      chars += line.length + 1
      used.push(item.id)
    }
    return { text: lines.join('\n'), used }
  }

  // ── deposit compaction summaries ──
  ctx.on('session/event', (session, event) => {
    try {
      if (C.isChatEdit(event) && C.invalidateSource(store, session.id, event.seq)) persist()
      if (!config.enabled || !config.depositSummaries || event.type !== 'compaction/summary') return
      if (event.data?.provider === C.EDIT_PROVIDER) return
      if (isSubagentSession(session.header)) return
      const text = C.textOf(event.data.summary).trim()
      if (!text) return
      if (text.length > MAX_SUMMARY_TEXT) log('warn', `compaction summary of ${session.id} is ${text.length} chars; the store keeps the first ${MAX_SUMMARY_TEXT}`)
      const cwd = cwdOf(session)
      const item = store.replaceSessionSummary(session.id, { text, cwd, scope: cwd ? 'workspace' : 'global', source: 'compaction', meta: { provider: event.data.provider, model: event.data.model, shadowedTokenCount: event.data.shadowedTokenCount, summarySeq: event.seq, sourceRevision: C.replacementRevision(liveEvents(session)) } })
      store.prune(config.maxItems)
      persist()
      scheduleEmbed([item.id])
      log('info', `stored compaction summary of ${session.id} (${text.length} chars)`)
    } catch (error) { log('warn', `deposit failed: ${String(error?.message ?? error)}`) }
  })

  // ── fact extraction (background, after a turn, every N human turns) ──
  const extracting = new Set()
  /** Sessions that finished a human turn in THIS process: extraction never runs just because a session was opened or resumed. */
  const turnEnded = new Set()
  /** Agents this plugin resumed for maintenance (edit / compact): no extraction, no injection for them. */
  const maintenanceAgents = new Set()
  /** Maintenance agents that were adopted by a user mid-job; disposed with the plugin. */
  const adoptedHandles = []
  ctx.on('session/event', (session, event) => { if (event.type === 'turn/end') turnEnded.add(session.id) })
  async function extractFacts(agent) {
    const session = agent.session
    const id = session.id
    if (extracting.has(id) || maintenanceAgents.has(id) || !turnEnded.has(id)) return
    turnEnded.delete(id)
    extracting.add(id)
    try {
    await reconcileReady
    await ready
    const events = liveEvents(session)
    const sourceRevision = C.replacementRevision(events)
    const turns = C.userTurnCount(events)
    const mark = store.watermarks[id] ?? { lastSeq: -1, userTurns: 0 }
    if (turns - mark.userTurns < config.extractEveryTurns) return
    const target = routedTarget(session, agent)
    if (!target || !peers.llm?.createUserMessage || !peers.llm?.BlockAssembler) return
    const { text, lastSeq } = C.transcriptAfter(events, mark.lastSeq, config.extractMaxChars)
    if (text.trim().length < 40) return
      const assembler = new peers.llm.BlockAssembler()
      const messages = [
        peers.llm.createUserMessage({ content: [{ type: 'text', text: `Transcript excerpt:\n\n${text}` }], source: { kind: 'plugin', plugin: name } }),
        peers.llm.createUserMessage({ content: [{ type: 'text', text: EXTRACTION_INSTRUCTION }], source: { kind: 'plugin', plugin: name } }),
      ]
      const signal = AbortSignal.timeout(EXTRACT_TIMEOUT_MS)
      for await (const chunk of ctx.llm.stream({ provider: target.provider, model: target.model, messages, maxTokens: EXTRACT_MAX_TOKENS, sessionId: id, signal })) assembler.push(chunk)
      const finish = assembler.finish
      if (finish && finish.kind === 'error') throw new Error(finish.failure?.message ?? 'model call failed')
      const answer = C.textOf(assembler.blocks())
      if (C.replacementRevision(liveEvents(session)) !== sourceRevision) {
        log('info', `discarded extraction for ${id}: its source surface changed during the request`)
        return
      }
      const cwd = cwdOf(session)
      const existing = store.items.filter(i => available(i) && i.kind === 'fact' && visibleIn(i, cwd)).map(i => i.text)
      const facts = dedupeFacts(parseFacts(answer), existing)
      const added = []
      for (const f of facts) {
        const item = store.add({ kind: 'fact', text: f.text, cwd: f.global ? '' : cwd, scope: f.global || !cwd ? 'global' : 'workspace', sessionId: id, source: 'extract', meta: { provider: target.provider, model: target.model, sourceRevision } })
        added.push(item.id)
      }
      store.watermarks[id] = { lastSeq, userTurns: turns, invalidatedAtSeq: Math.max(mark.invalidatedAtSeq ?? -1, C.chatEditRevision(events)), at: Date.now() }
      store.prune(config.maxItems)
      persist()
      scheduleEmbed(added)
      log('info', `extracted ${added.length} fact(s) from ${id} via ${target.provider}/${target.model}`)
    } catch (error) {
      log('warn', `fact extraction failed for ${id}: ${String(error?.message ?? error)}`)
    } finally { extracting.delete(id) }
  }
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || !config.enabled || !config.extractFacts || isSubagent(agent)) return
    void extractFacts(agent)
  })

  // ── injection at pre-step ──
  // Already-injected ids are read back from the session log every time (the injected message carries them in its
  // source), so a step that never lands (reject / abort) does not mark its items as used.
  // one warning per session while the sidecar refuses writes: a long tool loop must not log it on every step
  const sidecarWarned = new Set()
  const warnSidecar = (sessionId, what) => { if (sidecarWarned.has(sessionId)) return; sidecarWarned.add(sessionId); log('warn', `${what} for ${sessionId} withheld: the source-extras sidecar cannot be written (reported once per session)`) }
  ctx.on('session/disposed', session => { extracting.delete(session?.id); turnEnded.delete(session?.id); sidecarWarned.delete(session?.id) })
  ctx.on('agent/pre-step', async (payload, next) => {
    let decision = await next()
    try {
      if (!config.enabled || decision.kind !== 'enter' || isSubagent(payload.agent)) return decision
      await reconcileReady
      const session = payload.agent.session
      const withdrawn = C.pendingInvalidations(liveEvents(session), store.items, name, store.withdrawals)
      if (withdrawn.length) {
        await ready
        if (peers.llm?.createUserMessage) {
          const notice = peers.llm.createUserMessage({
            content: [{ type: 'text', text: '[Memory update] Apply these updates to earlier recalled entries. A withdrawal invalidates the previous assertion; explicit user confirmation restores the indicated content.\n' + withdrawn.map(i => i.confirmed
              ? `- ${i.id}: The user explicitly confirmed this memory as valid again. You may use this confirmed content when relevant: ${clip(i.correctedText ?? i.text, 4000)}`
              : `- ${i.id}: Withdraw the previous assertion: ${clip(i.text, 500)}${i.correctedText ? '\n  User-confirmed correction: ' + clip(i.correctedText, 4000) : ''}`).join('\n') }],
            source: { kind: 'plugin', plugin: name },
          })
          // Without the recorded ids the notice would never count as delivered and would repeat every step:
          // skip it (the withdrawal stays pending) until the sidecar is writable again.
          if (recordSourceExtras(session.id, notice.id, { memoryInvalidations: withdrawn.map(i => ({ id: i.id, revision: i.revision })) })) { sidecarWarned.delete(session.id); decision = { ...decision, messages: [...decision.messages, notice] } }
          else warnSidecar(session.id, 'memory update notice')
        }
      }
      if (config.inject === 'off' || decision.messages.length === 0) return decision
      let at = -1
      for (let i = decision.messages.length - 1; i >= 0; i--) if (isUserTyped(decision.messages[i])) { at = i; break }
      if (at < 0) return decision
      const userMsg = decision.messages[at]
      const text = C.textOf(userMsg.content)
      const sessionEvents = liveEvents(session)
      const firstTurn = C.userTurnCount(sessionEvents) === 0
      if (config.inject === 'first-turn' && !firstTurn) return decision
      const cwd = cwdOf(session)
      const seen = C.injectedMemoryIds(sessionEvents, name)
      const qv = text.trim() ? await queryVector(text) : null
      const picks = []
      if (firstTurn) {
        for (const item of store.list({ cwd }).filter(i => available(i) && i.pinned).slice(0, config.topK * 2)) picks.push({ item, score: 1 })
      }
      if (text.trim()) {
        for (const hit of recall(text, { cwd, topK: config.topK, strict: !firstTurn, qv })) if (!picks.some(p => p.item.id === hit.item.id)) picks.push(hit)
      }
      const fresh = picks.filter(p => !seen.has(p.item.id))
      if (fresh.length === 0) return decision
      await ready
      if (!peers.llm?.createUserMessage) return decision
      const { text: block, used } = formatInjection(fresh.filter(p => available(p.item)))
      if (used.length === 0) return decision
      const injected = peers.llm.createUserMessage({ content: [{ type: 'text', text: block }], source: { kind: 'plugin', plugin: name } })
      // memoryIds ride the sidecar (keyed by message id), not the log: format migrations refuse undocumented source members
      if (!recordSourceExtras(session.id, injected.id, { memoryIds: used })) { warnSidecar(session.id, 'memory injection'); return decision }
      sidecarWarned.delete(session.id)
      return { kind: 'enter', messages: [...decision.messages.slice(0, at + 1), injected, ...decision.messages.slice(at + 1)] }
    } catch (error) {
      log('warn', `injection skipped: ${String(error?.message ?? error)}`)
      return decision
    }
  })

  // ── tools ──
  function registerTools() {
    if (toolsDisposer) { try { toolsDisposer() } catch { /* disposed */ } toolsDisposer = null }
    if (!config.enabled || !config.tools) return
    ready.then(() => {
      if (!peers.tools?.defineTool || !config.enabled || !config.tools || toolsDisposer) return
      const recallTool = peers.tools.defineTool({
        name: 'memory_recall',
        description: 'Search the long-term memory of this deployment: facts, notes and conversation summaries saved from earlier sessions. Use it when the user refers to earlier work, preferences or decisions that are not in the current conversation.',
        parameters: {
          query: { type: 'string', required: true, description: 'Keywords or a short question.' },
          limit: { type: 'number', description: 'Maximum items to return (1–10, default 5).' },
        },
        output: {
          schema: {
            type: 'object', additionalProperties: false,
            properties: {
              items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, kind: { type: 'string', required: true }, text: { type: 'string', required: true }, createdAt: { type: 'string', required: true }, pinned: { type: 'boolean', required: true } } } },
              total: { type: 'number', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: value.items.length === 0 ? 'No matching memory.' : value.items.map(i => `- (${i.id} · ${i.kind} · ${i.createdAt}${i.pinned ? ' · pinned' : ''}) ${i.text}`).join('\n') }],
          presentationMeta: (_args, value) => ({ plugin: name, memoryIds: value.items.map(item => item.id) }),
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          await reconcileReady
          const cwd = cwdOf(exec.agent?.session)
          const limit = Math.min(10, Math.max(1, Math.trunc(Number(args.limit) || 5)))
          const qv = await queryVector(args.query)
          const hits = recall(args.query, { cwd, topK: limit, strict: false, qv })
          if (hits.length && peers.llm?.createUserMessage && typeof exec.deferContext === 'function') {
            // The core ferries this through nested run_code calls and lands it with
            // result context. Do not mark exposure merely because execute ran.
            const reference = peers.llm.createUserMessage({
              content: [{ type: 'text', text: 'Memory lookup references: ' + hits.map(hit => hit.item.id).join(', ') + '. The tool result contains the recalled content.' }],
              source: { kind: 'plugin', plugin: name },
            })
            if (recordSourceExtras(exec.agent?.session?.id, reference.id, { memoryIds: hits.map(hit => hit.item.id), memoryRecallCallId: exec.callId })) exec.deferContext(reference)
          }
          return { items: hits.map(h => ({ id: h.item.id, kind: h.item.kind, text: clip(h.item.text, 4000), createdAt: fmtDate(h.item.createdAt), pinned: h.item.pinned })), total: store.items.filter(i => available(i) && visibleIn(i, cwd)).length }
        },
      })
      const noteTool = peers.tools.defineTool({
        name: 'memory_note',
        description: 'Save one durable note to long-term memory (survives compaction and new sessions). Use it when the user asks you to remember something, or for a decision that must outlive this conversation.',
        parameters: {
          text: { type: 'string', required: true, description: 'The fact to remember, one or two sentences.' },
          scope: { type: 'string', enum: ['workspace', 'global'], description: 'workspace = only this project directory (default); global = every project.' },
        },
        output: {
          schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, scope: { type: 'string', required: true } } },
          render: (_args, value) => [{ type: 'text', text: `Saved to memory as ${value.id} (${value.scope}).` }],
        },
        async execute(args, exec) {
          const cwd = cwdOf(exec.agent?.session)
          const scope = args.scope === 'global' || !cwd ? 'global' : 'workspace'
          const item = store.add({ kind: 'note', text: args.text, cwd: scope === 'global' ? '' : cwd, scope, sessionId: exec.agent?.session?.id ?? '', source: 'tool' })
          store.prune(config.maxItems)
          persist()
          scheduleEmbed([item.id])
          return { id: item.id, scope }
        },
      })
      const d1 = ctx.tools.register(recallTool)
      const d2 = ctx.tools.register(noteTool)
      toolsDisposer = () => { try { d1?.() } catch { /* noop */ } try { d2?.() } catch { /* noop */ } }
    }).catch(error => log('warn', `tool registration failed: ${String(error?.message ?? error)}`))
  }
  function registerPrompt() {
    if (promptDisposer) { try { promptDisposer() } catch { /* disposed */ } promptDisposer = null }
    if (!config.enabled || (!config.tools && config.inject === 'off')) return
    const parts = []
    if (config.tools) parts.push('Long-term memory tools: memory_recall(query) searches facts, notes and summaries saved from earlier sessions; memory_note(text) saves something the user asks you to remember.')
    if (config.inject !== 'off') parts.push('A "[Memory recall]" context message may follow the user message with items saved earlier; use them only when relevant and never restate them.')
    promptDisposer = ctx.systemPrompt.section({ name: 'memory-lite:guidance', order: 112, text: parts.join(' ') })
  }

  // ── session context: list / detail / edit / compact ──
  const metaCache = new Map() // id → { revision, title, preview, compactions, checkpoints, turns, lastUserAt }
  function metaFromEvents(events, nodes) {
    const history = C.compactionHistory(events, nodes)
    return { title: C.sessionTitle(events), preview: C.firstUserText(events), compactions: history.entries.filter(e => e.status === 'complete').length, checkpoints: C.activeCheckpoints(events, nodes).length, turns: C.userTurnCount(events), lastUserAt: C.lastUserTime(events) }
  }
  const foldNodes = events => (peers.session?.foldSurface ? peers.session.foldSurface(events).nodes : C.foldSurfaceBasic(events))

  async function listSessions() {
    await ready
    const p = persistence()
    const snapshots = (await listStoredSessions(p)).map(s => ({ meta: s.header, revision: s.revision }))
    const live = new Map(ctx.sessions.list().map(s => [s.id, s]))
    const rows = []
    const seen = new Set()
    for (const snap of snapshots) {
      const meta = snap.meta
      if (!meta?.id || seen.has(meta.id)) continue
      seen.add(meta.id)
      rows.push({ id: meta.id, cwd: meta.cwd ?? '', createdAt: meta.createdAt ?? 0, origin: meta.origin, parentSession: meta.parentSession, revision: snap.revision ?? null })
    }
    for (const [id, s] of live) if (!seen.has(id)) rows.push({ id, cwd: s.header.cwd ?? '', createdAt: s.header.createdAt ?? 0, origin: s.header.origin, parentSession: s.header.parentSession, revision: null })
    rows.sort((a, b) => b.createdAt - a.createdAt)
    let inspected = 0
    const started = Date.now()
    let partial = false
    for (const row of rows) {
      const s = live.get(row.id)
      row.live = !!s
      row.running = ctx.agents.get(row.id)?.status === 'running'
      if (s) { Object.assign(row, metaFromEvents(liveEvents(s), [...s.surface.nodes])); continue }
      const cached = metaCache.get(row.id)
      if (cached && (row.revision === null || cached.revision === row.revision)) { Object.assign(row, cached); continue }
      if (!p || inspected >= LIST_INSPECT_BUDGET || Date.now() - started > LIST_INSPECT_MS) { partial = true; continue }
      inspected++
      try {
        const insp = await readStoredSession(p, row.id)
        const events = insp.events
        const meta = { revision: row.revision, ...metaFromEvents(events, foldNodes(events)) }
        metaCache.set(row.id, meta)
        Object.assign(row, meta)
      } catch (error) { row.error = String(error?.message ?? error).slice(0, 200) }
    }
    for (const row of rows) delete row.revision
    rows.sort((a, b) => Math.max(b.lastUserAt ?? 0, b.createdAt) - Math.max(a.lastUserAt ?? 0, a.createdAt))
    return { sessions: rows, partial, persistence: !!p }
  }

  async function thresholdFor(target, agent) {
    if (!target) return { contextWindow: null, thresholdRatio: null, thresholdTokens: null, thresholdSource: 'none' }
    let contextWindow = null
    try { contextWindow = (await ctx.llm.resolveModelInfo(target.provider, target.model))?.context?.contextWindow ?? null } catch { /* unknown model */ }
    const engine = engineFor(agent)
    let ratio = typeof engine?.config?.thresholdRatio === 'number' ? engine.config.thresholdRatio : 0.8
    const thresholdSource = typeof engine?.config?.thresholdRatio === 'number' ? 'engine' : 'default'
    const policies = Array.isArray(engine?.config?.modelPolicies) ? engine.config.modelPolicies : []
    const policy = policies.find(pol => pol.provider === target.provider && pol.model === target.model)
    if (policy && typeof policy.thresholdRatio === 'number') ratio = policy.thresholdRatio
    return { contextWindow, thresholdRatio: ratio, thresholdTokens: contextWindow ? Math.floor(contextWindow * ratio) : null, thresholdSource }
  }

  async function sessionDetail(id) {
    await ready
    const live = ctx.sessions.get(id)
    let header
    let events
    let nodes
    let measured = null
    let target = null
    const meter = tokenMeter()
    if (live) {
      header = live.header
      events = liveEvents(live)
      nodes = [...live.surface.nodes]
      if (meter) { const m = meter.measure(live); measured = { totalTokens: m.totalTokens, surfaceTokens: m.surfaceTokens, baseline: m.baseline?.kind ?? null } }
      target = routedTarget(live, ctx.agents.get(id))
    } else {
      const p = persistence()
      if (!p) throw fail(503, 'session persistence is not available in this deployment')
      let insp
      try { insp = await readStoredSession(p, id) } catch (error) { throw fail(404, `session not found: ${String(error?.message ?? error).slice(0, 160)}`) }
      header = insp.header
      events = insp.events
      nodes = foldNodes(events)
      if (meter && peers.session?.deriveEventMessage) {
        let surfaceTokens = 0
        for (const seq of nodes) { const m = peers.session.deriveEventMessage(events[seq]); if (m) surfaceTokens += meter.estimateMessage(m) }
        measured = { totalTokens: null, surfaceTokens, baseline: 'surface-estimate' }
      }
      const hdr = peers.session?.foldRequestHeader ? peers.session.foldRequestHeader(events) : undefined
      target = hdr?.config?.provider && hdr?.config?.model ? { provider: hdr.config.provider, model: hdr.config.model } : null
    }
    const state = C.inspectOpenState(events)
    const threshold = await thresholdFor(target, ctx.agents.get(id))
    const peersOk = peerState()
    return {
      ok: true,
      id, title: C.sessionTitle(events), preview: C.firstUserText(events), cwd: header.cwd ?? '', createdAt: header.createdAt ?? 0, origin: header.origin, parentSession: header.parentSession,
      live: !!live, running: ctx.agents.get(id)?.status === 'running', openTurn: state.openTurn, activeCompaction: state.activeCompaction,
      turns: C.userTurnCount(events), lastUserAt: C.lastUserTime(events), eventCount: events.length,
      composition: C.surfaceComposition(events, nodes),
      checkpoints: C.activeCheckpoints(events, nodes),
      history: C.compactionHistory(events, nodes),
      pressure: { ...threshold, ...(measured ?? {}), provider: target?.provider ?? null, model: target?.model ?? null },
      editable: !isSubagentSession(header) && peersOk.llm && peersOk.compaction && !!tokenMeter(),
      compactable: !isSubagentSession(header) && (live ? typeof engineFor(ctx.agents.get(id))?.compactNow === 'function' : !!presetsService() || typeof ctx.get('compaction')?.compactNow === 'function'),
      memoryItems: store.items.filter(i => i.sessionId === id).map(i => ({ id: i.id, kind: i.kind, pinned: i.pinned, chars: i.text.length, createdAt: i.createdAt })),
    }
  }

  /**
   * Run `fn(agent, resumed, flush)` on the live agent, or resume the cold session, run, flush and dispose.
   * `flush` checkpoints the session once (a job that wrote calls it; the cold path calls it before dispose otherwise).
   */
  const inFlight = new Set()
  async function withAgent(id, fn) {
    // one maintenance operation per session at a time (a second concurrent cold edit would otherwise race the resume)
    if (inFlight.has(id)) throw fail(409, 'another edit / compaction is running on this session; retry in a moment')
    inFlight.add(id)
    try { return await withAgentInner(id, fn) } finally { inFlight.delete(id) }
  }
  async function withAgentInner(id, fn) {
    metaCache.delete(id) // the list cache is keyed by storage revision; a maintenance write changes it
    const flushOnce = agent => { let done = false; return async () => { if (done) return; done = true; await ctx.sessions.flush(agent.session) } }
    const live = ctx.agents.get(id)
    if (live) {
      if (isSubagentSession(live.session.header)) throw fail(400, 'subagent sessions are read-only here')
      return fn(live, false, flushOnce(live))
    }
    const p = persistence()
    if (!p) throw fail(503, 'session persistence is not available in this deployment')
    const header = (await statStoredSession(p, id))?.header
    if (!header) throw fail(404, 'session not found')
    if (isSubagentSession(header)) throw fail(400, 'subagent sessions are read-only here')
    // the preset the log recorded is composed exactly like the web UI's cold resume does; an unknown preset is a refusal, never a silent default
    let insp
    try { insp = await readStoredSession(p, id) } catch (error) { throw fail(404, `session log cannot be read: ${String(error?.message ?? error).slice(0, 160)}`) }
    const setup = await resumeSetupFor(insp.header, insp.events)
    maintenanceAgents.add(id)
    let handle
    try { handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: defaultAgentOptions(), ...(setup ? { setup } : {}) }) } catch (error) { maintenanceAgents.delete(id); throw error }
    const flush = flushOnce(handle.agent)
    try {
      return await fn(handle.agent, true, flush)
    } finally {
      maintenanceAgents.delete(id)
      try { await flush() } catch { /* the dispose drain is the fallback checkpoint */ }
      // The resumed agent is published like any other (the web UI adopts a live agent by id). If a prompt reached it
      // while the job ran, disposing now would abort that turn under the user: keep it alive for the plugin's lifetime.
      if (handle.agent.status === 'running' || inboxHasPending(handle.agent)) {
        adoptedHandles.push(handle)
        log('warn', `session ${id} received work during maintenance; its agent stays alive instead of being disposed`)
      } else {
        try { await handle.dispose() } catch (error) { log('warn', `dispose after maintenance failed: ${String(error?.message ?? error)}`) }
      }
    }
  }

  function runMaintenance(agent, job) {
    try { return agent.runMaintenance(job) } catch (error) { throw fail(409, `the agent is busy (${String(error?.message ?? error)}); wait for the turn to finish`) }
  }

  async function editSummary(id, checkpointSeq, summary) {
    await ready
    if (!peers.llm?.createUserMessage || !peers.compaction?.compactCheckpointSource) throw fail(503, 'editing needs @deepseek-ai/dsh-llm and @deepseek-ai/dsh-compaction resolvable from the plugin (run launcher/peer-links.mjs)')
    if (typeof summary !== 'string' || summary.trim().length === 0) throw fail(400, 'summary must be a non-empty string')
    if (summary.length > MAX_SUMMARY_CHARS) throw fail(400, `summary longer than ${MAX_SUMMARY_CHARS} characters`)
    return withAgent(id, (agent, resumed, flush) => runMaintenance(agent, async () => {
      const session = agent.session
      const events = liveEvents(session)
      const state = C.inspectOpenState(events)
      if (state.openTurn !== null) throw fail(409, `turn ${state.openTurn} is still open; wait for it to finish`)
      if (state.activeCompaction) throw fail(409, 'a compaction is in progress on this session')
      const nodes = session.surface.nodes
      if (!nodes.includes(checkpointSeq)) throw fail(409, `checkpoint ${checkpointSeq} is no longer on the surface (the session changed); reload and retry`)
      const cp = events[checkpointSeq]
      if (!cp || cp.seq !== checkpointSeq || !C.isCheckpointEvent(cp)) throw fail(400, `event ${checkpointSeq} is not a compaction checkpoint`)
      const framing = C.parseFramedSummary(cp.data.content)
      if (framing.summary === summary) return { ok: true, unchanged: true, checkpointSeq }
      const content = C.frameSummary(summary, framing)
      const meter = tokenMeter()
      if (!meter) throw fail(503, 'the token meter (ctx.tokenMeter) is not mounted, so the replaced checkpoint cannot be priced; editing is refused rather than recorded with a wrong shadow price')
      const oldMessage = typeof session.deriveEventMessage === 'function' ? session.deriveEventMessage(cp) : cp.data
      const shadowedTokenCount = meter.estimateMessage(oldMessage ?? cp.data)
      const compactionId = randomUUID()
      const lifecycle = { compactionId, turn: null }
      const startEvent = session.append('compaction/start', lifecycle)
      let summaryEvent
      let checkpoint
      let endEvent
      let message
      try {
        summaryEvent = session.append('compaction/summary', {
          compactionId,
          summary: [{ type: 'text', text: summary }],
          shadowedRange: { start: checkpointSeq, end: checkpointSeq },
          shadowedSeqs: [checkpointSeq],
          shadowedTokenCount,
          provider: C.EDIT_PROVIDER,
          model: C.EDIT_MODEL,
        })
        message = peers.llm.createUserMessage({ content, source: peers.compaction.compactCheckpointSource(compactionId) })
        checkpoint = session.append('user/message', message, { surfaceOp: { op: 'replace', startSeq: checkpointSeq, endSeq: checkpointSeq }, sourceEventSeqs: [startEvent.seq, summaryEvent.seq, checkpointSeq] })
        endEvent = session.append('compaction/end', lifecycle)
      } catch (error) {
        try { session.append('compaction/end', { ...lifecycle, error: String(error?.message ?? error) }) } catch { /* unmatched start stays visible in the log */ }
        throw fail(500, `edit did not commit: ${String(error?.message ?? error)}`)
      }
      try { await flush() } catch (error) { throw fail(500, `edit committed (seqs ${startEvent.seq}-${endEvent.seq}) but the session could not be saved yet: ${String(error?.message ?? error).slice(0, 200)}`) }
      return { ok: true, resumed, compactionId, startSeq: startEvent.seq, summarySeq: summaryEvent.seq, checkpointSeq: checkpoint.seq, endSeq: endEvent.seq, replacedSeq: checkpointSeq, shadowedTokenCount, newTokenCount: meter.estimateMessage(message) }
    }))
  }

  async function compactSession(id) {
    return withAgent(id, async (agent, resumed) => {
      const engine = engineFor(agent)
      if (!engine || typeof engine.compactNow !== 'function') throw fail(503, 'this agent\'s preset mounts no compaction engine (/compact is unavailable for it)')
      try {
        const result = await engine.compactNow(agent, AbortSignal.timeout(COMPACT_TIMEOUT_MS))
        if (result === null) return { ok: true, resumed, compacted: false, message: 'No compactable history yet.' }
        return { ok: true, resumed, compacted: true, compactionId: result.compactionId, shadowedCount: result.shadowedSeqs.length, shadowedTokenCount: result.shadowedTokenCount, summarySeq: result.summarySeq }
      } catch (error) {
        const code = error?.code
        const text = code === 'busy' ? 'the agent is not idle or a compaction is already running'
          : code === 'changed' ? 'the history changed during compaction; nothing replaced'
            : code === 'summary' ? 'the model could not produce a smaller summary; nothing replaced'
              : code === 'commit' ? 'compaction did not commit cleanly; inspect the session'
                : code === 'persistence' ? 'compaction finished but the session could not be saved'
                  : code === 'cancelled' ? 'compaction was cancelled' : String(error?.message ?? error)
        throw fail(code ? 409 : 500, `compaction failed: ${text}`)
      }
    })
  }

  async function depositCheckpoint(id, checkpointSeq) {
    const detail = await sessionDetail(id)
    const cp = detail.checkpoints.find(c => checkpointSeq === undefined || c.seq === checkpointSeq) ?? null
    if (!cp) throw fail(404, 'the session has no active checkpoint to store')
    const item = store.replaceSessionSummary(id, { text: cp.summary, cwd: detail.cwd, scope: detail.cwd ? 'workspace' : 'global', source: 'user', meta: { checkpointSeq: cp.seq } })
    store.prune(config.maxItems)
    persist()
    scheduleEmbed([item.id])
    return { ok: true, item }
  }

  // ── HTTP routes (launcher) ──
  const status = async () => {
    await ready
    return {
      ok: true, config, stats: store.stats(), peers: peerState(),
      services: { persistence: !!persistence(), tokenMeter: !!tokenMeter(), agentPresets: !!presetsService(), hostCompaction: !!ctx.get('compaction') },
      configFile: CONFIG_FILE, memoryDir: MEMORY_DIR,
    }
  }
  const itemView = i => ({ ...i, ...(C.automaticItem(i) && uncheckedSources.has(i.sessionId) ? { sourceUnchecked: true } : {}) })
  const route = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname
    try {
      if (rejectCrossSite(req, { allowLoopbackOrigins: true })) return json(res, 403, { ok: false, message: 'same-origin JSON requests only' })
      if (req.method === 'GET' && p === '/dsh-memory-lite/status') return json(res, 200, await status())
      if (req.method === 'POST' && p === '/dsh-memory-lite/settings') {
        const body = await readBody(req)
        const candidate = body.config && typeof body.config === 'object' ? body.config : body
        const problems = validateConfig(candidate)
        if (problems.length > 0) return json(res, 400, { ok: false, message: problems.join('; ') })
        const next = normalizeConfig({ ...config, ...candidate, embeddings: { ...config.embeddings, ...(candidate.embeddings ?? {}) } })
        saveConfigFile(next)
        loadConfig()
        return json(res, 200, await status())
      }
      if (req.method === 'GET' && p === '/dsh-memory-lite/items') {
        await reconcileSources()
        const q = (url.searchParams.get('q') ?? '').slice(0, 500)
        const kind = url.searchParams.get('kind') ?? undefined
        const cwd = url.searchParams.has('cwd') ? url.searchParams.get('cwd') : undefined
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200))
        if (q.trim()) {
          const cands = store.list({ kind, cwd })
          const qv = await queryVector(q)
          const ranked = rank(cands, q, { topK: limit, cwd, strict: false, vectors: vectorsFor(), queryVector: qv })
          const ids = new Set(ranked.map(r => r.item.id))
          const extra = cands.filter(i => !ids.has(i.id) && i.text.toLowerCase().includes(q.toLowerCase())).slice(0, limit)
          return json(res, 200, { ok: true, mode: 'search', items: [...ranked.map(r => ({ ...itemView(r.item), score: Number(r.score.toFixed(3)), matched: r.matched })), ...extra.map(itemView)].slice(0, limit), total: cands.length })
        }
        const all = store.list({ kind, cwd })
        return json(res, 200, { ok: true, mode: 'list', items: all.slice(0, limit).map(itemView), total: all.length })
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/items') {
        const body = await readBody(req)
        if (typeof body.text !== 'string' || body.text.trim() === '') return json(res, 400, { ok: false, message: 'text is required' })
        const scope = SCOPES.includes(body.scope) ? body.scope : 'global'
        const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
        if (scope === 'workspace' && !cwd) return json(res, 400, { ok: false, message: 'workspace scope needs a cwd' })
        const item = store.add({ kind: KINDS.includes(body.kind) ? body.kind : 'note', text: body.text, scope, cwd: scope === 'workspace' ? cwd : '', pinned: body.pinned === true, source: 'user' })
        store.prune(config.maxItems)
        persist()
        scheduleEmbed([item.id])
        return json(res, 200, { ok: true, item })
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/items/update') {
        const body = await readBody(req)
        const before = store.get(String(body.id ?? ''))
        const oldText = before?.text
        const staleRevision = C.staleItem(before ?? {}) ? before.meta.staleAfterEdit : undefined
        const item = store.update(String(body.id ?? ''), body)
        if (!item) return json(res, 404, { ok: false, message: 'no such item' })
        if (typeof body.text === 'string') {
          const previous = store.withdrawals[item.id]
          if (oldText === item.text && staleRevision !== undefined) {
            store.withdrawals[item.id] = { revision: Math.max(Date.now(), (previous?.revision ?? staleRevision) + 1), sourceEditSeq: staleRevision, text: oldText.slice(0, 500), correctedText: item.text.slice(0, 4000), confirmed: true }
            delete item.meta.withdrawnRecall
          } else if (oldText !== item.text && (staleRevision !== undefined || item.meta.withdrawnRecall || previous)) {
            const revision = Math.max(Date.now(), (previous?.revision ?? item.meta.withdrawnRecall?.revision ?? staleRevision ?? -1) + 1)
            item.meta.withdrawnRecall = { revision, text: oldText.slice(0, 500) }
            store.withdrawals[item.id] = { revision, ...(staleRevision !== undefined ? { sourceEditSeq: staleRevision } : {}), text: oldText.slice(0, 500), correctedText: item.text.slice(0, 4000) }
          }
          item.source = 'user'; delete item.meta.staleAfterEdit
        }
        persist()
        if (typeof body.text === 'string') scheduleEmbed([item.id])
        return json(res, 200, { ok: true, item })
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/items/delete') {
        const body = await readBody(req)
        const ids = Array.isArray(body.ids) ? body.ids : [body.id]
        let removed = 0
        for (const id of ids) if (store.remove(String(id ?? ''))) removed++
        if (removed > 0) { persist(); store.saveVectors() }
        return json(res, 200, { ok: true, removed })
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/items/clear') {
        const body = await readBody(req)
        if (body.confirm !== true) return json(res, 400, { ok: false, message: 'confirm: true is required' })
        const kind = KINDS.includes(body.kind) ? body.kind : null
        const victims = store.items.filter(i => (kind === null || i.kind === kind) && (body.includePinned === true || !i.pinned))
        for (const v of victims) store.remove(v.id)
        persist(); store.saveVectors()
        return json(res, 200, { ok: true, removed: victims.length })
      }
      if (req.method === 'GET' && p === '/dsh-memory-lite/export') return json(res, 200, store.exportJson())
      if (req.method === 'POST' && p === '/dsh-memory-lite/import') {
        const body = await readBody(req, MAX_IMPORT_BODY)
        const result = store.importJson(body)
        store.prune(config.maxItems)
        persist()
        scheduleEmbed(store.items.filter(i => !store.vectors.byId[i.id]).map(i => i.id))
        await reconcileSources()
        return json(res, 200, { ok: true, ...result, total: store.items.length })
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/recall') {
        // read the body first: a request whose stream is already flowing must not lose its chunks while the store reconciles
        const body = await readBody(req)
        await reconcileSources()
        const query = String(body.query ?? '').slice(0, 2000)
        const cwd = typeof body.cwd === 'string' ? body.cwd : ''
        const qv = await queryVector(query)
        const hits = recall(query, { cwd, topK: Math.min(20, Math.max(1, Number(body.limit) || config.topK)), strict: body.strict === true, qv })
        return json(res, 200, { ok: true, hits: hits.map(h => ({ id: h.item.id, kind: h.item.kind, text: h.item.text, score: Number(h.score.toFixed(3)), matched: h.matched, cos: Number(h.cos.toFixed(3)) })), preview: formatInjection(hits).text })
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/embeddings/test') {
        const body = await readBody(req)
        // baseURL / model may come from the form being edited; the credential is always the SAVED one (no forwarding of
        // arbitrary credentials to a caller-chosen URL)
        const cfg = { ...config.embeddings, ...(body.embeddings && typeof body.embeddings === 'object' ? body.embeddings : {}), apiKeyEnv: config.embeddings.apiKeyEnv }
        const t0 = Date.now()
        const [vec] = await embedTexts(cfg, ['memory test'], { apiKey: await apiKey(cfg.apiKeyEnv) })
        return json(res, 200, { ok: true, dims: vec.length, ms: Date.now() - t0, model: cfg.model, baseURL: cfg.baseURL })
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/embeddings/rebuild') {
        if (!config.embeddings.enabled) return json(res, 400, { ok: false, message: 'embeddings are disabled' })
        const missing = store.items.filter(i => !store.vectors.byId[i.id]).slice(0, 500)
        if (missing.length > 0) {
          const vectors = await embedTexts(config.embeddings, missing.map(i => i.text), { apiKey: await apiKey(config.embeddings.apiKeyEnv) })
          if (store.vectors.model !== config.embeddings.model) store.resetVectors(config.embeddings.model)
          missing.forEach((item, i) => { store.vectors.byId[item.id] = vectors[i] })
          store.saveVectors()
        }
        return json(res, 200, { ok: true, embedded: missing.length, remaining: store.items.filter(i => !store.vectors.byId[i.id]).length, ...store.stats() })
      }
      if (req.method === 'GET' && p === '/dsh-memory-lite/sessions') return json(res, 200, { ok: true, ...(await listSessions()) })
      if (req.method === 'GET' && p === '/dsh-memory-lite/session') {
        const id = url.searchParams.get('id') ?? ''
        if (!SESSION_ID.test(id)) return json(res, 400, { ok: false, message: 'invalid session id' })
        return json(res, 200, await sessionDetail(id))
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/session/summary') {
        const body = await readBody(req)
        const id = String(body.id ?? '')
        const seq = Number(body.checkpointSeq)
        if (!SESSION_ID.test(id)) return json(res, 400, { ok: false, message: 'invalid session id' })
        if (!Number.isSafeInteger(seq) || seq < 0) return json(res, 400, { ok: false, message: 'checkpointSeq must be a non-negative integer' })
        return json(res, 200, await editSummary(id, seq, body.summary))
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/session/compact') {
        const body = await readBody(req)
        const id = String(body.id ?? '')
        if (!SESSION_ID.test(id)) return json(res, 400, { ok: false, message: 'invalid session id' })
        return json(res, 200, await compactSession(id))
      }
      if (req.method === 'POST' && p === '/dsh-memory-lite/session/deposit') {
        const body = await readBody(req)
        const id = String(body.id ?? '')
        if (!SESSION_ID.test(id)) return json(res, 400, { ok: false, message: 'invalid session id' })
        return json(res, 200, await depositCheckpoint(id, Number.isSafeInteger(body.checkpointSeq) ? body.checkpointSeq : undefined))
      }
      res.writeHead(404); res.end()
    } catch (error) {
      const msg = String(error?.message ?? error)
      const st = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status
        : error?.code === 'MEMORY_STORE_LOCKED' ? 503
          : /must not be empty|needs a cwd|import expects/.test(msg) ? 400 : 500
      json(res, st, { ok: false, message: msg.slice(0, 600) })
    }
  }

  // ── wiring ──
  loadConfig()
  void reconcileSources()
  // An external write of memory.json (the launcher's config restore, a hand edit) is reloaded; the store's own atomic
  // writes also trip the watcher, which then re-reads the content it just wrote (harmless).
  const reloadStore = (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return
    if (store.lastSavedAt && Math.abs(cur.mtimeMs - store.lastSavedAt) < 50) return
    if (store.load()) { log('info', `memory.json changed on disk: ${store.items.length} item(s) reloaded`); void reconcileSources(); scheduleEmbed(store.items.filter(i => !store.vectors.byId[i.id]).map(i => i.id)) }
    else log('warn', `memory.json changed on disk but could not be loaded (${store.loadErrorKind}: ${store.loadError}); keeping the loaded store — an unparsable file is moved aside on the next write, an unreadable one makes writes refuse until it can be read`)
  }
  ctx.effect(() => {
    watchFile(CONFIG_FILE, { interval: 1500 }, loadConfig).unref?.()
    watchFile(store.file, { interval: 1500 }, reloadStore).unref?.()
    return () => {
      unwatchFile(CONFIG_FILE, loadConfig)
      unwatchFile(store.file, reloadStore)
      if (toolsDisposer) { try { toolsDisposer() } catch { /* noop */ } toolsDisposer = null }
      if (promptDisposer) { try { promptDisposer() } catch { /* noop */ } promptDisposer = null }
      for (const h of adoptedHandles.splice(0)) h.dispose().catch(() => {})
    }
  }, 'memory-lite: config watch')
  // Routes exist only where a web server is mounted (web profile); deposit / extraction / injection / tools work headless too.
  ctx.inject(['webServer'], webCtx => { webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: '/dsh-memory-lite', handler: route }), 'memory-lite: routes') })
}
