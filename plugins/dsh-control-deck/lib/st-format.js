/**
 * SillyTavern interchange formats for the Control Deck (pure functions).
 *
 * Sources (SillyTavern `staging` branch):
 *  - public/scripts/world-info.js: world_info_logic { AND_ANY:0, NOT_ALL:1, NOT_ANY:2, AND_ALL:3 },
 *    world_info_position { before:0, after:1, ANTop:2, ANBottom:3, atDepth:4, EMTop:5, EMBottom:6, outlet:7 },
 *    entry template fields (uid, key, keysecondary, comment, content, constant, selective, selectiveLogic,
 *    order, position, disable, excludeRecursion, preventRecursion, delayUntilRecursion (bool or level), probability,
 *    useProbability, depth, group, groupOverride, groupWeight, scanDepth, caseSensitive, matchWholeWords (null = global),
 *    useGroupScoring, sticky, cooldown, delay, role, vectorized, addMemo, displayIndex), book shape { entries, name }.
 *  - public/scripts/extensions/regex/engine.js: regex_placement { MD_DISPLAY:0, USER_INPUT:1, AI_OUTPUT:2,
 *    SLASH_COMMAND:3, WORLD_INFO:5, REASONING:6 }; script fields (id, scriptName, findRegex, replaceString,
 *    trimStrings, placement, disabled, markdownOnly, promptOnly, runOnEdit, substituteRegex, minDepth, maxDepth);
 *    utils.js regexFromString parses `/pattern/flags` and keeps the flags as written.
 *  - public/scripts/PromptManager.js: prompt fields (identifier, name, role, content, system_prompt, marker,
 *    injection_position {RELATIVE:0, ABSOLUTE:1}, injection_depth, injection_order),
 *    prompt_order [{ character_id, order: [{ identifier, enabled }] }] — the sequence of `order` IS the prompt order.
 */

const ST_LOGIC = ['andAny', 'notAll', 'notAny', 'andAll']
const ST_LOGIC_INDEX = { andAny: 0, notAll: 1, notAny: 2, andAll: 3 }
const ST_PLACEMENT_IN = { 1: 'user_input', 2: 'ai_output', 5: 'world_info' }
const ST_PLACEMENT_OUT = { user_input: 1, ai_output: 2, world_info: 5 }

const arr = v => (Array.isArray(v) ? v : [])
const strs = v => arr(v).map(x => String(x)).filter(x => x.length > 0)
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const nullableNum = v => (v === null || v === undefined ? undefined : num(v, undefined))
const nullableBool = v => (v === null || v === undefined ? null : Boolean(v))

/** SillyTavern world info book (`{ entries: {uid: …}, name }`) → deck lorebook entries. */
export function fromStWorldInfo(book) {
  const entries = book && typeof book === 'object' && book.entries && typeof book.entries === 'object' ? Object.values(book.entries) : []
  return entries.filter(e => e && typeof e === 'object').map((e, i) => {
    const secondary = strs(e.keysecondary)
    const dur = e.delayUntilRecursion
    const out = {
      name: String(e.comment && String(e.comment).trim() ? e.comment : `entry-${e.uid ?? i}`).slice(0, 60),
      keys: strs(e.key),
      secondaryKeys: e.selective === false ? [] : secondary,
      selectiveLogic: ST_LOGIC[num(e.selectiveLogic, 0)] ?? 'andAny',
      content: typeof e.content === 'string' ? e.content : '',
      constant: e.constant === true,
      probability: e.useProbability === false ? 100 : num(e.probability, 100),
      order: num(e.order, 100),
      position: 'user-prefix',
      enabled: e.disable !== true,
      excludeRecursion: e.excludeRecursion === true,
      preventRecursion: e.preventRecursion === true,
      delayUntilRecursion: dur === true ? true : (typeof dur === 'number' && dur > 0 ? dur : false),
      group: typeof e.group === 'string' ? e.group.slice(0, 40) : '',
      prioritize: e.groupOverride === true,
      groupWeight: num(e.groupWeight, 100),
      useGroupScoring: e.useGroupScoring === true,
      sticky: num(e.sticky, 0),
      cooldown: num(e.cooldown, 0),
      delay: num(e.delay, 0),
      caseSensitive: nullableBool(e.caseSensitive),      // null = ST global setting
      matchWholeWords: nullableBool(e.matchWholeWords),  // null = ST global setting
    }
    const sd = nullableNum(e.scanDepth); if (sd !== undefined) out.scanDepth = sd
    return out
  })
}

/** Deck lorebook entries → SillyTavern world info book JSON (tri-state fields exported as written). */
export function toStWorldInfo(lorebook, name = 'dsh-control-deck') {
  const entries = {}
  arr(lorebook).forEach((e, i) => {
    entries[String(i)] = {
      uid: i,
      key: strs(e.keys),
      keysecondary: strs(e.secondaryKeys),
      comment: String(e.name ?? ''),
      content: String(e.content ?? ''),
      constant: e.constant === true,
      vectorized: false,
      selective: strs(e.secondaryKeys).length > 0,
      selectiveLogic: ST_LOGIC_INDEX[e.selectiveLogic] ?? 0,
      addMemo: true,
      order: num(e.order, 100),
      position: 1,
      disable: e.enabled === false,
      excludeRecursion: e.excludeRecursion === true,
      preventRecursion: e.preventRecursion === true,
      delayUntilRecursion: e.delayUntilRecursion === true ? true : (typeof e.delayUntilRecursion === 'number' && e.delayUntilRecursion > 0 ? e.delayUntilRecursion : false),
      probability: num(e.probability, 100),
      useProbability: num(e.probability, 100) < 100,
      depth: 4,
      group: String(e.group ?? ''),
      groupOverride: e.prioritize === true,
      groupWeight: num(e.groupWeight, 100),
      scanDepth: e.scanDepth ?? null,
      caseSensitive: typeof e.caseSensitive === 'boolean' ? e.caseSensitive : null,
      matchWholeWords: typeof e.matchWholeWords === 'boolean' ? e.matchWholeWords : null,
      useGroupScoring: e.useGroupScoring === true ? true : null,
      automationId: '',
      role: 0,
      sticky: num(e.sticky, 0),
      cooldown: num(e.cooldown, 0),
      delay: num(e.delay, 0),
      displayIndex: i,
    }
  })
  return { entries, name }
}

/** Parse SillyTavern's `/pattern/flags` string form into { pattern, flags } — flags exactly as written (plain strings default to 'g'). */
export function parseStFindRegex(findRegex) {
  const s = String(findRegex ?? '')
  const m = /^\/([\s\S]+)\/([gimsuy]*)$/.exec(s)
  if (m) return { pattern: m[1], flags: m[2] }
  return { pattern: s, flags: 'g' }
}

/**
 * SillyTavern regex script JSON (one script, or an array of scripts) → deck regex entries.
 * Scripts whose AI_OUTPUT placement is `promptOnly` (rewrite what the model sees, not the display)
 * cannot be expressed by dsh (the log is immutable) and are imported DISABLED; `markdownOnly`
 * display scripts map to the display-only `ai_output` placement. `skipped` counts those disabled.
 * @returns {Array} entries (with a non-enumerable `skipped` property on the array)
 */
export function fromStRegex(json) {
  const list = Array.isArray(json) ? json : (json && typeof json === 'object' ? [json] : [])
  let skipped = 0
  const out = list.filter(s => s && typeof s === 'object' && typeof s.findRegex === 'string' && s.findRegex.length > 0).map((s, i) => {
    const { pattern, flags } = parseStFindRegex(s.findRegex)
    const placement = arr(s.placement).map(p => ST_PLACEMENT_IN[Number(p)]).filter(Boolean)
    const promptOnlyAi = placement.includes('ai_output') && s.promptOnly === true
    if (promptOnlyAi) skipped++
    return {
      name: String(s.scriptName && String(s.scriptName).trim() ? s.scriptName : `regex-${i}`).slice(0, 60) + (promptOnlyAi ? ' [promptOnly: not supported]' : ''),
      findRegex: pattern,
      flags,
      replaceString: typeof s.replaceString === 'string' ? s.replaceString : '',
      trimStrings: strs(s.trimStrings),
      placement: placement.length > 0 ? placement : ['user_input'],
      enabled: s.disabled !== true && !promptOnlyAi,
    }
  })
  Object.defineProperty(out, 'skipped', { value: skipped, enumerable: false })
  return out
}

/** Deck regex entries → SillyTavern script JSON array. */
export function toStRegex(regex) {
  return arr(regex).map((r, i) => ({
    id: `dsh-control-deck-${i}-${String(r.name ?? '').replace(/[^\w-]/g, '').slice(0, 24)}`,
    scriptName: String(r.name ?? `regex-${i}`),
    findRegex: `/${String(r.findRegex ?? '')}/${String(r.flags ?? 'g')}`,
    replaceString: String(r.replaceString ?? ''),
    trimStrings: strs(r.trimStrings),
    placement: arr(r.placement).map(p => ST_PLACEMENT_OUT[p]).filter(p => p !== undefined),
    disabled: r.enabled === false,
    markdownOnly: arr(r.placement).includes('ai_output'),
    promptOnly: !arr(r.placement).includes('ai_output'),
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  }))
}

/**
 * SillyTavern chat-completion preset `prompts[]` (+ `prompt_order`) → deck prompt entries. Markers are
 * skipped. The deck `order` follows the sequence of the selected `prompt_order[].order` list (that
 * sequence is the ST prompt order; `injection_order` only ranks absolute-position prompts); prompts
 * absent from the list keep their array position after the ordered ones.
 */
export function fromStPrompts(preset) {
  const prompts = arr(preset?.prompts).filter(p => p && typeof p === 'object' && p.marker !== true && typeof p.content === 'string' && p.content.trim().length > 0)
  const orders = arr(preset?.prompt_order)
  const orderEntry = orders.find(o => Array.isArray(o?.order) && o.order.length > 0) ?? orders[0]
  const seq = arr(orderEntry?.order)
  const enabledById = new Map(seq.map(o => [o?.identifier, o?.enabled !== false]))
  const indexById = new Map(seq.map((o, i) => [o?.identifier, i]))
  return prompts.map((p, i) => ({
    name: String(p.name ?? p.identifier ?? `prompt-${i}`).slice(0, 60),
    text: p.content,
    position: Number(p.injection_position) === 1 ? 'user-prefix' : 'system',
    role: p.role === 'user' ? 'user' : (p.role === 'assistant' ? 'assistant' : 'system'),
    order: indexById.has(p.identifier) ? 100 + indexById.get(p.identifier) * 10 : 100 + seq.length * 10 + i,
    interval: 1,
    enabled: enabledById.has(p.identifier) ? enabledById.get(p.identifier) : true,
  }))
}

/** Deck prompt entries → SillyTavern-style prompts array + prompt_order (sequence = ascending deck order). */
export function toStPrompts(prompts) {
  const src = arr(prompts)
  const list = src.map((p, i) => ({
    identifier: `dsh-${i}-${String(p.name ?? '').replace(/[^\w-]/g, '').slice(0, 24)}`,
    name: String(p.name ?? `prompt-${i}`),
    role: p.role === 'user' || p.role === 'assistant' ? p.role : (p.position === 'user-prefix' ? 'user' : 'system'),
    content: String(p.text ?? ''),
    system_prompt: false,
    marker: false,
    injection_position: p.position === 'user-prefix' ? 1 : 0,
    injection_depth: 0,
    injection_order: num(p.order, 100),
    forbid_overrides: false,
  }))
  const sorted = list.map((p, i) => ({ p, i, order: num(src[i]?.order, 100) })).sort((a, b) => a.order - b.order || a.i - b.i)
  return { prompts: list, prompt_order: [{ character_id: 100001, order: sorted.map(({ p, i }) => ({ identifier: p.identifier, enabled: src[i]?.enabled !== false })) }] }
}
