/**
 * Peer links for the suite's link: plugins.
 *
 * The core is launched from its built `lib/` under plain Node (see server.mjs),
 * so a plugin that imports a core package (`@deepseek-ai/dsh-tools`,
 * `@deepseek-ai/dsh-settings`, ...) must be able to resolve it through normal
 * Node resolution. tsx source launch masked this by applying the core's
 * tsconfig path map; plain Node does not. This module creates
 * `plugins/node_modules/@deepseek-ai/<name>` junctions pointing at the core's
 * workspace packages for every `@deepseek-ai/*` peer/dependency a suite plugin
 * declares, and `plugins/node_modules/<name>` junctions for the suite's own shared
 * packages under `plugins/` (`dsh-cyberworkstation-kit` = `plugins/_shared`). Junctions resolve to the same realpath the core itself loads, so
 * Node keeps a single module instance per package.
 *
 * Usage: `node launcher/peer-links.mjs` (setup.cmd) or `ensurePeerLinks()` from
 * the launcher before every dsh start. Idempotent and cheap.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

/** Map `@deepseek-ai/<name>` -> absolute package dir by scanning the core workspace once. */
function indexCorePackages(repo) {
  const map = new Map()
  const roots = [path.join(repo, 'packages'), path.join(repo, 'vendor')]
  for (const root of roots) {
    let groups = []
    try { groups = fs.readdirSync(root, { withFileTypes: true }) } catch { continue }
    for (const g of groups) {
      if (!g.isDirectory()) continue
      const gdir = path.join(root, g.name)
      const tryAdd = dir => {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
          if (typeof pkg.name === 'string' && pkg.name.startsWith('@deepseek-ai/')) map.set(pkg.name, dir)
        } catch { /* not a package dir */ }
      }
      tryAdd(gdir)
      let subs = []
      try { subs = fs.readdirSync(gdir, { withFileTypes: true }) } catch { continue }
      for (const s of subs) if (s.isDirectory() && s.name !== 'node_modules') tryAdd(path.join(gdir, s.name))
    }
  }
  return map
}

/** Whether two paths name the same directory (drive-letter case and junction spellings differ on Windows). */
function samePath(a, b) {
  const real = p => { try { return fs.realpathSync.native(p) } catch { return path.resolve(p) } }
  const x = real(a), y = real(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

/**
 * Map package name -> dir for the suite's shared packages: the `_`-prefixed directories under plugins/
 * (`_shared` is `dsh-cyberworkstation-kit`). They are not plugins and never enter a profile; plugins
 * reach them through the links made here.
 */
function indexSuitePackages(pluginsDir) {
  const map = new Map()
  let dirs = []
  try { dirs = fs.readdirSync(pluginsDir, { withFileTypes: true }) } catch { return map }
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith('_')) continue
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pluginsDir, d.name, 'package.json'), 'utf8'))
      if (typeof pkg.name === 'string') map.set(pkg.name, path.join(pluginsDir, d.name))
    } catch { /* not a package dir */ }
  }
  return map
}

const CORE_SCOPE = '@deepseek-ai/'

/** Collect every `@deepseek-ai/*` name and every shared-package name the suite plugins declare as peer or regular dependency. */
function wantedNames(pluginsDir, suite) {
  const names = new Set()
  let dirs = []
  try { dirs = fs.readdirSync(pluginsDir, { withFileTypes: true }) } catch { return names }
  for (const d of dirs) {
    if (!d.isDirectory() || d.name === 'node_modules' || d.name.startsWith('_')) continue
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pluginsDir, d.name, 'package.json'), 'utf8'))
      for (const field of ['peerDependencies', 'dependencies']) {
        for (const name of Object.keys(pkg[field] ?? {})) if (name.startsWith(CORE_SCOPE) || suite.has(name)) names.add(name)
      }
    } catch { /* plugin without manifest */ }
  }
  return names
}

/**
 * Ensure `plugins/node_modules/@deepseek-ai/<name>` links exist for every declared core peer, and
 * `plugins/node_modules/<name>` for the suite's shared packages (installed from npm they are regular
 * dependencies; as `link:` plugins they resolve through these junctions). Returns a summary; never
 * throws for a single bad link.
 * @param {{ repo: string, pluginsDir: string }} opts
 */
export function ensurePeerLinks({ repo, pluginsDir }) {
  const core = indexCorePackages(repo)
  const suite = indexSuitePackages(pluginsDir)
  const result = { linked: [], kept: [], missing: [], failed: [] }
  const wanted = wantedNames(pluginsDir, suite)
  if (wanted.size === 0) return result
  for (const name of wanted) {
    const target = core.get(name) ?? suite.get(name)
    const slash = name.indexOf('/')
    const scope = slash < 0 ? path.join(pluginsDir, 'node_modules') : path.join(pluginsDir, 'node_modules', name.slice(0, slash))
    const linkPath = slash < 0 ? path.join(scope, name) : path.join(scope, name.slice(slash + 1))
    if (target === undefined) { result.missing.push(name); continue }
    try { fs.mkdirSync(scope, { recursive: true }) } catch { /* reported by the link attempt */ }
    try {
      let current = null
      try { current = fs.readlinkSync(linkPath) } catch { /* absent or not a link */ }
      if (current !== null && samePath(current, target)) { result.kept.push(name); continue }
      try { fs.rmSync(linkPath, { recursive: true, force: true }) } catch { /* absent */ }
      fs.symlinkSync(target, linkPath, 'junction')
      result.linked.push(name)
    } catch (error) {
      result.failed.push(name + ': ' + String(error?.message ?? error))
    }
  }
  return result
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const repo = process.env.DSH_REPO ?? path.join(ROOT, '..', 'core')
  const pluginsDir = process.env.DSH_SUITE_PLUGINS ?? path.join(ROOT, '..', 'plugins')
  const r = ensurePeerLinks({ repo, pluginsDir })
  console.log(JSON.stringify(r))
  // a peer nobody can resolve is as fatal as a link that could not be made: the plugins will not load
  if (r.failed.length > 0 || r.missing.length > 0) { console.error(`peer-links: ${r.missing.length} missing, ${r.failed.length} failed`); process.exit(1) }
}
