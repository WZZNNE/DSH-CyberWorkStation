/** Memory & context page (dsh-memory-lite) and the config backup card (uses $/$$, api, toast, esc, T and refreshers from app.js). */

// ── Tabs ──
function memTab(name) {
  $$('#mem-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name))
  $$('#view-memory .tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name))
  localStorage.setItem('lc-mem-tab', name)
  if (name === 'context') loadMemSessions()
  else if (name === 'memory') loadMemItems()
  else if (name === 'settings') loadMemSettings()
}
$$('#mem-tabs .tab-btn').forEach(b => b.addEventListener('click', () => memTab(b.dataset.tab)))

const memFmtTime = ts => (ts ? new Date(ts).toLocaleString() : '—')
const memFmtInt = n => (Number.isFinite(n) ? Number(n).toLocaleString() : '—')
const memShortCwd = cwd => { const s = String(cwd ?? ''); return s.length > 42 ? '…' + s.slice(-40) : s }
let memStatus = null
async function memLoadStatus() {
  memStatus = await api('/api/memory/status')
  const el = $('#mem-state')
  if (!el) return
  if (!memStatus || memStatus.offline || memStatus.ok === false) { el.textContent = T('mem_offline'); return }
  const s = memStatus.stats ?? {}
  el.textContent = T('mem_state_line', { n: s.total ?? 0, s: s.byKind?.summary ?? 0, f: s.byKind?.fact ?? 0, o: s.byKind?.note ?? 0, p: s.pinned ?? 0 })
}

// ── Context tab: sessions list + detail ──
let memSessions = []
let memSelected = ''
let memPoll = 0
function renderMemSessions() {
  const box = $('#mem-sessions')
  const q = ($('#mem-sessions-q')?.value ?? '').trim().toLowerCase()
  const onlyCompacted = $('#mem-only-compacted')?.checked
  let rows = memSessions
  if (onlyCompacted) rows = rows.filter(s => (s.checkpoints ?? 0) > 0 || (s.compactions ?? 0) > 0)
  if (q) rows = rows.filter(s => [s.title, s.preview, s.cwd, s.id].some(v => String(v ?? '').toLowerCase().includes(q)))
  if (rows.length === 0) { box.innerHTML = '<div class="dim">' + T('mem_no_sessions') + '</div>'; return }
  box.innerHTML = rows.map(s => {
    const label = s.title || s.preview || s.id
    const state = s.running ? '<span class="tag ok">' + T('mem_running') + '</span>' : s.live ? '<span class="tag ok">' + T('mem_live') + '</span>' : ''
    const badges = ((s.checkpoints ?? 0) > 0 ? '<span class="tag warn">' + T('mem_has_summary') + '</span>' : '') + (s.origin === 'subagent' ? '<span class="tag">subagent</span>' : '')
    return '<div class="mem-row' + (s.id === memSelected ? ' active' : '') + '" data-id="' + esc(s.id) + '"><div class="mem-row-title">' + esc(label) + '</div>' +
      '<div class="dim">' + state + badges + (s.turns !== undefined ? T('mem_turns', { n: s.turns }) + ' · ' : '') + (s.compactions ? T('mem_compactions', { n: s.compactions }) + ' · ' : '') + esc(memShortCwd(s.cwd)) + '</div>' +
      '<div class="dim"><code>' + esc(s.id) + '</code> · ' + esc(memFmtTime(s.lastUserAt || s.createdAt)) + (s.error ? ' ⚠ ' + esc(s.error) : '') + '</div></div>'
  }).join('')
}
async function loadMemSessions(silent) {
  const st = $('#mem-sessions-state')
  if (!silent) st.textContent = T('t_calc')
  const d = await api('/api/memory/sessions')
  if (!d || d.offline || d.ok === false) { memSessions = []; $('#mem-sessions').innerHTML = '<div class="help-box">' + T('mem_offline') + '</div>'; st.textContent = ''; return }
  memSessions = d.sessions ?? []
  st.textContent = T('mem_sessions_total', { n: memSessions.length }) + (d.partial ? ' · ' + T('mem_scanning') : '')
  renderMemSessions()
  // cold sessions are inspected in slices; keep polling until every row carries its title / counts
  if (d.partial && memPoll < 12 && $('#view-memory').classList.contains('active')) { memPoll++; setTimeout(() => loadMemSessions(true), 1500) } else { memPoll = 0; if (d.partial) st.textContent = T('mem_sessions_total', { n: memSessions.length }) + ' · ' + T('mem_scan_stopped') }
}
$('#mem-sessions-refresh')?.addEventListener('click', () => loadMemSessions())
$('#mem-sessions-q')?.addEventListener('input', renderMemSessions)
$('#mem-only-compacted')?.addEventListener('change', renderMemSessions)
$('#mem-sessions')?.addEventListener('click', e => { const row = e.target.closest('.mem-row'); if (!row) return; memSelected = row.dataset.id; renderMemSessions(); loadMemDetail(memSelected) })

let memDetail = null
let memDetailSeq = 0
function renderMemDetail(d) {
  memDetail = d
  const box = $('#mem-detail')
  if (!d || d.ok === false) { box.innerHTML = '<div class="help-box">' + esc(d?.message || T('mem_offline')) + '</div>'; return }
  const p = d.pressure ?? {}
  const used = p.totalTokens ?? p.surfaceTokens ?? null
  const pct = used !== null && p.contextWindow ? Math.min(100, Math.round(used / p.contextWindow * 100)) : null
  const thrPct = p.contextWindow && p.thresholdTokens ? Math.round(p.thresholdTokens / p.contextWindow * 100) : null
  const state = d.running ? '<span class="tag ok">' + T('mem_running') + '</span>' : d.live ? '<span class="tag ok">' + T('mem_live') + '</span>' : '<span class="tag">' + T('mem_cold') + '</span>'
  const head = '<div class="route-head"><b>' + esc(d.title || d.preview || d.id) + '</b> ' + state + (d.origin === 'subagent' ? '<span class="tag">subagent</span>' : '') +
    ' <span class="dim"><code>' + esc(d.id) + '</code> · ' + esc(d.cwd || '') + ' · ' + T('mem_turns', { n: d.turns }) + ' · ' + T('mem_events', { n: d.eventCount }) + '</span></div>'
  const pressure = '<div class="card" style="margin-bottom:10px"><div class="stat-label">' + T('mem_pressure') + '</div>' +
    (p.model ? '<div class="dim">' + esc(p.provider + ' / ' + p.model) + ' · contextWindow ' + memFmtInt(p.contextWindow) + ' · ' + T('mem_threshold', { pct: thrPct ?? '—', n: memFmtInt(p.thresholdTokens) }) + (p.thresholdSource === 'default' ? ' ' + T('mem_threshold_default') : '') + '</div>' : '<div class="dim">' + T('mem_no_model') + '</div>') +
    (used !== null ? '<div class="mem-bar" title="' + esc(memFmtInt(used)) + '"><i style="width:' + (pct ?? 0) + '%"></i>' + (thrPct !== null ? '<b style="left:' + thrPct + '%"></b>' : '') + '</div><div class="dim">' + (p.totalTokens !== null && p.totalTokens !== undefined ? T('mem_pressure_total', { n: memFmtInt(p.totalTokens) }) : T('mem_pressure_surface', { n: memFmtInt(p.surfaceTokens) })) + (pct !== null ? ' · ' + pct + '%' : '') + '</div>' : '') +
    '<div class="dim">' + T('mem_composition', { u: d.composition?.user ?? 0, a: d.composition?.assistant ?? 0, t: d.composition?.tool ?? 0, c: d.composition?.context ?? 0, k: d.composition?.checkpoints ?? 0 }) + '</div></div>'
  const actions = '<div class="row gap wrap"><button class="btn mini" id="mem-detail-refresh">' + T('mem_refresh') + '</button>' +
    (d.compactable ? '<button class="btn mini" id="mem-compact-now">' + T('mem_compact_now') + '</button>' : '') +
    (d.checkpoints?.length ? '<button class="btn mini" id="mem-deposit">' + T('mem_deposit') + '</button>' : '') +
    (d.openTurn !== null ? '<span class="tag warn">' + T('mem_turn_open') + '</span>' : '') + (d.activeCompaction ? '<span class="tag warn">' + T('mem_compacting') + '</span>' : '') + '</div>'
  const cps = (d.checkpoints ?? []).length === 0
    ? '<div class="help-box">' + T('mem_no_checkpoint') + '</div>'
    : d.checkpoints.map(c => '<div class="card mem-cp" data-seq="' + c.seq + '" style="margin-bottom:10px"><div class="stat-label">' + T('mem_checkpoint') + ' <span class="dim">seq ' + c.seq + ' · ' + esc(memFmtTime(c.time)) + (c.recognized ? '' : ' · ' + T('mem_cp_unframed')) + '</span></div>' +
      '<textarea class="input area mem-summary" rows="16" style="max-width:100%;min-height:220px"' + (d.editable ? '' : ' readonly') + '>' + esc(c.summary) + '</textarea>' +
      '<div class="row gap wrap"><span class="dim mem-chars">' + T('mem_chars', { n: c.summary.length }) + '</span>' + (d.editable ? '<button class="btn mini primary mem-save-summary">' + T('mem_save_summary') + '</button><button class="btn mini mem-reset-summary">' + T('mem_reset') + '</button>' : '<span class="tag warn">' + T('mem_readonly') + '</span>') + '</div></div>').join('')
  const hist = (d.history?.entries ?? [])
  const kinds = { auto: T('mem_kind_auto'), command: T('mem_kind_command'), 'manual-edit': T('mem_kind_edit') }
  const histHtml = hist.length === 0 ? '<div class="dim">' + T('mem_history_empty') + '</div>' :
    '<table class="tbl"><thead><tr><th>' + T('mem_th_time') + '</th><th>' + T('mem_th_kind') + '</th><th>' + T('mem_th_status') + '</th><th>' + T('mem_th_shadowed') + '</th><th>' + T('mem_th_by') + '</th><th></th></tr></thead><tbody>' +
    hist.slice().reverse().map(h => '<tr><td class="dim">' + esc(memFmtTime(h.startedAt)) + '</td><td>' + esc(kinds[h.kind] ?? h.kind) + '</td><td>' + (h.status === 'complete' ? '<span class="tag ok">ok</span>' : h.status === 'error' ? '<span class="tag warn" title="' + esc(h.error ?? '') + '">error</span>' : '<span class="tag">running</span>') + (h.active ? ' <span class="tag ok">' + T('mem_active') + '</span>' : '') + '</td><td>' + (h.shadowedCount ?? 0) + ' · ~' + memFmtInt(h.shadowedTokenCount) + '</td><td class="dim">' + esc((h.provider ?? '') + (h.model ? ' / ' + h.model : '')) + '</td><td>' + (h.summary ? '<details><summary class="dim">' + T('mem_show_text') + '</summary><pre class="mem-pre">' + esc(h.summary) + '</pre></details>' : '') + '</td></tr>').join('') + '</tbody></table>' +
    (d.history?.prunes ? '<div class="dim">' + T('mem_prunes', { n: d.history.prunes }) + '</div>' : '')
  const mem = (d.memoryItems ?? []).length ? '<div class="dim" style="margin-top:8px">' + T('mem_items_from_session', { n: d.memoryItems.length }) + '</div>' : ''
  box.innerHTML = head + actions + pressure + '<h3 class="stat-label">' + T('mem_checkpoint_title') + '</h3><div class="dim" style="margin-bottom:6px">' + T('mem_checkpoint_help') + '</div>' + cps + '<h3 class="stat-label" style="margin-top:12px">' + T('mem_history') + '</h3>' + histHtml + mem
}
async function loadMemDetail(id) {
  const box = $('#mem-detail')
  box.innerHTML = '<div class="dim">' + T('t_calc') + '</div>'
  const seq = ++memDetailSeq
  const d = await api('/api/memory/session?id=' + encodeURIComponent(id))
  if (seq !== memDetailSeq) return // a later click already owns the pane
  renderMemDetail(d)
}
$('#mem-detail')?.addEventListener('input', e => { const ta = e.target.closest('.mem-summary'); if (!ta) return; ta.closest('.mem-cp').querySelector('.mem-chars').textContent = T('mem_chars', { n: ta.value.length }) })
$('#mem-detail')?.addEventListener('click', async e => {
  if (!memDetail) return
  if (e.target.closest('#mem-detail-refresh')) return loadMemDetail(memDetail.id)
  if (e.target.closest('#mem-compact-now')) {
    if (!confirm(T('mem_compact_confirm'))) return
    $('#mem-compact-now').disabled = true
    const r = await api('/api/memory/session/compact', { id: memDetail.id })
    toast(r.ok ? (r.compacted ? T('mem_compacted', { n: r.shadowedCount, t: memFmtInt(r.shadowedTokenCount) }) : (r.message || T('mem_nothing_to_compact'))) : (r.message || T('t_empty')))
    loadMemDetail(memDetail.id); loadMemSessions(true)
    return
  }
  if (e.target.closest('#mem-deposit')) {
    const r = await api('/api/memory/session/deposit', { id: memDetail.id })
    toast(r.ok ? T('mem_deposited') : (r.message || T('t_empty')))
    memLoadStatus()
    return
  }
  const cp = e.target.closest('.mem-cp')
  if (!cp) return
  const seq = Number(cp.dataset.seq)
  const ta = cp.querySelector('.mem-summary')
  if (e.target.closest('.mem-reset-summary')) { const orig = memDetail.checkpoints.find(c => c.seq === seq); if (orig) { ta.value = orig.summary; ta.dispatchEvent(new Event('input', { bubbles: true })) } return }
  if (e.target.closest('.mem-save-summary')) {
    const btn = e.target.closest('.mem-save-summary')
    btn.disabled = true
    const r = await api('/api/memory/session/summary', { id: memDetail.id, checkpointSeq: seq, summary: ta.value })
    btn.disabled = false
    if (r.ok && r.unchanged) return toast(T('mem_unchanged'))
    toast(r.ok ? T('mem_saved_summary', { seq: r.checkpointSeq }) : (r.message || T('t_empty')))
    if (r.ok) { loadMemDetail(memDetail.id); loadMemSessions(true) }
  }
})

// ── Memory tab: items ──
let memItemsTimer = 0
let memItemsSeq = 0
function memItemCard(i) {
  const meta = [i.kind, i.scope === 'global' ? T('mem_scope_global') : (T('mem_scope_workspace') + (i.cwd ? ' ' + memShortCwd(i.cwd) : '')), i.source, memFmtTime(i.createdAt), i.sessionId ? i.sessionId.slice(0, 16) + '…' : ''].filter(Boolean).map(esc).join(' · ')
  return '<div class="card mem-item" data-id="' + esc(i.id) + '"><div class="mem-item-text">' + esc(i.text) + '</div>' +
    '<div class="row gap wrap" style="margin:6px 0 0"><span class="dim">' + (i.pinned ? '<span class="tag ok">' + T('mem_pinned') + '</span>' : '') + meta + (i.score !== undefined ? ' · score ' + i.score : '') + '</span><span class="spacer"></span>' +
    '<button class="btn mini mem-pin">' + (i.pinned ? T('mem_unpin') : T('mem_pin')) + '</button><button class="btn mini mem-scope" data-to="' + (i.scope === 'global' ? 'workspace' : 'global') + '" data-cwd="' + esc(i.cwd ?? '') + '">' + (i.scope === 'global' ? T('mem_make_workspace') : T('mem_make_global')) + '</button><button class="btn mini mem-edit">' + T('mem_edit') + '</button><button class="btn mini danger mem-del">' + T('mem_delete') + '</button></div></div>'
}
async function loadMemItems() {
  const q = ($('#mem-q')?.value ?? '').trim()
  const kind = $('#mem-kind')?.value ?? ''
  const st = $('#mem-items-state')
  st.textContent = T('t_calc')
  const seq = ++memItemsSeq
  const d = await api('/api/memory/items?limit=300' + (q ? '&q=' + encodeURIComponent(q) : '') + (kind ? '&kind=' + encodeURIComponent(kind) : ''))
  if (seq !== memItemsSeq) return // a newer search owns the list
  if (!d || d.offline || d.ok === false) { $('#mem-items').innerHTML = '<div class="help-box">' + T('mem_offline') + '</div>'; st.textContent = ''; return }
  st.textContent = T('mem_items_total', { n: d.items.length, t: d.total })
  $('#mem-items').innerHTML = d.items.length ? d.items.map(memItemCard).join('') : '<div class="dim">' + T('mem_items_empty') + '</div>'
  memLoadStatus()
}
$('#mem-q')?.addEventListener('input', () => { clearTimeout(memItemsTimer); memItemsTimer = setTimeout(loadMemItems, 300) })
$('#mem-kind')?.addEventListener('change', loadMemItems)
$('#mem-items-refresh')?.addEventListener('click', loadMemItems)
$('#mem-add')?.addEventListener('click', async () => {
  const text = $('#mem-new-text').value.trim()
  if (!text) return toast(T('mem_text_required'))
  const scope = $('#mem-new-scope').value
  if (scope === 'workspace' && !$('#mem-new-cwd').value.trim()) return toast(T('mem_scope_cwd_required'))
  const r = await api('/api/memory/items', { text, scope, cwd: scope === 'workspace' ? $('#mem-new-cwd').value.trim() : '', pinned: $('#mem-new-pinned').checked })
  toast(r.ok ? T('t_saved') : (r.message || T('t_empty')))
  if (r.ok) { $('#mem-new-text').value = ''; loadMemItems() }
})
$('#mem-new-scope')?.addEventListener('change', e => { $('#mem-new-cwd').style.display = e.target.value === 'workspace' ? '' : 'none' })
$('#mem-items')?.addEventListener('click', async e => {
  const card = e.target.closest('.mem-item'); if (!card) return
  const id = card.dataset.id
  if (e.target.closest('.mem-del')) { if (!confirm(T('mem_delete_confirm'))) return; const r = await api('/api/memory/items/delete', { id }); toast(r.ok ? T('t_saved') : (r.message || T('t_empty'))); return loadMemItems() }
  if (e.target.closest('.mem-pin')) { const pinned = !card.querySelector('.tag.ok'); const r = await api('/api/memory/items/update', { id, pinned }); toast(r.ok ? T('t_saved') : (r.message || T('t_empty'))); return loadMemItems() }
  if (e.target.closest('.mem-scope')) {
    const b = e.target.closest('.mem-scope')
    const patch = { id, scope: b.dataset.to }
    if (b.dataset.to === 'workspace') { const cwd = prompt(T('mem_scope_cwd_prompt'), b.dataset.cwd || ''); if (cwd === null) return; if (!cwd.trim()) return toast(T('mem_scope_cwd_required')); patch.cwd = cwd.trim() }
    const r = await api('/api/memory/items/update', patch)
    toast(r.ok ? T('t_saved') : (r.message || T('t_empty')))
    return loadMemItems()
  }
  if (e.target.closest('.mem-edit')) {
    const textEl = card.querySelector('.mem-item-text')
    if (card.querySelector('textarea')) return
    const cur = textEl.textContent
    textEl.innerHTML = '<textarea class="input area" rows="5" style="max-width:100%">' + esc(cur) + '</textarea><div class="row gap"><button class="btn mini primary mem-edit-save">' + T('t_save') + '</button><button class="btn mini mem-edit-cancel">' + T('t_cancel') + '</button></div>'
    return
  }
  if (e.target.closest('.mem-edit-cancel')) return loadMemItems()
  if (e.target.closest('.mem-edit-save')) { const r = await api('/api/memory/items/update', { id, text: card.querySelector('textarea').value }); toast(r.ok ? T('t_saved') : (r.message || T('t_empty'))); return loadMemItems() }
})
$('#mem-export')?.addEventListener('click', async () => { const st = await api('/api/memory/status'); if (!st || st.offline || st.ok === false) return toast(T('mem_offline')); await window.apiDownload('/api/memory/export', 'dsh-memory.json') })
$('#mem-import')?.addEventListener('click', () => $('#mem-import-file').click())
$('#mem-import-file')?.addEventListener('change', async e => {
  const f = e.target.files?.[0]; if (!f) return
  let parsed
  try { parsed = JSON.parse(await f.text()) } catch { toast(T('mem_import_bad')); e.target.value = ''; return }
  const r = await api('/api/memory/import', parsed)
  toast(r.ok ? T('mem_imported', { a: r.added, u: r.updated, s: r.skipped }) : (r.message || T('t_empty')))
  e.target.value = ''
  loadMemItems()
})
$('#mem-clear')?.addEventListener('click', async () => {
  if (!confirm(T('mem_clear_confirm'))) return
  const r = await api('/api/memory/items/clear', { confirm: true })
  toast(r.ok ? T('mem_cleared', { n: r.removed }) : (r.message || T('t_empty')))
  loadMemItems()
})

// ── Settings tab ──
function fillMemSettings(cfg) {
  if (!cfg) return
  $('#ms-enabled').checked = cfg.enabled
  $('#ms-deposit').checked = cfg.depositSummaries
  $('#ms-extract').checked = cfg.extractFacts
  $('#ms-every').value = cfg.extractEveryTurns
  $('#ms-inject').value = cfg.inject
  $('#ms-topk').value = cfg.topK
  $('#ms-tools').checked = cfg.tools
  $('#ms-emb').checked = cfg.embeddings.enabled
  $('#ms-emb-url').value = cfg.embeddings.baseURL
  $('#ms-emb-model').value = cfg.embeddings.model
  $('#ms-emb-key').value = cfg.embeddings.apiKeyEnv
}
function collectMemSettings() {
  return {
    enabled: $('#ms-enabled').checked, depositSummaries: $('#ms-deposit').checked, extractFacts: $('#ms-extract').checked,
    extractEveryTurns: Number($('#ms-every').value) || 8, inject: $('#ms-inject').value, topK: Number($('#ms-topk').value) || 5, tools: $('#ms-tools').checked,
    embeddings: { enabled: $('#ms-emb').checked, baseURL: $('#ms-emb-url').value.trim(), model: $('#ms-emb-model').value.trim(), apiKeyEnv: $('#ms-emb-key').value.trim() },
  }
}
async function loadMemSettings() {
  await memLoadStatus()
  if (!memStatus || memStatus.offline || memStatus.ok === false) { $('#ms-state').textContent = T('mem_offline'); return }
  fillMemSettings(memStatus.config)
  const s = memStatus.stats ?? {}
  $('#ms-state').textContent = T('mem_settings_state', { file: memStatus.configFile ?? '', dir: memStatus.memoryDir ?? '', v: s.vectors ?? 0 })
}
$('#ms-save')?.addEventListener('click', async () => {
  const r = await api('/api/memory/settings', collectMemSettings())
  toast(r.ok ? T('t_saved') : (r.message || T('t_empty')))
  if (r.ok) { memStatus = r; fillMemSettings(r.config) }
})
$('#ms-emb-test')?.addEventListener('click', async () => {
  const c = collectMemSettings().embeddings
  $('#ms-emb-state').textContent = T('t_calc')
  const r = await api('/api/memory/embeddings/test', { embeddings: c })
  $('#ms-emb-state').textContent = r.ok ? T('mem_emb_ok', { d: r.dims, ms: r.ms }) : '⚠ ' + (r.message || T('mem_offline'))
})
$('#ms-emb-rebuild')?.addEventListener('click', async () => {
  $('#ms-emb-state').textContent = T('t_calc')
  const r = await api('/api/memory/embeddings/rebuild', {})
  $('#ms-emb-state').textContent = r.ok ? T('mem_emb_rebuilt', { n: r.embedded, r: r.remaining }) : '⚠ ' + (r.message || T('mem_offline'))
})
$('#ms-recall-run')?.addEventListener('click', async () => {
  const query = $('#ms-recall-q').value.trim()
  if (!query) return
  const r = await api('/api/memory/recall', { query, cwd: $('#ms-recall-cwd').value.trim(), strict: $('#ms-recall-strict').checked })
  const box = $('#ms-recall-out')
  if (!r.ok) { box.textContent = r.message || T('mem_offline'); return }
  box.innerHTML = r.hits.length === 0 ? '<div class="dim">' + T('mem_recall_none') + '</div>' : '<pre class="mem-pre">' + esc(r.preview) + '</pre>'
})

// ── Page entry ──
async function refreshMemory() {
  await memLoadStatus()
  memTab(localStorage.getItem('lc-mem-tab') || 'context')
}
refreshers.memory = refreshMemory

// ── Config backup / restore (Storage page) ──
$('#backup-export')?.addEventListener('click', () => window.apiDownload('/api/backup', 'dsh-config-backup.json'))
$('#backup-preview')?.addEventListener('click', async () => {
  const r = await api('/api/backup/preview')
  const box = $('#backup-list')
  if (!r.ok) { box.textContent = r.message || T('t_empty'); return }
  box.innerHTML = '<div class="dim">' + T('backup_total', { n: r.entries.filter(e => !e.skipped).length, kb: Math.round((r.total ?? 0) / 1024) }) + '</div><ul class="mem-ul">' + r.entries.map(e => '<li><code>' + esc(e.rel) + '</code> <span class="dim">' + (e.size < 1024 ? '<1' : Math.round(e.size / 1024)) + ' KB' + (e.skipped ? ' · ' + esc(e.skipped) : '') + '</span></li>').join('') + '</ul>'
})
$('#backup-restore')?.addEventListener('click', () => $('#backup-file').click())
$('#backup-file')?.addEventListener('change', async e => {
  const f = e.target.files?.[0]; if (!f) return
  let parsed
  try { parsed = JSON.parse(await f.text()) } catch { toast(T('mem_import_bad')); e.target.value = ''; return }
  const keys = Object.keys(parsed?.files ?? {})
  const n = keys.length
  if (!n) { toast(T('backup_bad')); e.target.value = ''; return }
  const sensitive = keys.filter(k => /^(hooks\/|profiles\/|settings\.yaml$)/.test(k))
  const listing = keys.slice(0, 40).join('\n') + (keys.length > 40 ? '\n…' : '')
  if (!confirm(T('backup_restore_confirm', { n }) + (sensitive.length ? '\n\n' + T('backup_restore_sensitive', { list: sensitive.join(', ') }) : '') + '\n\n' + listing)) { e.target.value = ''; return }
  const r = await api('/api/backup/restore', parsed)
  toast(r.message || (r.ok ? T('t_saved') : T('t_empty')))
  e.target.value = ''
  const box = $('#backup-list')
  box.innerHTML = '<div class="dim">' + esc(r.message || '') + '</div>' + (r.written?.length ? '<div class="dim">' + T('backup_written') + ' ' + r.written.map(esc).join(', ') + '</div>' : '') + (r.skipped?.length ? '<div class="dim">' + T('backup_skipped') + ' ' + r.skipped.map(esc).join(', ') + '</div>' : '')
})
