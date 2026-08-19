/** 控制甲板 v2 + 市场 + funFact 双语(依赖 app.js 的 $/$$, api, toast, esc, T, refreshers)。 */

// ── 控制甲板 v2:卡片式编辑器(每条一张卡,展开全字段;语义对齐 SillyTavern) ──
const cb = (f, v) => '<label class="deck-cb"><input type="checkbox" data-f="' + f + '"' + (v ? ' checked' : '') + '> ' + f + '</label>'
const inp = (f, v, w, ph) => '<input class="input" data-f="' + f + '" style="width:' + (w || 90) + 'px" value="' + esc(v ?? '') + '"' + (ph ? ' placeholder="' + ph + '"' : '') + '>'
const numi = (f, v, w) => '<input class="input" type="number" data-f="' + f + '" style="width:' + (w || 70) + 'px" value="' + (v ?? '') + '">'

function deckCard(kind, v = {}) {
  const del = '<button class="btn mini danger deck-del" style="float:right">✕</button>'
  if (kind === 'prompts') {
    return '<div class="deck-card">' + del +
      '<div class="deck-line">' + cb('enabled', v.enabled !== false) + ' 名称 ' + inp('name', v.name, 120) + ' order ' + numi('order', v.order ?? 100) +
      ' 位置 <select class="input" data-f="position" style="width:120px"><option value="system"' + (v.position !== 'user-prefix' ? ' selected' : '') + '>system 分级</option><option value="user-prefix"' + (v.position === 'user-prefix' ? ' selected' : '') + '>user 前置</option></select>' +
      ' 间隔 ' + numi('interval', v.interval ?? 1) + '</div>' +
      '<textarea class="input" data-f="text" style="width:96%;min-height:44px" placeholder="提示词内容">' + esc(v.text ?? '') + '</textarea></div>'
  }
  if (kind === 'regex') {
    const pl = Array.isArray(v.placement) ? v.placement : ['user_input']
    return '<div class="deck-card">' + del +
      '<div class="deck-line">' + cb('enabled', v.enabled !== false) + ' 名称 ' + inp('name', v.name, 110) +
      ' <label class="deck-cb"><input type="checkbox" data-f="pl_user"' + (pl.includes('user_input') ? ' checked' : '') + '> 用户输入</label>' +
      ' <label class="deck-cb"><input type="checkbox" data-f="pl_wi"' + (pl.includes('world_info') ? ' checked' : '') + '> 世界书</label></div>' +
      '<div class="deck-line">find ' + inp('findRegex', v.findRegex ?? v.pattern, 200, '正则') + ' flags ' + inp('flags', v.flags ?? 'g', 56) + '</div>' +
      '<div class="deck-line">replace ' + inp('replaceString', v.replaceString ?? v.replace, 220, '{{match}} / $1') + ' trim(逗号) ' + inp('trimStrings', (v.trimStrings ?? []).join(','), 140) + '</div></div>'
  }
  // lorebook
  const logic = v.selectiveLogic ?? 'andAny'
  const opt = (val, cur) => '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + val + '</option>'
  return '<div class="deck-card">' + del +
    '<div class="deck-line">' + cb('enabled', v.enabled !== false) + ' 名称 ' + inp('name', v.name, 110) + ' ' + cb('constant', v.constant === true) + '(蓝点常驻) order ' + numi('order', v.order ?? 100) + ' 概率% ' + numi('probability', v.probability ?? 100) + '</div>' +
    '<div class="deck-line">keys ' + inp('keys', (v.keys ?? v.keywords ?? []).join(','), 220, '纯文本或 /正则/') + '</div>' +
    '<div class="deck-line">副键 ' + inp('secondaryKeys', (v.secondaryKeys ?? []).join(','), 180) +
    ' 逻辑 <select class="input" data-f="selectiveLogic" style="width:110px">' + opt('andAny', logic) + opt('andAll', logic) + opt('notAny', logic) + opt('notAll', logic) + '</select>' +
    ' ' + cb('caseSensitive', v.caseSensitive === true) + ' ' + cb('matchWholeWords', v.matchWholeWords === true) + '</div>' +
    '<div class="deck-line">分组 ' + inp('group', v.group, 90) + ' 权重 ' + numi('groupWeight', v.groupWeight ?? 100) + ' sticky ' + numi('sticky', v.sticky ?? 0) + ' cooldown ' + numi('cooldown', v.cooldown ?? 0) + ' delay ' + numi('delay', v.delay ?? 0) + '</div>' +
    '<div class="deck-line">' + cb('excludeRecursion', v.excludeRecursion === true) + ' ' + cb('preventRecursion', v.preventRecursion === true) + ' ' + cb('delayUntilRecursion', v.delayUntilRecursion === true) + '</div>' +
    '<textarea class="input" data-f="content" style="width:96%;min-height:40px" placeholder="注入内容">' + esc(v.content ?? '') + '</textarea></div>'
}

function collectCards(sel, kind) {
  return [...document.querySelectorAll(sel + ' > .deck-card')].map(card => {
    const g = f => card.querySelector('[data-f="' + f + '"]')
    const val = f => g(f) ? g(f).value : ''
    const chk = f => g(f) ? g(f).checked : false
    const csv = f => val(f).split(',').map(x => x.trim()).filter(Boolean)
    if (kind === 'prompts') return { name: val('name'), enabled: chk('enabled'), order: Number(val('order')), text: val('text'), position: val('position'), interval: Number(val('interval')) || 1 }
    if (kind === 'regex') {
      const placement = []
      if (chk('pl_user')) placement.push('user_input')
      if (chk('pl_wi')) placement.push('world_info')
      return { name: val('name'), enabled: chk('enabled'), findRegex: val('findRegex'), flags: val('flags'), replaceString: val('replaceString'), trimStrings: csv('trimStrings'), placement }
    }
    return {
      name: val('name'), enabled: chk('enabled'), keys: csv('keys'), secondaryKeys: csv('secondaryKeys'), selectiveLogic: val('selectiveLogic'),
      content: val('content'), constant: chk('constant'), probability: Number(val('probability')), order: Number(val('order')),
      caseSensitive: chk('caseSensitive'), matchWholeWords: chk('matchWholeWords'), group: val('group'), groupWeight: Number(val('groupWeight')),
      sticky: Number(val('sticky')), cooldown: Number(val('cooldown')), delay: Number(val('delay')),
      excludeRecursion: chk('excludeRecursion'), preventRecursion: chk('preventRecursion'), delayUntilRecursion: chk('delayUntilRecursion'),
    }
  })
}
async function refreshDeck() {
  const { deck = {} } = await api('/api/deck')
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
  $('#deck-tools-off').value = (deck.disabledTools ?? []).join(',')
}
$('#deck-add-prompt')?.addEventListener('click', () => $('#deck-prompts').insertAdjacentHTML('beforeend', deckCard('prompts')))
$('#deck-add-regex')?.addEventListener('click', () => $('#deck-regex').insertAdjacentHTML('beforeend', deckCard('regex')))
$('#deck-add-lore')?.addEventListener('click', () => $('#deck-lore').insertAdjacentHTML('beforeend', deckCard('lore')))
document.addEventListener('click', e => { if (e.target.classList?.contains('deck-del')) e.target.closest('.deck-card').remove() })
$('#deck-save')?.addEventListener('click', async () => {
  const num = id => $(id).value === '' ? undefined : Number($(id).value)
  const body = {
    prompts: collectCards('#deck-prompts', 'prompts'),
    regex: collectCards('#deck-regex', 'regex'),
    lorebook: collectCards('#deck-lore', 'lore'),
    sampling: { enabled: $('#deck-sampling-on').checked, temperature: num('#deck-temp'), maxTokens: num('#deck-maxtok'), stop: $('#deck-stop').value.split(',').map(x => x.trim()).filter(Boolean) },
    settings: { scanDepth: num('#deck-scandepth'), maxRecursionSteps: num('#deck-maxrec'), budgetChars: num('#deck-budget') },
    disabledTools: $('#deck-tools-off').value.split(',').map(x => x.trim()).filter(Boolean),
  }
  const r = await api('/api/deck', body)
  toast(r.message || T('t_saved'))
})
refreshers.deck = refreshDeck


// ── 市场 ────────────────────────────────────────────────────────────────────
function marketRow(it, type) {
  // git+https://…​.git 形式的 repository 链接归一成可打开的网页地址
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
  else if (b.dataset.type === 'skin') refreshers.skins?.() // 皮肤装进皮肤管理页,不进插件
  else refreshers.plugins?.()
})

// ── funFact 双语 ────────────────────────────────────────────────────────────
const origTokens = refreshers.tokens
refreshers.tokens = async function () {
  await origTokens()
  const d = await api('/api/tokens?range=' + usageRange)
  if (d.mobyRatio > 0) {
    $('#fun-fact').textContent = d.mobyRatio >= 1
      ? T('t_fun_many', { n: d.mobyRatio >= 10 ? Math.round(d.mobyRatio) : d.mobyRatio.toFixed(1) })
      : T('t_fun_part', { n: Math.round(d.mobyRatio * 100) })
  }
}

// ── 快速新建工作区(经 dsh-quick-workspace 插件) ────────────────────────────
$('#btn-ws-create')?.addEventListener('click', async () => {
  const path = $('#ws-path').value.trim()
  if (!path) return toast(T('ws_ph'))
  const r = await api('/api/workspace/create', { path })
  toast(r.message)
})
