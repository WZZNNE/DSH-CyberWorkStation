// Section 00 — overview. Markdown strings are the single source for README.zh.md and the showcase HTML.
export default {
  id: 'overview',
  num: '00',
  kicker: '',
  title: '这是什么',
  intro: `
dsh 装好之后是一个命令行 agent，带一个能用但很朴素的网页界面。围绕它的一切，从选模型到装插件，都要在终端里敲命令或者改 \`settings.yaml\`。这个仓库在本体外面包了两层，让整套流程都在屏幕上完成。

第一层是 DSH 启动器，一个独立的小程序。双击打开是一个 13 页的窗口，覆盖 dsh 从装好到日常使用会遇到的事：启动和停止本体、安装插件和 Skill、查看会话和存储、更新和自检环境、看 Tokens 统计、编辑控制甲板、调模型参数、管理凭据、编辑记忆与上下文、切换皮肤、看日志。

第二层是 22 个插件，它们直接住在 dsh 自己的页面里：设置里多出凭据中心、模型清单同步、联网搜索、多媒体 API、桌宠和用量与费用；对话里多出消息编辑、临时对话、拖文件和思考档位。这些面板都嵌在本体原有的位置：设置弹窗里多一个分区，侧栏里多一个图标，会话头多一个按钮，没有一处是浮在界面之上的补丁。22 个里 19 个是为本套件写的，3 个是在别人 MIT 项目上改出来的；另外还原样用了 8 个社区插件，文末的清单逐个列出了来源。

本文里说的「本体」，指的是原样放在 \`core/\` 里的上游 deepseek-harness。它按发布的样子直接使用，所以更新页才能把它整体换成任意一个上游版本。
`,
  blocks: [
    { type: 'md', md: `
有几个特性决定了这套东西用起来的感觉。所有功能都是插件或独立程序，升级本体不会丢掉任何一项。在启动器页面或 dsh 设置里改的配置，大约 1.5 秒内生效，没有「重启一下」这一步。API Key 只进 dsh 的凭据库，装了钥匙串插件就进 Windows 凭据管理器，不会出现在任何配置文件里。启动器和 dsh 都只监听本机。
`},
    { type: 'md', md: `
### 组成一览

| 组成 | 数量 | 说明 |
|---|---|---|
| DSH 启动器 | 13 个页面 · 中英双语 · 3 款皮肤 | \`launcher/\`，双击 \`DSH启动器.exe\`；本体约 5 秒启动 |
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
### 快速开始（零基础版）

**需要什么**：Windows 10 / 11，Edge 或 Chrome 浏览器，一个 API Key（OpenRouter 或 DeepSeek 官方，二选一）。走 API 的话普通电脑就够，不需要显卡；只有在本机跑模型才需要显卡。

**第一步：装两个免费软件**

1. **Git**：打开 https://git-scm.com/download/win ，点「64-bit Git for Windows Setup」下载，安装时一路「Next」用默认选项即可。安装脚本会检查它，启动器的一键更新也靠它。
2. **Node.js**：打开 https://nodejs.org ，下载标着 **LTS** 的那个（24.x；22.19 以上也可以，不要装 23.x），同样一路「Next」。

装完后**重新打开**一个终端验证（旧窗口读不到刚装好的程序）：按 Win + R，输入 \`cmd\`，回车，然后逐行输入：

\`\`\`bat
git --version
node -v
\`\`\`

两行都打印出版本号（例如 \`git version 2.51.0\`、\`v24.19.0\`）就可以继续；提示「不是内部或外部命令」说明没装好，或者没有重开窗口。

**第二步：把项目下载到电脑上**

还是在这个终端里，逐行输入、每行回车（\`D:\` 换成你想放的盘，文件夹名随意）：

\`\`\`bat
D:
mkdir AI
cd AI
git clone https://github.com/WZZNNE/DSH-CyberWorkStation.git
cd DSH-CyberWorkStation
\`\`\`

\`git clone\` 会把整个项目下载到 \`D:\\AI\\DSH-CyberWorkStation\`，网络慢时等它跑完再输下一行。

不想用 git 也行：在 GitHub 页面点绿色的「Code」→「Download ZIP」，解压到 \`D:\\AI\`，然后在终端里输入 \`cd /d D:\\AI\\DSH-CyberWorkStation-main\`。Git 仍然需要安装（安装脚本会检查），区别只是 ZIP 方式不能用「更新推送」页的一键更新，想升级得重新下载 ZIP 覆盖。

**第三步：一键安装**

\`\`\`bat
setup.cmd
\`\`\`

它会依次：检查 Git 和 Node 版本 → 安装依赖 → 构建本体（首次 5–10 分钟，屏幕上大段滚动是正常的）→ 注册全部插件和 Skill → 自动打开启动器窗口。中途报错时看最后几行：提示 Node 版本不对就去装 LTS 版；网络超时就再运行一次 \`setup.cmd\`，它会接着做，不会重复安装。

**第四步：填 Key，启动**

1. 启动器左栏点「凭据中心」，在 \`OPENROUTER_API_KEY\` 或 \`DEEPSEEK_API_KEY\` 那一行点「设置 / 替换」，粘贴你的 Key（申请地址：https://openrouter.ai/keys 或 https://platform.deepseek.com ）。Key 只存在 dsh 的凭据库里，不写进任何配置文件。
2. 同一页下方「dsh 默认模型」：先选路由（\`openrouter\` 或 \`deepseek-official\`），再选模型，点「设为 dsh 默认」。
3. 回到「仪表盘」，点「一键启动」；状态变成 RUNNING 后点「打开 WEB UI」，就可以开始对话了。

**以后每次用**：双击 \`launcher\\DSH启动器.exe\`。这个 exe 只是一个引导壳，源码就在仓库的 \`launcher/launcher-shell.cs\`，它做的事只有两件——启动 \`node server.mjs\`、打开浏览器窗口。不放心可以不用它：双击 \`launcher\\start-launcher.cmd\` 效果一样（会留一个黑色窗口，关掉即停止启动器）；或者用 Windows 自带的编译器自己编一份：

\`\`\`bat
cd launcher
C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe /target:winexe /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /win32icon:dsh.ico /out:DSH启动器.exe launcher-shell.cs
\`\`\`

**常见问题**

- \`setup.cmd\` 说缺少 Git 或 Node：装完要重新打开终端再运行。
- 双击 exe 没反应：先双击 \`start-launcher.cmd\` 看黑窗口里的报错；3090 端口被别的程序占用时，设置环境变量 \`DSH_LAUNCHER_PORT\` 换一个端口。
- 公司网络或需要代理：先执行 \`git config --global http.proxy http://127.0.0.1:7890\`（换成你自己的代理地址和端口）再 clone。
- 不想把配置放在 \`C:\\Users\\你\\.dsh\`：设置环境变量 \`DSH_HOME\` 指向别的目录，再运行 \`setup.cmd\`。

`},
  ],
};
