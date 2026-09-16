/**
 * DSH Launcher backend — the zero-dependency Node server (node:http) behind the
 * DSH CyberWorkStation workbench: dsh process control, plugin / skill / session /
 * storage views, core and plugin updates, token analytics, launcher + frontend
 * skin management, Control Deck persistence and the npm / GitHub markets.
 * Every action is appended to the internal log under `.local/logs/`.
 *
 * Start: `node launcher/server.mjs`  →  http://127.0.0.1:3090
 *
 * User-visible messages are returned in the UI language the client announces
 * through the `x-lang` request header (`zh` default, `en`).
 */
import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensurePeerLinks } from './peer-links.mjs'
import { serverPorts } from './runtime-config.mjs'
import { normalizeDshHome } from './home-paths.mjs'
import { assertPluginRemovable, readProfilePatchStatus } from './profile-patches.mjs'
import { isDshWebProcess, sameProcess } from './process-identity.mjs'
import { mergeWebSearchPatch } from './websearch-patch.mjs'
import { parseBootLog } from './boot-probe.mjs'
import { json, readBody, exists, pick, checkPort, run, readJson, writeJson, dirSize } from './lib/util.mjs'
import { createDshCli } from './lib/dsh-cli.mjs'
import { createSkins } from './lib/skins.mjs'
import { createBackup } from './lib/backup.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const SUITE = path.join(ROOT, '..')
// Core checkout: env override > bundled core/ > sibling deepseek-harness/ > bundled core/ (even if absent).
const REPO = process.env.DSH_REPO
  ?? [path.join(SUITE, 'core'), path.join(SUITE, 'deepseek-harness')].find(p => fs.existsSync(path.join(p, 'package.json')))
  ?? path.join(SUITE, 'core')
const DSH_HOME = normalizeDshHome()
const PLUGINS_DIR = process.env.DSH_SUITE_PLUGINS ?? path.join(SUITE, 'plugins')
const PROFILE = path.join(DSH_HOME, 'profiles/web')
const LEDGER = process.env.DSH_LAUNCHER_LEDGER ?? path.join(DSH_HOME, 'storages/cost-meter/ledger.json')
const FRONTEND_SKIN_TARGET = path.join(DSH_HOME, 'frontend-skin.css')
const { launcher: PORT, dsh: DSH_PORT } = serverPorts()
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`
// Built CLI entry: launching it under plain Node boots dsh in ~5 s with the full plugin set; the
// source launch through corepack + pnpm + tsx takes ~20 s on the same machine.
const BUILT_CLI = path.join(REPO, 'apps/cli/lib/bin.js')

// ── Internal log (.local/logs, git-ignored) ─────────────────────────────────
const LOCAL_DIR = path.join(SUITE, '.local')
const LOG_DIR = path.join(LOCAL_DIR, 'logs')
const DSH_LOG = path.join(LOG_DIR, 'dsh.log')

// Since core 0.1.2 the web index and /api/* are gated behind a per-process launch token; the core prints the
// authenticated URL on its `dsh web:` stdout line (plugin routes under /dsh-* stay open, so the launcher's own
// proxied calls keep using the bare DSH_URL). The launcher reads that line back from the dsh log: dshWebUrl is
// what a browser must open. Cleared on every start and stop; recovered from the log tail when the launcher
// itself restarted while dsh kept running.
let dshWebUrl = null
const DSH_LOG_TAIL_BYTES = 512 * 1024
function readDshLogFrom(fromOffset) {
  try {
    const size = fs.statSync(DSH_LOG).size
    const start = Math.max(fromOffset ?? 0, size - DSH_LOG_TAIL_BYTES)
    if (size <= start) return ''
    const fd = fs.openSync(DSH_LOG, 'r')
    try {
      const buf = Buffer.alloc(size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      return buf.toString('utf8')
    } finally { fs.closeSync(fd) }
  } catch { return '' }
}
/**
 * What the dsh log says about a boot: the authenticated web URL once printed, the pid the launcher wrote beside its
 * start marker, and a fatal load failure (the plugin tree, host preparation, or the CLI's own fatal line).
 */
function probeDshBoot(fromOffset) {
  return parseBootLog(readDshLogFrom(fromOffset))
}
// netstat is not free: the recovery path asks for the listening pids at most every 10 s.
let pidsProbe = { at: 0, pids: [] }
async function listeningDshPids() {
  if (Date.now() - pidsProbe.at < 10000) return pidsProbe.pids
  let pids = []
  try { pids = await dshPids() } catch { pids = [] }
  pidsProbe = { at: Date.now(), pids }
  return pids
}
// The log tail is re-read only when the file changed; the dashboard polls /api/status every 3 s.
let tailProbe = { stamp: '', boot: { url: null, pid: null, failed: false } }
function probeDshLogTail() {
  let stamp = ''
  try { const st = fs.statSync(DSH_LOG); stamp = st.size + ':' + st.mtimeMs } catch { return { url: null, pid: null, failed: false } }
  if (stamp !== tailProbe.stamp) tailProbe = { stamp, boot: probeDshBoot() }
  return tailProbe.boot
}
/**
 * The URL a browser should open. The token of a process this launcher started is remembered; otherwise the log
 * tail is trusted only when the pid written beside the last start marker is one of the processes listening now
 * (a launcher restarted under a dsh it started earlier). A dsh started elsewhere gets the bare origin — its token
 * is in its own output, never in this log.
 */
async function dshBrowserUrl(running) {
  if (!running) return DSH_URL
  if (dshWebUrl !== null) return dshWebUrl
  const boot = probeDshLogTail()
  if (boot.url === null || boot.pid === null) return DSH_URL
  return (await listeningDshPids()).includes(boot.pid) ? boot.url : DSH_URL
}
fs.mkdirSync(LOG_DIR, { recursive: true })
const todayLog = () => path.join(LOG_DIR, `launcher-${new Date().toISOString().slice(0, 10)}.log`)
function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}\n`
  try { fs.appendFileSync(todayLog(), line) } catch { /* logging must never break a request */ }
  if (level === 'ERROR') console.error(line.trim()); else console.log(line.trim())
}

// ── Helpers ─────────────────────────────────────────────────────────────────
// json / readBody / exists / pick / checkPort / run / readJson / writeJson / dirSize live in ./lib/util.mjs;
// the dsh CLI invocation and process inspection in ./lib/dsh-cli.mjs.
const { dshCommand, resolveDshCommand, runDsh, dshPids, processTable } = createDshCli({ repo: REPO, builtCli: BUILT_CLI, dshPort: DSH_PORT })

// ── dsh process management ──────────────────────────────────────────────────
let dshState = null
let dshActionBusy = false
async function withDshAction(lang, action) {
  if (dshActionBusy) return { ok: false, message: pick(lang, 'dsh 启动/停止正在处理中，请稍候', 'A dsh start/stop operation is in progress; please wait') }
  dshActionBusy = true
  try { return await action() } catch (error) {
    log('ERROR', 'dsh process operation failed', { error: String(error.message ?? error) })
    return { ok: false, message: String(error.message ?? error) }
  } finally { dshActionBusy = false }
}
async function startDsh(lang) {
  return withDshAction(lang, async () => {
  if (await checkPort(DSH_PORT)) return { ok: false, message: pick(lang, `dsh 已在运行(端口 ${DSH_PORT})`, `dsh is already running (port ${DSH_PORT})`) }
  if (dshState?.pending) return { ok: false, message: pick(lang, '先前启动的进程仍在准备；请等待或先停止它', 'The previous process is still starting; wait or stop it before retrying') }
  const links = ensurePeerLinks({ repo: REPO, pluginsDir: PLUGINS_DIR })
  if (links.linked.length > 0 || links.failed.length > 0 || links.missing.length > 0) log(links.failed.length > 0 || links.missing.length > 0 ? 'ERROR' : 'INFO', 'plugin peer links', links)
  dshWebUrl = null
  const logOffset = (() => { try { return fs.statSync(DSH_LOG).size } catch { return 0 } })()
  const out = fs.openSync(DSH_LOG, 'a')
  const c = dshCommand(['web', '--no-open', '--port', String(DSH_PORT)])
  let state
  try {
    fs.writeSync(out, `\n===== launcher start ${new Date().toISOString()} =====\n`)
    const child = spawn(c.cmd, c.args, { cwd: REPO, windowsHide: true, stdio: ['ignore', out, out], detached: true })
    state = { child, mode: c.mode, pending: true, error: null, identity: null }
    dshState = state
    const clear = () => { state.pending = false; pidsProbe = { at: 0, pids: [] }; if (dshState === state) { dshState = null; dshWebUrl = null } }
    child.on('error', error => { state.error = error; clear() })
    child.on('exit', clear)
    child.unref()
    // the pid beside the marker lets a restarted launcher tell this process's token line from an older one
    if (typeof child.pid === 'number') fs.writeSync(out, `[launcher] dsh pid ${child.pid}\n`)
  } finally { fs.closeSync(out) }
  log('INFO', 'dsh start requested', { spawnPid: state.child.pid, mode: c.mode })
  state.identity = (await processTable()).get(state.child.pid) ?? null
  const started = Date.now()
  const failedStart = () => {
    log('ERROR', 'dsh failed to load', { mode: c.mode })
    return { ok: false, message: pick(lang, '启动失败：本体加载失败（插件树 / 宿主准备），请查看 dsh 输出日志', 'Failed to start: the core did not load (plugin tree / host preparation) — check the dsh output log') }
  }
  for (let i = 0; i < 120; i++) {
    if (state.error) return { ok: false, message: pick(lang, '启动失败：', 'Failed to start: ') + state.error.message }
    const boot = probeDshBoot(logOffset)
    if (boot.failed) return failedStart()
    // Ready only when the core printed its authenticated `dsh web:` line: it does so after every plugin mounted,
    // and an open port alone is too early (a broken plugin can still take the process down right after).
    if (boot.url !== null) {
      state.pending = false
      dshWebUrl = boot.url
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      log('INFO', 'dsh is up', { seconds: secs, mode: c.mode, tokenUrl: true })
      return { ok: true, url: boot.url, message: pick(lang, `dsh 已启动(${secs}s):${boot.url}`, `dsh is up (${secs}s): ${boot.url}`) }
    }
    if (state.child.exitCode !== null || state.child.signalCode) break
    await new Promise(r => setTimeout(r, 500))
  }
  if (probeDshBoot(logOffset).failed) return failedStart()
  const exited = state.child.exitCode !== null || state.child.signalCode
  log('ERROR', 'dsh did not become ready', { exitCode: state.child.exitCode, signal: state.child.signalCode, mode: c.mode, port: DSH_PORT, seconds: ((Date.now() - started) / 1000).toFixed(1) })
  return exited
    ? { ok: false, message: pick(lang, `dsh 进程已退出（exit ${state.child.exitCode ?? state.child.signalCode}），请查看 dsh 输出日志`, `the dsh process exited (exit ${state.child.exitCode ?? state.child.signalCode}) — check the dsh output log`) }
    : { ok: false, message: pick(lang, `60 秒内未打印就绪行（dsh web:），请查看 dsh 输出日志`, `dsh printed no ready line (dsh web:) within 60 s — check the dsh output log`) }
  })
}
async function stopDsh(lang) {
  return withDshAction(lang, async () => {
  pidsProbe = { at: 0, pids: [] } // whatever listens after this is not the process the last marker named
  const pids = await dshPids()
  const table = await processTable()
  const state = dshState
  const owned = state && state.child.exitCode === null && !state.child.signalCode
    && sameProcess(state.identity, table.get(state.child.pid)) ? state.child.pid : null
  const identity = { repo: REPO, ownedSourcePid: state?.mode === 'source' ? owned : null }
  const refused = () => ({ ok: false, message: pick(lang,
    '无法确认端口进程属于此 dsh，未结束任何进程。手动以相对路径启动的源码进程在启动器重启后无法确认，请在其原终端停止。',
    'Cannot verify this port belongs to this dsh; no process was stopped. A manually launched relative source path cannot be verified after launcher restart; stop it in its original terminal.') })
  if (pids.length === 0) {
    if (!state?.pending) return { ok: false, message: pick(lang, 'dsh 未在运行', 'dsh is not running') }
    if (!owned) return refused()
    pids.push(owned)
  } else if (pids.some(pid => pid === process.pid || !isDshWebProcess(pid, table, identity))) return refused()
  const fresh = await processTable()
  if (pids.some(pid => !sameProcess(table.get(pid), fresh.get(pid)))) return refused()
  const results = []
  for (const pid of pids) {
    results.push(await run('taskkill', ['/PID', String(pid), '/T', '/F']))
  }
  const ok = results.every(result => result.ok)
  if (ok && state === dshState) dshState = null
  log(ok ? 'INFO' : 'ERROR', 'dsh stop', { pids, ok })
  return {
    ok,
    message: ok
      ? pick(lang, `已退出(PID ${pids.join(', ')})`, `Stopped (PID ${pids.join(', ')})`)
      : pick(lang, '结束进程失败，请查看日志', 'Failed to stop the process; check the logs'),
  }
  })
}

// ── Background update jobs (core / plugins) ─────────────────────────────────
const updateJobs = { core: { running: false, log: '' }, plugins: { running: false, log: '' } }
function startUpdate(kind, lang, opts = {}) {
  const jobKey = kind === 'plugins' ? 'plugins' : 'core'
  const job = updateJobs[jobKey]
  if (job.running) return { ok: false, message: pick(lang, '已有更新在进行', 'An update is already running') }
  job.running = true
  job.log = `===== ${kind}${opts.tag ? ' ' + opts.tag : ''} update ${new Date().toISOString()} =====\n`
  // The core is vendored inside the suite repository, so `git pull` runs where
  // the .git lives (the suite root, or the core itself when DSH_REPO points at a
  // standalone checkout); install + build always run inside the core. Each step
  // is spawned with an argument array (no shell string), so paths with spaces
  // and quotes need no escaping. `core-tag` vendors an exact upstream release
  // tag first (launcher/vendor-core.mjs) instead of pulling the suite repo.
  const gitRoot = exists(path.join(REPO, '.git')) ? REPO : SUITE
  const build = [
    { cmd: 'cmd.exe', args: ['/c', 'corepack', 'pnpm', 'install'], cwd: REPO },
    { cmd: 'cmd.exe', args: ['/c', 'corepack', 'pnpm', 'build:lib'], cwd: REPO },
    { cmd: 'cmd.exe', args: ['/c', 'corepack', 'pnpm', 'build:web'], cwd: REPO },
  ]
  const steps = kind === 'core'
    ? [{ cmd: 'git', args: ['-C', gitRoot, 'pull', '--ff-only'], cwd: gitRoot }, ...build]
    : kind === 'core-tag'
      ? [{ cmd: process.execPath, args: [path.join(ROOT, 'vendor-core.mjs'), String(opts.tag)], cwd: ROOT, env: { ...process.env, DSH_REPO: REPO } }, ...build]
      : [{ resolve: () => resolveDshCommand(['plugin', '--profile', 'web', 'update']), label: 'dsh plugin --profile web update', cwd: REPO }]
  log('INFO', `update ${kind} started`, { steps: steps.map(s => s.label ?? [s.cmd, ...s.args].join(' ')) })
  const append = c => { job.log += String(c); if (job.log.length > 400000) job.log = job.log.slice(-200000) }
  // Watchdog: a hung step (a prompt waiting for input, a stuck download) is
  // killed after 30 minutes so the job can never stay "running" forever.
  const STEP_TIMEOUT_MS = 30 * 60 * 1000
  const runStep = async step => {
    const command = step.resolve ? await step.resolve() : step
    return new Promise(resolve => {
    append(`\n$ ${[command.cmd, ...command.args].join(' ')}\n`)
    const child = spawn(command.cmd, command.args, { cwd: step.cwd, windowsHide: true, ...(step.env ? { env: step.env } : {}) })
    const timer = setTimeout(() => { append(`\n[launcher] step timed out after ${STEP_TIMEOUT_MS / 60000} min — killed\n`); run('taskkill', ['/PID', String(child.pid), '/T', '/F']) }, STEP_TIMEOUT_MS)
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', error => { clearTimeout(timer); append(String(error) + '\n'); resolve(1) })
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 1) })
    })
  }
  ;(async () => {
    let code = 0
    for (const step of steps) { code = await runStep(step); if (code !== 0) break }
    job.running = false
    job.log += `\n===== exit ${code} =====\n`
    log(code === 0 ? 'INFO' : 'ERROR', `update ${kind} finished`, { code })
    builtinCache = null
    upstreamCache = null
    const links = ensurePeerLinks({ repo: REPO, pluginsDir: PLUGINS_DIR })
    log('INFO', 'plugin peer links refreshed', links)
  })().catch(error => log('ERROR', 'update tail failed', { error: String(error?.message ?? error).slice(0, 300) }))
  return { ok: true, message: pick(lang, '更新已开始,查看日志页', 'Update started — see the Logs page') }
}

// ── Skins (./lib/skins.mjs) ───────────────────────────────────────────────────
const skins = createSkins({ root: ROOT, frontendSkinTarget: FRONTEND_SKIN_TARGET, log })
const { SKIN_DIRS, listSkins, activeSkin, applySkin, deleteSkin, installSkinFromNpm, importSkin } = skins
skins.syncActiveFrontendSkin()

// ── Control Deck presets / web search / safety rules / local models ─────────
const DECK_FILE = path.join(DSH_HOME, 'control-deck.json')
const PRESET_DIR = path.join(DSH_HOME, 'control-deck-presets')
const WEBSEARCH_FILE = path.join(DSH_HOME, 'web-search.json')
const SAFEGUARD_FILE = path.join(DSH_HOME, 'safe-guard.json')
// backup whitelist, bundle and restore: ./lib/backup.mjs
const { collectBackup, restoreBackup } = createBackup({ dshHome: DSH_HOME })

const safePresetName = s => { const n = String(s ?? '').replace(/[^\w一-龥 .-]/g, '').trim().replace(/\.+$/, '').slice(0, 40); return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(n) ? '' : n }
const listPresets = () => { try { return fs.readdirSync(PRESET_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')) } catch { return [] } }
/** Lazily import the Control Deck's pure modules (SillyTavern conversions, config normaliser) from the suite plugins. */
let deckModules = null
async function loadDeckModules() {
  if (deckModules) return deckModules
  const { pathToFileURL } = await import('node:url')
  const st = await import(pathToFileURL(path.join(PLUGINS_DIR, 'dsh-control-deck', 'lib', 'st-format.js')).href)
  const deck = await import(pathToFileURL(path.join(PLUGINS_DIR, 'dsh-control-deck', 'lib', 'deck.js')).href)
  const ws = await import(pathToFileURL(path.join(PLUGINS_DIR, 'dsh-web-search-plus', 'lib', 'inject.js')).href)
  deckModules = { st, deck, ws }
  return deckModules
}
/** Call a dsh plugin route (the launcher never talks to providers itself). */
async function dshJson(pathname, init = {}) {
  try {
    const r = await fetch(DSH_URL + pathname, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(init.timeoutMs ?? 20000) })
    const data = await r.json().catch(() => ({}))
    return { ok: r.ok && data?.ok !== false, status: r.status, ...data }
  } catch (error) {
    return { ok: false, offline: true, message: String(error?.message ?? error).slice(0, 120) }
  }
}
/** Latest upstream release (GitHub releases/latest, npm dist-tags as fallback), cached 10 min. */
let upstreamCache = null
async function upstreamLatest() {
  if (upstreamCache && Date.now() - upstreamCache.at < 600000) return upstreamCache.value
  let value = { tag: '', name: '', publishedAt: '', url: 'https://github.com/deepseek-ai/deepseek-harness/releases', npmLatest: '' }
  try {
    const r = await fetch('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/latest', { headers: { 'user-agent': 'dsh-launcher', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
    if (r.ok) { const j = await r.json(); value = { ...value, tag: j.tag_name ?? '', name: j.name ?? '', publishedAt: j.published_at ?? '', url: j.html_url ?? value.url } }
  } catch { /* offline */ }
  try {
    const r = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh', { signal: AbortSignal.timeout(15000) })
    if (r.ok) { const j = await r.json(); value.npmLatest = j['dist-tags']?.latest ?? '' }
  } catch { /* offline */ }
  if (value.tag || value.npmLatest) upstreamCache = { at: Date.now(), value } // a failed lookup is retried next time
  return value
}
/** Launcher self-check: everything a fresh install can get wrong, in one answer. */
async function selfCheck() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  const nodeOk = (major === 22 && minor >= 19) || major >= 24
  const pnpm = (await run('cmd.exe', ['/c', 'where', 'pnpm'])).ok
  const links = ensurePeerLinks({ repo: REPO, pluginsDir: PLUGINS_DIR })
  const profile = readJson(path.join(PROFILE, 'package.json'), {})
  const bundles = profile?.dsh?.profile?.bundles ?? []
  // Plugins without a bundle patch (dsh-credentials-keyring, dsh-lan-fence) are layers of the
  // profile's own cordis.patch.yml; their names appear there as `name: '<pkg>'` insert entries.
  const { names: patched, error: patchError } = readProfilePatchStatus({ profile: PROFILE, repo: REPO })
  const present = new Set([...bundles, ...patched])
  // The roster is the plugins directory itself. When it cannot be read there is nothing to compare
  // against, and a stale hand-written list would report the wrong thing: say the roster is unknown.
  const expected = suiteRoster()
  let coreVersion = ''
  try { coreVersion = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version } catch { /* none */ }
  return {
    node: { version: process.version, ok: nodeOk, required: '^22.19 || >=24' },
    core: { path: REPO, version: coreVersion, builtCli: exists(BUILT_CLI), launchMode: dshCommand([]).mode, gitRoot: exists(path.join(REPO, '.git')) ? REPO : SUITE },
    pnpmOnPath: pnpm,
    peerLinks: links,
    profile: { path: PROFILE, bundles, patched, patchError, missing: expected === null || patchError ? [] : expected.filter(n => !present.has(n)), rosterReadable: expected !== null, outdated: communityBelowFloor() },
    ports: { launcher: PORT, dsh: DSH_PORT, dshRunning: await checkPort(DSH_PORT) },
    files: { deck: exists(DECK_FILE), webSearch: exists(WEBSEARCH_FILE), safeGuard: exists(SAFEGUARD_FILE), frontendSkin: exists(FRONTEND_SKIN_TARGET) },
  }
}

/**
 * Community plugins this core needs a floor version of. dsh-context below 0.40 registered its
 * projections with a field the core no longer reads, so its Context tab loaded forever with no
 * error anywhere — the kind of thing a self-check exists to name.
 */
const COMMUNITY_FLOORS = { 'dsh-context': '0.40.0' }
/** Installed community plugins that sit below their floor: [{ name, installed, floor }]. */
function communityBelowFloor() {
  const out = []
  for (const [name, floor] of Object.entries(COMMUNITY_FLOORS)) {
    const pkg = readJson(path.join(PROFILE, 'node_modules', name, 'package.json'), null)
    const installed = typeof pkg?.version === 'string' ? pkg.version : ''
    if (!installed) continue
    const parts = v => String(v).split('-')[0].split('.').map(n => Number(n) || 0)
    const [a, b] = [parts(installed), parts(floor)]
    const older = a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))
    if (older) out.push({ name, installed, floor })
  }
  return out
}

/**
 * The suite's plugin names, read from plugins/<dir>/package.json (a dsh plugin carries a bundle
 * patch or a client entry). null when the directory cannot be read, so the caller keeps its own list.
 */
function suiteRoster() {
  try {
    const names = []
    for (const dir of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name.startsWith('.') || dir.name === 'node_modules') continue
      const pkg = readJson(path.join(PLUGINS_DIR, dir.name, 'package.json'), null)
      if (!pkg || typeof pkg.name !== 'string') continue
      // Every suite plugin is named dsh-*; the patch-layer ones (keyring, lan-fence) carry no bundle patch.
      // A plugin kept in the repo but out of the default profile says so with suiteDefault: false.
      if (pkg.name.startsWith('dsh-') && pkg.suiteDefault !== false) names.push(pkg.name)
    }
    return names.length > 0 ? names : null
  } catch { return null }
}

// ── Folder shortcuts (allow-list) ───────────────────────────────────────────
const FOLDERS = {
  repo: { label: '本体仓库', labelKey: 'f_repo', path: REPO },
  dshHome: { label: 'DSH 主目录 (~/.dsh)', labelKey: 'f_home', path: DSH_HOME },
  sessions: { label: '会话日志', labelKey: 'f_sessions', path: path.join(DSH_HOME, 'sessions') },
  storages: { label: '插件数据 (storages)', labelKey: 'f_storages', path: path.join(DSH_HOME, 'storages') },
  profile: { label: 'web 配置 profile', labelKey: 'f_profile', path: PROFILE },
  plugins: { label: '套件插件 (plugins)', labelKey: 'f_plugins', path: PLUGINS_DIR },
  skillsUser: { label: '用户 Skills', labelKey: 'f_skills', path: path.join(DSH_HOME, 'skills') },
  launcher: { label: '启动器目录', labelKey: 'f_launcher', path: ROOT },
  nodeModules: { label: '本体依赖 node_modules', labelKey: 'f_nodemodules', path: path.join(REPO, 'node_modules') },
}

// ── API routes ──────────────────────────────────────────────────────────────
let builtinCache = null
async function api(req, res, url) {
  const send = (code, data) => json(res, code, data)
  const p = url.pathname
  const lang = req.headers['x-lang'] === 'en' ? 'en' : 'zh'

  if (p === '/api/status') {
    const running = await checkPort(DSH_PORT)
    let version = ''
    try { version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version } catch { /* no core checkout */ }
    let defaultModel = ''
    try {
      // `agent-default-model` is a two-line indented block in settings.yaml; a line scan is more robust than a multi-line regex.
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
    } catch { /* no settings yet */ }
    return send(200, {
      dshRunning: running, dshUrl: await dshBrowserUrl(running), defaultModel, repoVersion: version, node: process.version,
      launchMode: dshCommand([]).mode, updating: updateJobs.core.running || updateJobs.plugins.running,
    })
  }
  if (p === '/api/dsh/start' && req.method === 'POST') return send(200, await startDsh(lang))
  if (p === '/api/dsh/stop' && req.method === 'POST') { const r = await stopDsh(lang); if (r.ok) dshWebUrl = null; return send(200, r) }

  if (p === '/api/plugins/builtin') {
    // Built-in composition rows: every row id printed by `dsh --dump-config` (cached 10 min).
    if (builtinCache === null || Date.now() - builtinCache.at > 600000) {
      const r = await runDsh(['--profile', 'web', '--dump-config'], { timeout: 120000 })
      const ids = [...r.stdout.matchAll(/^- id: (.+)$/gm)].map(m => m[1].trim())
      builtinCache = { at: Date.now(), ids, ok: r.ok }
      log('INFO', 'builtin rows scanned', { count: ids.length })
    }
    return send(200, { rows: builtinCache.ids, count: builtinCache.ids.length })
  }
  if (p === '/api/plugins') {
    let profile = {}
    try { profile = JSON.parse(fs.readFileSync(path.join(PROFILE, 'package.json'), 'utf8')) } catch { /* profile not initialised */ }
    const deps = profile.dependencies ?? {}
    const bundles = profile.dsh?.profile?.bundles ?? []
    const rows = Object.entries(deps).map(([name, spec]) => {
      let version = spec
      try { version = JSON.parse(fs.readFileSync(path.join(PROFILE, 'node_modules', name, 'package.json'), 'utf8')).version } catch { /* not installed */ }
      return { name, spec, version, isBundle: bundles.includes(name), local: String(spec).startsWith('link:') }
    })
    return send(200, { bundles, plugins: rows })
  }
  if (p === '/api/plugins/op' && req.method === 'POST') {
    const { op, spec } = await readBody(req)
    const safe = String(spec ?? '').trim()
    if (!['add', 'remove'].includes(op) || safe.length === 0 || /[&|;<>`"']/.test(safe)) return send(400, { ok: false, message: pick(lang, '非法参数', 'Invalid arguments') })
    if (op === 'remove') {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(safe)) return send(400, { ok: false, message: pick(lang, '卸载时请只填写一个插件包名', 'Specify one package name to uninstall') })
      try { assertPluginRemovable(safe, { profile: PROFILE, repo: REPO }) } catch (error) {
        return send(409, { ok: false, message: error.message })
      }
    }
    log('INFO', 'plugin op', { op, spec: safe })
    const r = await runDsh(['plugin', '--profile', 'web', op, safe], { timeout: 300000 })
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
    // $DSH_HOME/sessions/<project-key>/session-<uuid>/… — grouped by project directory, newest first;
    // each session links to the core's ZIP export endpoint (dsh-session-log-export) when dsh runs.
    // The project key is the core's lossy projectKey(cwd) (session-persistence-jsonl/src/format.ts):
    // registered workspaces are matched exactly through that function; the rest get a best-effort label.
    const dir = path.join(DSH_HOME, 'sessions')
    const workspaces = []
    let total = 0
    const projectKey = cwd => {
      let readable = ''
      let separatorRun = false
      for (let i = 0; i < cwd.length; i++) {
        const code = cwd.charCodeAt(i)
        const ch = String.fromCharCode(code)
        if (ch === '/' || ch === '\\' || ch === ':') { if (!separatorRun) readable += '-'; separatorRun = true }
        else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) { readable += ch; separatorRun = false }
        else { readable += '~' + code.toString(16).toUpperCase().padStart(4, '0'); separatorRun = false }
      }
      const slug = readable.replace(/^-+/, '') || 'root'
      return '--' + slug.slice(0, 251) + '--'
    }
    const known = new Map() // project key → registered workspace path
    try {
      const reg = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'storages', 'workspace.json'), 'utf8'))
      for (const w of Object.values(reg?.tables?.workspaces ?? {})) if (typeof w?.path === 'string') known.set(projectKey(w.path), w.path)
    } catch { /* no registry yet */ }
    if (exists(dir)) {
      for (const ws of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!ws.isDirectory()) continue
        const wsPath = path.join(dir, ws.name)
        const sessions = []
        for (const s of fs.readdirSync(wsPath, { withFileTypes: true })) {
          if (!s.isDirectory() || !/(^|-)session-[0-9a-f-]{36}$/i.test(s.name)) continue
          try {
            const sp = path.join(wsPath, s.name)
            let size = 0
            let latest = fs.statSync(sp).mtimeMs
            for (const f of fs.readdirSync(sp)) { try { const st = fs.statSync(path.join(sp, f)); size += st.size; latest = Math.max(latest, st.mtimeMs) } catch { /* skip */ } }
            const id = s.name.replace(/^.*?session-/, '')
            sessions.push({ id, name: s.name, sizeKB: Math.round(size / 1024), mtime: new Date(latest).toISOString().slice(0, 16).replace('T', ' '), exportUrl: `${DSH_URL}/api/session.export?sessionId=${encodeURIComponent(s.name)}&includeDescendants=true` /* the core addresses sessions by their full session-<uuid> id */ })
          } catch { /* busy entries are skipped */ }
        }
        sessions.sort((a, b) => b.mtime.localeCompare(a.mtime))
        total += sessions.length
        const exact = known.get(ws.name)
        // Unregistered keys are decoded best-effort (a '-' may be a separator or part of a name) and marked with ≈.
        const label = exact ?? (ws.name === '_no-cwd' ? pick(lang, '(无工作目录)', '(no cwd)') : '≈ ' + ws.name.replace(/^--|--$/g, '').replace(/~([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/^([A-Za-z])-/, '$1:\\').replaceAll('-', '\\'))
        workspaces.push({ name: ws.name, label, exact: exact !== undefined, path: wsPath, count: sessions.length, latest: sessions[0]?.mtime ?? '', sessions: sessions.slice(0, 200) })
      }
      workspaces.sort((a, b) => b.latest.localeCompare(a.latest))
    }
    return send(200, { dir, workspaces, total, dshRunning: await checkPort(DSH_PORT) })
  }

  if (p === '/api/storage') {
    const rows = await Promise.all(Object.entries(FOLDERS).map(async ([key, f]) => {
      const present = exists(f.path)
      return { key, label: f.label, labelKey: f.labelKey, path: f.path, exists: present, sizeMB: present ? Math.round(await dirSize(f.path) / 1048576 * 10) / 10 : 0 }
    }))
    return send(200, { folders: rows })
  }
  if (p === '/api/open' && req.method === 'POST') {
    const { key } = await readBody(req)
    // Own property only: FOLDERS['constructor'] is truthy and would reach mkdirSync(undefined).
    const f = Object.hasOwn(FOLDERS, String(key)) ? FOLDERS[String(key)] : undefined
    if (f === undefined) return send(400, { ok: false, message: pick(lang, '未知目录', 'Unknown folder') })
    fs.mkdirSync(f.path, { recursive: true })
    spawn('explorer.exe', [f.path.replaceAll('/', '\\')], { detached: true, windowsHide: false }).unref()
    log('INFO', 'folder opened', { key })
    return send(200, { ok: true, message: pick(lang, '已打开:' + f.label, 'Opened: ' + f.path) })
  }

  if (p === '/api/update/core' && req.method === 'POST') return send(200, startUpdate('core', lang))
  if (p === '/api/update/plugins' && req.method === 'POST') return send(200, startUpdate('plugins', lang))
  if (p === '/api/update/core-tag' && req.method === 'POST') {
    const { tag } = await readBody(req)
    if (!/^[\w.-]{3,64}$/.test(String(tag ?? ''))) return send(400, { ok: false, message: pick(lang, 'tag 非法', 'Invalid tag') })
    return send(200, startUpdate('core-tag', lang, { tag: String(tag) }))
  }
  if (p === '/api/update/status') return send(200, { core: updateJobs.core, plugins: updateJobs.plugins })
  if (p === '/api/update/upstream') {
    let local = ''
    try { local = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version } catch { /* none */ }
    return send(200, { local, ...(await upstreamLatest()) })
  }
  if (p === '/api/selfcheck') return send(200, await selfCheck())
  // Session logs the 0.1.5 core refuses (plugin source members from 0.1.1): the repair script, with dsh stopped.
  // The script itself refuses while something listens on the dsh port, so a running dsh answers with exit code 2.
  if (p === '/api/sessions/repair' && req.method === 'POST') {
    const body = await readBody(req)
    const dryRun = body.dryRun !== false
    const r = await run(process.execPath, [path.join(ROOT, 'repair-session-sources.mjs'), ...(dryRun ? ['--dry-run'] : [])], { cwd: SUITE, timeout: 600000, env: { ...process.env, DSH_HOME, DSH_WEB_PORT: String(DSH_PORT) } })
    log('INFO', 'session repair', { dryRun, ok: r.ok, code: r.code })
    return send(200, { ok: r.ok, exitCode: r.code, dryRun, output: (r.stdout + (r.stderr ? '\n' + r.stderr : '')).trim().slice(-20000) })
  }

  if (p === '/api/tokens') {
    // Claude-Code-style usage analytics: range=all|30|7 → overview, 26-week heatmap, per-model and daily tables.
    const range = url.searchParams.get('range') ?? 'all'
    let ledger = null
    try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { /* no ledger yet */ }
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
    // Streaks over active days: current counts back from today (or yesterday when today is empty); longest over the whole range.
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
    // Heatmap: 26 weeks × 7 days (Monday first) including today; level = 4 buckets of the period maximum.
    const byDate = new Map(allDays.map(d => [d.date, tok(d)]))
    const start = new Date(Date.now() - (26 * 7 - 1) * 86400000)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // back to Monday
    const heatmap = []
    let maxTok = 0
    for (let t = start.getTime(); dayKey(t) <= today; t += 86400000) maxTok = Math.max(maxTok, byDate.get(dayKey(t)) ?? 0)
    for (let t = start.getTime(); dayKey(t) <= today; t += 86400000) {
      const k = dayKey(t); const v = byDate.get(k) ?? 0
      heatmap.push({ date: k, tokens: v, level: v === 0 ? 0 : Math.min(4, 1 + Math.floor(v / Math.max(1, maxTok) * 3.999)) })
    }
    // Fun comparison: Moby-Dick ≈ 209K words × ~1.36 ≈ 285K tokens (same yardstick as the Claude Code usage page); the copy is rendered client-side.
    const mobyRatio = Math.round(totalTokens / 285000 * 100) / 100
    const daily = days.map(d => ({ date: d.date, calls: d.calls ?? 0, miss: d.input ?? 0, hit: (d.cacheRead ?? 0) + (d.cacheWrite ?? 0), output: d.output ?? 0, cost: Math.round((d.cost ?? 0) * 10000) / 10000 })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60)
    return send(200, {
      overview: {
        sessions: sessionIds.size, messages, totalTokens, totalCost,
        activeDays: activeSet.size, currentStreak, longestStreak,
        busiestDay: busiest?.date ?? '—',
        favoriteModel: models[0]?.model?.split('/').pop() ?? '—',
      },
      heatmap, mobyRatio, models, daily,
    })
  }

  if (p === '/api/skins') {
    return send(200, {
      launcher: { list: listSkins('launcher'), active: activeSkin('launcher') },
      frontend: { list: listSkins('frontend'), active: activeSkin('frontend') },
    })
  }
  if (p === '/api/skins/apply' && req.method === 'POST') {
    const { target, name } = await readBody(req)
    // `in` walks the prototype chain: `"constructor"` was truthy and reached a TypeError below.
    if (!Object.hasOwn(SKIN_DIRS, target)) return send(400, { ok: false, message: pick(lang, '非法 target', 'Invalid target') })
    return send(200, applySkin(target, String(name ?? ''), lang))
  }
  if (p === '/api/skins/import' && req.method === 'POST') {
    const { target, name, css } = await readBody(req)
    // `in` walks the prototype chain: `"constructor"` was truthy and reached a TypeError below.
    if (!Object.hasOwn(SKIN_DIRS, target)) return send(400, { ok: false, message: pick(lang, '非法 target', 'Invalid target') })
    return send(200, importSkin(target, name, css, lang))
  }
  if (p === '/api/skins/delete' && req.method === 'POST') {
    const { target, name } = await readBody(req)
    // `in` walks the prototype chain: `"constructor"` was truthy and reached a TypeError below.
    if (!Object.hasOwn(SKIN_DIRS, target)) return send(400, { ok: false, message: pick(lang, '非法 target', 'Invalid target') })
    return send(200, deleteSkin(target, name, lang))
  }

  if (p === '/api/workspace/create' && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const r = await fetch(DSH_URL + '/dsh-quick-workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
      const j = await r.json()
      log('INFO', 'workspace create', { path: body.path, ok: j.ok })
      return send(200, j)
    } catch (error) {
      return send(200, { ok: false, message: pick(lang, 'dsh 未运行或未安装 dsh-quick-workspace 插件:', 'dsh is not running or dsh-quick-workspace is not installed: ') + String(error).slice(0, 80) })
    }
  }

  if (p === '/api/deck') {
    const deckFile = path.join(DSH_HOME, 'control-deck.json')
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { ok: false, message: pick(lang, '甲板必须是 JSON 对象', 'Deck must be a JSON object') })
      const eng = (await loadDeckModules()).deck
      const problems = typeof eng.validateDeck === 'function' ? eng.validateDeck(body) : []
      const soft = p => /\(entry is dropped\)$/.test(p) || /^duplicate prompt names are suffixed/.test(p)
      const hard = problems.filter(p => !soft(p))
      const warnings = problems.filter(soft)
      if (hard.length > 0) return send(400, { ok: false, message: pick(lang, '甲板有误:', 'Invalid deck: ') + hard.join('; ').slice(0, 600) })
      let normalized
      try { normalized = eng.normalizeDeck(body) } catch (error) { return send(400, { ok: false, message: pick(lang, '甲板无效:', 'Invalid deck: ') + String(error?.message ?? error).slice(0, 120) }) }
      // Atomic like every other config write: a torn deck file reads back as an empty deck.
      writeJson(deckFile, normalized)
      log('INFO', 'control deck saved', { prompts: (body.prompts ?? []).length, regex: (body.regex ?? []).length, lore: (body.lorebook ?? []).length })
      return send(200, { ok: true, warnings, message: pick(lang, '已保存,dsh 侧 1.5 秒内热载生效', 'Saved — dsh hot-reloads it within 1.5 s') })
    }
    let deck = {}
    try { deck = JSON.parse(fs.readFileSync(deckFile, 'utf8')) } catch { /* empty deck */ }
    return send(200, { deck })
  }

  // Markets: npm (plugins / skins) and GitHub (skills) search + one-click install.
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
      // npm full-text search mixes in unrelated packages (e.g. the emoji library skin-tone).
      // Real dsh packages carry "dsh" or "deepseek" in name / description / keywords, and
      // search results expose no custom dsh: field, so this heuristic filters them;
      // installation validates the package structure again.
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
    if (safe.length === 0 || /[&|;<>`"' ]/.test(safe)) return send(400, { ok: false, message: pick(lang, '非法包名', 'Invalid package name') })
    log('INFO', 'market install', { type, pkg: safe })
    if (type === 'skill') {
      // GitHub repository → zip extracted into $DSH_HOME/skills/<repo>
      if (!/^[\w.-]+\/[\w.-]+$/.test(safe)) return send(400, { ok: false, message: pick(lang, '需要 owner/repo 形式', 'Expected owner/repo') })
      const dest = path.join(DSH_HOME, 'skills')
      fs.mkdirSync(dest, { recursive: true })
      const zipPath = path.join(LOG_DIR, 'skill-tmp.zip')
      try {
        const resp = await fetch('https://codeload.github.com/' + safe + '/zip/refs/heads/HEAD', { signal: AbortSignal.timeout(60000) })
        if (!resp.ok) return send(200, { ok: false, message: pick(lang, 'GitHub 下载失败 HTTP ', 'GitHub download failed: HTTP ') + resp.status })
        fs.writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()))
        const r = await run('powershell', ['-NoProfile', '-Command', 'Expand-Archive -Force -LiteralPath "' + zipPath + '" -DestinationPath "' + dest + '"'], { timeout: 60000 })
        log(r.ok ? 'INFO' : 'ERROR', 'skill install done', { repo: safe, ok: r.ok })
        return send(200, { ok: r.ok, message: r.ok ? pick(lang, '已解压到 ~/.dsh/skills/', 'Extracted into ~/.dsh/skills/') : pick(lang, '解压失败:', 'Extraction failed: ') + r.stderr.slice(0, 120) })
      } catch (error) { return send(200, { ok: false, message: String(error).slice(0, 120) }) }
    }
    if (type === 'skin') {
      // Skins never enter the plugin system: the npm package is converted in place into local CSS skin files.
      try { return send(200, await installSkinFromNpm(safe, lang)) } catch (error) { return send(200, { ok: false, message: String(error).slice(0, 150) }) }
    }
    const r = await runDsh(['plugin', '--profile', 'web', 'add', safe], { timeout: 300000 })
    log(r.ok ? 'INFO' : 'ERROR', 'market install done', { pkg: safe, ok: r.ok })
    return send(200, { ok: r.ok, message: (r.stdout + r.stderr).split('\n').filter(l => l.trim()).slice(-4).join('\n') })
  }

  // ── Control Deck presets + SillyTavern import/export ──
  if (p === '/api/deck/presets') {
    const deck = readJson(DECK_FILE, {})
    return send(200, { presets: listPresets(), active: typeof deck.presetName === 'string' ? deck.presetName : '' })
  }
  if (p === '/api/deck/presets/save' && req.method === 'POST') {
    const name = safePresetName((await readBody(req)).name)
    if (!name) return send(400, { ok: false, message: pick(lang, '预设名非法', 'Invalid preset name') })
    const deck = readJson(DECK_FILE, {})
    deck.presetName = name
    writeJson(path.join(PRESET_DIR, name + '.json'), deck)
    writeJson(DECK_FILE, deck)
    log('INFO', 'deck preset saved', { name })
    return send(200, { ok: true, message: pick(lang, `已保存预设:${name}`, `Preset saved: ${name}`), presets: listPresets(), active: name })
  }
  if (p === '/api/deck/presets/load' && req.method === 'POST') {
    const name = safePresetName((await readBody(req)).name)
    const file = path.join(PRESET_DIR, name + '.json')
    if (!name || !exists(file)) return send(404, { ok: false, message: pick(lang, '预设不存在', 'Preset not found') })
    const deck = readJson(file, {})
    deck.presetName = name
    writeJson(DECK_FILE, deck)
    log('INFO', 'deck preset loaded', { name })
    return send(200, { ok: true, message: pick(lang, `已切换到预设 ${name},dsh 侧 1.5 秒内热载`, `Switched to preset ${name}; dsh hot-reloads within 1.5 s`), deck, presets: listPresets(), active: name })
  }
  if (p === '/api/deck/presets/delete' && req.method === 'POST') {
    const name = safePresetName((await readBody(req)).name)
    const file = path.join(PRESET_DIR, name + '.json')
    if (!name || !exists(file)) return send(404, { ok: false, message: pick(lang, '预设不存在', 'Preset not found') })
    fs.rmSync(file)
    log('INFO', 'deck preset deleted', { name })
    return send(200, { ok: true, message: pick(lang, '已删除预设:' + name, 'Preset deleted: ' + name), presets: listPresets() })
  }
  if (p === '/api/deck/export') {
    const format = url.searchParams.get('format') ?? 'deck'
    const { st, deck: eng } = await loadDeckModules()
    const deck = eng.normalizeDeck(readJson(DECK_FILE, {}))
    if (format === 'st-world') return send(200, st.toStWorldInfo(deck.lorebook, deck.presetName || 'dsh-control-deck'))
    if (format === 'st-regex') return send(200, st.toStRegex(deck.regex))
    if (format === 'st-prompts') return send(200, st.toStPrompts(deck.prompts))
    return send(200, readJson(DECK_FILE, {}))
  }
  if (p === '/api/deck/import' && req.method === 'POST') {
    const { format, data, merge } = await readBody(req)
    const { st, deck: eng } = await loadDeckModules()
    const current = readJson(DECK_FILE, {})
    let next = current
    let added = 0
    let skipped = 0
    try {
      if (format === 'deck' && (!data || typeof data !== 'object' || Array.isArray(data))) return send(400, { ok: false, message: pick(lang, '整份甲板必须是 JSON 对象', 'Whole deck must be a JSON object') })
      const DECK_KEYS = ['prompts', 'regex', 'lorebook', 'sampling', 'settings', 'disabledTools', 'presetName']
      const shapeOk = format === 'deck' ? (data && typeof data === 'object' && !Array.isArray(data) && DECK_KEYS.some(k => k in data))
        : format === 'st-world' ? (data && typeof data === 'object' && data.entries && typeof data.entries === 'object')
        : format === 'st-regex' ? (Array.isArray(data) ? data.every(x => x && typeof x === 'object' && typeof x.findRegex === 'string') : (data && typeof data === 'object' && typeof data.findRegex === 'string'))
        : format === 'st-prompts' ? (data && typeof data === 'object' && Array.isArray(data.prompts)) : false
      if (!shapeOk) return send(400, { ok: false, message: pick(lang, '文件形状与所选格式不符(世界书需 entries{},正则脚本需 findRegex,提示词预设需 prompts[]),未导入', 'File shape does not match the selected format (World Info needs entries{}, regex scripts need findRegex, prompt presets need prompts[]); nothing imported') })
      if (format === 'deck') { next = merge ? { ...current, ...data, prompts: [...(current.prompts ?? []), ...(data?.prompts ?? [])], regex: [...(current.regex ?? []), ...(data?.regex ?? [])], lorebook: [...(current.lorebook ?? []), ...(data?.lorebook ?? [])] } : data; added = -1 }
      else if (format === 'st-world') { const lore = st.fromStWorldInfo(data); next = { ...current, lorebook: [...(merge ? current.lorebook ?? [] : []), ...lore] }; added = lore.length }
      else if (format === 'st-regex') { const rx = st.fromStRegex(data); skipped = rx.skipped ?? 0; next = { ...current, regex: [...(merge ? current.regex ?? [] : []), ...rx] }; added = rx.length }
      else if (format === 'st-prompts') { const pr = st.fromStPrompts(data); next = { ...current, prompts: [...(merge ? current.prompts ?? [] : []), ...pr] }; added = pr.length }
      else return send(400, { ok: false, message: pick(lang, '未知格式', 'Unknown format') })
      next = eng.normalizeDeck(next) // the written file is always the normalised shape
    } catch (error) { return send(400, { ok: false, message: pick(lang, '导入失败:', 'Import failed: ') + String(error?.message ?? error).slice(0, 120) }) }
    if (added === 0 || (added < 0 && !merge && next.prompts.length + next.regex.length + next.lorebook.length === 0)) return send(400, { ok: false, message: pick(lang, '文件里没有可导入的条目,未改动', 'No importable entries in the file; nothing changed') })
    writeJson(DECK_FILE, next)
    log('INFO', 'deck import', { format, merge: Boolean(merge), added })
    const skippedNote = skipped > 0 ? pick(lang, `;${skipped} 条 promptOnly 的 AI 输出脚本 dsh 无法表达,已禁用导入`, `; ${skipped} promptOnly AI-output script(s) cannot be expressed by dsh and were imported disabled`) : ''
    return send(200, { ok: true, added, skipped, message: pick(lang, `导入完成(${added < 0 ? '整份' : added + ' 条'})${skippedNote},dsh 侧 1.5 秒内热载`, `Imported ${added < 0 ? 'whole deck' : added + ' entries'}${skippedNote}; dsh hot-reloads within 1.5 s`), deck: next })
  }
  if (p === '/api/deck/status') return send(200, await dshJson('/dsh-control-deck/status'))

  // ── Web search (dsh-web-search-plus) ──
  if (p === '/api/websearch' || (p === '/api/websearch/patch' && req.method === 'POST')) {
    const { ws } = await loadDeckModules()
    if (req.method === 'POST') {
      let body = await readBody(req)
      if (p === '/api/websearch/patch') {
        let current = {}
        try {
          current = JSON.parse(fs.readFileSync(WEBSEARCH_FILE, 'utf8'))
          if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('web-search.json must contain an object')
        } catch (error) {
          if (error.code !== 'ENOENT') return send(400, { ok: false, message: pick(lang, '现有联网搜索配置无效，未覆盖：', 'Existing web search configuration is invalid; nothing changed: ') + error.message })
        }
        try { body = mergeWebSearchPatch(current, body) } catch (error) {
          return send(400, { ok: false, message: error.message })
        }
      }
      const problems = typeof ws.validateConfig === 'function' ? ws.validateConfig(body) : []
      if (problems.length > 0) return send(400, { ok: false, message: pick(lang, '配置有误:', 'Invalid config: ') + problems.join('; ') })
      const cfg = ws.normalizeConfig(body)
      writeJson(WEBSEARCH_FILE, cfg)
      log('INFO', 'web search config saved', { mode: cfg.mode, provider: cfg.provider })
      return send(200, { ok: true, config: cfg, message: pick(lang, '已保存,dsh 侧 1.5 秒内热载', 'Saved — dsh hot-reloads within 1.5 s') })
    }
    return send(200, { config: ws.normalizeConfig(readJson(WEBSEARCH_FILE, null)) })
  }
  if (p === '/api/websearch/status') return send(200, await dshJson('/dsh-web-search-plus/status'))
  if (p === '/api/websearch/test' && req.method === 'POST') return send(200, await dshJson('/dsh-web-search-plus/test', { method: 'POST', body: JSON.stringify(await readBody(req)), timeoutMs: 40000 }))
  if (p === '/api/websearch/key' && req.method === 'POST') {
    const body = await readBody(req)
    const r = await dshJson('/dsh-web-search-plus/key', { method: 'POST', body: JSON.stringify(body) })
    log(r.ok ? 'INFO' : 'ERROR', 'web search key update', { provider: body.provider, cleared: !body.value, ok: r.ok })
    return send(200, r)
  }

  // ── Safety rules (dsh-safe-guard hot file) ──
  if (p === '/api/safeguard') {
    if (req.method === 'POST') {
      const body = await readBody(req)
      const clean = list => (Array.isArray(list) ? list.map(x => String(x).trim()).filter(Boolean).slice(0, 200) : [])
      const tooLong = [...clean(body.denyPatterns), ...clean(body.askPatterns), ...clean(body.allowPatterns)].filter(p => p.length > 500)
      if (tooLong.length > 0) return send(400, { ok: false, message: pick(lang, '正则过长(上限 500 字符):', 'Pattern longer than 500 characters: ') + tooLong[0].slice(0, 60) + '…' })
      const cfg = { denyPatterns: clean(body.denyPatterns), askPatterns: clean(body.askPatterns), allowPatterns: clean(body.allowPatterns) }
      const invalid = [...cfg.denyPatterns, ...cfg.askPatterns, ...cfg.allowPatterns].filter(src => { try { new RegExp(src, 'i'); return false } catch { return true } })
      if (invalid.length > 0) return send(400, { ok: false, message: pick(lang, '无效正则:', 'Invalid regex: ') + invalid.join(' | ').slice(0, 200) })
      writeJson(SAFEGUARD_FILE, cfg)
      log('INFO', 'safe-guard rules saved', { deny: cfg.denyPatterns.length, ask: cfg.askPatterns.length, allow: cfg.allowPatterns.length })
      return send(200, { ok: true, config: cfg, message: pick(lang, '已保存,dsh 侧 1.5 秒内热载', 'Saved — dsh hot-reloads within 1.5 s') })
    }
    const cfg = readJson(SAFEGUARD_FILE, {})
    // allowPatterns MUST be read back: the page posts the whole config on save, so a GET that
    // omitted it would show the auto-allow rules as empty and then wipe them on the next save.
    return send(200, { config: { denyPatterns: Array.isArray(cfg.denyPatterns) ? cfg.denyPatterns : [], askPatterns: Array.isArray(cfg.askPatterns) ? cfg.askPatterns : [], allowPatterns: Array.isArray(cfg.allowPatterns) ? cfg.allowPatterns : [] } })
  }

  // ── Credentials center (dsh-credentials-center proxy; the plugin joins references, bindings and the core store) ──
  if (p === '/api/creds/list') return send(200, await dshJson('/dsh-credentials-center/list'))
  if (p === '/api/creds/models') return send(200, await dshJson('/dsh-credentials-center/models'))
  if (p === '/api/creds/default-model' && req.method === 'POST') return send(200, await dshJson('/dsh-credentials-center/default-model', { method: 'POST', body: JSON.stringify(await readBody(req)) }))
  if (p === '/api/creds/sync-status') return send(200, await dshJson('/dsh-provider-sync/status'))
  if (p === '/api/creds/sync-settings' && req.method === 'POST') {
    const body = await readBody(req)
    const allowed = {}
    if (typeof body.anthropicNote === 'boolean') allowed.anthropicNote = body.anthropicNote
    if (typeof body.intervalHours === 'number') allowed.intervalHours = body.intervalHours
    return send(200, await dshJson('/dsh-provider-sync/settings', { method: 'POST', body: JSON.stringify(allowed) }))
  }
  if (p === '/api/creds/sync-models' && req.method === 'POST') return send(200, await dshJson('/dsh-provider-sync/sync', { method: 'POST', body: '{}', timeoutMs: 120000 }))
  if (p === '/api/creds/slots' && req.method === 'GET') {
    const ref = String(url.searchParams.get('ref') ?? '')
    if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(ref)) return send(400, { ok: false, message: 'bad reference' })
    return send(200, await dshJson('/dsh-credentials-center/slots?ref=' + encodeURIComponent(ref)))
  }
  if (/^\/api\/creds\/slots\/(add|keep|use|rename|remove)$/.test(p) && req.method === 'POST') {
    const body = await readBody(req)
    const r = await dshJson('/dsh-credentials-center' + p.slice('/api/creds'.length), { method: 'POST', body: JSON.stringify(body) })
    if (r && typeof r === 'object') delete r.value
    return send(200, r)
  }
  if ((p === '/api/creds/set' || p === '/api/creds/unset' || p === '/api/creds/alias') && req.method === 'POST') {
    const body = await readBody(req)
    const r = await dshJson('/dsh-credentials-center' + p.slice('/api/creds'.length), { method: 'POST', body: JSON.stringify(body) })
    // Never echo a secret back, whatever the plugin answered.
    if (r && typeof r === 'object') delete r.value
    return send(200, r)
  }
  // ── Local models (dsh-local-reasoning proxy) ──
  if (p === '/api/local/status') return send(200, await dshJson('/dsh-local-reasoning/status'))
  if (p === '/api/local/probe' && req.method === 'POST') return send(200, await dshJson('/dsh-local-reasoning/probe', { method: 'POST', body: '{}', timeoutMs: 60000 }))
  if (p === '/api/local/apply' && req.method === 'POST') return send(200, await dshJson('/dsh-local-reasoning/apply', { method: 'POST', body: JSON.stringify(await readBody(req)) }))
  if (p === '/api/local/apply-recommended' && req.method === 'POST') return send(200, await dshJson('/dsh-local-reasoning/apply-recommended', { method: 'POST', body: JSON.stringify(await readBody(req)) }))
  if (p === '/api/local/route-api' && req.method === 'POST') return send(200, await dshJson('/dsh-local-reasoning/route-api', { method: 'POST', body: JSON.stringify(await readBody(req)) }))
  if (p === '/api/local/settings' && req.method === 'POST') return send(200, await dshJson('/dsh-local-reasoning/settings', { method: 'POST', body: JSON.stringify(await readBody(req)), timeoutMs: 60000 }))
  if (p === '/api/local/online-variant' && req.method === 'POST') return send(200, await dshJson('/dsh-local-reasoning/online-variant', { method: 'POST', body: JSON.stringify(await readBody(req)) }))

  // ── Memory & context (dsh-memory-lite proxy; the plugin owns the store, the session log and the edit transaction) ──
  if (p === '/api/memory/status') return send(200, await dshJson('/dsh-memory-lite/status'))
  if (p === '/api/memory/settings' && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite/settings', { method: 'POST', body: JSON.stringify(await readBody(req)) }))
  if (p === '/api/memory/items' && req.method === 'GET') return send(200, await dshJson('/dsh-memory-lite/items' + url.search))
  if (p === '/api/memory/items' && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite/items', { method: 'POST', body: JSON.stringify(await readBody(req)) }))
  if ((p === '/api/memory/items/update' || p === '/api/memory/items/delete' || p === '/api/memory/items/clear') && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite' + p.slice('/api/memory'.length), { method: 'POST', body: JSON.stringify(await readBody(req)) }))
  if (p === '/api/memory/recall' && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite/recall', { method: 'POST', body: JSON.stringify(await readBody(req)), timeoutMs: 60000 }))
  if ((p === '/api/memory/embeddings/test' || p === '/api/memory/embeddings/rebuild') && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite' + p.slice('/api/memory'.length), { method: 'POST', body: JSON.stringify(await readBody(req)), timeoutMs: 300000 }))
  if (p === '/api/memory/export') {
    const data = await dshJson('/dsh-memory-lite/export')
    if (!data.ok) return send(200, data)
    const { ok: _ok, status: _status, ...bundle } = data
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="dsh-memory-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2')}.json"` })
    return res.end(JSON.stringify(bundle, null, 1))
  }
  if (p === '/api/memory/import' && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite/import', { method: 'POST', body: JSON.stringify(await readBody(req, 8 * 1048576)), timeoutMs: 120000 }))
  if (p === '/api/memory/sessions') return send(200, await dshJson('/dsh-memory-lite/sessions', { timeoutMs: 60000 }))
  if (p === '/api/memory/session') return send(200, await dshJson('/dsh-memory-lite/session' + url.search, { timeoutMs: 60000 }))
  if (p === '/api/memory/session/summary' && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite/session/summary', { method: 'POST', body: JSON.stringify(await readBody(req)), timeoutMs: 120000 }))
  if (p === '/api/memory/session/compact' && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite/session/compact', { method: 'POST', body: JSON.stringify(await readBody(req)), timeoutMs: 300000 }))
  if (p === '/api/memory/session/deposit' && req.method === 'POST') return send(200, await dshJson('/dsh-memory-lite/session/deposit', { method: 'POST', body: JSON.stringify(await readBody(req)), timeoutMs: 60000 }))

  // ── Config backup / restore (JSON bundle of the suite's ~/.dsh configuration; credentials and session logs are never included) ──
  if (p === '/api/backup/preview') return send(200, { ok: true, ...collectBackup(true) })
  if (p === '/api/backup') {
    const bundle = collectBackup(false)
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="dsh-config-backup-${stamp}.json"` })
    return res.end(JSON.stringify(bundle, null, 1))
  }
  if (p === '/api/backup/restore' && req.method === 'POST') {
    // the JSON envelope of a full-size bundle is ~5 % larger than the raw files (indentation + escapes): allow 12 MiB
    const body = await readBody(req, 12 * 1048576)
    const result = restoreBackup(body, lang)
    if (!result.ok) return send(400, result)
    log('INFO', 'config backup restored', { written: result.written.length, skipped: result.skipped.length, savedTo: result.savedTo })
    return send(200, result)
  }

  if (p === '/api/logs') {
    const file = url.searchParams.get('file')
    const map = { launcher: todayLog(), dsh: DSH_LOG }
    const empty = pick(lang, '(空)', '(empty)')
    const full = url.searchParams.get('full') === '1'
    let text = empty
    if (file === 'update-core') text = updateJobs.core.log || empty
    else if (file === 'update-plugins') text = updateJobs.plugins.log || empty
    else {
      // Own property only: "constructor" and "__proto__" are not log names.
      const fp = Object.hasOwn(map, file) ? map[file] : undefined
      if (fp === undefined) return send(400, { text: pick(lang, '未知日志', 'Unknown log') })
      try { const raw = fs.readFileSync(fp, 'utf8'); text = full ? raw : raw.slice(-30000) } catch { /* no log yet */ }
    }
    if (url.searchParams.get('download') === '1') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${file}-${new Date().toISOString().slice(0, 10)}.log"` })
      return res.end(text)
    }
    return send(200, { text })
  }

  send(404, { ok: false, message: 'not found' })
}

// ── Static files and skins ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
}
function serveStatic(res, file, req) {
  try {
    // Validators from the stat alone (a revalidation of the 400 KB background must not read it).
    const stat = fs.statSync(file)
    const stamp = stat.mtime.toUTCString()
    const etag = '"' + stat.size.toString(16) + '-' + Math.round(stat.mtimeMs).toString(16) + '"'
    if (req && (req.headers['if-none-match'] === etag || req.headers['if-modified-since'] === stamp)) { res.writeHead(304, { etag, 'last-modified': stamp, 'cache-control': 'no-cache' }); return res.end() }
    const data = fs.readFileSync(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache', etag, 'last-modified': stamp })
    res.end(data)
  } catch { res.writeHead(404); res.end('not found') }
}

/**
 * The API answers this launcher's own page and nothing else.
 *
 * Two checks, because they cover different callers. The browser one — a foreign `Origin` or a
 * cross-site `sec-fetch-site` — stops a web page the user has open. It does nothing about a local
 * process, which sends no fetch metadata at all: and `/api/plugins/op` npm-installs a package,
 * `/api/open` spawns Explorer, `/api/backup/restore` writes under ~/.dsh. So every request also has
 * to carry a token minted on first boot — and kept across restarts — handed only to the page this
 * server serves. It is written to `$DSH_HOME/launcher.token` (owner-only) so the user's own scripts
 * can read it deliberately.
 */
const SELF_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`])
const TOKEN_FILE = path.join(DSH_HOME, 'launcher.token')
/**
 * The token survives restarts: a restart used to mint a fresh one, which turned every
 * already-open launcher page into a wall of 403s — indistinguishable from a crash. Reusing
 * the file's token widens nothing: any local reader could take the current token from the
 * same file during any run. Deleting the file rotates it on the next start.
 */
const API_TOKEN = (() => {
  try {
    const kept = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
    if (/^[0-9a-f]{32,64}$/.test(kept)) return kept
  } catch { /* first run: mint below */ }
  return randomBytes(24).toString('hex')
})()
/**
 * Written once the port is actually ours, never before: a second launcher started by mistake used to
 * overwrite this file and then die on EADDRINUSE, leaving a token no running server accepts.
 *
 * On Windows the mode is close to meaningless — libuv maps it to the read-only attribute only, and
 * the file inherits its ACL from the profile directory — so the ACL is set explicitly where that is
 * possible, and `launcher/README.md` says what the file is actually protected by.
 */
function writeTokenFile() {
  try {
    fs.mkdirSync(DSH_HOME, { recursive: true })
    fs.writeFileSync(TOKEN_FILE, API_TOKEN, { mode: 0o600 })
    if (process.platform === 'win32' && process.env.USERNAME) {
      execFile('icacls', [TOKEN_FILE, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { windowsHide: true }, () => {})
    }
  } catch (error) { log('WARN', 'could not write the API token file', { error: String(error?.message ?? error) }) }
}

/** Constant-time, and length-safe: `timingSafeEqual` throws when the lengths differ. */
function sameToken(value) {
  const given = Buffer.from(String(value ?? ''), 'utf8')
  const want = Buffer.from(API_TOKEN, 'utf8')
  return given.length === want.length && timingSafeEqual(given, want)
}

function rejectCrossSite(req, res) {
  const origin = req.headers.origin
  const site = req.headers['sec-fetch-site']
  // A refused body is drained, like every other router in this suite.
  if ((origin !== undefined && !SELF_ORIGINS.has(origin)) || (site !== undefined && site !== 'same-origin' && site !== 'none')) {
    req.resume?.(); json(res, 403, { ok: false, message: 'cross-site request rejected' }); return true
  }
  if (!sameToken(req.headers['x-launcher-token'])) {
    req.resume?.(); json(res, 403, { ok: false, message: 'this API answers the launcher page only (see ~/.dsh/launcher.token)' }); return true
  }
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') return false
  if (!/^application\/json/i.test(String(req.headers['content-type'] ?? ''))) {
    json(res, 415, { ok: false, message: 'expected application/json' }); return true
  }
  return false
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  try {
    // The launcher binds to 127.0.0.1 only; a foreign Host header means a DNS-rebinding page, which must not read the API.
    if (url.pathname.startsWith('/api/')) {
      const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
      if (!LOCAL_HOSTS.has(host)) { json(res, 403, { ok: false, message: 'unexpected Host header' }); return }
      if (rejectCrossSite(req, res)) return
      await api(req, res, url); return
    }
    if (url.pathname === '/skins/launcher/active.css') {
      const name = activeSkin('launcher')
      const file = path.join(SKIN_DIRS.launcher, (name || 'default') + '.css')
      return serveStatic(res, exists(file) ? file : path.join(SKIN_DIRS.launcher, 'default.css'), req)
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const fp = path.join(ROOT, 'public', path.normalize(file))
    // The separator matters: without it a sibling directory named "public-something" would pass.
    if (!fp.startsWith(path.join(ROOT, 'public') + path.sep)) { res.writeHead(403); res.end(); return }
    serveStatic(res, fp, req)
  } catch (error) {
    log('ERROR', 'request failed', { url: req.url, error: String(error) })
    // A throw after the response started would become ERR_HTTP_HEADERS_SENT inside this catch.
    if (res.headersSent) { try { res.end() } catch { /* already closed */ } return }
    if (error?.status === 400 || error?.status === 413) { json(res, error.status, { ok: false, message: error.status === 413 ? (error.message || 'body too large (1 MB max)') : 'invalid JSON body' }); return }
    json(res, 500, { ok: false, message: String(error) })
  }
})

// A second instance must not touch the token file, so nothing is written until the port is ours.
server.on('error', error => {
  if (error?.code === 'EADDRINUSE') {
    log('ERROR', `port ${PORT} is already in use — another launcher is running; this one is exiting`)
    process.exit(1)
  }
  log('ERROR', 'the launcher server failed', { error: String(error?.message ?? error) })
  process.exit(1)
})
server.listen(PORT, '127.0.0.1', () => {
  writeTokenFile()
  // The fragment is never sent to a server: this is the URL to open, and the only place the token
  // is handed out. `start-launcher.cmd` and the .exe read the token file and open exactly this.
  log('INFO', `DSH Launcher listening on http://127.0.0.1:${PORT}/`, { repo: REPO, launchMode: dshCommand([]).mode, tokenFile: TOKEN_FILE })
})
