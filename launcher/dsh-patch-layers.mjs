#!/usr/bin/env node
/**
 * Register the suite's patch-layer plugins in the web profile's cordis.patch.yml.
 *
 * Two plugins cannot be bundles: dsh-credentials-keyring replaces the stock `credentials`
 * provider (the stock one must be disabled first), and dsh-lan-fence edits the connection fence
 * in place. Both are inserted as entries of the profile's own patch file — the same entries this
 * file has carried by hand until v1.8.0. Idempotent: an entry that is already there is left alone;
 * the file is only rewritten when something is missing. Run by setup.cmd after the bundle plugins.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProfilePatches, profilePluginNames } from './profile-patches.mjs'
import { normalizeDshHome } from './home-paths.mjs'

const HEADER = '# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries.\n'
const BLOCKS = [
  {
    name: 'dsh-credentials-keyring',
    text: '\n# --- keyring credentials: replace the stock provider (same `credentials` service) ---\n- id: credentials\n  disabled: true\n- insert:\n    - id: credentials-keyring\n      name: \'dsh-credentials-keyring\'\n',
  },
  {
    name: 'dsh-lan-fence',
    text: '\n# --- LAN /api fence (plugin, not a core change): strips auto-derived LAN authorities in place ---\n- insert:\n    - id: lan-fence\n      name: \'dsh-lan-fence\'\n',
  },
]

export function planPatchLayers(text, repo) {
  if (/^\s*\.\.\.(?:\s|#|$)/m.test(text)) throw new Error('Remove the YAML document end marker (...) before adding suite patch layers')
  const documents = text.match(/^---(?:\s|#|$)/gm) ?? []
  if (documents.length > 1) throw new Error('Multiple YAML documents are not supported in cordis.patch.yml')
  const parsed = parseProfilePatches(text, repo)
  const present = profilePluginNames(parsed)
  const missing = BLOCKS.filter(block => !present.has(block.name))
  if (missing.length === 0) return { text, added: [] }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const content = lines.map((line, index) => ({ line: line.replace(/^\uFEFF/, ''), index }))
    .filter(({ line }) => !/^\s*(?:#.*)?$/.test(line) && !/^---(?:\s+#.*)?\s*$/.test(line))
  if (parsed.length === 0 && content.length === 1 && /^\s*\[\s*\](?:\s*#.*)?\s*$/.test(content[0].line)) {
    const { line, index } = content[0]
    const comment = line.indexOf('#')
    lines[index] = comment < 0 ? '' : line.slice(comment)
  } else if (content.length > 0 && !/^\s*-\s/.test(content[0].line)) {
    throw new Error('Use a block YAML patch list before adding suite layers; the existing file was not changed')
  }
  const next = lines.join(eol).replace(/\s*$/, eol) + missing.map(block => block.text.replaceAll('\n', eol)).join('')
  parseProfilePatches(next, repo)
  return { text: next, added: missing.map(block => block.name) }
}

export function installPatchLayers({ home, repo }) {
  const file = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch (error) {
    if (error.code !== 'ENOENT') throw error
    text = HEADER
  }
  const plan = planPatchLayers(text, repo)
  if (plan.added.length === 0) return { file, added: [] }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2)
  try {
    fs.writeFileSync(tmp, plan.text, { flag: 'wx' })
    fs.renameSync(tmp, file)
  } catch (error) {
    try { fs.unlinkSync(tmp) } catch { /* temp file may not have been created */ }
    throw error
  }
  return { file, added: plan.added }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.dirname(fileURLToPath(import.meta.url))
    const result = installPatchLayers({
      home: normalizeDshHome(),
      repo: process.env.DSH_REPO ?? path.join(root, '..', 'core'),
    })
    console.log('[patch-layers] ' + (result.added.length ? 'added ' + result.added.join(', ') : 'already installed') + ': ' + result.file)
  } catch (error) {
    console.error('[patch-layers] ' + error.message)
    process.exitCode = 1
  }
}
