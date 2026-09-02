/**
 * Vendor a deepseek-harness release tag into the suite's core/ directory.
 *
 * Steps: download the tag archive from GitHub (codeload zip) → extract with
 * PowerShell Expand-Archive into a temp dir → mirror the source tree over the
 * core with robocopy /MIR, keeping node_modules, built lib/, dist/ and
 * tsbuildinfo so the following `pnpm install && build:lib && build:web` is
 * incremental. The launcher's "upgrade to tag" job runs this script first.
 *
 * Usage: node launcher/vendor-core.mjs <tag>   (e.g. dsh-v0.1.1-rc.2)
 * Env:   DSH_REPO overrides the core directory (default ../core).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DSH_REPO ?? path.join(ROOT, '..', 'core')
const tag = process.argv[2]
if (!tag || !/^[\w.-]+$/.test(tag)) { console.error('usage: node vendor-core.mjs <tag>'); process.exit(2) }

const say = m => console.log(`[vendor-core] ${m}`)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-core-'))
const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* temp leftovers are harmless */ } }
process.on('exit', cleanup)
const zip = path.join(tmp, 'core.zip')
const url = `https://codeload.github.com/deepseek-ai/deepseek-harness/zip/refs/tags/${tag}`
say(`downloading ${url}`)
const resp = await fetch(url, { signal: AbortSignal.timeout(600000) })
if (!resp.ok) { console.error(`[vendor-core] download failed: HTTP ${resp.status}`); await resp.body?.cancel?.(); process.exitCode = 1; await new Promise(r => setTimeout(r, 50)); process.exit(1) }
fs.writeFileSync(zip, Buffer.from(await resp.arrayBuffer()))
say(`downloaded ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB; extracting`)
execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath "${zip}" -DestinationPath "${tmp}"`], { stdio: 'inherit', windowsHide: true, timeout: 600000 })
const extracted = fs.readdirSync(tmp, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(tmp, e.name)).find(p => fs.existsSync(path.join(p, 'package.json')))
if (!extracted) { console.error('[vendor-core] archive has no package.json root'); process.exitCode = 1; await new Promise(r => setTimeout(r, 50)); process.exit(1) }
const version = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8')).version
say(`archive version ${version}; mirroring into ${REPO}`)
fs.mkdirSync(REPO, { recursive: true })
// robocopy exit codes 0-7 are success variants (bit 1 = files copied, 2 = extras, 4 = mismatches); 8+ means failures.
const rc = spawnSync('robocopy', [extracted, REPO, '/MIR', '/XD', 'node_modules', 'lib', 'dist', '.git', '.pnpm-store', '.cache', 'coverage', 'tmp', '.artifacts', '.dsh-build', '.storages', '.sessions', '/XF', '*.tsbuildinfo', '/NFL', '/NDL', '/NJH', '/R:2', '/W:1'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 })
const out = String(rc.stdout ?? '') + String(rc.stderr ?? '')
console.log(out.split('\n').filter(l => /Dirs|Files|Bytes|Ended/.test(l)).join('\n'))
if (rc.error || rc.status === null || rc.status >= 8) { console.error(`[vendor-core] robocopy failed (exit ${rc.status ?? rc.error?.message})`); process.exitCode = 1; await new Promise(r => setTimeout(r, 50)); process.exit(1) }
say(`core is now ${version}; run pnpm install && build:lib && build:web next`)
