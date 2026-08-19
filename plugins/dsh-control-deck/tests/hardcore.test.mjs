// 高难度对抗测试:控制甲板引擎在边界/恶意/组合输入下的正确性。
// 每条断言都针对一个具体语义承诺,不做"能跑就过"的松测试。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeDeck, compileRules, applyRules, keyMatches, activateLorebook } from '../lib/deck.js'

const act = (deck, text, st = { msgCount: 1, timers: {} }, rng = () => 0) =>
  activateLorebook(deck, text, st, rng).activated.map(e => e.name)

// ── 正则:替换串里的美元符号地雷 ─────────────────────────────────────────────
test('regex: $$ escapes to literal $, and $ tokens in MATCHED TEXT are never re-parsed', () => {
  // JS/ST 约定:替换串中 $$ = 字面 $;且插入的匹配文本内含 "$1" 时绝不能被二次解析
  const rules = compileRules(normalizeDeck({ regex: [
    { findRegex: '(\\d+)元', replaceString: '$1 cost $$5 ({{match}})', placement: ['user_input'] },
  ] }).regex, 'user_input')
  assert.equal(applyRules('42元', rules), '42 cost $5 (42元)')
  // 匹配文本本身含 $1:单遍扫描保证它原样落地
  const rules2 = compileRules(normalizeDeck({ regex: [
    { findRegex: '(\\$1\\w+)', replaceString: '[{{match}}|$1]', placement: ['user_input'] },
  ] }).regex, 'user_input')
  assert.equal(applyRules('$1abc', rules2), '[$1abc|$1abc]')
})

test('regex: capture group index beyond match yields empty, no crash', () => {
  const rules = compileRules(normalizeDeck({ regex: [
    { findRegex: '(a)(b)?', replaceString: '[$1|$2|$3]', placement: ['user_input'] },
  ] }).regex, 'user_input')
  assert.equal(applyRules('a', rules), '[a||]') // $2 未命中→空, $3 不存在→空
})

test('regex: global replace hits every occurrence, trimStrings applied per group', () => {
  const rules = compileRules(normalizeDeck({ regex: [
    { findRegex: '<(\\w+)>', replaceString: '{{match}}=$1', trimStrings: ['<', '>'], placement: ['user_input'] },
  ] }).regex, 'user_input')
  // trim 同时作用于整段 {{match}} 与 $1
  assert.equal(applyRules('<a> and <bb>', rules), 'a=a and bb=bb')
})

test('regex: ReDoS-shaped but valid pattern still terminates on bounded input', () => {
  const rules = compileRules(normalizeDeck({ regex: [
    { findRegex: '(a+)+$', replaceString: 'X', placement: ['user_input'] },
  ] }).regex, 'user_input')
  // 只验证不抛异常且返回字符串(输入有界,20 字符)
  const out = applyRules('a'.repeat(20) + 'b', rules)
  assert.equal(typeof out, 'string')
})

// ── keyMatches:全词边界与 CJK ───────────────────────────────────────────────
test('keyMatches: whole-word respects regex-special chars in key', () => {
  // 键含正则特殊字符时,全词分支必须转义,不能把 c++ 当成正则
  assert.equal(keyMatches('c++', 'I love c++ code', { caseSensitive: false, matchWholeWords: true }), true)
  assert.equal(keyMatches('c++', 'concept', { caseSensitive: false, matchWholeWords: true }), false)
})

test('keyMatches: malformed /regex/ key fails closed (no throw)', () => {
  assert.equal(keyMatches('/[unclosed/', 'anything', { caseSensitive: false, matchWholeWords: false }), false)
})

test('keyMatches: CJK key ignores whole-word gate (no \\b around CJK)', () => {
  assert.equal(keyMatches('夜之城', '我在夜之城漫游', { caseSensitive: false, matchWholeWords: true }), true)
})

// ── 世界书:递归深度与预算的组合 ─────────────────────────────────────────────
test('lorebook: recursion honors maxRecursionSteps as a hard ceiling', () => {
  // a→b→c→d 链,但 maxRecursionSteps=2 只允许 首轮 + 1 递归轮 = 命中 a,b(c 需第 2 递归轮)
  const deck = normalizeDeck({ lorebook: [
    { name: 'a', keys: ['start'], content: 'has beta' },
    { name: 'b', keys: ['beta'], content: 'has gamma' },
    { name: 'c', keys: ['gamma'], content: 'has delta' },
    { name: 'd', keys: ['delta'], content: 'end' },
  ], settings: { maxRecursionSteps: 2 } })
  const names = act(deck, 'start').sort()
  assert.deepEqual(names, ['a', 'b']) // c/d 超出递归深度
})

test('lorebook: delayUntilRecursion entry only fires via a recursion hop, never first pass', () => {
  const deck = normalizeDeck({ lorebook: [
    { name: 'seed', keys: ['trigger'], content: 'mentions hidden' },
    { name: 'late', keys: ['hidden'], content: 'X', delayUntilRecursion: true },
  ], settings: { maxRecursionSteps: 3 } })
  // 直接文本含 hidden 也不能在首轮激活 late
  assert.deepEqual(act(deck, 'hidden').sort(), [])
  // 但经 seed 递归可激活
  assert.deepEqual(act(deck, 'trigger hidden').sort(), ['late', 'seed'])
})

test('lorebook: budget keeps constant entries even when they overflow, drops keyed overflow', () => {
  const big = 'x'.repeat(500)
  const deck = normalizeDeck({ lorebook: [
    { name: 'k1', keys: ['k'], content: big, order: 1 },
    { name: 'c1', keys: [], constant: true, content: big },
    { name: 'k2', keys: ['k'], content: big, order: 2 },
  ], settings: { maxRecursionSteps: 1, budgetChars: 600 } })
  const names = act(deck, 'k')
  // constant(500)排序在前必留;剩余预算 100 容不下任何 keyed(各 500)→ 全部被丢
  assert.deepEqual(names, ['c1'])
})

test('lorebook: cooldown blocks re-trigger but sticky overrides cooldown within its window', () => {
  const deck = normalizeDeck({ lorebook: [
    { name: 'e', keys: ['k'], content: 'C', sticky: 3, cooldown: 5 },
  ], settings: { maxRecursionSteps: 1 } })
  let s = { msgCount: 1, timers: {} }
  let r = activateLorebook(deck, 'k', s, () => 0); assert.equal(r.activated.length, 1); s = r.state
  // msg2: sticky 窗内(<1+3),即便无关键词仍在
  r = activateLorebook(deck, 'nope', { ...s, msgCount: 2 }, () => 0); assert.equal(r.activated.length, 1); s = r.state
  // msg6: sticky 过期(>=4)、cooldown 未过(stickyUntil4 + 5 = 9),命中关键词也应被压制
  r = activateLorebook(deck, 'k', { ...s, msgCount: 6 }, () => 0)
  assert.equal(r.activated.length, 0)
})

test('lorebook: inclusion group weighted pick is deterministic under injected rng', () => {
  const deck = normalizeDeck({ lorebook: [
    { name: 'lo', keys: ['k'], content: 'A', group: 'g', groupWeight: 1 },
    { name: 'hi', keys: ['k'], content: 'B', group: 'g', groupWeight: 9 },
  ], settings: { maxRecursionSteps: 1 } })
  // roll = rng*total(10); rng=0.05→0.5, 减 lo(1) 后 <=0 → 选 lo
  assert.deepEqual(act(deck, 'k', { msgCount: 1, timers: {} }, () => 0.05), ['lo'])
  // rng=0.5→5.0, 减 lo(1)=4>0, 减 hi(9)<=0 → 选 hi
  assert.deepEqual(act(deck, 'k', { msgCount: 1, timers: {} }, () => 0.5), ['hi'])
})

test('lorebook: secondaryKeys notAll fires unless every secondary present', () => {
  const mk = () => normalizeDeck({ lorebook: [
    { name: 'e', keys: ['main'], secondaryKeys: ['alpha', 'beta'], selectiveLogic: 'notAll', content: 'C' },
  ], settings: { maxRecursionSteps: 1 } })
  assert.deepEqual(act(mk(), 'main alpha'), ['e']) // 不是全部→触发
  assert.deepEqual(act(mk(), 'main alpha beta'), []) // 全部在→抑制
})

// ── normalize:垃圾输入健壮性 ────────────────────────────────────────────────
test('normalize: hostile/garbage input never throws, coerces to safe defaults', () => {
  for (const bad of [null, undefined, 42, 'string', [], { prompts: 'no' }, { lorebook: [null, 1, {}] }, { regex: [{ findRegex: 42 }] }]) {
    const d = normalizeDeck(bad)
    assert.equal(Array.isArray(d.prompts), true)
    assert.equal(Array.isArray(d.lorebook), true)
    assert.equal(typeof d.sampling.enabled, 'boolean')
    assert.equal(d.sampling.enabled, false) // 采样默认关铁律
  }
})

test('normalize: sampling clamps out-of-range and rejects non-strict-true enable', () => {
  const d = normalizeDeck({ sampling: { enabled: 1, temperature: 99, maxTokens: -5, stop: ['a', 'b', 'c', 'd', 'e', 'f'] } })
  assert.equal(d.sampling.enabled, false) // 1 不是严格 true
  assert.equal(d.sampling.temperature, undefined) // 99 越界→丢弃
  assert.equal(d.sampling.maxTokens, undefined) // 负数→丢弃
  assert.equal(d.sampling.stop.length, 4) // 上限 4
})
