// Render the content model to the showcase HTML page (restrained dark documentation look).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'H:/DSH-CyberWorkStation';
const markedUrl = pathToFileURL(path.join(REPO, 'core/node_modules/.pnpm/marked@16.4.2/node_modules/marked/lib/marked.esm.js')).href;
const { marked } = await import(markedUrl);
marked.use({ gfm: true, breaks: false });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md = (s) => marked.parse((s || '').trim()).replace(/<table>/g, '<div class="tw"><table>').replace(/<\/table>/g, '</table></div>');
const ORIGIN_LABEL = { original: '原创', fork: '二改', adopted: '照搬', core: '上游' };
const SHORT = { overview: '概览', launcher: '启动器', dsh: '本体界面', 'model-launcher': '模型启动器', beyond: '图外能力', memory: '记忆与上下文', roster: '插件清单', skills: 'Skill', skins: '皮肤', principles: '许可与致谢' };

function imgSrc(name, meta, opts) {
  if (opts.inline) {
    const file = path.join(REPO, meta.shotDir, `${name}.webp`);
    return `data:image/webp;base64,${fs.readFileSync(file).toString('base64')}`;
  }
  return `${opts.imgBase}/${name}.webp`;
}

function figure(b, meta, opts) {
  const src = imgSrc(b.img, meta, opts);
  return `
<figure class="fig reveal" id="fig-${b.fig}">
  <div class="fig-head"><span class="no">图 ${Number(b.fig)}</span><span class="ti">${esc(b.title)}</span>${b.sub ? `<span class="su">${esc(b.sub)}</span>` : ''}</div>
  <a class="fig-img" href="${src}" data-lightbox data-fig="${b.fig}" data-title="${esc(b.title)}" data-sub="${esc(b.sub || '')}"><img loading="lazy" decoding="async" src="${src}" alt="${esc(b.title)}"></a>
  <div class="fig-body">
    <div class="fig-col"><div class="prose">${md(b.what)}</div></div>
    <div class="fig-col"><div class="prose">${md(b.did)}</div></div>
  </div>
  ${b.beyond ? `<aside class="fig-beyond"><div class="prose">${md(b.beyond)}</div></aside>` : ''}
</figure>`;
}

function roster(b) {
  const all = b.groups.flatMap((g) => g.items);
  const counts = {};
  for (const it of all) counts[it.origin] = (counts[it.origin] || 0) + 1;
  const chips = [['all', '全部', all.length], ['original', '原创', counts.original || 0], ['fork', '二改', counts.fork || 0], ['adopted', '照搬', counts.adopted || 0], ['core', '上游本体', counts.core || 0]]
    .map(([f, l, n]) => `<button data-f="${f}">${l}<b>${n}</b></button>`).join('');
  const groups = b.groups.map((g) => `
<div class="roster-group" data-key="${g.key}">
  <h3>${esc(g.label)} <span class="badge ${g.items[0]?.origin || 'core'}">${esc(g.badge)}</span></h3>
  <div class="gdesc prose">${md(g.desc || '')}</div>
  <div class="roster-grid">${g.items.map((it) => `
    <article class="rcard" data-origin="${it.origin}">
      <header><span class="rname">${esc(it.name)}</span><span class="rver">${esc(it.ver)}</span><span class="badge ${it.origin}">${ORIGIN_LABEL[it.origin] || it.origin}</span></header>
      <div class="rrole prose">${md(it.role)}</div>
      ${it.upstream || it.where ? `<dl>${it.upstream ? `<dt>上游</dt><dd>${esc(it.upstream)}</dd>` : ''}${it.where ? `<dt>位置</dt><dd>${esc(it.where)}</dd>` : ''}</dl>` : ''}
    </article>`).join('')}
  </div>
</div>`).join('');
  return `<div class="roster reveal"><div class="roster-bar">${chips}<span class="count"></span></div>${groups}</div>`;
}

function section(s, meta, opts) {
  const blocks = s.blocks.map((b) => {
    if (b.type === 'md') return `<div class="prose reveal">${md(b.md)}</div>`;
    if (b.type === 'figure') return figure(b, meta, opts);
    if (b.type === 'diagram') { const svg = opts.diagrams[b.id]; return svg ? `<div class="diagram reveal" data-diagram="${b.id}">${svg}</div>` : `<div class="prose reveal">${md(b.md)}</div>`; }
    if (b.type === 'roster') return roster(b);
    return '';
  }).join('\n');
  return `
<section class="sec" id="${s.id}">
  <div class="wrap">
    <header class="sec-head reveal"><h2><span class="n">${s.num}</span>${esc(s.title)}</h2></header>
    ${s.intro && s.intro.trim() ? `<div class="sec-intro prose reveal">${md(s.intro)}</div>` : ''}
    ${blocks}
  </div>
</section>`;
}

export function renderHtml(doc, opts) {
  const { meta, sections } = doc;
  const heroImg = imgSrc('01-launcher-dashboard', meta, opts);
  const nav = sections.map((s) => `<a href="#${s.id}" title="${esc(s.title)}"><b>${s.num}</b>${esc(SHORT[s.id] || s.title)}</a>`).join('');
  const facts = meta.stats.map((st) => `<div class="fact"><div class="n">${esc(st.n)}</div><div class="l">${esc(st.label)}</div><div class="s">${esc(st.sub)}</div></div>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)} — ${esc(meta.subtitle)}</title>
<meta name="description" content="${esc(meta.tagline)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='4' y='4' width='24' height='24' rx='5' fill='%23d9a441'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${opts.css}</style>
</head>
<body>
<header class="topbar"><div class="wrap">
  <a class="brand" href="#top">DSH <span>CyberWorkStation</span></a>
  <nav class="index">${nav}</nav>
</div></header>
<main>
<section class="hero" id="top">
  <div class="wrap">
    <h1>DSH <span>CyberWorkStation</span></h1>
    <p class="sub">${esc(meta.subtitle)}</p>
    <p class="tagline">${esc(meta.tagline)}</p>
    <div class="facts">${facts}</div>
    <div class="shot"><a href="${heroImg}" data-lightbox data-fig="01" data-title="仪表盘" data-sub=""><img src="${heroImg}" alt="DSH 启动器仪表盘" decoding="async"></a><div class="cap">DSH 启动器 · 仪表盘 · night-city-holo 皮肤 · 截图 ${esc(meta.shotDate)}</div></div>
  </div>
</section>
${sections.map((s) => section(s, meta, opts)).join('\n')}
</main>
<footer><div class="wrap"><span>${esc(meta.title)} · <a href="${esc(meta.repo)}">${esc(meta.repo.replace(/^https?:\/\//, ''))}</a></span><span>本体 dsh ${esc(meta.coreVersion)} · 截图 ${esc(meta.shotDate)} · MIT</span></div></footer>
<button class="totop" aria-label="回到顶部">↑</button>
<div id="lb" class="lb" role="dialog" aria-modal="true"><button class="close" aria-label="关闭">✕</button><button class="prev" aria-label="上一张">‹</button><img alt=""><div class="cap"></div><button class="next" aria-label="下一张">›</button></div>
<script>${opts.js}</script>
</body>
</html>`;
}
