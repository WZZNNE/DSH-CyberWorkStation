/**
 * DSH Launcher — DeepSeek Harness 可视化管理工作台后端。
 * 零依赖 Node 服务(node:http):进程管理、插件/Skill/会话/存储、更新、
 * tokens 统计、启动器与前端皮肤管理。所有动作写入 logs/ 内部日志。
 *
 * 启动:node H:/dsh-launcher/server.mjs  → http://127.0.0.1:3090
 */
import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
// 本体检出位置:环境变量 > 整合包内置 core/ > 套件同级 deepseek-harness/ > 本机默认
const REPO = process.env.DSH_REPO
  ?? [path.join(ROOT, '..', 'core'), path.join(ROOT, '..', 'deepseek-harness')].find(p => fs.existsSync(path.join(p, 'package.json')))
  ?? path.join(ROOT, '..', 'core')
const DSH_HOME = path.join(os.homedir(), '.dsh')
const PLUGINS_DIR = process.env.DSH_SUITE_PLUGINS ?? path.join(ROOT, '..', 'plugins')
const PROFILE = path.join(DSH_HOME, 'profiles/web')
const LEDGER = process.env.DSH_LAUNCHER_LEDGER ?? path.join(DSH_HOME, 'storages/cost-meter/ledger.json')
const FRONTEND_SKIN_TARGET = path.join(DSH_HOME, 'frontend-skin.css')
const PORT = Number(process.env.DSH_LAUNCHER_PORT ?? 3090)
const DSH_PORT = 3080

// ── 内部日志 ────────────────────────────────────────────────────────────────
const LOG_DIR = path.join(ROOT, 'logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}\n`
  const file = path.join(LOG_DIR, `launcher-${new Date().toISOString().slice(0, 10)}.log`)
  try { fs.appendFileSync(file, line) } catch { /* 日志失败不影响服务 */ }
  if (level === 'ERROR') console.error(line.trim()); else console.log(line.trim())
}

// ── 小工具 ──────────────────────────────────────────────────────────────────
const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }
const readBody = req => new Promise(resolve => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch { resolve({}) } }) })
const exists = p => { try { fs.accessSync(p); return true } catch { return false } }

function checkPort(port) {
  return new Promise(resolve => {
    const s = createConnection({ host: '127.0.0.1', port, timeout: 900 })
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })
}

function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 60000, cwd: opts.cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: error === null, code: error?.code ?? 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/** netstat 找 3080 监听 PID(Windows)。 */
async function dshPid() {
  const r = await run('netstat', ['-ano'])
  if (!r.ok) return null
  for (const line of r.stdout.split('\n')) {
    if (line.includes(`:${DSH_PORT}`) && /LISTENING/.test(line)) {
      const pid = Number(line.trim().split(/\s+/).pop())
      if (Number.isFinite(pid) && pid > 0) return pid
    }
  }
  return null
}

/** 目录递归大小(字节)+ 60s 缓存;深层大目录也只遍历一次。 */
const sizeCache = new Map()
function dirSize(p) {
  const hit = sizeCache.get(p)
  if (hit !== undefined && Date.now() - hit.at < 60000) return hit.size
  let total = 0
  const walk = d => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const fp = path.join(d, e.name)
      try {
        if (e.isSymbolicLink()) continue
        if (e.isDirectory()) walk(fp)
        else total += fs.statSync(fp).size
      } catch { /* 忙碌/权限文件跳过 */ }
    }
  }
  if (exists(p)) walk(p)
  sizeCache.set(p, { at: Date.now(), size: total })
  return total
}

// ── dsh 进程管理 ────────────────────────────────────────────────────────────
let dshChild = null
async function startDsh() {
  if (await checkPort(DSH_PORT)) return { ok: false, message: `dsh 已在运行(端口 ${DSH_PORT})` }
  const out = fs.openSync(path.join(ROOT, 'dsh.log'), 'a')
  fs.writeSync(out, `\n===== launcher start ${new Date().toISOString()} =====\n`)
  dshChild = spawn('cmd.exe', ['/c', 'corepack', 'pnpm', 'dsh', 'web'], {
    cwd: REPO, windowsHide: true, stdio: ['ignore', out, out],
  })
  dshChild.unref()
  log('INFO', 'dsh start requested', { spawnPid: dshChild.pid })
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500))
    if (await checkPort(DSH_PORT)) { log('INFO', 'dsh is up'); return { ok: true, message: `dsh 已启动:http://127.0.0.1:${DSH_PORT}` } }
  }
  log('ERROR', 'dsh did not come up within 60s')
  return { ok: false, message: '60 秒内未监听 3080,查看 dsh.log' }
}
async function stopDsh() {
  const pid = await dshPid()
  if (pid === null) return { ok: false, message: 'dsh 未在运行' }
  // 沿父链把包着 dsh 的 cmd/conhost 控制台一并关闭(最多上溯 3 层,只杀 shell 宿主)。
  const parents = []
  let cur = pid
  for (let i = 0; i < 3; i++) {
    const pq = await run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId=' + cur + '").ParentProcessId'])
    const ppid = Number(pq.stdout.trim())
    if (!Number.isFinite(ppid) || ppid <= 4) break
    const nq = await run('powershell', ['-NoProfile', '-Command', '(Get-Process -Id ' + ppid + ' -ErrorAction SilentlyContinue).ProcessName'])
    const pname = nq.stdout.trim().toLowerCase()
    if (pname === 'cmd' || pname === 'conhost' || pname === 'node') { parents.push(ppid); cur = ppid } else break
  }
  const r = await run('taskkill', ['/PID', String(pid), '/T', '/F'])
  for (const pp of parents) await run('taskkill', ['/PID', String(pp), '/T', '/F'])
  log(r.ok ? 'INFO' : 'ERROR', 'dsh stop', { pid, parents, ok: r.ok })
  return { ok: r.ok, message: r.ok ? `已退出(PID ${pid}${parents.length ? ' + 控制台' : ''})` : `taskkill 失败:${r.stderr || r.stdout}` }
}

// ── 后台更新任务(core / plugins) ───────────────────────────────────────────
const updateJobs = { core: { running: false, log: '' }, plugins: { running: false, log: '' } }
function startUpdate(kind) {
  const job = updateJobs[kind]
  if (job.running) return { ok: false, message: '已有更新在进行' }
  job.running = true
  job.log = `===== ${kind} update ${new Date().toISOString()} =====\n`
  const script = kind === 'core'
    ? 'git pull --ff-only && corepack pnpm install && corepack pnpm run build'
    : 'corepack pnpm update'
  const cwd = kind === 'core' ? REPO : PROFILE
  log('INFO', `update ${kind} started`, { cwd, script })
  const child = spawn('cmd.exe', ['/c', script], { cwd, windowsHide: true })
  const append = c => { job.log += String(c); if (job.log.length > 400000) job.log = job.log.slice(-200000) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.on('close', code => {
    job.running = false
    job.log += `\n===== exit ${code} =====\n`
    log(code === 0 ? 'INFO' : 'ERROR', `update ${kind} finished`, { code })
  })
  return { ok: true, message: '更新已开始,查看日志页' }
}

// ── 皮肤 ────────────────────────────────────────────────────────────────────
const SKIN_DIRS = { launcher: path.join(ROOT, 'skins/launcher'), frontend: path.join(ROOT, 'skins/frontend') }
for (const d of Object.values(SKIN_DIRS)) fs.mkdirSync(d, { recursive: true })
const activeFile = target => path.join(SKIN_DIRS[target], 'active.txt')
const listSkins = target => fs.readdirSync(SKIN_DIRS[target]).filter(f => f.endsWith('.css')).map(f => f.replace(/\.css$/, ''))
const activeSkin = target => { try { return fs.readFileSync(activeFile(target), 'utf8').trim() } catch { return '' } }
function applySkin(target, name) {
  if (target === 'frontend' && (name === 'none' || name === '')) {
    fs.writeFileSync(activeFile(target), 'none')
    try { fs.writeFileSync(FRONTEND_SKIN_TARGET, '') } catch { /* 目录缺失时忽略 */ }
    log('INFO', 'frontend skin cleared')
    return { ok: true, message: '已恢复 dsh 原生外观(刷新页面生效)' }
  }
  const file = path.join(SKIN_DIRS[target], name + '.css')
  if (!exists(file)) return { ok: false, message: '皮肤不存在:' + name }
  fs.writeFileSync(activeFile(target), name)
  if (target === 'frontend') fs.copyFileSync(file, FRONTEND_SKIN_TARGET) // skin-loader 插件从 $DSH_HOME/frontend-skin.css 读取
  log('INFO', 'skin applied', { target, name })
  return { ok: true, message: `已切换 ${target} 皮肤:${name}${target === 'frontend' ? '(刷新 dsh 页面生效)' : ''}` }
}
// 内置皮肤不可删;删除当前启用的皮肤时自动回退
const BUILTIN_SKINS = { launcher: ['default', 'cyberpunk-2077'], frontend: ['cyberpunk-2077'] }
function deleteSkin(target, name) {
  const safe = String(name ?? '').replace(/[^\w一-龥-]/g, '')
  if (BUILTIN_SKINS[target].includes(safe)) return { ok: false, message: '内置皮肤不可删除:' + safe }
  const file = path.join(SKIN_DIRS[target], safe + '.css')
  if (!exists(file)) return { ok: false, message: '皮肤不存在:' + safe }
  fs.rmSync(file)
  if (activeSkin(target) === safe) applySkin(target, target === 'launcher' ? 'default' : 'none')
  log('INFO', 'skin deleted', { target, name: safe })
  return { ok: true, message: '已删除皮肤:' + safe }
}

/**
 * 社区皮肤包(client 插件形态)→ 纯 CSS 提取:
 * 在 node:vm 沙箱里执行 client.js,用 DOM stub 捕获 style.textContent 写入。
 * 皮肤包只做一件事(建 style 标签塞 CSS),因此捕获最长的一段即皮肤本体。
 */
function extractSkinCss(src) {
  const styles = []
  const rootVars = [] // style.setProperty 写入的 CSS 变量(常见于背景图 dataURI)
  const mkEl = () => {
    const el = { dataset: {}, setAttribute() {}, appendChild() {}, append() {}, remove() {}, classList: { add() {}, remove() {}, toggle() {} } }
    el.style = { setProperty(k, v) { if (typeof k === 'string' && typeof v === 'string' && v.length > 0) rootVars.push(k + ':' + v) }, removeProperty() {} }
    Object.defineProperty(el, 'textContent', { set(v) { if (typeof v === 'string' && v.length > 200) styles.push(v) }, get() { return '' } })
    return el
  }
  const doc = {
    createElement: () => mkEl(), createTextNode: () => ({}),
    head: { appendChild() {}, append() {} },
    body: mkEl(), documentElement: mkEl(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
  }
  const win = {
    document: doc, addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame() { return 0 }, setTimeout() { return 0 }, setInterval() { return 0 }, clearTimeout() {}, clearInterval() {},
    fetch: () => new Promise(() => {}), location: { href: 'http://127.0.0.1/' }, navigator: { userAgent: 'dsh-launcher' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { log() {}, warn() {}, error() {} },
    __ModuleLoader__: { load(mod) {
      try {
        const out = mod?.factory?.(() => new Proxy(function () {}, { get: () => () => {}, apply: () => ({}) })) ?? {}
        for (const k of ['apply', 'activate', 'mount', 'install', 'default']) {
          if (typeof out?.[k] === 'function') { try { out[k]() } catch { /* 尽力触发 */ } }
        }
      } catch { /* 提取尽力而为 */ }
    } },
  }
  win.window = win
  try { vm.runInNewContext(src, vm.createContext(win), { timeout: 5000 }) } catch { /* 语法差异不致命 */ }
  let css = styles.sort((a, b) => b.length - a.length)[0] ?? ''
  if (css.length > 0 && rootVars.length > 0) css += '\n:root{' + rootVars.join(';') + '}\n'
  return css
}

// skin manifest v2(skin.json contributes):纯 CSS 资产 + 背景媒体内联为 dataURI 单文件
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
    // skin-center 原版(lib/client.js setBodyBackground/BODY_BG_PROPS)把 image
    // 背景直接写到 document.body 的 background-image/size/position/attachment/
    // repeat 上:图画在 body 背景色(bg-base token)之上、半透明面板之下;负
    // z-index 装饰层只承载视频/WE 壁纸。明暗变体按 body[data-ds-dark-theme]
    // 属性选择(themeGet),不是 prefers-color-scheme —— 此处逐条照搬。
    const light = layer(bm.light ?? bm.dark)
    const dark = layer(bm.dark ?? bm.light)
    const bodyBg = v => `background-image:${v};background-size:cover;background-position:center;background-attachment:fixed;background-repeat:no-repeat`
    if (light) css += `\nbody:not([data-ds-dark-theme]){${bodyBg(light)}}`
    if (dark) css += `\nbody[data-ds-dark-theme]{${bodyBg(dark)}}`
  }
  return css
}

// npm 皮肤包 → 本地 CSS 皮肤文件(支持 manifest v2 资产目录、旧 client.js 插件形态、
// 聚合包 skins/ 子目录、纯 CSS 包;聚合壳包无皮肤时向 skin 类依赖递归一层)
async function installSkinFromNpm(pkg, depth = 0) {
  const meta = await (await fetch('https://registry.npmjs.org/' + pkg.replace('/', '%2F') + '/latest', { signal: AbortSignal.timeout(20000) })).json()
  const tarball = meta?.dist?.tarball
  if (!tarball) return { ok: false, message: 'npm 上找不到该包' }
  const tmp = path.join(os.tmpdir(), 'dsh-skin-' + Date.now())
  fs.mkdirSync(tmp, { recursive: true })
  const tgz = path.join(tmp, 'pkg.tgz')
  fs.writeFileSync(tgz, Buffer.from(await (await fetch(tarball, { signal: AbortSignal.timeout(60000) })).arrayBuffer()))
  const r = await run('tar', ['-xzf', tgz, '-C', tmp], { timeout: 60000 })
  if (!r.ok) return { ok: false, message: '解包失败:' + r.stderr.slice(0, 120) }
  const rootDir = path.join(tmp, 'package')
  const installed = []
  // 1) 聚合/单皮肤:含 skin.json + lib/client.js 的目录
  const candidates = [rootDir]
  const skinsDir = path.join(rootDir, 'skins')
  if (exists(skinsDir)) for (const d of fs.readdirSync(skinsDir)) candidates.push(path.join(skinsDir, d))
  for (const dir of candidates) {
    const sj = path.join(dir, 'skin.json')
    if (!exists(sj)) continue
    let info = {}
    try { info = JSON.parse(fs.readFileSync(sj, 'utf8')) } catch { /* 无元数据也可提取 */ }
    // manifest v2 纯资产目录优先;失败回退旧 client.js 插件形态的 vm 提取
    let css = info.contributes ? buildCssFromManifestV2(dir, info) : ''
    if (css.length < 200) {
      const cj = path.join(dir, 'lib/client.js')
      if (exists(cj)) {
        css = extractSkinCss(fs.readFileSync(cj, 'utf8'))
        if (info.bodyAttr) css = css.split('body[' + info.bodyAttr + ']').join('body').split('[' + info.bodyAttr + ']').join('body')
      }
    }
    if (css.length < 200) continue
    const id = String(info.id ?? path.basename(dir)).replace(/[^\w-]/g, '').slice(0, 40) || 'skin'
    const head = `/* ${info.name ?? id}${info.nameEn ? ' / ' + info.nameEn : ''} — 来源 npm:${pkg}(作者 ${info.author ?? '未知'})· 由 DSH 启动器转换为 CSS 皮肤 */\n`
    fs.writeFileSync(path.join(SKIN_DIRS.frontend, id + '.css'), head + css)
    installed.push(id)
  }
  // 2) 纯 CSS 包:根目录直接带 .css
  if (installed.length === 0) {
    for (const f of fs.readdirSync(rootDir)) {
      if (!f.endsWith('.css')) continue
      const id = f.replace(/\.css$/, '').replace(/[^\w-]/g, '').slice(0, 40)
      fs.copyFileSync(path.join(rootDir, f), path.join(SKIN_DIRS.frontend, id + '.css'))
      installed.push(id)
    }
  }
  // 3) 聚合壳包(如退役的 @linxin666/dsh-skins):向 skin 类依赖递归一层
  if (installed.length === 0 && depth < 2) {
    let deps = {}
    try { deps = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).dependencies ?? {} } catch { /* 无 package.json */ }
    for (const dep of Object.keys(deps)) {
      if (!/skin|theme/i.test(dep)) continue
      const r2 = await installSkinFromNpm(dep, depth + 1)
      if (r2.ok && Array.isArray(r2.installed)) installed.push(...r2.installed)
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录残留无害 */ }
  log('INFO', 'skin market install', { pkg, installed, depth })
  if (installed.length === 0) return { ok: false, message: '包内未发现可转换的皮肤(需 skin.json 资产目录或 .css)', installed }
  return { ok: true, installed, message: '已转换为本地 CSS 皮肤:' + installed.join('、') + '(在皮肤管理页切换/删除)' }
}

function importSkin(target, name, css) {
  const safe = String(name ?? '').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 40)
  if (safe.length === 0 || typeof css !== 'string' || css.length === 0 || css.length > 500000) return { ok: false, message: '名称或 CSS 内容非法' }
  fs.writeFileSync(path.join(SKIN_DIRS[target], safe + '.css'), css)
  log('INFO', 'skin imported', { target, name: safe, bytes: css.length })
  return { ok: true, message: `已导入皮肤:${safe}` }
}

// ── 打开文件夹(白名单) ────────────────────────────────────────────────────
const FOLDERS = {
  repo: { label: '本体仓库', labelKey: 'f_repo', path: REPO },
  dshHome: { label: 'DSH 主目录 (~/.dsh)', labelKey: 'f_home', path: DSH_HOME },
  sessions: { label: '会话日志', labelKey: 'f_sessions', path: path.join(DSH_HOME, 'sessions') },
  storages: { label: '插件数据 (storages)', labelKey: 'f_storages', path: path.join(DSH_HOME, 'storages') },
  profile: { label: 'web 配置 profile', labelKey: 'f_profile', path: PROFILE },
  plugins: { label: '本地插件 (dsh-plugins)', labelKey: 'f_plugins', path: PLUGINS_DIR },
  skillsUser: { label: '用户 Skills', labelKey: 'f_skills', path: path.join(DSH_HOME, 'skills') },
  launcher: { label: '启动器目录', labelKey: 'f_launcher', path: ROOT },
  nodeModules: { label: '本体依赖 node_modules', labelKey: 'f_nodemodules', path: path.join(REPO, 'node_modules') },
}

// ── API 路由 ────────────────────────────────────────────────────────────────
async function api(req, res, url) {
  const send = (code, data) => json(res, code, data)
  const p = url.pathname

  if (p === '/api/status') {
    const running = await checkPort(DSH_PORT)
    let version = ''
    try { version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version } catch { /* 无仓库时留空 */ }
    let defaultModel = ''
    try {
      // settings.yaml 的 agent-default-model 是两行缩进子键,逐行解析比多行正则稳
      const lines = fs.readFileSync(path.join(DSH_HOME, 'settings.yaml'), 'utf8').split(/\r?\n/)
      const i = lines.findIndex(l => l.startsWith('agent-default-model:'))
      if (i >= 0) {
        let prov = '', model = ''
        for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) {
          const kv = /^\s+(provider|model):\s*(\S+)/.exec(lines[j])
          if (kv) { if (kv[1] === 'provider') prov = kv[2]; else model = kv[2] }
        }
        if (prov || model) defaultModel = [prov, model].filter(Boolean).join(' / ')
      }
    } catch { /* 无 settings */ }
    return send(200, { dshRunning: running, dshUrl: `http://127.0.0.1:${DSH_PORT}`, defaultModel, repoVersion: version, node: process.version, updating: updateJobs.core.running || updateJobs.plugins.running })
  }
  if (p === '/api/dsh/start' && req.method === 'POST') return send(200, await startDsh())
  if (p === '/api/dsh/stop' && req.method === 'POST') return send(200, await stopDsh())

  if (p === '/api/plugins/builtin') {
    // 内置组合行:dsh --dump-config 输出的全部 row id(缓存 10 分钟)
    if (globalThis.__builtinCache === undefined || Date.now() - globalThis.__builtinCache.at > 600000) {
      const r = await run('cmd.exe', ['/c', 'corepack', 'pnpm', 'dsh', '--profile', 'web', '--dump-config'], { cwd: REPO, timeout: 120000 })
      const ids = [...r.stdout.matchAll(/^- id: (.+)$/gm)].map(m => m[1].trim())
      globalThis.__builtinCache = { at: Date.now(), ids, ok: r.ok }
      log('INFO', 'builtin rows scanned', { count: ids.length })
    }
    return send(200, { rows: globalThis.__builtinCache.ids, count: globalThis.__builtinCache.ids.length })
  }
  if (p === '/api/plugins') {
    let profile = {}
    try { profile = JSON.parse(fs.readFileSync(path.join(PROFILE, 'package.json'), 'utf8')) } catch { /* profile 未初始化 */ }
    const deps = profile.dependencies ?? {}
    const bundles = profile.dsh?.profile?.bundles ?? []
    const rows = Object.entries(deps).map(([name, spec]) => {
      let version = spec
      try { version = JSON.parse(fs.readFileSync(path.join(PROFILE, 'node_modules', name, 'package.json'), 'utf8')).version } catch { /* 未安装 */ }
      return { name, spec, version, isBundle: bundles.includes(name), local: String(spec).startsWith('link:') }
    })
    return send(200, { bundles, plugins: rows })
  }
  if (p === '/api/plugins/op' && req.method === 'POST') {
    const { op, spec } = await readBody(req)
    const safe = String(spec ?? '').trim()
    if (!['add', 'remove'].includes(op) || safe.length === 0 || /[&|;<>`"']/.test(safe)) return send(400, { ok: false, message: '非法参数' })
    log('INFO', 'plugin op', { op, spec: safe })
    const r = await run('cmd.exe', ['/c', 'corepack', 'pnpm', 'dsh', 'plugin', '--profile', 'web', op, safe], { cwd: REPO, timeout: 300000 })
    log(r.ok ? 'INFO' : 'ERROR', 'plugin op done', { op, ok: r.ok })
    return send(200, { ok: r.ok, message: (r.stdout + r.stderr).split('\n').slice(-6).join('\n') })
  }

  if (p === '/api/skills') {
    const sources = [
      { source: 'user-dsh ($DSH_HOME/skills)', dir: path.join(DSH_HOME, 'skills') },
      { source: 'repo (.agents/skills)', dir: path.join(REPO, '.agents/skills') },
    ]
    const skills = []
    for (const { source, dir } of sources) {
      if (!exists(dir)) continue
      for (const name of fs.readdirSync(dir)) {
        const md = path.join(dir, name, 'SKILL.md')
        let description = ''
        if (exists(md)) {
          const head = fs.readFileSync(md, 'utf8').slice(0, 2000)
          description = /description:\s*(.+)/.exec(head)?.[1]?.slice(0, 160) ?? ''
        }
        skills.push({ name, source, description })
      }
    }
    return send(200, { skills })
  }

  if (p === '/api/sessions') {
    const dir = path.join(DSH_HOME, 'sessions')
    const rows = []
    if (exists(dir)) {
      for (const f of fs.readdirSync(dir)) {
        try {
          const st = fs.statSync(path.join(dir, f))
          rows.push({ name: f, sizeKB: Math.round(st.size / 1024), mtime: st.mtime.toISOString().slice(0, 16).replace('T', ' ') })
        } catch { /* 忙碌文件跳过 */ }
      }
      rows.sort((a, b) => b.mtime.localeCompare(a.mtime))
    }
    return send(200, { dir, sessions: rows.slice(0, 200), total: rows.length })
  }

  if (p === '/api/storage') {
    const rows = Object.entries(FOLDERS).map(([key, f]) => ({ key, label: f.label, labelKey: f.labelKey, path: f.path, exists: exists(f.path), sizeMB: exists(f.path) ? Math.round(dirSize(f.path) / 1048576 * 10) / 10 : 0 }))
    return send(200, { folders: rows })
  }
  if (p === '/api/open' && req.method === 'POST') {
    const { key } = await readBody(req)
    const f = FOLDERS[key]
    if (f === undefined) return send(400, { ok: false, message: '未知目录' })
    fs.mkdirSync(f.path, { recursive: true })
    spawn('explorer.exe', [f.path.replaceAll('/', '\\')], { detached: true, windowsHide: false }).unref()
    log('INFO', 'folder opened', { key })
    return send(200, { ok: true, message: '已打开:' + f.label })
  }

  if (p === '/api/update/core' && req.method === 'POST') return send(200, startUpdate('core'))
  if (p === '/api/update/plugins' && req.method === 'POST') return send(200, startUpdate('plugins'))
  if (p === '/api/update/status') return send(200, { core: updateJobs.core, plugins: updateJobs.plugins })

  if (p === '/api/tokens') {
    // CC 风格用量统计:range=all|30|7,输出 8 项概览 + 26 周热力 + 按模型表。
    const range = url.searchParams.get('range') ?? 'all'
    let ledger = null
    try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { /* 尚无账本 */ }
    const allDays = (ledger?.days ? Object.values(ledger.days) : []).filter(d => typeof d?.date === 'string')
    const dayKey = ms => { const d = new Date(ms); const pad = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
    const today = dayKey(Date.now())
    const cutoff = range === '30' ? dayKey(Date.now() - 29 * 86400000) : range === '7' ? dayKey(Date.now() - 6 * 86400000) : ''
    const days = allDays.filter(d => d.date >= cutoff)
    const tok = d => (d.input ?? 0) + (d.output ?? 0) + (d.cacheRead ?? 0) + (d.cacheWrite ?? 0) + (d.reasoning ?? 0)

    const totalTokens = days.reduce((s, d) => s + tok(d), 0)
    const messages = days.reduce((s, d) => s + (d.calls ?? 0), 0)
    const totalCost = Math.round(days.reduce((s, d) => s + (d.cost ?? 0), 0) * 100) / 100
    const sessionIds = new Set()
    for (const d of days) for (const s of (d.sessions ?? [])) sessionIds.add(s.id ?? JSON.stringify(s).slice(0, 40))
    const activeSet = new Set(days.filter(d => tok(d) > 0).map(d => d.date))
    // streak:活跃日連続(current 自今天回溯,今天无量则自昨天;longest 全区间)
    let currentStreak = 0
    for (let i = 0, miss = 0; i < 3660 && miss < 2; i++) {
      const k = dayKey(Date.now() - i * 86400000)
      if (activeSet.has(k)) { currentStreak++; miss = 0 } else if (i === 0) { miss = 1 } else break
    }
    let longestStreak = 0
    { const sorted = [...activeSet].sort(); let run = 0; let prev = ''
      for (const k of sorted) { run = (prev !== '' && new Date(k) - new Date(prev) === 86400000) ? run + 1 : 1; prev = k; if (run > longestStreak) longestStreak = run } }
    const busiest = days.reduce((best, d) => tok(d) > tok(best ?? { input: -1 }) ? d : best, null)
    const byModel = {}
    for (const d of days) for (const [pm, v] of Object.entries(d.byProviderModel ?? {})) {
      const cur = byModel[pm] ?? { calls: 0, miss: 0, hit: 0, output: 0, tokens: 0, cost: 0 }
      const t = (v.input ?? 0) + (v.output ?? 0) + (v.cacheRead ?? 0) + (v.cacheWrite ?? 0) + (v.reasoning ?? 0)
      cur.calls += v.calls ?? 0; cur.miss += v.input ?? 0; cur.hit += (v.cacheRead ?? 0) + (v.cacheWrite ?? 0); cur.output += v.output ?? 0; cur.tokens += t; cur.cost += v.cost ?? 0
      byModel[pm] = cur
    }
    const models = Object.entries(byModel).map(([model, v]) => ({ model, ...v, cost: Math.round(v.cost * 10000) / 10000 })).sort((a, b) => b.tokens - a.tokens)
    // 热力图:26 周 × 7(周一起始),含今日;level 按当期最大值分 4 档
    const byDate = new Map(allDays.map(d => [d.date, tok(d)]))
    const start = new Date(Date.now() - (26 * 7 - 1) * 86400000)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // 回退到周一
    const heatmap = []
    let maxTok = 0
    for (let t = start.getTime(); dayKey(t) <= today; t += 86400000) maxTok = Math.max(maxTok, byDate.get(dayKey(t)) ?? 0)
    for (let t = start.getTime(); dayKey(t) <= today; t += 86400000) {
      const k = dayKey(t); const v = byDate.get(k) ?? 0
      heatmap.push({ date: k, tokens: v, level: v === 0 ? 0 : Math.min(4, 1 + Math.floor(v / Math.max(1, maxTok) * 3.999)) })
    }
    // 趣味对照:Moby-Dick ≈ 209K words × ~1.36 ≈ 285K tokens(与 Claude Code usage 页同口径)
    const moby = totalTokens / 285000
    const mobyRatio = Math.round(moby * 100) / 100
    const funFact = '' // 文案由前端按界面语言渲染(mobyRatio)
    const daily = days.map(d => ({ date: d.date, calls: d.calls ?? 0, miss: d.input ?? 0, hit: (d.cacheRead ?? 0) + (d.cacheWrite ?? 0), output: d.output ?? 0, cost: Math.round((d.cost ?? 0) * 10000) / 10000 })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60)
    return send(200, {
      overview: {
        sessions: sessionIds.size, messages, totalTokens, totalCost,
        activeDays: activeSet.size, currentStreak, longestStreak,
        busiestDay: busiest?.date ?? '—',
        favoriteModel: models[0]?.model?.split('/').pop() ?? '—',
      },
      heatmap, funFact, mobyRatio, models, daily,
    })
  }

  if (p === '/api/skins' ) {
    return send(200, {
      launcher: { list: listSkins('launcher'), active: activeSkin('launcher') },
      frontend: { list: listSkins('frontend'), active: activeSkin('frontend') },
    })
  }
  if (p === '/api/skins/apply' && req.method === 'POST') {
    const { target, name } = await readBody(req)
    if (!(target in SKIN_DIRS)) return send(400, { ok: false, message: '非法 target' })
    return send(200, applySkin(target, String(name ?? '')))
  }
  if (p === '/api/skins/import' && req.method === 'POST') {
    const { target, name, css } = await readBody(req)
    if (!(target in SKIN_DIRS)) return send(400, { ok: false, message: '非法 target' })
    return send(200, importSkin(target, name, css))
  }
  if (p === '/api/skins/delete' && req.method === 'POST') {
    const { target, name } = await readBody(req)
    if (!(target in SKIN_DIRS)) return send(400, { ok: false, message: '非法 target' })
    return send(200, deleteSkin(target, name))
  }

  // 素材接收端点:即梦页面把生成图 POST 进来落盘(绕开浏览器下载拦截)。
  // 仅接受图片字节,限 30MB,文件名白名单化;CORS 仅放行即梦源。
  if (p === '/api/dev/save-asset' && (req.method === 'POST' || req.method === 'OPTIONS')) {
    res.setHeader('access-control-allow-origin', 'https://jimeng.jianying.com')
    res.setHeader('access-control-allow-headers', 'content-type,x-asset-name')
    res.setHeader('access-control-allow-private-network', 'true')
    res.setHeader('access-control-allow-methods', 'POST,OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    const name = String(req.headers['x-asset-name'] ?? 'asset').replace(/[^\w-]/g, '').slice(0, 40) || 'asset'
    const chunks = []
    let total = 0
    req.on('data', c => { total += c.length; if (total <= 30 * 1048576) chunks.push(c) })
    req.on('end', () => {
      if (total > 30 * 1048576) return json(res, 413, { ok: false, message: 'too large' })
      const buf = Buffer.concat(chunks)
      const magic = buf.subarray(0, 4).toString('hex')
      const ext = magic.startsWith('89504e47') ? '.png' : magic.startsWith('ffd8') ? '.jpg' : magic.startsWith('52494646') ? '.webp' : null
      if (ext === null) return json(res, 400, { ok: false, message: 'not an image' })
      const fp = path.join(ROOT, 'public/assets', 'gen-' + name + ext)
      fs.writeFileSync(fp, buf)
      log('INFO', 'asset received', { name, bytes: total, file: fp })
      json(res, 200, { ok: true, saved: 'gen-' + name + ext, bytes: total })
    })
    return
  }

  if (p === '/api/workspace/create' && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const r = await fetch('http://127.0.0.1:' + DSH_PORT + '/dsh-quick-workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
      const j = await r.json()
      log('INFO', 'workspace create', { path: body.path, ok: j.ok })
      return send(200, j)
    } catch (error) { return send(200, { ok: false, message: 'dsh 未运行或未安装 dsh-quick-workspace 插件:' + String(error).slice(0, 80) }) }
  }

  if (p === '/api/deck') {
    const deckFile = path.join(DSH_HOME, 'control-deck.json')
    if (req.method === 'POST') {
      const body = await readBody(req)
      fs.writeFileSync(deckFile, JSON.stringify(body, null, 2))
      log('INFO', 'control deck saved', { prompts: (body.prompts ?? []).length, regex: (body.regex ?? []).length, lore: (body.lorebook ?? []).length })
      return send(200, { ok: true, message: '已保存,dsh 侧 1.5 秒内热载生效' })
    }
    let deck = {}
    try { deck = JSON.parse(fs.readFileSync(deckFile, 'utf8')) } catch { /* 默认空 */ }
    return send(200, { deck })
  }

  // 市场:npm(插件/皮肤)+ GitHub(skill)搜索与一键安装
  if (p === '/api/market/search') {
    const type = url.searchParams.get('type') ?? 'plugin'
    const q = String(url.searchParams.get('q') ?? '').slice(0, 60)
    try {
      if (type === 'skill') {
        const gh = await fetch('https://api.github.com/search/repositories?per_page=12&q=' + encodeURIComponent((q ? q + ' ' : '') + 'dsh skill in:name,description,topics'), { headers: { 'user-agent': 'dsh-launcher', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
        const data = await gh.json()
        const items = (data.items ?? []).map(r => ({ name: r.full_name, version: r.default_branch, description: (r.description ?? '').slice(0, 120), stars: r.stargazers_count, kind: 'skill', url: r.html_url }))
        log('INFO', 'market search', { type, q, hits: items.length })
        return send(200, { items })
      }
      const text = type === 'skin' ? ('dsh ' + (q || 'skin theme')) : ('dsh ' + q)
      const r = await fetch('https://registry.npmjs.org/-/v1/search?size=20&text=' + encodeURIComponent(text), { signal: AbortSignal.timeout(15000) })
      const data = await r.json()
      // npm 全文搜索会混入无关包(如 emoji 库 skin-tone):真正的 dsh 包在
      // name/description/keywords 里总带 dsh 或 deepseek,搜索结果不含自定义
      // dsh: 字段,故以此启发式过滤(安装时还会再验证包结构)。
      const isDshPkg = pk => /dsh|deepseek/i.test(pk.name + ' ' + (pk.description ?? '') + ' ' + (pk.keywords ?? []).join(' '))
      const isSkinPkg = pk => /skin|theme|皮肤|换肤/i.test(pk.name + ' ' + (pk.description ?? '') + ' ' + (pk.keywords ?? []).join(' '))
      const items = (data.objects ?? []).filter(o => isDshPkg(o.package) && (type !== 'skin' || isSkinPkg(o.package))).slice(0, 14).map(o => ({ name: o.package.name, version: o.package.version, description: (o.package.description ?? '').slice(0, 120), kind: type, url: o.package.links?.repository ?? o.package.links?.npm ?? '' }))
      log('INFO', 'market search', { type, q, hits: items.length })
      return send(200, { items })
    } catch (error) { return send(200, { items: [], message: String(error).slice(0, 120) }) }
  }
  if (p === '/api/market/install' && req.method === 'POST') {
    const { type, name: pkg } = await readBody(req)
    const safe = String(pkg ?? '').trim()
    if (safe.length === 0 || /[&|;<>`"' ]/.test(safe)) return send(400, { ok: false, message: '非法包名' })
    log('INFO', 'market install', { type, pkg: safe })
    if (type === 'skill') {
      // GitHub 仓库 → zip 解压到 $DSH_HOME/skills/<repo>
      if (!/^[\w.-]+\/[\w.-]+$/.test(safe)) return send(400, { ok: false, message: '需要 owner/repo 形式' })
      const dest = path.join(DSH_HOME, 'skills')
      fs.mkdirSync(dest, { recursive: true })
      const zipPath = path.join(LOG_DIR, 'skill-tmp.zip')
      try {
        const resp = await fetch('https://codeload.github.com/' + safe + '/zip/refs/heads/HEAD', { signal: AbortSignal.timeout(60000) })
        if (!resp.ok) return send(200, { ok: false, message: 'GitHub 下载失败 HTTP ' + resp.status })
        fs.writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()))
        const r = await run('powershell', ['-NoProfile', '-Command', 'Expand-Archive -Force -LiteralPath "' + zipPath + '" -DestinationPath "' + dest + '"'], { timeout: 60000 })
        log(r.ok ? 'INFO' : 'ERROR', 'skill install done', { repo: safe, ok: r.ok })
        return send(200, { ok: r.ok, message: r.ok ? '已解压到 ~/.dsh/skills/' : '解压失败:' + r.stderr.slice(0, 120) })
      } catch (error) { return send(200, { ok: false, message: String(error).slice(0, 120) }) }
    }
    if (type === 'skin') {
      // 皮肤绝不进插件系统:npm 包就地转换为本地 CSS 皮肤文件,由皮肤管理页统一切换/删除
      try { return send(200, await installSkinFromNpm(safe)) } catch (error) { return send(200, { ok: false, message: String(error).slice(0, 150) }) }
    }
    const r = await run('cmd.exe', ['/c', 'corepack', 'pnpm', 'dsh', 'plugin', '--profile', 'web', 'add', safe], { cwd: REPO, timeout: 300000 })
    log(r.ok ? 'INFO' : 'ERROR', 'market install done', { pkg: safe, ok: r.ok })
    return send(200, { ok: r.ok, message: (r.stdout + r.stderr).split('\n').filter(l => l.trim()).slice(-4).join('\n') })
  }

  if (p === '/api/logs') {
    const file = url.searchParams.get('file')
    const map = {
      launcher: path.join(LOG_DIR, `launcher-${new Date().toISOString().slice(0, 10)}.log`),
      dsh: path.join(ROOT, 'dsh.log'),
    }
    if (file === 'update-core') return send(200, { text: updateJobs.core.log || '(空)' })
    if (file === 'update-plugins') return send(200, { text: updateJobs.plugins.log || '(空)' })
    const fp = map[file]
    if (fp === undefined) return send(400, { text: '未知日志' })
    let text = '(空)'
    try { const raw = fs.readFileSync(fp, 'utf8'); text = raw.slice(-30000) } catch { /* 尚无日志 */ }
    return send(200, { text })
  }

  send(404, { ok: false, message: 'not found' })
}

// ── 静态与皮肤文件 ──────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }
function serveStatic(res, file) {
  try {
    const data = fs.readFileSync(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(data)
  } catch { res.writeHead(404); res.end('not found') }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  try {
    if (url.pathname.startsWith('/api/')) { await api(req, res, url); return }
    if (url.pathname === '/skins/launcher/active.css') {
      const name = activeSkin('launcher')
      const file = path.join(SKIN_DIRS.launcher, (name || 'default') + '.css')
      return serveStatic(res, exists(file) ? file : path.join(SKIN_DIRS.launcher, 'default.css'))
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const fp = path.join(ROOT, 'public', path.normalize(file))
    if (!fp.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); res.end(); return }
    serveStatic(res, fp)
  } catch (error) {
    log('ERROR', 'request failed', { url: req.url, error: String(error) })
    json(res, 500, { ok: false, message: String(error) })
  }
})

server.listen(PORT, '127.0.0.1', () => log('INFO', `DSH Launcher listening on http://127.0.0.1:${PORT}`))
