#!/usr/bin/env node
// Publish the suite packages to npm: the shared kit first, then every plugin that is part of the
// default profile. Idempotent: a version already on the registry is skipped. `--dry-run` packs
// without publishing; `--only name[,name]` limits the set. Requires `npm login` beforehand.
import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS = path.join(ROOT, 'plugins')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyAt = args.indexOf('--only')
const only = onlyAt >= 0 ? (args[onlyAt + 1] ?? '').split(',').filter(x => x && !x.startsWith('--')) : []
const allowDirty = args.includes('--allow-dirty')
if (onlyAt >= 0 && only.length === 0) { console.error('--only needs a comma-separated list of package or directory names'); process.exit(2) }
const SKIP = new Set(['dsh-memory-hub', 'dsh-token-usage-plus'])

function manifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch { return null }
}
function published(name, version) {
  const r = spawnSync(`npm view ${name}@${version} version --json`, { encoding: 'utf8', shell: true })
  return r.status === 0 && r.stdout.trim() !== ''
}
/** Uncommitted changes under the package directory: what npm would pack is not what the repository records. */
function dirty(dir) {
  const r = spawnSync(`git status --porcelain -- "${dir}"`, { cwd: ROOT, encoding: 'utf8', shell: true })
  return r.status === 0 && r.stdout.trim() !== ''
}

const order = []
const kitDir = path.join(PLUGINS, '_shared')
order.push(kitDir)
for (const d of fs.readdirSync(PLUGINS).sort()) {
  if (!d.startsWith('dsh-') || SKIP.has(d)) continue
  const dir = path.join(PLUGINS, d)
  if (manifest(dir)) order.push(dir)
}

let whoami = ''
try { whoami = execSync('npm whoami', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* not logged in */ }
if (!whoami && !dryRun) { console.error('npm: not logged in. Run `npm login` first (browser flow), then re-run this script.'); process.exit(1) }
console.log(dryRun ? 'dry run' : `publishing as ${whoami}`)

const done = [], skipped = [], failed = []
if (only.length > 0) {
  const known = new Set(order.flatMap(dir => { const m = manifest(dir); return m ? [m.name, path.basename(dir)] : [] }))
  const unknown = only.filter(n => !known.has(n))
  if (unknown.length > 0) { console.error('--only names nothing publishable:', unknown.join(', ')); process.exit(2) }
}
for (const dir of order) {
  const pkg = manifest(dir)
  if (!pkg || (only.length > 0 && !only.includes(pkg.name) && !only.includes(path.basename(dir)))) continue
  if (!allowDirty && dirty(dir)) {
    if (!dryRun) { failed.push(`${pkg.name} (uncommitted changes; commit first or pass --allow-dirty)`); continue }
    console.warn(`warning: ${pkg.name} has uncommitted changes`)
  }
  if (pkg.private) { skipped.push(`${pkg.name} (private)`); continue }
  const tag = `${pkg.name}@${pkg.version}`
  if (!dryRun && published(pkg.name, pkg.version)) { skipped.push(`${tag} (already on the registry)`); continue }
  // A prerelease-style version (x.y.z-suffix) needs an explicit dist-tag; the suite publishes release versions only.
  const cmd = `npm publish${dryRun ? ' --dry-run' : ''} --access public${pkg.version.includes('-') ? ' --tag latest' : ''}`
  const r = spawnSync(cmd, { cwd: dir, stdio: 'inherit', shell: true })
  if (r.status === 0) done.push(tag); else failed.push(tag)
}
console.log(dryRun ? '\npacked:' : '\npublished:', done.length, done.join(' '))
console.log('skipped:', skipped.length, skipped.join(' '))
if (failed.length > 0) { console.error('failed:', failed.join(' ')); process.exit(1) }
