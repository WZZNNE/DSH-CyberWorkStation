# DSH Suite — DeepSeek Harness 全家桶工作台

**中文** | [English](README.md)

> 一套让 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 从"命令行工具"变成"可视化工作站"的完整套件:赛博朋克风桌面启动器 + 8 个生产级插件 + 6 个工程 Skill + 1 个 dsh 内 Skill。
> **不改本体一行代码** —— 全部能力通过官方插件扩展点外挂实现,本体随时可独立升级。

![DSH 工作台 · 赛博朋克 2077 × 边缘行者皮肤](docs/screenshots/dashboard.png)

| SillyTavern 级控制甲板 | 皮肤管理 + 社区皮肤市场 |
|---|---|
| ![控制甲板](docs/screenshots/deck.png) | ![皮肤系统](docs/screenshots/skins.png) |

<details><summary>更多截图:CC 风格 Tokens 统计(热力图 / 连续天数 / 白鲸记彩蛋)</summary>

![Tokens 统计](docs/screenshots/tokens.png)

</details>

---

## ✦ 这是什么

DeepSeek Harness 是 DeepSeek 官方的 agent 运行框架,功能强大但原生只有命令行和一个朴素的 Web UI。DSH Suite 在它之上补齐了:

- **桌面启动器**(参考秋叶 ComfyUI 整合包的体验):双击 EXE,一键启动/退出、插件市场、Skill 市场、皮肤市场、tokens 统计、会话浏览、一键更新,全部图形化;
- **控制甲板**:SillyTavern 级的提示词多条分级注入、正则脚本、世界书(World Info)、采样参数控制,在图形界面编辑、1.5 秒热载生效;
- **费用体系**:多 API 余额实时显示、模型价格自动同步、缓存命中率、CC 风格用量热力图;
- **安全与效率**:危险命令拦截、模型价格悬停提示、HTTP 快建工作区、前端皮肤注入。

一切以 **插件 / Skill / 独立启动器** 形式存在,`git status` 里本体仓库永远干净。

## ✦ 快速开始

前置:Windows 10/11、[Git](https://git-scm.com/)、[Node.js ≥ 18](https://nodejs.org/)、Edge 或 Chrome。

```bat
git clone https://github.com/WZZNNE/DSH-CyberWorkStation.git
cd DSH-CyberWorkStation
setup.cmd
```

`setup.cmd` 会自动:使用内置的 `core/` 本体源码(dsh 0.1.0-rc.8;若不存在则回退克隆上游)→ 安装依赖并构建(build:lib + build:web)→ 注册全部套件插件 → 打开启动器。

之后每次使用:双击 `launcher/DSH启动器.exe`。手动模式:`node launcher/server.mjs` 后访问 `http://127.0.0.1:3090`。

> 记得配置 API Key(环境变量 `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` 等,或 `~/.dsh/settings.yaml`)。
> 本体检出在别处?设环境变量 `DSH_REPO` 指向它;启动器端口用 `DSH_LAUNCHER_PORT` 覆盖。

## ✦ 与本体的区别(功能对比总表)

| 能力 | 本体原生 | 套件提供 | 实现形式 | 作者归属 |
|---|---|---|---|---|
| 可视化管理工作台(启动器) | ✗ 仅 CLI | 10+ 功能页、中英双语、明/暗/跟随系统 | 独立程序(EXE + 零依赖 Node 服务) | 原创 |
| 一键启动 / 退出 | ✗ 手动命令 | 启动即开浏览器;退出连控制台进程树一起收干净 | 启动器 | 原创 |
| 内嵌控制台 | ✗ 独立黑窗 | 秋叶式内嵌控制台,实时输出、自动滚动 | 启动器 | 原创 |
| 插件管理 | CLI(`dsh plugin`) | 图形化列表 + ~140 行内置能力清单 + 一键更新 | 启动器 | 原创 |
| 插件市场 | ✗ | npm 实时搜索、一键安装、跳转项目主页 | 启动器(npm registry API) | 原创 |
| Skill 市场 | ✗ | GitHub 实时搜索、一键装入 `~/.dsh/skills` | 启动器(GitHub API) | 原创 |
| 社区皮肤市场 | ✗ | npm 皮肤包**就地转换为本地 CSS**,皮肤页统一 切换/删除/导入,绝不混进插件系统 | 启动器 | 转换器原创;皮肤内容归原作者([@linxin666 系列](https://github.com/zhu1090093659/dsh-web-ui)等) |
| tokens 统计 | ✗ | GitHub 风热力图、连续使用天数、按模型分布、日历明细 | 启动器(读 cost-meter-plus 台账) | 原创 |
| 费用 / 余额 | ✗ | 多 API 余额实时拉取(OpenRouter/OpenAI/本地)、模型目录价自动同步、缓存命中统计条 | 插件 `dsh-cost-meter-plus` | 二开,上游 [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(MIT) |
| 用量面板去峰谷 | - | 移除高峰/空闲价格显示 | 插件 `dsh-token-usage-plus` | 二开,上游 [Tastelessor/dsh-usage-stats](https://github.com/Tastelessor/dsh-usage-stats)(MIT) |
| 危险命令拦截 | 仅 ask 确认 | `rm -rf` / 格式化 / 注册表等 38 类模式直接 deny | 插件 `dsh-safe-guard` | 原创 |
| 控制甲板(ST 级) | ✗ | 见下节详细教程 | 插件 `dsh-control-deck` | 原创;语义对齐 [SillyTavern](https://github.com/SillyTavern/SillyTavern)(行为参照,未引用其代码) |
| 前端皮肤注入 | ✗ | `~/.dsh/frontend-skin.css` 注入 dsh Web UI | 插件 `dsh-skin-loader` | 原创 |
| 模型悬停价格 | ✗ | 模型选择器悬停显示 输入/输出 USD 每百万 tokens | 插件 `dsh-price-hint` | 原创 |
| 快建工作区 | GUI 手动逐步 | HTTP 一键按绝对路径创建 | 插件 `dsh-quick-workspace` | 原创 |
| AI 一键做皮肤(皮肤工坊) | ✗ | 在对话里让 agent 定制启动器/本体皮肤:先问需求(风格/主色/明暗/背景图),没图且模型不能生图时**向用户要图而不虚构**(能生图则先调生图工具),本地图自动内联 dataURI,写好即落盘启用 | 插件 `dsh-skin-studio`(注册 `skin_studio` 工具)+ dsh Skill `skin-studio` | 原创 |
| 开发 Skills | ✗ | 架构/插件/前端/运维/玩法/测试 六件套 | Claude Code Skill | 原创 |
| **本体核心改写** | - | **0 行** —— 以上全部经官方扩展点实现 | - | - |

## ✦ 控制甲板(Control Deck)教程

> 启动器左栏「控制甲板」页。所有编辑保存后 **1.5 秒内热载**,无需重启 dsh。语义完全对齐 SillyTavern,老 ST 用户零学习成本。

### 1. 提示词注入(多条分级)

每条提示词有:
- **名称 / 内容**:注入的文本;
- **order(顺序)**:数字越小越靠前,多条按 order 排序分级;
- **位置**:`system`(进系统提示词)或 `user-prefix`(压在用户消息前);
- **interval(间隔)**:1 = 每步注入;N>1 = 每 N 步注入一次(适合周期性提醒);
- **启用开关**:逐条开关不删配置。

### 2. 正则脚本(ST runRegexScript 语义)

对用户输入 / 世界书内容做替换,字段与 SillyTavern 一致:
- **findRegex**:正则(支持 flags);**replaceString**:替换串,支持 `{{match}}`(整段命中)与 `$1…$9` 捕获组;
- **trimStrings**:命中文本先剔除这些子串再代入 `{{match}}`;
- **placement**:作用域,`user_input`(用户输入)/ `world_info`(世界书内容)。

### 3. 世界书(World Info,完整 ST 字段)

扫描最近对话,命中关键词自动注入背景设定:
- **keys**:主关键词,支持 `/正则/flags` 形式;**secondaryKeys + selectiveLogic**:副键逻辑 `andAny / andAll / notAny / notAll`;
- **constant 🔵**:常驻注入,不需要命中;**probability**:命中后按百分比概率注入;
- **order / position**:注入排序与位置;**caseSensitive / matchWholeWords**:大小写与全词匹配(默认全词,中日韩文本自动跳过全词逻辑);
- **递归**:一条世界书的内容可以触发另一条(`excludeRecursion / preventRecursion / delayUntilRecursion` + 全局 `maxRecursionSteps`);
- **inclusion group + groupWeight**:同组互斥按权重抽一条;
- **sticky / cooldown / delay**:命中后保持 N 条消息 / 冷却 N 条 / 会话满 N 条才生效;
- **全局设置**:`scanDepth` 扫描最近几条消息、`budgetChars` 注入字符预算。

### 4. 采样覆盖(带总开关)

**「启用采样覆盖」不勾选时,插件完全不干预请求参数** —— 防止误传。勾选后可覆盖:温度、maxTokens、停止词(最多 4 个)。
思考强度(reasoning effort)刻意 **不在** 控制甲板中:本体模型选择器已原生提供,避免双头控制。

### 5. 工具开关

填工具名即可在 `tools/pre-execute` 阶段直接拒绝调用(如禁用 `web_search`)。

## ✦ 启动器功能页导览

| 页面 | 功能 |
|---|---|
| 仪表盘 | 运行状态(RUNNING 翻牌特效)、本体版本、Node 版本、默认模型、一键启动(电流特效)/退出 |
| 插件管理 | 已安装插件 + 内置能力清单、市场搜索一键安装、一键更新 |
| Skill 管理 | 本地 Skill 列表 + GitHub 市场一键安装 |
| 会话 | 浏览全部会话与消息数,一键跳转对应存储目录 |
| 存储 | 各存储空间大小与一键打开 |
| 更新 | 本体 / 插件一键 git pull + 构建,进度日志实时滚动 |
| Tokens | 总量/命中率概览、GitHub 风热力图、连续天数、按模型分布、逐日明细 |
| 皮肤 | 启动器皮肤与 dsh 前端皮肤分开管理:切换/删除/CSS 导入/社区市场下载 |
| 控制甲板 | 上节所述 ST 级编辑器 |
| 快建工作区 | 输入绝对路径一键创建(需 dsh 运行中) |
| 日志 | 启动器内部日志 / dsh 输出 / 更新日志 |

左下角 🌐 图标一键中英切换;default 皮肤支持 明 / 暗 / 跟随系统 三态。

## ✦ 皮肤系统

- **启动器皮肤**(`launcher/skins/launcher/`):`cyberpunk-2077`(赛博朋克 2077 × 边缘行者,即梦 AI 生成美术)与 `default`(三态主题)。
- **dsh 前端皮肤**(`launcher/skins/frontend/`):经 `dsh-skin-loader` 插件注入 dsh Web UI。选「(无)」恢复原生。
- **社区皮肤市场**:搜索 npm 上的皮肤包一键安装(结果按 dsh 生态 + 皮肤语义双重过滤,无关包不会混入)。启动器会把皮肤包(支持 manifest v2 资产目录、旧 client.js 插件形态、纯 CSS 包、聚合壳包递归)**就地转换成单文件本地 CSS**:背景图内联 dataURI 并按 skin-center 原版层级直接铺在 body 背景色之上、半透明面板之下,明/暗变体跟随 dsh 主题属性切换。之后像自制皮肤一样切换/删除 —— 皮肤永远不会混进插件系统。转换文件不入 git(版权归原作者)。

## ✦ 插件清单

| 插件 | 职责 | 测试 |
|---|---|---|
| `dsh-control-deck` | ST 级提示词/正则/世界书/采样(纯函数引擎 + 宿主薄壳) | 26 项(11 语义 + 15 对抗) |
| `dsh-safe-guard` | 危险命令拦截(deny,不打扰确认流) | 44 项(38 + 6 绕过对抗) |
| `dsh-cost-meter-plus` | 余额/价格/缓存命中/台账 | 6 项 |
| `dsh-token-usage-plus` | 用量面板去峰谷 | - |
| `dsh-skin-loader` | 前端皮肤注入 | - |
| `dsh-price-hint` | 模型悬停价格 | - |
| `dsh-quick-workspace` | HTTP 快建工作区 | - |
| `dsh-skin-studio` | 模型侧皮肤工坊:`skin_studio` 工具 + 需求引导流程,经启动器 API 落盘启用;配套 dsh Skill(`dsh-skills/skin-studio`,装到 `~/.dsh/skills/`)提供变量清单与模板 | 9 项(4 + 5 对抗) |

## ✦ 工程 Skills(六件套)

复制 `skills/` 下文件夹到 `~/.claude/skills/`,Claude Code 即可深度掌握 dsh 开发:
`dsh-architecture`(Cordis 架构)· `dsh-plugin-dev`(插件契约)· `dsh-frontend-dev`(client 槽位)· `dsh-env-ops`(环境运维)· `dsh-playbook`(玩法调优)· `dsh-testing`(测试分层)。

## ✦ 原理:为什么能不改本体

dsh 基于 Cordis 插件框架,套件只用这些**官方扩展点**:

- `ctx.systemPrompt.section()` — 系统提示词分节注入;
- `agent/pre-step` — 改写进入模型的消息(正则/世界书/前缀注入);
- `agent/request` — 合并请求参数(采样覆盖);
- `tools/pre-execute` — 工具调用放行/拒绝(安全拦截/工具开关);
- `ctx.webServer.register()` — 挂 HTTP 端点(快建工作区/皮肤下发);
- client `__ModuleLoader__` 槽位 — 前端注入(皮肤/价格悬停)。

启动器则是完全独立的进程,只通过命令行与 HTTP 与本体交互。

## ✦ FAQ

**Q:任务失败提示 `MISSING_CREDENTIAL: deepseek-official`,是 bug 吗?**
不是。dsh 的会话在**创建时锁定所选模型**。如果建会话时选了 deepseek 官方模型而你只配了 OpenRouter key,这个会话会一直用官方通道并报缺凭据。解决:新建会话(默认模型见仪表盘)/ 会话内切换模型 / 补配 `DEEPSEEK_API_KEY`。

**Q:皮肤市场装的皮肤去哪了?**
皮肤管理页「dsh 前端皮肤」区,不会出现在插件列表(v1 曾误装为插件,现已修正并提供转换)。

**Q:界面改了但没生效?**
浏览器缓存,`Ctrl+F5` 强刷。

**Q:控制甲板改了配置要重启吗?**
不用,保存后 1.5 秒内热载。

## ✦ 许可与致谢

套件原创代码 MIT(见 [LICENSE](LICENSE))。二开插件沿用上游 MIT:[dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(Han-1413141)、[dsh-usage-stats](https://github.com/Tastelessor/dsh-usage-stats)(Tastelessor)。控制甲板语义对齐 [SillyTavern](https://github.com/SillyTavern/SillyTavern)(行为参照,未包含其代码)。社区皮肤内容归原作者(Maid Atelier 为 CC BY-NC-SA 4.0,禁商用)。启动器美术素材由套件作者使用即梦 AI 生成。启动器交互体验致敬 [秋叶 aaaki 的 ComfyUI 整合包启动器](https://space.bilibili.com/12566101)。
