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
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const FILE = path.join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')
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

let text = ''
try { text = fs.readFileSync(FILE, 'utf8') } catch { text = HEADER }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const missing = BLOCKS.filter(b => !new RegExp(`^\\s*-?\\s*name:\\s*['"]?${escapeRe(b.name)}['"]?\\s*(#.*)?$`, 'm').test(text))
if (missing.length === 0) { console.log('[patch-layers] nothing to add: ' + BLOCKS.map(b => b.name).join(', ') + ' already in ' + FILE); process.exit(0) }
fs.mkdirSync(path.dirname(FILE), { recursive: true })
fs.writeFileSync(FILE, text.replace(/\s*$/, '\n') + missing.map(b => b.text).join(''))
console.log('[patch-layers] added ' + missing.map(b => b.name).join(', ') + ' to ' + FILE)
