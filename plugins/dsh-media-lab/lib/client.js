/**
 * dsh-media-lab browser half.
 *
 * Two jobs:
 *  1. a "Media APIs" section in dsh Settings — one row per kind (image / video / speech /
 *     transcription): provider, base URL, model, voice/size, the key it needs, plus a live test;
 *  2. inline playback — the tools announce a finished file as `[[dsh-media:<id>]]`, and a
 *     MutationObserver swaps that marker for an <img>/<video>/<audio> pointing at
 *     `/dsh-media-lab/file/<id>` (the core has no image content block, so the transcript carries
 *     text and the browser draws the media).
 */
window.__ModuleLoader__.load({
  id: 'dsh-media-lab',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const zh = String(navigator.language ?? '').toLowerCase().startsWith('zh')
    const MSG_ZH = {
      'credentials service unavailable': '凭据服务不可用',
      'no base URL to list models from': '没有可用的接口地址,无法拉取模型列表',
      'unknown media kind': '未知的媒体类型',
    }
    const mm = m => {
      const k = String(m ?? '')
      if (!zh) return k
      if (MSG_ZH[k]) return MSG_ZH[k]
      const u = /^unknown credential "(.*)"$/.exec(k)
      if (u) return `未知的凭据(${u[1]})`
      const gone = /^the harness provider "(.*)" is not configured any more/.exec(k)
      if (gone) return `DSH 供应商「${gone[1]}」已不存在,请到 设置 → 多媒体 API 重新选择`
      const noHost = /^the harness provider "(.*)" has no usable host/.exec(k)
      if (noHost) return `DSH 供应商「${noHost[1]}」没有可借用的接口地址,无法在此使用`
      return k
    }
    const T = zh
      ? {
        title: '多媒体 API', hint: '生图 / 生视频 / 语音合成 / 语音识别的额外 API。保存后立即生效,生成的文件放在 $DSH_HOME/media,并可在对话里直接播放。',
        kinds: { image: '生图', video: '生视频', tts: '语音合成(TTS)', stt: '语音识别(STT)' },
        enabled: '启用', provider: '供应商', baseURL: '接口地址', model: '模型', voice: '音色', size: '尺寸', format: '格式', language: '语言',
        key: 'API 密钥', keySave: '保存密钥', keyDelete: '删除密钥', keyDeleteConfirm: '删除已保存的 API 密钥?使用同一密钥的其他媒体类型将同时失效。', keyDeleted: '密钥已删除', keySet: '已配置', keyMissing: '未配置', save: '保存', saved: '已保存', failed: '请求失败:', testing: '生成中…',
        test: '试生成', testText: '你好,这是一次语音测试。', testPrompt: 'a small orange cat sitting on a windowsill, soft morning light, photo',
        tools: '允许模型调用的工具', toolsPrompt: '在系统提示里追加一段"本机有这些多媒体工具"的说明(只追加一段,不覆盖 dsh 本体、控制甲板或任何已有提示词;关掉后模型只能靠工具定义自己发现)', custom: '自定义 HTTP', customUrl: '请求地址', customPath: '结果字段路径', customType: '结果类型', resolution: '分辨率', videoSize: '尺寸 / 分辨率', saving: '保存中…',
        offline: '插件未响应', keepDays: '文件保留天数(0=永久)', localHint: '本地服务(127.0.0.1)可以不填密钥。',
        source: '来源', srcCustom: '自定义', srcHarness: '共享全局 API(DSH)', dshRoute: 'DSH 供应商', hGone: '(已失效)', hNoHost: '(无可借用地址)',
        fetchModels: '拉取模型列表', fetching: '拉取中…', noModels: '该供应商没有此类模型', modelsNote: n => `${n} 个可用模型(按功能筛选)`, saveFirst: '接口地址或供应商有未保存的修改,请先点保存再拉取。',
        harnessNote: env => `使用「模型」页保存的 API:凭据 ${env || '—'},密钥与地址一并借用,无需另填。`,
        voicePreset: '音色预设', presetSaveVoice: '保存当前音色', presetName: '预设名称', presetApply: '选择预设…', presetDel: '删除所选预设', presetSaved: '音色预设已保存(记得点保存)',
      }
      : {
        title: 'Media APIs', hint: 'Extra APIs for images, video, speech and transcription. Saved settings apply at once; files land in $DSH_HOME/media and play inline in the chat.',
        kinds: { image: 'Image', video: 'Video', tts: 'Text to speech', stt: 'Transcription' },
        enabled: 'Enabled', provider: 'Provider', baseURL: 'Base URL', model: 'Model', voice: 'Voice', size: 'Size', format: 'Format', language: 'Language',
        key: 'API key', keySave: 'Save key', keyDelete: 'Delete key', keyDeleteConfirm: 'Delete the saved API key? Every media kind using this key loses it.', keyDeleted: 'Key deleted', keySet: 'configured', keyMissing: 'not configured', save: 'Save', saved: 'Saved', failed: 'Request failed: ', testing: 'Generating…',
        test: 'Test', testText: 'Hello, this is a speech test.', testPrompt: 'a small orange cat sitting on a windowsill, soft morning light, photo',
        tools: 'Tools the model may call', toolsPrompt: 'Append a short "these media tools exist" section to the system prompt (appended as its own section — it never replaces the harness, deck or any other prompt; off, the model only learns of them from the tool definitions)', custom: 'Custom HTTP', customUrl: 'Request URL', customPath: 'Result path', customType: 'Result type', resolution: 'Resolution', videoSize: 'Size / resolution', saving: 'Saving…',
        offline: 'the plugin did not answer', keepDays: 'Keep files for (days, 0 = forever)', localHint: 'A local server (127.0.0.1) can be used without a key.',
        source: 'Source', srcCustom: 'custom', srcHarness: 'shared harness API (DSH)', dshRoute: 'DSH provider', hGone: ' (gone)', hNoHost: ' (no host)',
        fetchModels: 'Fetch models', fetching: 'Fetching…', noModels: 'this provider has no models of this kind', modelsNote: n => `${n} models (filtered by kind)`, saveFirst: 'The base URL or provider has unsaved changes — save first, then fetch.',
        harnessNote: env => `Borrows the API saved on the Models page: credential ${env || '—'}, key and host together — nothing else to fill in.`,
        voicePreset: 'Voice presets', presetSaveVoice: 'Save current voice', presetName: 'Preset name', presetApply: 'Pick a preset…', presetDel: 'Delete selected', presetSaved: 'Voice preset stored (remember to save)',
      }

    const KINDS = ['image', 'video', 'tts', 'stt']
    const S = {
      section: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 2px 24px', fontSize: '13px' },
      card: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-alias-border-l1)' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      head: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 },
      label: { minWidth: '86px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' },
      input: { padding: '5px 9px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'inherit', fontSize: '12.5px' },
      note: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.6 },
      btn: { padding: '5px 11px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', cursor: 'pointer' },
    }
    const api = async (path, body) => {
      const init = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const r = await fetch('/dsh-media-lab' + path, init)
      try { return await r.json() } catch { return { ok: false, message: 'HTTP ' + r.status } }
    }

    // ── inline media ────────────────────────────────────────────────────────
    const MARKER = /\[\[dsh-media:([a-z]{3}-\d{8}-\d{6}-[0-9a-f]{6})\]\]/
    const kindOfId = id => (id.startsWith('img') ? 'image' : id.startsWith('vid') ? 'video' : 'audio')
    function renderMarkers(root) {
      const scope = root && root.querySelectorAll ? root : document.body
      if (!scope) return
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode: node => (MARKER.test(node.nodeValue ?? '') && !node.parentElement?.closest('textarea,input,.dsh-media-card') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      })
      const hits = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) hits.push(n)
      for (const node of hits) {
        const match = MARKER.exec(node.nodeValue ?? '')
        if (!match) continue
        const id = match[1]
        const kind = kindOfId(id)
        const card = document.createElement('div')
        card.className = 'dsh-media-card'
        card.style.cssText = 'display:block;margin:6px 0;max-width:420px'
        const url = '/dsh-media-lab/file/' + id
        if (kind === 'image') {
          const img = document.createElement('img')
          img.src = url
          img.alt = id
          img.loading = 'lazy'
          img.style.cssText = 'max-width:100%;border-radius:10px;display:block;cursor:zoom-in'
          img.addEventListener('click', () => window.open(url, '_blank', 'noopener'))
          card.appendChild(img)
        } else {
          const media = document.createElement(kind === 'video' ? 'video' : 'audio')
          media.src = url
          media.controls = true
          media.preload = 'metadata'
          media.style.cssText = kind === 'video' ? 'max-width:100%;border-radius:10px;display:block' : 'width:100%;display:block'
          card.appendChild(media)
        }
        const parent = node.parentElement
        if (parent === null) continue
        // React owns this text node: if it re-renders the same marker (streaming repaints the
        // message), the card must not be added twice, and a failed DOM move must not break the page.
        if (parent.querySelector(`.dsh-media-card[data-media-id="${id}"]`) !== null) { node.nodeValue = (node.nodeValue ?? '').replace(MARKER, ''); continue }
        card.dataset.mediaId = id
        try {
          node.nodeValue = (node.nodeValue ?? '').replace(MARKER, '')
          parent.insertBefore(card, node)
        } catch { /* the node moved under us; the next observer tick retries */ }
      }
    }
    let pending = null
    const schedule = () => {
      if (pending !== null) return
      // setTimeout, not requestAnimationFrame: a hidden tab never paints, and the markers must
      // still be resolved when the user comes back to it.
      pending = setTimeout(() => { pending = null; try { renderMarkers(document.body) } catch { /* keep the page alive */ } }, 50)
    }
    if (!window.__dshMediaLabObserver__) {
      const observer = new MutationObserver(schedule)
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
      window.__dshMediaLabObserver__ = observer
      schedule()
    }

    // ── settings ────────────────────────────────────────────────────────────
    // The adapters a harness-sourced section may speak (mirrors HARNESS_ADAPTERS in config.js).
    const HARNESS_OK = { image: ['openai-compatible', 'openrouter'], video: ['openai-video', 'openrouter'], tts: ['openai-compatible'], stt: ['openai-compatible'] }
    const priceOf = m => {
      if (m.imageUsd !== undefined) return zh ? ` · $${m.imageUsd}/图` : ` · $${m.imageUsd}/image`
      if (m.promptUsdPerM !== undefined || m.completionUsdPerM !== undefined) {
        return zh ? ` · $${m.promptUsdPerM ?? '?'}入/$${m.completionUsdPerM ?? '?'}出 每百万` : ` · $${m.promptUsdPerM ?? '?'} in / $${m.completionUsdPerM ?? '?'} out per M`
      }
      if (m.requestUsd !== undefined) return zh ? ` · $${m.requestUsd}/次` : ` · $${m.requestUsd}/request`
      return ''
    }
    function KindCard({ kind, draft, setDraft, status, refreshStatus, setNote, dsh }) {
      const section = draft[kind]
      const harness = section.source === 'harness'
      const providers = status.providers?.[kind] ?? []
      const meta = providers.find(p => p.id === section.provider) ?? {}
      const keyEnv = harness ? '' : (section.keyEnv || meta.keyEnv || '')
      const keyState = status.keys?.[keyEnv]
      const route = (dsh ?? []).find(p => p.route === section.harnessRoute)
      const [key, setKey] = React.useState('')
      const [models, setModels] = React.useState(null)
      const [pulling, setPulling] = React.useState(false)
      const [presetSel, setPresetSel] = React.useState('')
      const patch = next => setDraft({ ...draft, [kind]: { ...section, ...next } })
      const pull = async () => {
        // The server lists models from the SAVED configuration only (the host is never taken
        // from a query, so a key always travels to the host it belongs to). A dirty draft would
        // silently list from the old host — say so instead.
        const saved = status.config?.[kind] ?? {}
        if (!harness && ((section.baseURL ?? '') !== (saved.baseURL ?? '') || section.provider !== saved.provider)) {
          setNote(T.saveFirst)
          return
        }
        setPulling(true)
        setModels(null)
        const r = await api('/models?kind=' + kind + (harness ? '&source=harness&route=' + encodeURIComponent(section.harnessRoute ?? '') : ''))
        setPulling(false)
        if (r.ok === false) { setNote(T.failed + mm(r.message)); return }
        setModels(r.models ?? [])
      }
      return h('div', { style: S.card },
        h('label', { style: S.head },
          h('input', { type: 'checkbox', checked: section.enabled === true, onChange: e => patch({ enabled: e.target.checked }) }),
          T.kinds[kind],
        ),
        h('div', { style: S.row },
          h('span', { style: S.label }, T.source),
          h('select', {
            style: { ...S.input, width: '190px' }, value: harness ? 'harness' : 'custom',
            onChange: e => {
              setModels(null)
              if (e.target.value === 'harness') {
                const allowed = HARNESS_OK[kind] ?? []
                // The custom fields are stashed on the draft (underscored, dropped by the server's
                // normalize) so flipping back restores the combination the user actually had.
                patch({
                  source: 'harness',
                  _customProvider: section.provider, _customBaseURL: section.baseURL ?? '', _customKeyEnv: section.keyEnv ?? '',
                  provider: allowed.includes(section.provider) ? section.provider : allowed[0],
                  harnessRoute: section.harnessRoute || (dsh ?? []).find(p => p.borrowable !== false)?.route || '',
                  keyEnv: '',
                })
              } else {
                patch({
                  source: 'custom',
                  provider: section._customProvider ?? section.provider,
                  baseURL: section._customBaseURL ?? section.baseURL ?? '',
                  keyEnv: section._customKeyEnv ?? '',
                })
              }
            },
          }, h('option', { value: 'custom' }, T.srcCustom), h('option', { value: 'harness' }, T.srcHarness)),
          harness ? h('span', { style: S.label }, T.dshRoute) : null,
          harness ? h('select', { style: { ...S.input, minWidth: '210px' }, value: section.harnessRoute ?? '', onChange: e => { setModels(null); patch({ harnessRoute: e.target.value }) } },
            !section.harnessRoute || (dsh ?? []).length === 0 ? h('option', { value: '' }, '—') : null,
            section.harnessRoute && !(dsh ?? []).some(p => p.route === section.harnessRoute)
              ? h('option', { value: section.harnessRoute }, '【DSH】' + section.harnessRoute + T.hGone) : null,
            (dsh ?? []).map(p => h('option', { key: p.route, value: p.route, disabled: p.borrowable === false },
              '【DSH】' + p.route + (p.borrowable === false ? T.hNoHost : p.configured ? '' : ' (' + T.keyMissing + ')'))),
          ) : null,
        ),
        harness ? h('div', { style: S.note }, T.harnessNote(route?.keyEnv)) : null,
        h('div', { style: S.row },
          h('span', { style: S.label }, T.provider),
          h('select', { style: { ...S.input, minWidth: '190px' }, value: section.provider, onChange: e => { setModels(null); patch(harness ? { provider: e.target.value, model: '' } : { provider: e.target.value, baseURL: '', model: '', keyEnv: '' }) } },
            (harness ? providers.filter(p => (HARNESS_OK[kind] ?? []).includes(p.id)) : providers).map(p => h('option', { key: p.id, value: p.id }, p.id === 'custom' ? T.custom : p.id)),
          ),
          keyEnv ? h('span', { style: S.note }, `${keyEnv}: ${keyState?.configured ? T.keySet : T.keyMissing}`) : null,
        ),
        harness ? null : section.provider === 'custom'
          ? h('div', { style: S.row },
            h('span', { style: S.label }, T.customUrl),
            h('input', { style: { ...S.input, minWidth: '300px' }, value: section.url ?? '', placeholder: 'https://…', onChange: e => patch({ url: e.target.value }) }),
          )
          : h('div', { style: S.row },
            h('span', { style: S.label }, T.baseURL),
            h('input', { style: { ...S.input, minWidth: '260px' }, value: section.baseURL ?? '', placeholder: meta.defaultBaseURL ?? '', onChange: e => patch({ baseURL: e.target.value }) }),
          ),
        h('div', { style: S.row },
          h('span', { style: S.label }, T.model),
          h('input', { style: { ...S.input, minWidth: '220px' }, value: section.model ?? '', placeholder: meta.defaultModel ?? '', onChange: e => patch({ model: e.target.value }) }),
          section.provider === 'custom' ? null : h('button', { style: S.btn, onClick: pull, disabled: pulling }, pulling ? T.fetching : T.fetchModels),
          kind === 'image' ? h('span', { style: S.label }, T.size) : null,
          kind === 'image' ? h('input', { style: { ...S.input, width: '110px' }, value: section.size ?? '', placeholder: '1024x1024', onChange: e => patch({ size: e.target.value }) }) : null,
          kind === 'tts' ? h('span', { style: S.label }, T.voice) : null,
          kind === 'tts' ? h('input', { style: { ...S.input, width: '190px' }, value: section.voice ?? '', placeholder: meta.defaultVoice ?? '', onChange: e => patch({ voice: e.target.value }) }) : null,
          kind === 'video' ? h('span', { style: S.label }, T.videoSize) : null,
          // One field, two keys: Sora reads `size` (1280x720), Veo and MiniMax read `resolution`
          // (720p / 768P). Whichever shape the user types is written to the field that reads it.
          kind === 'video' ? h('input', {
            style: { ...S.input, width: '140px' }, value: section.size || section.resolution || '', placeholder: '1280x720 / 768P',
            onChange: e => {
              const value = e.target.value.trim()
              patch(/^\d+x\d+$/.test(value) ? { size: value, resolution: '' } : { size: '', resolution: value })
            },
          }) : null,
          kind === 'stt' ? h('span', { style: S.label }, T.language) : null,
          kind === 'stt' ? h('input', { style: { ...S.input, width: '80px' }, value: section.language ?? '', placeholder: 'zh', onChange: e => patch({ language: e.target.value }) }) : null,
        ),
        models !== null ? h('div', { style: S.row },
          models.length === 0 ? h('span', { style: S.note }, T.noModels) : h('select', {
            style: { ...S.input, minWidth: '320px' }, value: '',
            onChange: e => { if (e.target.value) patch({ model: e.target.value }) },
          },
          h('option', { value: '' }, T.modelsNote(models.length)),
          models.map(m => h('option', { key: m.id, value: m.id }, m.id + priceOf(m))),
          ),
        ) : null,
        kind === 'tts' ? h('div', { style: S.row },
          h('span', { style: S.label }, T.voicePreset),
          h('select', {
            style: { ...S.input, minWidth: '170px' }, value: presetSel,
            onChange: e => { setPresetSel(e.target.value); const p = (section.voicePresets ?? []).find(x => x.name === e.target.value); if (p) patch({ voice: p.voice }) },
          },
          h('option', { value: '' }, T.presetApply),
          (section.voicePresets ?? []).map(p => h('option', { key: p.name, value: p.name }, p.name)),
          ),
          h('button', {
            style: S.btn,
            onClick: () => {
              const name = window.prompt(T.presetName, '')
              if (name === null) return
              const trimmed = name.trim().slice(0, 40)
              if (!trimmed || !(section.voice ?? '').trim()) return
              const list = (section.voicePresets ?? []).filter(p => p.name !== trimmed)
              patch({ voicePresets: [...list, { name: trimmed, voice: section.voice.trim() }] })
              setPresetSel(trimmed)
              setNote(T.presetSaved)
            },
          }, T.presetSaveVoice),
          presetSel ? h('button', { style: S.btn, onClick: () => { patch({ voicePresets: (section.voicePresets ?? []).filter(p => p.name !== presetSel) }); setPresetSel('') } }, T.presetDel) : null,
        ) : null,
        section.provider === 'custom' ? h('div', { style: S.row },
          h('span', { style: S.label }, T.customPath),
          h('input', { style: { ...S.input, width: '190px' }, value: section.resultPath ?? '', placeholder: 'data.0.b64_json', onChange: e => patch({ resultPath: e.target.value }) }),
          h('span', { style: S.label }, T.customType),
          h('select', { style: { ...S.input, width: '110px' }, value: section.resultType ?? 'base64', onChange: e => patch({ resultType: e.target.value }) },
            ['base64', 'url', 'hex', 'binary', 'text'].map(v => h('option', { key: v, value: v }, v)),
          ),
        ) : null,
        keyEnv ? h('div', { style: S.row },
          h('span', { style: S.label }, T.key),
          h('input', { style: { ...S.input, minWidth: '240px' }, type: 'password', value: key, placeholder: keyEnv, onChange: e => setKey(e.target.value) }),
          h('button', {
            style: S.btn,
            // Status only: a full refresh would rebuild the whole draft and wipe every staged
            // edit in all four cards just because a key was saved.
            onClick: async () => { const r = await api('/key', { env: keyEnv, value: key }); setNote(r.ok === false ? T.failed + mm(r.message) : T.saved); setKey(''); await refreshStatus() },
          }, T.keySave),
          h('button', {
            style: S.btn,
            onClick: async () => { if (!window.confirm(`${T.keyDeleteConfirm}(${keyEnv})`)) return; const r = await api('/key', { env: keyEnv, value: '' }); setNote(r.ok === false ? T.failed + mm(r.message) : T.keyDeleted); await refreshStatus() },
          }, T.keyDelete),
        ) : null,
        h('div', { style: S.row },
          h('button', {
            style: S.btn,
            onClick: async () => {
              setNote(T.testing)
              const body = kind === 'tts' ? { kind, text: T.testText } : kind === 'stt' ? null : { kind, prompt: T.testPrompt, seconds: 4 }
              if (!body) { setNote(zh ? '语音识别请在对话里用 transcribe_audio 工具测试' : 'Test transcription from the chat with the transcribe_audio tool'); return }
              const r = await api('/generate', body)
              setNote(r.ok === false ? T.failed + mm(r.message) : `${T.saved} · ${r.ms} ms · ${r.file ?? ''}`)
            },
          }, T.test),
        ),
      )
    }

    function MediaSection() {
      const [status, setStatus] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [dsh, setDsh] = React.useState([])
      const refresh = React.useCallback(async () => {
        const d = await api('/status')
        setStatus(d)
        if (d && d.config) setDraft(JSON.parse(JSON.stringify(d.config)))
      }, [])
      const refreshStatus = React.useCallback(async () => {
        const d = await api('/status')
        if (d && d.ok !== false) setStatus(d)
      }, [])
      React.useEffect(() => { refresh() }, [refresh])
      React.useEffect(() => {
        if (document.getElementById('dsh-suite-style')) return
        const style = document.createElement('style')
        style.id = 'dsh-suite-style'
        style.textContent = '.dsh-suite button:disabled { opacity: .45; cursor: not-allowed }'
          + 'select option, select optgroup { background: var(--dsw-alias-bg-layer-2, #1c1f28); color: var(--dsw-alias-label-primary, #e8ecf5) }'
          + 'select option:checked { background: var(--dsw-alias-state-business-tertiary, rgba(106,163,255,.18)) }'
        document.head.appendChild(style)
      }, [])
      React.useEffect(() => { api('/harness-providers').then(r => setDsh(r.providers ?? [])).catch(() => {}) }, [])
      if (status === null) return h('div', { style: S.note }, '…')
      if (status.ok === false || !draft) return h('div', { style: S.note }, T.offline + ' ' + (status.message ?? ''))
      return h('div', { style: S.section },
        h('div', { style: S.note }, T.hint),
        h('div', { style: S.note }, T.localHint),
        ...KINDS.map(kind => h(KindCard, { key: kind, kind, draft, setDraft, status, refreshStatus, setNote, dsh })),
        h('div', { style: S.row },
          h('span', { style: S.label }, T.tools),
          ...KINDS.map(kind => h('label', { key: kind, style: { ...S.note, display: 'flex', alignItems: 'center', gap: '4px' } },
            h('input', { type: 'checkbox', checked: draft.tools?.[kind] === true, onChange: e => setDraft({ ...draft, tools: { ...draft.tools, [kind]: e.target.checked } }) }),
            T.kinds[kind],
          )),
        ),
        h('label', { style: { ...S.note, display: 'flex', alignItems: 'flex-start', gap: '6px' } },
          h('input', { type: 'checkbox', checked: draft.tools?.prompt !== false, onChange: e => setDraft({ ...draft, tools: { ...draft.tools, prompt: e.target.checked } }) }),
          T.toolsPrompt,
        ),
        h('div', { style: S.row },
          h('span', { style: S.label }, T.keepDays),
          h('input', { style: { ...S.input, width: '70px' }, type: 'number', min: 0, max: 3650, value: draft.keepDays ?? 0, onChange: e => setDraft({ ...draft, keepDays: Number(e.target.value) }) }),
          h('button', {
            style: { ...S.btn, borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' },
            onClick: async () => {
              setNote(T.saving)
              const r = await api('/config', draft)
              if (r.ok === false) setNote(T.failed + mm(r.message))
              else { setNote(T.saved); await refresh() }
            },
          }, T.save),
          note ? h('span', { style: S.note }, note) : null,
        ),
      )
    }

    async function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'media-lab', order: 26, label: T.title }, MediaSection,
      ))
    }

    exports.apply = apply
    // Declared so the client runner mounts this half after the slots service exists (0.1.5 orders by inject).
    exports.inject = ['slots']
    return module.exports
  },
})
