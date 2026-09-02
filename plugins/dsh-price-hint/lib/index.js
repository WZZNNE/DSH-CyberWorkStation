/**
 * dsh-price-hint host half: expose a "model display name → price hint" map at
 * GET /dsh-price-hint/prices.json for the browser half.
 * Names come from the llm-pi-ai providers.models settings (id + name); prices
 * come from the cost-meter ledger config.prices.providers (USD per 1M tokens,
 * cacheMiss = input, output = output). Read on every request, so a refreshed
 * price table applies immediately.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'price-hint'
export const inject = ['webServer']

const LEDGER = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'cost-meter', 'ledger.json')

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const buildMap = () => {
    const map = {}
    let prices = {}
    try { prices = JSON.parse(readFileSync(LEDGER, 'utf8')).config?.prices?.providers ?? {} } catch { /* no ledger yet */ }
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
  // A GET-only, no-CORS route still answers a DNS-rebinding page, which is same-origin to the
  // browser: the Host header is what tells us the request really came to a loopback address.
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  const hostOf = req => { const h = String(req.headers.host ?? '').trim().toLowerCase(); const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h); return m ? `[${m[1]}]` : h.replace(/:\d+$/, '') }
  const route = (req, res) => {
    if (!LOOPBACK_HOSTS.has(hostOf(req))) { req.resume?.(); res.writeHead(403); return res.end() }
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
