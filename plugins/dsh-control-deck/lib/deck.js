/**
 * Control Deck pure engine (v3) — semantics aligned with SillyTavern:
 *  - Prompt entries: role (system|user|assistant, an annotation that round-trips to ST), position
 *    (system|user-prefix), order, interval (every N user messages), enabled; macros.
 *  - Regex scripts: findRegex / flags (used as given — no `g` means first match only, like ST's
 *    regexFromString) / replaceString ({{match}} case-insensitively = $0, $N with any number of
 *    digits, $<name>; there is no `$$` escape — `$$5` is "$" + group 5 — and `$&` is literal text,
 *    exactly as ST's runRegexScript) / trimStrings (removed from every substituted value) / placement (user_input | world_info | ai_output — ai_output is a
 *    display-only rewrite done by the browser half)
 *    (reference: SillyTavern public/scripts/extensions/regex/engine.js runRegexScript)
 *  - World Info: keys (plain text or /regex/flags), secondaryKeys + selectiveLogic (andAny / andAll /
 *    notAny / notAll), constant, probability, order, caseSensitive / matchWholeWords (per entry,
 *    `null` = the global setting), per-entry scanDepth, recursion (exclude / prevent / delay —
 *    boolean or a recursion level — + maxRecursionSteps), inclusion group + groupWeight + prioritize
 *    (ST groupOverride) + useGroupScoring, sticky / cooldown / delay (in user messages), global
 *    includeNames, minActivations + maxDepth, character budget
 *    (reference: docs.sillytavern.app/usage/core-concepts/worldinfo, public/scripts/world-info.js)
 *  - Macros (subset of ST macros): {{date}} {{time}} {{weekday}} {{isodate}} {{isotime}} {{model}}
 *    {{provider}} {{workspace}} {{cwd}} {{newline}} {{random:a,b,c}} / {{random::a::b}} {{roll:NdM}}
 * Pure functions throughout; randomness comes through an injected rng so tests are deterministic.
 */

const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt }
const strArr = v => (Array.isArray(v) ? v.map(x => String(x)).filter(x => x.length > 0) : [])
const triBool = v => (v === true ? true : v === false ? false : null)

export const REGEX_PLACEMENTS = ['user_input', 'world_info', 'ai_output']
export const PROMPT_ROLES = ['system', 'user', 'assistant']
const FLAGS_OK = /^(?!.*(.).*\1)[gimsuy]*$/

/** Normalise the raw config; invalid fields fall back to defaults and nothing ever throws (hot-reload tolerance). */
export function normalizeDeck(raw) {
  const o = raw !== null && typeof raw === 'object' ? raw : {}
  const arr = v => (Array.isArray(v) ? v : [])

  const prompts = arr(o.prompts).map((p, i) => {
    const position = p?.position === 'user-prefix' ? 'user-prefix' : 'system'
    const name = String(p?.name ?? '').trim().slice(0, 60)
    return {
      name: name.length > 0 ? name : 'prompt-' + (i + 1),
      order: clampNum(p?.order, -100000, 100000, 100 + i),
      text: typeof p?.text === 'string' ? p.text : '',
      position,
      role: PROMPT_ROLES.includes(p?.role) ? p.role : (position === 'user-prefix' ? 'user' : 'system'),
      interval: clampNum(p?.interval, 1, 999, 1), // inject once every N user messages (SillyTavern Author's Note interval)
      enabled: p?.enabled !== false,
    }
  }).filter(p => p.text.length > 0)
  // Section names must be unique (a duplicate registration throws in the core): suffix repeats.
  const seen = new Map()
  for (const p of prompts) {
    const n = seen.get(p.name) ?? 0
    seen.set(p.name, n + 1)
    if (n > 0) p.name = `${p.name} (${n + 1})`.slice(0, 70)
  }

  const regex = arr(o.regex).map((r, i) => {
    const name = String(r?.name ?? '').trim().slice(0, 60)
    return {
      name: name.length > 0 ? name : 'regex-' + (i + 1),
      findRegex: typeof r?.findRegex === 'string' ? r.findRegex : (typeof r?.pattern === 'string' ? r.pattern : ''),
      flags: typeof r?.flags === 'string' && FLAGS_OK.test(r.flags) ? r.flags : (typeof r?.flags === 'string' ? '' : 'g'),
      replaceString: typeof r?.replaceString === 'string' ? r.replaceString : (typeof r?.replace === 'string' ? r.replace : ''),
      trimStrings: strArr(r?.trimStrings),
      placement: arr(r?.placement).filter(x => REGEX_PLACEMENTS.includes(x)),
      enabled: r?.enabled !== false && r?.disabled !== true,
    }
  }).map(r => ({ ...r, placement: r.placement.length > 0 ? r.placement : ['user_input'] }))
    .filter(r => r.findRegex.length > 0)

  const lorebook = arr(o.lorebook).map((e, i) => {
    const name = String(e?.name ?? '').trim().slice(0, 60)
    const dur = e?.delayUntilRecursion
    return {
      // The file's own uid when it has one (a SillyTavern world-info export does): the array
      // position shifts when an entry is inserted, and the sticky/cooldown timers are keyed on this.
      uid: Number.isFinite(Number(e?.uid ?? e?.id)) ? Number(e.uid ?? e.id) : i,
      name: name.length > 0 ? name : 'entry-' + (i + 1),
      keys: strArr(e?.keys ?? e?.keywords),
      secondaryKeys: strArr(e?.secondaryKeys),
      selectiveLogic: ['andAny', 'andAll', 'notAny', 'notAll'].includes(e?.selectiveLogic) ? e.selectiveLogic : 'andAny',
      content: typeof e?.content === 'string' ? e.content : '',
      constant: e?.constant === true,
      probability: clampNum(e?.probability, 0, 100, 100),
      order: clampNum(e?.order, -100000, 100000, 100),
      position: e?.position === 'user-prefix' ? 'user-prefix' : 'system',
      caseSensitive: triBool(e?.caseSensitive),      // null = global setting
      matchWholeWords: triBool(e?.matchWholeWords),  // null = global setting
      scanDepth: e?.scanDepth === undefined || e?.scanDepth === null || e?.scanDepth === '' ? undefined : clampNum(e.scanDepth, 0, 100, undefined),
      excludeRecursion: e?.excludeRecursion === true,
      preventRecursion: e?.preventRecursion === true,
      delayUntilRecursion: dur === true ? true : (Number.isInteger(dur) && dur > 0 ? Math.min(dur, 10) : false),
      group: typeof e?.group === 'string' ? e.group.slice(0, 40) : '',
      groupWeight: clampNum(e?.groupWeight, 1, 10000, 100),
      prioritize: e?.prioritize === true,
      useGroupScoring: e?.useGroupScoring === true,
      sticky: clampNum(e?.sticky, 0, 9999, 0),
      cooldown: clampNum(e?.cooldown, 0, 9999, 0),
      delay: clampNum(e?.delay, 0, 9999, 0),
      enabled: e?.enabled !== false,
    }
  }).filter(e => e.content.length > 0 && (e.constant || e.keys.length > 0))

  const s = o.sampling !== null && typeof o.sampling === 'object' ? o.sampling : {}
  const sampling = {
    enabled: s.enabled === true, // master switch, default off: nothing is merged into requests unless explicitly enabled
    temperature: clampNum(s.temperature, 0, 2, undefined),
    maxTokens: clampNum(s.maxTokens, 1, 1000000, undefined),
    stop: strArr(s.stop).slice(0, 4),
  }
  const disabledTools = strArr(o.disabledTools).filter(t => /^[\w-]+$/.test(t))
  const settings = {
    scanDepth: clampNum(o.scanDepth ?? o.settings?.scanDepth, 0, 100, 6),
    maxRecursionSteps: clampNum(o.settings?.maxRecursionSteps, 1, 10, 2),
    budgetChars: clampNum(o.settings?.budgetChars, 200, 100000, 8000),
    includeNames: o.settings?.includeNames === true,
    minActivations: clampNum(o.settings?.minActivations, 0, 100, 0),
    maxDepth: clampNum(o.settings?.maxDepth, 0, 1000, 0),
    macros: o.settings?.macros !== false,
    caseSensitive: o.settings?.caseSensitive === true,        // ST global "Case-sensitive" (default off)
    matchWholeWords: o.settings?.matchWholeWords !== false,   // ST global "Match whole words" (default on)
  }
  const presetName = typeof o.presetName === 'string' ? o.presetName.slice(0, 60) : ''
  return { prompts, regex, lorebook, sampling, disabledTools, settings, presetName }
}

/**
 * Problems a human should hear about before saving (normalizeDeck silently tolerates them so a hot
 * reload never fails): invalid regex patterns / flags, entries that would be dropped, duplicate names.
 */
export function validateDeck(raw) {
  const problems = []
  const o = raw !== null && typeof raw === 'object' ? raw : {}
  const arr = v => (Array.isArray(v) ? v : [])
  arr(o.regex).forEach((r, i) => {
    const label = `regex #${i + 1}${r?.name ? ` "${r.name}"` : ''}`
    const pattern = typeof r?.findRegex === 'string' ? r.findRegex : (typeof r?.pattern === 'string' ? r.pattern : '')
    if (pattern.length === 0) { problems.push(`${label}: empty find pattern (entry is dropped)`); return }
    const flags = typeof r?.flags === 'string' ? r.flags : 'g'
    if (!FLAGS_OK.test(flags)) problems.push(`${label}: invalid flags "${flags}" (use a combination of g i m s u y)`)
    else { try { new RegExp(pattern, flags) } catch (error) { problems.push(`${label}: ${String(error?.message ?? error)}`) } }
    for (const p of arr(r?.placement)) if (!REGEX_PLACEMENTS.includes(p)) problems.push(`${label}: unknown placement "${String(p)}"`)
  })
  arr(o.lorebook).forEach((e, i) => {
    const label = `lorebook #${i + 1}${e?.name ? ` "${e.name}"` : ''}`
    if (typeof e?.content !== 'string' || e.content.length === 0) problems.push(`${label}: empty content (entry is dropped)`)
    else if (e?.constant !== true && strArr(e?.keys ?? e?.keywords).length === 0) problems.push(`${label}: no keys and not constant (entry is dropped)`)
    for (const k of strArr(e?.keys ?? e?.keywords)) {
      const rx = /^\/(.+)\/([gimsuy]*)$/.exec(k)
      if (rx) { try { new RegExp(rx[1], rx[2]) } catch { problems.push(`${label}: invalid regex key ${k}`) } }
    }
  })
  arr(o.prompts).forEach((p, i) => { if (typeof p?.text !== 'string' || p.text.length === 0) problems.push(`prompt #${i + 1}${p?.name ? ` "${p.name}"` : ''}: empty text (entry is dropped)`) })
  const names = arr(o.prompts).map(p => String(p?.name ?? '').trim()).filter(Boolean)
  const dup = names.filter((n, i) => names.indexOf(n) !== i)
  if (dup.length > 0) problems.push(`duplicate prompt names are suffixed: ${[...new Set(dup)].join(', ')}`)
  return problems
}

// ── Macros (SillyTavern subset) ──────────────────────────────────────────────
/**
 * Expand {{macros}} in a text. `vars` supplies model/provider/workspace/cwd; `now`
 * and `rng` are injectable for tests. Unknown macros — and agent-scoped ones without a value — are
 * left untouched (see neutralizeBraces for the system-prompt path).
 */
export function expandMacros(text, vars = {}, now = new Date(), rng = Math.random) {
  if (typeof text !== 'string' || !text.includes('{{')) return text
  const pad = n => String(n).padStart(2, '0')
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]
  return text.replace(/\{\{\s*([a-zA-Z]+)(?:(::|:)([^}]*))?\s*\}\}/g, (whole, name, sep, arg) => {
    switch (name.toLowerCase()) {
      case 'date': return now.toLocaleDateString()
      case 'time': return now.toLocaleTimeString()
      case 'weekday': return weekday
      case 'isodate': return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      case 'isotime': return `${pad(now.getHours())}:${pad(now.getMinutes())}`
      case 'newline': return '\n'
      // Agent-scoped values: left as written when the caller has none (system sections let the core fill {{model}} / {{provider}} / {{cwd}}).
      case 'model': return vars.model === undefined ? whole : String(vars.model)
      case 'provider': return vars.provider === undefined ? whole : String(vars.provider)
      case 'workspace': return vars.workspace === undefined ? whole : String(vars.workspace)
      case 'cwd': return vars.cwd === undefined ? whole : String(vars.cwd)
      case 'random': { // {{random:a,b,c}} or ST's {{random::a::b}}
        const items = String(arg ?? '').split(sep === '::' ? '::' : ',').map(x => x.trim()).filter(Boolean)
        return items.length === 0 ? '' : items[Math.floor(rng() * items.length)]
      }
      case 'roll': {
        const m = /^(\d*)d(\d+)$/i.exec(String(arg ?? '').trim())
        if (!m) return whole
        const count = Math.min(100, Math.max(1, Number(m[1] || 1)))
        const sides = Math.min(100000, Math.max(1, Number(m[2])))
        let total = 0
        for (let i = 0; i < count; i++) total += 1 + Math.floor(rng() * sides)
        return String(total)
      }
      default: return whole
    }
  })
}

/**
 * Make a text safe for the core's system-prompt renderer, which throws on unknown or malformed
 * `{{…}}` references: every `{{name}}` not in `keep` becomes `{name}` (single braces are literal
 * prose for the renderer), every other run of braces is split until no `{{` / `}}` is left, and the
 * kept references (the variables the core resolves itself — provider / model / cwd by default) are
 * restored with a space when they would otherwise touch another brace. The result never contains a
 * `{{` or `}}` outside a kept reference, whatever the input.
 */
export function neutralizeBraces(text, keep = ['provider', 'model', 'cwd']) {
  // The private-use markers below are internal; a text that carries them (crafted import) loses them first so it can never forge a restore.
  let out = String(text ?? '').replace(/[\uE000\uE001]/g, '')
  if (!out.includes('{') && !out.includes('}')) return out
  const KEEP = new Set(keep)
  const marks = []
  // 1) protect kept references behind private-use placeholders
  out = out.replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, (whole, name) => {
    if (!KEEP.has(name)) return `{${name}}`
    marks.push(name)
    return `\uE000${marks.length - 1}\uE001`
  })
  // 2) split every remaining brace pair until none is left (runs of 3+ need more than one pass)
  while (/\{\{|\}\}/.test(out)) out = out.replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }')
  // 3) restore kept references, padding when a brace would otherwise touch them
  out = out.replace(/\uE000(\d+)\uE001/g, (m, i, offset, whole) => {
    if (Number(i) >= marks.length) return '' // cannot happen after the strip above; never restore a forged index
    const ref = `{{${marks[Number(i)]}}}`
    const before = whole[offset - 1]
    const after = whole[offset + m.length]
    return (before === '{' ? ' ' : '') + ref + (after === '}' ? ' ' : '')
  })
  return out
}

// ── Regex engine (SillyTavern runRegexScript semantics) ──────────────────────
export function compileRules(regex, placement) {
  const out = []
  for (const r of regex) {
    if (!r.enabled || !r.placement.includes(placement)) continue
    try {
      out.push({ name: r.name, re: new RegExp(r.findRegex, r.flags), replaceString: r.replaceString, trimStrings: r.trimStrings })
    } catch { /* an invalid rule is skipped, never breaks the pipeline (validateDeck reports it) */ }
  }
  return out
}

/** Which rules of a placement fail to compile (for diagnostics). */
export function brokenRules(regex, placement) {
  const out = []
  for (const r of regex) {
    if (!r.enabled || !r.placement.includes(placement)) continue
    try { new RegExp(r.findRegex, r.flags) } catch (error) { out.push({ name: r.name, error: String(error?.message ?? error) }) }
  }
  return out
}

/**
 * Apply the rules in order with SillyTavern's runRegexScript semantics: `{{match}}` (any case) is
 * `$0`; `$N` (any digit count) and `$<name>` substitute groups, each substituted value first loses
 * the trimStrings (ST filterString); everything else (`$&`, a lone `$`) stays literal and there is
 * no `$$` escape. Without the `g` flag
 * only the first occurrence is replaced (ST regexFromString). A single pass recognises every token
 * at once, so inserted match/group text is never re-parsed as a token.
 */
export function applyRules(text, rules) {
  const trim = (v, strings) => { let x = String(v ?? ''); for (const s of strings) x = x.split(s).join(''); return x }
  let t = text
  for (const rule of rules) {
    if (rule.re.global || rule.re.sticky) rule.re.lastIndex = 0
    const template = rule.replaceString.replace(/\{\{match\}\}/gi, '$0')
    t = t.replace(rule.re, (...args) => {
      const hasNamed = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null
      const named = hasNamed ? args[args.length - 1] : {}
      const positional = args.slice(0, hasNamed ? -3 : -2) // [$0, $1, …]
      return template.replace(/\$(\d+)|\$<([^>]+)>/g, (tok, n, name) => trim(n !== undefined ? positional[Number(n)] : named[name], rule.trimStrings))
    })
  }
  return t
}

/** Serialisable form of the display-only (ai_output) rules for the browser half. */
export function displayRules(regex) {
  return regex.filter(r => r.enabled && r.placement.includes('ai_output')).map(r => ({ name: r.name, findRegex: r.findRegex, flags: r.flags, replaceString: r.replaceString, trimStrings: r.trimStrings }))
}

// ── World Info scanning engine (SillyTavern activation semantics) ────────────
/** Key match: /re/flags keys are regex; otherwise plain text (optional case / whole-word; CJK keys skip whole-word). */
export function keyMatches(key, text, { caseSensitive, matchWholeWords }) {
  const rx = /^\/(.+)\/([gimsuy]*)$/.exec(key)
  if (rx !== null) {
    // User-authored, and uninterruptible: the whole scan runs inside the deck worker, which the host
    // kills if it overruns (see deck-runner.js).
    try { return new RegExp(rx[1], rx[2]).test(text) } catch { return false }
  }
  const hay = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? key : key.toLowerCase()
  if (matchWholeWords && /^[\w'-]+$/.test(needle)) {
    try { return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, caseSensitive ? '' : 'i').test(text) } catch { return false }
  }
  return hay.includes(needle)
}

/** Effective match options for an entry: per-entry tri-state value, else the global setting. */
function matchOptions(entry, settings) {
  return {
    caseSensitive: entry.caseSensitive === null || entry.caseSensitive === undefined ? settings.caseSensitive === true : entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords === null || entry.matchWholeWords === undefined ? settings.matchWholeWords !== false : entry.matchWholeWords,
  }
}

/** Number of primary keys that match (0 = no hit); secondary logic must also pass. */
function entryKeyScore(entry, text, settings) {
  const opt = matchOptions(entry, settings)
  const primary = entry.keys.filter(k => keyMatches(k, text, opt)).length
  if (primary === 0) return 0
  if (entry.secondaryKeys.length === 0) return primary
  const hits = entry.secondaryKeys.map(k => keyMatches(k, text, opt))
  let ok
  switch (entry.selectiveLogic) {
    case 'andAll': ok = hits.every(Boolean); break
    case 'notAny': ok = !hits.some(Boolean); break
    case 'notAll': ok = !hits.every(Boolean); break
    default: ok = hits.some(Boolean) // andAny
  }
  return ok ? primary : 0
}

/** Scan buffer for one entry: the last `depth` history items (newest last) plus the current message. */
function bufferFor(history, current, depth) {
  const d = Number.isFinite(depth) ? depth : 0
  const recent = d > 0 ? history.slice(-d) : []
  return [...recent, current].join('\n')
}

/** Stable per-deck identity for timers and activation sets (duplicate names do not collide). */
const keyOf = e => `${e.uid ?? 0}:${e.name}`

/**
 * Full World Info activation: constant → key scan → recursive scan (activated content becomes a
 * scan source) → minActivations deepening → probability → timers (sticky / cooldown / delay) →
 * group resolution (prioritize → group scoring → weighted pick) → character budget.
 * @param deck       normalised deck
 * @param scan       { history: string[] (oldest first, already name-prefixed when includeNames), current: string }
 *                   — a plain string is accepted for backward compatibility (treated as current only)
 * @param state      per-session timer state { msgCount, timers: { [uid:name]: { stickyUntil, cooldownUntil } } }
 * @param rng        0..1 random source (tests inject a constant)
 * @returns { activated: entry[], state }
 */
export function activateLorebook(deck, scan, state, rng = Math.random) {
  const { lorebook, settings } = deck
  const history = typeof scan === 'string' ? [] : (Array.isArray(scan?.history) ? scan.history : [])
  const current = typeof scan === 'string' ? scan : String(scan?.current ?? '')
  const msg = state.msgCount ?? 0
  const timers = { ...(state.timers ?? {}) }
  const eligible = e => {
    if (!e.enabled) return false
    if (e.delay > 0 && msg < e.delay) return false
    const t = timers[keyOf(e)]
    if (t?.cooldownUntil !== undefined && msg < t.cooldownUntil && !(t.stickyUntil !== undefined && msg < t.stickyUntil)) return false
    return true
  }
  const activatedSet = new Map()
  const scores = new Map()
  // sticky entries stay active
  for (const e of lorebook) {
    const t = timers[keyOf(e)]
    if (e.enabled && t?.stickyUntil !== undefined && msg < t.stickyUntil) activatedSet.set(keyOf(e), e)
  }
  // constant entries are always on
  const constContents = []
  for (const e of lorebook) if (eligible(e) && e.constant && !e.delayUntilRecursion) { activatedSet.set(keyOf(e), e); constContents.push(e.content) }

  const scanOnce = (depthOverride) => {
    // key scan + recursion; constant content joins the first scan source so it can trigger recursive entries (ST semantics)
    let extra = [...constContents]
    for (let stepN = 0; stepN < Math.max(1, settings.maxRecursionSteps); stepN++) {
      const isRecursive = stepN > 0
      const newly = []
      for (const e of lorebook) {
        if (activatedSet.has(keyOf(e)) || !eligible(e) || e.constant) continue
        if (isRecursive && e.excludeRecursion) continue
        // delayUntilRecursion: true = from the first recursive step; a number = from that recursion level on
        const minStep = e.delayUntilRecursion === true ? 1 : (typeof e.delayUntilRecursion === 'number' ? e.delayUntilRecursion : 0)
        if (stepN < minStep) continue
        const depth = depthOverride ?? (e.scanDepth ?? settings.scanDepth)
        const text = isRecursive ? extra.join('\n') : [bufferFor(history, current, depth), ...extra].join('\n')
        if (text.length === 0) continue
        const score = entryKeyScore(e, text, settings)
        if (score > 0) { newly.push(e); scores.set(keyOf(e), score) }
      }
      if (newly.length === 0) break
      for (const e of newly) activatedSet.set(keyOf(e), e)
      extra = newly.filter(e => !e.preventRecursion).map(e => e.content)
      if (extra.length === 0) break
    }
  }
  scanOnce(undefined)
  // minActivations: widen the scan window (up to maxDepth, or the whole history) until enough entries fired
  if (settings.minActivations > 0) {
    const limit = settings.maxDepth > 0 ? Math.min(settings.maxDepth, history.length) : history.length
    let depth = settings.scanDepth
    while ([...activatedSet.values()].filter(e => !e.constant).length < settings.minActivations && depth < limit) {
      depth = Math.min(limit, depth + Math.max(1, settings.scanDepth))
      scanOnce(depth)
    }
  }
  // probability filter (sticky entries skip the roll)
  let activated = [...activatedSet.values()].filter(e => {
    const t = timers[keyOf(e)]
    if (t?.stickyUntil !== undefined && msg < t.stickyUntil) return true
    return e.probability >= 100 || rng() * 100 < e.probability
  })
  // group resolution: prioritize (highest order wins) → group scoring (most key hits) → weighted random
  const byGroup = new Map()
  for (const e of activated) {
    if (e.group === '') continue
    ;(byGroup.get(e.group) ?? byGroup.set(e.group, []).get(e.group)).push(e)
  }
  for (const [, members] of byGroup) {
    if (members.length < 2) continue
    let pool = members
    const prioritized = pool.filter(e => e.prioritize)
    let winner
    if (prioritized.length > 0) {
      winner = prioritized.reduce((best, e) => (e.order > best.order ? e : best), prioritized[0])
    } else {
      if (pool.some(e => e.useGroupScoring)) {
        const top = Math.max(...pool.map(e => scores.get(keyOf(e)) ?? 0))
        pool = pool.filter(e => (scores.get(keyOf(e)) ?? 0) === top)
      }
      const total = pool.reduce((s, e) => s + e.groupWeight, 0)
      let roll = rng() * total
      winner = pool[pool.length - 1]
      for (const e of pool) { roll -= e.groupWeight; if (roll <= 0) { winner = e; break } }
    }
    activated = activated.filter(e => e.group !== winner.group || e === winner)
  }
  // budget: constant first, then ascending order (larger order = later = stronger); overflow is dropped
  activated.sort((a, b) => (Number(b.constant) - Number(a.constant)) || (a.order - b.order))
  const kept = []
  let used = 0
  for (const e of activated) {
    if (used + e.content.length > settings.budgetChars && kept.length > 0) continue
    kept.push(e); used += e.content.length
  }
  // timer updates
  for (const e of kept) {
    const t = timers[keyOf(e)] ?? {}
    if (e.sticky > 0 && !(t.stickyUntil !== undefined && msg < t.stickyUntil)) t.stickyUntil = msg + e.sticky
    if (e.cooldown > 0) t.cooldownUntil = (t.stickyUntil ?? msg) + e.cooldown
    timers[keyOf(e)] = t
  }
  return { activated: kept, state: { ...state, timers } }
}

/** Largest history depth any scan may need (per-entry scanDepth, the global depth, minActivations' maxDepth). */
export function requiredHistoryDepth(deck) {
  let depth = deck.settings.scanDepth
  for (const e of deck.lorebook) if (e.scanDepth !== undefined) depth = Math.max(depth, e.scanDepth)
  if (deck.settings.minActivations > 0) depth = Math.max(depth, deck.settings.maxDepth > 0 ? deck.settings.maxDepth : 200)
  return depth
}
