// Section 00 — overview. Markdown strings are the single source for README.draft.zh.md and the showcase HTML.
export default {
  id: 'overview',
  num: '00',
  kicker: '',
  title: '这是什么',
  intro: `
[DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) 本身是一个命令行程序加一个简单的网页界面。这个仓库在它外面加了两样东西：

- 一个桌面启动器。双击 EXE 打开，13 个页面：启动和退出、插件和 Skill 市场、会话和存储、更新和自检、Tokens 统计、控制甲板、模型参数、凭据中心、记忆与上下文、皮肤、日志。
- 22 个插件，把功能直接放进 dsh 自己的页面里。设置里多出凭据中心、模型清单同步、联网搜索、多媒体 API、桌宠、用量与费用；对话里多出消息编辑、临时对话、拖文件、思考档位。

「本体」指内置在 \`core/\` 里的上游 deepseek-harness。
`,
  blocks: [
    { type: 'md', md: `
所有功能都是插件或独立程序，本体升级时不会丢。以前要改 \`settings.yaml\` 或敲 \`dsh plugin\` 命令的事，现在在页面上点几下就行，配置改完 1.5 秒内生效，不用重启。API Key 只存在 dsh 的凭据库里（装了钥匙串插件就存进 Windows 凭据管理器），不写进配置文件；所有面板只能从本机访问。22 个套件插件里 19 个是自己写的，3 个是在别人的开源项目上改的；另外原样用了 8 个社区插件，来源都列在「插件清单」一节。
`},
    { type: 'md', md: `
### 组成一览

| 组成 | 数量 | 说明 |
|---|---|---|
| DSH 启动器 | 13 个页面 · 中英双语 · 3 款皮肤 | \`launcher/\`，双击 \`DSH启动器.exe\`；本体约 1.5 秒启动 |
| 套件插件 | 22 个（原创 19 · 二改 3） | \`plugins/\`，安装时自动注册 |
| 社区插件 | 8 个 + 1 个 MCP 记忆服务器 | 在启动器插件市场里装，不进仓库 |
| 本体内置可选能力 | 10 个上游包 | 持久终端、定时提醒、LSP、MCP 客户端、Claude Code / Codex hook 桥 |
| 工程 Skill | 7 个（Claude Code） | 架构 / 插件 / 前端 / 运维 / 玩法 / 测试 / 本地模型 |
| dsh 内 Skill | 3 个 | 皮肤工坊、控制甲板编写、桌宠制作 |
| 皮肤 | 启动器 3 款 · 前端 2 款 · 社区皮肤按需转换 | 启动器「外观皮肤」页管理 |
`},
    { type: 'diagram', id: 'topology', md: `
\`\`\`mermaid
flowchart LR
  subgraph L["DSH 启动器 · 127.0.0.1:3090"]
    L1["仪表盘 / 插件 / Skill / 会话 / 存储 / 更新"]
    L2["Tokens / 控制甲板 / 模型参数 / 凭据 / 记忆 / 皮肤 / 日志"]
  end
  subgraph D["dsh 本体 · 127.0.0.1:3080 · 未改动"]
    D0["dsh 运行时 · 会话 · 工具 · Web UI"]
    D1["22 个套件插件"]
    D2["8 个社区插件 + 本体可选能力"]
  end
  L -- "启动 / 停止 / 安装 / 更新" --> D
  L -- "改配置，1.5 秒生效" --> D1
\`\`\`
`},
    { type: 'md', md: `
### 快速开始

前置：Windows 10/11、Git、Node.js \`^22.19 || >=24\`（推荐 24 LTS）、Edge 或 Chrome。

\`\`\`bat
git clone https://github.com/WZZNNE/DSH-CyberWorkStation.git
cd DSH-CyberWorkStation
setup.cmd
\`\`\`

\`setup.cmd\` 会安装依赖、构建本体（首次约 5–10 分钟）、注册全部套件插件和 Skill，然后打开启动器。之后每次使用双击 \`launcher/DSH启动器.exe\` 即可。API Key 在启动器「凭据中心」页或 dsh 设置 → 凭据中心 里填。
`},
  ],
};
