/**
 * dsh-price-hint host half: expose a "model display name → price hint" map at
 * GET /dsh-price-hint/prices.json for the browser half.
 * Names come from the llm-pi-ai providers.models settings (id + name); prices
 * come from the cost-meter ledger config.prices.providers (USD per 1M tokens,
 * cacheMiss = input, output = output). Read on every request, so a refreshed
 * price table applies immediately.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLoopbackRequest, refuse } from '@dsh-suite/kit/fence'

export const name = 'price-hint'
export const inject = ['webServer']

const LEDGER = join(resolveDshHome(), 'storages', 'cost-meter', 'ledger.json')

// The picker exposes display names, not provider/model identities. A name is safe
// only when every declared model bearing it has the same known displayed price.
export function buildPriceMap(providers, prices) {
  const labels = new Map()
  for (const [pid, cfg] of Object.entries(providers ?? {})) {
    const table = prices?.[pid]?.models ?? {}
    for (const model of (Array.isArray(cfg?.models) ? cfg.models : [])) {
      const id = typeof model === 'string' ? model : model?.id
      const label = typeof model?.name === 'string' ? model.name : id
      if (typeof id !== 'string' || typeof label !== 'string' || !label.trim()) continue
      const e = table[id]
      const known = e && [e.cacheMiss, e.output, e.cacheHit].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      const hint = known ? `输入 $${e.cacheMiss}/M · 输出 $${e.output}/M` + (e.cacheHit !== e.cacheMiss ? ` · 缓存 $${e.cacheHit}/M` : '') : null
      const key = label.trim()
      if (!labels.has(key)) labels.set(key, hint)
      else if (labels.get(key) !== hint) labels.set(key, null)
    }
  }
  return Object.fromEntries([...labels].filter(([, hint]) => hint !== null))
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const buildMap = () => {
    let prices = {}
    try { prices = JSON.parse(readFileSync(LEDGER, 'utf8')).config?.prices?.providers ?? {} } catch { /* no ledger yet */ }
    const settings = ctx.get('settings')
    const providers = typeof settings?.get === 'function' ? settings.get('llm-pi-ai')?.providers : undefined
    return buildPriceMap(providers, prices)
  }
  const route = (req, res) => {
    if (!isLoopbackRequest(req)) return refuse(req, res)
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
