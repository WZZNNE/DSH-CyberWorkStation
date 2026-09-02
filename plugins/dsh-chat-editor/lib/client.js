/**
 * dsh-chat-editor browser half.
 *
 *  - a "✎ messages" button in the session header opens the message panel: every message of
 *    the conversation (yours, the assistant's, injected context, tool results) with edit /
 *    delete / branch actions in the three modes the host implements;
 *  - an inline ✎ on each finished assistant message opens the panel focused on it
 *    (official `conversation.chat.assistant-actions` slot);
 *  - display-only overrides are applied to the rendered bubbles: the text is swapped or the
 *    message is hidden, anchored on the original text, never touching the log or the model.
 *
 * Loaded through window.__ModuleLoader__ like every dsh client plugin.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chat-editor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ── i18n ──
    const ZH = {
      open: '消息编辑', title: '消息编辑', close: '关闭', refresh: '刷新',
      hint: '「改」和「删」同时作用于你看到的和模型看到的;「折叠」只收起显示,点一下能展开;「分叉」从这条之前新开一个会话。原文始终留在日志里。',
      role_user: '我', role_assistant: '助手', role_context: '上下文', role_tool: '工具', role_checkpoint: '压缩摘要',
      edit_msg: '改', del_msg: '删除', collapse: '折叠', uncollapse: '取消折叠', fork: '分叉', save: '保存', cancel: '取消',
      edited_badge: '已改', hidden_badge: '已删除', collapsed_badge: '已折叠', shadowed: '已被替换(模型看不到)', off_surface: '模型看不到',
      expand_hint: '点一下展开',
      confirm_ctx: '把这条改成新文本?你和模型看到的一起改,原文仍在日志里。',
      confirm_display_only: '这条只能改你看到的那份(工具结果、压缩摘要或已被替换的消息,模型那份动不了)。继续?',
      confirm_del_display: '这条只能从你的界面上删掉(工具结果、压缩摘要或已被替换的消息,模型那份动不了)。继续?',
      confirm_del: '删掉这条?你和模型都不再看到它,原文仍在日志里。',
      confirm_fork: '从这条之前分叉出一个新会话?', fork_send: '分叉后立即发送编辑框里的内容',
      done: '已完成', failed: '失败:', loading: '读取中…', empty: '没有消息', busy: '处理中…',
      forked: '已分叉出新会话 {id}(在会话列表里打开)', readonly: '子代理会话只读',
      tool_note: '工具结果只能改显示', cp_note: '压缩摘要请在启动器「记忆与上下文」页编辑',
    }
    const EN = {
      open: 'Edit messages', title: 'Message editor', close: 'Close', refresh: 'Refresh',
      hint: 'Edit and delete apply to what you see and what the model sees, together. Collapse only folds it away — click to open it again. Branch starts a new session from before this message. The original always stays in the log.',
      role_user: 'You', role_assistant: 'Assistant', role_context: 'Context', role_tool: 'Tool', role_checkpoint: 'Compaction summary',
      edit_msg: 'Edit', del_msg: 'Delete', collapse: 'Collapse', uncollapse: 'Uncollapse', fork: 'Branch', save: 'Save', cancel: 'Cancel',
      edited_badge: 'edited', hidden_badge: 'deleted', collapsed_badge: 'collapsed', shadowed: 'replaced (model cannot see it)', off_surface: 'model cannot see it',
      expand_hint: 'click to expand',
      confirm_ctx: 'Replace this message? What you see and what the model sees change together; the original stays in the log.',
      confirm_display_only: 'Only your view can change for this one (tool results, summaries and already-replaced messages keep their model copy). Continue?',
      confirm_del_display: 'This one can only be removed from your view (tool results, summaries and already-replaced messages keep their model copy). Continue?',
      confirm_del: 'Delete this message? Neither you nor the model sees it any more; the original stays in the log.',
      confirm_fork: 'Branch a new session from before this message?', fork_send: 'Send the text in the box as the first message of the branch',
      done: 'Done', failed: 'Failed: ', loading: 'Loading…', empty: 'No messages', busy: 'Working…',
      forked: 'Branched into {id} (open it from the session list)', readonly: 'subagent sessions are read-only',
      tool_note: 'tool results can only be changed for display', cp_note: 'compaction summaries are edited on the launcher\'s Memory & context page',
    }
    const zh = String(navigator.language ?? '').toLowerCase().startsWith('zh')
    const t = (key, vars) => { let s = (zh ? ZH : EN)[key] ?? key; for (const [k, v] of Object.entries(vars ?? {})) s = s.split('{' + k + '}').join(String(v)); return s }

    // ── shared state (the DOM half and the React half both read it) ──
    const store = (window.__dshChatEditorStore ??= {
      sessionId: undefined,
      overrides: [],
      open: false,
      focusSeq: undefined,
      listeners: new Set(),
      emit() { for (const fn of [...this.listeners]) { try { fn() } catch { /* a stale subscriber */ } } },
      set(patch) { Object.assign(this, patch); this.emit() },
    })
    function useStore() {
      const [, force] = React.useReducer(x => x + 1, 0)
      React.useEffect(() => { store.listeners.add(force); return () => { store.listeners.delete(force) } }, [force])
      return store
    }

    const api = async (path, body) => {
      const init = body === undefined
        ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const r = await fetch('/dsh-chat-editor' + path, init)
      try { return await r.json() } catch { return { ok: false, message: 'HTTP ' + r.status } }
    }

    // ── display overrides applied to the rendered chat ──
    // `originals` remembers what a text node said before a rewrite touched it — and only then, so
    // nodes this plugin never edited are never written back to. `swapped` marks the nodes whose
    // current content is ours, which is what makes clearing an override actually restore the text.
    const originals = (window.__dshChatEditorOriginals ??= new WeakMap())
    const swapped = (window.__dshChatEditorSwapped ??= new WeakSet())
    // What we last wrote into a swapped node: the restore only fires while the node still says it,
    // so a node the shell recycled into another conversation is left alone.
    const written = (window.__dshChatEditorWritten ??= new WeakMap())
    const hiddenMarks = (window.__dshChatEditorHidden ??= new WeakSet())
    const collapseMarks = (window.__dshChatEditorCollapsed ??= new WeakSet())
    const rowBound = (window.__dshChatEditorBound ??= new WeakSet())
    // Which folded messages the reader clicked open, keyed by the override's original text — not by
    // the DOM node, which the shell recycles across sessions. Pruned in refreshOverrides when the
    // override goes away, so un-collapsing and re-collapsing from the panel folds again.
    const expandedKeys = (window.__dshChatEditorExpanded ??= new Set())

    function overrideFor(text) {
      const raw = String(text ?? '')
      const trimmed = raw.trim()
      for (const o of store.overrides) {
        if (o.original === raw || String(o.original).trim() === trimmed) return o
      }
      return undefined
    }

    const nodeOriginal = n => (originals.has(n) ? originals.get(n) : n.textContent)

    const eq = (a, b) => a === b || String(a).trim() === String(b).trim()

    /**
     * The override a row carries, if any: one of its own text nodes must equal the override's
     * original — the same whole-text rule the rewrite uses. `includes` on the row's textContent
     * is what once let a deleted "好" fold half the transcript.
     */
    function rowOverride(row, want) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        const original = nodeOriginal(n)
        if (String(original).trim().length === 0) continue
        for (const o of store.overrides) {
          if (want(o) && eq(o.original, original)) return o
        }
      }
      return undefined
    }

    /** Swap rewritten text nodes in, and swap them back out when the override is cleared. */
    function applyText(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        const parent = n.parentElement
        if (!parent || parent.closest('textarea, input, [contenteditable="true"], .dsh-ce-panel')) continue
        if (!parent.closest('[data-chat-flow-kind]')) continue
        const original = nodeOriginal(n)
        const hit = overrideFor(original)
        if (hit && hit.hidden !== true && typeof hit.text === 'string' && hit.text.length > 0) {
          if (!originals.has(n)) originals.set(n, original)
          swapped.add(n)
          written.set(n, hit.text)
          if (n.textContent !== hit.text) n.textContent = hit.text
        } else if (swapped.has(n) && n.textContent === written.get(n)) {
          // Ours, and no longer overridden: put the original back. A node that was never ours is
          // never touched — writing first-seen text onto it is what reverted streaming replies.
          swapped.delete(n)
          if (n.textContent !== original) n.textContent = original
        }
      }
    }

    const foldRow = row => {
      collapseMarks.add(row)
      row.dataset.dshChatEditorCollapsed = '1'
      row.style.maxHeight = '46px'
      row.style.overflow = 'hidden'
      row.style.cursor = 'zoom-in'
    }
    const unfoldRow = row => {
      collapseMarks.delete(row)
      delete row.dataset.dshChatEditorCollapsed
      row.style.removeProperty('max-height')
      row.style.removeProperty('overflow')
      row.style.removeProperty('cursor')
    }

    /** Hide deleted rows, fold collapsed ones, and undo both when the override goes. */
    function applyRows(root) {
      // Streaming produces a mutation batch per chunk; with nothing hidden and nothing collapsed
      // (the usual state) there is no reason to walk every row's text nodes on each one.
      const any = store.overrides.some(o => o.hidden === true || o.collapsed === true)
      const rows = root.querySelectorAll?.('[data-chat-flow-kind]') ?? []
      if (!any) {
        for (const row of rows) {
          if (hiddenMarks.has(row)) { hiddenMarks.delete(row); delete row.dataset.dshChatEditorHidden; row.style.removeProperty('display') }
          if (collapseMarks.has(row)) unfoldRow(row)
        }
        return
      }
      for (const row of rows) {
        const hidden = rowOverride(row, o => o.hidden === true)
        if (hidden) {
          if (!hiddenMarks.has(row)) { hiddenMarks.add(row); row.dataset.dshChatEditorHidden = '1'; row.style.display = 'none' }
        } else if (hiddenMarks.has(row)) {
          hiddenMarks.delete(row); delete row.dataset.dshChatEditorHidden; row.style.removeProperty('display')
        }

        const folded = hidden ? undefined : rowOverride(row, o => o.collapsed === true)
        if (folded && !expandedKeys.has(folded.original)) {
          if (!collapseMarks.has(row)) foldRow(row)
          if (!rowBound.has(row)) {
            rowBound.add(row)
            // One listener for the row's whole life; it only acts while the row is folded, so
            // clicks in the expanded state (selecting text, pressing buttons) are untouched.
            row.addEventListener('click', () => {
              if (!collapseMarks.has(row)) return
              const open = rowOverride(row, o => o.collapsed === true)
              if (open) expandedKeys.add(open.original)
              unfoldRow(row)
            })
          }
        } else if (collapseMarks.has(row)) {
          unfoldRow(row)
        }
      }
    }

    let pending = new Set()
    let scheduled = false
    function schedule(root) {
      pending.add(root ?? document.body)
      if (scheduled) return
      scheduled = true
      setTimeout(() => {
        scheduled = false
        const roots = pending; pending = new Set()
        const targets = roots.has(document.body) ? [document.body] : [...roots].filter(r => r.isConnected)
        for (const r of targets) { const el = r.nodeType === 1 ? r : document.body; applyText(r); applyRows(el) }
      }, 16)
    }
    async function refreshOverrides() {
      if (!store.sessionId) { store.set({ overrides: [] }); schedule(); return }
      const d = await api('/overrides?sessionId=' + encodeURIComponent(store.sessionId))
      store.set({ overrides: Array.isArray(d.overrides) ? d.overrides : [] })
      // A key whose override is gone is pruned, so un-collapsing and later re-collapsing from the
      // panel folds the message again instead of finding it pre-expanded forever.
      const live = new Set(store.overrides.filter(o => o.collapsed === true).map(o => o.original))
      for (const key of [...expandedKeys]) { if (!live.has(key)) expandedKeys.delete(key) }
      schedule()
    }
    function startDomHalf() {
      if (window.__dshChatEditorDom) return
      window.__dshChatEditorDom = true
      const mo = new MutationObserver(muts => {
        for (const m of muts) schedule(m.target.nodeType === 1 ? m.target : (m.target.parentElement ?? document.body))
      })
      mo.observe(document.body, { childList: true, subtree: true, characterData: true })
      // any override change (a panel edit, a session switch, another tab) re-applies immediately
      store.listeners.add(() => schedule())
      setInterval(() => { if (store.open === false) refreshOverrides() }, 8000)
    }

    // ── UI ──
    const S = {
      btn: { display: 'inline-flex', alignItems: 'center', gap: '4px', height: '24px', padding: '0 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', cursor: 'pointer' },
      mini: { padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', cursor: 'pointer' },
      overlay: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.45)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      panel: { width: 'min(860px, 92vw)', maxHeight: '84vh', overflow: 'auto', background: 'var(--dsw-alias-bg-layer-1, #1b1b1b)', color: 'var(--dsw-alias-label-primary, #eee)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '12px', padding: '16px', zIndex: 9999, boxShadow: '0 12px 48px rgba(0,0,0,.5)' },
      row: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '10px 12px', marginBottom: '8px' },
      meta: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
      text: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12.5px', margin: '6px 0', maxHeight: '160px', overflow: 'auto' },
      area: { width: '100%', minHeight: '110px', fontFamily: 'inherit', fontSize: '12.5px', padding: '8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2, #111)', color: 'inherit' },
      actions: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' },
      badge: { padding: '0 6px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', fontSize: '10.5px' },
    }

    function MessageRow({ m, sessionId, editable, busy, run, reload }) {
      const [mode, setMode] = React.useState(null)
      const [draft, setDraft] = React.useState(m.text)
      React.useEffect(() => { setDraft(m.text) }, [m.text])
      const roleLabel = t('role_' + m.role)
      const canContext = editable && m.onSurface && m.role !== 'tool' && m.role !== 'checkpoint'
      const note = m.role === 'tool' ? t('tool_note') : m.role === 'checkpoint' ? t('cp_note') : ''
      const close = () => setMode(null)
      const body = mode === null
        ? h('div', { style: S.text }, m.override && m.override.hidden
          ? '—'
          : (m.override && typeof m.override.text === 'string' && m.override.text.length > 0 ? m.override.text : m.text))
        : h('textarea', { style: S.area, value: draft, onChange: e => setDraft(e.target.value) })
      const collapsed = m.override !== undefined && m.override.collapsed === true
      const deleted = m.override !== undefined && m.override.hidden === true
      const actions = mode === null
        ? h('div', { style: S.actions },
          editable ? h('button', { style: S.mini, onClick: () => setMode('edit') }, t('edit_msg')) : null,
          // No undo button: the model's copy is replaced by a record appended to the log, and
          // putting the message back on screen while the model still cannot see it is exactly the
          // split between "your view" and "its view" that this panel no longer has. The original is
          // in the log either way.
          editable && !deleted ? h('button', {
            style: S.mini,
            onClick: () => {
              // The same honesty rule as edit: a tool result or an off-surface row only loses its
              // display half, and the dialog must not promise the model forgot it.
              if (!window.confirm(t(canContext ? 'confirm_del' : 'confirm_del_display'))) return
              return run(async () => {
                // Both views or neither. The model half can refuse (a busy agent, a tool-call pair
                // it must not split); pressing on to the display half would hide the message from
                // the owner while the model still reads it — the exact split this panel removed.
                if (canContext) {
                  const first = await api('/context/delete', { sessionId, seq: m.seq })
                  if (first && first.ok === false) return first
                }
                return api('/display', { sessionId, seq: m.seq, original: m.text, hidden: true })
              })
            },
          }, t('del_msg')) : null,
          editable ? h('button', {
            style: S.mini,
            onClick: () => run(() => api('/display', {
              sessionId, seq: m.seq, original: m.text,
              collapsed: !collapsed,
              ...(m.override && typeof m.override.text === 'string' && m.override.text.length > 0 ? { text: m.override.text } : {}),
              ...(deleted ? { hidden: true } : {}),
            })),
          }, collapsed ? t('uncollapse') : t('collapse')) : null,
          editable && m.forkBoundary !== undefined ? h('button', { style: S.mini, onClick: () => setMode('fork') }, t('fork')) : null,
          note ? h('span', { style: S.meta }, note) : null,
        )
        : h('div', { style: S.actions },
          h('button', {
            style: { ...S.mini, borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' },
            disabled: busy,
            onClick: () => {
              if (mode === 'edit') {
                if (!window.confirm(t(canContext ? 'confirm_ctx' : 'confirm_display_only'))) return
                // One edit, both views. The model's copy is a replacement record appended to the
                // log; the display override is what the page shows. Doing only one of them is what
                // made "display only" and "model context" two settings nobody could tell apart.
                return run(async () => {
                  // Same rule as delete: if the model half refuses, stop — a display-only rewrite
                  // that reports success is worse than an error message.
                  if (canContext) {
                    const first = await api('/context/edit', { sessionId, seq: m.seq, text: draft })
                    if (first && first.ok === false) return first
                  }
                  return api('/display', { sessionId, seq: m.seq, text: draft, original: m.text })
                }, close)
              }
              if (!window.confirm(t('confirm_fork'))) return
              return run(() => api('/fork', { sessionId, seq: m.seq, text: draft }), close)
            },
          }, mode === 'fork' ? t('fork') : t('save')),
          h('button', { style: S.mini, onClick: close }, t('cancel')),
          mode === 'fork' ? h('span', { style: S.meta }, t('fork_send')) : null,
        )
      return h('div', { style: { ...S.row, ...(m.onSurface ? {} : { opacity: .6 }) }, 'data-seq': m.seq },
        h('div', { style: S.meta },
          h('b', null, roleLabel),
          h('span', null, 'seq ' + m.seq),
          m.turn === null ? null : h('span', null, 'turn ' + m.turn),
          m.onSurface ? null : h('span', { style: S.badge }, m.shadowedBy === undefined ? t('off_surface') : t('shadowed')),
          m.override && m.override.hidden ? h('span', { style: S.badge }, t('hidden_badge')) : null,
          m.override && m.override.collapsed ? h('span', { style: S.badge }, t('collapsed_badge')) : null,
          m.override && !m.override.hidden && typeof m.override.text === 'string' && m.override.text.length > 0
            ? h('span', { style: S.badge }, t('edited_badge')) : null,
          h('span', null, m.chars + ' chars'),
        ),
        body,
        actions,
      )
    }

    function Panel({ sessionId }) {
      const s = useStore()
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const reload = React.useCallback(async () => {
        setData(null)
        const d = await api('/messages?sessionId=' + encodeURIComponent(sessionId))
        setData(d)
        await refreshOverrides()
      }, [sessionId])
      React.useEffect(() => { if (s.open) reload() }, [s.open, reload])
      React.useEffect(() => {
        if (!s.open || s.focusSeq === undefined || data === null) return
        const el = document.querySelector('.dsh-ce-panel [data-seq="' + s.focusSeq + '"]')
        if (el) el.scrollIntoView({ block: 'center' })
      }, [s.open, s.focusSeq, data])
      if (!s.open) return null
      const run = async (fn, after) => {
        setBusy(true); setNote(t('busy'))
        try {
          const r = await fn()
          if (r && r.ok === false) setNote(t('failed') + (r.message ?? ''))
          else {
            setNote(r && r.sessionId && r.sessionId !== sessionId ? t('forked', { id: r.sessionId }) : t('done'))
            after?.()
            await reload()
          }
        } catch (error) { setNote(t('failed') + String(error?.message ?? error)) } finally { setBusy(false) }
      }
      const messages = data && Array.isArray(data.messages) ? data.messages : []
      return h('div', { style: S.overlay, onClick: e => { if (e.target === e.currentTarget) store.set({ open: false, focusSeq: undefined }) } },
        h('div', { className: 'dsh-ce-panel', style: S.panel },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
            h('b', null, t('title')),
            h('span', { style: S.meta }, data && data.editable === false ? t('readonly') : ''),
            h('span', { style: { flex: 1 } }),
            h('button', { style: S.mini, onClick: reload, disabled: busy }, t('refresh')),
            h('button', { style: S.mini, onClick: () => store.set({ open: false, focusSeq: undefined }) }, t('close')),
          ),
          h('div', { style: { ...S.meta, marginBottom: '8px' } }, t('hint')),
          note ? h('div', { style: { ...S.meta, marginBottom: '8px' } }, note) : null,
          data === null ? h('div', { style: S.meta }, t('loading'))
            : messages.length === 0 ? h('div', { style: S.meta }, t('empty'))
              : messages.map(m => h(MessageRow, { key: m.seq, m, sessionId, editable: data.editable !== false, busy, run, reload })),
        ),
      )
    }

    /** Session-header entry: publishes the current session id and hosts the panel. */
    function HeaderEntry(props) {
      const sessionId = props.sessionId
      React.useEffect(() => {
        if (sessionId && store.sessionId !== sessionId) { store.set({ sessionId, overrides: [] }); refreshOverrides() }
      }, [sessionId])
      if (!sessionId) return null
      return h(React.Fragment, null,
        h('button', { style: S.btn, title: t('open'), onClick: () => store.set({ open: true, focusSeq: undefined }) }, '✎'),
        h(Panel, { sessionId }),
      )
    }

    /** Inline action on a finished assistant message: open the panel focused on it. */
    function AssistantAction(props) {
      const messageId = props.messageId
      return h('button', {
        style: { ...S.mini, border: 'none', padding: '2px 6px' },
        title: t('open'),
        onClick: async () => {
          const sid = props.sessionId ?? store.sessionId
          if (!sid) return
          const d = await api('/messages?sessionId=' + encodeURIComponent(sid))
          const hit = Array.isArray(d.messages) ? d.messages.find(m => m.messageId === messageId) : undefined
          store.set({ sessionId: sid, open: true, focusSeq: hit ? hit.seq : undefined })
        },
      }, '✎')
    }

    async function apply(ctx) {
      startDomHalf()
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('conversation.session.header.actions', () => slots.register(
        { name: 'conversation.session.header.actions', id: 'chat-editor', order: -4 }, HeaderEntry,
      ))
      slots.inject('conversation.chat.assistant-actions', () => slots.register(
        { name: 'conversation.chat.assistant-actions', id: 'chat-editor', order: 5 }, AssistantAction,
      ))
    }

    exports.apply = apply
    return module.exports
  },
})
