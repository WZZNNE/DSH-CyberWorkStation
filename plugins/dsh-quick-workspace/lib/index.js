/**
 * dsh-quick-workspace: HTTP endpoint that creates a workspace from an absolute path.
 *
 * The core's "ungrouped" group has no workspaceId, and its "+" button's onCreate
 * is guarded by `group.workspaceId !== undefined`
 * (packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx), so clicking it
 * does nothing — sessions must belong to a workspace by design. This plugin does
 * not touch the core; it only offers a side door: the DSH Launcher POSTs an
 * absolute path, the workspace is created, and a page refresh lets the user
 * pick it and start chatting.
 *
 * POST /dsh-quick-workspace/create  { "path": "D:/projects/my-project", "title": "optional" }
 * GET  /dsh-quick-workspace/list
 */
import { existsSync, mkdirSync, statSync } from 'node:fs'

export const name = 'quick-workspace'
export const inject = ['webServer', 'workspaceRegistry']

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  // The same fence every other router in this suite carries: a loopback Host, no cross-site or
  // same-site request, a matching Origin, and a JSON content type — without it any web page could
  // POST here and this route creates directories.
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  const hostOf = req => { const h = String(req.headers.host ?? '').trim().toLowerCase(); const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h); return m ? `[${m[1]}]` : h.replace(/:\d+$/, '') }
  const rejectCrossSite = req => {
    if (!LOOPBACK_HOSTS.has(hostOf(req))) return true
    const site = String(req.headers['sec-fetch-site'] ?? '')
    if (site === 'cross-site' || site === 'same-site') return true
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin.length > 0) {
      try { if (new URL(origin).host.toLowerCase() !== String(req.headers.host ?? '').toLowerCase()) return true } catch { return true }
    }
    if (req.method === 'POST' && !/^application\/json/i.test(String(req.headers['content-type'] ?? ''))) return true
    return false
  }
  const MAX_BODY = 64 * 1024
  // Bytes, not string concatenation: a multibyte character split across two chunks would be
  // corrupted by `b += c`, and an unbounded body would be buffered whole.
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let over = false
    let settled = false
    const fail = (status, message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status })) } }
    req.on('data', chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buf.length
      if (bytes > MAX_BODY) {
        // Drained, not destroyed: destroying the socket means the 413 never reaches the caller.
        if (!over) { over = true; chunks.length = 0; fail(413, 'request body too large'); req.resume() }
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (value === null || typeof value !== 'object' || Array.isArray(value)) { reject(Object.assign(new Error('JSON body must be an object'), { status: 400 })); return }
        resolve(value)
      } catch { reject(Object.assign(new Error('invalid JSON body'), { status: 400 })) }
    })
    req.on('aborted', () => fail(400, 'request aborted'))
    req.on('error', () => fail(400, 'request error'))
  })
  const json = (res, code, data) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(data))
  }

  const route = async (req, res) => {
    if (rejectCrossSite(req)) { req.resume?.(); return json(res, 403, { ok: false, message: 'same-origin requests only' }) }
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/dsh-quick-workspace/list') {
      const list = ctx.workspaceRegistry.list()
      return json(res, 200, { workspaces: list.map(w => ({ id: String(w.id), path: w.path, title: w.title })) })
    }
    if (req.method === 'POST' && url.pathname === '/dsh-quick-workspace/create') {
      let body
      try { body = await readBody(req) } catch (error) { return json(res, error?.status ?? 400, { ok: false, message: String(error?.message ?? error) }) }
      const p = String(body.path ?? '').trim()
      if (p.length === 0) return json(res, 400, { ok: false, message: 'path 不能为空 / path must not be empty' })
      try {
        if (!existsSync(p)) mkdirSync(p, { recursive: true })
        if (!statSync(p).isDirectory()) return json(res, 400, { ok: false, message: 'path 不是目录 / that path is not a directory' })
        const ws = await ctx.workspaceRegistry.create(p, typeof body.title === 'string' && body.title.length > 0 ? body.title : undefined)
        ctx.logger?.info?.(`quick-workspace: created ${p}`)
        return json(res, 200, { ok: true, id: String(ws.id), path: p, message: '工作区已创建,刷新 dsh 页面即可选择 / workspace created — refresh the dsh page to pick it' })
      } catch (error) {
        return json(res, 200, { ok: false, message: String(error?.message ?? error).slice(0, 200) })
      }
    }
    res.writeHead(404)
    res.end()
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-quick-workspace', handler: route }), 'dsh-quick-workspace: create/list routes')
}
