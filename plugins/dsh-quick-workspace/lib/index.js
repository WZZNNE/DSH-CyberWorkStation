/**
 * dsh-quick-workspace:按绝对路径创建工作区的 HTTP 端点。
 *
 * 本体的「未分组」分组没有 workspaceId,其加号的 onCreate 有
 * `group.workspaceId !== undefined` 前置(packages/client/ui-workspace/src/client/
 * WorkspaceBrowser.tsx:460),因此点击必然无反应 —— 会话必须归属工作区是本体设计。
 * 本插件不改本体,只提供一条旁路:DSH Launcher 直接 POST 一个绝对路径即可建好
 * 工作区,建完刷新 dsh 页面就能选中并开始对话。
 *
 * POST /dsh-quick-workspace/create  { "path": "H:/my-project", "title": "可选" }
 * GET  /dsh-quick-workspace/list
 */
import { existsSync, mkdirSync, statSync } from 'node:fs'

export const name = 'quick-workspace'
export const inject = ['webServer', 'workspaceRegistry']

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const readBody = req => new Promise(resolve => {
    let b = ''
    req.on('data', c => { b += c })
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')) } catch { resolve({}) } })
  })
  const json = (res, code, data) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(data))
  }

  const route = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/dsh-quick-workspace/list') {
      const list = ctx.workspaceRegistry.list()
      return json(res, 200, { workspaces: list.map(w => ({ id: String(w.id), path: w.path, title: w.title })) })
    }
    if (req.method === 'POST' && url.pathname === '/dsh-quick-workspace/create') {
      const body = await readBody(req)
      const p = String(body.path ?? '').trim()
      if (p.length === 0) return json(res, 400, { ok: false, message: 'path 不能为空' })
      try {
        if (!existsSync(p)) mkdirSync(p, { recursive: true })
        if (!statSync(p).isDirectory()) return json(res, 400, { ok: false, message: 'path 不是目录' })
        const ws = await ctx.workspaceRegistry.create(p, typeof body.title === 'string' && body.title.length > 0 ? body.title : undefined)
        ctx.logger?.info?.(`quick-workspace: created ${p}`)
        return json(res, 200, { ok: true, id: String(ws.id), path: p, message: '工作区已创建,刷新 dsh 页面即可选择' })
      } catch (error) {
        return json(res, 200, { ok: false, message: String(error?.message ?? error).slice(0, 200) })
      }
    }
    res.writeHead(404)
    res.end()
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-quick-workspace', handler: route }), 'dsh-quick-workspace: create/list routes')
}
