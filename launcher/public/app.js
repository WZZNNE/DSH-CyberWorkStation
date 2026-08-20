/** DSH Launcher 前端逻辑:视图切换 + API 调用 + 轮询。皮肤只管样式,逻辑在此。 */
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200) }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ── 视图切换 ────────────────────────────────────────────────────────────────
$$('.nav-btn').forEach(b => b.addEventListener('click', () => {
  $$('.nav-btn').forEach(x => x.classList.remove('active')); b.classList.add('active')
  $$('.view').forEach(v => v.classList.remove('active')); $('#view-' + b.dataset.view).classList.add('active')
  location.hash = b.dataset.view // 可分享的直达链接,如 #deck / #skins
  refreshers[b.dataset.view]?.()
}))
$$('[data-open]').forEach(b => b.addEventListener('click', async () => toast((await api('/api/open', { key: b.dataset.open })).message)))

// ── 仪表盘 ──────────────────────────────────────────────────────────────────
async function refreshDash() {
  const s = await api('/api/status')
  const el = $('#dash-state')
  const wasRunning = el.dataset.running === '1'
  el.textContent = s.dshRunning ? '● RUNNING' : '○ OFFLINE'
  el.className = 'stat-value ' + (s.dshRunning ? 'ok' : 'off')
  // OFFLINE→RUNNING 翻转:上线特效(动画结束自清)
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
  if (r.ok) window.open('http://127.0.0.1:3080', '_blank')
})
$('#btn-stop').addEventListener('click', async () => { const r = await api('/api/dsh/stop', {}); toast(r.message); refreshDash() })
$('#btn-openui').addEventListener('click', () => window.open('http://127.0.0.1:3080', '_blank'))

// ── 插件 ────────────────────────────────────────────────────────────────────
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

// ── Skills / 会话 / 存储 ────────────────────────────────────────────────────
async function refreshSkills() {
  const d = await api('/api/skills')
  $('#tbl-skills tbody').innerHTML = d.skills.map(s => `<tr><td>${esc(s.name)}</td><td class="dim">${esc(s.source)}</td><td class="dim">${esc(s.description)}</td></tr>`).join('') || ('<tr><td colspan="3" class="dim">' + T('t_no_skills') + '</td></tr>')
}
async function refreshSessions() {
  const d = await api('/api/sessions')
  $('#sessions-total').textContent = T('t_total', { n: d.total, dir: d.dir })
  $('#tbl-sessions tbody').innerHTML = d.sessions.map(s => `<tr><td>${esc(s.name)}</td><td>${s.sizeKB}</td><td class="dim">${esc(s.mtime)}</td></tr>`).join('') || ('<tr><td colspan="3" class="dim">' + T('t_no_sessions') + '</td></tr>')
}
async function refreshStorage() {
  $('#tbl-storage tbody').innerHTML = ('<tr><td colspan="4" class="dim">' + T('t_calc') + '</td></tr>')
  const d = await api('/api/storage')
  $('#tbl-storage tbody').innerHTML = d.folders.map(f => `<tr>
    <td>${esc(window.LANG === "zh" ? f.label : T(f.labelKey))}</td><td>${f.exists ? f.sizeMB : '—'}</td><td class="dim">${esc(f.path)}</td>
    <td><button class="btn mini" data-open2="${esc(f.key)}">${T('jump')}</button></td></tr>`).join('')
  $$('#tbl-storage [data-open2]').forEach(b => b.addEventListener('click', async () => toast((await api('/api/open', { key: b.dataset.open2 })).message)))
}

// ── 更新 ────────────────────────────────────────────────────────────────────
let updatePolling = null
function pollUpdate() {
  clearInterval(updatePolling)
  updatePolling = setInterval(async () => {
    const s = await api('/api/update/status')
    const active = s.core.running ? 'core' : s.plugins.running ? 'plugins' : null
    $('#update-log').textContent = (s.core.running || s.core.log ? s.core.log : s.plugins.log) .slice(-8000) || '—'
    if (active === null) clearInterval(updatePolling)
  }, 2000)
}
$('#btn-update-core').addEventListener('click', async () => { if (!confirm(T('t_confirm_core'))) return; toast((await api('/api/update/core', {})).message); pollUpdate() })
$('#btn-update-plugins').addEventListener('click', async () => { toast((await api('/api/update/plugins', {})).message); pollUpdate() })

// ── Tokens(CC 风格 Overview/Models + All/30d/7d + 热力格) ─────────────────
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
  // 热力格:列=周,行=周一..周日
  const weeks = []
  for (let i = 0; i < d.heatmap.length; i++) { const w = Math.floor(i / 7); (weeks[w] ??= [])[i % 7] = d.heatmap[i] }
  $('#heatmap').innerHTML = weeks.map(col => `<div class="heat-col">${col.map(c => c ? `<div class="heat-cell l${c.level}" title="${esc(c.date)} · ${fmt(c.tokens)} tokens"></div>` : '<div class="heat-cell l0"></div>').join('')}</div>`).join('')
  $('#fun-fact').textContent = d.funFact || T('t_fun_empty')
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

// ── 皮肤 ────────────────────────────────────────────────────────────────────
async function refreshSkins() {
  const d = await api('/api/skins')
  const BUILTIN = { launcher: ['default', 'cyberpunk-2077'], frontend: ['cyberpunk-2077'] }
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
$('#btn-imp-l').addEventListener('click', async () => toast((await api('/api/skins/import', { target: 'launcher', name: $('#imp-l-name').value, css: $('#imp-l-css').value })).message) || refreshSkins())
$('#btn-imp-f').addEventListener('click', async () => toast((await api('/api/skins/import', { target: 'frontend', name: $('#imp-f-name').value, css: $('#imp-f-css').value })).message) || refreshSkins())

// ── 日志 ────────────────────────────────────────────────────────────────────
let logSrc = 'launcher'
async function refreshLogs() {
  const d = await api('/api/logs?file=' + logSrc)
  const box = $('#log-view'); box.textContent = d.text || '—'; box.scrollTop = box.scrollHeight
}
$$('.log-src').forEach(b => b.addEventListener('click', () => { $$('.log-src').forEach(x => x.classList.remove('active')); b.classList.add('active'); logSrc = b.dataset.log; refreshLogs() }))

// ── 轮询与初始化 ────────────────────────────────────────────────────────────
// ── 界面语言 / default 主题 ────────────────────────────────────────────────
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

const refreshers = { dash: refreshDash, plugins: refreshPlugins, skills: refreshSkills, sessions: refreshSessions, storage: refreshStorage, tokens: refreshTokens, skins: refreshSkins, logs: refreshLogs, update: pollUpdate }
if (new URLSearchParams(location.search).has('noanim')) document.documentElement.classList.add('noanim') // 截图/录屏:禁动画
refreshDash(); refreshSkins()
// URL hash 直达视图(如 /#deck):启动时还原,便于分享与截图
{
  const view = location.hash.replace('#', '')
  const btn = view === '' ? null : $$('.nav-btn').find(b => b.dataset.view === view)
  if (btn) btn.click()
}
setInterval(() => { if ($('#view-dash').classList.contains('active')) refreshDash() }, 3000)
$('#btn-console-clear').addEventListener('click', () => { $('#dash-log').textContent = '—' })
