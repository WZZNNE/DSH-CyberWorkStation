/**
 * dsh-skin-studio-cws host plugin — the model-facing one-click skin studio.
 *
 * Registers the skin_studio tool: once the agent has written the CSS for the
 * requested skin it calls the tool, which inlines local images as data URIs
 * and persists + applies the skin through the DSH Launcher API
 * (/api/skins/import + /api/skins/apply). The interaction flow is constrained
 * by a systemPrompt section: ask for requirements first; when the user gave no
 * image and the model cannot generate one, ask the user for an image (never
 * fabricate one); when an image-generation tool exists, call it.
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { assertTarget, buildCss, imageToDataUri, sanitizeSkinName } from './studio.js'
import fs from 'node:fs'
import nodePath from 'node:path'

export const name = 'skin-studio'
export const inject = ['tools', 'systemPrompt']

const launcherPort = String(process.env.DSH_LAUNCHER_PORT ?? 3090).trim()
if (!/^\d+$/.test(launcherPort) || Number(launcherPort) < 1 || Number(launcherPort) > 65535) throw new Error('DSH_LAUNCHER_PORT must be an integer between 1 and 65535')
const LAUNCHER = `http://127.0.0.1:${Number(launcherPort)}`

async function launcherPost(path, body) {
  if (!['/api/skins/import', '/api/skins/apply'].includes(path)) throw new Error('Unsupported launcher skin route')
  const home = resolveDshHome()
  let token
  try { token = fs.readFileSync(nodePath.join(home, 'launcher.token'), 'utf8').trim() } catch {
    throw new Error('无法读取启动器认证文件；请先启动同一 DSH_HOME 下的 DSH 启动器')
  }
  if (!/^[0-9a-f]{32,64}$/.test(token)) throw new Error('启动器认证文件无效；请检查 DSH_HOME 并重新启动启动器')
  let r
  try { r = await fetch(LAUNCHER + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-launcher-token': token },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  }) } catch {
    throw new Error(`无法连接 DSH 启动器(${LAUNCHER})，或请求发生了不允许的重定向；请检查启动器和端口`)
  }
  if (r.status === 403) throw new Error('启动器拒绝认证(HTTP 403)；请确认 dsh 和启动器使用同一 DSH_HOME')
  if (!r.ok) throw new Error(`启动器请求失败(HTTP ${r.status})`)
  const data = await r.json().catch(() => null)
  if (!data || typeof data.ok !== 'boolean') throw new Error('启动器返回了无效响应')
  return data
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:skin-studio',
    order: 130,
    text: [
      '皮肤工坊:用户想制作/定制 DSH 启动器皮肤或 dsh 本体(前端)皮肤时,用 skin_studio 工具落地,但必须先走需求流程:',
      '1) 先提问确认再动手:目标(launcher 启动器 / frontend 本体前端)、风格、主色、明暗基调、是否要背景图。需求明确前不要直接产出。',
      '2) 背景图:用户没提供图片时——如果你有图像生成类工具,先调用它生成图片文件再使用;如果没有,直接告诉用户你不能生图,请其给出本地图片路径,或改选无图的纯色/渐变设计。禁止虚构不存在的图片路径。',
      '3) 写完整 CSS:launcher 皮肤覆盖 :root 的 --lc-* 变量(bg/nav-bg/card-bg/text/accent/border 等);frontend 皮肤重映射 --dsw-alias-* 设计 token(暗色写在 body[data-ds-dark-theme] 下)。需要背景图的位置写 url(__SKIN_BG__) 占位符,并把图片路径传给工具的 background_image_path。',
      '4) 调 skin_studio(默认立即启用),然后告知用户:启动器皮肤立即可见,本体皮肤刷新 dsh 页面生效。工具报错说启动器未运行时,请用户先打开 DSH 启动器。',
    ].join('\n'),
  })

  ctx.tools.register(defineTool({
    name: 'skin_studio',
    description: '一键制作并安装 DSH 皮肤:把写好的 CSS 落盘为启动器(launcher)或 dsh 本体前端(frontend)皮肤并立即启用。支持本地图片自动内联为 dataURI(CSS 中用 url(__SKIN_BG__) 占位)。需要 DSH 启动器在运行。',
    parameters: {
      target: { type: 'string', required: true, description: "皮肤目标:'launcher'(启动器工作台)或 'frontend'(dsh 本体 Web UI)。" },
      name: { type: 'string', required: true, description: '皮肤名(字母数字中文连字符,≤40),同名覆盖。' },
      css: { type: 'string', required: true, description: '完整皮肤 CSS。背景图位置写 url(__SKIN_BG__) 占位符。' },
      background_image_path: { type: 'string', description: '本地图片绝对路径(png/jpg/webp/gif/svg,≤25MB),内联为 dataURI 替换 __SKIN_BG__;CSS 未写占位符时自动追加 body 背景规则。' },
      apply: { type: 'boolean', description: '落盘后是否立即启用,默认 true。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', required: true },
          name: { type: 'string', required: true },
          cssBytes: { type: 'integer', required: true },
          applied: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `皮肤「${value.name}」已写入 ${value.target}(${value.cssBytes} 字节)${value.applied ? ',已启用' : ',未启用'}。${value.message}`,
      }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const target = assertTarget(args.target)
      const skinName = sanitizeSkinName(args.name)
      const dataUri = args.background_image_path === undefined ? undefined : imageToDataUri(args.background_image_path)
      const css = buildCss(args.css, target, dataUri)
      const imported = await launcherPost('/api/skins/import', { target, name: skinName, css })
      if (imported?.ok === false) throw new Error('启动器拒绝导入:' + (imported.message ?? '未知原因'))
      const wantApply = args.apply !== false
      let applied = false
      let message = imported?.message ?? '已导入'
      if (wantApply) {
        const a = await launcherPost('/api/skins/apply', { target, name: skinName })
        applied = a?.ok === true
        message = a?.message ?? message
      }
      return { target, name: skinName, cssBytes: css.length, applied, message }
    },
  }))
}
