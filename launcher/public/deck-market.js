/** Control Deck v3 (tabs, presets, SillyTavern import/export, web search, safety rules), Local Models page, markets and quick workspace (uses $/$$, api, toast, esc, T and refreshers from app.js). */

// ── Tabs ─────────────────────────────────────────────────────────────────────
function activateTab(name) {
  $$('#deck-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name))
  $$('#view-deck .tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name))
  localStorage.setItem('lc-deck-tab', name)
  // Editable panes are loaded once by refreshDeck (and after a save); switching tabs must not discard unsaved edits.
  if (name === 'sampling') refreshContextSummary()
}
$$('#deck-tabs .tab-btn').forEach(b => b.addEventListener('click', () => activateTab(b.dataset.tab)))
$('#deck-goto-local')?.addEventListener('click', () => $$('.nav-btn').find(b => b.dataset.view === 'local')?.click())

// ── Deck cards (one card per entry; semantics follow SillyTavern) ───────────
const cb = (f, v, label) => '<label class="deck-cb" title="' + f + '"><input type="checkbox" data-f="' + f + '"' + (v ? ' checked' : '') + '> ' + (label ?? f) + '</label>'
const inp = (f, v, w, ph) => '<input class="input" data-f="' + f + '" style="width:' + (w || 90) + 'px" value="' + esc(v ?? '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'
const numi = (f, v, w, ph) => '<input class="input" type="number" data-f="' + f + '" style="width:' + (w || 70) + 'px" value="' + esc(v ?? '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'
const sel = (f, cur, options, w) => '<select class="input" data-f="' + f + '" style="width:' + (w || 120) + 'px">' + options.map(([val, label]) => '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select>'

function deckCard(kind, v = {}) {
  const del = '<button class="btn mini danger deck-del" style="float:right" title="' + T('deck_delete_entry') + '">✕</button>'
  if (kind === 'prompts') {
    return '<div class="deck-card">' + del +
      '<div class="deck-line">' + cb('enabled', v.enabled !== false, T('deck_on')) + ' ' + T('deck_name') + ' ' + inp('name', v.name, 120) + ' order ' + numi('order', v.order ?? 100) +
      ' ' + T('deck_position') + ' ' + sel('position', v.position === 'user-prefix' ? 'user-prefix' : 'system', [['system', T('deck_pos_system')], ['user-prefix', T('deck_pos_user')]], 130) +
      ' ' + T('deck_role') + ' ' + sel('role', ['user', 'assistant'].includes(v.role) ? v.role : 'system', [['system', 'system'], ['user', 'user'], ['assistant', 'assistant']], 100) +
      ' ' + T('deck_interval') + ' ' + numi('interval', v.interval ?? 1) + '</div>' +
      '<textarea class="input" data-f="text" style="width:96%;min-height:44px" placeholder="' + T('deck_prompt_ph') + '">' + esc(v.text ?? '') + '</textarea></div>'
  }
  if (kind === 'regex') {
    const pl = Array.isArray(v.placement) ? v.placement : ['user_input']
    return '<div class="deck-card">' + del +
      '<div class="deck-line">' + cb('enabled', v.enabled !== false, T('deck_on')) + ' ' + T('deck_name') + ' ' + inp('name', v.name, 110) +
      ' ' + cb('pl_user', pl.includes('user_input'), T('deck_pl_user')) + ' ' + cb('pl_wi', pl.includes('world_info'), T('deck_pl_wi')) + ' ' + cb('pl_ai', pl.includes('ai_output'), T('deck_pl_ai')) + '</div>' +
      '<div class="deck-line">find ' + inp('findRegex', v.findRegex ?? v.pattern, 220, T('deck_regex_ph')) + ' flags ' + inp('flags', v.flags ?? 'g', 56) + '</div>' +
      '<div class="deck-line">replace ' + inp('replaceString', v.replaceString ?? v.replace, 220, '{{match}} / $1') + ' ' + T('deck_trim') + ' ' + inp('trimStrings', (v.trimStrings ?? []).join(','), 140) + '</div></div>'
  }
  // lorebook
  const logic = v.selectiveLogic ?? 'andAny'
  return '<div class="deck-card">' + del +
    '<div class="deck-line">' + cb('enabled', v.enabled !== false, T('deck_on')) + ' ' + T('deck_name') + ' ' + inp('name', v.name, 110) + ' ' + cb('constant', v.constant === true, 'constant' + T('deck_constant_hint')) + ' order ' + numi('order', v.order ?? 100) + ' ' + T('deck_prob') + ' ' + numi('probability', v.probability ?? 100) + '</div>' +
    '<div class="deck-line">keys ' + inp('keys', (v.keys ?? v.keywords ?? []).join(','), 240, T('deck_keys_ph')) + ' scanDepth ' + numi('scanDepth', v.scanDepth ?? '', 60, T('deck_global')) + '</div>' +
    '<div class="deck-line">' + T('deck_secondary') + ' ' + inp('secondaryKeys', (v.secondaryKeys ?? []).join(','), 180) +
    ' ' + T('deck_logic') + ' ' + sel('selectiveLogic', logic, [['andAny', 'andAny'], ['andAll', 'andAll'], ['notAny', 'notAny'], ['notAll', 'notAll']], 100) +
    ' caseSensitive ' + sel('caseSensitive', v.caseSensitive === true ? 'true' : v.caseSensitive === false ? 'false' : 'global', [['global', T('deck_global')], ['true', 'on'], ['false', 'off']], 90) + ' wholeWords ' + sel('matchWholeWords', v.matchWholeWords === true ? 'true' : v.matchWholeWords === false ? 'false' : 'global', [['global', T('deck_global')], ['true', 'on'], ['false', 'off']], 90) + '</div>' +
    '<div class="deck-line">' + T('deck_group') + ' ' + inp('group', v.group, 90) + ' ' + T('deck_weight') + ' ' + numi('groupWeight', v.groupWeight ?? 100) + ' ' + cb('prioritize', v.prioritize === true, 'prioritize') + ' ' + cb('useGroupScoring', v.useGroupScoring === true, 'groupScoring') +
    ' sticky ' + numi('sticky', v.sticky ?? 0) + ' cooldown ' + numi('cooldown', v.cooldown ?? 0) + ' delay ' + numi('delay', v.delay ?? 0) + '</div>' +
    '<div class="deck-line">' + cb('excludeRecursion', v.excludeRecursion === true) + ' ' + cb('preventRecursion', v.preventRecursion === true) + ' delayUntilRecursion ' + numi('delayUntilRecursion', v.delayUntilRecursion === true ? 1 : (typeof v.delayUntilRecursion === 'number' ? v.delayUntilRecursion : 0), 60, '0') + ' <span class="dim">' + T('deck_dur_hint') + '</span></div>' +
    '<textarea class="input" data-f="content" style="width:96%;min-height:40px" placeholder="' + T('deck_content_ph') + '">' + esc(v.content ?? '') + '</textarea></div>'
}

function collectCards(selector, kind) {
  return [...document.querySelectorAll(selector + ' > .deck-card')].map(card => {
    const g = f => card.querySelector('[data-f="' + f + '"]')
    const val = f => g(f) ? g(f).value : ''
    const chk = f => g(f) ? g(f).checked : false
    const csv = f => val(f).split(',').map(x => x.trim()).filter(Boolean)
    const numOrUndef = f => (val(f) === '' ? undefined : Number(val(f)))
    if (kind === 'prompts') return { name: val('name'), enabled: chk('enabled'), order: Number(val('order')), text: val('text'), position: val('position'), role: val('role'), interval: Number(val('interval')) || 1 }
    if (kind === 'regex') {
      const placement = []
      if (chk('pl_user')) placement.push('user_input')
      if (chk('pl_wi')) placement.push('world_info')
      if (chk('pl_ai')) placement.push('ai_output')
      return { name: val('name'), enabled: chk('enabled'), findRegex: val('findRegex'), flags: val('flags'), replaceString: val('replaceString'), trimStrings: csv('trimStrings'), placement }
    }
    return {
      name: val('name'), enabled: chk('enabled'), keys: csv('keys'), secondaryKeys: csv('secondaryKeys'), selectiveLogic: val('selectiveLogic'),
      content: val('content'), constant: chk('constant'), probability: Number(val('probability')), order: Number(val('order')), scanDepth: numOrUndef('scanDepth'),
      caseSensitive: val('caseSensitive') === 'global' ? null : val('caseSensitive') === 'true', matchWholeWords: val('matchWholeWords') === 'global' ? null : val('matchWholeWords') === 'true', group: val('group'), groupWeight: Number(val('groupWeight')),
      prioritize: chk('prioritize'), useGroupScoring: chk('useGroupScoring'),
      sticky: Number(val('sticky')), cooldown: Number(val('cooldown')), delay: Number(val('delay')),
      excludeRecursion: chk('excludeRecursion'), preventRecursion: chk('preventRecursion'), delayUntilRecursion: (Number(val('delayUntilRecursion')) || 0) <= 0 ? false : (Number(val('delayUntilRecursion')) === 1 ? true : Math.floor(Number(val('delayUntilRecursion')))),
    }
  })
}

let currentPresetName = ''
let deckWarnings = []
let deckDirty = false // any edit on the deck page since the last load / save
let deckEditVersion = 0
let deckLoadEpoch = 0
let deckSaving = false
let presetReadSerial = 0
let presetSelectionVersion = 0
const markDeckDirty = () => { deckDirty = true; deckEditVersion++ }
const deckReadGuard = () => {
  const version = deckEditVersion
  const epoch = deckLoadEpoch
  return () => version === deckEditVersion && epoch === deckLoadEpoch
}
// These controls choose an operation's parameters; selecting a file must not
// invalidate its own asynchronous reader when change bubbles to this page.
const deckActionInputs = '#deck-import-file, #deck-preset-select, #deck-preset-name, #deck-io-format, #deck-io-merge'
const markDeckInput = event => { if (!event.target.closest?.(deckActionInputs)) markDeckDirty() }
document.querySelector('#view-deck')?.addEventListener('input', markDeckInput)
document.querySelector('#view-deck')?.addEventListener('change', markDeckInput)
$('#deck-preset-select')?.addEventListener('change', () => { presetSelectionVersion++ })
const deckNotice = (zh, en) => window.LANG === 'en' ? en : zh
const deckAppliedWithDraft = () => deckNotice('后端已应用本次操作；等待期间的新输入已保留，尚未保存。再次保存可提交当前草稿。', 'The server applied this operation. New input entered while waiting is preserved and remains unsaved; save again to submit the current draft.')
async function withDeckOperation(action) {
  if (deckSaving) return
  deckSaving = true
  deckLoadEpoch++
  const controls = $$('#deck-save, #deck-preset-save, #deck-preset-load, #deck-preset-delete, #deck-import, #deck-import-file').map(element => [element, element.disabled])
  for (const [element] of controls) element.disabled = true
  try { await action(deckReadGuard()) } catch (error) {
    deckDirty = true
    toast(String(error?.message ?? error))
  } finally {
    deckSaving = false
    for (const [element, disabled] of controls) element.disabled = disabled
  }
}
function fillDeck(deck) {
  $('#deck-prompts').innerHTML = (deck.prompts ?? []).map(v => deckCard('prompts', v)).join('')
  $('#deck-regex').innerHTML = (deck.regex ?? []).map(v => deckCard('regex', v)).join('')
  $('#deck-lore').innerHTML = (deck.lorebook ?? []).map(v => deckCard('lore', v)).join('')
  const s = deck.sampling ?? {}
  const st = deck.settings ?? {}
  $('#deck-sampling-on').checked = s.enabled === true
  $('#deck-temp').value = s.temperature ?? ''
  $('#deck-maxtok').value = s.maxTokens ?? ''
  $('#deck-stop').value = (s.stop ?? []).join(',')
  $('#deck-scandepth').value = st.scanDepth ?? ''
  $('#deck-maxrec').value = st.maxRecursionSteps ?? ''
  $('#deck-budget').value = st.budgetChars ?? ''
  $('#deck-minact').value = st.minActivations ?? ''
  $('#deck-maxdepth').value = st.maxDepth ?? ''
  $('#deck-includenames').checked = st.includeNames === true
  $('#deck-casesensitive').checked = st.caseSensitive === true
  $('#deck-wholewords').checked = st.matchWholeWords !== false
  $('#deck-macros').checked = st.macros !== false
  $('#deck-tools-off').value = (deck.disabledTools ?? []).join(',')
  currentPresetName = typeof deck.presetName === 'string' ? deck.presetName : ''
}
function collectDeck() {
  const num = id => $(id).value === '' ? undefined : Number($(id).value)
  return {
    presetName: currentPresetName,
    prompts: collectCards('#deck-prompts', 'prompts'),
    regex: collectCards('#deck-regex', 'regex'),
    lorebook: collectCards('#deck-lore', 'lore'),
    sampling: { enabled: $('#deck-sampling-on').checked, temperature: num('#deck-temp'), maxTokens: num('#deck-maxtok'), stop: $('#deck-stop').value.split(',').map(x => x.trim()).filter(Boolean) },
    settings: { scanDepth: num('#deck-scandepth'), maxRecursionSteps: num('#deck-maxrec'), budgetChars: num('#deck-budget'), minActivations: num('#deck-minact'), maxDepth: num('#deck-maxdepth'), includeNames: $('#deck-includenames').checked, caseSensitive: $('#deck-casesensitive').checked, matchWholeWords: $('#deck-wholewords').checked, macros: $('#deck-macros').checked },
    disabledTools: $('#deck-tools-off').value.split(',').map(x => x.trim()).filter(Boolean),
  }
}
async function refreshPresets(current = deckReadGuard()) {
  const s = $('#deck-preset-select')
  const request = ++presetReadSerial
  const selection = s.value
  const selectionVersion = presetSelectionVersion
  const stillCurrent = () => request === presetReadSerial && current() && selectionVersion === presetSelectionVersion && s.value === selection
  try {
    const d = await api('/api/deck/presets')
    if (!stillCurrent()) return
    if (!d || d.ok === false || !Array.isArray(d.presets)) { toast(d?.message || T('ws_load_failed')); return }
    s.innerHTML = '<option value="">' + T('deck_preset_none') + '</option>' + d.presets.map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('')
    s.value = selection && d.presets.includes(selection) ? selection : d.presets.includes(d.active) ? d.active : ''
  } catch (error) { if (stillCurrent()) toast(String(error?.message ?? error)) }
}
async function refreshDeckStatus() {
  const st = await api('/api/deck/status')
  const el = $('#deck-status')
  if (!st || st.offline || st.ok === false) { el.textContent = T('deck_status_offline'); return }
  const broken = [...(st.broken?.regex ?? []).map(b => 'regex "' + b.name + '": ' + b.error), ...(st.broken?.sections ?? []).map(b => 'prompt "' + b.name + '": ' + b.error)]
  el.textContent = T('deck_status_live', { p: st.counts?.prompts ?? 0, r: st.counts?.regex ?? 0, l: st.counts?.lorebook ?? 0, t: new Date(st.loadedAt ?? 0).toLocaleTimeString() }) + (st.loadError ? ' ⚠ ' + st.loadError : '') + (broken.length ? ' ⚠ ' + broken.join(' · ') : '') + (deckWarnings.length ? ' ⚠ ' + deckWarnings.join('; ') : '') + ((st.skippedWork ?? []).length ? ' ⚠ ' + T('deck_skipped_patterns', { list: st.skippedWork.join(', ') }) : '')
}
async function refreshDeck() {
  if (deckDirty || deckSaving) { activateTab(localStorage.getItem('lc-deck-tab') || 'prompts'); refreshDeckStatus(); return }
  deckLoadEpoch++
  const current = deckReadGuard()
  const result = await api('/api/deck')
  if (!current()) return
  if (!result || result.ok === false || !result.deck) { toast(result?.message || T('ws_load_failed')); return }
  fillDeck(result.deck)
  activateTab(localStorage.getItem('lc-deck-tab') || 'prompts')
  $('#deck-help-text').textContent = T('deck_help_text')
  refreshPresets(); refreshDeckStatus()
  await Promise.all([refreshWebSearch(current), refreshSafety(current)])
  if (current()) deckDirty = false
}
$('#deck-add-prompt')?.addEventListener('click', () => { $('#deck-prompts').insertAdjacentHTML('beforeend', deckCard('prompts')); markDeckDirty() })
$('#deck-add-regex')?.addEventListener('click', () => { $('#deck-regex').insertAdjacentHTML('beforeend', deckCard('regex')); markDeckDirty() })
$('#deck-add-lore')?.addEventListener('click', () => { $('#deck-lore').insertAdjacentHTML('beforeend', deckCard('lore')); markDeckDirty() })
document.addEventListener('click', e => { if (e.target.closest?.('#view-deck .deck-del')) { e.target.closest('.deck-card').remove(); markDeckDirty() } })
// One button for the whole page: deck file, web-search config and safety rules (each hot-reloaded by its plugin).
$('#deck-save')?.addEventListener('click', () => withDeckOperation(async current => {
  // Snapshot all panes inside the protected action, before its first await.
  const deck = collectDeck()
  const web = wsLoaded ? collectWebSearch() : null
  const safety = sgLoaded ? collectSafety() : null
  const problems = []
  const skipped = []
  const r = await api('/api/deck', deck)
  if (!r || r.ok === false) problems.push(r?.message || T('t_empty'))
  let w = null; let s = null
  if (web) { w = await api('/api/websearch/patch', web); if (!w || w.ok === false) problems.push(w?.message || T('t_empty')) } else skipped.push(T('tab_websearch'))
  if (safety) { s = await api('/api/safeguard', safety); if (!s || s.ok === false) problems.push(s?.message || T('t_empty')) } else skipped.push(T('tab_safety'))
  const skippedNote = skipped.length ? ' · ' + T('deck_save_skipped', { tabs: skipped.join(', ') }) : ''
  const warnNote = Array.isArray(r?.warnings) && r.warnings.length ? ' · ⚠ ' + r.warnings.join('; ') : ''
  deckWarnings = Array.isArray(r?.warnings) ? r.warnings : []
  toast((problems.length ? problems.join(' · ') : (r?.message || T('t_saved'))) + warnNote + skippedNote)
  // re-read only the panes whose own write succeeded (a rejected pane keeps the user's edits on screen)
  if (current()) await Promise.all([w && w.ok !== false ? refreshWebSearch(current) : null, s && s.ok !== false ? refreshSafety(current) : null])
  if (current()) deckDirty = problems.length > 0 || skipped.length > 0
  setTimeout(refreshDeckStatus, 2000)
}))

// ── Presets ──
$('#deck-preset-save')?.addEventListener('click', () => withDeckOperation(async current => {
  const name = $('#deck-preset-name').value.trim() || $('#deck-preset-select').value
  if (!name) return toast(T('deck_preset_name_ph'))
  const saved = await api('/api/deck', { ...collectDeck(), presetName: name })
  if (!saved || saved.ok === false) { deckDirty = true; toast(saved?.message || T('t_empty')); return }
  let r
  try { r = await api('/api/deck/presets/save', { name }) } catch (error) { r = { ok: false, message: String(error?.message ?? error) } }
  if (!r || r.ok === false) {
    deckDirty = true
    toast(deckNotice('当前甲板已保存，但预设保存失败；草稿仍保留：', 'The current deck was saved, but saving the preset failed; the draft is preserved: ') + (r?.message || T('t_empty')))
    return
  }
  if (current()) currentPresetName = name
  toast(current() ? (r.message || T('t_saved')) : deckAppliedWithDraft())
  await refreshPresets(current)
}))
$('#deck-preset-load')?.addEventListener('click', () => withDeckOperation(async current => {
  const name = $('#deck-preset-select').value
  if (!name) return toast(T('deck_preset_pick'))
  const r = await api('/api/deck/presets/load', { name })
  if (!r || r.ok === false || !r.deck) { deckDirty = true; toast(r?.message || T('t_empty')); return }
  if (!current()) { toast(deckAppliedWithDraft()); return }
  fillDeck(r.deck)
  toast(r.message || T('t_saved'))
  await refreshPresets(current)
}))
$('#deck-preset-delete')?.addEventListener('click', () => withDeckOperation(async current => {
  const name = $('#deck-preset-select').value
  if (!name || !confirm(T('deck_preset_delete') + ': ' + name + '?')) return
  const r = await api('/api/deck/presets/delete', { name })
  if (!r || r.ok === false) { deckDirty = true; toast(r?.message || T('t_empty')); return }
  toast(r.message || T('t_saved'))
  await refreshPresets(current)
}))

// ── SillyTavern import / export ──
$('#deck-export')?.addEventListener('click', async () => {
  const format = $('#deck-io-format').value
  const r = await fetch('/api/deck/export?format=' + format, { headers: { 'x-lang': window.LANG, 'x-launcher-token': LAUNCHER_TOKEN } })
  const blob = await r.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'dsh-control-deck-' + format + '-' + new Date().toISOString().slice(0, 10) + '.json'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
})
$('#deck-import')?.addEventListener('click', () => { if (!deckSaving) $('#deck-import-file').click() })
$('#deck-import-file')?.addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return
  try {
    await withDeckOperation(async current => {
      const format = $('#deck-io-format').value
      const merge = $('#deck-io-merge').checked
      let data
      try { data = JSON.parse(await file.text()) } catch { throw new Error(T('io_bad_json')) }
      if (!current()) { toast(deckNotice('读取文件期间草稿已变化，已取消导入；未向后端提交。请确认后重新选择文件。', 'The draft changed while reading the file. Import was cancelled without submitting to the server; review the draft and select the file again.')); return }
      const r = await api('/api/deck/import', { format, data, merge })
      if (!r || r.ok === false || !r.deck) { deckDirty = true; toast(r?.message || T('t_empty')); return }
      if (!current()) { toast(deckAppliedWithDraft()); return }
      fillDeck(r.deck)
      toast(r.message || T('t_saved'))
      await refreshPresets(current)
    })
  } finally { e.target.value = '' }
})

// ── Context summary (sampling tab) ──
async function refreshContextSummary() {
  const box = $('#deck-context-models'); if (!box) return
  const st = await api('/api/local/status')
  if (!st || st.offline || !Array.isArray(st.routes)) { box.textContent = T('local_offline'); return }
  const rows = []
  for (const r of st.routes.filter(x => x.local)) for (const m of r.models) rows.push('<div><code>' + esc(r.route + ' / ' + m.id) + '</code> — contextWindow ' + (m.contextWindow && (m.userSet?.contextWindow || m.contextWindow < 262144) ? '<b>' + m.contextWindow.toLocaleString() + '</b>' : '<span class="warn">' + T('local_ctx_default') + '</span>') + ' · maxTokens ' + (m.maxTokens ?? '—') + (m.backend?.loadedContext ? ' · ' + T('local_backend_ctx') + ' ' + m.backend.loadedContext.toLocaleString() : '') + '</div>')
  box.innerHTML = rows.join('') || T('local_none')
}

// ── Web search tab ──
let wsStatus = null
let wsLoaded = false
let sgLoaded = false
function wsProviderList() {
  const p = wsStatus?.providers
  const base = p && typeof p === 'object' ? Object.entries(p).map(([id, v]) => ({ id, label: v.label, configured: v.configured, needsKey: v.needsKey, needsUrl: v.needsUrl, docs: v.docs, keyEnv: v.keyEnv })) : [
    { id: 'serper', label: 'Serper (Google)', needsKey: true, keyEnv: 'SERPER_API_KEY', docs: 'https://serper.dev' }, { id: 'serpapi', label: 'SerpApi (Google)', needsKey: true, keyEnv: 'SERPAPI_API_KEY', docs: 'https://serpapi.com/search-api' },
    { id: 'tavily', label: 'Tavily', needsKey: true, keyEnv: 'TAVILY_API_KEY', docs: 'https://docs.tavily.com' }, { id: 'brave', label: 'Brave Search', needsKey: true, keyEnv: 'BRAVE_API_KEY', docs: 'https://api-dashboard.search.brave.com' },
    { id: 'searxng', label: 'SearXNG (self-hosted)', needsUrl: true, docs: 'https://docs.searxng.org/dev/search_api.html' }]
  return [...base, { id: 'deepseek-official', label: T('ws_deepseek_official'), needsKey: false, docs: 'https://api-docs.deepseek.com' }]
}
/** The provider-native mode carries a cost note, shown under the mode list. */
function wsRenderModeNote() {
  const box = $('#ws-mode-note')
  if (!box) return
  const mode = $$('input[name="ws-mode"]').find(r => r.checked)?.value ?? 'off'
  // data-t keeps the note translated when the language is switched from the header.
  if (mode === 'provider') { box.dataset.t = 'ws_mode_note_provider'; box.textContent = T('ws_mode_note_provider') } else { delete box.dataset.t; box.textContent = '' }
}
$$('input[name="ws-mode"]').forEach(r => r.addEventListener('change', wsRenderModeNote))
function wsRenderProviderState() {
  const id = $('#ws-provider').value
  const p = wsProviderList().find(x => x.id === id) ?? {}
  $('#ws-key-row').style.display = p.needsKey ? '' : 'none'
  $('#ws-searxng-row').style.display = p.needsUrl ? '' : 'none'
  $('#ws-key-label').textContent = (p.keyEnv ? p.keyEnv : 'API Key')
  $('#ws-provider-docs').href = p.docs || '#'
  const state = $('#ws-provider-state')
  if (!wsStatus || wsStatus.offline) state.textContent = T('ws_state_offline')
  else if (p.needsKey) state.textContent = p.configured ? '✔ ' + T('ws_key_set') : '✖ ' + T('ws_key_missing')
  else if (p.needsUrl) state.textContent = p.configured ? '✔ URL' : '✖ URL'
  else state.textContent = id === 'deepseek-official' ? T('ws_deepseek_note') : ''
}
async function refreshWebSearch(current = deckReadGuard()) {
  const [cfgResp, status] = await Promise.all([api('/api/websearch'), api('/api/websearch/status')])
  if (!current()) return
  wsStatus = status && status.ok === true ? status : null
  if (!cfgResp || cfgResp.ok === false || !cfgResp.config || typeof cfgResp.config !== 'object') { wsLoaded = false; $('#ws-provider-state').textContent = '⚠ ' + (cfgResp?.message || T('ws_load_failed')); return }
  const c = cfgResp.config
  wsConfig = c
  const providers = wsProviderList()
  $('#ws-provider').innerHTML = providers.map(p => '<option value="' + p.id + '"' + (p.id === c.provider ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('')
  $$('input[name="ws-mode"]').forEach(r => { r.checked = r.value === (c.mode ?? 'off') })
  wsRenderModeNote()
  $('#ws-searxng').value = c.searxngUrl ?? ''
  $('#ws-maxresults').value = c.maxResults ?? 6
  $('#ws-cachettl').value = c.cacheTtlSec ?? 300
  $('#ws-fetch').checked = c.fetch?.enabled !== false
  const fs = wsStatus?.fetch
  $('#ws-fetch-state').textContent = !fs ? '' : fs.mounted ? T('ws_fetch_mounted') : T('ws_fetch_down', { r: fs.missing?.length ? fs.missing.join(', ') : ({ 'switched off': T('ws_fetch_r_off'), 'web search mode is off': T('ws_fetch_r_mode') })[fs.reason] ?? fs.reason ?? '' })
  $('#ws-trig-backticks').checked = c.triggers?.backticks !== false
  $('#ws-trig-always').checked = c.triggers?.always === true
  $('#ws-maxwords').value = c.triggers?.maxWords ?? 10
  $('#ws-phrases').value = (c.triggers?.phrases ?? []).join(', ')
  $('#ws-regex').value = c.triggers?.regex ?? ''
  $('#ws-regex-query').value = c.triggers?.regexQuery ?? '$1'
  $('#ws-template').value = c.template ?? ''
  $('#ws-budget').value = c.budgetChars ?? 1500
  $('#ws-visit').value = c.visitLinks ?? 0
  $('#ws-visitchars').value = c.visitChars ?? 1200
  $('#ws-blacklist').value = (c.blacklist ?? []).join(', ')
  wsRenderProviderState()
  wsLoaded = true
}
$('#ws-provider')?.addEventListener('change', wsRenderProviderState)
let wsConfig = null   // the last config read from the server, so a save keeps fields this tab has no UI for
function collectWebSearch() {
  return {
    mode: $$('input[name="ws-mode"]').find(r => r.checked)?.value ?? 'off', provider: $('#ws-provider').value,
    searxngUrl: $('#ws-searxng').value.trim(), maxResults: Number($('#ws-maxresults').value), cacheTtlSec: Number($('#ws-cachettl').value),
    triggers: { backticks: $('#ws-trig-backticks').checked, always: $('#ws-trig-always').checked, maxWords: Number($('#ws-maxwords').value), phrases: $('#ws-phrases').value.split(',').map(x => x.trim()).filter(Boolean), regex: $('#ws-regex').value.trim(), regexQuery: $('#ws-regex-query').value.trim() || '$1' },
    template: $('#ws-template').value, budgetChars: Number($('#ws-budget').value), visitLinks: Number($('#ws-visit').value), visitChars: Number($('#ws-visitchars').value),
    blacklist: $('#ws-blacklist').value.split(',').map(x => x.trim()).filter(Boolean),
    fetch: { enabled: $('#ws-fetch').checked },
  }
}
$('#ws-key-save')?.addEventListener('click', async () => {
  const provider = $('#ws-provider').value
  const value = $('#ws-key').value
  const r = await api('/api/websearch/key', { provider, value })
  if (r.offline) return toast(T('ws_state_offline'))
  toast(r.ok ? (value ? T('ws_key_saved') : T('ws_key_cleared')) : (r.message || T('t_empty')))
  $('#ws-key').value = ''
  const status = await api('/api/websearch/status')
  wsStatus = status && status.ok === true ? status : null
  wsRenderProviderState() // the form keeps whatever the user is editing
})
$('#ws-test')?.addEventListener('click', async () => {
  const query = $('#ws-test-q').value.trim(); if (!query) return toast(T('ws_test_ph'))
  $('#ws-test-out').textContent = T('t_searching')
  const r = await api('/api/websearch/test', { query, provider: $('#ws-provider').value })
  $('#ws-test-out').textContent = r.offline ? T('ws_state_offline') : (r.ok ? (r.ms + ' ms\n\n' + (r.preview ?? '')) : (r.message ?? T('t_empty')))
})

// ── Safety rules tab ──
async function refreshSafety(current = deckReadGuard()) {
  const d = await api('/api/safeguard')
  if (!current()) return
  if (!d || d.ok === false || !d.config || typeof d.config !== 'object') { sgLoaded = false; $('#sg-deny').dataset.ph ??= $('#sg-deny').placeholder; $('#sg-deny').placeholder = '⚠ ' + (d?.message || T('ws_load_failed')); return }
  if ($('#sg-deny').dataset.ph) $('#sg-deny').placeholder = $('#sg-deny').dataset.ph
  $('#sg-deny').value = (d.config.denyPatterns ?? []).join('\n')
  $('#sg-ask').value = (d.config.askPatterns ?? []).join('\n')
  $('#sg-allow').value = (d.config.allowPatterns ?? []).join('\n')
  sgLoaded = true
}
function collectSafety() {
  const lines = el => el.value.split('\n').map(x => x.trim()).filter(Boolean)
  return { denyPatterns: lines($('#sg-deny')), askPatterns: lines($('#sg-ask')), allowPatterns: lines($('#sg-allow')) }
}

// ── Model parameters page (every route; local routes get probing / thinking extras) ──
const KINDS = () => ({ 'effort-levels': T('kind_effort'), 'prompt-toggle': T('kind_toggle'), always: T('kind_always'), 'template-toggle': T('kind_template'), none: T('kind_none') })
const specOf = e => (e === false ? 'false' : (e && typeof e === 'object' ? Object.entries(e).map(([k, v]) => (v === null || v === k ? k : k + '=' + v)).join(',') : ''))
let lastLocalStatus = null
const localDrafts = new Map()
let localInputRevision = 0
let localWriting = false
let localReadSerial = 0
let localMutationEpoch = 0
const localKey = (route, model) => JSON.stringify([route, model])
const localFieldValue = element => element.type === 'checkbox' ? element.checked : element.value
const localUsableStatus = value => value && value.ok !== false && !value.offline && Array.isArray(value.routes)
const localControls = '#local-probe, #local-teach-now, #local-autoteach, #local-routes [data-route-api], #local-routes .local-save, #local-routes .local-rec, #local-routes .local-online'
function syncLocalControls() {
  for (const element of $$(localControls)) {
    element.dataset.localDisabled ??= element.disabled ? '1' : '0'
    element.disabled = localWriting || element.dataset.localDisabled === '1'
  }
}
function localDraftNote() {
  const count = [...localDrafts.values()].reduce((n, fields) => n + fields.size, 0)
  return count ? deckNotice(` · 保留 ${count} 个字段草稿（含筛选隐藏或暂不可用的字段）`, ` · ${count} field draft(s) retained, including filtered or unavailable fields`) : ''
}
function localFailure(message) {
  $('#local-state').textContent = (message || T('local_offline')) + localDraftNote()
}
function rememberLocalInput(event) {
  const field = event.target.closest?.('#local-routes [data-f]')
  const row = field?.closest('tr[data-route][data-model]')
  if (!row) return
  const key = localKey(row.dataset.route, row.dataset.model)
  const fields = localDrafts.get(key) ?? new Map()
  // Even a return to the OLD server value is new intent during an outstanding
  // save. Only a fresh accepted response can establish that it is already saved.
  fields.set(field.dataset.f, { value: localFieldValue(field), revision: ++localInputRevision })
  localDrafts.set(key, fields)
}
document.addEventListener('input', rememberLocalInput)
document.addEventListener('change', rememberLocalInput)
function localSubmission(route, model, fields) {
  const key = localKey(route, model)
  return { key, revisions: new Map(fields.map(field => [field, localDrafts.get(key)?.get(field)?.revision])) }
}
function clearLocalSubmission(submission) {
  if (!submission) return
  const fields = localDrafts.get(submission.key)
  if (!fields) return
  for (const [field, revision] of submission.revisions) {
    if (revision !== undefined && fields.get(field)?.revision === revision) fields.delete(field)
  }
  if (!fields.size) localDrafts.delete(submission.key)
}
function restoreLocalDrafts(fresh) {
  for (const row of $$('#local-routes tr[data-route][data-model]')) {
    const key = localKey(row.dataset.route, row.dataset.model)
    const fields = localDrafts.get(key)
    if (!fields) continue
    for (const field of row.querySelectorAll('[data-f]')) {
      const draft = fields.get(field.dataset.f)
      if (!draft) continue
      if (fresh && draft.value === localFieldValue(field)) { fields.delete(field.dataset.f); continue }
      if (field.type === 'checkbox') field.checked = draft.value
      else field.value = draft.value
    }
    if (!fields.size) localDrafts.delete(key)
  }
}
async function withLocalMutation(action) {
  if (localWriting) return
  localWriting = true
  localMutationEpoch++
  localReadSerial++ // Any earlier status response predates this write.
  syncLocalControls()
  try { await action() } catch (error) {
    localFailure(String(error?.message ?? error)); toast(String(error?.message ?? error))
  } finally {
    localWriting = false
    syncLocalControls()
  }
}
async function finishLocalMutation(result, submission, message) {
  if (!result || result.offline || result.ok === false) {
    const problem = result?.message || T(result?.offline ? 'local_offline' : 't_empty')
    localFailure(problem); toast(problem); return false
  }
  let status = result
  if (!localUsableStatus(status)) {
    try { status = await api('/api/local/status') } catch { status = null }
    if (!localUsableStatus(status)) {
      const notice = deckNotice('操作已提交，但状态刷新失败；字段草稿已保留，请刷新核对。', 'The operation was submitted, but status could not be refreshed. Field drafts are retained; refresh to verify.')
      localFailure(notice); toast(notice); return false
    }
  }
  clearLocalSubmission(submission)
  renderLocal(status, true)
  if (message) toast(message)
  return true
}
function renderLocal(st, fresh = false) {
  if (!localUsableStatus(st)) {
    if (!lastLocalStatus) $('#local-routes').innerHTML = '<div class="help-box">' + T('local_offline') + '</div>'
    localFailure(st?.message || T('local_offline'))
    return
  }
  const focused = document.activeElement
  const focusedRow = focused?.closest?.('#local-routes tr[data-route][data-model]')
  const focus = focusedRow && focused.dataset.f ? { key: localKey(focusedRow.dataset.route, focusedRow.dataset.model), field: focused.dataset.f, start: focused.selectionStart, end: focused.selectionEnd } : null
  lastLocalStatus = st
  const q = ($('#local-filter')?.value ?? '').trim().toLowerCase()
  const box = $('#local-routes')
  $('#local-autoteach').checked = st.autoTeach !== false
  const kinds = KINDS()
  const routeCard = r => {
    const head = '<div class="route-head"><b>' + esc(r.displayName || r.route) + '</b> <code>' + esc(r.route) + '</code> ' + (r.baseURL ? '<span class="dim">' + esc(r.baseURL) + '</span> ' : '') +
      (r.local ? '<span class="tag ' + (r.backend ? 'ok' : 'warn') + '" title="' + esc(r.probeError ?? '') + '">' + (r.backend ? r.backend : (r.probedAt ? T('local_no_answer') : T('local_not_probed'))) + '</span>' +
        ' <span class="dim">api</span> <select class="input" data-route-api="' + esc(r.route) + '" style="width:180px;margin:0"><option value="openai-completions"' + (r.api === 'openai-completions' ? ' selected' : '') + '>openai-completions</option><option value="openai-responses"' + (r.api === 'openai-responses' ? ' selected' : '') + '>openai-responses</option></select>' : (r.api ? ' <span class="dim">api ' + esc(r.api) + '</span>' : '')) +
      (!r.editable ? ' <span class="tag warn">' + T('local_readonly') + '</span>' : '') + '</div>'
    const shown = q ? r.models.filter(m => m.id.toLowerCase().includes(q) || String(m.name ?? '').toLowerCase().includes(q)) : r.models
    // OpenRouter web search: `<model>:online` variants (OpenRouter docs: features/web-search); only routes with their own models list qualify
    const onlineBtn = m => {
      if (!r.onlineEligible || !r.editable) return ''
      if (m.id.endsWith(':online')) return ' <button class="btn mini local-online" data-action="remove" title="' + esc(T('local_online_title')) + '">' + T('local_online_remove') + '</button>'
      if (r.models.some(x => x.id === m.id + ':online')) return ''
      return ' <button class="btn mini local-online" data-action="add" title="' + esc(T('local_online_title')) + '">' + T('local_online_add') + '</button>'
    }
    const rows = shown.map(m => {
      const rec = m.recommended ?? {}
      const ctxWarn = r.local ? (!m.contextWindow || m.contextWindow >= 262144 ? ' <span class="warn" title="' + esc(T('local_ctx_default_title')) + '">⚠</span>' : (m.backend?.loadedContext && m.contextWindow > m.backend.loadedContext ? ' <span class="warn" title="' + esc(T('local_ctx_over_title')) + '">⚠</span>' : '')) : ''
      const effective = '<div class="dim">' + T('local_effective') + ' ' + (m.contextWindow ? m.contextWindow.toLocaleString() : '—') + ' / ' + (m.maxTokens ? m.maxTokens.toLocaleString() : '—') + (m.effortIds?.length ? ' · ' + esc(m.effortIds.join('/')) : '') + '</div>'
      const eff = m.effortsEditable === false
        ? '<span class="dim" title="' + esc(T('local_efforts_fixed')) + '">' + esc((m.effortIds ?? []).join('/') || '—') + ' 🔒</span>'
        : inp('effortSpec', specOf(m.reasoningEfforts), 150, specOf(rec.reasoningEfforts) || (m.effortIds?.length ? m.effortIds.join(',') : T('local_efforts_ph'))).replace('data-f="effortSpec"', 'data-f="effortSpec" data-orig="' + esc(specOf(m.reasoningEfforts)) + '"') + (r.api !== 'openai-responses' ? '<div><label class="deck-cb" title="compat.supportsReasoningEffort (chat-completions only; the core refuses it on other protocols)"><input type="checkbox" data-f="wire" data-orig="' + (m.supportsReasoningEffort === true ? '1' : '0') + '"' + (m.supportsReasoningEffort === true ? ' checked' : '') + '> ' + T('local_wire') + '</label></div>' : '') + (m.backend?.reasoningOptions ? '<div class="dim">' + T('local_backend_options') + ' ' + esc(m.backend.reasoningOptions.join('/')) + '</div>' : '')
      const backend = m.backend ? ((m.backend.loaded ? '<span class="tag ok">' + T('local_loaded') + '</span>' : '<span class="tag">' + T('local_not_loaded') + '</span>') + (m.backend.loadedContext ? ' ctx ' + m.backend.loadedContext.toLocaleString() : '') + (m.backend.maxContext ? ' / max ' + m.backend.maxContext.toLocaleString() : '')) : '<span class="dim">—</span>'
      const dis = r.editable ? '' : ' disabled'
      return '<tr data-route="' + esc(r.route) + '" data-model="' + esc(m.id) + '" data-local="' + (r.local ? '1' : '0') + '">' +
        '<td><code>' + esc(m.id) + '</code>' + (r.local ? '<div class="dim">' + esc(m.family ?? '') + ' · ' + esc(kinds[m.kind] ?? m.kind ?? '') + '</div>' : '') + effective + '</td>' +
        (r.local ? '<td>' + backend + '</td>' : '') +
        '<td>' + numi('contextWindow', m.userSet?.contextWindow ? m.contextWindow : '', 100, rec.contextWindow ? String(rec.contextWindow) : (m.contextWindow ? String(m.contextWindow) : '262144')) + ctxWarn + '</td>' +
        '<td>' + numi('maxTokens', m.userSet?.maxTokens ? m.maxTokens : '', 90, rec.maxTokens ? String(rec.maxTokens) : (m.maxTokens ? String(m.maxTokens) : '')) + '</td>' +
        '<td>' + eff + '</td>' +
        (r.local ? '<td>' + sel('thinkingMode', m.thinkingMode ?? 'auto', [['auto', T('tm_auto')], ['follow-picker', T('tm_follow')], ['on', T('tm_on')], ['off', T('tm_off')]], 130) + '</td>' : '') +
        '<td>' + (r.local ? '<button class="btn mini primary local-rec" title="' + esc((rec.notes ?? []).join(' ')) + '"' + dis + '>' + T('local_apply_rec') + '</button> ' : '') + '<button class="btn mini' + (r.local ? '' : ' primary') + ' local-save"' + dis + '>' + T('local_save') + '</button>' + onlineBtn(m) + '</td></tr>'
    }).join('')
    const unreg = (r.unregistered ?? []).length ? '<div class="dim" style="margin-top:6px">' + T('local_unregistered') + ' ' + r.unregistered.map(u => '<code>' + esc(u.id) + '</code>' + (u.loadedContext ? ' (ctx ' + u.loadedContext + ')' : '')).join(', ') + '</div>' : ''
    const ths = '<th>' + T('local_th_model') + '</th>' + (r.local ? '<th>' + T('local_th_backend') + '</th>' : '') + '<th>contextWindow</th><th>maxTokens</th><th>' + T('local_th_efforts') + '</th>' + (r.local ? '<th>' + T('local_th_thinking') + '</th>' : '') + '<th></th>'
    const table = '<table class="tbl"><thead><tr>' + ths + '</tr></thead><tbody>' + rows + '</tbody></table>' + unreg
    if (r.local) return '<div class="card local-route">' + head + table + '</div>'
    // remote routes can list hundreds of models: collapsed unless small or filtered
    return '<details class="card local-route"' + (shown.length <= 12 || q ? ' open' : '') + '><summary>' + esc(r.displayName || r.route) + ' <span class="dim">' + shown.length + (q ? ' / ' + r.models.length : '') + ' ' + T('local_models_word') + '</span></summary>' + head + table + '</details>'
  }
  const locals = st.routes.filter(r => r.local)
  const remotes = st.routes.filter(r => !r.local)
  box.innerHTML =
    '<h3 class="stat-label">' + T('local_group_local') + '</h3><div class="dim" style="margin:0 0 6px">' + T('local_efforts_help') + '</div>' + (locals.length ? locals.map(routeCard).join('') : '<div class="dim">' + T('local_none') + '</div>') +
    '<h3 class="stat-label" style="margin-top:14px">' + T('local_group_remote') + '</h3><div class="dim" style="margin:0 0 6px">' + T('local_remote_help') + '</div>' + (remotes.length ? remotes.map(routeCard).join('') : '<div class="dim">' + T('t_empty') + '</div>')
  restoreLocalDrafts(fresh)
  syncLocalControls()
  if (focus) {
    const row = $$('#local-routes tr[data-route][data-model]').find(row => localKey(row.dataset.route, row.dataset.model) === focus.key)
    const field = row && [...row.querySelectorAll('[data-f]')].find(field => field.dataset.f === focus.field)
    if (field) { field.focus(); if (typeof focus.start === 'number') { try { field.setSelectionRange(focus.start, focus.end) } catch { /* numeric inputs do not expose a text selection */ } } }
  }
  $('#local-state').textContent = (st.defaultModel ? T('local_default', { m: st.defaultModel.provider + ' / ' + st.defaultModel.model }) : '') + (st.autoTaught?.length ? ' · ' + T('local_taught', { n: st.autoTaught.length }) : '') + localDraftNote()
}
async function refreshLocal() {
  if (localWriting) return
  const request = ++localReadSerial
  const epoch = localMutationEpoch
  $('#local-state').textContent = T('t_calc')
  try {
    const result = await api('/api/local/status')
    if (request === localReadSerial && epoch === localMutationEpoch && !localWriting) renderLocal(result, true)
  } catch (error) { if (request === localReadSerial && epoch === localMutationEpoch && !localWriting) localFailure(String(error?.message ?? error)) }
}
$('#local-refresh')?.addEventListener('click', refreshLocal)
$('#local-filter')?.addEventListener('input', () => { if (lastLocalStatus) renderLocal(lastLocalStatus) })
$('#local-probe')?.addEventListener('click', () => withLocalMutation(async () => {
  $('#local-state').textContent = T('local_probing')
  const r = await api('/api/local/probe', {})
  await finishLocalMutation(r, null, T('local_probed'))
}))
document.addEventListener('click', async e => {
  const online = e.target.closest?.('.local-online')
  if (online) {
    return withLocalMutation(async () => {
      const tr = online.closest('tr')
      const action = online.dataset.action
      const r = await api('/api/local/online-variant', { route: tr.dataset.route, modelId: tr.dataset.model, action })
      await finishLocalMutation(r, null, T(action === 'add' ? 'local_online_done' : 'local_online_removed', { id: r?.variantId }))
    })
  }
  const rec = e.target.closest?.('.local-rec'); const save = e.target.closest?.('.local-save')
  if (!rec && !save) return
  return withLocalMutation(async () => {
    const tr = e.target.closest('tr'); const route = tr.dataset.route; const modelId = tr.dataset.model
    const g = f => tr.querySelector('[data-f="' + f + '"]')
    let r; let submission
    if (rec) {
      const recommended = lastLocalStatus?.routes.find(r => r.route === route)?.models.find(m => m.id === modelId)?.recommended ?? {}
      const fields = ['thinkingMode']
      for (const field of ['contextWindow', 'maxTokens']) if (recommended[field] !== undefined) fields.push(field)
      if (recommended.reasoningEfforts !== undefined) fields.push('effortSpec')
      if (recommended.supportsReasoningEffort !== undefined) fields.push('wire')
      submission = localSubmission(route, modelId, fields)
      r = await api('/api/local/apply-recommended', { route, modelId })
    } else {
      const changes = { contextWindow: g('contextWindow').value === '' ? null : Number(g('contextWindow').value), maxTokens: g('maxTokens').value === '' ? null : Number(g('maxTokens').value) }
      if (g('thinkingMode')) changes.thinkingMode = g('thinkingMode').value
      // Compare with the fresh server baseline, never a previously restored draft.
      if (g('effortSpec') && g('effortSpec').value.trim() !== g('effortSpec').dataset.orig) changes.effortSpec = g('effortSpec').value.trim()
      if (g('wire') && (g('wire').checked ? '1' : '0') !== g('wire').dataset.orig) changes.supportsReasoningEffort = g('wire').checked
      submission = localSubmission(route, modelId, Object.keys(changes).map(field => field === 'supportsReasoningEffort' ? 'wire' : field))
      r = await api('/api/local/apply', { route, modelId, changes })
    }
    if (await finishLocalMutation(r, submission, T('local_applied'))) refreshContextSummary()
  })
})
document.addEventListener('change', async e => {
  const s = e.target.closest?.('[data-route-api]'); if (!s) return
  const reset = () => { s.value = lastLocalStatus?.routes.find(r => r.route === s.dataset.routeApi)?.api || 'openai-completions' }
  if (localWriting) { reset(); return }
  if (!confirm(T('local_api_confirm', { api: s.value }))) { reset(); return }
  return withLocalMutation(async () => {
    const route = s.dataset.routeApi; const apiName = s.value
    try {
      const r = await api('/api/local/route-api', { route, api: apiName })
      if (!await finishLocalMutation(r, null, T('local_applied'))) reset()
    } catch (error) { reset(); throw error }
  })
})
$('#local-autoteach')?.addEventListener('change', e => {
  const reset = () => { e.target.checked = lastLocalStatus?.autoTeach !== false }
  if (localWriting) { reset(); return }
  return withLocalMutation(async () => {
    const autoTeach = e.target.checked
    try {
      const r = await api('/api/local/settings', { autoTeach })
      if (!await finishLocalMutation(r, null, T('t_saved'))) reset()
    } catch (error) { reset(); throw error }
  })
})
$('#local-teach-now')?.addEventListener('click', () => withLocalMutation(async () => {
  $('#local-state').textContent = T('local_probing')
  const r = await api('/api/local/settings', { teachNow: true })
  await finishLocalMutation(r, null, T('local_taught', { n: (r?.taught ?? []).length }))
}))
refreshers.deck = refreshDeck
refreshers.local = refreshLocal

// ── Markets ─────────────────────────────────────────────────────────────────
function marketRow(it, type) {
  // Normalise git+https://….git repository links into an openable web URL
  const href = String(it.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
  const link = /^https?:\/\//.test(href) ? ' <a class="btn mini mkt-repo" href="' + esc(href) + '" target="_blank" rel="noopener" title="' + T('mkt_repo') + '">↗</a>' : ''
  const btn = '<button class="btn mini primary mkt-install" data-type="' + type + '" data-name="' + esc(it.name) + '">' + T('btn_install2') + '</button>' + link
  if (type === 'skill') return '<tr><td>' + esc(it.name) + '</td><td>' + (it.stars ?? '') + '</td><td class="dim">' + esc(it.description) + '</td><td>' + btn + '</td></tr>'
  return '<tr><td>' + esc(it.name) + '</td><td>' + esc(it.version) + '</td><td class="dim">' + esc(it.description) + '</td><td>' + btn + '</td></tr>'
}
async function marketSearch(type, q, tblSel) {
  const tb = $(tblSel + ' tbody')
  tb.innerHTML = '<tr><td colspan="4" class="dim">' + T('t_searching') + '</td></tr>'
  const d = await api('/api/market/search?type=' + type + '&q=' + encodeURIComponent(q))
  tb.innerHTML = (d.items ?? []).map(it => marketRow(it, type)).join('') || ('<tr><td colspan="4" class="dim">' + esc(d.message || T('t_empty')) + '</td></tr>')
}
$('#mkt-plugin-search')?.addEventListener('click', () => marketSearch('plugin', $('#mkt-plugin-q').value, '#tbl-mkt-plugin'))
$('#mkt-skill-search')?.addEventListener('click', () => marketSearch('skill', $('#mkt-skill-q').value, '#tbl-mkt-skill'))
$('#mkt-skin-search')?.addEventListener('click', () => marketSearch('skin', $('#mkt-skin-q').value, '#tbl-mkt-skin'))
$('#btn-community-skins')?.addEventListener('click', () => {
  const el = $('#comm-skins'); el.style.display = el.style.display === 'none' ? '' : 'none'
  if (el.style.display === '') marketSearch('skin', '', '#tbl-mkt-skin')
})
document.addEventListener('click', async e => {
  const b = e.target.closest?.('.mkt-install'); if (!b) return
  toast(T('t_installing2')); b.disabled = true
  const r = await api('/api/market/install', { type: b.dataset.type, name: b.dataset.name })
  toast(r.message); b.disabled = false
  if (b.dataset.type === 'skill') refreshers.skills?.()
  else if (b.dataset.type === 'skin') refreshers.skins?.() // skins land on the Skins page, never in the plugin list
  else refreshers.plugins?.()
})

// ── Quick workspace (through the dsh-quick-workspace plugin) ────────────────
$('#btn-ws-create')?.addEventListener('click', async () => {
  const path = $('#ws-path').value.trim()
  if (!path) return toast(T('qws_ph'))
  const r = await api('/api/workspace/create', { path })
  toast(r.message)
})
