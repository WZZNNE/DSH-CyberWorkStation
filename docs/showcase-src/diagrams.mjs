// Hand-drawn SVG diagrams for the showcase page, plain-language labels. Classes: .dn (node), .de (edge), .dl (label).
const box = (x, y, w, h, title, sub, cls = '') => `
  <g class="dn ${cls}" transform="translate(${x} ${y})">
    <rect x="0" y="0" width="${w}" height="${h}" rx="4"/>
    <text class="dt" x="14" y="24">${title}</text>
    ${sub ? `<text class="ds" x="14" y="44">${sub}</text>` : ''}
  </g>`;
const edge = (d, label, lx, ly, cls = '') => `
  <path class="de ${cls}" d="${d}" marker-end="url(#arr)"/>
  ${label ? `<text class="dl" x="${lx}" y="${ly}">${label}</text>` : ''}`;

export const topology = `
<svg viewBox="0 0 780 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="启动器与本体的关系">
  <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>
  <g class="dg"><rect x="20" y="20" width="280" height="200" rx="4"/><text class="dgt" x="34" y="44">DSH 启动器 · 127.0.0.1:3090</text></g>
  ${box(36, 60, 248, 62, '13 个功能页', '仪表盘 · 插件 · Skill · 会话 · 存储 …', 'd1')}
  ${box(36, 140, 248, 62, '改配置', '控制甲板 · 搜索 · 记忆 · 皮肤，1.5 秒生效', 'd2')}
  <g class="dg"><rect x="400" y="20" width="360" height="430" rx="4"/><text class="dgt" x="414" y="44">dsh 本体 · 127.0.0.1:3080 · 零改动</text></g>
  ${box(420, 60, 320, 62, 'dsh 运行时', '会话 · 工具 · Web UI', 'd3')}
  ${box(420, 150, 320, 62, '22 个套件插件', '原创 19 · 二改 3', 'd4')}
  ${box(420, 240, 320, 62, '8 个社区插件 + 10 个内置可选包', '上下文 · 侧栏 · 远程 · 导入 · 终端 · LSP …', 'd5')}
  ${box(420, 330, 320, 62, '~/.dsh', '设置 · profile · 会话 · 凭据库', 'd6')}
  ${edge('M284 91 H420', '启动 / 停止 / 安装', 296, 82, 'e1')}
  ${edge('M284 171 H420', '热载', 336, 162, 'e2')}
  ${edge('M580 212 V240', '', 0, 0, 'e3')}
  ${edge('M580 302 V330', '', 0, 0, 'e4')}
</svg>`;

export const memoryFlow = `
<svg viewBox="0 0 1000 560" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="上下文与记忆的关系">
  <defs><marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>
  ${box(40, 40, 200, 62, '你的消息', '原话不会被改写', 'd1')}
  ${box(300, 40, 220, 62, '发给模型的请求', '附带各插件的注入', 'd2')}
  ${box(580, 40, 380, 84, '注入（各一条独立上下文）', '世界书 · 搜索结果 · 记忆召回 · 图片描述', 'd3')}
  ${box(300, 160, 220, 62, '会话历史', '只追加，不截断', 'd4')}
  ${box(40, 160, 200, 62, '自动压缩成摘要', '接近上限时触发', 'd5')}
  ${box(580, 280, 380, 84, '记忆库', '摘要（每会话最新）· 事实（每 8 轮）· 笔记', 'd6')}
  ${box(580, 420, 380, 62, '召回', '关键词匹配 · 可选向量 · 钉住优先', 'd7')}
  ${box(40, 300, 200, 84, '启动器：改当前摘要', '下一次请求起按你的文字继续', 'd8')}
  ${box(300, 300, 220, 84, '消息编辑：改 / 删', '两边同时生效，原文可追溯', 'd9')}
  ${edge('M240 71 H300', '', 0, 0, 'e1')}
  ${edge('M520 71 H580', '', 0, 0, 'e2')}
  ${edge('M410 102 V160', '', 0, 0, 'e3')}
  ${edge('M300 191 H240', '触发', 254, 182, 'e4')}
  ${edge('M140 160 C140 110 200 100 300 100', '摘要替换最旧历史', 60, 126, 'e5')}
  ${edge('M140 222 V260 H640 V280', '摘要自动存入', 330, 252, 'e6')}
  ${edge('M520 191 C560 191 560 300 580 300', '抽取事实', 522, 236, 'e7')}
  ${edge('M770 364 V420', '', 0, 0, 'e8')}
  ${edge('M770 482 C770 540 990 540 990 84 C990 60 980 60 960 60', '注入下一步', 800, 522, 'e9')}
  ${edge('M140 300 V222', '', 0, 0, 'e10')}
  ${edge('M410 300 V222', '', 0, 0, 'e11')}
  ${edge('M520 342 C560 342 560 322 580 322', '相关记忆失效', 522, 372, 'e12')}
</svg>`;

export default { topology, 'memory-flow': memoryFlow };
