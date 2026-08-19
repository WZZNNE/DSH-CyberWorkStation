/**
 * dsh-price-hint host 半:把「模型显示名 → 价格提示文本」映射经
 * GET /dsh-price-hint/prices.json 提供给浏览器半。
 * 名称来自 settings 的 llm-pi-ai providers.models(id+name),
 * 价格来自 cost-meter 账本 config.prices.providers(USD/1M,cacheMiss=输入,output=输出)。
 * 每次请求现读,价格表更新即生效。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'price-hint'
export const inject = ['webServer']

const LEDGER = join(homedir(), '.dsh', 'storages', 'cost-meter', 'ledger.json')

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const buildMap = () => {
    const map = {}
    let prices = {}
    try { prices = JSON.parse(readFileSync(LEDGER, 'utf8')).config?.prices?.providers ?? {} } catch { /* 无账本 */ }
    const settings = ctx.get('settings')
    const providers = typeof settings?.get === 'function' ? settings.get('llm-pi-ai')?.providers : undefined
    if (providers !== null && typeof providers === 'object') {
      for (const [pid, cfg] of Object.entries(providers)) {
        const table = prices[pid]?.models ?? {}
        for (const m of (Array.isArray(cfg?.models) ? cfg.models : [])) {
          const id = typeof m === 'string' ? m : m?.id
          const label = typeof m === 'object' && typeof m?.name === 'string' ? m.name : id
          const e = table[id]
          if (typeof id !== 'string' || e === undefined) continue
          map[label] = `输入 $${e.cacheMiss}/M · 输出 $${e.output}/M` + (e.cacheHit !== e.cacheMiss ? ` · 缓存 $${e.cacheHit}/M` : '')
        }
      }
    }
    return map
  }
  const route = (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/dsh-price-hint/prices.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(buildMap()))
      return
    }
    res.writeHead(404); res.end()
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-price-hint', handler: route }), 'dsh-price-hint: prices route')
}
