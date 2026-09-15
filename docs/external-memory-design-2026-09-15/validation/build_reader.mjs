import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deps = createRequire('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');
const { marked } = await import(pathToFileURL(deps.resolve('marked')).href);
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, '');
const projects = JSON.parse(read('research/projects.json'));
const paperIndex = JSON.parse(read('research/papers.json'));
const papers = paperIndex.papers;
const results = JSON.parse(read('validation/results.json'));
const api = JSON.parse(read('spec/openapi.json'));
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const overview = `# 外部项目记忆服务调研与设计总览

调研截止 2026 年 9 月 15 日。面向本地多 agent 工作站，后续扩展云端。

## 推荐方案

采用独立的项目记忆服务：SQL 管理有效记录、时间、版本和来源；全文与向量用于背景召回；适用约束确定性加载；宿主适配器绑定真实身份；统一写入接口处理人工编辑、撤销、索引更新和任务恢复。

先验证 ReMe、EverOS、LongMemory、MemOS 与现有 DSH memory-lite 的适用能力。满足要求时优先适配；缺少关键生命周期契约时再实现对应模块。不同对象可以有不同来源系统，但同一对象只能有一个权威写入点。

## 这次实际完成了什么

- ${projects.length} 条相关项目记录，包含核心记忆、框架、存储、基准、历史项目与同名辨析；不能理解为 ${projects.length} 个都已安装验证的产品。
- ${papers.length} 项论文与预印本记录，含一项综述；其中 ${paperIndex.counts.focused_full_text} 项核对关键正文，${paperIndex.counts.abstract_and_metadata} 项核对摘要与元数据。
- 产品架构、数据协议、使用与运维说明、创新评测方案、实施路线与决策记录，以及当前 DSH 的源码接入审查。
- ${Object.keys(api.paths).length} 个路径的 OpenAPI 草案、${Object.keys(api.components.schemas).length} 个数据结构、SQLite 核心骨架和输入样例。
- ${results.tests_run} 项有限参考模型检查通过，覆盖时间、版本、撤销、部分双连接交错和进程退出恢复。完整范围见验证报告。

## 三个判断

**可行性：** 核心依赖采用成熟存储和服务机制；参考模型验证了部分确定性规则。自然语言理解、完整集成、性能与模型收益仍需实施和实验。

**易用性：** 用户直接看“记住了什么、在哪里适用、什么时候生效、来自哪里”，通过普通编辑和撤销操作控制记忆。隐藏向量、ID 和版本等内部细节，保留高级审计入口。

**创新性：** 原构想的大部分机制已有直接先例，不能保证首次或论文新颖性。建议把新增贡献收窄为条件证据完整性、约束变更至动作接受的联合证据，以及本地中文多 agent 场景的可复现增量；每项都设对照和停止条件。

## 阅读顺序

| 你想了解什么 | 文档 |
|---|---|
| 整体怎么工作、为什么这样设计 | [产品与架构设计](01-产品与架构设计.md) |
| 数据字段、接口、时间与并发语义 | [数据与接口协议](02-数据与接口协议.md) |
| 用户如何使用、出故障如何恢复 | [使用与运维说明](03-使用与运维说明.md) |
| 哪些不是新发明、怎样验证真实增量 | [创新定位与评测方案](04-创新定位与评测方案.md) |
| 先做什么、复用什么、怎样迁移 | [实施路线与决策记录](05-实施路线与决策记录.md) |
| 有哪些相关开源项目 | [项目全景与选型](research/projects.md) |
| 有哪些相关论文和预印本 | [论文全景](research/papers.md) |
| 当前工作站已经有了哪些能力 | [DSH 接入审查](research/local-integration.md) |
| 调研有多深、标准从哪里来 | [方法与技术来源](research/方法与技术来源.md) |
| 实际测试了什么、如何重跑 | [参考验证说明](validation/README.md) |

## 直接使用的文件

- [离线阅读总册](index.html)：无需联网加载页面，可按章节阅读并搜索全文；外部来源链接仍需网络访问。
- [OpenAPI 草案](spec/openapi.json)、[SQL 核心骨架](spec/schema.sql)、[输入样例](spec/examples.json)。
- [项目机器索引](research/projects.json)、[论文机器索引](research/papers.json)、[参考验证结果](validation/results.json)。

## 最重要的边界

本次交付为设计包与有限参考验证，没有安装完整记忆服务、迁移真实记忆、修改工作站已有应用代码、运行所有候选项目或复现论文成绩。它也不是穷尽式全球检索或原创性保证。

已经撤销的内容要从索引、缓存、派生摘要和运行中上下文处理失效；无法通过删除数据库撤回已经发生的外部动作。机器强制规则只在真实接入并验证的动作入口生效，风格等自然语言要求仍需模型与结果检查。
`;

fs.writeFileSync(path.join(root, 'README.md'), overview, 'utf8');
const validation = `# 参考模型验证说明

## 实际结果

本次有限参考模型 ${results.tests_run} 项检查通过，失败 ${results.failures}，错误 ${results.errors}。环境为 Python ${results.python}、SQLite ${results.sqlite}。机器可读记录见 [results.json](results.json)。

这些检查验证结构化命令和 SQLite 状态，不评估模型意图识别或检索质量。测试包含特定双连接交错及子进程在提交前/提交后直接退出；不包含断电测试、生产负载测试或所有可能的并发调度。

## 已验证的子集

新建和当前读取、双时间查询、明确 CORRECT 回溯、未来开始和区间边界、撤销不生成相反命令、重复撤销不复活、取消未来规则、作用域和租户隔离、只读身份与模型自报约束限制、幂等键冲突、旧版本写入拒绝、outbox 同事务回滚、延迟索引与删除、策略和 ACL epoch、未来时间边界、任务 fence 以及接管保留检查点。

参考模型只处理单一作用域，不实现完整继承/例外解析；只接受显式结构化命令。CORRECT 是明确纠错，未来替换 REPLACE 尚未实现，不可借该结果宣称未来替换的完整产品行为已测试。

## 运行方式

在本目录运行 Python 3 的标准库脚本，不需要安装大模型或第三方数据库服务：

\
~~~powershell
python test_reference.py
~~~

当前工作站可使用已配置的 bundled Python 完整路径运行相同脚本。测试只在临时目录建库，不读取或改写真实用户记忆。生成的结果会更新本目录 results.json。

契约文件可以通过以下脚本重新生成：

~~~powershell
python build_contracts.py
~~~

契约检查包括 JSON 生成、内部引用和样例基本字段；不是完整 OpenAPI 合规验证。接口文件没有启动 HTTP/MCP 服务。

## 尚未验证

${results.not_validated.map(x => '- ' + x).join('\n')}

完整验收方法见 [创新与评测](../04-创新定位与评测方案.md)，真实接入步骤见 [实施路线](../05-实施路线与决策记录.md)。
`;
fs.writeFileSync(path.join(root, 'validation/README.md'), validation, 'utf8');

const arrow = '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#45616b"/></marker></defs>';
const box = (x,y,w,h,title,sub='') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="#f1f7f6" stroke="#5d8e88"/><text x="${x+w/2}" y="${y+28}" text-anchor="middle" font-size="18" font-weight="600">${esc(title)}</text>${sub ? `<text x="${x+w/2}" y="${y+51}" text-anchor="middle" font-size="13" fill="#53616a">${esc(sub)}</text>` : ''}`;
const line = d => `<path d="${d}" fill="none" stroke="#45616b" stroke-width="1.8" marker-end="url(#arrow)"/>`;
const architectureSvg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="项目记忆服务架构图" viewBox="0 0 980 675" style="font-family:Segoe UI,Microsoft YaHei,sans-serif;fill:#172b32">${arrow}
${box(310,20,360,64,'用户消息 人工编辑 工具结果','保留可验证来源')}
${line('M490,84 L490,116')}${box(310,120,360,64,'可信宿主适配器','绑定身份 项目和任务')}
${line('M490,184 L490,221')}${box(310,225,360,72,'SQL 原始事件与有效记忆','先保存事件 再提交经提取和校验的记忆')}
${line('M310,261 L170,261 L170,345')}${line('M670,261 L810,261 L810,345')}
${box(40,350,260,72,'适用约束','确定性查询 条件与例外')}${box(680,350,260,72,'相关背景','全文 向量 增量与证据')}
${line('M170,422 L170,496 L301,496')}${line('M810,422 L810,496 L679,496')}
${box(310,460,360,72,'本次任务上下文','当前目标 必需规则 背景与版本收据')}
${line('M490,532 L490,574')}${box(310,580,360,64,'主 agent 子 agent 与动作入口','执行前复核版本 时间 授权和租约')}
</svg>`;
const sequenceSvg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="撤销规则与旧动作拒绝时序图" viewBox="0 0 980 570" style="font-family:Segoe UI,Microsoft YaHei,sans-serif;fill:#172b32">${arrow}
${[130,370,620,850].map((x,i)=>`<rect x="${x-65}" y="20" width="130" height="42" rx="8" fill="#f1f7f6" stroke="#5d8e88"/><text x="${x}" y="47" text-anchor="middle" font-size="16">${['用户','记忆服务','Agent','动作网关'][i]}</text><path d="M${x},62 L${x},550" stroke="#bdc9cd" stroke-dasharray="4 5"/>`).join('')}
${line('M130,120 L362,120')}<text x="165" y="108" font-size="14">撤销规则</text>
<rect x="318" y="156" width="104" height="45" fill="#e2eeeb"/><text x="370" y="175" text-anchor="middle" font-size="12">提交新版本</text><text x="370" y="191" text-anchor="middle" font-size="12">策略 epoch 增加</text>
${line('M370,245 L138,245')}<text x="170" y="233" font-size="14">确认停止适用</text>
${line('M370,310 L612,310')}<text x="420" y="298" font-size="14">通知上下文过时</text>
${line('M620,380 L842,380')}<text x="650" y="368" font-size="14">携旧收据申请动作</text>
${line('M850,445 L378,445')}<text x="480" y="433" font-size="14">同步检查当前规则与授权</text>
${line('M370,510 L842,510')}<text x="475" y="498" font-size="14">拒绝旧收据 要求刷新</text>
</svg>`;
fs.mkdirSync(path.join(root, 'assets'), {recursive: true});
fs.writeFileSync(path.join(root, 'assets/architecture.svg'), architectureSvg);
fs.writeFileSync(path.join(root, 'assets/revocation.svg'), sequenceSvg);

const docs = [
 ['overview','总览','README.md'],['architecture','产品与架构','01-产品与架构设计.md'],
 ['protocol','数据与协议','02-数据与接口协议.md'],['manual','使用与运维','03-使用与运维说明.md'],
 ['evaluation','创新与评测','04-创新定位与评测方案.md'],['roadmap','实施路线','05-实施路线与决策记录.md'],
 ['projects','开源项目','research/projects.md'],['papers','论文与预印本','research/papers.md'],
 ['integration','DSH 接入','research/local-integration.md'],['method','方法与来源','research/方法与技术来源.md'],
 ['validation','参考验证','validation/README.md']
];
const fileMap = new Map(docs.map(([id,,file])=>[file,id]));
marked.use({renderer:{html(token){return esc(typeof token === 'string' ? token : token.text);}}});
const chunks = docs.map(([id,title,file])=>{
 let html = marked.parse(read(file), {gfm:true});
 let n=0;
 html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g,(_,level,text)=>`<h${level} id="${id}-h${n++}">${text}</h${level}>`);
 html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,(_,code)=>{
   let fig=code.includes('sequenceDiagram') ? sequenceSvg : (id==='architecture' ? architectureSvg : '');
   if(fig){const markerId='arrow-'+id+'-'+n++;fig=fig.replaceAll('id="arrow"',`id="${markerId}"`).replaceAll('url(#arrow)',`url(#${markerId})`);}
   return `${fig ? `<figure class="diagram">${fig}</figure>` : ''}<details class="diagram-source"><summary>查看 Mermaid 图示源文</summary><pre><code>${code}</code></pre></details>`;
 });
 html = html.replace(/href="([^"]+)"/g,(full,url)=>{
   if (/^(https?:|mailto:|#)/.test(url)) return full;
   let decoded;
   try {decoded=decodeURIComponent(url.replaceAll('&amp;','&'));} catch{return full;}
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),decoded.split('#')[0]));
   if(fileMap.has(target)) return `href="#${fileMap.get(target)}"`;
   if(!/^[A-Za-z]:/.test(decoded)) return `href="${esc(target)}"`;
   return full;
 });
 html=html.replace(/<table>/g,'<div class="table-wrap"><table>').replace(/<\/table>/g,'</table></div>');
 return `<section class="doc" data-id="${id}" data-title="${esc(title)}" ${id==='overview'?'':'hidden'}>${html}</section>`;
});

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>项目记忆服务 调研与设计说明书</title>
<style>
:root{--ink:#172b32;--muted:#617079;--accent:#246e65;--border:#dce5e4;--paper:#fff;--wash:#f6f8f7}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Segoe UI,Microsoft YaHei,PingFang SC,sans-serif;color:var(--ink);background:var(--paper);font-size:15px;line-height:1.8}a{color:var(--accent);text-underline-offset:3px}button,input{font:inherit}header{padding:32px 44px 24px;border-bottom:1px solid var(--border);background:var(--wash)}.eyebrow{letter-spacing:2px;color:var(--accent);font-size:12px;font-weight:650}.masthead{font-size:29px;font-weight:650;margin:6px 0}.lead{color:var(--muted);margin:0;max-width:850px}.metrics{display:flex;gap:30px;margin-top:17px;font-size:13px;color:var(--muted)}.metrics strong{font-size:21px;color:var(--ink);margin-right:6px}.layout{display:grid;grid-template-columns:230px minmax(0,1fr);max-width:1540px;margin:auto}aside{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--border);padding:26px 18px 40px}.search{width:100%;border:1px solid #bacac7;border-radius:6px;padding:9px 11px;font-size:13px;background:#fff}.search:focus{outline:2px solid #a4cec5}.nav{display:grid;gap:3px;margin-top:18px}.nav button{border:0;background:transparent;text-align:left;padding:9px 12px;border-radius:5px;color:#43545d;cursor:pointer;font-size:14px}.nav button:hover{background:var(--wash)}.nav button[aria-current=page]{background:#e8f2ee;color:#145c52;font-weight:650}.side-note{font-size:12px;line-height:1.7;color:var(--muted);margin:22px 10px}.side-note a{display:block;margin-top:8px}main{min-width:0;padding:34px 54px 90px;max-width:1140px}.doc[hidden]{display:none}.doc h1{font-size:28px;line-height:1.4;margin:0 0 23px;letter-spacing:.2px}.doc h2{font-size:22px;line-height:1.45;margin:36px 0 15px;padding-top:4px}.doc h3{font-size:18px;margin:26px 0 10px}.doc h4{font-size:16px;margin:24px 0 8px}.doc p{margin:12px 0}.doc li{margin:6px 0}.doc ul,.doc ol{padding-left:23px}.doc strong{font-weight:650}code{font-family:Consolas,Cascadia Code,monospace;font-size:.9em;background:#f1f4f3;padding:1px 4px;border-radius:3px;overflow-wrap:anywhere}pre{background:#f5f7f7;border:1px solid var(--border);border-radius:7px;padding:18px;overflow:auto;font-size:13px;line-height:1.65}pre code{padding:0;background:transparent;overflow-wrap:normal}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.65}th,td{border:1px solid var(--border);padding:11px 12px;vertical-align:top;text-align:left}th{background:#eef3f1;font-weight:650}tr:nth-child(even) td{background:#fbfcfb}.table-wrap{overflow:auto;margin:18px 0 25px}td a{overflow-wrap:anywhere}blockquote{margin:18px 0;padding-left:18px;border-left:3px solid #bdcfc9;color:#455960}.diagram{margin:25px 0;padding:14px 8px;border:1px solid var(--border);border-radius:8px;background:#fff}.diagram svg{display:block;width:100%;height:auto}.diagram-source{font-size:13px;color:var(--muted);margin:15px 0}.diagram-source summary{cursor:pointer}.search-results{margin:0 0 28px;border-bottom:1px solid var(--border);padding-bottom:18px}.result{display:block;text-align:left;width:100%;background:#fff;border:1px solid var(--border);border-radius:6px;padding:12px;margin:8px 0;cursor:pointer}.result strong{display:block;color:var(--accent);font-size:14px}.result small{display:block;color:var(--muted);font-size:12px;line-height:1.6}.toolbar{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:12px;margin-bottom:23px}.toolbar button{border:1px solid var(--border);border-radius:5px;background:#fff;padding:4px 10px;font-size:12px;cursor:pointer}.search-state{font-size:13px;color:var(--muted)}footer{padding:20px 44px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
@media(max-width:880px){header{padding:22px}.layout{grid-template-columns:1fr}aside{height:auto;position:relative;border-right:0;border-bottom:1px solid var(--border);padding:16px 20px}.nav{display:flex;flex-wrap:wrap;margin-top:10px;gap:2px}.nav button{padding:6px 9px;font-size:12px}.side-note{display:none}main{padding:25px 22px 60px}.metrics{gap:18px;flex-wrap:wrap}.doc h1{font-size:24px}.doc h2{font-size:20px}.table-wrap{font-size:12px}table{min-width:580px}.masthead{font-size:25px}}
@media print{header,aside,footer,.toolbar,.search-results,.diagram-source{display:none!important}.layout{display:block}main{max-width:none;padding:0}.doc,.doc[hidden]{display:block!important;break-before:page}.doc:first-child{break-before:auto}h1,h2,h3,h4{break-after:avoid}tr,figure{break-inside:avoid}thead{display:table-header-group}a{color:inherit;text-decoration:none}body{font-size:10pt;line-height:1.5}pre{white-space:pre-wrap}table{font-size:8pt}.table-wrap{overflow:visible}}
</style></head><body><header><div class="eyebrow">RESEARCH & SYSTEM DESIGN · 2026 09 15</div><div class="masthead">项目记忆服务</div><p class="lead">本地多 agent 工作站的外部记忆设计。涵盖已有研究、架构、操作说明、接入路径与验证边界。</p><div class="metrics"><span><strong>${projects.length}</strong>项目记录</span><span><strong>${papers.length}</strong>论文与预印本</span><span><strong>${results.tests_run}</strong>参考检查通过</span></div></header>
<div class="layout"><aside><label for="search" class="eyebrow">全文搜索</label><input id="search" class="search" placeholder="例如 撤销、ReMe、时间戳" autocomplete="off"><nav class="nav" aria-label="文档章节">${docs.map(([id,title])=>`<button data-go="${id}" ${id==='overview'?'aria-current="page"':''}>${esc(title)}</button>`).join('')}</nav><div class="side-note">资料级核对与参考验证均有明确范围。设计目标不等于已实现能力。<a href="README.md">查看 Markdown 总览</a><a href="spec/openapi.json">查看接口草案</a><a href="spec/schema.sql">查看数据库骨架</a></div></aside><main><div class="toolbar"><span id="current-title">总览</span><button id="print">打印全部文档</button></div><div id="results" class="search-results" hidden></div>${chunks.join('\n')}</main></div><footer>离线页面无需加载外部脚本或字体。外部论文、仓库与文档链接需网络访问。交付为设计与有限参考验证。</footer>
<script>
const sections=[...document.querySelectorAll('.doc')];const navigation=[...document.querySelectorAll('[data-go]')];
function show(id,scroll=true){const found=sections.find(s=>s.dataset.id===id)||sections[0];for(const s of sections)s.hidden=s!==found;for(const b of navigation){if(b.dataset.go===found.dataset.id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}document.querySelector('#current-title').textContent=found.dataset.title;document.title=found.dataset.title+' · 项目记忆服务';if(scroll)window.scrollTo({top:0,behavior:'instant'});return found;}
function navigate(){const hash=decodeURIComponent(location.hash.slice(1));const doc=sections.find(s=>s.dataset.id===hash);if(doc){show(hash);return}const target=document.getElementById(hash);if(target){const parent=target.closest('.doc');if(parent){show(parent.dataset.id,false);target.scrollIntoView({block:'start'});return}}show('overview');}
for(const b of navigation)b.addEventListener('click',()=>{location.hash=b.dataset.go;show(b.dataset.go)});window.addEventListener('hashchange',navigate);if(location.hash)navigate();
const entries=[];for(const section of sections){for(const heading of section.querySelectorAll('h1,h2,h3,h4')){let parts=[heading.textContent];let e=heading.nextElementSibling;while(e&&!/^H[1-4]$/.test(e.tagName)){parts.push(e.textContent);e=e.nextElementSibling}entries.push({doc:section.dataset.title,id:heading.id,title:heading.textContent,text:parts.join(' ').replace(/\\s+/g,' ')})}}
document.querySelector('#search').addEventListener('input',event=>{const q=event.target.value.trim().toLocaleLowerCase();const host=document.querySelector('#results');host.replaceChildren();host.hidden=!q;if(!q)return;const matches=entries.filter(x=>x.text.toLocaleLowerCase().includes(q));const count=document.createElement('p');count.className='search-state';count.textContent=matches.length+' 个匹配章节'+(matches.length>30?'，显示前 30 个':'');host.append(count);for(const hit of matches.slice(0,30)){const button=document.createElement('button');button.className='result';const title=document.createElement('strong');title.textContent=hit.doc+' · '+hit.title;const snippet=document.createElement('small');const pos=hit.text.toLocaleLowerCase().indexOf(q);snippet.textContent=hit.text.slice(Math.max(0,pos-30),pos+160);button.append(title,snippet);button.addEventListener('click',()=>{location.hash=hit.id;navigate()});host.append(button)}});
document.querySelector('#print').addEventListener('click',()=>window.print());
</script></body></html>`;
fs.writeFileSync(path.join(root, 'index.html'), html, 'utf8');
console.log(JSON.stringify({projects:projects.length,papers:papers.length,tests:results.tests_run,chapters:docs.length,html_bytes:Buffer.byteLength(html)}));
