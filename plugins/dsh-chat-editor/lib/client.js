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
    const EMPTY_NODES = Object.freeze([])

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

    // Exact row identity comes from the core's live chat-node projection, never rendered text.
    const expandedKeys = new Set()
    const rowIndex = new Map()
    let overrideGeneration = 0
    let domDisposed = false
    let scheduled = null
    const rowKey = seq => store.sessionId + ':' + seq
    function messageSeq(node) {
      const d = node?.data
      if (['user', 'steering', 'context', 'compaction'].includes(node?.kind)) return d?.seq
      if (node?.kind === 'assistant-step') return d?.status === 'running' ? undefined : d?.finalNode?.seq
      if (node?.kind === 'tool') return d?.root?.kind === 'tool-result' ? d.root.seq : undefined
      if (node?.kind === 'manual-compaction') return d?.compaction?.seq
      return undefined
    }
    function setRows(nodes) {
      rowIndex.clear()
      for (const node of nodes ?? []) {
        const seq = messageSeq(node)
        if (Number.isSafeInteger(seq) && seq >= 0) rowIndex.set(node.key, seq)
      }
      schedule()
    }
    function clearRow(row) {
      for (const key of ['data-dsh-ce-edited', 'data-dsh-ce-hidden', 'data-dsh-ce-collapsed']) row.removeAttribute(key)
      for (const layer of row.querySelectorAll(':scope > [data-dsh-ce-overlay]')) layer.remove()
    }
    function applyRows() {
      const overrides = new Map(store.overrides.map(o => [o.seq, o]))
      for (const row of document.querySelectorAll('[data-chat-flow-key]')) {
        const seq = rowIndex.get(row.getAttribute('data-chat-flow-key'))
        const hit = seq === undefined ? undefined : overrides.get(seq)
        if (!hit) { clearRow(row); continue }
        const flag = (key, enabled) => {
          if (enabled) { if (!row.hasAttribute(key)) row.setAttribute(key, '') }
          else row.removeAttribute(key)
        }
        flag('data-dsh-ce-hidden', hit.hidden === true)
        flag('data-dsh-ce-collapsed', hit.hidden !== true && hit.collapsed === true && !expandedKeys.has(rowKey(seq)))
        const edited = hit.hidden !== true && typeof hit.text === 'string' && hit.text.length > 0
        flag('data-dsh-ce-edited', edited)
        let layer = row.querySelector(':scope > [data-dsh-ce-overlay]')
        if (edited) {
          if (!layer) { layer = document.createElement('div'); layer.setAttribute('data-dsh-ce-overlay', ''); row.appendChild(layer) }
          if (layer.textContent !== hit.text) layer.textContent = hit.text
        } else layer?.remove()
      }
    }
    function schedule() {
      if (domDisposed || scheduled !== null) return
      scheduled = setTimeout(() => { scheduled = null; if (!domDisposed) applyRows() }, 16)
    }
    async function refreshOverrides() {
      const sessionId = store.sessionId
      const generation = ++overrideGeneration
      if (!sessionId) { store.set({ overrides: [] }); schedule(); return }
      const d = await api('/overrides?sessionId=' + encodeURIComponent(sessionId))
      if (domDisposed || generation !== overrideGeneration || store.sessionId !== sessionId) return
      if (!d || d.ok === false || !Array.isArray(d.overrides)) throw new Error(d?.message || 'Cannot read message overrides')
      store.set({ overrides: d.overrides })
      const live = new Set(store.overrides.filter(o => o.collapsed === true).map(o => rowKey(o.seq)))
      for (const key of expandedKeys) if (!live.has(key)) expandedKeys.delete(key)
      schedule()
    }
    function startDomHalf() {
      window.__dshChatEditorDispose?.()
      domDisposed = false
      const style = document.createElement('style')
      style.textContent = '[data-dsh-ce-hidden]{display:none!important}'
        + '[data-dsh-ce-edited]>:not([data-dsh-ce-overlay]){display:none!important}'
        + '[data-dsh-ce-overlay]{white-space:pre-wrap;overflow-wrap:anywhere}'
        + '[data-dsh-ce-collapsed]{max-height:46px!important;overflow:hidden!important;cursor:zoom-in}'
      document.head.appendChild(style)
      const mo = new MutationObserver(schedule)
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-chat-flow-key'] })
      const click = event => {
        const row = event.target.closest?.('[data-dsh-ce-collapsed]')
        if (!row) return
        const seq = rowIndex.get(row.getAttribute('data-chat-flow-key'))
        if (seq !== undefined) { expandedKeys.add(rowKey(seq)); row.removeAttribute('data-dsh-ce-collapsed') }
      }
      document.addEventListener('click', click)
      store.listeners.add(schedule)
      const timer = setInterval(() => { if (!store.open) refreshOverrides().catch(() => {}) }, 8000)
      const dispose = () => {
        domDisposed = true; overrideGeneration++
        mo.disconnect(); clearTimeout(scheduled); scheduled = null; clearInterval(timer)
        document.removeEventListener('click', click); store.listeners.delete(schedule)
        for (const row of document.querySelectorAll('[data-chat-flow-key]')) clearRow(row)
        rowIndex.clear(); expandedKeys.clear(); style.remove()
        if (window.__dshChatEditorDispose === dispose) delete window.__dshChatEditorDispose
      }
      window.__dshChatEditorDispose = dispose
      return dispose
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
      const canContext = editable && !m.contextDeleted && m.onSurface && m.role !== 'tool' && m.role !== 'checkpoint'
      const hasDisplayRow = m.role !== 'tool' || [...rowIndex.values()].includes(m.seq)
      const note = !hasDisplayRow ? (zh ? '此工具结果没有独立显示行，暂不支持显示修改。' : 'This tool result has no independent display row; display edits are unavailable.') : m.role === 'tool' ? t('tool_note') : m.role === 'checkpoint' ? t('cp_note') : ''
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
          editable && !m.contextDeleted && hasDisplayRow ? h('button', { style: S.mini, disabled: busy, onClick: () => setMode('edit') }, t('edit_msg')) : null,
          // No undo button: the model's copy is replaced by a record appended to the log, and
          // putting the message back on screen while the model still cannot see it is exactly the
          // split between "your view" and "its view" that this panel no longer has. The original is
          // in the log either way.
          editable && !deleted && hasDisplayRow ? h('button', {
            style: S.mini,
            disabled: busy,
            onClick: () => {
              // The same honesty rule as edit: a tool result or an off-surface row only loses its
              // display half, and the dialog must not promise the model forgot it.
              if (!window.confirm(t(canContext ? 'confirm_del' : 'confirm_del_display'))) return
              return run(async () => {
                // Context changes have one authoritative log write; display is derived from it.
                if (canContext) return api('/context/delete', { sessionId, seq: m.seq })
                return api('/display', { sessionId, seq: m.seq, original: m.text, hidden: true })
              })
            },
          }, t('del_msg')) : null,
          editable && hasDisplayRow ? h('button', {
            style: S.mini,
            disabled: busy,
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
            style: { ...S.mini, border: '1px solid var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' },
            disabled: busy,
            onClick: () => {
              if (mode === 'edit') {
                if (!window.confirm(t(canContext ? 'confirm_ctx' : 'confirm_display_only'))) return
                return run(async () => {
                  if (canContext) return api('/context/edit', { sessionId, seq: m.seq, text: draft })
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
      const requestVersion = React.useRef(0)
      const lifecycle = React.useRef(0)
      const activeAction = React.useRef(false)
      const reload = React.useCallback(async () => {
        const version = ++requestVersion.current
        setData(null)
        const d = await api('/messages?sessionId=' + encodeURIComponent(sessionId))
        if (version !== requestVersion.current || sessionId !== store.sessionId) return
        setData(d)
        await refreshOverrides()
      }, [sessionId])
      React.useEffect(() => {
        const epoch = ++lifecycle.current
        activeAction.current = false; setBusy(false); setNote('')
        if (s.open) reload().catch(error => { if (lifecycle.current === epoch) setNote(t('failed') + String(error?.message ?? error)) })
        return () => { requestVersion.current++; lifecycle.current++ }
      }, [s.open, reload])
      React.useEffect(() => {
        if (!s.open || s.focusSeq === undefined || data === null) return
        const el = document.querySelector('.dsh-ce-panel [data-seq="' + s.focusSeq + '"]')
        if (el) el.scrollIntoView({ block: 'center' })
      }, [s.open, s.focusSeq, data])
      if (!s.open) return null
      const run = async (fn, after) => {
        if (activeAction.current) return
        activeAction.current = true
        const epoch = lifecycle.current
        const current = () => epoch === lifecycle.current && sessionId === store.sessionId
        setBusy(true); setNote(t('busy'))
        try {
          const r = await fn()
          if (!current()) return
          if (r && r.ok === false) setNote(t('failed') + (r.message ?? ''))
          else {
            setNote(r && r.sessionId && r.sessionId !== sessionId ? t('forked', { id: r.sessionId }) : t('done'))
            after?.()
            await reload()
          }
        } catch (error) { if (current()) setNote(t('failed') + String(error?.message ?? error)) } finally { if (current()) { activeAction.current = false; setBusy(false) } }
      }
      const messages = data && Array.isArray(data.messages) ? data.messages : []
      return h('div', { style: S.overlay, onClick: e => { if (e.target === e.currentTarget) store.set({ open: false, focusSeq: undefined }) } },
        h('div', { className: 'dsh-ce-panel', style: S.panel },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
            h('b', null, t('title')),
            h('span', { style: S.meta }, data && data.editable === false ? t('readonly') : ''),
            h('span', { style: { flex: 1 } }),
            h('button', { style: S.mini, onClick: () => run(async () => ({ ok: true })), disabled: busy }, t('refresh')),
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
      const nodes = props.useSession(snapshot => snapshot.chat?.nodes?.values() ?? EMPTY_NODES)
      React.useEffect(() => {
        if (sessionId && store.sessionId !== sessionId) {
          overrideGeneration++
          rowIndex.clear(); expandedKeys.clear()
          store.set({ sessionId, overrides: [], open: false, focusSeq: undefined })
          refreshOverrides().catch(() => {})
        }
        return () => {
          if (store.sessionId === sessionId) { overrideGeneration++; rowIndex.clear(); store.set({ sessionId: undefined, overrides: [], open: false }); schedule() }
        }
      }, [sessionId])
      React.useEffect(() => { if (store.sessionId === sessionId) setRows(nodes) }, [sessionId, nodes])
      if (!sessionId) return null
      return h(React.Fragment, null,
        h('button', { style: S.btn, title: t('open'), onClick: () => store.set({ open: true, focusSeq: undefined }) }, '✎'),
        h(Panel, { sessionId }),
      )
    }

    /** Inline action on a finished assistant message: open the panel focused on it. */
    function AssistantAction(props) {
      const messageId = props.messageId
      const version = React.useRef(0)
      React.useEffect(() => () => { version.current++ }, [props.sessionId])
      return h('button', {
        style: { ...S.mini, border: 'none', padding: '2px 6px' },
        title: t('open'),
        onClick: async () => {
          const sid = props.sessionId ?? store.sessionId
          if (!sid) return
          const request = ++version.current
          let d
          try { d = await api('/messages?sessionId=' + encodeURIComponent(sid)) }
          catch { if (request === version.current && store.sessionId === sid) store.set({ open: true, focusSeq: undefined }); return }
          if (request !== version.current || store.sessionId !== sid) return
          const hit = Array.isArray(d.messages) ? d.messages.find(m => m.messageId === messageId) : undefined
          store.set({ sessionId: sid, open: true, focusSeq: hit ? hit.seq : undefined })
        },
      }, '✎')
    }

    async function apply(ctx) {
      ctx.effect(startDomHalf, 'chat-editor: display lifecycle')
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
    // Declared so the client runner mounts this half after the slots service exists (0.1.5 orders by inject).
    exports.inject = ['slots']
    return module.exports
  },
})
