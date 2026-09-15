// Render the content model to a single Markdown document (README.zh.md).
// Figures are a heading, the screenshot, a paragraph on what the page does, then the notes as plain bullets;
// no per-figure labels, no numbered chapter prefixes.

function figureMd(b, meta) {
  const src = `${meta.shotDir}/${b.img}.webp`;
  const out = [];
  out.push(`### 图 ${Number(b.fig)}：${b.title}`);
  out.push('');
  if (b.sub) { out.push(`*${b.sub}*`); out.push(''); }
  out.push(`![${b.title}](${src})`);
  out.push('');
  out.push(b.what.trim());
  out.push('');
  out.push(b.did.trim());
  if (b.beyond) {
    out.push('');
    out.push(b.beyond.trim());
  }
  out.push('');
  return out.join('\n');
}

const ORIGIN_LABEL = { original: '原创', fork: '二改', adopted: '照搬', core: '上游' };

function rosterMd(b) {
  const out = [];
  for (const g of b.groups) {
    out.push(`### ${g.label}`);
    out.push('');
    if (g.desc) { out.push(g.desc.trim()); out.push(''); }
    const hasUpstream = g.items.some((i) => i.upstream);
    const head = ['插件 / 程序', '版本', '归属'];
    if (hasUpstream) head.push('上游 / 许可');
    head.push('职责');
    head.push('界面位置');
    out.push(`| ${head.join(' | ')} |`);
    out.push(`|${head.map(() => '---').join('|')}|`);
    for (const it of g.items) {
      const cells = [`\`${it.name}\``, it.ver, ORIGIN_LABEL[it.origin] || it.origin];
      if (hasUpstream) cells.push(it.upstream || '—');
      cells.push(it.role.replace(/\n+/g, ' '));
      cells.push(it.where || '—');
      out.push(`| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

export function renderMarkdown(doc) {
  const { meta, sections } = doc;
  const out = [];
  out.push(`# ${meta.title}`);
  out.push('');
  out.push('**中文** | [English](README.md)');
  out.push('');
  out.push(meta.tagline);
  out.push('');
  out.push(`内置的本体是 dsh ${meta.coreVersion}（上游 tag \`${meta.coreTag}\`）。`);
  out.push('');
  out.push(meta.badges.map(([k, v]) => `\`${k}: ${v}\``).join(' · '));
  out.push('');
  out.push(`![仪表盘](${meta.shotDir}/01-launcher-dashboard.webp)`);
  out.push('');
  out.push('## 目录');
  out.push('');
  for (const s of sections) {
    out.push(`- [${s.title}](#${s.id})`);
  }
  out.push('');
  out.push('---');
  out.push('');
  sections.forEach((s, i) => {
    out.push(`<a id="${s.id}"></a>`);
    out.push('');
    out.push(`## ${s.title}`);
    out.push('');
    if (s.intro && s.intro.trim()) { out.push(s.intro.trim()); out.push(''); }
    for (const b of s.blocks) {
      if (b.type === 'md') { out.push(b.md.trim()); out.push(''); }
      else if (b.type === 'figure') { out.push(figureMd(b, meta)); }
      else if (b.type === 'diagram') { out.push(b.md.trim()); out.push(''); }
      else if (b.type === 'roster') { out.push(rosterMd(b)); }
    }
    if (i < sections.length - 1) { out.push('---'); out.push(''); }
  });
  return out.join('\n');
}
