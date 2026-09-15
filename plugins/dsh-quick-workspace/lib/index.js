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
import { rejectCrossSite, json, readBody as kitReadBody } from '@dsh-suite/kit/fence'

export const name = 'quick-workspace'
export const inject = ['webServer', 'workspaceRegistry']

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const MAX_BODY = 64 * 1024
  const readBody = (req, limit = MAX_BODY) => kitReadBody(req, limit)

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
