/**
 * dsh-skin-loader host half: serve the active frontend skin CSS at
 * GET /dsh-skin-loader/active.css from $DSH_HOME/frontend-skin.css, stat'd on every
 * request (an unchanged file answers 304 from its ETag, a changed one is read afresh)
 * so the DSH Launcher can switch skins by writing
 * that one file — a page refresh applies it. Route registration follows the
 * ctx.webServer.register prefix pattern (same as dsh-token-usage).
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isLoopbackRequest, refuse } from 'dsh-cyberworkstation-kit/fence'

export const name = 'skin-loader'
export const inject = ['webServer']

const SKIN_FILE = join(resolveDshHome(), 'frontend-skin.css')

/**
 * Mount the skin route.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const route = (req, res) => {
    if (!isLoopbackRequest(req)) return refuse(req, res)
    const url = new URL(req.url, 'http://127.0.0.1')
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/dsh-skin-loader/active.css') {
      let stamp = ''
      let mtimeMs = 0
      let size = 0
      try { const st = statSync(SKIN_FILE); stamp = st.mtime.toUTCString(); mtimeMs = Math.round(st.mtimeMs); size = st.size } catch { /* no skin file = stock look */ }
      // Validators from the stat alone: the skin can be half a megabyte (an inlined background), so a
      // revalidation must not read it. The length is the byte size on disk (UTF-8, as served).
      const etag = '"' + size.toString(16) + '-' + mtimeMs.toString(16) + '"'
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-cache', ...(stamp ? { 'last-modified': stamp } : {}) }); return res.end() }
      let css = ''
      try { css = readFileSync(SKIN_FILE, 'utf8') } catch { /* no skin file = stock look */ }
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache', etag, ...(stamp ? { 'last-modified': stamp } : {}) })
      res.end(req.method === 'HEAD' ? undefined : css)
      return
    }
    res.writeHead(404)
    res.end()
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-skin-loader', handler: route }), 'dsh-skin-loader: active skin css route')
}
