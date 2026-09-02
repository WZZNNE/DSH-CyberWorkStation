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
    }
    // A hover state of its own. Without one the button inherits whatever the shell paints on a
    // bare <button>, which is a transition on box-shadow and filter — enough to look like a flicker
    // when anything next to it repaints while the cursor is resting here.
    // An icon, not a label. That footer is one non-wrapping row shared with the cost meter and the
    // pet: a text button there is squeezed to two characters and reads as a different design.
    const style = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', flex: 'none', padding: 0, borderRadius: '8px', border: '1px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '14px', lineHeight: '30px', cursor: 'pointer', transition: 'none' }
    const hoverStyle = { ...style, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)' }

    function TempChatButton(props) {
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [hover, setHover] = React.useState(false)
      // The note is a fixed-position popup: without a timer it would sit over the sidebar forever.
      React.useEffect(() => {
        if (!note) return undefined
        const timer = setTimeout(() => setNote(''), 5000)
        return () => clearTimeout(timer)
      }, [note])
      const onClick = async () => {
        setBusy(true); setNote('')
        try {
          const r = await fetch('/dsh-temp-chat/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(x => x.json())
          if (r.ok === false) { setNote(T.failed + (r.message ?? '')); return }
          setNote(T.created)
          // The session is published by the host; ask the shell to open it when it exposes a way to.
          const open = props.openSession ?? props.actions?.openSession
          if (typeof open === 'function') open(r.sessionId)
        } catch (error) { setNote(T.failed + String(error?.message ?? error)) } finally { setBusy(false); setHover(false) }
      }
      return h('div', { style: { flex: 'none' } },
        h('button', {
          style: hover && !busy ? hoverStyle : style, title: T.label + ' — ' + T.title, disabled: busy, onClick,
          onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
        }, busy ? '…' : h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { display: 'block', margin: 'auto' } }, h('path', { d: 'M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z' }), h('path', { d: 'M14 4v4h4' }), h('path', { d: 'M9 12h6M9 15.5h4' }), h('path', { d: 'M17.5 16.5l2 2-3.5 3.5h-2v-2z' }))),
        note ? h('div', { style: { position: 'fixed', left: '12px', bottom: '52px', maxWidth: '220px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '6px 8px', zIndex: 40 } }, note) : null,
      )
    }

    async function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'temp-chat', order: 5 }, TempChatButton,
      ))
    }

    exports.apply = apply
    return module.exports
  },
})
