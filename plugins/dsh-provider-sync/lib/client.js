/**
 * dsh-provider-sync browser half: one card in dsh Settings — when the OpenRouter model list was
 * last refreshed, how many models carry reasoning levels now, a "sync now" button and the interval.
 */
window.__ModuleLoader__.load({
  id: 'dsh-provider-sync',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const makeT = zh => zh
      ? {
        title: '模型清单同步', hint: 'OpenRouter 路由的模型清单由这里自动保持最新:新模型自动加入,名称 / 上下文 / 输出上限自动刷新,并为支持推理的模型写入思考强度档位(off / minimal / low / medium / high / xhigh / max),这样推理等级选择器才不会回答"不支持"。你手改过的字段不会被覆盖。',
        last: '上次同步', never: '从未', interval: '同步间隔', hours: n => `${n} 小时`, sync: '立即同步', syncing: '同步中…', failed: '失败:', route: '路由', models: '模型', added: '新增', updated: '有改动', noted: 'Claude 提示', reasoning: '带思考档位', at: '记录时间', note: '在 OpenRouter 路由的 Claude 系模型名后加「不可走原生搜索」提示', noteOff: '切换后立即同步一次,名字随之更新', alsoOn: '凭据中心页/区的「刷新模型清单」按钮调用的就是这里的同步。', source: '来源:openrouter.ai/api/v1/models(公开,无需密钥)',
      }
      : {
        title: 'Model list sync', hint: "Keeps every OpenRouter route's model list current: new models are added, names / context windows / output limits refreshed, and models that support reasoning get their effort levels (off / minimal / low / medium / high / xhigh / max) so the reasoning picker stops answering 'unsupported'. Hand-edited fields are never overwritten.",
        last: 'Last sync', never: 'never', interval: 'Interval', hours: n => `${n} h`, sync: 'Sync now', syncing: 'Syncing…', failed: 'Failed: ', route: 'Route', models: 'models', added: 'added', updated: 'changed', noted: 'Claude notes', reasoning: 'with reasoning levels', at: 'recorded', note: 'Append the "no native search on OpenRouter" note to Claude-family model names on OpenRouter routes', noteOff: 'Toggling runs a sync at once, so the names follow immediately', alsoOn: 'The "Refresh model list" button on the Credentials page runs this same sync.', source: 'Source: openrouter.ai/api/v1/models (public, no key needed)',
      }
    const activeLocale = ctx => { try { const a = ctx?.locale?.getSnapshot?.().active; if (typeof a === 'string' && a) return a } catch { /* browser language below */ } return String(navigator.language ?? '') }
    let T = makeT(activeLocale(null).toLowerCase().startsWith('zh'))
    const S = {
      card: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' },
      hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: 1.5 },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      label: { minWidth: '80px', color: 'var(--dsw-alias-label-secondary)' },
      input: { padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'inherit', fontSize: '12.5px' },
      btn: { padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)', background: 'transparent', cursor: 'pointer' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
      cell: { padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l1)', textAlign: 'left' },
    }
    async function api(path, body) {
      const r = await fetch('/dsh-provider-sync' + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      try { return await r.json() } catch { return { ok: false, message: 'HTTP ' + r.status } }
    }
    function ensureSuiteStyle() {
      if (document.getElementById('dsh-suite-style')) return
      const style = document.createElement('style')
      style.id = 'dsh-suite-style'
      style.textContent = '.dsh-suite button:disabled { opacity: .45; cursor: not-allowed }'
        + 'select option, select optgroup { background: var(--dsw-alias-bg-layer-2, #1c1f28); color: var(--dsw-alias-label-primary, #e8ecf5) }'
        + 'select option:checked { background: var(--dsw-alias-state-business-tertiary, rgba(106,163,255,.18)) }'
      document.head.appendChild(style)
    }
    function Section() {
      const [st, setSt] = React.useState(null)
      React.useEffect(() => { ensureSuiteStyle() }, [])
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const load = () => api('/status').then(setSt).catch(error => setSt({ ok: false, lastError: String(error?.message ?? error) }))
      React.useEffect(() => { load() }, [])
      const routes = Object.entries(st?.routes ?? {})
      return h('div', { style: S.card, className: 'dsh-suite' },
        h('div', { style: S.hint }, T.hint),
        h('div', { style: S.row },
          h('span', { style: S.label }, T.last),
          h('span', null, st?.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString() : T.never),
          st?.lastError ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, T.failed + st.lastError) : null,
        ),
        h('div', { style: S.row },
          h('span', { style: S.label }, T.interval),
          h('select', {
            style: S.input, value: st?.intervalHours ?? 24,
            onChange: async e => { const r = await api('/settings', { intervalHours: Number(e.target.value) }).catch(error => ({ ok: false, message: String(error?.message ?? error) })); if (r.ok === false) setNote(T.failed + (r.message ?? '')); else setSt(r) },
          }, ...[...new Set([6, 12, 24, 72, 168, Number(st?.intervalHours ?? 24)])].sort((a, b) => a - b).map(n => h('option', { key: n, value: n }, T.hours(n)))),
          h('button', {
            style: S.btn, disabled: busy,
            onClick: async () => {
              setBusy(true); setNote(T.syncing)
              try { const r = await api('/sync', {}).catch(error => ({ ok: false, message: String(error?.message ?? error) })); if (r.ok !== false) setSt(r); setNote(r.ok === false ? T.failed + (r.message ?? '') : '') } finally { setBusy(false) }
            },
          }, busy ? T.syncing : T.sync),
          note ? h('span', { style: S.hint }, note) : null,
        ),
        h('label', { style: { ...S.row, cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: st?.anthropicNote !== false, disabled: busy, onChange: async e => {
            const r = await api('/settings', { anthropicNote: e.target.checked }).catch(error => ({ ok: false, message: String(error?.message ?? error) }))
            if (r.ok === false) { setNote(T.failed + (r.message ?? '')); return }
            setSt(r)
            // the names change on the next sync: run it now, so the picker shows the result at once
            setBusy(true); setNote(T.syncing)
            try { const s2 = await api('/sync', {}).catch(error => ({ ok: false, message: String(error?.message ?? error) })); if (s2.ok !== false) setSt(s2); setNote(s2.ok === false ? T.failed + (s2.message ?? '') : '') } finally { setBusy(false) }
          } }),
          h('span', null, T.note),
          h('span', { style: S.hint }, T.noteOff)),
        routes.length > 0 ? h('table', { style: S.table },
          h('thead', null, h('tr', null, ...[T.route, T.models, T.added, T.updated, T.noted, T.reasoning, T.at].map(x => h('th', { key: x, style: S.cell }, x)))),
          h('tbody', null, ...routes.map(([route, v]) => h('tr', { key: route },
            h('td', { style: S.cell }, route), h('td', { style: S.cell }, v.models), h('td', { style: S.cell }, v.added), h('td', { style: S.cell }, v.updated), h('td', { style: S.cell }, v.noted ?? '—'), h('td', { style: S.cell }, v.reasoning), h('td', { style: S.cell }, v.at ? new Date(v.at).toLocaleString() : '—'),
          ))),
        ) : null,
        h('div', { style: S.hint }, T.source + ' · ' + T.alsoOn),
      )
    }
    async function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const pick = () => { T = makeT(activeLocale(ctx).toLowerCase().startsWith('zh')) }
      pick()
      try { ctx.locale?.subscribe?.(pick) } catch { /* browser language stays */ }
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'provider-sync', order: 24, label: () => T.title }, Section,
      ))
    }
    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
