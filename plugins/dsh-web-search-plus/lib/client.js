/**
 * dsh-web-search-plus browser half: ONE web-search section inside dsh's own Settings panel,
 * so the deployment is configured in one place instead of per model. It writes the same
 * `$DSH_HOME/web-search.json` the launcher's Control Deck tab writes (through the plugin's
 * own routes), and offers the four modes:
 *
 *   off · let the model decide (tool call served by the source below) ·
 *   search on trigger words (results injected) · use the API provider's own search.
 *
 * The provider-native mode is labelled with its cost: OpenRouter bills each search
 * (openrouter.ai/docs/features/web-search), and routes without a native switch fall back to
 * the tool served by the chosen source.
 */
window.__ModuleLoader__.load({
  id: 'dsh-web-search-plus',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const activeLocale = ctx => { try { const a = ctx?.locale?.getSnapshot?.().active; if (typeof a === 'string' && a) return a } catch { /* browser language below */ } return String(navigator.language ?? '') }
    let zh = activeLocale(null).toLowerCase().startsWith('zh')
    const MSG_ZH = { 'credentials service unavailable': '凭据服务不可用', 'provider has no API key': '该搜索来源无需 API 密钥' }
    const mm = m => { const k = String(m ?? ''); return (isZh() && MSG_ZH[k]) || k }
    const isZh = () => zh
    const makeT = zh => zh
      ? {
        label: '联网搜索', title: '联网搜索(全局)', save: '保存', saved: '已保存', failed: '请求失败:', test: '测试搜索', testNative: '测试搜索(真实 :online 请求,约 $0.01)', testing: '搜索中…',
        mode: '方式', provider: '搜索来源', maxResults: '最多结果数', searxng: 'SearXNG 地址', key: 'API 密钥', keySave: '保存密钥', keyDelete: '删除密钥', keyDeleteConfirm: '删除已保存的 API 密钥?', keyDeleted: '密钥已删除', keySet: '已配置', keyMissing: '未配置',
        m_off: '关闭', m_tool: '让模型自己决定(工具调用,由下面的来源代答)', m_inject: '按触发词自动搜索(结果作为上下文注入)', m_provider: '走 API 自己的供应商搜索',
        dshCreds: '「DSH」已保存凭据', dshCredsNote: '「模型」页保存的 API 凭据一览(只读)。搜索供应商各用自家密钥;这些 DSH 凭据可在「多媒体 API」和「桌宠」面板里直接借用;绑定在哪些功能、别名、删除,统一在「凭据中心」页管理。', saving: '保存中…',
        providerNote: '走供应商自带搜索:OpenRouter 会在模型 id 后加 :online,由 OpenRouter 服务端搜索、按次另计费;其它路由没有这个开关,会回落成上面选的来源代答 web_search 工具。【claude系模型不可走openrouter原生api搜索,建议自己配置api】——Claude 系模型会保留原模型、改走下面来源的工具检索;「测试搜索」在此模式下用一个非 Claude 的便宜模型发一次真实的 :online 请求。',
        deepseekNote: 'DeepSeek 官方搜索只用 DEEPSEEK_API_KEY,和你聊天用的模型无关(每次搜索 = 一次完整的 DeepSeek 模型调用)。',
        offline: '插件未响应', hint: '这里是全局设置,启动器「控制甲板 → 联网搜索」写的是同一份配置。',
        fetchOn: '网页读取 web_fetch(让模型读取搜索结果的整页内容)', fetchMounted: '已挂载', fetchOff: '未挂载(保存后 1.5 秒内生效)', fetchMissing: m => `未挂载:缺少 ${m}`,
        fetchNote: '只读公网地址(私网 / 回环 / 黑名单域名一律拒绝,连接钉在校验过的地址上);在本体进程里跑、不经 Windows 沙箱,HTTPS 正常。「方式:关闭」时网页读取一并停用;控制甲板的「禁用工具」是按次拒绝的另一层;超时与大小上限在 web-search.json 的 fetch 段。', fetchReason: r => ({ 'switched off': '已关闭', 'web search mode is off': '「方式」为关闭' })[r] ?? r, fetchDown: r => `未挂载(${r})`,
      }
      : {
        label: 'Web search', title: 'Web search (global)', save: 'Save', saved: 'Saved', failed: 'Request failed: ', test: 'Test search', testNative: 'Test search (one real :online request, about $0.01)', testing: 'Searching…',
        mode: 'Mode', provider: 'Source', maxResults: 'Max results', searxng: 'SearXNG URL', key: 'API key', keySave: 'Save key', keyDelete: 'Delete key', keyDeleteConfirm: 'Delete the saved API key?', keyDeleted: 'Key deleted', keySet: 'configured', keyMissing: 'not configured',
        m_off: 'Off', m_tool: 'Let the model decide (tool call served by the source below)', m_inject: 'Search on trigger words (results injected as context)', m_provider: "Use the API provider's own search",
        dshCreds: 'DSH stored credentials', dshCredsNote: 'Read-only view of the API credentials saved on the Models page. Search vendors use their own keys; these DSH credentials can be borrowed directly in the Media APIs and Desktop-pet panels. Bindings, aliases and removal live on the Credentials Center page.', saving: 'Saving…',
        providerNote: "Provider-native: OpenRouter appends :online to the model id and searches server-side, billed per search; routes without such a switch fall back to the web_search tool with the source chosen above. Claude-family models cannot use OpenRouter's native search — they keep their plain id and use the tool search below; 'Test search' in this mode makes one real :online request with a cheap non-Claude model.",
        deepseekNote: 'DeepSeek official search only uses DEEPSEEK_API_KEY and is independent of your chat model (one search = one full DeepSeek model call).',
        offline: 'the plugin did not answer', hint: 'This is the global setting; the launcher\'s Control Deck → Web search writes the same file.',
        fetchOn: 'Page reader web_fetch (lets the model read a whole result page)', fetchMounted: 'mounted', fetchOff: 'not mounted (takes effect within 1.5 s of saving)', fetchMissing: m => `not mounted: ${m} missing`,
        fetchNote: 'Public addresses only (private / loopback / blacklisted hosts are refused; the connection is pinned to the address that was checked); runs in the harness process, not the Windows sandbox, so HTTPS works. Mode "off" takes the page reader down too; the Control Deck\'s disabled-tools list is a separate per-call denial; timeouts and size caps live in the fetch section of web-search.json.', fetchReason: r => r, fetchDown: r => `not mounted (${r})`,
      }
    let T = makeT(zh)

    /** One stylesheet for the suite's sections: inline styles cannot express :disabled or <option>. */
    function ensureSuiteStyle() {
      if (document.getElementById('dsh-suite-style')) return
      const style = document.createElement('style')
      style.id = 'dsh-suite-style'
      style.textContent = '.dsh-suite button:disabled { opacity: .45; cursor: not-allowed }'
        + 'select option, select optgroup { background: var(--dsw-alias-bg-layer-2, #1c1f28); color: var(--dsw-alias-label-primary, #e8ecf5) }'
        + 'select option:checked { background: var(--dsw-alias-state-business-tertiary, rgba(106,163,255,.18)) }'
      document.head.appendChild(style)
    }
    const PROVIDERS = [
      { id: 'serper', label: 'Serper (serper.dev)', env: 'SERPER_API_KEY' },
      { id: 'serpapi', label: 'SerpApi', env: 'SERPAPI_API_KEY' },
      { id: 'tavily', label: 'Tavily', env: 'TAVILY_API_KEY' },
      { id: 'brave', label: 'Brave Search', env: 'BRAVE_API_KEY' },
      { id: 'searxng', label: 'SearXNG (self-hosted)', env: '' },
      // The official source rides the core's own web seam, which resolves DEEPSEEK_API_KEY itself:
      // this plugin stores no key for it, so it must not offer a key field that can never save.
      { id: 'deepseek-official', label: () => (isZh() ? 'DeepSeek 官方搜索(需 DEEPSEEK_API_KEY)' : 'DeepSeek official (needs DEEPSEEK_API_KEY)'), env: '' },
    ]
    const S = {
      section: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 2px 20px', fontSize: '13px' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      label: { minWidth: '96px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' },
      input: { padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'inherit', fontSize: '12.5px' },
      note: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.6 },
      btn: { padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', cursor: 'pointer' },
    }
    const api = async (path, body) => {
      const init = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const r = await fetch('/dsh-web-search-plus' + path, init)
      try { return await r.json() } catch { return { ok: false, message: 'HTTP ' + r.status } }
    }

    function WebSearchSection() {
      const [status, setStatus] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [key, setKey] = React.useState('')
      const [dsh, setDsh] = React.useState(null)
      React.useEffect(() => { api('/dsh-credentials').then(r => setDsh(r.providers ?? [])).catch(() => setDsh([])) }, [])
      const load = React.useCallback(async () => {
        const d = await api('/status')
        setStatus(d)
        if (d && d.config) setDraft({ ...d.config })
      }, [])
      React.useEffect(() => { load() }, [load])
      React.useEffect(() => { ensureSuiteStyle() }, [])
      if (status === null) return h('div', { style: S.note }, '…')
      if (status.ok === false || !draft) return h('div', { style: S.note }, T.offline + ' ' + (status.message ?? ''))
      const provider = PROVIDERS.find(p => p.id === draft.provider) ?? PROVIDERS[0]
      const configured = status.providers?.[draft.provider]?.configured
      const save = async () => {
        setNote(T.saving)
        const r = await api('/config', draft)
        if (r.ok === false) setNote(T.failed + mm(r.message))
        else { setNote(T.saved); await load() }
      }
      return h('div', { style: S.section, className: 'dsh-suite' },
        h('div', { style: S.note }, T.hint),
        h('div', { style: S.row },
          h('span', { style: S.label }, T.mode),
          h('select', { style: { ...S.input, minWidth: '340px' }, value: draft.mode, onChange: e => setDraft({ ...draft, mode: e.target.value }) },
            h('option', { value: 'off' }, T.m_off),
            h('option', { value: 'tool' }, T.m_tool),
            h('option', { value: 'inject' }, T.m_inject),
            h('option', { value: 'provider' }, T.m_provider),
          ),
        ),
        draft.mode === 'provider' ? h('div', { style: S.note }, T.providerNote) : null,
        h('div', { style: S.row },
          h('span', { style: S.label }, T.provider),
          h('select', { style: { ...S.input, minWidth: '260px' }, value: draft.provider, onChange: e => setDraft({ ...draft, provider: e.target.value }) },
            PROVIDERS.map(p => h('option', { key: p.id, value: p.id }, (typeof p.label === 'function' ? p.label() : p.label))),
          ),
          h('span', { style: S.note }, configured === undefined ? '' : configured ? T.keySet : T.keyMissing),
        ),
        draft.provider === 'deepseek-official' ? h('div', { style: S.note }, T.deepseekNote) : null,
        provider.env ? h('div', { style: S.row },
          h('span', { style: S.label }, T.key),
          h('input', { style: { ...S.input, minWidth: '260px' }, type: 'password', value: key, placeholder: provider.env, onChange: e => setKey(e.target.value) }),
          h('button', {
            style: S.btn, disabled: !key.trim(),   // an empty save would clear the stored key: that is what "Delete key" is for
            onClick: async () => { const r = await api('/key', { provider: draft.provider, value: key }); setNote(r.ok === false ? T.failed + mm(r.message) : T.saved); setKey(''); await load() },
          }, T.keySave),
          h('button', {
            style: S.btn,
            onClick: async () => { if (!window.confirm(`${T.keyDeleteConfirm}(${provider.env})`)) return; const r = await api('/key', { provider: draft.provider, value: '' }); setNote(r.ok === false ? T.failed + mm(r.message) : T.keyDeleted); await load() },
          }, T.keyDelete),
        ) : null,
        draft.provider === 'searxng' ? h('div', { style: S.row },
          h('span', { style: S.label }, T.searxng),
          h('input', { style: { ...S.input, minWidth: '320px' }, value: draft.searxngUrl ?? '', placeholder: 'https://searxng.example', onChange: e => setDraft({ ...draft, searxngUrl: e.target.value }) }),
        ) : null,
        h('div', { style: S.row },
          h('span', { style: S.label }, T.maxResults),
          h('input', { style: { ...S.input, width: '80px' }, type: 'number', min: 1, max: 20, value: draft.maxResults ?? 6, onChange: e => setDraft({ ...draft, maxResults: Number(e.target.value) }) }),
        ),
        h('div', { style: S.row },
          h('label', { style: { ...S.label, display: 'inline-flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } },
            h('input', { type: 'checkbox', checked: draft.fetch?.enabled !== false, onChange: e => setDraft({ ...draft, fetch: { ...(draft.fetch ?? {}), enabled: e.target.checked } }) }),
            T.fetchOn),
          h('span', { style: S.note }, status.fetch?.mounted ? T.fetchMounted : Array.isArray(status.fetch?.missing) && status.fetch.missing.length > 0 ? T.fetchMissing(status.fetch.missing.join(', ')) : status.fetch?.reason ? T.fetchDown(T.fetchReason(status.fetch.reason)) : T.fetchOff)),
        h('div', { style: S.note }, T.fetchNote),
        h('div', { style: S.row },
          h('button', { style: { ...S.btn, borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' }, onClick: save }, T.save),
          h('button', {
            style: S.btn,
            onClick: async () => {
              setNote(T.testing)
              // Provider-native mode tests the native path (one real :online request); the other
              // modes test the tool source picked above.
              const native = draft.mode === 'provider'
              const r = await api('/test', { provider: draft.provider, query: 'deepseek harness', native })
              if (r.ok === false) { setNote(T.failed + mm(r.message) + (r.model ? ` [${r.model}]` : '')); return }
              if (native) {
                const cost = typeof r.cost === 'number' ? ` · $${r.cost.toFixed(4)}` : ''
                setNote(`${isZh() ? '原生检索' : 'native'} ${r.model} · ${r.ms} ms · ${(r.sources ?? []).length}${isZh() ? ' 条引用' : ' citations'}${cost}`)
                return
              }
              setNote(`${r.ms} ms · ${(r.result?.sources ?? []).length}${isZh() ? ' 条结果' : ' sources'}`)
            },
          }, draft.mode === 'provider' ? T.testNative : T.test),
          note ? h('span', { style: S.note }, note) : null,
        ),
        dsh !== null && dsh.length > 0 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-alias-border-l1)' } },
          h('div', { style: { fontWeight: 600 } }, T.dshCreds),
          h('div', { style: S.note }, T.dshCredsNote),
          ...dsh.map(p => h('div', { key: p.route, style: S.note },
            `【DSH】${p.route} · ${p.keyEnv || '—'} · ${p.configured ? T.keySet : T.keyMissing}`,
          )),
        ) : null,
      )
    }

    async function apply(ctx) {
      const pick = () => { zh = activeLocale(ctx).toLowerCase().startsWith('zh'); T = makeT(zh) }
      pick()
      try { ctx.locale?.subscribe?.(pick) } catch { /* browser language stays */ }
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'web-search-plus', order: 25, label: () => T.title }, WebSearchSection,
      ))
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
