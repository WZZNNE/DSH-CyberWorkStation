/** DSH Launcher frontend: view switching, API calls, polling. Skins own the looks; behaviour lives here. */
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
// Every request announces the UI language so the server can answer in it.
/**
 * The API token, taken from the URL fragment the launcher opened this page with.
 *
 * A fragment is never sent to a server, so nothing this server serves carries the token — which is
 * the point: over loopback HTTP a local process and this browser are indistinguishable, so any route
 * that handed the token out would hand it to both. It is kept for this tab only and the URL is
 * scrubbed immediately, so a screenshot or a copied address bar does not leak it.
 */
const LAUNCHER_TOKEN = (() => {
  // Two carriers: `?t=` is what the launcher exe/cmd use — Edge's `--app=` handoff to a
  // running browser drops URL fragments, so the query is the only form that arrives intact.
  // `#t=` still works for hand-opened links. Both go only to this loopback server (which
  // minted the token) and both are scrubbed from the address bar before anything else runs.
  const fromQuery = /[?&]t=([0-9a-f]{16,})/.exec(location.search)?.[1]
  const fromHash = /[#&]t=([0-9a-f]{16,})/.exec(location.hash)?.[1]
  const token = fromQuery ?? fromHash
  if (token) {
    try { sessionStorage.setItem('lc-token', token) } catch { /* private mode: this tab only */ }
    const search = location.search.replace(/[?&]t=[0-9a-f]+/, '').replace(/^&/, '?')
    const rest = location.hash.replace(/[#&]t=[0-9a-f]+/, '').replace(/^&/, '#')
    history.replaceState(null, '', location.pathname + (search === '?' ? '' : search) + (rest === '#' ? '' : rest))
    return token
  }
  try { return sessionStorage.getItem('lc-token') ?? '' } catch { return '' }
})()
/**
 * A page holding no token, or one the server refuses, cannot do anything — every call would 403.
 * Instead of failing silently it says so across the whole page, with the way out.
 */
const tokenLost = () => {
  if (document.getElementById('token-lost')) return
  const d = document.createElement('div')
  d.id = 'token-lost'
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(5,6,8,.92);color:#f4ffff;font:600 15px/1.8 "Segoe UI",sans-serif;text-align:center;padding:24px'
  d.innerHTML = window.LANG === 'zh'
    ? '<div><div style="font-size:22px;color:#ff7f00;margin-bottom:10px">此窗口已失效</div>请关闭本窗口，重新打开「DSH启动器」<br><span style="opacity:.6">令牌未随页面送达（旧窗口或直接输入的网址）</span></div>'
    : '<div><div style="font-size:22px;color:#ff7f00;margin-bottom:10px">This window is stale</div>Close it and reopen the DSH Launcher app.<br><span style="opacity:.6">The page arrived without a valid token.</span></div>'
  document.body.appendChild(d)
}
const api = async (path, body) => {
  const headers = { 'x-lang': window.LANG, 'x-launcher-token': LAUNCHER_TOKEN }
  const r = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json()
  if (r.status === 403 && /launcher page/.test(String(data?.message ?? ''))) tokenLost()
  return data
}
if (LAUNCHER_TOKEN === '') tokenLost()
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200) }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * Download through the API with the token attached. A plain `<a href>` or `location.href` is a
 * navigation, which cannot carry a header — those hit the 403 and took the user off the launcher.
 */
async function apiDownload(path, filename) {
  const r = await fetch(path, { headers: { 'x-lang': window.LANG, 'x-launcher-token': LAUNCHER_TOKEN } })
  if (!r.ok) { toast('HTTP ' + r.status); return }
  const url = URL.createObjectURL(await r.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
window.apiDownload = apiDownload

// ── View switching ──────────────────────────────────────────────────────────
$$('.nav-btn').forEach(b => b.addEventListener('click', () => {
  $$('.nav-btn').forEach(x => x.classList.remove('active')); b.classList.add('active')
  $$('.view').forEach(v => v.classList.remove('active')); $('#view-' + b.dataset.view).classList.add('active')
  location.hash = b.dataset.view // shareable deep link, e.g. #deck / #skins
  refreshers[b.dataset.view]?.()
}))
$$('[data-open]').forEach(b => b.addEventListener('click', async () => toast((await api('/api/open', { key: b.dataset.open })).message)))

// ── Dashboard ───────────────────────────────────────────────────────────────
let dshUrl = 'http://127.0.0.1:3080'
async function refreshDash() {
  const s = await api('/api/status')
  dshUrl = s.dshUrl || dshUrl
  const el = $('#dash-state')
  const wasRunning = el.dataset.running === '1'
  el.textContent = s.dshRunning ? '● RUNNING' : '○ OFFLINE'
  el.className = 'stat-value ' + (s.dshRunning ? 'ok' : 'off')
  // OFFLINE → RUNNING flip: one-shot online effect (the animation clears itself)
  if (s.dshRunning && !wasRunning && el.dataset.running !== undefined) {
    el.classList.remove('state-flip'); void el.offsetWidth; el.classList.add('state-flip')
    el.addEventListener('animationend', () => el.classList.remove('state-flip'), { once: true })
  }
  el.dataset.running = s.dshRunning ? '1' : '0'
  $('#dash-ver').textContent = s.repoVersion || '—'
  $('#dash-node').textContent = s.node
  const dm = $('#dash-model'); if (dm) dm.textContent = s.defaultModel || '—'
  $('#nav-status').textContent = (s.dshRunning ? 'DSH ONLINE' : 'DSH OFFLINE') + (s.updating ? ' · UPDATING' : '')
  const l = await api('/api/logs?file=dsh')
  const box = $('#dash-log')
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  box.textContent = (l.text || '—').split('\n').slice(-200).join('\n').slice(-12000)
  if (atBottom) box.scrollTop = box.scrollHeight
}
$('#btn-start').addEventListener('click', async () => {
  const w = $('#launch-wrap'); w.classList.remove('zap'); void w.offsetWidth; w.classList.add('zap')
  toast(T('t_starting'))
  const r = await api('/api/dsh/start', {})
  toast(r.message); refreshDash()
  if (r.ok) window.open(dshUrl, '_blank')
})
$('#btn-stop').addEventListener('click', async () => { const r = await api('/api/dsh/stop', {}); toast(r.message); refreshDash() })
$('#btn-openui').addEventListener('click', () => window.open(dshUrl, '_blank'))

// ── Plugins ─────────────────────────────────────────────────────────────────
async function refreshPlugins() {
  api('/api/plugins/builtin').then(b => {
    const el = $('#builtin-rows')
    if (el && b.rows) el.innerHTML = b.rows.map(r => '<code style="margin:0 8px 4px 0;display:inline-block">' + esc(r) + '</code>').join('') + '<div class="dim">Σ ' + b.count + '</div>'
  }).catch(() => {})
  const d = await api('/api/plugins')
  $('#tbl-plugins tbody').innerHTML = d.plugins.map(p => `<tr>
    <td>${esc(p.name)}</td><td>${esc(p.version)}</td>
    <td>${p.local ? 'link' : 'npm'}</td><td>${p.isBundle ? '✔' : ''}</td>
    <td><button class="btn mini danger" data-rm="${esc(p.name)}">${T('btn_uninstall')}</button></td></tr>`).join('')
  $$('#tbl-plugins [data-rm]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(T('t_confirm_rm', { name: b.dataset.rm }))) return
    toast(T('t_removing')); const r = await api('/api/plugins/op', { op: 'remove', spec: b.dataset.rm }); toast(r.message); refreshPlugins()
  }))
}
$('#btn-plugin-add').addEventListener('click', async () => {
  const spec = $('#plugin-spec').value.trim(); if (!spec) return toast(T('t_fill_pkg'))
  toast(T('t_installing')); const r = await api('/api/plugins/op', { op: 'add', spec }); toast(r.message); refreshPlugins()
})

// ── Skills / sessions / storage ─────────────────────────────────────────────
async function refreshSkills() {
  const d = await api('/api/skills')
  $('#tbl-skills tbody').innerHTML = d.skills.map(s => `<tr><td>${esc(s.name)}</td><td class="dim">${esc(s.source)}</td><td class="dim">${esc(s.description)}</td></tr>`).join('') || ('<tr><td colspan="3" class="dim">' + T('t_no_skills') + '</td></tr>')
}
let sessionsData = null
function renderSessions() {
  const d = sessionsData; if (!d) return
  const q = ($('#sessions-q').value || '').trim().toLowerCase()
  $('#sessions-total').textContent = T('t_total', { n: d.total, dir: d.dir })
  const groups = (d.workspaces ?? []).map(w => {
    const rows = w.sessions.filter(s => !q || w.label.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    if (rows.length === 0 && q) return ''
    const body = rows.map(s => `<tr><td><code>${esc(s.id)}</code></td><td>${s.sizeKB}</td><td class="dim">${esc(s.mtime)}</td><td>${d.dshRunning ? `<a class="btn mini" href="${esc(s.exportUrl)}" target="_blank" rel="noopener">${T('sess_export')}</a>` : `<span class="dim" title="${esc(T('sess_export_offline'))}">${T('sess_export')} ✖</span>`}</td></tr>`).join('')
    return `<details class="ws-group" ${q ? 'open' : ''}><summary>${esc(w.label)} <small>${w.count} · ${esc(w.latest)}</small></summary>
      <table class="tbl"><thead><tr><th>${T('th_session')}</th><th>${T('th_size')}</th><th>${T('th_mtime')}</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="4" class="dim">' + T('t_no_sessions') + '</td></tr>'}</tbody></table></details>`
  }).join('')
  $('#sessions-groups').innerHTML = groups || ('<div class="dim">' + T('t_no_sessions') + '</div>')
}
async function refreshSessions() {
  sessionsData = await api('/api/sessions')
  renderSessions()
}
$('#sessions-q').addEventListener('input', renderSessions)
async function refreshStorage() {
  $('#tbl-storage tbody').innerHTML = ('<tr><td colspan="4" class="dim">' + T('t_calc') + '</td></tr>')
  const d = await api('/api/storage')
  $('#tbl-storage tbody').innerHTML = d.folders.map(f => `<tr>
    <td>${esc(window.LANG === "zh" ? f.label : T(f.labelKey))}</td><td>${f.exists ? f.sizeMB : '—'}</td><td class="dim">${esc(f.path)}</td>
    <td><button class="btn mini" data-open2="${esc(f.key)}">${T('jump')}</button></td></tr>`).join('')
  $$('#tbl-storage [data-open2]').forEach(b => b.addEventListener('click', async () => toast((await api('/api/open', { key: b.dataset.open2 })).message)))
}

// ── Updates ─────────────────────────────────────────────────────────────────
let updatePolling = null
function pollUpdate() {
  clearInterval(updatePolling)
  updatePolling = setInterval(async () => {
    const s = await api('/api/update/status')
    const active = s.core.running ? 'core' : s.plugins.running ? 'plugins' : null
    $('#update-log').textContent = (s.core.running || s.core.log ? s.core.log : s.plugins.log) .slice(-8000) || '—'
    if (active === null) { clearInterval(updatePolling); refreshVersions() }
  }, 2000)
}
let upstream = null
async function refreshVersions() {
  const u = await api('/api/update/upstream')
  upstream = u
  const latest = u.tag || (u.npmLatest ? 'dsh-v' + u.npmLatest : '')
  const same = latest && u.local && latest.replace(/^dsh-v/, '') === u.local
  $('#up-versions').innerHTML = T('up_local') + ' <b>' + esc(u.local || '—') + '</b> · ' + T('up_latest') + ' <b>' + esc(latest || '—') + '</b>' + (u.npmLatest ? ' <span class="dim">(npm latest ' + esc(u.npmLatest) + ')</span>' : '') + (u.publishedAt ? ' <span class="dim">' + esc(u.publishedAt.slice(0, 10)) + '</span>' : '') + (latest ? (same ? ' <span class="ok">✔ ' + T('up_uptodate') + '</span>' : ' <span class="warn">⬆ ' + T('up_newer') + '</span>') : '') + (u.url ? ' <a class="btn mini" href="' + esc(u.url) + '" target="_blank" rel="noopener">releases ↗</a>' : '')
  if (latest) $('#up-tag').placeholder = latest
}
function renderSelfCheck(c) {
  const item = (ok, label, detail) => `<div class="check-item"><span class="${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✖'}</span><span>${esc(label)}${detail ? ' <span class="dim">' + esc(detail) + '</span>' : ''}</span></div>`
  $('#selfcheck').innerHTML = [
    item(c.node.ok, 'Node ' + c.node.version, c.node.required),
    item(!!c.core.version, T('sc_core'), c.core.version + ' @ ' + c.core.path),
    item(c.core.builtCli, T('sc_built'), c.core.launchMode),
    item(c.pnpmOnPath, 'pnpm on PATH', c.pnpmOnPath ? '' : T('sc_pnpm_hint')),
    item(c.peerLinks.failed.length === 0 && c.peerLinks.missing.length === 0, T('sc_peers'), (c.peerLinks.kept.length + c.peerLinks.linked.length) + ' links' + (c.peerLinks.missing.length ? ' · missing ' + c.peerLinks.missing.join(',') : '')),
    item(c.profile.rosterReadable !== false && c.profile.missing.length === 0, T('sc_profile'), c.profile.rosterReadable === false ? T('sc_roster_unreadable') : c.profile.missing.length ? T('sc_missing') + ' ' + c.profile.missing.join(', ') : c.profile.bundles.length + ' bundles'),
    ...((c.profile.outdated ?? []).length ? [item(false, T('sc_outdated'), (c.profile.outdated ?? []).map(p => T('sc_outdated_row', { n: p.name, v: p.installed, f: p.floor })).join('; '))] : []),
    item(true, T('sc_ports'), 'launcher ' + c.ports.launcher + ' · dsh ' + c.ports.dsh + (c.ports.dshRunning ? ' (running)' : ' (offline)')),
    item(true, T('sc_files'), ['deck', 'webSearch', 'safeGuard', 'frontendSkin'].filter(k => c.files[k]).join(', ') || '—'),
  ].join('')
}
async function refreshSelfCheck() { $('#selfcheck').textContent = T('t_calc'); renderSelfCheck(await api('/api/selfcheck')) }
async function refreshUpdate() { refreshVersions(); refreshSelfCheck(); pollUpdate() }
$('#btn-update-core').addEventListener('click', async () => { if (!confirm(T('t_confirm_core'))) return; toast((await api('/api/update/core', {})).message); pollUpdate() })
$('#btn-update-plugins').addEventListener('click', async () => { toast((await api('/api/update/plugins', {})).message); pollUpdate() })
$('#btn-update-latest').addEventListener('click', async () => {
  const tag = upstream?.tag || (upstream?.npmLatest ? 'dsh-v' + upstream.npmLatest : '')
  if (!tag) return toast(T('up_no_latest'))
  if (!confirm(T('t_confirm_tag', { tag }))) return
  toast((await api('/api/update/core-tag', { tag })).message); pollUpdate()
})
$('#btn-update-tag').addEventListener('click', async () => {
  const tag = $('#up-tag').value.trim(); if (!tag) return toast(T('up_tag_ph'))
  if (!confirm(T('t_confirm_tag', { tag }))) return
  toast((await api('/api/update/core-tag', { tag })).message); pollUpdate()
})
$('#btn-selfcheck').addEventListener('click', refreshSelfCheck)

// ── Tokens (Claude-Code-style Overview / Models, All / 30d / 7d, heatmap) ────
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n)
let usageRange = 'all'
async function refreshTokens() {
  const d = await api('/api/tokens?range=' + usageRange)
  const o = d.overview
  $('#u-sessions').textContent = o.sessions
  $('#u-messages').textContent = o.messages.toLocaleString()
  $('#u-total').textContent = fmt(o.totalTokens)
  $('#u-active').textContent = o.activeDays
  $('#u-cstreak').textContent = o.currentStreak + 'd'
  $('#u-lstreak').textContent = o.longestStreak + 'd'
  $('#u-busiest').textContent = o.busiestDay
  $('#u-favmodel').textContent = o.favoriteModel
  // Heatmap: columns = weeks, rows = Monday..Sunday
  const weeks = []
  for (let i = 0; i < d.heatmap.length; i++) { const w = Math.floor(i / 7); (weeks[w] ??= [])[i % 7] = d.heatmap[i] }
  $('#heatmap').innerHTML = weeks.map(col => `<div class="heat-col">${col.map(c => c ? `<div class="heat-cell l${c.level}" title="${esc(c.date)} · ${fmt(c.tokens)} tokens"></div>` : '<div class="heat-cell l0"></div>').join('')}</div>`).join('')
  // Fun fact (Moby-Dick yardstick) rendered in the UI language
  $('#fun-fact').textContent = d.mobyRatio > 0
    ? (d.mobyRatio >= 1
      ? T('t_fun_many', { n: d.mobyRatio >= 10 ? Math.round(d.mobyRatio) : d.mobyRatio.toFixed(1) })
      : T('t_fun_part', { n: Math.round(d.mobyRatio * 100) }))
    : T('t_fun_empty')
  $('#tbl-days tbody').innerHTML = d.daily.map(r => `<tr><td>${esc(r.date)}</td><td>${r.calls}</td><td class="ok">${fmt(r.hit)}</td><td class="warn">${fmt(r.miss)}</td><td>${fmt(r.output)}</td><td>${r.cost}</td></tr>`).join('') || ('<tr><td colspan="6" class="dim">' + T('t_empty_days') + '</td></tr>')
  $('#tbl-models tbody').innerHTML = d.models.map(r => `<tr><td>${esc(r.model)}</td><td>${fmt(r.tokens)}</td><td>${r.calls}</td><td class="ok">${fmt(r.hit)}</td><td class="warn">${fmt(r.miss)}</td><td>${fmt(r.output)}</td><td>${r.cost}</td></tr>`).join('') || ('<tr><td colspan="7" class="dim">' + T('t_empty') + '</td></tr>')
}
$$('#usage-range .seg-btn').forEach(b => b.addEventListener('click', () => {
  $$('#usage-range .seg-btn').forEach(x => x.classList.remove('active')); b.classList.add('active')
  usageRange = b.dataset.range; refreshTokens()
}))
$$('#usage-tab .seg-btn').forEach(b => b.addEventListener('click', () => {
  $$('#usage-tab .seg-btn').forEach(x => x.classList.remove('active')); b.classList.add('active')
  $('#usage-overview').style.display = b.dataset.utab === 'overview' ? '' : 'none'
  $('#usage-models').style.display = b.dataset.utab === 'models' ? '' : 'none'
}))

// ── Skins ───────────────────────────────────────────────────────────────────
async function refreshSkins() {
  const d = await api('/api/skins')
  const BUILTIN = { launcher: ['default', 'cyberpunk-2077', 'night-city-holo'], frontend: ['cyberpunk-2077', 'night-city-holo'] }
  const render = (target, box, allowNone) => {
    const items = (allowNone ? [T('skin_none')] : []).concat(d[target].list)
    box.innerHTML = items.map(n => {
      const active = (n === T('skin_none') ? d[target].active === '' || d[target].active === 'none' : d[target].active === n)
      const deletable = n !== T('skin_none') && !BUILTIN[target].includes(n)
      return `<span class="skin-wrap"><button class="btn skin ${active ? 'primary' : ''}" data-skin="${esc(n)}" data-target="${target}">${esc(n)}${active ? ' ✔' : ''}</button>${deletable ? `<button class="btn skin-del" data-skin="${esc(n)}" data-target="${target}" title="${T('skin_delete')}">✕</button>` : ''}</span>`
    }).join('')
  }
  render('launcher', $('#skins-launcher'), false)
  render('frontend', $('#skins-frontend'), true)
  $$('.skin').forEach(b => b.addEventListener('click', async () => {
    const name = b.dataset.skin === T('skin_none') ? 'none' : b.dataset.skin
    const r = await api('/api/skins/apply', { target: b.dataset.target, name })
    toast(r.message)
    if (b.dataset.target === 'launcher' && r.ok) $('#skin-link').href = '/skins/launcher/active.css?ts=' + Date.now()
    refreshSkins()
  }))
  $$('.skin-del').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(T('skin_delete') + ': ' + b.dataset.skin + '?')) return
    toast((await api('/api/skins/delete', { target: b.dataset.target, name: b.dataset.skin })).message)
    refreshSkins()
  }))
}
$('#btn-imp-l').addEventListener('click', async () => { toast((await api('/api/skins/import', { target: 'launcher', name: $('#imp-l-name').value, css: $('#imp-l-css').value })).message); refreshSkins() })
$('#btn-imp-f').addEventListener('click', async () => { toast((await api('/api/skins/import', { target: 'frontend', name: $('#imp-f-name').value, css: $('#imp-f-css').value })).message); refreshSkins() })

// ── Logs ────────────────────────────────────────────────────────────────────
let logSrc = 'launcher'
let logRaw = ''
function renderLogs() {
  const q = ($('#log-q').value || '').toLowerCase()
  const errorsOnly = $('#log-errors-only').checked
  const lines = logRaw.split('\n').filter(l => (!errorsOnly || /\[ERROR\]|error|fail/i.test(l)) && (!q || l.toLowerCase().includes(q)))
  const box = $('#log-view'); box.textContent = lines.join('\n') || '—'; box.scrollTop = box.scrollHeight
}
async function refreshLogs() {
  const d = await api('/api/logs?file=' + logSrc)
  logRaw = d.text || ''
  $('#log-download').dataset.src = logSrc
  renderLogs()
}
$$('.log-src').forEach(b => b.addEventListener('click', () => { $$('.log-src').forEach(x => x.classList.remove('active')); b.classList.add('active'); logSrc = b.dataset.log; refreshLogs() }))
$('#log-q').addEventListener('input', renderLogs)
$('#log-errors-only').addEventListener('change', renderLogs)
$('#log-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#log-view').textContent); toast(T('log_copied')) } catch { toast(T('log_copy_failed')) } })

// ── UI language / default-skin theme ────────────────────────────────────────
window.applyI18n()
const savedTheme = localStorage.getItem('lc-theme') || 'dark'
document.documentElement.dataset.theme = savedTheme
$('#lang-toggle').textContent = window.LANG === 'zh' ? '中 → EN' : 'EN → 中'
$('#lang-toggle').addEventListener('click', () => { localStorage.setItem('lc-lang', window.LANG === 'zh' ? 'en' : 'zh'); location.reload() })
$$('#theme-seg .seg-btn').forEach(b => {
  if (b.dataset.theme === savedTheme) b.classList.add('active')
  b.addEventListener('click', () => {
    localStorage.setItem('lc-theme', b.dataset.theme)
    document.documentElement.dataset.theme = b.dataset.theme
    $$('#theme-seg .seg-btn').forEach(x => x.classList.remove('active')); b.classList.add('active')
  })
})

// ── Polling and start-up ────────────────────────────────────────────────────

// ── Credentials center ──────────────────────────────────────────────────────
let credsRows = []
const CREDS_FEATURE = { 'model-route': 'creds_f_model', media: 'creds_f_media', 'web-search': 'creds_f_search', 'desktop-pet': 'creds_f_pet', 'memory-embeddings': 'creds_f_memory' }
// the binding details come from dsh in English; the zh page says them in Chinese
const credsDetail = d => (LANG === 'zh' ? d.replace(' · borrows route ', ' · 借用路由 ').replace(' · own endpoint', ' · 自有端点').replace(' · follows dsh default', ' · 跟随 dsh 默认').replace(' (selected)', '(当前选用)').replace(' (off)', '(已关闭)').replace(/ · (\d+) models?$/, ' · $1 个模型') : d)
async function refreshCreds({ models = true } = {}) {
  if (models) { refreshSyncStatus(); refreshDefaultModel() }
  const d = await api('/api/creds/list')
  if (!d.ok) { $('#creds-list').innerHTML = '<div class="dim">' + esc(d.offline ? T('creds_offline') : (d.message || T('creds_offline'))) + '</div>'; return }
  credsRows = Array.isArray(d.refs) ? d.refs : []
  credsStoreGone = d.storeAvailable === false
  renderCreds()
}
let credsStoreGone = false
function renderCreds() {
  const q = ($('#creds-q').value || '').trim().toLowerCase()
  const onlyBound = $('#creds-only-bound').checked
  const rows = credsRows.filter(r => (!onlyBound || r.bindings.length > 0) && (!q || [r.ref, r.alias, r.note, ...r.bindings.map(b => b.feature + ' ' + b.detail)].join(' ').toLowerCase().includes(q)))
  const storeLine = credsStoreGone ? '<div class="bad" style="margin-bottom:6px">' + esc(T('creds_store_gone')) + '</div>' : ''
  if (rows.length === 0) { $('#creds-list').innerHTML = storeLine + '<div class="dim">' + esc(credsRows.length === 0 ? T('creds_empty') : T('creds_no_match')) + '</div>'; return }
  const status = r => r.configured === true ? '<span class="ok">● ' + esc(T('creds_ok')) + '</span>' : r.configured === false ? '<span class="bad">○ ' + esc(T('creds_missing')) + '</span>' : '<span class="dim">' + esc(T('creds_unknown')) + (r.error ? ' · ' + esc(r.error) : '') + '</span>'
  $('#creds-list').innerHTML = storeLine + '<table class="tbl"><thead><tr><th>' + [T('creds_ref'), T('creds_alias'), T('creds_status'), T('creds_bound'), ''].map(esc).join('</th><th>') + '</th></tr></thead><tbody>'
    + rows.map(r => '<tr data-ref="' + esc(r.ref) + '">'
      + '<td><code>' + esc(r.ref) + '</code></td>'
      + '<td><input class="input mini creds-alias" value="' + esc(r.alias) + '" placeholder="' + esc(T('creds_alias_ph')) + '" style="max-width:120px;margin:0"> <input class="input mini creds-note" value="' + esc(r.note) + '" placeholder="' + esc(T('creds_note_ph')) + '" style="max-width:180px;margin:0"></td>'
      + '<td>' + status(r) + (r.source ? '<div class="dim nowrap">' + esc(T('creds_source')) + ': ' + esc(r.source) + '</div>' : '') + (r.writable === false ? '<div class="dim">' + esc(T('creds_readonly')) + '</div>' : '') + '</td>'
      + '<td>' + (r.bindings.length === 0 ? '<span class="dim">' + esc(T('creds_none')) + '</span>' : r.bindings.map(b => '<span class="chip" title="' + esc(b.detail) + '">' + esc(T(CREDS_FEATURE[b.feature] ?? b.feature)) + ' · ' + esc(credsDetail(b.detail)) + '</span>').join(' ')) + '</td>'
      + '<td class="creds-actions"><span class="creds-edit"><button class="btn mini creds-set"' + (r.writable === false ? ' disabled' : '') + '>' + esc(T('creds_set')) + '</button>' + ' <button class="btn mini creds-spares" aria-expanded="' + (credsOpenSpares.has(r.ref) ? 'true' : 'false') + '">' + esc(T('creds_spares', { n: r.slots > 0 ? ' (' + r.slots + ')' : '' })) + '</button>' + (r.configured === true ? ' <button class="btn mini danger creds-unset"' + (r.writable === false ? ' disabled' : '') + '>' + esc(T('creds_unset')) + '</button>' : '') + (r.bindings.length === 0 && r.configured !== true && !(r.slots > 0) ? ' <button class="btn mini creds-forget">' + esc(T('creds_forget')) + '</button>' : '') + '</span></td>'
      + '</tr>').join('') + '</tbody></table>'
  // Spares panels the owner opened stay open across every re-render of the table.
  for (const ref of [...credsOpenSpares]) {
    const tr = $('#creds-list tr[data-ref="' + CSS.escape(ref) + '"]')
    if (!tr) { credsOpenSpares.delete(ref); continue }
    const panel = document.createElement('tr'); panel.className = 'creds-spares-row'; panel.innerHTML = '<td colspan="5"><div class="dim">…</div></td>'
    tr.after(panel); renderSpares(panel, ref)
  }
  $$('#creds-list tr[data-ref]').forEach(tr => {
    const ref = tr.dataset.ref
    const saveAlias = async () => { const r = await api('/api/creds/alias', { ref, alias: tr.querySelector('.creds-alias').value, note: tr.querySelector('.creds-note').value }); toast(r.ok ? T('creds_saved') : T('creds_failed', { m: r.message || '' })) ; if (r.ok) { const row = credsRows.find(x => x.ref === ref); if (row) { row.alias = tr.querySelector('.creds-alias').value; row.note = tr.querySelector('.creds-note').value } } }
    for (const field of ['alias', 'note']) {
      const box = tr.querySelector('.creds-' + field)
      const original = box.value
      box.addEventListener('change', saveAlias)
      box.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); box.value = original; box.blur() }
        else if (e.key === 'Enter') { e.preventDefault(); saveAlias() }
      })
    }
    tr.querySelector('.creds-set')?.addEventListener('click', () => {
      const cell = tr.querySelector('.creds-edit')
      cell.innerHTML = '<input class="input mini creds-value" type="password" autocomplete="off" placeholder="' + esc(T('creds_value_ph')) + '" style="max-width:220px;margin:0"> <button class="btn mini primary creds-save">' + esc(T('creds_save')) + '</button> <button class="btn mini creds-cancel">' + esc(T('creds_cancel')) + '</button>'
      const valueBox = cell.querySelector('.creds-value')
      valueBox.focus()
      const focusRow = () => $('#creds-list tr[data-ref="' + CSS.escape(ref) + '"] .creds-set')?.focus()
      const cancel = () => { renderCreds(); focusRow() }
      const save = async () => {
        const value = valueBox.value
        if (!value.trim()) { toast(T('creds_empty_value')); valueBox.focus(); return }
        const r = await api('/api/creds/set', { ref, value })
        toast(r.ok ? T('creds_saved') : T('creds_failed', { m: r.message || '' }))
        await refreshCreds({ models: false })
        focusRow()
      }
      cell.querySelector('.creds-cancel').addEventListener('click', cancel)
      cell.querySelector('.creds-save').addEventListener('click', save)
      valueBox.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save() } else if (e.key === 'Escape') { e.preventDefault(); cancel() } })
    })
    tr.querySelector('.creds-spares')?.addEventListener('click', () => toggleSpares(tr, ref))
    tr.querySelector('.creds-forget')?.addEventListener('click', async () => {
      if (!confirm(T('creds_confirm_forget', { ref }))) return
      const r = await api('/api/creds/alias', { ref, remove: true })
      toast(r.ok ? T('creds_removed') : T('creds_failed', { m: r.message || '' }))
      await refreshCreds({ models: false })
      $('#creds-new').focus()
    })
    tr.querySelector('.creds-unset')?.addEventListener('click', async () => {
      if (!confirm(T('creds_confirm_unset', { ref }))) return
      const r = await api('/api/creds/unset', { ref })
      toast(r.ok ? T('creds_removed') : T('creds_failed', { m: r.message || '' }))
      await refreshCreds({ models: false })
      $('#creds-list tr[data-ref="' + CSS.escape(ref) + '"] .creds-set')?.focus()
    })
  })
}
/** The spare-keys panel of one reference: an extra table row under the reference's own. */
const credsOpenSpares = new Set()
const slotLabel = label => (window.LANG === 'zh' ? String(label).replace(/^previous (\S+ \S+)$/, '原密钥 $1').replace(/^kept (\S+ \S+)$/, '留存 $1').replace(/^spare (\d+)$/, '备用 $1') : String(label))
async function toggleSpares(tr, ref) {
  const open = tr.nextElementSibling?.classList.contains('creds-spares-row')
  if (open) { tr.nextElementSibling.remove(); tr.querySelector('.creds-spares')?.setAttribute('aria-expanded', 'false'); credsOpenSpares.delete(ref); return }
  credsOpenSpares.add(ref)
  const row = document.createElement('tr')
  row.className = 'creds-spares-row'
  row.innerHTML = '<td colspan="5"><div class="dim">…</div></td>'
  tr.after(row)
  tr.querySelector('.creds-spares')?.setAttribute('aria-expanded', 'true')
  await renderSpares(row, ref)
}
async function renderSpares(row, ref) {
  const d = await api('/api/creds/slots?ref=' + encodeURIComponent(ref))
  const cell = row.querySelector('td')
  if (!d || d.ok === false) { cell.innerHTML = '<div class="bad">' + esc(d?.message || T('creds_offline')) + '</div>'; return }
  const writable = credsRows.find(x => x.ref === ref)?.writable !== false
  const configured = credsRows.find(x => x.ref === ref)?.configured === true
  const list = d.slots.length === 0 ? '<div class="dim">' + esc(T('creds_spare_none')) + '</div>' : d.slots.map(s => '<div class="row gap wrap" data-slot="' + esc(s.id) + '" style="margin:2px 0">'
    + '<span' + (s.id === d.activeSlot ? ' class="ok"' : '') + '>' + (s.id === d.activeSlot ? '● ' : '○ ') + esc(slotLabel(s.label)) + '</span><span class="dim">' + esc(String(s.createdAt || '').slice(0, 10)) + '</span>'
    + (s.id === d.activeSlot ? '<span class="chip">' + esc(T('creds_spare_active')) + '</span>' : '') + (s.configured === false ? '<span class="bad">' + esc(T('creds_spare_missing')) + '</span>' : '')
    + '<span class="row gap" style="margin-left:auto"><button class="btn mini primary sp-use"' + (!writable || s.id === d.activeSlot || s.configured === false ? ' disabled' : '') + '>' + esc(T('creds_spare_use')) + '</button>'
    + '<button class="btn mini sp-rename">' + esc(T('creds_spare_rename')) + '</button><button class="btn mini danger sp-remove"' + (writable ? '' : ' disabled') + '>' + esc(T('creds_spare_remove')) + '</button></span></div>').join('')
  cell.innerHTML = '<div class="card" style="padding:10px 12px"><b>' + esc(T('creds_spares_title')) + '</b><div class="dim" style="margin:4px 0 8px">' + esc(T('creds_spares_hint')) + '</div>' + list
    + (configured ? '<div class="row gap wrap" style="margin-top:8px"><input class="input mini sp-keep-label" placeholder="' + esc(T('creds_spare_keep_label_ph')) + '" style="max-width:200px;margin:0"><button class="btn mini sp-keep"' + (writable ? '' : ' disabled') + '>' + esc(T('creds_spare_keep')) + '</button></div>' : '')
    + '<div class="row gap wrap" style="margin-top:6px"><input class="input mini sp-add-label" placeholder="' + esc(T('creds_spare_label_ph')) + '" style="max-width:200px;margin:0"><input class="input mini sp-add-value" type="password" autocomplete="off" placeholder="' + esc(T('creds_spare_value_ph')) + '" style="max-width:240px;margin:0"><button class="btn mini primary sp-add"' + (writable ? '' : ' disabled') + '>' + esc(T('creds_spare_add')) + '</button></div></div>'
  const act = async (path, body, okText) => {
    const r = await api('/api/creds/slots/' + path, { ref, ...body })
    if (!r || r.ok === false) { toast(T('creds_failed', { m: r?.message || '' })); return null }
    if (okText) toast(okText)
    // the table re-renders with every open panel restored; focus returns to this row's toggle
    await refreshCreds({ models: false })
    $('#creds-list tr[data-ref="' + CSS.escape(ref) + '"] .creds-spares')?.focus()
    return r
  }
  cell.querySelectorAll('[data-slot]').forEach(line => {
    const id = line.dataset.slot
    const label = slotLabel(d.slots.find(s => s.id === id)?.label ?? '')
    line.querySelector('.sp-use').addEventListener('click', async () => { const r = await act('use', { id }); if (r) toast(r.kept ? T('creds_spare_used_kept') : T('creds_spare_used')) })
    line.querySelector('.sp-rename').addEventListener('click', async () => { const next = prompt(T('creds_spare_rename_ph'), label); if (next === null || !next.trim() || next.trim() === label) return; await act('rename', { id, label: next.trim() }, T('creds_saved')) })
    line.querySelector('.sp-remove').addEventListener('click', async () => { if (!confirm(T('creds_spare_confirm_remove', { l: label }))) return; await act('remove', { id }, T('creds_removed')) })
  })
  const keep = async () => { const r = await act('keep', { label: cell.querySelector('.sp-keep-label').value }); if (r) toast(r.existed ? T('creds_spare_keep_exists') : T('creds_saved')) }
  cell.querySelector('.sp-keep')?.addEventListener('click', keep)
  cell.querySelector('.sp-keep-label')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); keep() } })
  cell.querySelector('.sp-add-label')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cell.querySelector('.sp-add-value')?.focus() } })
  const addBox = cell.querySelector('.sp-add-value')
  const add = async () => { const value = addBox.value; if (!value.trim()) { toast(T('creds_empty_value')); addBox.focus(); return } await act('add', { label: cell.querySelector('.sp-add-label').value, value }, T('creds_saved')) }
  cell.querySelector('.sp-add').addEventListener('click', add)
  addBox.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add() } })
}
$('#creds-refresh')?.addEventListener('click', refreshCreds)
let credsFilterTimer = null
$('#creds-q')?.addEventListener('input', () => { clearTimeout(credsFilterTimer); credsFilterTimer = setTimeout(renderCreds, 220) })
$('#creds-only-bound')?.addEventListener('change', () => { try { localStorage.setItem('dsh-launcher.creds.boundOnly', $('#creds-only-bound').checked ? '1' : '0') } catch { /* private mode */ } renderCreds() })
try { const saved = localStorage.getItem('dsh-launcher.creds.boundOnly'); if (saved !== null && $('#creds-only-bound')) $('#creds-only-bound').checked = saved === '1' } catch { /* private mode */ }
$('#creds-add')?.addEventListener('click', async () => {
  const ref = ($('#creds-new').value || '').trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(ref)) { toast(T('creds_invalid_ref')); return }
  const r = await api('/api/creds/alias', { ref, create: true })
  toast(r.ok ? (r.existed ? T('creds_exists') : T('creds_saved')) : T('creds_failed', { m: r.message || '' }))
  $('#creds-new').value = ''
  // a fresh reference has no binding yet: the "bound only" filter would hide what was just added
  // Only when it would hide what was just added: a preference the owner set stays set otherwise.
  if (r.ok && $('#creds-only-bound').checked) { $('#creds-only-bound').checked = false; try { localStorage.setItem('dsh-launcher.creds.boundOnly', '0') } catch { /* private mode */ } }
  refreshCreds({ models: false })
})
$('#creds-new')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#creds-add').click() } })

// ── Model list (dsh-provider-sync) and the dsh default model (agent-default-model), both on the credentials page ──
async function refreshSyncStatus() {
  const d = await api('/api/creds/sync-status')
  if (!d.ok) { $('#creds-sync-last').textContent = d.offline ? T('creds_offline') : (d.message || T('creds_offline')); return }
  $('#creds-sync-last').textContent = T('creds_sync_last', { t: d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString() : T('creds_sync_never') }) + (d.lastError ? ' · ' + d.lastError : '')
  if (typeof d.anthropicNote === 'boolean') $('#creds-note').checked = d.anthropicNote
}
let credsSyncPending = false
$('#creds-note')?.addEventListener('change', async () => {
  const box = $('#creds-note')
  const r = await api('/api/creds/sync-settings', { anthropicNote: box.checked })
  toast(r.ok ? T('creds_saved') : T('creds_failed', { m: r.message || '' }))
  if (!r.ok) { box.checked = !box.checked; return }
  if ($('#creds-sync').disabled) credsSyncPending = true; else $('#creds-sync').click()
})
$('#creds-sync')?.addEventListener('click', async () => {
  const btn = $('#creds-sync'); btn.disabled = true; btn.textContent = T('creds_syncing'); $('#creds-sync-result').textContent = ''
  try {
    const d = await api('/api/creds/sync-models', {}).catch(e => ({ ok: false, message: String(e && e.message || e) }))
    if (!d.ok) { $('#creds-sync-result').textContent = d.offline ? T('creds_offline') : T('creds_failed', { m: d.message || '' }); return }
    const routes = Object.values(d.routes || {})
    const sum = routes.reduce((a, v) => ({ models: a.models + (v.models || 0), added: a.added + (v.added || 0), updated: a.updated + (v.updated || 0), noted: a.noted + (v.noted || 0), reasoning: a.reasoning + (v.reasoning || 0) }), { models: 0, added: 0, updated: 0, noted: 0, reasoning: 0 })
    $('#creds-sync-result').textContent = routes.length === 0 ? T('creds_sync_none') : T('creds_sync_result', sum) + (sum.noted ? ' · ' + T('creds_sync_noted', { noted: sum.noted }) : '')
    await refreshSyncStatus(); await refreshDefaultModel()
  } finally { btn.disabled = false; btn.textContent = T('creds_sync'); if (credsSyncPending) { credsSyncPending = false; btn.click() } }
})
let credsRoutes = []
let credsDefault = { provider: '', model: '' }
// Only an llm-pi-ai route has a list of its own an unlisted id can join; the others are fixed sets.
function canUnlist(route) { return !!route && route.ns === 'llm-pi-ai' && Array.isArray(route.models) && route.models.length > 0 }
function unlistedOn() { return canUnlist(credsRoutes.find(r => r.route === $('#creds-default-route').value)) && $('#creds-default-unlisted').checked }
function fillDefaultModels() {
  const route = credsRoutes.find(r => r.route === $('#creds-default-route').value)
  const models = route ? route.models : []
  const sel = $('#creds-default-model'), text = $('#creds-default-model-text')
  const unlistedLabel = $('#creds-default-unlisted').closest('label')
  if (unlistedLabel) unlistedLabel.style.display = canUnlist(route) ? '' : 'none'
  const unlisted = unlistedOn()
  const useText = models.length === 0 || unlisted
  sel.style.display = useText ? 'none' : ''
  text.style.display = useText ? '' : 'none'
  const vendorOf = id => { const i = String(id).indexOf('/'); return i > 0 ? String(id).slice(0, i).replace(/^~/, '') : '' }
  const groups = new Map()
  for (const m of models) { const v = vendorOf(m.id); if (!groups.has(v)) groups.set(v, []); groups.get(v).push(m) }
  const option = m => '<option value="' + esc(m.id) + '">' + esc(m.name && m.name !== m.id ? m.id + ' — ' + m.name : m.id) + '</option>'
  sel.innerHTML = [...groups.entries()].map(([v, list]) => (v ? '<optgroup label="' + esc(v) + '">' + list.map(option).join('') + '</optgroup>' : list.map(option).join(''))).join('')
  const current = route && route.route === credsDefault.provider ? credsDefault.model : (models[0] ? models[0].id : '')
  if (models.some(m => m.id === current)) sel.value = current
  else if (models.length > 0) { sel.insertAdjacentHTML('afterbegin', '<option value="">—</option>'); sel.value = '' }
  if (!text.value) text.value = current
  updateDefaultApply()
}
function updateDefaultApply() {
  const provider = $('#creds-default-route').value
  const useText = $('#creds-default-model-text').style.display !== 'none'
  const model = (useText ? $('#creds-default-model-text').value : $('#creds-default-model').value).trim()
  const dirty = provider !== credsDefault.provider || model !== credsDefault.model
  $('#creds-default-apply').disabled = !provider || !model || !dirty
}
async function refreshDefaultModel() {
  const d = await api('/api/creds/models')
  if (!d.ok) { $('#creds-default-current').textContent = d.offline ? T('creds_offline') : (d.message || ''); return }
  credsRoutes = Array.isArray(d.routes) ? d.routes : []
  credsDefault = d.default || { provider: '', model: '' }
  $('#creds-default-current').textContent = T('creds_default_current', { p: credsDefault.provider || '—', m: credsDefault.model || '—' })
  const routeSel = $('#creds-default-route')
  routeSel.innerHTML = credsRoutes.length === 0 ? '<option value="">' + esc(T('creds_no_routes')) + '</option>' : credsRoutes.map(r => '<option value="' + esc(r.route) + '">' + esc((r.displayName && r.displayName !== r.route ? r.route + ' — ' + r.displayName : r.route) + (r.baseURL ? ' · ' + r.baseURL.replace(/^https?:\/\//, '') : '')) + '</option>').join('')
  if (credsRoutes.some(r => r.route === credsDefault.provider)) routeSel.value = credsDefault.provider
  $('#creds-default-model-text').value = ''
  fillDefaultModels()
}
$('#creds-default-route')?.addEventListener('change', () => { $('#creds-default-model-text').value = ''; fillDefaultModels() })
$('#creds-default-unlisted')?.addEventListener('change', fillDefaultModels)
$('#creds-default-model')?.addEventListener('change', updateDefaultApply)
$('#creds-default-model-text')?.addEventListener('input', updateDefaultApply)
$('#creds-default-apply')?.addEventListener('click', async () => {
  const provider = $('#creds-default-route').value
  const useText = $('#creds-default-model-text').style.display !== 'none'
  const model = (useText ? $('#creds-default-model-text').value : $('#creds-default-model').value).trim()
  if (!provider || !model) { toast(T('creds_pick_both')); return }
  const r = await api('/api/creds/default-model', { provider, model, allowUnlisted: unlistedOn() })
  toast(r.ok ? T('creds_default_applied') : T('creds_failed', { m: r.message || '' }))
  if (r.ok) { refreshDefaultModel(); refreshDash() }
})

const refreshers = { dash: refreshDash, plugins: refreshPlugins, skills: refreshSkills, sessions: refreshSessions, storage: refreshStorage, tokens: refreshTokens, skins: refreshSkins, logs: refreshLogs, update: refreshUpdate, creds: refreshCreds }
if (new URLSearchParams(location.search).has('noanim')) document.documentElement.classList.add('noanim') // screenshots / recordings: no animation
refreshDash(); refreshSkins()
// Restore the view named by the URL hash (e.g. /#deck) once every script (incl. deck-market.js refreshers) has loaded
const showHashView = () => {
  // No hash is the initial state: Back to it must return to the dashboard, not leave the URL and
  // the view disagreeing.
  const view = location.hash.replace('#', '') || 'dash'
  const btn = $$('.nav-btn').find(b => b.dataset.view === view)
  if (btn && !btn.classList.contains('active')) btn.click()
}
document.addEventListener('DOMContentLoaded', showHashView)
// Back / Forward change the hash without reloading: follow them, or the URL and the view disagree.
window.addEventListener('hashchange', showHashView)
setInterval(() => { if ($('#view-dash').classList.contains('active')) refreshDash() }, 3000)
$('#log-download')?.addEventListener('click', () => window.apiDownload('/api/logs?file=' + ($('#log-download').dataset.src ?? 'launcher') + '&download=1&full=1', 'dsh-' + ($('#log-download').dataset.src ?? 'launcher') + '.log'))
$('#btn-console-clear').addEventListener('click', () => { $('#dash-log').textContent = '—' })
