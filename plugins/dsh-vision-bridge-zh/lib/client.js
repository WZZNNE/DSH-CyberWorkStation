// dsh-vision-bridge — browser (client) half.
//
// Top-level Settings section: "Настройки → Vision" with a dropdown of vision
// models. Images attached to a conversation are described automatically at the
// agent boundary by the host half, so no composer action is needed here.
// State is fetched and persisted via the host's /dsh-vision-bridge API, so the
// card is self-contained and does not depend on the settings-scope machinery.
//
// Localization: the plugin registers its own en/ru dictionaries with the DSH
// locale service (ctx.locale.register) and resolves the "active" locale
// through ctx.locale.getSnapshot().active + ctx.locale.subscribe() via
// React.useSyncExternalStore, so the UI switches language live whenever the
// DSH UI locale changes (Settings → Language). Browser language is used only
// as a fallback when the locale service is unavailable.

window.__ModuleLoader__.load({
  id: 'dsh-vision-bridge-zh',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')
    let react_jsx_runtime = require('react/jsx-runtime')

    // #111: core chevron icon with a safe fallback (unprotected require would
    // crash the whole client half if the primitives package is absent).
    let ChevronIcon = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      ChevronIcon = primitives && primitives.IconChevronDownOutline14
    } catch (noPrimitives) {
      ChevronIcon = null
    }
    const FallbackChevron = () =>
      react.createElement('svg', {
        width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true',
        style: { display: 'block' },
      },
        react.createElement('path', {
          d: 'M3 5l4 4 4-4', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    const Chevron = ChevronIcon || FallbackChevron

    // ---------------------------------------------------------------- css
    const css =
      '.vbr{display:flex;flex-direction:column;gap:12px;padding:16px 20px;color:var(--dsw-alias-label-primary);max-width:620px}' +
      '.vbr h2{font-size:16px;font-weight:600;margin:0}' +
      '.vbr p{margin:0;font-size:13px;line-height:1.45}' +
      '.vbr .hint{color:var(--dsw-alias-label-secondary)}' +
      '.vbr .err{color:var(--dsw-alias-state-error-primary)}' +
      '.vbr .ok{color:var(--dsw-alias-state-success-primary)}' +
      '.vbr label{font-size:13px;font-weight:500;display:block;margin-bottom:4px}' +
      '.vbr select, .vbr input[type=text]{width:100%;border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-input-major);border-radius:6px;padding:6px 8px;font-size:13px;min-height:32px;box-sizing:border-box;color-scheme:dark}' +
      '.vbr .row{display:flex;gap:8px;align-items:center;margin-top:8px}' +
      '.vbr-chan{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px;margin-top:8px;display:flex;flex-direction:column;gap:6px}' +
      '.vbr-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none}' +
      '.vbr-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}' +
      '.vbr-card-head-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}' +
      '.vbr-card-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}' +
      '.vbr-card-description{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}' +
      '.vbr-card-chevron{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}' +
      '.vbr-card-open .vbr-card-chevron{transform:rotate(180deg)}' +
      '.vbr-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}' +
      '.vbr-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}' +
      '.vbr button, .vbr select, .vbr input[type=text]{appearance:none;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px;font-size:13px;color-scheme:dark}' +
      '.vbr button, .vbr select{height:34px}' +
      '.vbr button.primary{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}' +
      '.vbr button:disabled{opacity:.5;cursor:default}' +
      '.vbr input[type=text]{height:34px}'
    const tagId = 'dsh-vision-bridge/settings-card.module.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-vision-bridge'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // -------------------------------------------------------------- i18n
    const NS = 'dsh-vision-bridge'

    const en = {
      title: 'Vision',
      subtitle: 'Images in chat are processed by the vision model you choose here. Leave both fields empty to auto-pick the first vision-capable model from the catalog.',
      provider: 'Vision provider',
      model: 'Vision model',
      auto: 'Auto',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      reset: 'Reset (auto)',
      failed: 'Failed to load/save',
      reqBoth: 'Pick both provider and model, or leave both empty for auto',
      modelInvalid: 'Model does not accept images',
      current: 'Current: {provider} / {model}',
      currentAuto: 'Auto (auto-pick)',
      noVisionModels: 'No vision models in the catalog (input: [text, image]) — add one in Settings → Models.',
      loading: '…',
      mode: 'Mode',
      modeHybrid: 'Hybrid (auto-rewrite + tools)',
      modeLlm: 'LLM only (auto-rewrite, tools still available)',
      modeTools: 'Tools only (no auto-rewrite, model must call describe_image)',
      describeStrategy: 'Describe strategy',
      strategyAuto: 'Auto (use vision LLM)',
      strategyLlm: 'Vision LLM',
      strategyOcrLocal: 'Local OCR (reserved)',
      strategyCacheOnly: 'Cache only (no network)',
      escalation: 'Escalation',
      escalationSimple: 'Simple only (one pass)',
      escalationAuto: 'Auto-escalate (second pass on complex images)',
      advanced: 'Advanced',
      channels: 'Channels',
      channelsHint: 'Extra vision endpoints (OpenAI-compatible, Ollama, custom). Empty — auto-pick from catalog.',
      addChannel: 'Add channel',
      remove: 'Remove',
      testVision: 'Test vision',
      testing: 'Testing…',
      testOk: 'OK ({ms}ms)',
      testFail: 'Failed: {err}',
      type: 'Type',
      baseURL: 'Base URL',
      apiKey: 'API key',
      protocol: 'Protocol',
      protocolOpenaiChat: 'openai-chat',
      protocolOpenaiResponses: 'openai-responses',
      requestTemplate: 'Request template',
      responsePath: 'Response path',
      keyOk: 'key OK',
      keyMissing: 'no key',
      keyHidden: 'unknown',
      empty: '-',
      filterProviders: 'Filter providers…',
      presetLocal: 'Preset: Local',
      presetCloud: 'Preset: Cloud',
      presetLmStudio: 'Preset: LM Studio',
      bench: 'Bench',
    }
    const zh = {
      title: '图片理解',
      subtitle: '聊天里的图片先交给这里选定的视觉模型描述,再把描述喂给当前对话模型——非视觉模型也能"看图"。两项都留空则自动挑目录里第一个支持图片输入的模型。',
      provider: '视觉供应商',
      model: '视觉模型',
      auto: '自动',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      reset: '重置(自动)',
      failed: '加载/保存失败',
      reqBoth: '供应商和模型要一起选,或者都留空表示自动',
      modelInvalid: '该模型不接受图片输入',
      current: '当前:{provider} / {model}',
      currentAuto: '自动(自动挑选)',
      noVisionModels: '目录里没有视觉模型(输入含 image)——到 设置 → 模型 里加一个。',
      loading: '…',
      mode: '模式',
      modeHybrid: '混合(自动改写 + 工具)',
      modeLlm: '只用视觉模型(自动改写,工具仍可用)',
      modeTools: '只用工具(不自动改写,模型需调用 describe_image)',
      describeStrategy: '描述策略',
      strategyAuto: '自动(用视觉模型)',
      strategyLlm: '视觉模型',
      strategyOcrLocal: '本地 OCR(预留)',
      strategyCacheOnly: '只用缓存(不联网)',
      escalation: '升级策略',
      escalationSimple: '只做一遍',
      escalationAuto: '自动升级(复杂图片再看一遍)',
      advanced: '高级',
      channels: '通道',
      channelsHint: '额外的视觉接口(OpenAI 兼容、Ollama、自定义)。留空则从目录自动挑。',
      addChannel: '添加通道',
      remove: '删除',
      testVision: '测试看图',
      testing: '测试中…',
      testOk: '正常({ms}ms)',
      testFail: '失败:{err}',
      type: '类型',
      baseURL: '接口地址',
      apiKey: 'API 密钥',
      protocol: '协议',
      protocolOpenaiChat: 'openai-chat',
      protocolOpenaiResponses: 'openai-responses',
      requestTemplate: '请求模板',
      responsePath: '响应路径',
      keyOk: '密钥正常',
      keyMissing: '没有密钥',
      keyHidden: '未知',
      empty: '-',
      filterProviders: '筛选供应商…',
      presetLocal: '预设:本地',
      presetCloud: '预设:云端',
      presetLmStudio: '预设:LM Studio',
      bench: '基准测试',
    }
    const ru = {
      title: 'Vision',
      subtitle: 'Картинки в чате автоматически обрабатывает выбранная vision-модель. Можешь оставить поля пустыми — автоподбор первой vision-модели из каталога.',
      provider: 'Провайдер vision',
      model: 'Vision-модель',
      auto: 'Авто',
      save: 'Сохранить',
      saving: 'Сохранение…',
      saved: 'Сохранено',
      reset: 'Сброс (авто)',
      failed: 'Не удалось загрузить/сохранить',
      reqBoth: 'Укажите и провайдера, и модель — или оба пустые для автоподбора',
      modelInvalid: 'Модель не принимает изображения',
      current: 'Сейчас: {provider} / {model}',
      currentAuto: 'Авто (используется автоподбор)',
      noVisionModels: 'В каталоге нет vision-моделей (input: [text, image]) — добавьте vision-модель в Настройки → Модели.',
      loading: '…',
      mode: 'Режим',
      modeHybrid: 'Гибрид (авто-подмена + tools)',
      modeLlm: 'Только LLM (авто-подмена, tools доступны)',
      modeTools: 'Только tools (без авто-подмены, модель сама вызывает describe_image)',
      describeStrategy: 'Стратегия описания',
      strategyAuto: 'Авто (vision-LLM)',
      strategyLlm: 'Vision-LLM',
      strategyOcrLocal: 'Локальный OCR (резерв)',
      strategyCacheOnly: 'Только кэш (без сети)',
      escalation: 'Эскалация',
      escalationSimple: 'Простой (один проход)',
      escalationAuto: 'Авто-эскалация (второй проход для сложных)',
      advanced: 'Дополнительно',
      channels: 'Каналы',
      channelsHint: 'Доп. vision-эндпоинты (OpenAI-совместимые, Ollama, custom). Пусто — автоподбор из каталога.',
      addChannel: 'Добавить канал',
      remove: 'Удалить',
      testVision: 'Проверить vision',
      testing: 'Проверка…',
      testOk: 'OK ({ms}ms)',
      testFail: 'Ошибка: {err}',
      type: 'Тип',
      baseURL: 'Базовый URL',
      apiKey: 'API ключ',
      protocol: 'Протокол',
      protocolOpenaiChat: 'openai-chat',
      protocolOpenaiResponses: 'openai-responses',
      requestTemplate: 'Шаблон запроса',
      responsePath: 'Путь ответа',
      keyOk: 'ключ задан',
      keyMissing: 'нет ключа',
      keyHidden: 'неизвестно',
      empty: '-',
      filterProviders: 'Фильтр провайдеров…',
      presetLocal: 'Пресет: Локально',
      presetCloud: 'Пресет: Облако',
      presetLmStudio: 'Пресет: LM Studio',
      bench: 'Бенч',
    }

    function useActiveLocale(ctx) {
      return react.useSyncExternalStore(
        react.useMemo(() => (cb) => (ctx && ctx.locale ? ctx.locale.subscribe(cb) : () => {}), [ctx]),
        react.useCallback(() => {
          if (ctx && ctx.locale) {
            const active = ctx.locale.getSnapshot().active
            if (typeof active === 'string' && active) return active
          }
          return typeof navigator !== 'undefined' ? String(navigator.language || '').slice(0, 2) : ''
        }, [ctx])
      )
    }

    function makeT(DICT, fallbackKeys) {
      return (key, vars) => {
        let s = (DICT && DICT[key]) || (fallbackKeys && fallbackKeys[key]) || key
        if (vars) {
          for (const k of Object.keys(vars)) s = String(s).replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]))
        }
        return s
      }
    }

    // -------------------------------------------------------------- helpers
    async function api(method, body) {
      const res = await fetch('/dsh-vision-bridge/config', {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      })
      let data = null
      try { data = await res.json() } catch {}
      return { ok: res.ok, status: res.status, data }
    }
    async function fetchModels() {
      try {
        const res = await fetch('/dsh-vision-bridge/models', { cache: 'no-store' })
        if (!res.ok) return []
        const data = await res.json()
        const all = (data && Array.isArray(data.models)) ? data.models : []
        return all
      } catch { return [] }
    }

    // -------------------------------------------------------------- component
    function VisionSection(props) {
      const DICT = props.locale === 'ru' ? ru : String(props.locale ?? '').toLowerCase().startsWith('zh') ? zh : en
      const locale = props.locale
      const t = makeT(DICT, en)
      const [models, setModels] = react.useState([])
      const [allModels, setAllModels] = react.useState([])
      const [err, setErr] = react.useState(null)
      const [loaded, setLoaded] = react.useState(false)
      const [provider, setProvider] = react.useState('')
      const [model, setModel] = react.useState('')
      const [providerFilter, setProviderFilter] = react.useState('')
      const [stats, setStats] = react.useState(null)
      const [bench, setBench] = react.useState(null)
      const [benching, setBenching] = react.useState(false)
      const [submittedProvider, setSubmittedProvider] = react.useState('')
      const [submittedModel, setSubmittedModel] = react.useState('')
      const [mode, setMode] = react.useState('hybrid')
      const [describeStrategy, setDescribeStrategy] = react.useState('auto')
      const [escalation, setEscalation] = react.useState('simple-only')
      const [submittedMode, setSubmittedMode] = react.useState('hybrid')
      const [submittedDescribeStrategy, setSubmittedDescribeStrategy] = react.useState('auto')
      const [submittedEscalation, setSubmittedEscalation] = react.useState('simple-only')
      const [channels, setChannels] = react.useState([])
      const [probe, setProbe] = react.useState([])
      const [status, setStatus] = react.useState(null)
      const [saving, setSaving] = react.useState(false)
      const [testing, setTesting] = react.useState(false)
      const [testResult, setTestResult] = react.useState(null)

      const load = async () => {
        try {
          const [cfg, list, ch] = await Promise.all([api('GET'), fetchModels(), fetch('/dsh-vision-bridge/channels', { cache: 'no-store' }).then((r) => r.json().catch(() => ({})))])
          setAllModels(list)
          const visionList = list.filter((m) => m && m.vision)
          setModels(visionList)
          const d = cfg.data || {}
          setProvider(d.provider ? d.provider : '')
          setModel(d.model ? d.model : '')
          setSubmittedProvider(d.provider ? d.provider : '')
          setSubmittedModel(d.model ? d.model : '')
          setMode(d.mode || 'hybrid')
          setDescribeStrategy(d.describeStrategy || 'auto')
          setEscalation(d.escalation || 'simple-only')
          setSubmittedMode(d.mode || 'hybrid')
          setSubmittedDescribeStrategy(d.describeStrategy || 'auto')
          setSubmittedEscalation(d.escalation || 'simple-only')
          if (Array.isArray(ch && ch.channels)) setChannels(ch.channels)
          if (Array.isArray(ch && ch.probe)) setProbe(ch.probe)
          if (visionList.length === 0) setErr(t('failed'))
          setLoaded(true)
        } catch (e) {
          setErr(String((e && e.message) || e))
          setLoaded(true)
        }
      }
      react.useEffect(() => { load(); loadStats() }, [])

      const saveChannels = async () => {
        setSaving(true); setStatus(null)
        try {
          const res = await fetch('/dsh-vision-bridge/channels', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({channels}),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
          if (Array.isArray(data.channels)) setChannels(data.channels)
          // refresh probe
          const pr = await fetch('/dsh-vision-bridge/channels', {cache: 'no-store'}).then((r) => r.json().catch(() => ({})))
          if (Array.isArray(pr && pr.probe)) setProbe(pr.probe)
          setStatus({kind: 'ok', msg: t('saved')})
        } catch (e) {
          setStatus({kind: 'err', msg: String((e && e.message) || e) || t('failed')})
        } finally { setSaving(false) }
      }
      const runTest = async () => {
        setTesting(true); setTestResult(null)
        try {
          const res = await fetch('/dsh-vision-bridge/test', {method: 'POST'})
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !(data && data.ok)) {
            const err = (data && (data.error || data.text)) || ('HTTP ' + res.status)
            setTestResult({ok: false, msg: t('testFail', {err: String(err)})})
            return
          }
          setTestResult({ok: true, msg: t('testOk', {ms: data.latencyMs})})
        } catch (e) {
          setTestResult({ok: false, msg: t('testFail', {err: String((e && e.message) || e)})})
        } finally { setTesting(false) }
      }
      const updateChannel = (i, patch) => {
        setChannels((prev) => prev.map((c, idx) => idx === i ? {...c, ...patch} : c))
      }
      const addChannel = (type) => {
        const seed = type === 'dsh-catalog' ? {type, provider: '', model: ''}
          : type === 'ollama' ? {type, baseURL: 'http://localhost:11434/v1', model: ''}
          : type === 'custom' ? {type, baseURL: '', model: '', requestTemplate: '', responsePath: ''}
          : {type, baseURL: '', model: ''}
        setChannels((prev) => [...prev, seed])
      }
      const removeChannel = (i) => {
        setChannels((prev) => prev.filter((_, idx) => idx !== i))
      }

      // Block B (0.3.6): provider filter, usageStats, bench, presets.
      const loadStats = async () => {
        try { const r = await fetch('/dsh-vision-bridge/stats', { cache: 'no-store' }); setStats((await r.json().catch(() => ({}))).channels || {}) } catch {}
      }
      const runBench = async () => {
        setBenching(true); setBench(null)
        try { const r = await fetch('/dsh-vision-bridge/bench', { method: 'POST' }); setBench((await r.json().catch(() => ({}))).channels || []) } catch {}
        finally { setBenching(false) }
      }
      const applyPreset = async (kind) => {
        // ponytail: presets set mode/nativePassthrough via /config (reliable);
        // channels are added manually via the Channels editor.
        const body = kind === 'local'
          ? { mode: 'hybrid', nativePassthrough: 'prefer' }
          : kind === 'cloud'
            ? { mode: 'hybrid', nativePassthrough: 'prefer' }
            : kind === 'lmstudio'
              ? { mode: 'hybrid', nativePassthrough: 'prefer' }
              : { mode: 'hybrid', nativePassthrough: 'prefer' }
        const res = await api('POST', body)
        if (!res.ok) { setStatus({ kind: 'err', msg: (res.data && res.data.error) || 'preset failed' }); return }
        // LM Studio preset also adds a channel pointing at localhost:1234.
        if (kind === 'lmstudio') {
          const lmChannel = { type: 'openai-compatible', baseURL: 'http://localhost:1234/v1', model: '', apiKey: '' }
          setChannels((prev) => {
            if (prev.some((c) => c.baseURL === 'http://localhost:1234/v1')) return prev
            return [...prev, lmChannel]
          })
        }
        setStatus({ kind: 'ok', msg: t('saved') })
      }
      // #117: provider dropdown must only list providers that actually have a
      // vision-capable model — `models` is already filtered to vision-only,
      // so use it here too (was `allModels`, which let text-only providers in).
      const providers = Array.from(new Set(models.map((m) => String(m.provider))))
      const filteredProviders = providerFilter ? providers.filter((p) => p.toLowerCase().includes(providerFilter.toLowerCase())) : providers
      // Block 0.3.9 (#64): group providers into cloud/local/custom optgroups.
      const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'llamacpp', 'vllm-local'])
      const CUSTOM_PROVIDERS = new Set(['custom', 'openai-compatible'])
      const providerKind = (p) => {
        const s = String(p).toLowerCase()
        if (LOCAL_PROVIDERS.has(s)) return 'local'
        if (CUSTOM_PROVIDERS.has(s) || s.includes('custom')) return 'custom'
        return 'cloud'
      }
      const grouped = { cloud: [], local: [], custom: [] }
      for (const p of filteredProviders) grouped[providerKind(p)].push(p)
      const groupLabels = locale === 'ru'
        ? { cloud: 'Облачные', local: 'Локальные', custom: 'Свои эндпоинты' }
        : { cloud: 'Cloud', local: 'Local', custom: 'Custom endpoints' }

      const dirty = provider !== submittedProvider
        || model !== submittedModel
        || mode !== submittedMode
        || describeStrategy !== submittedDescribeStrategy
        || escalation !== submittedEscalation
      const modelsForProvider = provider ? models.filter((m) => m.provider === provider) : []

      const save = async () => {
        if ((provider && !model) || (!provider && model)) {
          setStatus({ kind: 'err', msg: t('reqBoth') })
          return
        }
        setSaving(true); setStatus(null)
        try {
          const res = await api('POST', { provider, model, mode, describeStrategy, escalation })
          if (!res.ok) {
            const m = (res.data && (res.data.error || res.data.message)) || (res.status + '')
            throw new Error(typeof m === 'string' ? m : JSON.stringify(m))
          }
          setSubmittedProvider(provider); setSubmittedModel(model)
          setSubmittedMode(mode); setSubmittedDescribeStrategy(describeStrategy); setSubmittedEscalation(escalation)
          setStatus({ kind: 'ok', msg: t('saved') })
        } catch (e) {
          setStatus({ kind: 'err', msg: String((e && e.message) || e) || t('failed') })
        } finally { setSaving(false) }
      }
      const reset = async () => {
        setSaving(true); setStatus(null)
        try {
          const res = await api('POST', { provider: '', model: '', mode: '', describeStrategy: '', escalation: '' })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          setProvider(''); setModel('')
          setSubmittedProvider(''); setSubmittedModel('')
          setMode('hybrid'); setSubmittedMode('hybrid')
          setDescribeStrategy('auto'); setSubmittedDescribeStrategy('auto')
          setEscalation('simple-only'); setSubmittedEscalation('simple-only')
          setStatus({ kind: 'ok', msg: t('reset') })
        } catch (e) {
          setStatus({ kind: 'err', msg: String((e && e.message) || e) || t('failed') })
        } finally { setSaving(false) }
      }

      const detail = submittedProvider && submittedModel
        ? t('current', { provider: submittedProvider, model: submittedModel })
        : t('currentAuto')

      return react_jsx_runtime.jsxs('div', { className: 'vbr', children: [
        react_jsx_runtime.jsx('h2', { children: t('title') }),
        react_jsx_runtime.jsx('p', { className: 'hint', children: t('subtitle') }),
        loaded ? react_jsx_runtime.jsxs('div', { children: [
          react_jsx_runtime.jsx('label', { children: t('mode') }),
          react_jsx_runtime.jsxs('select', {
            value: mode,
            onChange: (e) => setMode(e.target.value),
            children: [
              react_jsx_runtime.jsx('option', { value: 'hybrid', children: t('modeHybrid') }),
              react_jsx_runtime.jsx('option', { value: 'llm', children: t('modeLlm') }),
              react_jsx_runtime.jsx('option', { value: 'tools', children: t('modeTools') }),
            ],
          }),
        ] }) : null,
        loaded ? react_jsx_runtime.jsxs('div', { children: [
          react_jsx_runtime.jsx('label', { children: t('describeStrategy') }),
          react_jsx_runtime.jsxs('select', {
            value: describeStrategy,
            onChange: (e) => setDescribeStrategy(e.target.value),
            children: [
              react_jsx_runtime.jsx('option', { value: 'auto', children: t('strategyAuto') }),
              react_jsx_runtime.jsx('option', { value: 'llm', children: t('strategyLlm') }),
              react_jsx_runtime.jsx('option', { value: 'ocr-local', children: t('strategyOcrLocal') }),
              react_jsx_runtime.jsx('option', { value: 'cache-only', children: t('strategyCacheOnly') }),
            ],
          }),
        ] }) : null,
        loaded ? react_jsx_runtime.jsxs('div', { children: [
          react_jsx_runtime.jsx('label', { children: t('escalation') }),
          react_jsx_runtime.jsxs('select', {
            value: escalation,
            onChange: (e) => setEscalation(e.target.value),
            children: [
              react_jsx_runtime.jsx('option', { value: 'simple-only', children: t('escalationSimple') }),
              react_jsx_runtime.jsx('option', { value: 'auto-escalate', children: t('escalationAuto') }),
            ],
          }),
        ] }) : null,
        !loaded
          ? react_jsx_runtime.jsx('p', { className: 'hint', children: t('loading') })
          : null,
        err
          ? react_jsx_runtime.jsx('p', { className: 'err', children: t('failed') + ': ' + err })
          : null,
        loaded && models.length === 0
          ? react_jsx_runtime.jsx('p', { className: 'err', children: t('noVisionModels') })
          : null,
        loaded && models.length > 0 ? react_jsx_runtime.jsxs('div', { children: [
          react_jsx_runtime.jsx('input', { type: 'text', placeholder: t('filterProviders'), value: providerFilter, onChange: (e) => setProviderFilter(e.target.value) }),
          react_jsx_runtime.jsx('label', { children: t('provider') }),
          react_jsx_runtime.jsxs('select', {
            value: provider,
            onChange: (e) => { setProvider(e.target.value); setModel('') },
            children: [
              react_jsx_runtime.jsx('option', { value: '', children: t('auto') }),
              ['cloud', 'local', 'custom'].filter((k) => grouped[k].length > 0).map((k) =>
                react_jsx_runtime.jsxs('optgroup', { label: groupLabels[k], children:
                  grouped[k].map((p) => react_jsx_runtime.jsx('option', { value: p, children: p }, p))
                }, k)
              ),
            ],
          }),
        ] }) : null,
        loaded && provider ? react_jsx_runtime.jsxs('div', { children: [
          react_jsx_runtime.jsx('label', { children: t('model') }),
          react_jsx_runtime.jsxs('select', {
            value: model,
            onChange: (e) => setModel(e.target.value),
            children: modelsForProvider.length > 0 ? [
              react_jsx_runtime.jsx('option', { value: '', children: t('auto') }),
              modelsForProvider.map((m) => react_jsx_runtime.jsx('option', { value: m.model, children: m.model }, m.model)),
            ] : [
              react_jsx_runtime.jsx('option', { value: '', children: '— no vision models for this provider —' }),
            ],
          }),
        ] }) : null,
        react_jsx_runtime.jsx('p', { className: 'hint', children: detail }),
        status ? react_jsx_runtime.jsx('p', { className: status.kind === 'ok' ? 'ok' : 'err', children: status.msg }) : null,
        react_jsx_runtime.jsxs('div', { className: 'row', children: [
          react_jsx_runtime.jsx('button', { className: 'primary', disabled: saving || !dirty, onClick: save, children: saving ? t('saving') : t('save') }),
          (submittedProvider || submittedModel) ? react_jsx_runtime.jsx('button', { disabled: saving, onClick: reset, children: t('reset') }) : null,
        ] }),
        react_jsx_runtime.jsxs('div', { className: 'row', children: [
          react_jsx_runtime.jsx('button', { onClick: () => applyPreset('local'), children: t('presetLocal') }),
          react_jsx_runtime.jsx('button', { onClick: () => applyPreset('cloud'), children: t('presetCloud') }),
          react_jsx_runtime.jsx('button', { onClick: () => applyPreset('lmstudio'), children: t('presetLmStudio') }),
          react_jsx_runtime.jsx('button', { disabled: benching, onClick: runBench, children: benching ? t('testing') : t('bench') }),
        ] }),
        bench ? react_jsx_runtime.jsx('p', { className: 'hint', children: bench.map((b) => `${b.key}: ${b.okCount}/${b.total} ok, ${b.avgLatencyMs}ms avg, ${b.totalTokensIn || 0}+${b.totalTokensOut || 0} tok`).join(', ') }) : null,
        stats ? react_jsx_runtime.jsx('p', { className: 'hint', children: Object.entries(stats).map(([k, v]) => `${k}: ${v.calls} (${v.avgMs}ms, ${v.errors} err)`).join(', ') }) : null,
        loaded ? react_jsx_runtime.jsxs('div', { children: [
          react_jsx_runtime.jsx('h2', { children: t('channels') }),
          react_jsx_runtime.jsx('p', { className: 'hint', children: t('channelsHint') }),
          channels.length === 0 ? react_jsx_runtime.jsx('p', { className: 'hint', children: t('empty') }) : null,
          channels.map((c, i) => {
            const dot = probe[i]
            const dotColor = dot && dot.hasKey ? 'ok' : (dot && dot.key === '' && (c.type === 'ollama' || c.type === 'dsh-catalog') ? 'ok' : 'err')
            const dotText = dot && dot.hasKey ? t('keyOk') : (dot && dot.key === '' && (c.type === 'ollama' || c.type === 'dsh-catalog') ? t('keyOk') : t('keyMissing'))
            return react_jsx_runtime.jsxs('div', { className: 'vbr-chan', children: [
              react_jsx_runtime.jsxs('div', { className: 'row', children: [
                react_jsx_runtime.jsxs('select', {
                  value: c.type || 'openai-compatible',
                  onChange: (e) => updateChannel(i, {type: e.target.value}),
                  children: [
                    react_jsx_runtime.jsx('option', { value: 'dsh-catalog', children: 'dsh-catalog' }),
                    react_jsx_runtime.jsx('option', { value: 'openai-compatible', children: 'openai-compatible' }),
                    react_jsx_runtime.jsx('option', { value: 'ollama', children: 'ollama' }),
                    react_jsx_runtime.jsx('option', { value: 'custom', children: 'custom' }),
                  ],
                }),
                react_jsx_runtime.jsx('button', { disabled: saving, onClick: () => removeChannel(i), children: t('remove') }),
              ] }),
              (c.type === 'openai-compatible' || c.type === 'custom' || c.type === 'ollama') ? react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('label', { children: t('baseURL') }),
                react_jsx_runtime.jsx('input', { type: 'text', value: c.baseURL || '', onChange: (e) => updateChannel(i, {baseURL: e.target.value}) }),
              ] }) : null,
              react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('label', { children: t('model') }),
                react_jsx_runtime.jsx('input', { type: 'text', value: c.model || '', onChange: (e) => updateChannel(i, {model: e.target.value}) }),
              ] }),
              c.type === 'dsh-catalog' ? react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('label', { children: t('provider') }),
                react_jsx_runtime.jsx('input', { type: 'text', value: c.provider || '', onChange: (e) => updateChannel(i, {provider: e.target.value}) }),
              ] }) : null,
              c.type !== 'dsh-catalog' && c.type !== 'ollama' ? react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('label', { children: t('apiKey') }),
                react_jsx_runtime.jsx('input', { type: 'text', value: c.apiKey || '', onChange: (e) => updateChannel(i, {apiKey: e.target.value}) }),
              ] }) : null,
              c.type === 'custom' ? react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('label', { children: t('requestTemplate') }),
                react_jsx_runtime.jsx('input', { type: 'text', value: c.requestTemplate || '', onChange: (e) => updateChannel(i, {requestTemplate: e.target.value}) }),
              ] }) : null,
              c.type === 'custom' ? react_jsx_runtime.jsxs('div', { children: [
                react_jsx_runtime.jsx('label', { children: t('responsePath') }),
                react_jsx_runtime.jsx('input', { type: 'text', value: c.responsePath || '', onChange: (e) => updateChannel(i, {responsePath: e.target.value}) }),
              ] }) : null,
              react_jsx_runtime.jsx('p', { className: dotColor, children: dotText }),
            ] }, i)
          }),
          react_jsx_runtime.jsxs('div', { className: 'row', children: [
            react_jsx_runtime.jsxs('select', {
              id: 'vbr-add-type',
              defaultValue: 'openai-compatible',
              children: [
                react_jsx_runtime.jsx('option', { value: 'dsh-catalog', children: 'dsh-catalog' }),
                react_jsx_runtime.jsx('option', { value: 'openai-compatible', children: 'openai-compatible' }),
                react_jsx_runtime.jsx('option', { value: 'ollama', children: 'ollama' }),
                react_jsx_runtime.jsx('option', { value: 'custom', children: 'custom' }),
              ],
            }),
            react_jsx_runtime.jsx('button', {
              onClick: () => {
                const sel = document.getElementById('vbr-add-type')
                addChannel(sel ? sel.value : 'openai-compatible')
              },
              children: t('addChannel'),
            }),
            react_jsx_runtime.jsx('button', { className: 'primary', disabled: saving, onClick: saveChannels, children: t('save') }),
          ] }),
          react_jsx_runtime.jsxs('div', { className: 'row', children: [
            react_jsx_runtime.jsx('button', { disabled: testing, onClick: runTest, children: testing ? t('testing') : t('testVision') }),
            testResult ? react_jsx_runtime.jsx('p', { className: testResult.ok ? 'ok' : 'err', children: testResult.msg }) : null,
          ] }),
        ] }) : null,
      ] })
    }

      // #111: single-fire guard — the entry point can be invoked twice (e.g.
      // when a service is checked before it exists); without a flag we'd mount
      // two independent states that drift apart.
      let applied = false
      function apply(ctx) {
        if (applied) return
        applied = true
        // Register the plugin's own dictionaries so the DSH locale service can
        // bind its namespace and the UI follows the active UI language live.
        ctx.effect(() => ctx.locale.register(NS, { en, ru, zh }), 'dsh-vision-bridge: dictionaries')
        // One language source for the labels outside React: the dsh locale service, the browser only as a fallback.
        const uiZh = () => { try { const a = ctx.locale?.getSnapshot?.().active; if (typeof a === 'string' && a) return a.toLowerCase().startsWith('zh') } catch { /* fall through */ } return String(navigator.language ?? '').toLowerCase().startsWith('zh') }
        function useLocale() {
          return useActiveLocale(ctx)
        }
        // #44: collapsible card in Plugins tab `settings.plugin.item` (like Model Sync/Spendmeter).
        // key must equal settings namespace (NS). Fallback to old sidebar section if slot missing.
        function VisionCard(props) {
          const locale = useLocale(); const t = makeT(locale === 'ru' ? ru : String(locale).toLowerCase().startsWith('zh') ? zh : en, en); const [open, setOpen] = react.useState(false)
          return react.createElement('div', { className: 'vbr-card' + (open ? ' vbr-card-open' : '') },
            react.createElement('button', { type: 'button', className: 'vbr-card-header', 'aria-expanded': open, onClick: () => setOpen((v) => !v) },
              react.createElement('span', { className: 'vbr-card-head-text' },
                react.createElement('span', { className: 'vbr-card-name' }, t('title')),
                react.createElement('span', { className: 'vbr-card-description' }, t('subtitle'))),
              react.createElement('span', { className: 'vbr-card-chevron', 'aria-hidden': 'true' }, react.createElement(Chevron))),
            open ? react.createElement('div', { className: 'vbr-body' }, react.createElement(VisionSection, { ...props, locale })) : null)
        }
      const tryPluginItem = () => {
        try {
          ctx.slots.inject('settings.plugin.item', () =>
            ctx.slots.register(
              {
                name: 'settings.plugin.item',
                key: NS,
                locale: NS,
                inject: () => ({ ctx }),
              },
              (props) => react.createElement(VisionCard, props),
            ),
          )
          return true
        } catch {
          return false
        }
      }
      if (!tryPluginItem()) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'vision',
              order: 25,
              label: () => (uiZh() ? '图片理解' : 'Vision'),
            },
            (props) => react.createElement(VisionSection, { ...props, locale: useLocale() }),
          ),
        )
      }
      // Block 6 (0.2.11): composer-bar selector — fetches current mode from /config,
      // cycles hybrid → llm → tools on click, persists via POST /config.
      // ponytail: best-effort slot; graceful fallback to Settings card on old DSH.
      try {
        if (ctx.slots && typeof ctx.slots.inject === 'function') {
          const MODES = ['hybrid', 'llm', 'tools']
          let currentMode = 'hybrid'
          let labelEl = null
          const refresh = async () => {
            try {
              const r = await fetch('/dsh-vision-bridge/config', {cache: 'no-store'})
              const d = await r.json().catch(() => ({}))
              if (typeof d.mode === 'string' && MODES.includes(d.mode)) currentMode = d.mode
              if (labelEl) labelEl.textContent = (uiZh() ? '图片理解: ' : 'Vision: ') + currentMode
            } catch {}
          }
          ctx.slots.inject('composer.action', () =>
            ctx.slots.register(
              {
                name: 'composer.action',
                id: 'vision-bridge-mode',
                order: 30,
                label: () => (uiZh() ? '图片理解: ' : 'Vision: ') + currentMode,
              },
              (props) => {
                const el = react.createElement('button', {
                  onClick: async () => {
                    const next = MODES[(MODES.indexOf(currentMode) + 1) % MODES.length]
                    try {
                      await fetch('/dsh-vision-bridge/config', {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({mode: next}),
                      })
                      currentMode = next
                      if (labelEl) labelEl.textContent = (uiZh() ? '图片理解: ' : 'Vision: ') + currentMode
                    } catch {}
                  },
                  ref: (n) => { if (n && !labelEl) { labelEl = n; refresh() } },
                }, (uiZh() ? '图片理解: ' : 'Vision: ') + currentMode)
                return el
              },
            ),
          )
        }
      } catch (_e) {
        // slot unavailable — graceful fallback to Settings card
      }
    }
    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
