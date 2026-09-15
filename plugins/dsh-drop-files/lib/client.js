/**
 * dsh-drop-files browser half: a capture-phase drop listener on the document. A drop that carries
 * only images is left to the core (its attachment rail); any other file is uploaded into the
 * session workspace's .dsh-uploads/ folder and referenced from the composer as `@.dsh-uploads/<name>`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-drop-files',
  factory: (_require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const DICT = {
      zh: {
        uploading: n => `正在放入工作区 ${n} 个文件…`, done: n => `已放入 .dsh-uploads/ 并写入输入框(${n} 个)`, mixed: '图片也一并放进了 .dsh-uploads/(混拖时不走附件栏)', binary: '注意:模型只能读文本文件,PDF / Office / 压缩包已放入但读不出内容——请先转成文本或截图',
        noWorkspace: '当前会话没有工作区,文件无处可放;先在工作区里开一个会话。', noComposer: '没找到输入框,文件已放入 .dsh-uploads/,请手动引用。', failed: m => `放入失败:${m}`, tooBig: n => `${n} 超过 25 MB,跳过`,
        codes: { 'unknown-workspace': '这个会话 dsh 还不认识(刚从列表打开、还没发过消息):先发一条消息,或重新打开会话再拖。', 'no-workspace': '当前会话没有工作区,文件无处可放。', 'not-a-directory': '会话的工作区目录不存在了,换一个会话再拖。', empty: '文件是空的,没有放入。', 'too-big': '文件超过 25 MB。', 'cross-site': '请求被拒(来源不对)。', 'refused-path': '文件名不安全,已拒绝。', 'bad-json': '请求体损坏,请再拖一次。' },
      },
      en: {
        uploading: n => `Putting ${n} file(s) into the workspace…`, done: n => `Saved under .dsh-uploads/ and referenced in the composer (${n})`, mixed: 'Images went into .dsh-uploads/ too (a mixed drop skips the attachment rail)', binary: 'Note: the model reads text files only — PDF / Office / archives were saved but cannot be read; convert them to text or screenshots first',
        noWorkspace: 'This session has no workspace to put files in; open one inside a workspace first.', noComposer: 'No composer found; the file is under .dsh-uploads/, reference it by hand.', failed: m => `Upload failed: ${m}`, tooBig: n => `${n} is over 25 MB, skipped`,
        codes: { 'unknown-workspace': 'dsh does not know this session yet (just opened from the list, nothing sent): send one message or reopen the session, then drop again.', 'no-workspace': 'This session has no workspace to put files in.', 'not-a-directory': 'The session workspace folder is gone; drop into another session.', empty: 'The file is empty; nothing was saved.', 'too-big': 'The file is over 25 MB.', 'cross-site': 'Request refused (wrong origin).', 'refused-path': 'Unsafe file name, refused.', 'bad-json': 'The request body was corrupted; drop again.' },
      },
    }
    const MAX = 25 * 1024 * 1024

    /** A small line above the composer; goes away on its own. */
    let noticeEl = null
    let noticeTimer = null
    function notice(text, ms = 4000) {
      if (!noticeEl) {
        noticeEl = document.createElement('div')
        noticeEl.setAttribute('data-dsh-drop-files', 'notice')
        Object.assign(noticeEl.style, { position: 'fixed', left: '50%', bottom: '112px', transform: 'translateX(-50%)', padding: '6px 12px', borderRadius: '10px', font: '12px/1.4 system-ui, sans-serif', background: 'rgba(20,24,33,.92)', color: '#e9edf6', border: '1px solid rgba(255,255,255,.14)', zIndex: 2147483000, pointerEvents: 'none', maxWidth: '70vw' })
        document.body.appendChild(noticeEl)
      }
      noticeEl.textContent = text
      noticeEl.hidden = false
      clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => { if (noticeEl) noticeEl.hidden = true }, ms)
    }

    /**
     * The chat composer: the last visible textarea that is not inside a dialog (the Settings
     * panel is a body portal after the composer and has textareas of its own).
     */
    function composer() {
      const all = [...document.querySelectorAll('textarea')].filter(t => t.offsetParent !== null && !t.closest('[role="dialog"], dialog'))
      return all[all.length - 1] ?? null
    }
    /** Insert through the editing command so React sees a real input event and keeps its state. */
    function insertIntoComposer(text) {
      const box = composer()
      if (!box) return false
      box.focus()
      const ok = document.execCommand('insertText', false, text)
      if (!ok) {
        const start = box.selectionStart ?? box.value.length
        const next = box.value.slice(0, start) + text + box.value.slice(box.selectionEnd ?? start)
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter ? setter.call(box, next) : (box.value = next)
        box.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return true
    }
    const isImage = f => typeof f?.type === 'string' && f.type.startsWith('image/')
    /** Files the agent's read tool refuses as binary (core fs: FS_NOT_TEXT). */
    const isBinaryDoc = f => /\.(pdf|docx?|docm|xlsx?|xlsm|pptx?|pptm|odt|ods|odp|zip|7z|rar|gz|bz2|xz|tar|tgz|exe|dll|bin|iso|dmg)$/i.test(String(f?.name ?? ''))
    const readBase64 = file => new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
      r.onerror = () => reject(new Error('read failed'))
      r.readAsDataURL(file)
    })
    /**
     * The core shows its drop overlay on dragenter and clears it in its own document drop
     * listener or on window dragend. A stopped drop never reaches that listener and an OS drag
     * dispatches no dragend, so the overlay would stay: tell the core the drag is over.
     */
    const endCoreDrag = () => { try { window.dispatchEvent(new DragEvent('dragend', { bubbles: true })) } catch { /* no DragEvent: nothing to clear */ } }

    async function apply(ctx) {
      const sessions = ctx.get('sessions')
      const T = () => {
        let active = ''
        try { active = String(ctx.locale?.getSnapshot?.().active ?? '') } catch { /* browser language below */ }
        if (!active) active = String(navigator.language ?? '')
        return active.toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
      }
      /** The server's refusal, in the UI language when it carries a known code. */
      const explain = (t, data, status) => t.codes[data?.code] ?? t.failed(data?.message ?? status)
      /**
       * The current session and its workspace. The web sessions service keeps its list in a
       * store: sessions.list.getSnapshot() → { ids, byId, current, … }, byId[id].cwd is the path.
       */
      const currentSession = () => {
        try {
          const snap = sessions?.list?.getSnapshot?.() ?? null
          const id = snap?.current ?? sessions?.selection?.getSnapshot?.()?.sessionId ?? sessions?.watched
          const cwd = id !== undefined ? snap?.byId?.[id]?.cwd : undefined
          return { id: typeof id === 'string' ? id : '', workspace: typeof cwd === 'string' ? cwd : '' }
        } catch { return { id: '', workspace: '' } }
      }
      const onDragOver = e => {
        const files = e.dataTransfer?.items ? [...e.dataTransfer.items].filter(i => i.kind === 'file') : []
        if (files.length === 0 || files.every(i => String(i.type).startsWith('image/'))) return
        e.preventDefault()   // the browser must not open the file
        // The core's own document handler would set dropEffect to 'none' while a turn runs (it
        // only knows images), which cancels the drop before it reaches us: this drag is ours.
        e.stopPropagation()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      }
      const onDrop = async e => {
        const files = e.dataTransfer?.files ? [...e.dataTransfer.files] : []
        if (files.length === 0 || files.every(isImage)) return   // the core's rail handles images
        e.preventDefault()
        e.stopPropagation()
        endCoreDrag()
        const t = T()
        const { id: sessionId, workspace } = currentSession()
        if (!workspace) { notice(t.noWorkspace, 6000); return }
        notice(t.uploading(files.length), 60000)
        let done = 0
        const refs = []
        for (const file of files) {
          if (file.size > MAX) { notice(t.tooBig(file.name), 5000); continue }
          try {
            const base64 = await readBase64(file)
            const r = await fetch('/dsh-drop-files/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace, sessionId, name: file.name, base64 }) })
            const data = await r.json().catch(() => ({ ok: false, message: 'HTTP ' + r.status }))
            if (data.ok === false) { notice(explain(t, data, r.status), 7000); continue }
            refs.push('@' + data.relative)
            done++
          } catch (error) { notice(t.failed(String(error?.message ?? error)), 6000) }
        }
        if (refs.length > 0) {
          const mixed = files.some(isImage)
          const binary = files.some(isBinaryDoc)
          const extra = (mixed ? ' · ' + t.mixed : '') + (binary ? ' · ' + t.binary : '')
          if (insertIntoComposer(refs.join(' ') + ' ')) notice(t.done(done) + extra, extra ? 9000 : 4000)
          else notice(t.noComposer, 6000)
        }
      }
      document.addEventListener('dragover', onDragOver, true)
      document.addEventListener('drop', onDrop, true)
      ctx.effect?.(() => () => { document.removeEventListener('dragover', onDragOver, true); document.removeEventListener('drop', onDrop, true) }, 'drop-files: listeners')
    }
    exports.apply = apply
    exports.inject = ['sessions', 'locale']
    return module.exports
  },
})
