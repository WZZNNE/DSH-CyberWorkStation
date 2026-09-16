// Section 06 — the full roster: plugins, programs, community adoptions, core opt-ins, with provenance.
export default {
  id: 'roster',
  num: '05',
  kicker: '',
  title: '全部插件清单：原创 / 二改 / 照搬',
  intro: `
原创指为本套件写的：用法可能参照了别的软件，但没有用它的代码，表里会注明参照了谁。二改指在别人的开源项目上改出来的，保留上游许可，并列出改了什么。照搬指原样使用的第三方项目。版本号是写作时实际安装的版本。
`,
  blocks: [
    { type: 'roster', groups: [
      { key: 'program', label: '程序', badge: '原创', desc: '独立程序，不是 dsh 插件。', items: [
        { name: 'DSH 启动器', ver: '13 页', origin: 'original', where: 'launcher/', role: '一键启动 / 退出、插件与 Skill 市场、会话与存储、更新与自检、Tokens 统计、控制甲板、模型参数、凭据中心、记忆与上下文、皮肤、日志；中英双语。交互体验致敬秋叶 aaaki 的 ComfyUI 整合包启动器（参照体验，无代码引用）。' },
      ]},
      { key: 'original', label: '套件插件 · 原创', badge: '原创', desc: '19 个。', items: [
        { name: 'dsh-control-deck', ver: '0.3.1', origin: 'original', role: '参照 SillyTavern 做的控制甲板：多条分级提示词、正则脚本、世界书、采样覆盖、工具开关、预设、ST JSON 导入导出。只参照用法，未引用其代码。', where: '启动器「控制甲板」' },
        { name: 'dsh-safe-guard', ver: '0.2.0', origin: 'original', role: '危险命令拦截 + 自定义拒绝 / 需确认 / 自动放行规则。', where: '控制甲板「安全规则」' },
        { name: 'dsh-credentials-keyring', ver: '0.1.0', origin: 'original', role: 'API Key 存进 Windows 凭据管理器。', where: '凭据中心「来源」列' },
        { name: 'dsh-skin-loader', ver: '0.1.0', origin: 'original', role: '给 dsh 网页套皮肤。', where: '启动器「外观皮肤」' },
        { name: 'dsh-price-hint', ver: '0.1.0', origin: 'original', role: '模型选择器悬停显示价格。', where: 'dsh 模型选择器' },
        { name: 'dsh-quick-workspace', ver: '0.1.0', origin: 'original', role: '输入路径新建工作区。', where: '启动器仪表盘' },
        { name: 'dsh-skin-studio-cws', ver: '0.1.0', origin: 'original', role: '在对话里让模型做皮肤（`skin_studio` 工具）。', where: '对话' },
        { name: 'dsh-local-reasoning', ver: '0.1.1', origin: 'original', role: '任意模型的上下文上限 / 最大输出 / 思考档位；本地模型自动探测并写入档位；OpenRouter `:online` 变体。', where: '启动器「模型参数」' },
        { name: 'dsh-web-search-plus', ver: '0.5.0', origin: 'original', role: '联网搜索四种方式、六种来源、`web_fetch` 网页读取、自动打开正文。触发词用法对齐 SillyTavern 的 WebSearch 扩展，未引用其代码。', where: 'dsh 设置「联网搜索（全局）」、控制甲板' },
        { name: 'dsh-memory-lite', ver: '0.1.0', origin: 'original', role: '可编辑的压缩摘要、立即压缩；长期记忆（摘要 / 事实 / 笔记）自动注入与 `memory_recall` / `memory_note` 工具。', where: '启动器「记忆与上下文」' },
        { name: 'dsh-chat-editor', ver: '0.1.0', origin: 'original', role: '改 / 删 / 折叠任意消息，从任意轮次分叉。', where: '会话头 ✎' },
        { name: 'dsh-temp-chat-cws', ver: '0.1.1', origin: 'original', role: '不属于任何项目的临时对话。', where: '侧栏按钮' },
        { name: 'dsh-media-lab', ver: '0.1.1', origin: 'original', role: '生图 / 生视频 / 语音合成 / 语音识别，九种供应商 + 自定义接口，结果在对话里播放。', where: 'dsh 设置「多媒体 API」' },
        { name: 'dsh-desktop-pet-cws', ver: '0.2.2', origin: 'original', role: '桌宠：人格、设定集、独立 API、主动搭话、提醒、语音、序列帧动画、看屏 / 操作电脑权限、三种窗口。', where: 'dsh 设置「桌宠」、侧栏' },
        { name: 'dsh-lan-fence', ver: '0.1.0', origin: 'original', role: '手机远程时封住未配对设备的 `/api`。', where: '（无面板）' },
        { name: 'dsh-provider-sync', ver: '0.2.0', origin: 'original', role: 'OpenRouter 模型清单自动同步，可推理模型写好思考档位。', where: 'dsh 设置「模型清单同步」' },
        { name: 'dsh-drop-files', ver: '0.1.1', origin: 'original', role: '把任意文件拖进对话。', where: '对话拖放' },
        { name: 'dsh-credentials-center', ver: '0.3.0', origin: 'original', role: '一页管全部 API 密钥：绑定关系、别名、备用密钥、默认模型。', where: '启动器「凭据中心」+ dsh 设置' },
        { name: 'dsh-import-note', ver: '0.1.0', origin: 'original', role: '一张说明卡：会话导入不会覆盖系统提示词。', where: 'dsh 设置 → 插件' },
      ]},
      { key: 'fork', label: '套件插件 · 二改', badge: '二改', desc: '3 个，均基于 MIT 项目，保留上游许可。', items: [
        { name: 'dsh-cost-meter-plus', ver: '1.5.19-plus.4', origin: 'fork', upstream: 'Han-1413141/dsh-cost-meter 1.5.19 · MIT', role: '上游：会话 / 当日 / 历史费用、官方价格同步、90+ 模型价格目录、7 家 Coding Plan 额度、预算提醒、中英双语。这里加的：多厂商余额、OpenRouter 价格自动同步、缓存命中条、会话行 token 拆分、本地路由免费、设置页把余额和费用放在最上面。', where: 'dsh 设置「用量与费用」、侧栏' },
        { name: 'dsh-token-usage-plus', ver: '2.1.0-plus.1', origin: 'fork', upstream: 'Tastelessor/dsh-usage-stats 2.1.0 · MIT', role: '上游：用量统计卡 + 热力图 + 官方峰谷价换算。这里加的：去掉峰谷价显示、从费用账本补 OpenRouter 价格。默认不挂载，费用页已经覆盖它的功能；留给想单独看用量页的人。', where: '（默认不挂载）' },
        { name: 'dsh-vision-bridge-zh', ver: '0.4.5-zh.2', origin: 'fork', upstream: '@goodandready/dsh-vision-bridge 0.4.5 · MIT', role: '上游：让纯文本模型「看图」（自动改写 + 26 个视觉工具：描述、OCR、定位、裁剪、长截图、PDF、视频等）。这里加的：中文界面，多图比较和目录处理更可靠。', where: 'dsh 设置 → 插件「图片理解」' },
      ]},
      { key: 'adopted', label: '社区插件 · 照搬', badge: '照搬', desc: '8 个 + 1 个 MCP 服务器，在启动器插件市场里装，原样使用。另有两个 npm 上能看到的插件不建议与当前本体搭配：`dsh-auto-approval`（与当前本体不兼容）、`dsh-filesnap`（卸载后录过的会话打不开）。', items: [
        { name: 'dsh-context', ver: '0.52.2', origin: 'adopted', upstream: 'bowenliang123 · Apache-2.0', role: '上下文仪表盘（构成、趋势、事件、浏览器、文件活动）与 `/context` 命令。需要 0.40 以上。', where: '会话「上下文」分页' },
        { name: 'dsh-better-sidebar', ver: '0.19.1', origin: 'adopted', upstream: 'omdsh-dev · MIT', role: 'VS Code 式右侧工作台：文件 / 编辑器 / 终端 / Git / 浏览器 / 后台任务。', where: 'dsh 设置「侧边卡片」、右侧面板' },
        { name: '@linxin666/dsh-remote-web-ui', ver: '0.3.22', origin: 'adopted', upstream: 'zhu1090093659/dsh-web · Apache-2.0', role: '手机 / 电脑扫码配对远程使用同一份 Web GUI，一次性令牌、可吊销设备、可选 Cloudflare 隧道。', where: '侧栏手机图标' },
        { name: 'dsh-automation', ver: '0.2.0-alpha.0', origin: 'adopted', upstream: 'Ephemeral-AI-Lab · MIT', role: '会话内定时 / 循环自提示。需要 Node ≥ 24（Node 22 下请用它的 0.1.4）。', where: '对话' },
        { name: 'dsh-chat-import', ver: '0.11.5', origin: 'adopted', upstream: 'Nwflower · MIT', role: '导入 Claude Code / Codex / ChatGPT / Cursor / Gemini 等 19 种 agent 的会话；双向同步。', where: '侧栏「导入会话」、dsh 设置「会话导入」' },
        { name: 'dsh-voice-input-web', ver: '0.1.2', origin: 'adopted', upstream: 'CrazyGummies · MIT', role: '输入框麦克风，浏览器语音识别，不需要密钥。', where: '输入框' },
        { name: 'dsh-notification', ver: '0.1.1', origin: 'adopted', upstream: 'nishit130 · MIT', role: 'agent 完成 / 出错 / 等待审批时的桌面与 webhook 通知。', where: '（后台）' },
        { name: '@syncended/dsh-retry', ver: '0.2.3', origin: 'adopted', upstream: 'syncended · MIT', role: '模型临时错误自动重试，中断会话恢复。', where: '（后台）' },
        { name: '@modelcontextprotocol/server-memory', ver: '2026.7.4', origin: 'adopted', upstream: 'Model Context Protocol 项目 · MIT', role: 'MCP 知识图谱记忆服务器，经本体 MCP 客户端挂载。', where: '模型工具' },
      ]},
      { key: 'core', label: '本体与内置可选能力 · 照搬', badge: '上游', desc: 'deepseek-harness 官方代码，未改动。', items: [
        { name: 'deepseek-harness（core/）', ver: '0.1.5-rc.2', origin: 'core', upstream: 'deepseek-ai · MIT', role: '全量内置的上游源码，没有改过；启动器可升级到任意上游版本。自带 12 个开发规程 Skill。', where: 'core/' },
        { name: 'dsh-terminal / -bash / tool-terminal', ver: '0.1.5-rc.2', origin: 'core', upstream: 'in-tree', role: '持久终端与六个模型工具。', where: 'profile 补丁' },
        { name: 'dsh-schedule', ver: '0.1.5-rc.2', origin: 'core', upstream: 'in-tree', role: '定时提醒。', where: 'profile 补丁' },
        { name: 'dsh-lsp / lsp-stdio / tool-lsp', ver: '0.1.5-rc.2', origin: 'core', upstream: 'in-tree', role: 'LSP 代码智能（TypeScript）。', where: 'profile 补丁' },
        { name: 'dsh-mcp-client', ver: '0.1.5-rc.2', origin: 'core', upstream: 'in-tree', role: 'MCP 客户端。', where: 'profile 补丁' },
        { name: 'dsh-hooks-claude-code / -codex', ver: '0.1.5-rc.2', origin: 'core', upstream: 'in-tree', role: 'Claude Code / Codex hooks 桥。', where: 'profile 补丁' },
      ]},
    ]},
    { type: 'md', md: `
### 统计

| 类别 | 数量 |
|---|---|
| 原创程序 | 1（DSH 启动器） |
| 原创插件 | 19 |
| 二改插件 | 3（cost-meter-plus、token-usage-plus、vision-bridge-zh） |
| 照搬的社区插件 | 8 + 1 个 MCP 服务器 |
| 照搬的本体内置可选包 | 10 |
| 原创 Skill | 7 工程 + 3 dsh 内 |
| 本体自带 Skill | 12（照搬） |
| 原创皮肤 | 启动器 3 · 前端 2 |
| 本体代码改动 | 0 行 |
`},
  ],
};
