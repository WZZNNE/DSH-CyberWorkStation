/**
 * dsh-skin-studio-cws pure layer: argument validation, image inlining, CSS assembly.
 * Decoupled from the host (ctx / fetch) so it is unit-testable.
 */
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

export const BG_PLACEHOLDER = '__SKIN_BG__'

/** Allow-list the skin name (same rule as the launcher's importSkin; fails early with a clear message for the model). */
export function sanitizeSkinName(name) {
  const safe = String(name ?? '').replace(/[^\w一-龥-]/g, '').slice(0, 40)
  if (safe.length === 0) throw new Error('皮肤名为空或全为非法字符(允许:字母数字下划线中文连字符,≤40)')
  return safe
}

export function assertTarget(target) {
  if (target !== 'launcher' && target !== 'frontend') {
    throw new Error("target 只能是 'launcher'(启动器)或 'frontend'(dsh 本体前端)")
  }
  return target
}

/** Local image → data URI (magic-number check rejects non-images; 25 MB cap keeps the CSS bounded). */
export function imageToDataUri(path, readFile = readFileSync) {
  const buf = readFile(path)
  if (buf.length > 25 * 1048576) throw new Error('图片超过 25MB,请换更小的图或压缩后重试')
  const magic = buf.subarray(0, 4).toString('hex')
  const riffTag = buf.subarray(8, 12).toString('latin1')
  let mime = null
  if (magic.startsWith('89504e47')) mime = 'image/png'
  else if (magic.startsWith('ffd8')) mime = 'image/jpeg'
  else if (magic.startsWith('52494646') && riffTag === 'WEBP') mime = 'image/webp'
  else if (magic.startsWith('47494638')) mime = 'image/gif'
  else if (buf.subarray(0, 5).toString('latin1') === '<svg ' || buf.subarray(0, 5).toString('latin1') === '<?xml') mime = 'image/svg+xml'
  if (mime === null) throw new Error(`文件不是可识别的图片(png/jpg/webp/gif/svg):${extname(path) || path}`)
  return `data:${mime};base64,${buf.toString('base64')}`
}

/**
 * Assemble the final CSS:
 * - the CSS contains url(__SKIN_BG__) placeholders → every one is replaced by the data URI;
 * - no placeholder but an image was given → a default background rule is appended per target
 *   (frontend writes body directly, like the original skin-center layering; launcher covers body).
 */
export function buildCss(css, target, dataUri) {
  let out = String(css ?? '')
  if (out.trim().length === 0) throw new Error('css 不能为空')
  if (dataUri === undefined) {
    if (out.includes(BG_PLACEHOLDER)) throw new Error('CSS 里写了 url(__SKIN_BG__) 占位符,但没有传 background_image_path')
    return out
  }
  if (out.includes(BG_PLACEHOLDER)) return out.split(BG_PLACEHOLDER).join(dataUri)
  const rule = target === 'frontend'
    ? `\nbody{background-image:url(${dataUri});background-size:cover;background-position:center;background-attachment:fixed;background-repeat:no-repeat}`
    : `\nbody{background:url(${dataUri}) center/cover fixed no-repeat}`
  return out + rule
}
