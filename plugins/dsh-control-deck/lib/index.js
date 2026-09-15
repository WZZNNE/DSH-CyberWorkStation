/**
 * dsh-control-deck host plugin (v3) — SillyTavern-grade prompt / regex /
 * lorebook / sampling control for DeepSeek Harness. Everything goes through
 * documented extension points (systemPrompt.section, agent/pre-step,
 * agent/request, tools/pre-execute, webServer.register); no core behaviour is
 * patched.
 *
 * Reasoning effort stays out of the deck: the core model picker owns it (the
 * dsh-local-reasoning plugin teaches local models the levels).
 *
 * Injection model (mirrors the core's own time-context plugin):
 *  - prompts with position=system register prompt sections whose text is a
 *    provider evaluated at every assembly (fresh {{date}} etc.); macros are
 *    expanded by the deck, `{{provider}}` / `{{model}}` / `{{cwd}}` are left to
 *    the core's own variables, and any other leftover `{{…}}` is neutralised
 *    because the core renderer throws on unknown references;
 *  - user-prefix prompts, interval prompts and activated World Info are added as
 *    ONE separate plugin-sourced user-role message right after the user's own
 *    message at agent/pre-step (the user's words are never rewritten and the
 *    row renders as context, not as a user bubble);
 *  - user_input regex scripts rewrite only the user-typed messages of the step;
 *  - the lorebook scan reads current surface user / assistant turns from the session log (plugin
 *    context rows and earlier injections are not scanned, so an injection never
 *    re-triggers itself).
 *
 * Configuration: $DSH_HOME/control-deck.json, hot-reloaded with fs.watchFile
 * (unref'd so one-shot processes can still exit; unwatched on dispose). The DSH
 * Launcher edits it (tabs, presets, SillyTavern import/export). Lorebook timers
 * are kept in memory per agent id. The browser half (client.js) applies
 * display-only (ai_output) regex rules served at GET /dsh-control-deck/display-regex.json.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileSync, watchFile, unwatchFile } from 'node:fs'
import { join, basename } from 'node:path'
import { normalizeDeck, compileRules, brokenRules, expandMacros, neutralizeBraces, displayRules, requiredHistoryDepth } from './deck.js'
import { createDeckRunner } from './deck-runner.js'
import { visibleConversationHistory } from './history.js'
import { liveEvents } from '@dsh-suite/kit/session-read'
import { isLoopbackRequest, refuse, json } from '@dsh-suite/kit/fence'

export const name = 'control-deck'
// webServer is NOT required: a headless profile has none, and the deck's prompts/tools still apply there.
export const inject = ['systemPrompt', 'tools']

const DECK_FILE = join(resolveDshHome(), 'control-deck.json')

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  let deck = normalizeDeck(null)
  // Kept for `/status` and for the "is there anything to do" gates; the worker re-filters
  // `deck.regex` itself, because it is the one that applies them.
  let userRules = []
  /**
   * The deck's rules and lorebook keys are user-authored (a SillyTavern import brings in other
   * people's) and they run against whatever the user just typed, on the agent's hot path, where a
   * regular expression cannot be interrupted once it has started. Measuring a pattern first does not
   * bound it — the measurement is never the same work as the run — so the engine itself runs in a
   * worker with a deadline, on the real inputs. When it overruns, the worker is killed and the deck
   * does nothing that turn: the message goes through unrewritten and the lorebook does not fire.
   */
  const runner = createDeckRunner({
    timeoutMs: 250,
    onTimeout: job => console.warn(`[control-deck] ${job?.op === 'lore' ? 'the lorebook scan' : 'a regex rule'} took too long on this message and was skipped`),
  })
  const skipped = []
  // Patterns that overran on some message: parked until the deck is next loaded, because retrying
  // them costs a worker terminate and respawn on every message for as long as they are in the deck.
  const parked = new Set()
  let loreParked = false
  const ruleKey = rule => `${rule.flags}\u0000${rule.findRegex}`
  const noteSkipped = what => {
    if (!skipped.includes(what)) skipped.push(what)
    if (skipped.length > 8) skipped.shift()
  }

  /**
   * Rewrite `texts` with the deck's rules for `placement`, inside the worker. All the rules go in
   * one job; if that job overruns, they are retried one at a time so a single bad pattern costs only
   * itself — and the rule that overran is named for the user.
   */
  async function rewrite(texts, placement) {
    if (texts.length === 0) return texts
    const enabled = deck.regex.filter(r => r.enabled && r.placement.includes(placement) && !parked.has(ruleKey(r)))
    if (enabled.length === 0) return texts
    const all = await runner.run({ op: 'rules', regex: enabled, placement, texts })
    if (Array.isArray(all) && all.length === texts.length) return all
    // One of them overran. Retry singly so a single bad pattern costs only itself — but stop after a
    // few failures: a hostile import of thirty such patterns would otherwise buy 30 × the deadline.
    let out = texts
    let overruns = 0
    let tried = 0
    for (const rule of enabled) {
      // Two bounds: on how many bad patterns are found, and on how much of the deck is retried at
      // all. A deck that is slow in aggregate (forty rules that are each fine) must not pay N round
      // trips per message either.
      if (overruns >= 3 || tried >= 12) { noteSkipped(`${enabled.length - enabled.indexOf(rule)} more rule(s), not tried`); break }
      tried += 1
      const once = await runner.run({ op: 'rules', regex: [rule], placement, texts: out })
      if (Array.isArray(once) && once.length === out.length) { out = once; continue }
      overruns += 1
      parked.add(ruleKey(rule))
      noteSkipped(`rule "${rule.name || String(rule.findRegex).slice(0, 40)}" (parked until the deck is saved again)`)
    }
    // The batch overran but no single rule did: the deck is slow in aggregate, so park the lot until
    // it is edited rather than paying for it on every message.
    if (overruns === 0) {
      for (const rule of enabled) parked.add(ruleKey(rule))
      noteSkipped(`the ${placement} rules together took too long (parked until the deck is saved again)`)
    }
    return out
  }

  // `@deepseek-ai/dsh-llm` builds a message the core accepts as its own; without it the injection
  // has to be prefixed onto the user's text instead of standing as its own plugin-sourced message.
  let createUserMessage = null
  let fallbackWarned = false
  const llmReady = import('@deepseek-ai/dsh-llm')
    .then(m => { createUserMessage = m.createUserMessage ?? null })
    .catch(() => { createUserMessage = null })

  /**
   * The SillyTavern macro variables this deck fills in. `{{provider}}`, `{{model}}` and `{{cwd}}` are
   * also the core's own variables, so they are read from the request header the agent recorded when
   * there is one and from its options otherwise.
   */
  const assembledVars = new WeakMap()
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    if (context?.agent) assembledVars.set(context.agent, { signal: context.signal, variables: { ...result.variables } })
    return result
  }, { prepend: true })
  const macroVars = (agent, signal) => {
    const header = typeof agent?.session?.requestHeader === 'function' ? agent.session.requestHeader()?.config : undefined
    const captured = agent && assembledVars.get(agent)
    const current = captured && captured.signal === signal ? captured.variables : undefined
    const cwd = agent?.session?.header?.cwd
    return {
      provider: current?.provider ?? header?.provider ?? agent?.options?.provider ?? '',
      model: current?.model ?? header?.model ?? agent?.options?.model ?? '',
      cwd: typeof cwd === 'string' ? cwd : '',
      workspace: typeof cwd === 'string' ? basename(cwd) : '',
    }
  }

  let loadedAt = 0
  let loadError = ''
  let sectionErrors = []
  let promptDisposers = []
  const loreState = new Map()      // agent id → lorebook timers; trimmed in `rememberLore`
  let loreShape = ''              // the entries the timers were keyed against, so a reload can reset them

  ctx.effect(() => () => runner.dispose(), 'control-deck: deck worker')

  const loadDeck = () => {
    let raw = null
    loadError = ''
    try { raw = JSON.parse(readFileSync(DECK_FILE, 'utf8')) } catch (error) { loadError = String(error?.code === 'ENOENT' ? '' : error?.message ?? '') }
    deck = normalizeDeck(raw)
    parked.clear()
    loreParked = false
    skipped.length = 0
    if (JSON.stringify(deck.lorebook.map(e => [e.uid, e.name])) !== loreShape) { loreState.clear(); loreShape = JSON.stringify(deck.lorebook.map(e => [e.uid, e.name])) }
    userRules = compileRules(deck.regex, 'user_input')
    for (const d of promptDisposers) { try { d() } catch { /* already disposed */ } }
    promptDisposers = []
    sectionErrors = []
    for (const p of deck.prompts) {
      if (!p.enabled || p.position !== 'system' || p.interval > 1) continue
      // Provider text: macros are fresh per assembly. With the agent in the assembly context every macro is
      // expanded here (nothing is left for the core renderer); without it provider / model / cwd stay as the
      // core's own variables. Either way no unknown {{…}} survives.
      const text = context => {
        const agent = context?.agent
        if (!deck.settings.macros) return neutralizeBraces(p.text) // macros off: only the core's own {{provider}} / {{model}} / {{cwd}} stay live
        // The model picker finalizes these variables after section providers run.
        // Keep them for the core's final interpolation, including on the first request.
        const vars = { ...(agent ? macroVars(agent) : {}), provider: '{{provider}}', model: '{{model}}', cwd: '{{cwd}}' }
        return neutralizeBraces(expandMacros(p.text, vars))
      }
      try {
        promptDisposers.push(ctx.systemPrompt.section({ name: 'control-deck:' + p.name, order: p.order, text }))
      } catch (error) {
        // Never let a bad entry take the watcher (and with it the process) down.
        sectionErrors.push({ name: p.name, error: String(error?.message ?? error) })
      }
    }
    loadedAt = Date.now()
    const broken = [...brokenRules(deck.regex, 'user_input'), ...brokenRules(deck.regex, 'world_info')]
    console.log(`[control-deck] loaded${deck.presetName ? ` preset "${deck.presetName}"` : ''}: ${deck.prompts.length} prompts, ${deck.regex.length} regex, ${deck.lorebook.length} lore, tools-off=${deck.disabledTools.length}${broken.length ? `, ${broken.length} regex rule(s) failed to compile` : ''}${sectionErrors.length ? `, ${sectionErrors.length} section(s) rejected` : ''}`)
  }
  const safeLoad = () => { try { loadDeck() } catch (error) { loadError = String(error?.message ?? error); console.warn(`[control-deck] reload failed: ${loadError}`) } }
  safeLoad()
  ctx.effect(() => { watchFile(DECK_FILE, { interval: 1500 }, safeLoad).unref?.(); return () => unwatchFile(DECK_FILE, safeLoad) }, 'dsh-control-deck: deck file watch')
  ctx.effect(() => () => { for (const d of promptDisposers) { try { d() } catch { /* noop */ } } }, 'control-deck: dispose sections')

  // One entry per agent, for the process lifetime, is a slow leak in a long-lived harness.
  const MAX_LORE_SESSIONS = 200
  const rememberLore = (sid, state) => {
    loreState.delete(sid)
    loreState.set(sid, state)          // re-inserted last: Map keeps insertion order, so this is LRU
    while (loreState.size > MAX_LORE_SESSIONS) loreState.delete(loreState.keys().next().value)
  }

  const textOf = content => (Array.isArray(content) ? content : []).map(b => (b?.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
  const isUserTyped = m => m && m.role !== 'assistant' && (m.source === undefined || m.source?.kind === 'user') && Array.isArray(m.content)

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    let messages = decision.messages
    const vars = macroVars(payload.agent, payload.signal)
    const mac = t => (deck.settings.macros ? expandMacros(t, vars) : t)

    // user_input regex scripts: only the user's own messages of this step (never context snapshots / tool results).
    if (userRules.length > 0) {
      // Every text block of every user-typed message, rewritten in the worker: one job, so a rule
      // that only misbehaves on the second block, or on the first rule's output, is still bounded.
      const blocksIn = []
      for (const m of messages) {
        if (!isUserTyped(m)) continue
        for (const b of m.content) if (b.type === 'text') blocksIn.push(b.text)
      }
      const rewritten = await rewrite(blocksIn, 'user_input')
      if (Array.isArray(rewritten) && rewritten.length === blocksIn.length) {
        let take = 0
        messages = messages.map(m => (isUserTyped(m)
          ? { ...m, content: m.content.map(b => (b.type === 'text' ? { ...b, text: rewritten[take++] } : b)) }
          : m))
      }
    }

    // Only a step carrying a user-typed message counts as "a user message" for intervals / timers / scans.
    let at = -1
    for (let i = messages.length - 1; i >= 0; i--) if (isUserTyped(messages[i])) { at = i; break }
    if (at < 0) return { kind: 'enter', messages }
    const sid = String(payload.agent?.id ?? 'default')
    const st = loreState.get(sid) ?? { msgCount: 0, timers: {} }
    st.msgCount = (st.msgCount ?? 0) + 1

    const blocks = []
    for (const p of deck.prompts) {
      if (!p.enabled) continue
      if (p.position === 'user-prefix' || (p.position === 'system' && p.interval > 1)) {
        if (st.msgCount % p.interval === 0) blocks.push(mac(p.text))
      }
    }
    if (deck.lorebook.length > 0) {
      // SillyTavern scanDepth semantics: the scan buffer is the last N user / assistant turns from the
      // session log (optionally name-prefixed) plus this step's user-typed messages. Plugin context rows
      // (earlier injections, snapshots) are skipped so an injection can never re-trigger itself.
      const current = messages.filter(isUserTyped).map(m => textOf(m.content)).join('\n')
      const needed = requiredHistoryDepth(deck)
      const events = liveEvents(payload.agent?.session)
      const history = visibleConversationHistory(events, needed, deck.settings.includeNames)
      // The whole scan runs in the worker: a key is matched against the constant entries and the
      // recursion buffer too, which is text no measurement of the message could have covered.
      // Parked like a rule: the scan is one job, so a key that overruns would otherwise cost a
      // terminate and a respawn on every later message and the lorebook would never fire again.
      const scanned = loreParked ? null : await runner.run({ op: 'lore', deck, scan: { history, current }, state: st })
      if (scanned === null && !loreParked) { loreParked = true; noteSkipped('the lorebook scan (parked until the deck is saved again)') }
      const { activated, state } = scanned ?? { activated: [], state: st }
      rememberLore(sid, state)
      if (activated.length > 0) {
        const expanded = activated.map(e => mac(e.content))
        const rewritten = await rewrite(expanded, 'world_info')
        blocks.push('[World Info]\n' + rewritten.join('\n'))
      }
    } else {
      rememberLore(sid, st)
    }

    if (blocks.length === 0) return { kind: 'enter', messages }
    const text = blocks.join('\n\n')
    await llmReady
    if (createUserMessage === null) {
      if (!fallbackWarned) { fallbackWarned = true; console.warn('[control-deck] @deepseek-ai/dsh-llm not resolvable: injecting into the user text instead of a separate context message (run launcher/peer-links.mjs)') }
      // dsh-llm not resolvable (no peer link): fall back to prefixing the user's text so the feature still works.
      const target = messages[at]
      const idx = target.content.findIndex(b => b.type === 'text')
      if (idx < 0) return { kind: 'enter', messages }
      const content = target.content.map((b, i) => (i === idx ? { ...b, text: `${text}\n\n${b.text}` } : b))
      return { kind: 'enter', messages: messages.map((m, i) => (i === at ? { ...m, content } : m)) }
    }
    const injected = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: name } })
    return { kind: 'enter', messages: [...messages.slice(0, at + 1), injected, ...messages.slice(at + 1)] }
  })

  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const s = deck.sampling
    if (!s.enabled) return config // master switch off: merge nothing, so nothing leaks by accident
    return {
      ...config,
      ...(s.temperature !== undefined ? { temperature: s.temperature } : {}),
      ...(s.maxTokens !== undefined ? { maxTokens: s.maxTokens } : {}),
      ...(s.stop.length > 0 ? { stop: s.stop } : {}),
    }
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (deck.disabledTools.includes(exec.name)) {
      return { kind: 'deny', reason: `The tool "${exec.name}" is disabled in the DSH Control Deck for this deployment. Do not retry it; continue without it or tell the user it is switched off.` }
    }
    return next()
  })

  // Browser half support + diagnostics for the launcher.
  const route = (req, res) => {
    if (!isLoopbackRequest(req)) return refuse(req, res)
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/dsh-control-deck/display-regex.json') return json(res, 200, { rules: displayRules(deck.regex) })
    if (req.method === 'GET' && url.pathname === '/dsh-control-deck/status') {
      return json(res, 200, {
        loadedAt, loadError, presetName: deck.presetName, skippedWork: [...skipped],
        counts: { prompts: deck.prompts.length, regex: deck.regex.length, lorebook: deck.lorebook.length, disabledTools: deck.disabledTools.length, displayRules: displayRules(deck.regex).length },
        broken: { regex: [...brokenRules(deck.regex, 'user_input'), ...brokenRules(deck.regex, 'world_info'), ...brokenRules(deck.regex, 'ai_output')].filter((r, i, a) => a.findIndex(x => x.name === r.name) === i), sections: sectionErrors },
        separateMessages: createUserMessage !== null, // false = @deepseek-ai/dsh-llm unresolved → injections prefix the user text
        sampling: deck.sampling, settings: deck.settings, sessions: loreState.size,
      })
    }
    res.writeHead(404); res.end()
  }
  ctx.inject(['webServer'], sub => { sub.effect(() => sub.webServer.register({ kind: 'prefix', path: '/dsh-control-deck', handler: route }), 'dsh-control-deck: routes') })
}
