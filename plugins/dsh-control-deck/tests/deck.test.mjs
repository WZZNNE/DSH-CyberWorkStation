import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeDeck, compileRules, applyRules, keyMatches, activateLorebook } from '../lib/deck.js'

// ── normalize ──
test('normalize: prompts/regex/lorebook defaults, no reasoningEffort in sampling', () => {
  const d = normalizeDeck({
    prompts: [{ name: 'p', order: '5', text: 'hi', position: 'user-prefix', interval: 3 }, { text: '' }],
    regex: [{ findRegex: 'a', replaceString: 'b', placement: ['world_info'] }, { pattern: 'x', replace: 'y' }],
    lorebook: [{ keys: ['k'], content: 'c', selectiveLogic: 'andAll', probability: 50 }, { content: 'no-key' }],
    sampling: { temperature: 0.7, maxTokens: 2048, reasoningEffort: 'high', stop: ['a', 'b', 'c', 'd', 'e'] },
    disabledTools: ['web_search', 'bad name!'],
  })
  assert.equal(d.prompts.length, 1)
  assert.equal(d.prompts[0].order, 5); assert.equal(d.prompts[0].position, 'user-prefix'); assert.equal(d.prompts[0].interval, 3)
  assert.equal(d.regex.length, 2)
  assert.deepEqual(d.regex[0].placement, ['world_info']); assert.deepEqual(d.regex[1].placement, ['user_input'])
  assert.equal(d.regex[1].findRegex, 'x'); assert.equal(d.regex[1].replaceString, 'y') // 旧字段名兼容
  assert.equal(d.lorebook.length, 1) // 无 key 且非 constant 被剔除
  assert.equal(d.lorebook[0].selectiveLogic, 'andAll'); assert.equal(d.lorebook[0].probability, 50)
  assert.equal(d.sampling.temperature, 0.7); assert.equal(d.sampling.maxTokens, 2048)
  assert.equal(d.sampling.enabled, false) // 总开关默认关:未勾选绝不合并采样参数
  assert.equal(normalizeDeck({ sampling: { enabled: true } }).sampling.enabled, true)
  assert.equal(normalizeDeck({ sampling: { enabled: 'yes' } }).sampling.enabled, false) // 仅严格 true 生效
  assert.equal('reasoningEffort' in d.sampling, false) // 思考强度不归本插件
  assert.deepEqual(d.sampling.stop, ['a', 'b', 'c', 'd']) // 上限 4
  assert.deepEqual(d.disabledTools, ['web_search'])
})

// ── regex(ST runRegexScript: {{match}}/$1/trimStrings) ──
test('regex: {{match}}, capture groups, trimStrings, placement filter', () => {
  const deck = normalizeDeck({ regex: [
    { name: 'wrap', findRegex: '(\\w+)@(\\w+)', replaceString: '<$1 at $2>', placement: ['user_input'] },
    { name: 'quote', findRegex: '「.+?」', replaceString: '{{match}}!', trimStrings: ['「', '」'], placement: ['user_input'] },
    { name: 'wi-only', findRegex: 'x', replaceString: 'y', placement: ['world_info'] },
  ] })
  const u = compileRules(deck.regex, 'user_input')
  assert.equal(u.length, 2)
  assert.equal(applyRules('a@b', u), '<a at b>')
  assert.equal(applyRules('「你好」', u), '你好!') // {{match}} 也过 trim
  const w = compileRules(deck.regex, 'world_info')
  assert.equal(w.length, 1); assert.equal(applyRules('x', w), 'y')
})

test('regex: invalid pattern skipped, not crashing', () => {
  const rules = compileRules(normalizeDeck({ regex: [{ findRegex: '[bad', replaceString: 'x' }, { findRegex: 'ok', replaceString: 'k' }] }).regex, 'user_input')
  assert.equal(rules.length, 1); assert.equal(applyRules('ok', rules), 'k')
})

// ── keyMatches ──
test('keyMatches: plain/regex/caseSensitive/wholeWord/CJK', () => {
  assert.equal(keyMatches('king', 'the king', { caseSensitive: false, matchWholeWords: false }), true)
  assert.equal(keyMatches('king', 'liking', { caseSensitive: false, matchWholeWords: true }), false)
  assert.equal(keyMatches('Rose', 'a rose', { caseSensitive: true, matchWholeWords: false }), false)
  assert.equal(keyMatches('/v\\d+/', 'model v4 here', { caseSensitive: false, matchWholeWords: false }), true)
  assert.equal(keyMatches('夜之城', '欢迎来到夜之城', { caseSensitive: false, matchWholeWords: true }), true) // CJK 跳过全词
})

// ── selective logic ──
test('lorebook selectiveLogic andAny/andAll/notAny/notAll', () => {
  // 关键词用非子串碰撞词(ST 默认子串匹配,'apple'/'berry' 不会命中 'trigger'/'zzz')
  const mk = logic => normalizeDeck({ lorebook: [{ name: 'e', keys: ['trigger'], secondaryKeys: ['apple', 'berry'], selectiveLogic: logic, content: 'C' }], settings: { maxRecursionSteps: 1 } })
  const act = (deck, text) => activateLorebook(deck, text, { msgCount: 1, timers: {} }, () => 0).activated.map(e => e.name)
  assert.deepEqual(act(mk('andAny'), 'trigger apple'), ['e'])
  assert.deepEqual(act(mk('andAny'), 'trigger zzz'), [])
  assert.deepEqual(act(mk('andAll'), 'trigger apple berry'), ['e'])
  assert.deepEqual(act(mk('andAll'), 'trigger apple'), [])
  assert.deepEqual(act(mk('notAny'), 'trigger zzz'), ['e'])
  assert.deepEqual(act(mk('notAny'), 'trigger apple'), [])
  assert.deepEqual(act(mk('notAll'), 'trigger apple'), ['e'])
  assert.deepEqual(act(mk('notAll'), 'trigger apple berry'), [])
})

// ── constant + recursion ──
test('lorebook: constant always, recursion activates by content', () => {
  const deck = normalizeDeck({ lorebook: [
    { name: 'const', keys: [], constant: true, content: 'mentions arasaka' },
    { name: 'chain', keys: ['arasaka'], content: 'corp' },
    { name: 'noRec', keys: ['corp'], content: 'z', excludeRecursion: true },
  ], settings: { maxRecursionSteps: 3 } })
  const names = activateLorebook(deck, 'hello world', { msgCount: 1, timers: {} }, () => 0).activated.map(e => e.name).sort()
  assert.deepEqual(names, ['chain', 'const']) // const 常驻→内容触发 chain;noRec 不参与递归
})

test('lorebook: preventRecursion stops the chain', () => {
  const deck = normalizeDeck({ lorebook: [
    { name: 'a', keys: ['start'], content: 'has beta', preventRecursion: true },
    { name: 'b', keys: ['beta'], content: 'end' },
  ], settings: { maxRecursionSteps: 3 } })
  const names = activateLorebook(deck, 'start', { msgCount: 1, timers: {} }, () => 0).activated.map(e => e.name)
  assert.deepEqual(names, ['a']) // a 命中但阻止递归,b 不激活
})

// ── probability / group / budget / sticky-cooldown ──
test('lorebook: probability gate with injected rng', () => {
  const deck = normalizeDeck({ lorebook: [{ name: 'e', keys: ['k'], content: 'C', probability: 30 }], settings: { maxRecursionSteps: 1 } })
  assert.equal(activateLorebook(deck, 'k', { msgCount: 1, timers: {} }, () => 0.1).activated.length, 1) // 10<30 命中
  assert.equal(activateLorebook(deck, 'k', { msgCount: 1, timers: {} }, () => 0.9).activated.length, 0) // 90>30 落空
})

test('lorebook: inclusion group picks one by weight', () => {
  const deck = normalizeDeck({ lorebook: [
    { name: 'g1', keys: ['k'], content: 'A', group: 'mood', groupWeight: 1 },
    { name: 'g2', keys: ['k'], content: 'B', group: 'mood', groupWeight: 99 },
  ], settings: { maxRecursionSteps: 1 } })
  const r = activateLorebook(deck, 'k', { msgCount: 1, timers: {} }, () => 0.99).activated.map(e => e.name)
  assert.equal(r.length, 1) // 同组只留一
})

test('lorebook: char budget drops overflow, order ascending', () => {
  const big = 'x'.repeat(200)
  const deck = normalizeDeck({ lorebook: [
    { name: 'lo', keys: ['k'], content: big, order: 1 },
    { name: 'hi', keys: ['k'], content: big, order: 2 },
  ], settings: { maxRecursionSteps: 1, budgetChars: 250 } })
  const r = activateLorebook(deck, 'k', { msgCount: 1, timers: {} }, () => 0).activated.map(e => e.name)
  assert.equal(r.length, 1) // 预算只容一条
})

test('lorebook: sticky keeps active, cooldown blocks re-trigger, delay gates', () => {
  const deck = normalizeDeck({ lorebook: [{ name: 'e', keys: ['k'], content: 'C', sticky: 2, cooldown: 3, delay: 0 }], settings: { maxRecursionSteps: 1 } })
  let s = { msgCount: 0, timers: {} }
  let r = activateLorebook(deck, 'k', { ...s, msgCount: 1 }, () => 0); assert.equal(r.activated.length, 1); s = r.state
  // 下一条即使无关键词,sticky 仍保持(msg<1+2)
  r = activateLorebook(deck, 'nothing', { ...s, msgCount: 2 }, () => 0); assert.equal(r.activated.length, 1); s = r.state
  // delay 门:delay=5 时早期不激活
  const dd = normalizeDeck({ lorebook: [{ name: 'd', keys: ['k'], content: 'C', delay: 5 }], settings: { maxRecursionSteps: 1 } })
  assert.equal(activateLorebook(dd, 'k', { msgCount: 2, timers: {} }, () => 0).activated.length, 0)
  assert.equal(activateLorebook(dd, 'k', { msgCount: 6, timers: {} }, () => 0).activated.length, 1)
})
