/**
 * dsh-credentials-center browser half: the Credentials Center section in dsh Settings — every
 * credential reference with status and bindings, alias / note, set / replace / delete inline; the
 * "refresh the model list" button (dsh-provider-sync) and dsh's own default model (route → model).
 */
window.__ModuleLoader__.load({
  id: 'dsh-credentials-center',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const DICT = {
      zh: {
        title: '凭据中心', hint: '这里列出 dsh 本体与套件插件用到的每一个 API 凭据引用(环境变量名):是否已配置、存在哪里、绑定在哪些功能上;可以起别名、写备注,也可以在这里新增、替换或删除密钥。密钥值走 dsh 的凭据服务(装了凭据钥匙串插件就是 Windows 凭据管理器),从不写进普通文件。',
        feature: { 'model-route': '对话模型路由', media: '多媒体 API', 'web-search': '联网搜索', 'desktop-pet': '桌宠', 'memory-embeddings': '记忆向量' },
        detail: d => d.replace(' · borrows route ', ' · 借用路由 ').replace(' · own endpoint', ' · 自有端点').replace(' · follows dsh default', ' · 跟随 dsh 默认').replace(' (selected)', '(当前选用)').replace(' (off)', '(已关闭)').replace(/ · (\d+) models?$/, ' · $1 个模型'),
        ref: '引用名', alias: '别名', status: '状态', bound: '绑定', set: '设置 / 替换', unset: '删除', save: '保存', cancel: '取消', ok: '已配置', missing: '未配置', unknown: '未知', source: s => `来源:${s}`, readonly: '(只读)', value: '新的密钥值', confirmUnset: r => `删除凭据 ${r}?用到它的功能会立刻失去密钥。`, added: '已保存', removed: '已删除', failed: '失败:', add: '+ 添加一个新的引用', addRef: '引用名(如 MY_API_KEY)', none: '还没有任何绑定', aliasPh: '别名', notePh: '备注', refresh: '刷新', exists: '这个引用已经在列表里', forget: '移除引用', confirmForget: r => `把 ${r} 从列表里移除?只删除别名/备注记录,不动凭据库。`, storeGone: '凭据服务不可用,只能查看绑定。', loadFailed: '读取失败:', empty: '还没有任何凭据引用。',
        spares: n => (n > 0 ? `备用密钥 (${n})` : '备用密钥'), sparesTitle: '备用密钥', sparesHint: '同一个引用可以存多把密钥;「启用」把它换成正式密钥,被换下的那把自动留作备用,不会丢。', spareNone: '还没有备用密钥。', spareUse: '启用', spareRename: '改名', spareRemove: '删除', spareActive: '当前使用', spareKeep: '把当前密钥存为备用', spareAdd: '添加备用密钥', spareLabel: '标签(如 团队 key / 备用 2)', spareValue: '密钥值', spareSaved: '已保存', spareUsed: '已启用,原密钥已留作备用', spareUsedKeptNone: '已启用', spareConfirmRemove: l => `删除备用密钥「${l}」?`, spareMissing: '(密钥库里已没有这条记录)', spareKeepExists: '当前密钥已经在备用列表里', rename: '新标签', spareKeepLabel: '标签(给当前密钥起个名)', slotLabel: l => String(l).replace(/^previous (\S+ \S+)$/, '原密钥 $1').replace(/^kept (\S+ \S+)$/, '留存 $1').replace(/^spare (\d+)$/, '备用 $1'), filterPh: '过滤引用名 / 别名 / 功能', boundOnly: '只看有绑定的', noMatch: '没有匹配的引用。',
        syncTitle: '模型清单', syncBtn: '刷新模型清单', syncing: '刷新中…', syncLast: '上次同步', never: '从未', syncResult: r => `清单共 ${r.models} 个(可推理 ${r.reasoning})· 本次新增 ${r.added}、改动 ${r.updated}${r.noted ? `(其中 Claude 提示 ${r.noted})` : ''}`, syncNone: '没有带自有清单的 OpenRouter 路由', syncHint: '从 openrouter.ai 拉取最新模型清单,写进 OpenRouter 路由(新模型入表、名称/上下文/输出上限刷新、可推理模型写入思考强度档位);手改过的字段不动。',
        defaultTitle: 'dsh 默认模型', defaultHint: '新会话默认使用的路由和模型(settings 命名空间 agent-default-model);启动器「凭据中心」页和这里写的是同一处。注意:在任何会话里切换模型,dsh 本体都会把这里改写成那个模型(桌宠「跟随」也随之变),改完记得回来看一眼。', route: 'API 路由', model: '模型', applyDefault: '设为 dsh 默认', applied: '已写入 agent-default-model', current: (p, m) => `当前:${p || '—'} / ${m || '—'}`, noRoutes: '还没有配置任何模型路由,先去「模型」页添加。', noModels: '这个路由没有模型清单,可直接填写模型 id。', unlisted: '允许清单外的模型 id(会同时加进该路由的模型清单;没有自有清单的路由不能这样加)', fixedSet: '这条路由的模型是固定的一组,只能从清单里选',
      },
      en: {
        title: 'Credentials', hint: 'Every API credential reference (env-style name) the harness and the suite use: configured or not, where it is stored, which features are bound to it; give it an alias and a note, add / replace / delete the secret here. Values go through the dsh credential service (the Windows Credential Manager with the keyring plugin), never a plain file.',
        feature: { 'model-route': 'model route', media: 'media API', 'web-search': 'web search', 'desktop-pet': 'desktop pet', 'memory-embeddings': 'memory embeddings' },
        detail: d => d,
        ref: 'Reference', alias: 'Alias', status: 'Status', bound: 'Bound to', set: 'Set / replace', unset: 'Delete', save: 'Save', cancel: 'Cancel', ok: 'configured', missing: 'not configured', unknown: 'unknown', source: s => `source: ${s}`, readonly: '(read-only)', value: 'New secret value', confirmUnset: r => `Delete credential ${r}? Every feature bound to it loses its key at once.`, added: 'Saved', removed: 'Deleted', failed: 'Failed: ', add: '+ Add a new reference', addRef: 'Reference (e.g. MY_API_KEY)', none: 'no bindings yet', aliasPh: 'alias', notePh: 'note', refresh: 'Refresh', exists: 'That reference is already listed', forget: 'Forget reference', confirmForget: r => `Remove ${r} from the list? Only the alias / note record goes; the credential store is untouched.`, storeGone: 'The credential service is unavailable: bindings only.', loadFailed: 'Could not load: ', empty: 'No credential references yet.',
        spares: n => (n > 0 ? `Spare keys (${n})` : 'Spare keys'), sparesTitle: 'Spare keys', sparesHint: 'One reference can hold several secrets; "Use" makes one the secret in force, and the one it replaces is kept as a spare — nothing is lost.', spareNone: 'No spare keys yet.', spareUse: 'Use', spareRename: 'Rename', spareRemove: 'Delete', spareActive: 'in use', spareKeep: 'Keep the current secret as a spare', spareAdd: 'Add a spare key', spareLabel: 'Label (e.g. team key / spare 2)', spareValue: 'Secret value', spareSaved: 'Saved', spareUsed: 'In use; the previous secret was kept as a spare', spareUsedKeptNone: 'In use', spareConfirmRemove: l => `Delete the spare key "${l}"?`, spareMissing: '(no record in the store any more)', spareKeepExists: 'The current secret is already a spare', rename: 'New label', spareKeepLabel: 'Label for the current secret', slotLabel: l => String(l), filterPh: 'Filter by reference / alias / feature', boundOnly: 'Bound only', noMatch: 'No reference matches.',
        syncTitle: 'Model list', syncBtn: 'Refresh model list', syncing: 'Refreshing…', syncLast: 'Last sync', never: 'never', syncResult: r => `${r.models} models listed (${r.reasoning} with reasoning levels) · this run: ${r.added} added, ${r.updated} changed${r.noted ? ` (${r.noted} Claude notes)` : ''}`, syncNone: 'no OpenRouter route with a model list of its own', syncHint: 'Pulls the current model catalog from openrouter.ai into the OpenRouter routes (new models added, names / context / output limits refreshed, reasoning levels declared); hand-edited fields are left alone.',
        defaultTitle: 'dsh default model', defaultHint: 'The route and model new sessions start with (settings namespace agent-default-model); the launcher\'s Credentials page and this section write the same value. Note: switching the model inside any session makes dsh itself rewrite this value (and the pet that follows it).', route: 'API route', model: 'Model', applyDefault: 'Set as dsh default', applied: 'Written to agent-default-model', current: (p, m) => `Current: ${p || '—'} / ${m || '—'}`, noRoutes: 'No model route is configured yet; add one on the Models page first.', noModels: 'This route lists no models; type a model id.', unlisted: 'Allow a model id outside the list (it is added to the route list too; a route without a list of its own cannot take one)', fixedSet: 'This route offers a fixed set of models; pick one from the list',
      },
    }
    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '12px' },
      block: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px' },
      h: { fontSize: '13px', fontWeight: 600 },
      hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: 1.5 },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      input: { padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'inherit', fontSize: '12.5px' },
      btn: { padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '12px' },
      primary: { borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' },
      danger: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      ok: { color: 'var(--dsw-alias-state-success-primary)' }, bad: { color: 'var(--dsw-alias-state-error-primary)' }, dim: { color: 'var(--dsw-alias-label-secondary)' },
      chip: { display: 'inline-block', padding: '1px 6px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', marginRight: '4px', marginBottom: '2px' },
      card: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))', background: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2))' },
      cardTop: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      cardActions: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginLeft: 'auto' },
      spares: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', borderRadius: '8px', border: '1px dashed var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))' },
      spareRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    }
    const jsonOf = async r => { try { return await r.json() } catch { return { ok: false, message: 'HTTP ' + r.status } } }
    /** One stylesheet for the suite's sections: inline styles cannot express :disabled. */
    function ensureSuiteStyle() {
      if (document.getElementById('dsh-suite-style')) return
      const style = document.createElement('style')
      style.id = 'dsh-suite-style'
      style.textContent = '.dsh-suite button:disabled { opacity: .45; cursor: not-allowed }'
        + 'select option, select optgroup { background: var(--dsw-alias-bg-layer-2, #1c1f28); color: var(--dsw-alias-label-primary, #e8ecf5) }'
        + 'select option:checked { background: var(--dsw-alias-state-business-tertiary, rgba(106,163,255,.18)) }'
      document.head.appendChild(style)
    }
    async function api(base, path, body) {
      const r = await fetch(base + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return jsonOf(r)
    }
    const creds = (path, body) => api('/dsh-credentials-center', path, body)
    const sync = (path, body) => api('/dsh-provider-sync', path, body)

    function useT(ctx) {
      const [locale, setLocale] = React.useState(() => activeLocale(ctx))
      React.useEffect(() => (ctx?.locale?.subscribe ? ctx.locale.subscribe(() => setLocale(activeLocale(ctx))) : undefined), [ctx])
      return locale.toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
    }
    function activeLocale(ctx) {
      try { const a = ctx?.locale?.getSnapshot?.().active; if (typeof a === 'string' && a) return a } catch { /* browser language below */ }
      return String(navigator.language ?? '')
    }
    const onKeys = (onEnter, onEscape) => e => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } else if (e.key === 'Escape') { e.preventDefault(); onEscape?.() } }

    /** The spare secrets of one reference: list, use, rename, delete, keep the current one, add a new one. */
    function SparePanel({ T, row, reload, setNote }) {
      const [view, setView] = React.useState(null)
      const [label, setLabel] = React.useState('')
      const [value, setValue] = React.useState('')
      const [keepLabel, setKeepLabel] = React.useState('')
      const load = () => api('/dsh-credentials-center', '/slots?ref=' + encodeURIComponent(row.ref)).then(setView).catch(error => setView({ ok: false, message: String(error?.message ?? error) }))
      React.useEffect(() => { load() }, [row.ref])
      const act = async (path, body, okText) => {
        const r = await creds('/slots/' + path, { ref: row.ref, ...body })
        if (r.ok === false) { setNote(T.failed + (r.message ?? '')); return null }
        setView(r)
        if (okText) setNote(okText)
        reload()
        return r
      }
      const disabled = row.writable === false
      if (view === null) return h('div', { style: S.spares }, h('div', { style: S.dim }, '…'))
      if (view.ok === false) return h('div', { style: S.spares }, h('div', { style: S.bad }, T.loadFailed + (view.message ?? '')))
      return h('div', { style: S.spares },
        h('div', { style: { fontWeight: 600 } }, T.sparesTitle),
        h('div', { style: S.hint }, T.sparesHint),
        view.slots.length === 0 ? h('div', { style: S.dim }, T.spareNone) : view.slots.map(sl => h('div', { key: sl.id, style: S.spareRow },
          h('span', { style: { color: sl.id === view.activeSlot ? 'var(--dsw-alias-state-success-primary)' : 'inherit' } }, (sl.id === view.activeSlot ? '● ' : '○ ') + T.slotLabel(sl.label)),
          h('span', { style: S.dim }, sl.createdAt ? sl.createdAt.slice(0, 10) : ''),
          sl.id === view.activeSlot ? h('span', { style: S.chip }, T.spareActive) : null,
          sl.configured === false ? h('span', { style: S.bad }, T.spareMissing) : null,
          h('span', { style: S.cardActions },
            h('button', { style: { ...S.btn, ...S.primary }, disabled: disabled || sl.id === view.activeSlot || sl.configured === false, onClick: async () => { const r = await act('use', { id: sl.id }); if (r) setNote(r.kept ? T.spareUsed : T.spareUsedKeptNone) } }, T.spareUse),
            h('button', { style: S.btn, onClick: async () => { const shown = T.slotLabel(sl.label); const next = window.prompt(T.rename, shown); if (next === null || !next.trim() || next.trim() === shown) return; await act('rename', { id: sl.id, label: next.trim() }, T.spareSaved) } }, T.spareRename),
            h('button', { style: { ...S.btn, ...S.danger }, disabled, onClick: async () => { if (!window.confirm(T.spareConfirmRemove(T.slotLabel(sl.label)))) return; await act('remove', { id: sl.id }, T.removed) } }, T.spareRemove)))),
        row.configured === true ? h('div', { style: S.spareRow },
          h('input', { style: { ...S.input, width: '180px' }, placeholder: T.spareKeepLabel, value: keepLabel, onChange: e => setKeepLabel(e.target.value), onKeyDown: onKeys(async () => { if (disabled) return; const r = await act('keep', { label: keepLabel }); if (r) { setNote(r.existed ? T.spareKeepExists : T.spareSaved); setKeepLabel('') } }) }),
          h('button', { style: S.btn, disabled, onClick: async () => { const r = await act('keep', { label: keepLabel }); if (r) { setNote(r.existed ? T.spareKeepExists : T.spareSaved); setKeepLabel('') } } }, T.spareKeep)) : null,
        h('div', { style: S.spareRow },
          h('input', { style: { ...S.input, width: '180px' }, placeholder: T.spareLabel, value: label, onChange: e => setLabel(e.target.value), onKeyDown: onKeys(async () => { if (disabled || !value.trim()) return; const r = await act('add', { label, value }, T.spareSaved); if (r) { setLabel(''); setValue('') } }) }),
          h('input', { style: { ...S.input, width: '220px' }, type: 'password', autoComplete: 'off', placeholder: T.spareValue, value, onChange: e => setValue(e.target.value), onKeyDown: onKeys(async () => { if (disabled || !value.trim()) return; const r = await act('add', { label, value }, T.spareSaved); if (r) { setLabel(''); setValue('') } }) }),
          h('button', { style: { ...S.btn, ...S.primary }, disabled: disabled || !value.trim(), onClick: async () => { const r = await act('add', { label, value }, T.spareSaved); if (r) { setLabel(''); setValue('') } } }, T.spareAdd)))
    }

    function Row({ T, row, reload }) {
      // Feedback lands on the card that acted, not at the end of a list that may be scrolled away.
      const [feedback, setFeedback] = React.useState('')
      React.useEffect(() => { if (!feedback) return undefined; const t = setTimeout(() => setFeedback(''), 5000); return () => clearTimeout(t) }, [feedback])
      const setNote = setFeedback
      const [editing, setEditing] = React.useState(false)
      const [value, setValue] = React.useState('')
      const [alias, setAlias] = React.useState(row.alias)
      const [note, setNoteText] = React.useState(row.note)
      const [spares, setSpares] = React.useState(false)
      React.useEffect(() => { setAlias(row.alias); setNoteText(row.note) }, [row.alias, row.note])
      const saving = React.useRef(false)
      const saveAlias = async () => {
        if (saving.current) return
        saving.current = true
        try { const r = await creds('/alias', { ref: row.ref, alias, note }); setNote(r.ok === false ? T.failed + (r.message ?? '') : T.added); reload() } finally { saving.current = false }
      }
      const saveValue = async () => { const r = await creds('/set', { ref: row.ref, value }); setNote(r.ok === false ? T.failed + (r.message ?? '') : T.added); setValue(''); setEditing(false); reload() }
      const cancel = () => { setEditing(false); setValue('') }
      const status = row.configured === true ? h('span', { style: S.ok }, '● ' + T.ok) : row.configured === false ? h('span', { style: S.bad }, '○ ' + T.missing) : h('span', { style: S.dim }, T.unknown + (row.error ? ' · ' + row.error : ''))
      return h('div', { style: S.card, 'data-ref': row.ref },
        h('div', { style: S.cardTop },
          h('code', { style: { fontWeight: 600 } }, row.ref),
          status,
          row.source ? h('span', { style: S.dim }, T.source(row.source)) : null,
          row.writable === false ? h('span', { style: S.dim }, T.readonly) : null,
          h('span', { style: S.cardActions },
            editing
              ? h(React.Fragment, null,
                h('input', { style: { ...S.input, width: '220px' }, type: 'password', autoComplete: 'off', autoFocus: true, placeholder: T.value, value, onChange: e => setValue(e.target.value), onKeyDown: onKeys(() => { if (value.trim()) saveValue() }, cancel) }),
                h('button', { style: { ...S.btn, ...S.primary }, disabled: !value.trim(), onClick: saveValue }, T.save),
                h('button', { style: S.btn, onClick: cancel }, T.cancel))
              : h(React.Fragment, null,
                h('button', { style: S.btn, disabled: row.writable === false, onClick: () => setEditing(true) }, T.set),
                row.configured === true ? h('button', { style: { ...S.btn, ...S.danger }, disabled: row.writable === false, onClick: async () => { if (!window.confirm(T.confirmUnset(row.ref))) return; const r = await creds('/unset', { ref: row.ref }); setNote(r.ok === false ? T.failed + (r.message ?? '') : T.removed); reload() } }, T.unset) : null,
                h('button', { style: { ...S.btn, ...(spares ? S.primary : {}) }, 'aria-expanded': spares, onClick: () => setSpares(v => !v) }, T.spares(row.slots ?? 0)),
                row.bindings.length === 0 && row.configured !== true && !(row.slots > 0) ? h('button', { style: S.btn, onClick: async () => { if (!window.confirm(T.confirmForget(row.ref))) return; const r = await creds('/alias', { ref: row.ref, remove: true }); setNote(r.ok === false ? T.failed + (r.message ?? '') : T.removed); reload() } }, T.forget) : null)),
          h('span', { style: { ...S.dim, width: '100%' }, role: 'status' }, feedback || '')),
        h('div', { style: S.cardTop },
          h('input', { style: { ...S.input, width: '120px' }, value: alias, placeholder: T.aliasPh, onChange: e => setAlias(e.target.value), onBlur: () => { if (alias !== row.alias) saveAlias() }, onKeyDown: onKeys(() => { if (alias !== row.alias) saveAlias() }, () => setAlias(row.alias)) }),
          h('input', { style: { ...S.input, width: '180px' }, value: note, placeholder: T.notePh, onChange: e => setNoteText(e.target.value), onBlur: () => { if (note !== row.note) saveAlias() }, onKeyDown: onKeys(() => { if (note !== row.note) saveAlias() }, () => setNoteText(row.note)) }),
          h('span', { style: { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center' } }, row.bindings.length === 0 ? h('span', { style: S.dim }, T.none) : row.bindings.map((b, i) => h('span', { key: i, style: S.chip, title: b.detail }, (T.feature[b.feature] ?? b.feature) + ' · ' + T.detail(b.detail))))),
        spares ? h(SparePanel, { T, row, reload, setNote: setFeedback }) : null,
      )
    }

    /** "Refresh the model list": one button on dsh-provider-sync, the last sync time and this run's counts. */
    function ModelListBlock({ T, onSynced }) {
      const [st, setSt] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState('')
      const load = () => sync('/status').then(setSt).catch(() => setSt({ ok: false }))
      React.useEffect(() => { load() }, [])
      const run = async () => {
        setBusy(true); setResult(T.syncing)
        try {
          const r = await sync('/sync', {}).catch(error => ({ ok: false, message: String(error?.message ?? error) }))
          if (r.ok === false) setResult(T.failed + (r.message ?? ''))
          else {
            setSt(r)
            const routes = Object.values(r.routes ?? {})
            const sum = routes.reduce((a, v) => ({ models: a.models + (v.models ?? 0), added: a.added + (v.added ?? 0), updated: a.updated + (v.updated ?? 0), noted: a.noted + (v.noted ?? 0), reasoning: a.reasoning + (v.reasoning ?? 0) }), { models: 0, added: 0, updated: 0, noted: 0, reasoning: 0 })
            setResult(routes.length === 0 ? T.syncNone : T.syncResult(sum))
            onSynced?.()
          }
        } finally { setBusy(false) }
      }
      return h('div', { style: S.block },
        h('div', { style: S.h }, T.syncTitle),
        h('div', { style: S.row },
          h('button', { style: { ...S.btn, ...S.primary }, disabled: busy, onClick: run }, busy ? T.syncing : T.syncBtn),
          h('span', { style: S.dim }, T.syncLast + ': ' + (st?.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString() : T.never)),
          st?.lastError ? h('span', { style: S.bad }, T.failed + st.lastError) : null,
          result ? h('span', null, result) : null),
        h('div', { style: S.hint }, T.syncHint))
    }

    /** Options grouped by the vendor prefix of the id (`openai/…`, `~anthropic/…`), in list order. */
    function groupByVendor(models) {
      const groups = new Map()
      for (const m of models) {
        const i = String(m.id).indexOf('/')
        const vendor = i > 0 ? String(m.id).slice(0, i).replace(/^~/, '') : ''
        if (!groups.has(vendor)) groups.set(vendor, [])
        groups.get(vendor).push(m)
      }
      return [...groups.entries()]
    }
    /** dsh's default model: route, then a model of that route; written to agent-default-model. */
    function DefaultModelBlock({ T, version }) {
      const [data, setData] = React.useState(null)
      const [pick, setPick] = React.useState({ provider: '', model: '' })
      const [unlisted, setUnlisted] = React.useState(false)
      const [note, setNote] = React.useState('')
      const load = () => creds('/models').then(d => { setData(d); if (d?.default) setPick(d.default) }).catch(error => setData({ ok: false, message: String(error?.message ?? error) }))
      React.useEffect(() => { load() }, [version])
      if (data === null) return h('div', { style: S.block }, h('div', { style: S.h }, T.defaultTitle), h('div', { style: S.hint }, '…'))
      const routes = Array.isArray(data.routes) ? data.routes : []
      const route = routes.find(r => r.route === pick.provider)
      const models = route?.models ?? []
      const listed = models.some(m => m.id === pick.model)
      // Only an llm-pi-ai route has a list of its own an unlisted id can join; the others are fixed sets.
      const canUnlist = route?.ns === 'llm-pi-ai' && models.length > 0
      const unlistedOn = canUnlist && unlisted
      const dirty = pick.provider !== (data.default?.provider ?? '') || pick.model !== (data.default?.model ?? '')
      const apply = async () => {
        const r = await creds('/default-model', { provider: pick.provider, model: pick.model, allowUnlisted: unlistedOn })
        setNote(r.ok === false ? T.failed + (r.message ?? '') : T.applied)
        if (r.ok !== false) load()
      }
      return h('div', { style: S.block },
        h('div', { style: S.h }, T.defaultTitle),
        h('div', { style: S.hint }, T.defaultHint),
        h('div', { style: S.dim }, T.current(data.default?.provider, data.default?.model)),
        data.ok === false ? h('div', { style: S.bad }, T.loadFailed + (data.message ?? '')) : routes.length === 0 ? h('div', { style: S.bad }, T.noRoutes) : h('div', { style: S.row },
          h('label', { style: S.dim }, T.route),
          h('select', { style: { ...S.input, minWidth: '150px' }, value: pick.provider, onChange: e => { const r = routes.find(x => x.route === e.target.value); setPick({ provider: e.target.value, model: r?.models?.[0]?.id ?? '' }) } },
            pick.provider && !route ? h('option', { value: pick.provider }, pick.provider) : null,
            ...routes.map(r => h('option', { key: r.route, value: r.route }, (r.displayName && r.displayName !== r.route ? `${r.route} — ${r.displayName}` : r.route) + (r.baseURL ? ' · ' + r.baseURL.replace(/^https?:\/\//, '') : '')))),
          h('label', { style: S.dim }, T.model),
          models.length > 0 && !unlistedOn
            ? h('select', { style: { ...S.input, minWidth: '260px', maxWidth: '420px' }, value: listed ? pick.model : '', onChange: e => setPick({ ...pick, model: e.target.value }) },
              listed ? null : h('option', { value: '' }, '—'),
              ...groupByVendor(models).map(([vendor, list]) => (vendor
                ? h('optgroup', { key: vendor, label: vendor }, ...list.map(m => h('option', { key: m.id, value: m.id }, m.name && m.name !== m.id ? `${m.id} — ${m.name}` : m.id)))
                : list.map(m => h('option', { key: m.id, value: m.id }, m.name && m.name !== m.id ? `${m.id} — ${m.name}` : m.id)))))
            : h('input', { style: { ...S.input, width: '260px' }, value: pick.model, placeholder: 'model id', onChange: e => setPick({ ...pick, model: e.target.value }), onKeyDown: onKeys(() => { if (pick.provider && pick.model && dirty) apply() }) }),
          canUnlist ? h('label', { style: { ...S.dim, display: 'inline-flex', gap: '4px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: unlisted, onChange: e => setUnlisted(e.target.checked) }), T.unlisted) : h('span', { style: S.dim }, models.length > 0 ? T.fixedSet : T.noModels),
          h('button', { style: { ...S.btn, ...S.primary }, disabled: !pick.provider || !pick.model || !dirty || (models.length > 0 && !listed && !unlistedOn), onClick: apply }, T.applyDefault),
          note ? h('span', { style: S.dim }, note) : null))
    }

    function Section({ ctx }) {
      const T = useT(ctx)
      const [data, setData] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [adding, setAdding] = React.useState('')
      const [modelsVersion, setModelsVersion] = React.useState(0)
      const reload = () => creds('/list').then(setData).catch(error => setData({ ok: false, message: String(error?.message ?? error) }))
      React.useEffect(() => { reload() }, [])
      const [q, setQ] = React.useState('')
      const [boundOnly, setBoundOnly] = React.useState(() => { try { return localStorage.getItem('dsh-credentials-center.boundOnly') === '1' } catch { return false } })
      const toggleBoundOnly = v => { setBoundOnly(v); try { localStorage.setItem('dsh-credentials-center.boundOnly', v ? '1' : '0') } catch { /* private mode */ } }
      const all = Array.isArray(data?.refs) ? data.refs : []
      // A fresh reference has no bindings and matches no filter: whatever is hiding it steps aside,
      // or the owner is told the reference was created and never sees it.
      const addRef = async () => {
        if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(adding)) return
        const r = await creds('/alias', { ref: adding, create: true })
        setNote(r.ok === false ? T.failed + (r.message ?? '') : r.existed ? T.exists : T.added)
        if (r.ok !== false) { if (boundOnly) toggleBoundOnly(false); if (q.trim()) setQ('') }
        setAdding(''); reload()
      }
      const needle = q.trim().toLowerCase()
      const refs = all.filter(r => (!boundOnly || r.bindings.length > 0) && (!needle || [r.ref, r.alias, r.note, ...r.bindings.map(b => b.feature + ' ' + b.detail)].join(' ').toLowerCase().includes(needle)))
      React.useEffect(() => { ensureSuiteStyle() }, [])
      return h('div', { style: S.wrap, className: 'dsh-suite' },
        h('div', { style: S.hint }, T.hint),
        data === null ? h('div', { style: S.hint }, '…') : data.ok === false ? h('div', { style: S.bad }, T.loadFailed + (data.message ?? '')) : h(React.Fragment, null,
          data.storeAvailable === false ? h('div', { style: S.bad }, T.storeGone) : null,
          all.length > 0 ? h('div', { style: S.row },
            h('input', { style: { ...S.input, width: '220px' }, placeholder: T.filterPh, value: q, onChange: e => setQ(e.target.value) }),
            h('label', { style: { ...S.dim, display: 'inline-flex', gap: '4px', alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: boundOnly, onChange: e => toggleBoundOnly(e.target.checked) }), T.boundOnly)) : null,
          all.length === 0 ? h('div', { style: S.dim }, T.empty) : refs.length === 0 ? h('div', { style: S.dim }, T.noMatch) : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            ...refs.map(row => h(Row, { key: row.ref, T, row, reload })))),
        h('div', { style: S.row },
          h('input', { style: { ...S.input, width: '220px' }, placeholder: T.addRef, value: adding, onChange: e => setAdding(e.target.value.toUpperCase()), onKeyDown: onKeys(addRef) }),
          h('button', { style: { ...S.btn, ...S.primary }, disabled: !/^[A-Z][A-Z0-9_]{1,99}$/.test(adding), onClick: addRef }, T.add),
          h('button', { style: S.btn, onClick: reload }, T.refresh),
          note ? h('span', { style: S.hint }, note) : null),
        h(ModelListBlock, { T, onSynced: () => setModelsVersion(v => v + 1) }),
        h(DefaultModelBlock, { T, version: modelsVersion }),
      )
    }
    async function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const label = () => (activeLocale(ctx).toLowerCase().startsWith('zh') ? DICT.zh.title : DICT.en.title)
      slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'credentials-center', order: 12, label }, () => h(Section, { ctx })))
    }
    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
