/**
 * Configuration backup and restore: the whitelist of files under DSH_HOME the suite considers
 * configuration, the bundle format, and the guarded restore (previous copies saved beside).
 */
import fs from 'node:fs'
import path from 'node:path'
import { pick } from './util.mjs'

/**
 * @param {{ dshHome: string }} env
 */
export function createBackup({ dshHome }) {
  /**
   * Files under DSH_HOME the suite considers "configuration" (exact names, and a few directories by extension, depth-limited).
   * Credentials (.credentials.yaml), session logs, storages and node_modules are deliberately outside the list.
   */
  const BACKUP_FILES = ['settings.yaml', 'control-deck.json', 'web-search.json', 'safe-guard.json', 'local-reasoning.json', 'memory-lite.json', 'memory/memory.json', 'frontend-skin.css', 'profiles/web/cordis.patch.yml', 'profiles/headless/cordis.patch.yml']
  const BACKUP_DIRS = [{ dir: 'control-deck-presets', ext: ['.json'], depth: 1 }, { dir: 'skills', ext: ['.md'], depth: 2 }, { dir: 'hooks', ext: ['.json'], depth: 1 }]
  const BACKUP_FILE_CAP = 2 * 1048576
  const BACKUP_TOTAL_CAP = 8 * 1048576
  const BACKUP_MAX_FILES = 500
  /** Whether a bundle key names a file the backup whitelist covers (forward slashes, no traversal, no absolute paths). */
  function backupKeyAllowed(rel) {
    if (typeof rel !== 'string' || rel.length === 0 || rel.length > 300) return false
    if (rel.includes('\\') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false
    // no empty / dot segments, no NTFS alternate data streams (`name:stream`), no reserved device names (CON, NUL, COM1 …)
    if (rel.split('/').some(seg => seg === '' || seg === '.' || seg === '..' || seg.includes(':') || seg !== seg.trim() || /[. ]$/.test(seg) || /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(seg.split('.')[0].trimEnd()))) return false
    if (BACKUP_FILES.includes(rel)) return true
    for (const d of BACKUP_DIRS) {
      if (!rel.startsWith(d.dir + '/')) continue
      const rest = rel.slice(d.dir.length + 1)
      if (rest.split('/').length > d.depth) return false
      return d.ext.some(ext => rel.toLowerCase().endsWith(ext))
    }
    return false
  }
  function collectBackup(previewOnly) {
    const files = {}
    const entries = []
    let total = 0
    const add = rel => {
      const abs = path.join(dshHome, rel)
      let st
      try { st = fs.statSync(abs) } catch { return }
      if (!st.isFile()) return
      if (entries.filter(e => !e.skipped).length >= BACKUP_MAX_FILES) { entries.push({ rel, size: st.size, skipped: 'too many files' }); return }
      if (st.size > BACKUP_FILE_CAP || total + st.size > BACKUP_TOTAL_CAP) { entries.push({ rel, size: st.size, skipped: 'too large' }); return }
      let content = null
      if (!previewOnly) { try { content = fs.readFileSync(abs, 'utf8') } catch (error) { entries.push({ rel, size: st.size, skipped: 'unreadable: ' + String(error?.code ?? error) }); return } }
      total += st.size
      entries.push({ rel, size: st.size })
      if (content !== null) files[rel] = content
    }
    for (const rel of BACKUP_FILES) add(rel)
    for (const d of BACKUP_DIRS) {
      const walk = (dirRel, depth) => {
        let names = []
        try { names = fs.readdirSync(path.join(dshHome, dirRel), { withFileTypes: true }) } catch { return }
        for (const ent of names) {
          const rel = dirRel + '/' + ent.name
          if (ent.isDirectory()) { if (depth < d.depth) walk(rel, depth + 1); continue }
          if (ent.isFile() && backupKeyAllowed(rel)) add(rel)
        }
      }
      walk(d.dir, 1)
    }
    return { version: 1, createdAt: new Date().toISOString(), entries, total, ...(previewOnly ? {} : { files }) }
  }
  function restoreBackup(body, lang) {
    const files = body && typeof body.files === 'object' && !Array.isArray(body.files) ? body.files : null
    if (!files) return { ok: false, message: pick(lang, '备份文件格式不对:缺少 files 对象', 'Not a backup bundle: files object missing') }
    const keys = Object.keys(files)
    if (keys.length === 0) return { ok: false, message: pick(lang, '备份里没有文件', 'The bundle holds no files') }
    if (keys.length > BACKUP_MAX_FILES) return { ok: false, message: pick(lang, `备份里文件过多(${keys.length} > ${BACKUP_MAX_FILES})`, `Too many files in the bundle (${keys.length} > ${BACKUP_MAX_FILES})`) }
    const home = path.resolve(dshHome)
    const written = []
    const skipped = []
    let saved = 0
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
    const saveDir = path.join(dshHome, 'backups', 'before-restore-' + stamp)
    for (const rel of keys) {
      const content = files[rel]
      if (!backupKeyAllowed(rel) || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > BACKUP_FILE_CAP) { skipped.push(rel); continue }
      const abs = path.resolve(home, rel)
      const inside = path.relative(home, abs)
      if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) { skipped.push(rel); continue }
      try {
        if (fs.existsSync(abs)) { const keep = path.join(saveDir, rel); fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.copyFileSync(abs, keep); saved++ }
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        const tmp = abs + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
        try {
          fs.writeFileSync(tmp, content)
          fs.renameSync(tmp, abs)
        } catch (error) {
          try { fs.unlinkSync(tmp) } catch { /* already gone */ }
          throw error
        }
        written.push(rel)
      } catch (error) { skipped.push(rel + ' (' + String(error?.message ?? error).slice(0, 80) + ')') }
    }
    if (written.length === 0) return { ok: false, written, skipped, message: pick(lang, `没有恢复任何文件(跳过 ${skipped.length} 个:不在白名单或写入失败)`, `Nothing was restored (${skipped.length} skipped: not whitelisted or failed to write)`) }
    const restartNeeded = written.some(rel => rel.startsWith('profiles/') || rel.startsWith('hooks/'))
    const skippedNote = skipped.length ? pick(lang, ',跳过 ' + skipped.length + ' 个', ', skipped ' + skipped.length) : ''
    const savedNote = saved > 0 ? pick(lang, ';原文件已备份到 ' + saveDir, '; previous copies saved to ' + saveDir) : ''
    const restartNote = restartNeeded ? pick(lang, ';profile 补丁 / hooks 需要重启 dsh 才生效', '; profile patches / hooks take effect after a dsh restart') : ''
    return {
      ok: true, written, skipped, savedTo: saved > 0 ? saveDir : '',
      message: pick(lang, '已恢复 ' + written.length + ' 个文件' + skippedNote + savedNote + '。settings.yaml / 甲板 / 联网搜索 / 安全规则 / 记忆由 dsh 热载' + restartNote + '。', 'Restored ' + written.length + ' file(s)' + skippedNote + savedNote + '. settings.yaml / deck / web search / safety / memory hot-reload in dsh' + restartNote + '.'),
    }
  }
  return { BACKUP_FILES, BACKUP_DIRS, backupKeyAllowed, collectBackup, restoreBackup }
}
