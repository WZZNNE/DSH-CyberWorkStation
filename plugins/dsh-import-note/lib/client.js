/**
 * dsh-import-note browser half: a card under Settings → Plugins ("插件配置"), the same slot the
 * community plugins use for their cards, saying what the session importer does with a source
 * transcript's system prompt. Collapsible like its neighbours; follows the dsh UI language; shown
 * only while the importer's own namespace (`chat-import`) is served — without the importer there
 * is nothing to explain.
 */
window.__ModuleLoader__.load({
  id: 'dsh-import-note',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const NS = 'import-note'
    const IMPORTER_NS = 'chat-import'
    const DICT = {
      zh: {
        title: '会话导入 · 系统提示词',
        subtitle: '导入的会话不会覆盖 dsh 或任何插件的系统提示词。',
        body: [
          '侧栏「导入会话」(社区插件 dsh-chat-import)默认丢弃源记录里的 system / developer 提示词。',
          '打开它设置页里的「导入系统提示词」(设置 → 会话导入)后,那段提示词也只会跟在一条「环境变更提示」后面,作为导入会话历史里的一条「上下文注入 · chat-import」消息保留。',
          'dsh 本体、控制甲板、多媒体、桌宠等注入的系统提示词照常生效,不会被替换或覆盖。',
        ],
        why: '这句话放在这里而不是导入插件自己的设置页:那一页属于社区插件,页内没有可插入的位置。',
        source: '依据:dsh-chat-import 0.8.2 lib/import-prefs.mjs(开关默认关)、lib/convert/core.mjs contextInjectionText / synthesizeSession(写成一条 user/message 事件,source.kind = plugin)。',
      },
      en: {
        title: 'Session import · system prompt',
        subtitle: 'An imported session never overrides the system prompt of dsh or of any plugin.',
        body: [
          'The sidebar "Import sessions" (community plugin dsh-chat-import) drops the source transcript\'s system / developer prompts by default.',
          'With its "import system prompt" switch on (Settings → Session import), that prompt is kept only as one "context injection · chat-import" message inside the imported session\'s own history, after an environment-changed notice.',
          'The prompts injected by dsh itself, the control deck, the media lab or the desktop pet stay in force; nothing is replaced.',
        ],
        why: 'It sits here rather than on the importer\'s own settings page because that page belongs to the community plugin and has no place to insert a line.',
        source: 'Source: dsh-chat-import 0.8.2 lib/import-prefs.mjs (switch defaults to off), lib/convert/core.mjs contextInjectionText / synthesizeSession (one user/message event, source.kind = plugin).',
      },
    }
    const S = {
      card: { listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-3)', overflow: 'hidden' },
      head: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left', font: 'inherit' },
      headText: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 },
      name: { fontSize: '15px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      sub: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' },
      chevron: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s' },
      body: { padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '6px' },
      list: { fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-primary)', margin: 0, paddingLeft: '18px' },
      why: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      src: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
    }
    const activeLocale = ctx => {
      try { const a = ctx?.locale?.getSnapshot?.().active; if (typeof a === 'string' && a) return a } catch { /* browser language below */ }
      return String(navigator.language ?? '')
    }
    /** The namespaces the host serves, from the shared describe mirror; null when unknown (then the card shows). */
    const servedNamespaces = ctx => {
      try {
        const face = ctx?.settingsScope?.describe?.()
        const snap = typeof face?.getSnapshot === 'function' ? face.getSnapshot() : face
        const list = snap?.view?.namespaces ?? snap?.namespaces
        return Array.isArray(list) ? list.map(v => (typeof v === 'string' ? v : v?.ns)).filter(Boolean) : null
      } catch { return null }
    }
    function Card({ ctx }) {
      const [locale, setLocale] = React.useState(() => activeLocale(ctx))
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => (ctx?.locale?.subscribe ? ctx.locale.subscribe(() => setLocale(activeLocale(ctx))) : undefined), [ctx])
      const served = servedNamespaces(ctx)
      if (Array.isArray(served) && !served.includes(IMPORTER_NS)) return null
      const T = locale.toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
      return h('li', { style: S.card },
        h('button', { type: 'button', style: S.head, 'aria-expanded': open, onClick: () => setOpen(v => !v) },
          h('span', { style: S.headText }, h('span', { style: S.name }, T.title), h('span', { style: S.sub }, T.subtitle)),
          h('span', { style: { ...S.chevron, transform: open ? 'rotate(90deg)' : 'none' }, 'aria-hidden': 'true' }, '›')),
        open ? h('div', { style: S.body },
          h('ul', { style: S.list }, ...T.body.map((line, i) => h('li', { key: i }, line))),
          h('div', { style: S.src }, T.source)) : null)
    }
    async function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.plugin.item', () => slots.register({ name: 'settings.plugin.item', key: NS, inject: () => ({ ctx }) }, () => h(Card, { ctx })))
    }
    exports.apply = apply
    exports.inject = ['slots', 'locale', 'settingsScope']
    return module.exports
  },
})
