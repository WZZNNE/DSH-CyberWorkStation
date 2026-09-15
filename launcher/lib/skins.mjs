/**
 * Launcher and frontend skins: the CSS files under skins/<target>/, the active one, community skins
 * installed from npm (manifest-v2 asset dirs, the legacy client.js form extracted in a sandboxed child,
 * plain CSS packages, shell packages), and hand-imported skins.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exists, pick, run } from './util.mjs'

/**
 * @param {{ root: string, frontendSkinTarget: string, log: (level: string, msg: string, extra?: object) => void }} env
 *   `root` is the launcher directory (holds skins/ and skin-extract.mjs); `frontendSkinTarget` is the copy the
 *   dsh-skin-loader plugin serves ($DSH_HOME/frontend-skin.css).
 */
export function createSkins({ root, frontendSkinTarget, log }) {
  const SKIN_DIRS = { launcher: path.join(root, 'skins/launcher'), frontend: path.join(root, 'skins/frontend') }
  for (const d of Object.values(SKIN_DIRS)) fs.mkdirSync(d, { recursive: true })
  const activeFile = target => path.join(SKIN_DIRS[target], 'active.txt')
  const listSkins = target => fs.readdirSync(SKIN_DIRS[target]).filter(f => f.endsWith('.css')).map(f => f.replace(/\.css$/, ''))
  const activeSkin = target => { try { return fs.readFileSync(activeFile(target), 'utf8').trim() } catch { return '' } }
  function applySkin(target, name, lang) {
    if (target === 'frontend' && (name === 'none' || name === '')) {
      fs.writeFileSync(activeFile(target), 'none')
      try { fs.writeFileSync(frontendSkinTarget, '') } catch { /* $DSH_HOME may not exist yet */ }
      log('INFO', 'frontend skin cleared')
      return { ok: true, message: pick(lang, '已恢复 dsh 原生外观(刷新页面生效)', 'Restored the stock dsh look (refresh the page)') }
    }
    // Skin names are file stems inside the skin directory; never let one name a path.
    if (/[\\/]|\.\./.test(name)) return { ok: false, message: pick(lang, '皮肤名非法', 'Invalid skin name') }
    const file = path.join(SKIN_DIRS[target], name + '.css')
    if (!exists(file)) return { ok: false, message: pick(lang, '皮肤不存在:' + name, 'Skin not found: ' + name) }
    fs.writeFileSync(activeFile(target), name)
    // The dsh-skin-loader plugin serves $DSH_HOME/frontend-skin.css to the web UI.
    if (target === 'frontend') fs.copyFileSync(file, frontendSkinTarget)
    log('INFO', 'skin applied', { target, name })
    return {
      ok: true,
      message: target === 'frontend'
        ? pick(lang, `已切换前端皮肤:${name}(刷新 dsh 页面生效)`, `Frontend skin switched: ${name} (refresh the dsh page)`)
        : pick(lang, `已切换启动器皮肤:${name}`, `Launcher skin switched: ${name}`),
    }
  }
  // Built-in skins cannot be deleted; deleting the active skin falls back to the default.
  const BUILTIN_SKINS = { launcher: ['default', 'cyberpunk-2077', 'night-city-holo'], frontend: ['cyberpunk-2077', 'night-city-holo'] }
  /**
   * The id an installed community skin is written under. A bundled skin is a repo file the UI refuses
   * to delete, so a package that names itself after one would replace it and leave no way back.
   */
  function communitySkinId(raw) {
    const id = String(raw).replace(/[^\w-]/g, '').slice(0, 40) || 'skin'
    const builtin = [...BUILTIN_SKINS.launcher, ...BUILTIN_SKINS.frontend]
    return builtin.includes(id) ? id + '-community' : id
  }
  /**
   * The frontend skin the web UI loads is a copy ($DSH_HOME/frontend-skin.css)
   * taken when the skin was applied. After a suite update changes a bundled skin
   * file the copy would stay stale, so on boot the active skin is re-copied
   * whenever its source differs.
   */
  function syncActiveFrontendSkin() {
    const name = activeSkin('frontend')
    if (name === '' || name === 'none') return
    const file = path.join(SKIN_DIRS.frontend, name + '.css')
    if (!exists(file)) return
    try {
      const src = fs.readFileSync(file, 'utf8')
      let cur = null
      try { cur = fs.readFileSync(frontendSkinTarget, 'utf8') } catch { /* no copy yet */ }
      if (cur !== src) { fs.copyFileSync(file, frontendSkinTarget); log('INFO', 'frontend skin copy refreshed', { name }) }
    } catch (error) { log('ERROR', 'frontend skin sync failed', { name, error: String(error) }) }
  }
  function deleteSkin(target, name, lang) {
    const safe = String(name ?? '').replace(/[^\w一-龥-]/g, '')
    if (BUILTIN_SKINS[target].includes(safe)) return { ok: false, message: pick(lang, '内置皮肤不可删除:' + safe, 'Built-in skins cannot be deleted: ' + safe) }
    const file = path.join(SKIN_DIRS[target], safe + '.css')
    if (!exists(file)) return { ok: false, message: pick(lang, '皮肤不存在:' + safe, 'Skin not found: ' + safe) }
    fs.rmSync(file)
    if (activeSkin(target) === safe) applySkin(target, target === 'launcher' ? 'default' : 'none', lang)
    log('INFO', 'skin deleted', { target, name: safe })
    return { ok: true, message: pick(lang, '已删除皮肤:' + safe, 'Skin deleted: ' + safe) }
  }

  /**
   * Community skin package in the legacy client-plugin form → plain CSS. The
   * package's client.js is executed by `skin-extract.mjs` in a separate Node
   * process — with the permission model enabled where the runtime supports it
   * (no fs writes, no child processes, no workers) and an 8 s kill timeout — so
   * untrusted package code never runs inside the launcher process. The worker
   * captures every `style.textContent` write and returns the longest one.
   */
  let permissionModel = null
  /**
   * Does this runtime have the permission model? Asked once, of the runtime itself — never inferred
   * from the extraction's own stderr, which the package being extracted controls.
   */
  async function canSandbox() {
    if (permissionModel === null) {
      const probe = await run(process.execPath, ['--permission', '-e', '0'], { timeout: 8000, env: { PATH: process.env.PATH ?? '' } })
      permissionModel = probe.ok
      if (!probe.ok) log('WARN', 'this Node has no permission model: community skins written as a legacy client.js will not be extracted', { node: process.version })
    }
    return permissionModel
  }

  /**
   * Extract a legacy skin's CSS by running its `client.js` in a child process.
   *
   * The child's `vm` context is a convenience, not a boundary — untrusted code reaches the outer realm
   * through any constructor it is handed. The boundary is the child process itself: the permission
   * model (no filesystem writes, no child processes, no workers, reads limited to the two files it
   * needs), an environment holding only PATH, and an 8 s kill. It does not cover the network:
   * the launcher API is kept away from that child by the token above, not by the sandbox. There is no unsandboxed fallback: a
   * runtime that cannot enforce that does not run the package's code at all — the earlier fallback
   * fired on a stderr pattern the package could print for itself.
   */
  async function extractSkinCss(clientJsPath) {
    if (!(await canSandbox())) return ''
    const script = path.join(root, 'skin-extract.mjs')
    // `--allow-fs-read` takes a comma-separated list, and the skin's own directory name comes from the
    // tarball: a comma in either path would split the grant into something other than what was meant.
    if ([script, clientJsPath].some(p => p.includes(','))) {
      log('WARN', 'skin extraction skipped: a path contains a comma', { script, clientJsPath })
      return ''
    }
    const r = await run(process.execPath, ['--permission', `--allow-fs-read=${script}`, `--allow-fs-read=${clientJsPath}`, script, clientJsPath], {
      timeout: 8000,
      env: { PATH: process.env.PATH ?? '' },
    })
    try { return String(JSON.parse(r.stdout).css ?? '') } catch { return '' }
  }

  /** Skin manifest v2 (skin.json `contributes`): plain CSS assets plus background media inlined as data URIs into one file. */
  function buildCssFromManifestV2(dir, info) {
    const read = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8') } catch { return '' } }
    const c = info.contributes ?? {}
    let css = read(c.stylesheet ?? 'skin.css')
    if (c.patches) css += '\n' + read(c.patches)
    if (css.trim().length === 0) return ''
    const inline = src => {
      try {
        const ext = path.extname(src).slice(1).toLowerCase()
        const mime = ext === 'svg' ? 'image/svg+xml' : 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
        return 'url(data:' + mime + ';base64,' + fs.readFileSync(path.join(dir, src)).toString('base64') + ')'
      } catch { return '' }
    }
    const layer = m => {
      if (m?.type !== 'image' || !m.src) return ''
      const img = inline(m.src)
      return img === '' ? '' : (m.scrim ? m.scrim + ', ' : '') + img
    }
    const bm = c.backgroundMedia
    if (bm) {
      // Mirrors the original skin-center runtime (lib/client.js setBodyBackground / BODY_BG_PROPS):
      // the image goes straight onto document.body's background-image/size/position/
      // attachment/repeat — painted above the body colour token, beneath the translucent
      // panels; the negative-z decoration layer only carries video / Wallpaper Engine media.
      // Light/dark variants follow the body[data-ds-dark-theme] attribute, not prefers-color-scheme.
      const light = layer(bm.light ?? bm.dark)
      const dark = layer(bm.dark ?? bm.light)
      const bodyBg = v => `background-image:${v};background-size:cover;background-position:center;background-attachment:fixed;background-repeat:no-repeat`
      if (light) css += `\nbody:not([data-ds-dark-theme]){${bodyBg(light)}}`
      if (dark) css += `\nbody[data-ds-dark-theme]{${bodyBg(dark)}}`
    }
    return css
  }

  /**
   * npm skin package → local CSS skin file(s). Supports manifest-v2 asset dirs,
   * the legacy client.js plugin form, aggregator packages with a skins/ folder,
   * plain CSS packages, and shell packages that only depend on skin packages
   * (up to two levels of dependency recursion).
   */
  async function installSkinFromNpm(pkg, lang, depth = 0) {
    const meta = await (await fetch('https://registry.npmjs.org/' + pkg.replace('/', '%2F') + '/latest', { signal: AbortSignal.timeout(20000) })).json()
    const tarball = meta?.dist?.tarball
    if (!tarball) return { ok: false, message: pick(lang, 'npm 上找不到该包', 'Package not found on npm') }
    const tmp = path.join(os.tmpdir(), 'dsh-skin-' + Date.now())
    fs.mkdirSync(tmp, { recursive: true })
    const tgz = path.join(tmp, 'pkg.tgz')
    fs.writeFileSync(tgz, Buffer.from(await (await fetch(tarball, { signal: AbortSignal.timeout(60000) })).arrayBuffer()))
    const r = await run('tar', ['-xzf', tgz, '-C', tmp], { timeout: 60000 })
    if (!r.ok) return { ok: false, message: pick(lang, '解包失败:', 'Extraction failed: ') + r.stderr.slice(0, 120) }
    const rootDir = path.join(tmp, 'package')
    const installed = []
    // 1) single skin or aggregator: directories holding skin.json (+ lib/client.js)
    const candidates = [rootDir]
    const skinsDir = path.join(rootDir, 'skins')
    if (exists(skinsDir)) for (const d of fs.readdirSync(skinsDir)) candidates.push(path.join(skinsDir, d))
    for (const dir of candidates) {
      const sj = path.join(dir, 'skin.json')
      if (!exists(sj)) continue
      let info = {}
      try { info = JSON.parse(fs.readFileSync(sj, 'utf8')) } catch { /* metadata is optional for extraction */ }
      // manifest-v2 asset directories first; fall back to out-of-process extraction of the legacy client.js form
      let css = info.contributes ? buildCssFromManifestV2(dir, info) : ''
      if (css.length < 200) {
        const cj = path.join(dir, 'lib/client.js')
        if (exists(cj)) {
          css = await extractSkinCss(cj)
          if (info.bodyAttr) css = css.split('body[' + info.bodyAttr + ']').join('body').split('[' + info.bodyAttr + ']').join('body')
        }
      }
      if (css.length < 200) continue
      const id = communitySkinId(String(info.id ?? path.basename(dir)))
      const head = `/* ${info.name ?? id}${info.nameEn ? ' / ' + info.nameEn : ''} — source: npm ${pkg} (author: ${info.author ?? 'unknown'}) · converted to a CSS skin by DSH Launcher */\n`
      fs.writeFileSync(path.join(SKIN_DIRS.frontend, id + '.css'), head + css)
      installed.push(id)
    }
    // 2) plain CSS packages: .css files at the package root
    if (installed.length === 0) {
      for (const f of fs.readdirSync(rootDir)) {
        if (!f.endsWith('.css')) continue
        const id = communitySkinId(f.replace(/\.css$/, ''))
        fs.copyFileSync(path.join(rootDir, f), path.join(SKIN_DIRS.frontend, id + '.css'))
        installed.push(id)
      }
    }
    // 3) shell packages (e.g. the retired @linxin666/dsh-skins): recurse into skin-like dependencies (depth < 2 → at most two levels)
    if (installed.length === 0 && depth < 2) {
      let deps = {}
      try { deps = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).dependencies ?? {} } catch { /* no package.json */ }
      for (const dep of Object.keys(deps)) {
        if (!/skin|theme/i.test(dep)) continue
        const r2 = await installSkinFromNpm(dep, lang, depth + 1)
        if (r2.ok && Array.isArray(r2.installed)) installed.push(...r2.installed)
      }
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* a leftover temp dir is harmless */ }
    log('INFO', 'skin market install', { pkg, installed, depth })
    if (installed.length === 0) return { ok: false, message: pick(lang, '包内未发现可转换的皮肤(需 skin.json 资产目录或 .css)', 'No convertible skin found in the package (needs a skin.json asset dir or .css files)'), installed }
    return {
      ok: true,
      installed,
      message: pick(lang, '已转换为本地 CSS 皮肤:' + installed.join('、') + '(在皮肤管理页切换/删除)', 'Converted to local CSS skins: ' + installed.join(', ') + ' (switch / delete on the Skins page)'),
    }
  }

  function importSkin(target, name, css, lang) {
    // A hand-imported skin may not take a bundled skin's name either: the UI would then refuse to
    // delete what the user just imported, and the repo's own file would be gone.
    const raw = String(name ?? '').replace(/[^\w一-龥-]/g, '').slice(0, 40)
    const safe = (BUILTIN_SKINS[target] ?? []).includes(raw) ? raw + '-community' : raw
    if (safe.length === 0 || typeof css !== 'string' || css.length === 0 || css.length > 500000) return { ok: false, message: pick(lang, '名称或 CSS 内容非法', 'Invalid skin name or CSS') }
    fs.writeFileSync(path.join(SKIN_DIRS[target], safe + '.css'), css)
    log('INFO', 'skin imported', { target, name: safe, bytes: css.length })
    return { ok: true, message: pick(lang, `已导入皮肤:${safe}`, `Skin imported: ${safe}`) }
  }

  return { SKIN_DIRS, BUILTIN_SKINS, activeFile, listSkins, activeSkin, applySkin, communitySkinId, syncActiveFrontendSkin, deleteSkin, canSandbox, extractSkinCss, buildCssFromManifestV2, installSkinFromNpm, importSkin }
}
