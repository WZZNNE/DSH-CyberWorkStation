/**
 * dsh-temp-chat browser half: a "＋ temp chat" button in the sidebar footer that creates a
 * project-free conversation (scratch directory + chat-only preset) and opens it. The host
 * plugin owns the session; this only asks for one and switches to it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-temp-chat',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const zh = String(navigator.language ?? '').toLowerCase().startsWith('zh')
    const T = {
      label: zh ? '临时对话' : 'Temp chat',
      title: zh ? '新建一个不属于任何项目的临时对话(草稿目录,无文件/终端工具)' : 'Start a conversation that belongs to no project (scratch directory, no file / shell tools)',
      busy: zh ? '创建中…' : 'Creating…',
      failed: zh ? '创建失败:' : 'Failed: ',
      created: zh ? '已创建临时对话(在「临时对话」工作区里)' : 'Temp chat created (in the "Temporary chats" workspace)',
      waiting: zh ? '已创建，等待会话列表…' : 'Created; waiting for the session list…',
      notOpened: zh ? '已创建但未打开，会话 ID：' : 'Created but not opened. Session ID: ',
      retryOpen: zh ? '打开已创建的对话' : 'Open the created chat',
    }
    // A hover state of its own. Without one the button inherits whatever the shell paints on a
    // bare <button>, which is a transition on box-shadow and filter — enough to look like a flicker
    // when anything next to it repaints while the cursor is resting here.
    // An icon, not a label. That footer is one non-wrapping row shared with the cost meter and the
    // pet: a text button there is squeezed to two characters and reads as a different design.
    const style = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', flex: 'none', padding: 0, borderRadius: '8px', border: '1px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '14px', lineHeight: '30px', cursor: 'pointer', transition: 'none' }
    const hoverStyle = { ...style, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)' }

    function TempChatButton(props) {
      // the runtime hands out selector hooks (bind.ts): a bare call has no selector to run
      const sessions = props.useSessions(s => s)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [hover, setHover] = React.useState(false)
      const [pendingId, setPendingId] = React.useState(null)
      const [createdId, setCreatedId] = React.useState(null)
      const operation = React.useRef(null)
      const mounted = React.useRef(true)
      React.useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false; operation.current?.controller?.abort(); clearTimeout(operation.current?.timer); operation.current = null }
      }, [])
      const finishNavigation = (op, opened) => {
        if (!mounted.current || operation.current !== op) return
        clearTimeout(op.timer)
        operation.current = null
        setPendingId(null); setBusy(false)
        setNote(opened ? T.created : T.notOpened + op.id)
        if (opened) setCreatedId(null)
      }
      React.useEffect(() => {
        const op = operation.current
        if (!op) return
        if (sessions.current !== op.startCurrent && sessions.current !== op.id) {
          op.cancelNavigation = true
          if (op.id) finishNavigation(op, false)
          return
        }
        if (!pendingId || !sessions.byId?.[pendingId]) return
        try { props.openSession(pendingId); finishNavigation(op, true) }
        catch { finishNavigation(op, false) }
      }, [pendingId, sessions.current, sessions.byId, props.openSession])
      const awaitNavigation = op => {
        setCreatedId(op.id)
        if (op.cancelNavigation) { finishNavigation(op, false); return }
        setNote(T.waiting)
        setPendingId(op.id)
        op.timer = setTimeout(() => finishNavigation(op, false), 10000)
      }
      // The note is a fixed-position popup: without a timer it would sit over the sidebar forever.
      React.useEffect(() => {
        if (!note) return undefined
        const timer = setTimeout(() => setNote(''), 5000)
        return () => clearTimeout(timer)
      }, [note])
      const onClick = async () => {
        if (operation.current) return
        const op = { startCurrent: sessions.current, controller: new AbortController() }
        operation.current = op
        setBusy(true); setNote('')
        try {
          const response = await fetch('/dsh-temp-chat/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: op.controller.signal })
          const r = await response.json()
          if (!mounted.current || operation.current !== op) return
          if (!response.ok || r.ok === false || typeof r.sessionId !== 'string' || !r.sessionId) throw new Error(r.message || 'Invalid session creation response')
          op.id = r.sessionId
          awaitNavigation(op)
        } catch (error) {
          if (mounted.current && operation.current === op) { operation.current = null; setBusy(false); setNote(T.failed + String(error?.message ?? error)) }
        } finally { if (mounted.current) setHover(false) }
      }
      return h('div', { style: { flex: 'none' } },
        h('button', {
          style: hover && !busy ? hoverStyle : style, title: T.label + ' — ' + T.title, disabled: busy, onClick,
          onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
        }, busy ? '…' : h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { display: 'block', margin: 'auto' } }, h('path', { d: 'M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z' }), h('path', { d: 'M14 4v4h4' }), h('path', { d: 'M9 12h6M9 15.5h4' }), h('path', { d: 'M17.5 16.5l2 2-3.5 3.5h-2v-2z' }))),
        note ? h('div', { style: { position: 'fixed', left: '12px', bottom: '52px', maxWidth: '220px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '6px 8px', zIndex: 40 } }, note) : null,
        createdId && !busy ? h('button', { style: { ...style, width: 'auto' }, title: createdId, onClick: () => {
          if (operation.current) return
          const op = { id: createdId, startCurrent: sessions.current }
          operation.current = op; setBusy(true); awaitNavigation(op)
        } }, T.retryOpen) : null,
      )
    }

    async function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'temp-chat', order: 5, inject: () => ({ openSession: id => ctx.sessions.open(id) }) }, TempChatButton,
      ))
    }

    exports.apply = apply
    exports.inject = ['slots', 'sessions']
    return module.exports
  },
})
