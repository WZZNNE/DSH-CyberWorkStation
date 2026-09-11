/**
 * dsh-chat-editor host plugin — edit or delete any message of a conversation, the user's
 * own and the assistant's, in three modes the user picks per action:
 *
 *  - display : the browser shows the edited / hidden text; the session log and the model's
 *              context are untouched (`$DSH_HOME/chat-edits.json`, session/seq identity).
 *  - context : what the MODEL sees changes, written the way the core writes compaction —
 *              `compaction/prune` (the shadow price of the replaced range) immediately
 *              followed by a `user/message` with `surfaceOp: {op:'replace', …}` and
 *              `sourceEventSeqs` covering every shadowed node, under `agent.runMaintenance`.
 *              The original events stay in the log, so the request stays reconstructable.
 *              An assistant message cannot be replaced by another `assistant/message`
 *              (the core requires an open step for that event type, even for a replacement),
 *              so an assistant edit lands as a user-role correction node — see the README.
 *  - fork    : branch the conversation before that turn (the core's own fork recipe:
 *              `ctx.agents.create({ seed })` + workspace attach) and optionally send the
 *              edited text as the first message of the branch.
 *
 * Routes live under `/dsh-chat-editor/*` (loopback Host + same-origin JSON only); the
 * browser half is `lib/client.js`.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync, watchFile, unwatchFile } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as V from './view.js'
import { normalizeDoc, setOverride, clearOverrides, overridesFor } from './overrides.js'
import { editState, editableMessages, effectiveOverrides, resolveEditTarget, activeTurnRange } from './edit-state.js'

export const name = 'chat-editor'
export const inject = ['sessions', 'agents']

const DSH_HOME = resolveDshHome()
const EDITS_FILE = join(DSH_HOME, 'chat-edits.json')
const MAX_BODY = 512 * 1024
const MAX_TEXT = 20000
const SESSION_ID = /^[^\s/\\]{1,200}$/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const peers = { llm: null, compaction: null, presets: null }
  const ready = Promise.all([
    import('@deepseek-ai/dsh-llm').then(m => { peers.llm = m }).catch(() => {}),
    import('@deepseek-ai/dsh-compaction').then(m => { peers.compaction = m }).catch(() => {}),
  ])
  const log = (level, msg) => { (level === 'warn' ? console.warn : console.log)(`[chat-editor] ${msg}`) }
  const fail = (status, message) => Object.assign(new Error(message), { status })

  // ── display overrides ──
  let doc = { version: 1, sessions: {} }
  const loadDoc = () => {
    try {
      const raw = JSON.parse(readFileSync(EDITS_FILE, 'utf8').replace(/^﻿/, ''))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.sessions || typeof raw.sessions !== 'object' || Array.isArray(raw.sessions)) throw new Error('invalid document shape')
      doc = normalizeDoc(raw)
    } catch (error) { log('warn', `display overrides not reloaded; retaining last good value (${error?.code ?? error?.name ?? 'read failure'})`) }
  }
  const saveDoc = next => {
    mkdirSync(dirname(EDITS_FILE), { recursive: true })
    const tmp = EDITS_FILE + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
    try { writeFileSync(tmp, JSON.stringify(next, null, 1)); renameSync(tmp, EDITS_FILE); doc = next } catch (error) { try { unlinkSync(tmp) } catch { /* nothing to clean */ } throw error }
  }
  loadDoc()

  // ── session access (live or cold), mirroring the core's own cold-resume recipe ──
  const persistence = () => ctx.get('sessionPersistence')
  const tokenMeter = () => ctx.get('tokenMeter')
  const presetsService = () => ctx.get('agentPresets')
  const isSubagentSession = header => header?.origin === 'subagent'
  const agentOptions = () => {
    const sel = ctx.get('agentDefaultModel')?.currentSelection?.()
    return sel && sel.provider && sel.model ? { provider: sel.provider, model: sel.model } : {}
  }
  /** The preset the log recorded (last `agent-preset/selected`, else the header); unknown → refusal. */
  async function presetSetup(header, events) {
    const ps = presetsService()
    if (!ps || typeof ps.mount !== 'function') return { setup: undefined, presetId: undefined }
    let stored = header?.agentPreset
    for (let i = events.length - 1; i >= 0; i--) { const e = events[i]; if (e?.type === 'agent-preset/selected' && typeof e.data?.agentPreset === 'string') { stored = e.data.agentPreset; break } }
    let resolved
    try { resolved = await ps.resolve(stored) } catch (error) { throw fail(409, `the preset this session recorded (${stored ?? 'default'}) cannot be composed: ${String(error?.message ?? error).slice(0, 200)}`) }
    return { setup: async agentCtx => { await ps.mount(agentCtx, resolved.id) }, presetId: resolved.id }
  }

  async function readSession(id) {
    const live = ctx.sessions.get(id)
    if (live) return { header: live.header, events: [...live.events], live: true }
    const p = persistence()
    if (!p) throw fail(503, 'session persistence is not available in this deployment')
    try { const insp = await p.inspect(id); return { header: insp.meta, events: [...insp.events], live: false } } catch (error) { throw fail(404, `session not found: ${String(error?.message ?? error).slice(0, 160)}`) }
  }

  /** Agents this plugin resumed for an edit, and forks it created (disposed with the plugin). */
  // Forks and resumed cold sessions this plugin owns. A handle is released once its session is no
  // longer live in the store and the agent is idle — never while the user may still be in it.
  const MAX_OWNED_HANDLES = 8
  const ownedHandles = []
  function releaseIdleHandles() {
    if (ownedHandles.length <= MAX_OWNED_HANDLES) return
    for (let i = 0; i < ownedHandles.length && ownedHandles.length > MAX_OWNED_HANDLES; i++) {
      const handle = ownedHandles[i]
      const agent = handle?.agent
      const id = agent?.session?.id
      const live = id !== undefined && ctx.sessions.get(id) !== undefined
      if (live || agent?.status === 'running' || agent?.inbox?.hasPending) continue
      ownedHandles.splice(i, 1)
      i -= 1
      handle?.dispose?.().catch(() => {})
    }
  }
  const inFlight = new Set()
  async function withAgent(id, fn) {
    if (inFlight.has(id)) throw fail(409, 'another edit is running on this session; retry in a moment')
    inFlight.add(id)
    try { return await withAgentInner(id, fn) } finally { inFlight.delete(id) }
  }
  async function withAgentInner(id, fn) {
    // one durability checkpoint per operation: the job flushes when it wrote, the cold path flushes once otherwise
    const flushOnce = agent => { let done = false; return async () => { if (done) return; done = true; await ctx.sessions.flush(agent.session) } }
    const live = ctx.agents.get(id)
    if (live) {
      if (isSubagentSession(live.session.header)) throw fail(400, 'subagent sessions are read-only here')
      return fn(live, false, flushOnce(live))
    }
    const p = persistence()
    if (!p) throw fail(503, 'session persistence is not available in this deployment')
    const header = (await p.list()).find(h => h.id === id)
    if (!header) throw fail(404, 'session not found')
    if (isSubagentSession(header)) throw fail(400, 'subagent sessions are read-only here')
    let insp
    try { insp = await p.inspect(id) } catch (error) { throw fail(404, `session log cannot be read: ${String(error?.message ?? error).slice(0, 160)}`) }
    const { setup } = await presetSetup(insp.meta, insp.events)
    const handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: agentOptions(), ...(setup ? { setup } : {}) })
    const flush = flushOnce(handle.agent)
    try {
      return await fn(handle.agent, true, flush)
    } finally {
      try { await flush() } catch { /* dispose drains too */ }
      // The resumed agent is published like any other; if a prompt reached it meanwhile, keep it alive.
      if (handle.agent.status === 'running' || handle.agent.inbox?.hasPending === true) {
        ownedHandles.push(handle)
    releaseIdleHandles()
        log('warn', `session ${id} received work during an edit; its agent stays alive instead of being disposed`)
      } else {
        try { await handle.dispose() } catch (error) { log('warn', `dispose after edit failed: ${String(error?.message ?? error)}`) }
      }
    }
  }
  const runMaintenance = (agent, job) => {
    try { return agent.runMaintenance(job) } catch (error) { throw fail(409, `the agent is busy (${String(error?.message ?? error)}); wait for the turn to finish`) }
  }

  /**
   * Replace one inclusive surface range with a single user-role node, priced by the
   * shadow-price protocol. Boundaries must not split an assistant tool-call/result pair.
   */
  async function replaceRange(id, start, end, content, meta, expectedNodes) {
    await ready
    if (!peers.llm?.createUserMessage) throw fail(503, 'editing needs @deepseek-ai/dsh-llm resolvable from the plugin (run launcher/peer-links.mjs)')
    const meter = tokenMeter()
    if (!meter) throw fail(503, 'the token meter (ctx.tokenMeter) is not mounted, so the replaced range cannot be priced; the edit is refused rather than recorded with a wrong shadow price')
    const pairing = peers.compaction
    return withAgent(id, (agent, resumed, flush) => runMaintenance(agent, async () => {
      const session = agent.session
      const nodes = session.surface.nodes
      const si = nodes.indexOf(start)
      const ei = nodes.indexOf(end)
      if (si < 0 || ei < 0 || si > ei) throw fail(409, 'that message is no longer on the current surface (the session changed); reload and retry')
      // The pairing check is not optional: without it a replacement can split a tool call from its
      // result, which the model then reads as a call that never returned.
      if (!pairing?.toolPairingBalancedBefore || !pairing?.toolPairingBalancedAfter) {
        throw fail(503, 'this deployment does not expose @deepseek-ai/dsh-compaction, so a replacement cannot be checked for tool-call pairing')
      }
      if (!pairing.toolPairingBalancedBefore(session, start)) throw fail(400, 'the range would split a tool call from its result; delete the whole turn instead')
      if (!pairing.toolPairingBalancedAfter(session, end)) throw fail(400, 'the range would split a step (or the step is still open); delete the whole turn instead')
      const shadowedSeqs = nodes.slice(si, ei + 1)
      if (expectedNodes && (shadowedSeqs.length !== expectedNodes.length || shadowedSeqs.some((seq, i) => seq !== expectedNodes[i]))) throw fail(409, 'the selected surface range changed; reload and retry')
      let shadowedTokenCount = 0
      for (const seq of shadowedSeqs) {
        const msg = typeof session.deriveEventMessage === 'function' ? session.deriveEventMessage(session.events[seq]) : null
        if (msg) shadowedTokenCount += meter.estimateMessage(msg)
      }
      const message = peers.llm.createUserMessage({ content, source: { kind: 'plugin', plugin: V.EDIT_PLUGIN, ...meta } })
      session.append('compaction/prune', { shadowedRange: { start, end }, shadowedSeqs: [...shadowedSeqs], shadowedTokenCount })
      const replacement = session.append('user/message', message, { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: [...shadowedSeqs] })
      try { await flush() } catch (error) { throw fail(500, `the edit is committed (seq ${replacement.seq}) but the session could not be saved yet: ${String(error?.message ?? error).slice(0, 160)}`) }
      return { ok: true, resumed, replacementSeq: replacement.seq, shadowedSeqs: [...shadowedSeqs], shadowedTokenCount, newTokenCount: meter.estimateMessage(message) }
    }))
  }

  /** Branch the conversation before a message's turn, the way the core's own fork RPC does. */
  async function forkAt(id, seq, text) {
    await ready
    const { header, events } = await readSession(id)
    if (isSubagentSession(header)) throw fail(400, 'subagent sessions are read-only here')
    const target = V.findMessage(events, { seq })
    if (!target) throw fail(404, `no message at seq ${seq}`)
    const { forkBoundaryBefore } = V.turnIndex(events)
    const boundary = forkBoundaryBefore(seq)
    if (boundary === undefined) throw fail(409, 'this message belongs to the first turn; there is nothing before it to branch from')
    // Trailing standalone events (titles, injections) up to the next turn/start ride along,
    // exactly like the core's fork: the seed stays balanced.
    let cut = boundary + 1
    while (cut < events.length && events[cut]?.type !== 'turn/start') cut++
    const { setup, presetId } = await presetSetup(header, events.slice(0, cut))
    const childId = `session-${randomUUID()}`
    const handle = await ctx.agents.create({
      sessionId: childId,
      seed: events.slice(0, cut),
      meta: {
        ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
        parentSession: id,
        seedLength: cut,
        ...(presetId === undefined ? {} : { agentPreset: presetId }),
      },
      agentOptions: agentOptions(),
      ...(setup ? { setup } : {}),
    })
    ownedHandles.push(handle)
    releaseIdleHandles()
    // The child joins the parent's workspace so it shows up in the same list.
    try {
      const ws = ctx.get('workspaceRegistry')?.list?.().find(w => w.sessionIds.includes(id))
      if (ws) await ws.attachSession(childId)
    } catch (error) { log('warn', `fork ${childId} could not join the parent's workspace: ${String(error?.message ?? error)}`) }
    let sent = false
    if (typeof text === 'string' && text.trim().length > 0 && peers.llm?.createUserMessage) {
      handle.agent.send(peers.llm.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), 'next-turn', true)
      sent = true
    }
    try { await ctx.sessions.flush(handle.agent.session) } catch { /* the child keeps running; persistence drains later */ }
    return { ok: true, sessionId: childId, boundary, seedLength: cut, sent }
  }

  // ── HTTP ──
  const hostOf = req => { const h = String(req.headers.host ?? '').trim().toLowerCase(); const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h); return m ? `[${m[1]}]` : h.replace(/:\d+$/, '') }
  const rejectCrossSite = req => {
    if (!LOOPBACK_HOSTS.has(hostOf(req))) return true
    if (String(req.headers['sec-fetch-site'] ?? '') === 'cross-site') return true
    const origin = req.headers.origin
    if (String(req.headers['sec-fetch-site'] ?? '') === 'same-site') return true   // another local port is not us
    if (typeof origin === 'string' && origin.length > 0) {
      try { if (new URL(origin).host.toLowerCase() !== String(req.headers.host ?? '').toLowerCase()) return true } catch { return true }
    }
    if (req.method === 'POST' && !/^application\/json/i.test(String(req.headers['content-type'] ?? ''))) return true
    return false
  }
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let over = false
    let settled = false
    const failWith = (status, message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status })) } }
    req.on('data', c => {
      if (over) return
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
      bytes += buf.length
      if (bytes > MAX_BODY) { over = true; chunks.length = 0; req.resume(); failWith(413, 'body too large'); return }
      chunks.push(buf)
    })
    req.on('end', () => {
      if (over || settled) return
      settled = true
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        const value = text ? JSON.parse(text) : {}
        if (value === null || typeof value !== 'object' || Array.isArray(value)) { reject(Object.assign(new Error('JSON body must be an object'), { status: 400 })); return }
        resolve(value)
      } catch { reject(Object.assign(new Error('invalid JSON body'), { status: 400 })) }
    })
    req.on('aborted', () => failWith(400, 'request aborted'))
    req.on('error', () => failWith(400, 'request error'))
  })
  const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
  const sessionIdOf = value => { const id = String(value ?? ''); if (!SESSION_ID.test(id)) throw fail(400, 'invalid session id'); return id }
  const textOf = value => { const t = String(value ?? ''); if (t.trim().length === 0) throw fail(400, 'text must not be empty'); if (t.length > MAX_TEXT) throw fail(400, `text longer than ${MAX_TEXT} characters`); return t }

  const route = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname
    try {
      if (rejectCrossSite(req)) { req.resume?.(); return json(res, 403, { ok: false, message: 'same-origin JSON requests only' }) }

      if (req.method === 'GET' && p === '/dsh-chat-editor/status') {
        await ready
        return json(res, 200, {
          ok: true,
          peers: { llm: !!peers.llm?.createUserMessage, compaction: !!peers.compaction?.toolPairingBalancedBefore },
          services: { persistence: !!persistence(), tokenMeter: !!tokenMeter(), agentPresets: !!presetsService() },
          sessionsWithOverrides: Object.keys(doc.sessions).length,
          editsFile: EDITS_FILE,
        })
      }

      if (req.method === 'GET' && p === '/dsh-chat-editor/overrides') {
        const id = sessionIdOf(url.searchParams.get('sessionId'))
        const { events } = await readSession(id)
        return json(res, 200, { ok: true, sessionId: id, overrides: effectiveOverrides(events, overridesFor(doc, id)) })
      }

      if (req.method === 'GET' && p === '/dsh-chat-editor/messages') {
        const id = sessionIdOf(url.searchParams.get('sessionId'))
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 500))
        const { header, events, live } = await readSession(id)
        const messages = editableMessages(events, { limit })
        const ov = new Map(effectiveOverrides(events, overridesFor(doc, id)).map(o => [o.seq, o]))
        for (const m of messages) {
          const o = ov.get(m.seq)
          // All three switches, not a two-way projection: dropping `collapsed` here is what made
          // the panel's collapse button one-way — it could never see that the fold was already on.
          if (o) {
            m.override = {
              ...(o.hidden === true ? { hidden: true } : {}),
              ...(o.collapsed === true ? { collapsed: true } : {}),
              ...(typeof o.text === 'string' && o.text.length > 0 ? { text: o.text } : {}),
            }
          }
        }
        return json(res, 200, {
          ok: true, sessionId: id, live, running: ctx.agents.get(id)?.status === 'running',
          cwd: header.cwd ?? '', origin: header.origin, editable: !isSubagentSession(header),
          openTurn: V.turnIndex(events).openTurn, messages,
        })
      }

      if (req.method === 'POST' && p === '/dsh-chat-editor/display') {
        const body = await readBody(req)
        const id = sessionIdOf(body.sessionId)
        const seq = Number(body.seq)
        if (!Number.isSafeInteger(seq) || seq < 0) throw fail(400, 'seq must be a non-negative integer')
        const clearing = body.hidden !== true && body.collapsed !== true && (typeof body.text !== 'string' || body.text.trim().length === 0)
        let original = typeof body.original === 'string' ? body.original : ''
        let role = ''
        let baseEditSeq = -1
        if (!clearing) {
          const { events } = await readSession(id)
          const event = V.findMessage(events, { seq })
          if (!event) throw fail(404, `no message at seq ${seq}`)
          const record = editState(events).records.get(seq)
          if (record?.hidden && typeof body.text === 'string') throw fail(400, 'this message was deleted; it cannot be restored by a display edit')
          baseEditSeq = record?.revision ?? -1
          role = V.roleOf(event)
          if (original.trim().length === 0) original = V.messageText(event)
          if (original.trim().length === 0) throw fail(400, 'this message has no text to anchor a display override on')
        }
        saveDoc(setOverride(doc, id, seq, { original, text: body.text, hidden: body.hidden === true, collapsed: body.collapsed === true, role, baseEditSeq }))
        return json(res, 200, { ok: true, overrides: overridesFor(doc, id) })
      }

      if (req.method === 'POST' && p === '/dsh-chat-editor/clear') {
        const body = await readBody(req)
        const id = sessionIdOf(body.sessionId)
        const seq = Number.isSafeInteger(body.seq) ? body.seq : undefined
        saveDoc(clearOverrides(doc, id, seq))
        return json(res, 200, { ok: true, overrides: overridesFor(doc, id) })
      }

      if (req.method === 'POST' && p === '/dsh-chat-editor/context/edit') {
        const body = await readBody(req)
        const id = sessionIdOf(body.sessionId)
        const seq = Number(body.seq)
        const text = textOf(body.text)
        const { events } = await readSession(id)
        const event = V.findMessage(events, { seq })
        if (!event) throw fail(404, `no message at seq ${seq}`)
        const target = resolveEditTarget(events, seq)
        const role = target.role
        if (role === 'tool') throw fail(400, 'tool results are not editable here (their content belongs to the tool that produced it)')
        if (role === 'checkpoint') throw fail(400, 'compaction summaries are edited on the launcher\'s Memory & context page')
        const result = await replaceRange(id, target.activeSeq, target.activeSeq, V.editedContent(role, text), { editedSeq: seq, editKind: 'edit', editedRole: role }, [target.activeSeq])
        return json(res, 200, { ...result, role })
      }

      if (req.method === 'POST' && p === '/dsh-chat-editor/context/delete') {
        const body = await readBody(req)
        const id = sessionIdOf(body.sessionId)
        const seq = Number(body.seq)
        const scope = body.scope === 'turn' ? 'turn' : 'message'
        const { events } = await readSession(id)
        const event = V.findMessage(events, { seq })
        if (!event) throw fail(404, `no message at seq ${seq}`)
        if (V.roleOf(event) === 'checkpoint') throw fail(400, 'compaction summaries are edited on the launcher\'s Memory & context page')
        const target = resolveEditTarget(events, seq)
        const range = scope === 'turn' ? activeTurnRange(events, seq) : { start: target.activeSeq, end: target.activeSeq, count: 1 }
        const nodes = V.foldNodes(events)
        const expectedNodes = nodes.slice(nodes.indexOf(range.start), nodes.indexOf(range.end) + 1)
        const result = await replaceRange(id, range.start, range.end, V.deletedContent(range.count), { editedSeq: seq, editKind: 'delete', deletedCount: range.count }, expectedNodes)
        return json(res, 200, { ...result, scope, count: range.count })
      }

      if (req.method === 'POST' && p === '/dsh-chat-editor/fork') {
        const body = await readBody(req)
        const id = sessionIdOf(body.sessionId)
        const seq = Number(body.seq)
        if (!Number.isSafeInteger(seq) || seq < 0) throw fail(400, 'seq must be a non-negative integer')
        const text = typeof body.text === 'string' && body.text.trim().length > 0 ? textOf(body.text) : undefined
        return json(res, 200, await forkAt(id, seq, text))
      }

      res.writeHead(404); res.end()
    } catch (error) {
      const msg = String(error?.message ?? error)
      if (res.headersSent) { log("warn", p + " failed after the response started: " + msg.slice(0, 200)); try { res.end() } catch { /* already closed */ } return }
      const st = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status
        : /must not be empty|invalid session id|anchor|at most/.test(msg) ? 400 : 500
      json(res, st, { ok: false, message: msg.slice(0, 600) })
    }
  }

  ctx.effect(() => {
    watchFile(EDITS_FILE, { interval: 1500 }, loadDoc).unref?.()
    return () => {
      unwatchFile(EDITS_FILE, loadDoc)
      // A hot-reload must not dispose a fork the user is still in: dispose() removes the session
      // from the store. Live ones are flushed and left to the deployment's own shutdown.
      // A live session is flushed and KEPT: dropping the handle here would mean nothing ever
      // disposes it. Only handles whose session has already left the store are released.
      const live = []
      for (const handle of ownedHandles.splice(0)) {
        const id = handle?.agent?.session?.id
        if (id !== undefined && ctx.sessions.get(id) !== undefined) {
          ctx.sessions.flush(handle.agent.session).catch(() => {})
          live.push(handle)
          continue
        }
        handle.dispose().catch(() => {})
      }
      ownedHandles.push(...live)
    }
  }, 'chat-editor: overrides watch')
  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: '/dsh-chat-editor', handler: route }), 'chat-editor: routes')
  })
  log('info', `loaded (${Object.keys(doc.sessions).length} session(s) with display overrides)`)
}
