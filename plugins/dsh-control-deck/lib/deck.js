/**
 * Control Deck v2 纯逻辑引擎 —— 语义对齐 SillyTavern:
 *  - 正则脚本:findRegex/replaceString({{match}}、$1、$<name>)/trimStrings/placement
 *    (语义出处:SillyTavern public/scripts/extensions/regex/engine.js)
 *  - 世界书:keys(纯文本或 /regex/flags)、secondaryKeys+selectiveLogic(andAny/andAll/
 *    notAny/notAll)、constant、probability、order、position、caseSensitive、
 *    matchWholeWords、scanDepth、递归(exclude/prevent/delay + maxRecursionSteps)、
 *    inclusion group + groupWeight、sticky/cooldown/delay(消息数计)、字符预算
 *    (语义出处:docs.sillytavern.app/usage/core-concepts/worldinfo)
 * 全部纯函数,随机性经注入的 rng 参数可测。
 */

const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt }
const strArr = v => (Array.isArray(v) ? v.map(x => String(x)).filter(x => x.length > 0) : [])

/** 规范化配置;非法字段回落默认,永不抛错(热载容错)。 */
export function normalizeDeck(raw) {
  const o = raw !== null && typeof raw === 'object' ? raw : {}
  const arr = v => (Array.isArray(v) ? v : [])

  const prompts = arr(o.prompts).map((p, i) => ({
    name: String(p?.name ?? 'prompt-' + i).slice(0, 60),
    order: clampNum(p?.order, -100000, 100000, 100 + i),
    text: typeof p?.text === 'string' ? p.text : '',
    position: p?.position === 'user-prefix' ? 'user-prefix' : 'system',
    interval: clampNum(p?.interval, 1, 999, 1), // 每 N 条消息注入一次(ST 作者注 interval)
    enabled: p?.enabled !== false,
  })).filter(p => p.text.length > 0)

  const regex = arr(o.regex).map((r, i) => ({
    name: String(r?.name ?? 'regex-' + i).slice(0, 60),
    findRegex: typeof r?.findRegex === 'string' ? r.findRegex : (typeof r?.pattern === 'string' ? r.pattern : ''),
    flags: typeof r?.flags === 'string' && /^[gimsuy]*$/.test(r.flags) ? r.flags : 'g',
    replaceString: typeof r?.replaceString === 'string' ? r.replaceString : (typeof r?.replace === 'string' ? r.replace : ''),
    trimStrings: strArr(r?.trimStrings),
    placement: arr(r?.placement).filter(x => x === 'user_input' || x === 'world_info'),
    enabled: r?.enabled !== false && r?.disabled !== true,
  })).map(r => ({ ...r, placement: r.placement.length > 0 ? r.placement : ['user_input'] }))
    .filter(r => r.findRegex.length > 0)

  const lorebook = arr(o.lorebook).map((e, i) => ({
    name: String(e?.name ?? 'entry-' + i).slice(0, 60),
    keys: strArr(e?.keys ?? e?.keywords),
    secondaryKeys: strArr(e?.secondaryKeys),
    selectiveLogic: ['andAny', 'andAll', 'notAny', 'notAll'].includes(e?.selectiveLogic) ? e.selectiveLogic : 'andAny',
    content: typeof e?.content === 'string' ? e.content : '',
    constant: e?.constant === true,
    probability: clampNum(e?.probability, 0, 100, 100),
    order: clampNum(e?.order, -100000, 100000, 100),
    position: e?.position === 'user-prefix' ? 'user-prefix' : 'system',
    caseSensitive: e?.caseSensitive === true,
    matchWholeWords: e?.matchWholeWords !== false, // ST 全局默认开启全词匹配(CJK 键在 keyMatches 内自动跳过)
    scanDepth: e?.scanDepth === undefined ? undefined : clampNum(e.scanDepth, 0, 100, undefined),
    excludeRecursion: e?.excludeRecursion === true,
    preventRecursion: e?.preventRecursion === true,
    delayUntilRecursion: e?.delayUntilRecursion === true,
    group: typeof e?.group === 'string' ? e.group.slice(0, 40) : '',
    groupWeight: clampNum(e?.groupWeight, 1, 10000, 100),
    sticky: clampNum(e?.sticky, 0, 9999, 0),
    cooldown: clampNum(e?.cooldown, 0, 9999, 0),
    delay: clampNum(e?.delay, 0, 9999, 0),
    enabled: e?.enabled !== false,
  })).filter(e => e.content.length > 0 && (e.constant || e.keys.length > 0))

  const s = o.sampling !== null && typeof o.sampling === 'object' ? o.sampling : {}
  const sampling = {
    enabled: s.enabled === true, // 总开关:默认关,未勾选绝不向请求合并任何采样参数
    temperature: clampNum(s.temperature, 0, 2, undefined),
    maxTokens: clampNum(s.maxTokens, 1, 1000000, undefined),
    stop: strArr(s.stop).slice(0, 4),
  }
  const disabledTools = strArr(o.disabledTools).filter(t => /^[\w-]+$/.test(t))
  const settings = {
    scanDepth: clampNum(o.scanDepth ?? o.settings?.scanDepth, 0, 100, 6),
    maxRecursionSteps: clampNum(o.settings?.maxRecursionSteps, 1, 10, 2),
    budgetChars: clampNum(o.settings?.budgetChars, 200, 100000, 8000),
  }
  return { prompts, regex, lorebook, sampling, disabledTools, settings }
}

// ── 正则引擎(ST runRegexScript 语义) ────────────────────────────────────────
export function compileRules(regex, placement) {
  const out = []
  for (const r of regex) {
    if (!r.enabled || !r.placement.includes(placement)) continue
    try {
      const flags = r.flags.includes('g') ? r.flags : r.flags + 'g'
      out.push({ re: new RegExp(r.findRegex, flags), replaceString: r.replaceString, trimStrings: r.trimStrings })
    } catch { /* 无效规则跳过,不炸管线 */ }
  }
  return out
}

/**
 * 单条规则应用(ST filterString 语义):对整段匹配与每个捕获组先做 trimStrings 剔除,
 * 再展开替换串里的 {{match}}(=整段匹配)、$&、$$(字面 $,JS/ST 约定)、$1..$9。
 * 用单遍扫描一次性识别全部记号:插入的匹配/组文本不会被二次当作记号重解析
 * (例如匹配文本里含 "$1" 不会被误认成捕获组;字面 "$$5" 正确产出 "$5")。
 */
export function applyRules(text, rules) {
  const trim = (v, strings) => { let x = String(v ?? ''); for (const s of strings) x = x.split(s).join(''); return x }
  let t = text
  for (const rule of rules) {
    rule.re.lastIndex = 0
    t = t.replace(rule.re, (...args) => {
      const hasNamed = typeof args[args.length - 1] === 'object'
      const groups = args.slice(1, hasNamed ? -3 : -2).map(g => trim(g, rule.trimStrings))
      const match = trim(args[0], rule.trimStrings)
      return rule.replaceString.replace(/\{\{match\}\}|\$\$|\$&|\$(\d)/g, (tok, d) => {
        if (tok === '$$') return '$' // 字面美元符转义
        if (d !== undefined) return groups[Number(d) - 1] ?? '' // $1..$9(越界=空)
        return match // {{match}} 或 $&
      })
    })
  }
  return t
}

// ── 世界书扫描引擎(ST World Info 激活语义) ─────────────────────────────────
/** 关键词匹配:/re/flags 形式按正则;否则纯文本(可选大小写/全词;CJK 键自动跳过全词)。 */
export function keyMatches(key, text, { caseSensitive, matchWholeWords }) {
  const rx = /^\/(.+)\/([gimsuy]*)$/.exec(key)
  if (rx !== null) {
    try { return new RegExp(rx[1], rx[2]).test(text) } catch { return false }
  }
  const hay = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? key : key.toLowerCase()
  if (matchWholeWords && /^[\w'-]+$/.test(needle)) {
    try { return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, caseSensitive ? '' : 'i').test(text) } catch { return false }
  }
  return hay.includes(needle)
}

function entryKeyHit(entry, text) {
  const opt = { caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords }
  const primary = entry.keys.some(k => keyMatches(k, text, opt))
  if (!primary) return false
  if (entry.secondaryKeys.length === 0) return true
  const hits = entry.secondaryKeys.map(k => keyMatches(k, text, opt))
  switch (entry.selectiveLogic) {
    case 'andAll': return hits.every(Boolean)
    case 'notAny': return !hits.some(Boolean)
    case 'notAll': return !hits.every(Boolean)
    default: return hits.some(Boolean) // andAny
  }
}

/**
 * 世界书完整激活流程:constant → 关键词扫描 → 递归扫描(命中内容再作为扫描源)
 * → 概率 → 时效(sticky/cooldown/delay) → 分组去重(groupWeight 加权抽取)
 * → 字符预算(constant 优先,后按 order 降序 = 越大越靠后越强)。
 * @param scanText  本步消息 + 历史缓冲(已按 scanDepth 裁剪)的合并文本
 * @param state     每会话时效状态 { msgCount, timers: { [name]: { stickyUntil, cooldownUntil } } }
 * @param rng       0..1 随机源(测试可注入定值)
 * @returns { activated: entry[], state }(state 内 timers 已更新)
 */
export function activateLorebook(deck, scanText, state, rng = Math.random) {
  const { lorebook, settings } = deck
  const msg = state.msgCount ?? 0
  const timers = { ...(state.timers ?? {}) }
  const eligible = e => {
    if (!e.enabled) return false
    if (e.delay > 0 && msg < e.delay) return false
    const t = timers[e.name]
    if (t?.cooldownUntil !== undefined && msg < t.cooldownUntil && !(t.stickyUntil !== undefined && msg < t.stickyUntil)) return false
    return true
  }
  const activatedSet = new Map()
  // sticky 保持激活
  for (const e of lorebook) {
    const t = timers[e.name]
    if (e.enabled && t?.stickyUntil !== undefined && msg < t.stickyUntil) activatedSet.set(e.name, e)
  }
  // constant 常驻
  const constContents = []
  for (const e of lorebook) if (eligible(e) && e.constant && !e.delayUntilRecursion) { activatedSet.set(e.name, e); constContents.push(e.content) }
  // 关键词主扫描 + 递归;constant 内容并入首轮扫描源,可触发递归条目(ST 语义)
  let sources = [scanText, ...constContents]
  for (let stepN = 0; stepN < Math.max(1, settings.maxRecursionSteps); stepN++) {
    const isRecursive = stepN > 0
    const text = sources.join('\n')
    if (text.length === 0) break
    const newly = []
    for (const e of lorebook) {
      if (activatedSet.has(e.name) || !eligible(e) || e.constant) continue
      if (isRecursive && e.excludeRecursion) continue
      if (!isRecursive && e.delayUntilRecursion) continue
      if (entryKeyHit(e, text)) newly.push(e)
    }
    if (newly.length === 0) break
    for (const e of newly) activatedSet.set(e.name, e)
    sources = newly.filter(e => !e.preventRecursion).map(e => e.content)
    if (sources.length === 0) break
  }
  // 概率过滤(sticky 保持项免掷)
  let activated = [...activatedSet.values()].filter(e => {
    const t = timers[e.name]
    if (t?.stickyUntil !== undefined && msg < t.stickyUntil) return true
    return e.probability >= 100 || rng() * 100 < e.probability
  })
  // 分组去重:同组按 groupWeight 加权抽一
  const byGroup = new Map()
  for (const e of activated) {
    if (e.group === '') continue
    ;(byGroup.get(e.group) ?? byGroup.set(e.group, []).get(e.group)).push(e)
  }
  for (const [, members] of byGroup) {
    if (members.length < 2) continue
    const total = members.reduce((s, e) => s + e.groupWeight, 0)
    let roll = rng() * total
    let winner = members[members.length - 1]
    for (const e of members) { roll -= e.groupWeight; if (roll <= 0) { winner = e; break } }
    activated = activated.filter(e => e.group !== winner.group || e === winner)
  }
  // 预算:constant 优先,再按 order 升序插入(大 order 靠后 = 更强),超预算丢弃
  activated.sort((a, b) => (Number(b.constant) - Number(a.constant)) || (a.order - b.order))
  const kept = []
  let used = 0
  for (const e of activated) {
    if (used + e.content.length > settings.budgetChars && kept.length > 0) continue
    kept.push(e); used += e.content.length
  }
  // 时效更新
  for (const e of kept) {
    const t = timers[e.name] ?? {}
    if (e.sticky > 0 && !(t.stickyUntil !== undefined && msg < t.stickyUntil)) t.stickyUntil = msg + e.sticky
    if (e.cooldown > 0) t.cooldownUntil = (t.stickyUntil ?? msg) + e.cooldown
    timers[e.name] = t
  }
  return { activated: kept, state: { ...state, timers } }
}
