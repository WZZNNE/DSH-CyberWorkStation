/** Read profile YAML using the core CLI's declared parser; expressions stay inert. */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'

const parsers = new Map()
export function parseProfilePatches(text, repo) {
  let parser = parsers.get(repo)
  if (!parser) {
    const yaml = createRequire(path.join(path.resolve(repo), 'apps/cli/package.json'))('js-yaml')
    const expression = new yaml.Type('tag:yaml.org,2002:js', {
      kind: 'scalar',
      resolve: value => typeof value === 'string',
      construct: value => ({ __jsExpr: value }),
    })
    const schema = yaml.JSON_SCHEMA.extend(expression)
    parser = value => yaml.load(value, { schema })
    parsers.set(repo, parser)
  }
  const parsed = parser(text)
  if (parsed == null && text.split(/\r?\n/).every(line => /^\s*(?:#.*)?$/.test(line) || /^---(?:\s+#.*)?\s*$/.test(line))) return []
  if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('cordis.patch.yml must contain a YAML array of patch objects')
  }
  return parsed
}

/** Names in loader entries, excluding a plugin's own config fields. */
export function profilePluginNames(patches) {
  const names = new Set()
  const visited = new Set()
  const visit = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    if (Array.isArray(value)) { for (const entry of value) visit(entry); return }
    if (typeof value.name === 'string') names.add(value.name)
    for (const key of ['insert', 'children']) visit(value[key])
  }
  visit(patches)
  return names
}

/** Self-check must distinguish an absent patch from unreadable or invalid configuration. */
export function readProfilePatchStatus({ profile, repo }) {
  let text
  try { text = fs.readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return { names: [], error: null }
    return { names: [], error: 'Cannot read cordis.patch.yml / 无法读取 profile 补丁文件' }
  }
  try { return { names: [...profilePluginNames(parseProfilePatches(text, repo))], error: null } } catch {
    // Parser exceptions may include a source snippet containing configuration secrets.
    return { names: [], error: 'Cannot parse cordis.patch.yml as a YAML patch array / profile 补丁 YAML 解析失败，请检查数组格式与核心依赖' }
  }
}

/** Refuse to remove a dependency still named by the user's explicit patch layer. */
export function assertPluginRemovable(name, { profile, repo }) {
  if (!['dsh-credentials-keyring', 'dsh-lan-fence'].includes(name)) return
  const file = path.join(profile, 'cordis.patch.yml')
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return
    throw new Error(`Cannot read ${file}; uninstall was cancelled`)
  }
  let names
  try { names = profilePluginNames(parseProfilePatches(text, repo)) } catch (error) {
    throw new Error(`Cannot validate ${file}; uninstall was cancelled: ${error.message}`)
  }
  if (names.has(name)) {
    throw new Error(`${name} is still referenced by ${file}. Stop dsh and adjust that patch first; for keyring, migrate your stored credentials before restoring the stock provider. See launcher/README.md: Removing patch-layer plugins. / 此插件仍被 profile 补丁引用，已取消卸载；请先停止 dsh 并调整补丁，钥匙串插件还需先迁移凭据。操作步骤见 launcher/README.md。`)
  }
}
