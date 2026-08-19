/**
 * dsh-control-deck v2 host 插件 —— SillyTavern 级提示词/正则/世界书/采样控制。
 * 全部经文档化扩展点(systemPrompt.section / agent/pre-step / agent/request /
 * tools/pre-execute)实现,不改本体任何底层逻辑。
 *
 * 思考强度(reasoningEffort)刻意不做:本体模型选择器已原生提供,避免冲突。
 *
 * 配置 ~/.dsh/control-deck.json,watchFile 热载(unref 保证一次性进程可正常退出)。
 * 世界书时效状态按 SessionId 隔离,存于内存。
 */
import { readFileSync, watchFile } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeDeck, compileRules, applyRules, activateLorebook } from './deck.js'

export const name = 'control-deck'
export const inject = ['systemPrompt', 'tools']

const DECK_FILE = join(homedir(), '.dsh', 'control-deck.json')

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  let deck = normalizeDeck(null)
  let userRules = []
  let promptDisposers = []
  const loreState = new Map()
  let stepCounter = 0

  const loadDeck = () => {
    let raw = null
    try { raw = JSON.parse(readFileSync(DECK_FILE, 'utf8')) } catch { /* 无文件/坏 JSON = 全默认 */ }
    deck = normalizeDeck(raw)
    userRules = compileRules(deck.regex, 'user_input')
    for (const d of promptDisposers) { try { d() } catch { /* 已卸载 */ } }
    promptDisposers = []
    for (const p of deck.prompts) {
      if (!p.enabled || p.position !== 'system' || p.interval > 1) continue
      promptDisposers.push(ctx.systemPrompt.section({ name: 'control-deck:' + p.name, order: p.order, text: p.text }))
    }
    console.log(`[control-deck] loaded: ${deck.prompts.length} prompts, ${deck.regex.length} regex, ${deck.lorebook.length} lore, tools-off=${deck.disabledTools.length}`)
  }
  loadDeck()
  const watcher = watchFile(DECK_FILE, { interval: 1500 }, loadDeck)
  watcher.unref?.()
  ctx.effect(() => () => { for (const d of promptDisposers) { try { d() } catch { /* noop */ } } }, 'control-deck: dispose sections')

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    let messages = decision.messages

    if (userRules.length > 0) {
      messages = messages.map(m => ({
        ...m,
        content: m.content.map(b => (b.type === 'text' ? { ...b, text: applyRules(b.text, userRules) } : b)),
      }))
    }

    const sid = String(payload.agent?.id ?? 'default')
    const st = loreState.get(sid) ?? { msgCount: 0, timers: {} }
    st.msgCount = (st.msgCount ?? 0) + 1

    const preBlocks = []
    stepCounter += 1
    for (const p of deck.prompts) {
      if (!p.enabled) continue
      if (p.position === 'user-prefix' || (p.position === 'system' && p.interval > 1)) {
        if (stepCounter % p.interval === 0) preBlocks.push(p.text)
      }
    }
    if (deck.lorebook.length > 0) {
      // ST scanDepth 语义:扫描源 = 本步消息 + 会话日志最近 N 条 user/assistant 消息文本。
      const claimed = messages.map(m => m.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')).join('\n')
      const hist = []
      const events = payload.agent?.session?.events ?? []
      for (let i = events.length - 1; i >= 0 && hist.length < deck.settings.scanDepth; i--) {
        const ev = events[i]
        if (ev?.type !== 'user/message' && ev?.type !== 'assistant/message') continue
        const content = ev.data?.message?.content ?? ev.data?.content ?? []
        const text = (Array.isArray(content) ? content : []).map(b => (b?.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
        if (text.length > 0) hist.unshift(text)
      }
      const scanText = hist.join('\n') + '\n' + claimed
      const { activated, state } = activateLorebook(deck, scanText, st, Math.random)
      loreState.set(sid, state)
      if (activated.length > 0) preBlocks.push('[世界信息]\n' + activated.map(e => e.content).join('\n'))
    } else {
      loreState.set(sid, st)
    }

    if (preBlocks.length > 0 && messages.length > 0) {
      const first = messages[0]
      const idx = first.content.findIndex(b => b.type === 'text')
      if (idx >= 0) {
        const inject = preBlocks.join('\n\n') + '\n\n'
        const content = first.content.map((b, i) => (i === idx ? { ...b, text: inject + b.text } : b))
        messages = [{ ...first, content }, ...messages.slice(1)]
      }
    }
    return { kind: 'enter', messages }
  })

  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const s = deck.sampling
    if (!s.enabled) return config // 采样总开关未启用:不合并任何参数,防误传
    return {
      ...config,
      ...(s.temperature !== undefined ? { temperature: s.temperature } : {}),
      ...(s.maxTokens !== undefined ? { maxTokens: s.maxTokens } : {}),
      ...(s.stop.length > 0 ? { stop: s.stop } : {}),
    }
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (deck.disabledTools.includes(exec.name)) {
      return { kind: 'deny', reason: `control-deck: 工具 ${exec.name} 已在控制甲板中关闭` }
    }
    return next()
  })
}
