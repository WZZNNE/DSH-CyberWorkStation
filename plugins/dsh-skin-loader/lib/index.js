/**
 * dsh-skin-loader host half:serve the active frontend skin CSS at
 * GET /dsh-skin-loader/active.css, read fresh from $DSH_HOME/frontend-skin.css
 * on every request (no cache) so the DSH Launcher can switch skins by writing
 * that one file — a page refresh applies it. Route registration follows the
 * ctx.webServer.register prefix pattern (same as dsh-token-usage).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'skin-loader'
export const inject = ['webServer']

const SKIN_FILE = join(homedir(), '.dsh', 'frontend-skin.css')

/**
 * Mount the skin route.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const route = (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/dsh-skin-loader/active.css') {
      let css = ''
      try { css = readFileSync(SKIN_FILE, 'utf8') } catch { /* 无皮肤文件 = 原生外观 */ }
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
      res.end(css)
      return
    }
    res.writeHead(404)
    res.end()
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-skin-loader', handler: route }), 'dsh-skin-loader: active skin css route')
}
