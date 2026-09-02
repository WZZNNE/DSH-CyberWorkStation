# DSH Suite — DeepSeek Harness 全家桶工作台

**中文** | [English](README.md)

> 一套让 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 从"命令行工具"变成"可视化工作站"的完整套件:赛博朋克风桌面启动器 + 22 个生产级插件 + 7 个工程 Skill + 3 个 dsh 内 Skill。
> **不改本体一行代码** —— 全部能力通过官方插件扩展点外挂实现,本体随时可独立升级。
> 当前内置本体:**dsh 0.1.1-rc.2**(上游 tag `dsh-v0.1.1-rc.2`)。变更记录见 [CHANGELOG.md](CHANGELOG.md)。

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

- **桌面启动器**(参考秋叶 ComfyUI 整合包的体验):双击 EXE,一键启动/退出、插件市场、Skill 市场、皮肤市场、tokens 统计、会话浏览、一键更新,全部图形化;本体从已构建 CLI 冷启动约 1.5 秒;
- **控制甲板**:SillyTavern 级的提示词多条分级注入、正则脚本、世界书(World Info)、采样参数控制,在图形界面编辑、1.5 秒热载生效;
- **费用体系**:多 API 余额实时显示、模型价格自动同步、缓存命中率、CC 风格用量热力图;
- **安全与效率**:危险命令拦截、模型价格悬停提示、HTTP 快建工作区、前端皮肤注入;
- **记忆与上下文**:查看并修改每个会话当前生效的压缩摘要;轻量长期记忆(压缩摘要 + 模型抽取的事实 + 笔记,BM25 / 可选本地向量召回,作为单独上下文行注入,另有 `memory_recall` / `memory_note` 工具)。

一切以 **插件 / Skill / 独立启动器** 形式存在,内置本体一行未改,随时可整体换成任意上游版本。

## ✦ 快速开始

前置:Windows 10/11、[Git](https://git-scm.com/)、[Node.js `^22.19 || >=24`(推荐 24 LTS;本体 engines 不含 23.x)](https://nodejs.org/)、Edge 或 Chrome。

```bat
git clone https://github.com/WZZNNE/DSH-CyberWorkStation.git
cd DSH-CyberWorkStation
setup.cmd
```

`setup.cmd` 会自动:使用内置的 `core/` 本体源码(dsh 0.1.1-rc.2;若不存在则回退克隆上游)→ 安装依赖并构建(build:lib + build:web)→ 注册全部套件插件 → 链接插件所需的本体包(`launcher/peer-links.mjs`)→ 打开启动器。

之后每次使用:双击 `launcher/DSH启动器.exe`。手动模式:`node launcher/server.mjs` 后访问 `http://127.0.0.1:3090`。

在启动器「凭据中心」页或 dsh 设置 → 凭据中心 里填 API Key(`OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY`;同名环境变量仍优先;`settings.yaml` 只存引用名,不存密钥)。
> 本体检出在别处?设环境变量 `DSH_REPO` 指向它;启动器端口用 `DSH_LAUNCHER_PORT` 覆盖。
> 维护者本机内容(运行日志、缓存、维护者测试与笔记)都在被 git 忽略的 `.local/` 目录下;必须留在启动器读取位置的用户数据(转换后的社区皮肤、`active.txt` 状态文件、`plugins/node_modules` peer 链接)则由单独的忽略规则覆盖。

## ✦ 与本体的区别(功能对比总表)

| 能力 | 本体原生 | 套件提供 | 实现形式 | 作者归属 |
|---|---|---|---|---|
| 可视化管理工作台(启动器) | ✗ 仅 CLI | 10+ 功能页、中英双语、明/暗/跟随系统 | 独立程序(EXE + 零依赖 Node 服务) | 原创 |
| 一键启动 / 退出 | ✗ 手动命令 | 从已构建 CLI 启动约 1.5 秒(tsx 源码方式约 20 秒),启动即开浏览器;退出连控制台进程树一起收干净 | 启动器 | 原创 |
| 内嵌控制台 | ✗ 独立黑窗 | 秋叶式内嵌控制台,实时输出、自动滚动 | 启动器 | 原创 |
| 插件管理 | CLI(`dsh plugin`) | 图形化列表 + ~150 行内置能力清单 + 一键更新 | 启动器 | 原创 |
| 插件市场 | ✗ | npm 实时搜索、一键安装、跳转项目主页 | 启动器(npm registry API) | 原创 |
| Skill 市场 | ✗ | GitHub 实时搜索、一键装入 `~/.dsh/skills` | 启动器(GitHub API) | 原创 |
| 社区皮肤市场 | ✗ | npm 皮肤包**就地转换为本地 CSS**,皮肤页统一 切换/删除/导入,绝不混进插件系统 | 启动器 | 转换器原创;皮肤内容归原作者([@linxin666 系列](https://github.com/zhu1090093659/dsh-web-ui)等) |
| tokens 统计 | ✗ | GitHub 风热力图、连续使用天数、按模型分布、日历明细 | 启动器(读 cost-meter-plus 台账) | 原创 |
| 费用 / 余额 | ✗ | 多 API 余额实时拉取(OpenRouter/OpenAI/本地)、模型目录价自动同步、缓存命中统计条 | 插件 `dsh-cost-meter-plus` | 二开,上游 [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(MIT) |
| 用量面板去峰谷 | - | 移除高峰/空闲价格显示 | 插件 `dsh-token-usage-plus` | 二开,上游 [Tastelessor/dsh-usage-stats](https://github.com/Tastelessor/dsh-usage-stats)(MIT) |
| 危险命令拦截 | 仅 ask 确认 | `rm -rf` / 格式化 / 裸设备写入 / 强推 / fork 炸弹等直接 deny | 插件 `dsh-safe-guard` | 原创 |
| 控制甲板(ST 级) | ✗ | 分页编辑器 + 预设 + SillyTavern 世界书 / 正则脚本 / 提示词预设 JSON 导入导出 + 宏 + 显示层 AI 输出正则,见下节详细教程 | 插件 `dsh-control-deck` | 原创;语义对齐 [SillyTavern](https://github.com/SillyTavern/SillyTavern)(行为参照,未引用其代码) |
| 前端皮肤注入 | ✗ | `~/.dsh/frontend-skin.css` 注入 dsh Web UI | 插件 `dsh-skin-loader` | 原创 |
| 模型悬停价格 | ✗ | 模型选择器悬停显示 输入/输出 USD 每百万 tokens | 插件 `dsh-price-hint` | 原创 |
| 快建工作区 | GUI 手动逐步 | HTTP 一键按绝对路径创建(仪表盘) | 插件 `dsh-quick-workspace` | 原创 |
| 模型参数(任意模型) | ✗(手改 settings.yaml) | 每条路由的每个模型都能设上下文上限 / 最大输出 / 思考档位——DeepSeek 官方、OpenRouter、本地 LM Studio / Ollama 都行;本地模型会探测并自动教会档位,本体选择器直接可选(一页一行一个保存) | 插件 `dsh-local-reasoning` + 启动器「模型参数」页 | 原创 |
| 记忆与上下文 | 压缩摘要由模型写、只能看不能改(对话里一条可展开的行);没有自动的跨会话记忆(原生只能用 `@session` 引用拉取另一会话的只读快照,或自己接 MCP 记忆服务) | 启动器页面列出每个会话(打开与否都行),点开即见上下文占用、**当前生效的压缩摘要(可编辑——保存为一次真实的压缩记录,模型从你改的文字继续)**、压缩历史与「立即压缩」;长期记忆自动保存压缩摘要、由模型抽取事实、可记笔记,按词法(BM25,支持中文)或本地 `/v1/embeddings` 召回,相关条目作为一条单独的上下文行注入,并给模型 `memory_recall` / `memory_note` 工具 | 插件 `dsh-memory-lite` + 启动器「记忆与上下文」页 | 原创 |
| 配置备份 | ✗ | 把套件在 `~/.dsh` 下的配置(settings.yaml 原样、甲板 + 预设、联网搜索、安全规则、模型参数、记忆、profile 补丁、Skill、hooks、前端皮肤)打包成一个 JSON;恢复前先另存现有文件;凭据文件(`.credentials.yaml`)与会话日志永不包含 | 启动器「存储」页 | 原创 |
| 联网搜索(ST 同款) | 仅 DeepSeek 官方 `web_search` 工具,没有网页读取 | **`web_fetch` 网页读取**对所有模型可用(只读公网 http(s);在本体进程里跑、不进沙箱,HTTPS 正常);Serper / SerpApi / Tavily / Brave / SearXNG / DeepSeek 官方(官方来源只需 `DEEPSEEK_API_KEY`,与聊天模型无关);OpenRouter 的 `:online` 联网变体在「模型参数」页一键添加(限自带 models 列表的 OpenRouter 路由;只用内置目录的路由要先在 dsh 设置页生成列表);四种方式,**全局配一次**(dsh 设置 →「联网搜索(全局)」,或启动器控制甲板分页,写的是同一份配置)——关闭 / **让模型自己决定**(tool call,由所选来源代答)/ **按触发词自动搜索**(ST 触发语义:反引号 / `$N` 正则 / 短语 / 总是,模板、预算、带 SSRF 防护的访问页面;结果作为单独的上下文消息放在你的消息之后,原话不改)/ **走 API 自己的供应商搜索**(OpenRouter 由服务端搜索,自动补 `:online` 模型变体,**按次另计费**;没有这个开关的路由回落成 tool call);密钥经 dsh 凭据系统保存;一键测试 | 插件 `dsh-web-search-plus` + 控制甲板分页 | 原创;触发语义对齐 SillyTavern Extension-WebSearch(未引用其代码) |
| 聊天记录可改可删 | ✗(日志只追加,界面没有编辑入口) | 任意消息(**你的和 AI 的都行**)四个操作:**改**、**删除**(这两个同时作用于你看到的和模型看到的——真实的 `compaction/prune` + 表面替换,影子计价不乱)、**折叠**(只收起显示,点一下展开)、**分叉**(从任意已完成的轮次开新会话,第一轮不能作为分叉点) | 插件 `dsh-chat-editor`(会话头 ✎ + 消息操作) | 原创 |
| 临时对话 | ✗ 每个会话都得挂在某个工作区目录下 | 一键新建不属于任何项目的临时对话,落在 `$DSH_HOME/scratch/`,用随包的**纯聊天预设**(不能写文件,没有终端、任务、子智能体、工作流工具;`POST /new` 可以指定别的预设,那样就不再是这个沙箱),单独归到一个工作区;不会自动删除 | 插件 `dsh-temp-chat`(侧边栏按钮) | 原创 |
| 生图 / 生视频 / 语音 API | ✗ 只有文字 | 四类接口统一在一个设置面板里:生图(OpenAI 兼容、OpenRouter、Gemini、Replicate、fal)、生视频(Sora、OpenRouter、Veo、Replicate、fal、MiniMax)、语音合成(OpenAI 兼容含本地 Kokoro、ElevenLabs、Fish Audio、MiniMax)、语音识别(OpenAI 兼容含本地 Whisper),外加自定义 HTTP 适配器;每类媒体可选「自定义 / 共享全局 API(DSH)」两档、一键抓取供应商模型与价格并按功能过滤(生图页只见出图模型)、TTS 音色预设;结果自动存盘、可列可删,并**直接在对话里播放** | 插件 `dsh-media-lab`(`generate_image` / `generate_video` / `text_to_speech` / `transcribe_audio`) | 原创 |
| 桌宠 | ✗ | 有自己的人格、设定集(全量参数世界书,可**覆盖或共存**控制甲板的世界书)和**独立多模态 API**(可跟随全局 / 共享 DSH 供应商 / 完全自定义,含最大输入预算);知道主人在干什么(开始/完成各说一句)、按四档频率主动搭话、能定提醒、能说能听、能给自己画图,并在三档权限(不允许 / 每次询问 / 完全允许)下看屏幕或操作鼠标键盘;每个表情可以是 8-24 帧的序列帧动画、点一下就能跟它说话;三种窗口:dsh 内浮窗、WinForms 桌面精灵、Edge 应用窗口 | 插件 `dsh-desktop-pet` + dsh Skill `desktop-pet` | 原创 |
| 安全规则界面 | - | 额外的拒绝 / 需确认 / **自动放行**正则(拒绝>需确认>放行,内置规则永远优先),热载自 `~/.dsh/safe-guard.json` | 插件 `dsh-safe-guard` + 控制甲板分页 | 原创 |
| 凭据入系统钥匙串 | ✗ 明文 `.credentials.yaml` | API 密钥存入 **Windows 凭据管理器**(`dsh:<名>`),环境变量仍优先,下次保存即自动迁移,钥匙串故障自动回退明文路径 | 插件 `dsh-credentials-keyring` | 原创 |
| 手机远程的 LAN /api 防线 | ✗ 绑 0.0.0.0 会信任所有局域网 IP 的 `/api` | 开手机远程后,**未配对**局域网设备访问 `/api` 一律 403——自动派生的局域网信任项由**一个插件就地剔除、零核心改动**,故核心升级不会重开此洞 | 插件 `dsh-lan-fence` | 原创 |
| 社区生态适配 | - | 经启动器插件市场采纳 9 个社区插件(`setup.cmd` 不装它们;本核心上 `dsh-context` 需 ≥ 0.40——0.13 用本体已不认的字段注册投影,「上下文」页永远读不出来):视觉桥(纯文本模型识图+OCR/定位 26 工具;v1.8.0 起为中文界面分支 `dsh-vision-bridge-zh`)、@文件提及、侧边工作台(文件/Git/终端/浏览器)、**手机扫码远程**(配对制,未配对局域网设备 /api 直接 403——由 `dsh-lan-fence` 插件就地剥掉自动推导的 LAN 授信(不改本体))、定时自提示、会话导入(Claude Code/Codex/ChatGPT/Cursor)、语音输入、桌面通知、自动重试 | vision-bridge / at-file / better-sidebar / remote-web-ui / automation / chat-import / voice-input / notification / retry | 社区(见 CHANGELOG v1.6.0;两款候选因不兼容/数据劫持被否) |
| 会话分组 / 导出 | CLI 导出 | 按工作区分组、过滤、一键经本体 `/api/session.export` 导出 ZIP | 启动器 | 原创 |
| 升级到上游 tag & 自检 | ✗ | 本地 vs 上游最新版本对比、把本体升级到任意 tag(下载 → 镜像 → install → build)、启动器自检面板、日志过滤 / 复制 / 下载 | 启动器 | 原创 |
| AI 一键做皮肤(皮肤工坊) | ✗ | 在对话里让 agent 定制启动器/本体皮肤:先问需求(风格/主色/明暗/背景图),没图且模型不能生图时**向用户要图而不虚构**(能生图则先调生图工具),本地图自动内联 dataURI,写好即落盘启用 | 插件 `dsh-skin-studio`(注册 `skin_studio` 工具)+ dsh Skill `skin-studio` | 原创 |
| 开发 Skills | ✗ | 架构/插件/前端/运维/玩法/测试/本地模型 七件套 | Claude Code Skill | 原创 |
| **本体核心改写** | - | **0 行** —— 以上全部经官方扩展点实现 | - | - |

## ✦ 控制甲板(Control Deck)教程

> 启动器左栏「控制甲板」页,按分页组织(提示词 / 正则脚本 / 世界书 / 采样与上下文 / 联网搜索 / 安全规则 / 上手指南)。所有编辑保存后 **1.5 秒内热载**,无需重启 dsh。语义完全对齐 SillyTavern,老 ST 用户零学习成本;顶栏可保存 / 载入 / 删除 **预设**,并导入 / 导出 **SillyTavern 的世界书、正则脚本、提示词预设 JSON**(或整份甲板)。

### 1. 提示词注入(多条分级)

每条提示词有:
- **名称 / 内容**:注入的文本;
- **order(顺序)**:数字越小越靠前,多条按 order 排序分级;
- **位置**:`system`(进系统提示词)或 `user-prefix`(作为一条单独的上下文消息放在你的消息之后);**role** 为你自己的语义标注(ST 提示词管理器字段,导出时原样带回);
- **interval(间隔)**:1 = 每条用户消息;N>1 = 同一会话每 N 条用户消息注入一次(适合周期性提醒;工具回合不计);
- **启用开关**:逐条开关不删配置;
- **宏**(全局开关):`{{date}} {{time}} {{weekday}} {{isodate}} {{isotime}} {{model}} {{provider}} {{workspace}} {{newline}} {{random:a,b,c}} {{roll:2d6}}` 在提示词与世界书内容中展开。

### 2. 正则脚本(ST runRegexScript 语义)

对用户输入 / 世界书内容做替换,字段与 SillyTavern 一致:
- **findRegex**:正则,flags 原样使用(不含 `g` 只替换第一处,同 ST 的 `regexFromString`);**replaceString**:同 ST `runRegexScript` 的记号:`{{match}}`(不分大小写,= `$0`)、任意位数的 `$1`…、`$<name>`;没有 `$$` 转义(`$$5` = `$` + 第 5 组),`$&` 是普通文字;
- **trimStrings**:从每个代入值中剔除这些子串;
- **placement**:作用域,`user_input`(进模型前改写你的消息)/ `world_info`(改写注入的世界书内容)/ `ai_output`(**仅显示层**:只改 dsh 网页里的助手文本,日志与模型上下文不变)。

### 3. 世界书(World Info,完整 ST 字段)

扫描最近对话,命中关键词自动注入背景设定:
- **keys**:主关键词,支持 `/正则/flags` 形式;**secondaryKeys + selectiveLogic**:副键逻辑 `andAny / andAll / notAny / notAll`;
- **constant 🔵**:常驻注入,不需要命中;**probability**:命中后按百分比概率注入;
- **order**:注入排序;**caseSensitive / matchWholeWords**:大小写与全词匹配(默认全词,中日韩文本自动跳过全词逻辑);
- **递归**:一条世界书的内容可以触发另一条(`excludeRecursion / preventRecursion / delayUntilRecursion` + 全局 `maxRecursionSteps`);
- **inclusion group + groupWeight**:同组互斥按权重抽一条;**prioritize**(取最高 order)与 **useGroupScoring**(取命中键最多者)同 ST;
- **sticky / cooldown / delay**:命中后保持 N 条消息 / 冷却 N 条 / 会话满 N 条才生效;
- **全局设置**:`scanDepth` 扫描最近几条消息(条目可单独覆盖)、`budgetChars` 注入字符预算、`minActivations` / `maxDepth`(不够就往更早的历史扫)、`includeNames`(扫描文本带 `User:` / `Assistant:` 前缀)。

命中的世界书内容(以及 user 前置 / 间隔提示词)作为一条**单独的 plugin 来源上下文消息放在你的消息之后**——这是本体自己注入上下文的做法(≈ SillyTavern 的"in-chat, depth 0");你的原话不会被改写,该行在网页里显示为上下文而非用户气泡,之前的注入也不会被再次扫描。dsh 的历史由会话日志推导,无法在更深位置插入而不破坏请求重建不变量。条目的 caseSensitive / matchWholeWords 可留"全局"跟随世界书全局设置(ST 的 Case-sensitive / Match whole words)。

### 4. 采样覆盖(带总开关)

**「启用采样覆盖」不勾选时,插件完全不干预请求参数** —— 防止误传。勾选后可覆盖:温度、maxTokens、停止词(最多 4 个)。
思考强度(reasoning effort)刻意 **不在** 控制甲板中:本体模型选择器已原生提供,避免双头控制——本地模型会自动教会档位(见「模型参数」页,`dsh-local-reasoning`)。

**最大上下文**:dsh 没有 SillyTavern 那种"截断历史"的上下文上限(会话日志必须逐字节可重建);等价旋钮是按模型设置的 `contextWindow`(本体压缩在其 80 % 处触发(随附的 standard / code / cordis 预设挂载 compaction-basic;minimal 预设无压缩)。「采样与上下文」分页会把每个本地模型的窗口与 LM Studio / Ollama 实际装载的上下文并排列出,并跳转到「模型参数」页——任何模型(DeepSeek 官方、OpenRouter、本地)都能在那里设自己的 `contextWindow` 与 `maxTokens`(单次回复最大输出);这就是"dsh 默认 262,144 而 LM Studio 只装了 8k"冲突的解法。压缩发生后,「**记忆与上下文**」页能看到模型此刻看到的摘要并直接改(见 §9)。

### 5. 工具开关

填工具名即可在 `tools/pre-execute` 阶段直接拒绝调用(如禁用 `web_search`)。

### 6. 联网搜索分页(`dsh-web-search-plus`)

四种模式,全局配一次(这个分页和 dsh 设置 →「联网搜索(全局)」写的是同一份 `~/.dsh/web-search.json`):**关闭**(模型的 `web_search` 工具被拒绝)、**让模型自己决定**(模型想搜就调用 `web_search`,由你选的来源——DeepSeek 官方或下方任一 API——回答)、**按触发词自动搜索**(给不支持 tool call 的模型;SillyTavern Web Search 语义:命中触发词—— `` `反引号` ``、正则第 1 捕获组、短语或"总是"——就先搜,再把格式化结果作为一条单独的上下文消息放在你的消息之后(原话不改);适合不支持 tool calling 的本地模型)、**走 API 自己的供应商搜索**(OpenRouter 会把请求换成 `<model>:online` 变体,由它服务端搜索——任何模型都行,**按次另计费**;没有这个开关的路由回落成 tool call)。来源:Serper、SerpApi、Tavily、Brave、SearXNG 与 DeepSeek 官方。密钥经 dsh 凭据系统写入 `~/.dsh/.credentials.yaml`,启动器从不落盘;「测试搜索」按钮显示耗时与注入预览。

### 7. 安全规则分页(`dsh-safe-guard`)

内置拒绝规则始终生效;可追加自己的 **拒绝** 正则(直接拦下)或 **需确认** 正则(在 dsh 网页弹出审批)——逐行一条、不区分大小写,热载自 `~/.dsh/safe-guard.json`。

### 8. 预设、SillyTavern 导入 / 导出、一个保存按钮

页底唯一的「**保存并热载(全部分页)**」同时写入甲板、联网搜索配置与安全规则(API Key 经「保存 Key」单独存入 dsh 凭据)。
整套甲板可按名保存 / 载入 / 删除为预设(`~/.dsh/control-deck-presets/*.json`)。导入导出使用 SillyTavern 自己的 JSON:世界书(`entries{}`,`selectiveLogic` 0-3、递归、分组、sticky/cooldown/delay…)、正则脚本(`findRegex` 可为 `/pattern/flags`,`placement` 1 / 2 / 5)、提示词预设(`prompts[]` + `prompt_order`)或整份甲板。dsh 内 Skill `control-deck-authoring`(装到 `~/.dsh/skills/`)教会 agent 全部字段,你可以直接让它替你写世界书和正则。

### 9. 记忆与上下文(`dsh-memory-lite`)

dsh 在 `contextWindow × 0.8`(或 `/compact`)时把最旧的历史压成一段模型写的 `<compacted-summary>` 检查点;不截断,但以前这段摘要只能看(对话里一条可展开的行)不能改,会话之间也没有记忆。「记忆与上下文」页补上这两块:

- **会话上下文**:每个会话(打开与否都行)的上下文占用与压缩阈值、**当前生效的压缩摘要(可编辑)**、压缩历史与「立即压缩」。保存修改 = 追加一次真实的压缩记录(`compaction/start` → `compaction/summary` → 替换检查点 → `compaction/end`,provider `dsh-memory-lite` / model `manual-edit`)替换当前检查点:日志仍是只追加、逐字节可重建,token 计量的影子价格协议成立,下一次请求起模型按你的文字继续。未打开的会话会按它记录的预设恢复、改完、落盘、再关闭。
- **长期记忆**:模型写的压缩摘要自动保存(每会话留最新;你改过的摘要按「存入长期记忆」保存),会话自己的模型每 8 轮抽取一次持久事实(全局 = 关于你;工作区 = 关于项目),你或模型(`memory_note`)也能记笔记。召回用 BM25(英文词 + 中文二字组,可选接本地 OpenAI 兼容 `/v1/embeddings` 做向量混合——LM Studio、Ollama 都有);新会话第一轮把钉住 + 相关条目作为一条单独的 `[Memory recall]` 上下文行放在你的消息后,之后只补没注入过的相关条目。条目可钉住、改范围、编辑、导入导出。配置 `~/.dsh/memory-lite.json`,数据 `~/.dsh/memory/memory.json`。

## ✦ dsh 本体内的面板(改聊天、临时对话、多媒体、桌宠、凭据、模型清单、拖文件)

有九个插件把界面做在 dsh 页面里而不是启动器里——对话在哪,入口就在哪:下面四个,加上「凭据中心」设置区(`dsh-credentials-center`,启动器也有同名页)、「模型清单同步」卡(`dsh-provider-sync`)、中文的「图片理解」卡(`dsh-vision-bridge-zh`)、「会话导入 · 系统提示词」说明卡(`dsh-import-note`)和拖文件处理(`dsh-drop-files`,无面板)。

### 改 / 删聊天记录(`dsh-chat-editor`)

会话标题栏多一个 **✎**,点开是整条日志的节点列表(角色、是否还在模型视野里、被谁遮住)。每行给五个动作:
**改**、**删除**(这两个一次同时改掉你看到的和模型看到的)、**折叠**(只收起显示,点一下展开)、
**从这里分叉**(以该点为种子开新会话);AI 消息行还有一个就地编辑入口。

日志本身永远不被改写:「改」的模型那一半是先追加一条 `compaction/prune`(带上被遮住的区间、seq 和 token 数),
再做一次表面 `replace`——本体压缩走的就是这条路。改 AI 的话会落成带说明的用户更正消息,因为
`assistant/message` 必须在打开的 step 里写。你看到的那一半存在 `$DSH_HOME/chat-edits.json`,按文本匹配,
日志位置变了也不会贴错行。

### 临时对话(`dsh-temp-chat`)

侧边栏底部的 **🗒 临时对话**:开一个不属于任何项目的会话,目录是新建的 `$DSH_HOME/scratch/tmp-…`,
归到共用的「临时对话 / Temporary chats」工作区,用随包的纯聊天预设(没有文件、终端、任务、子智能体、工作流)。
不会自动删除;`POST /dsh-temp-chat/clean` 删单个目录,会话还开着时拒绝。

### 多媒体 API(`dsh-media-lab`)

设置 → **多媒体 API**:生图 / 生视频 / 语音合成 / 语音识别四类,各自选供应商、接口地址、模型、Key,带「试生成」。
模型侧多出 `generate_image`、`generate_video`、`text_to_speech`、`transcribe_audio`;生成的文件落到
`$DSH_HOME/media/`(带一份 JSON 说明),并**直接在对话里显示/播放**。内置十种供应商,外加自定义 HTTP
适配器(地址 + 请求头 + 请求体模板 + 结果字段路径);本地服务不用填 Key。

### 桌宠(`dsh-desktop-pet`)

侧边栏 **🐾 桌宠** 打开 dsh 内的浮窗宠物;设置 → **桌宠** 里配其余全部:人格与外观(只作用于桌宠 / 全局)、
它自己的多模态 API、世界书、表情动作(一张静图配一个动作,或者 8-24 帧、自己定帧率的序列帧动画)、
从你过去说过的话里总结出来的主人画像(可改可清空)、三档看屏幕与操作电脑权限、四档主动搭话频率、语音、
提醒、对话记录,以及桌面窗口——WinForms 桌面精灵或 Edge 应用窗口,两者都由一个 C# 宿主驱动,用 Windows
自带的 .NET Framework 编译器按需编译。桌面精灵是逐像素透明的分层窗口,抠图留下的柔边不会带一圈底色,
空白处点得穿;点它一下,底下就弹出一行输入框直接说话。配套的 `desktop-pet` Skill 会带着模型问需求、
写人设、列素材清单,直接在对话里把立绘生成出来,再用图生视频把立绘变成序列帧。

## ✦ 启动器功能页导览

| 页面 | 功能 |
|---|---|
| 仪表盘 | 运行状态(RUNNING 翻牌特效)、本体版本、Node 版本、默认模型、一键启动(电流特效)/退出、文件夹快捷入口、快建工作区、内嵌控制台 |
| 插件管理 | 已安装插件 + 内置能力清单、市场搜索一键安装、一键更新 |
| Skill 管理 | 本地 Skill 列表 + GitHub 市场一键安装 |
| 会话 | 按工作区分组(最新在前)、过滤框、一键经本体端点导出 ZIP |
| 存储 | 各存储空间大小与一键打开、**配置备份 / 恢复**(JSON 包) |
| 更新 | 本地 vs 上游最新版本、一键 git pull + 构建、**把本体升级到任意上游 tag**、插件更新、启动器自检面板、进度日志实时滚动 |
| Tokens | 总量/命中率概览、GitHub 风热力图、连续天数、按模型分布、逐日明细 |
| 凭据中心 | 每一个 API 凭据引用的绑定、状态、来源;别名 / 备注;经核心凭据库设置 / 替换 / 删除;**刷新模型清单**(同步 OpenRouter 目录)与 **dsh 默认模型**(选路由→选模型,写 `agent-default-model`) |
| 皮肤 | 启动器皮肤与 dsh 前端皮肤分开管理:切换/删除/CSS 导入/社区市场下载。内置:`default`(启动器)、`cyberpunk-2077` 与 `night-city-holo`(两端) |
| 控制甲板 | 上节所述 ST 级分页编辑器(提示词 / 正则 / 世界书 / 采样与上下文 / 联网搜索 / 安全规则 / 上手指南)、预设、ST 导入导出 |
| 模型参数 | 每条路由的模型:上下文上限 / 最大输出 / 思考档位(本地路由:探测、自动教档位、思考模式、api 切换);OpenRouter `:online` 联网变体;过滤框,大路由默认折叠 |
| 记忆与上下文 | 会话列表;逐会话:上下文占用、可编辑的当前压缩摘要、压缩历史、立即压缩;长期记忆条目(搜索 / 钉住 / 范围 / 编辑 / 导入导出)、设置、召回测试 |
| 日志 | 启动器内部日志 / dsh 输出 / 更新日志,只看 ERROR、关键词过滤、复制、下载 |

左下角 🌐 图标一键中英切换(服务端提示随之切换);default 皮肤支持 明 / 暗 / 跟随系统 三态。

## ✦ 皮肤系统

- **启动器皮肤**(`launcher/skins/launcher/`):`cyberpunk-2077`(赛博朋克 2077 × 边缘行者,即梦 AI 生成美术)与 `default`(三态主题)。
- **dsh 前端皮肤**(`launcher/skins/frontend/`):经 `dsh-skin-loader` 插件注入 dsh Web UI。选「(无)」恢复原生。内置皮肤文件更新后,当前启用皮肤的副本会在启动器开机时自动刷新(重启启动器生效)。
- **社区皮肤市场**:搜索 npm 上的皮肤包一键安装(结果按 dsh 生态 + 皮肤语义双重过滤,无关包不会混入)。启动器会把皮肤包(支持 manifest v2 资产目录、旧 client.js 插件形态——在独立的受限 Node 进程中执行提取、纯 CSS 包、聚合壳包最多两层依赖递归)**就地转换成单文件本地 CSS**:背景图内联 dataURI 并按 skin-center 原版层级直接铺在 body 背景色之上、半透明面板之下,明/暗变体跟随 dsh 主题属性切换。之后像自制皮肤一样切换/删除 —— 皮肤永远不会混进插件系统。转换文件不入 git(版权归原作者)。

## ✦ 插件清单

| 插件 | 职责 | 验证 |
|---|---|---|
| `dsh-control-deck` | ST 级提示词/正则/世界书/采样(纯函数引擎 + 宿主薄壳)、预设、ST 导入导出、显示层 AI 输出正则 | 维护者用例 48 项(11 语义 + 15 对抗 + 17 v3 引擎/格式 + 5 宿主壳) |
| `dsh-safe-guard` | 危险命令拦截(deny,不打扰确认流)+ 热载的拒绝 / 需确认 / 自动放行用户规则(拒绝 > 需确认 > 放行,内置规则永远优先) | 维护者用例 46 项(38 + 6 绕过对抗 + 2 用户规则) |
| `dsh-credentials-keyring` | 凭据 seam 的 Windows 凭据管理器后端:环境变量仍优先,写入即迁移,记录半区继承,钥匙串故障一律回退明文路径 | 维护者用例 12 项 |
| `dsh-cost-meter-plus` | 余额/价格/缓存命中/台账 | 维护者用例 9 项 |
| `dsh-token-usage-plus` | 用量面板去峰谷(仍在仓库,v1.8.0 起不在默认 profile:费用表已覆盖) | 实机冒烟 |
| `dsh-skin-loader` | 前端皮肤注入 | 实机冒烟 |
| `dsh-price-hint` | 模型悬停价格 | 实机冒烟 |
| `dsh-quick-workspace` | HTTP 快建工作区 | 2 项维护者用例 |
| `dsh-skin-studio` | 模型侧皮肤工坊:`skin_studio` 工具 + 需求引导流程,经启动器 API 落盘启用;配套 dsh Skill(`dsh-skills/skin-studio`,装到 `~/.dsh/skills/`)提供变量清单与模板 | 维护者用例 9 项(4 + 5 对抗) |
| `dsh-local-reasoning` | 所有路由(DeepSeek 官方 / OpenRouter / 本地)的模型参数:上下文上限、最大输出、思考档位(Ollama 原生 reasoning_effort、gpt-oss 档位、LM Studio 上 Qwen3 软开关),按版本号校验写入(models 条目 / modelOverrides / llm-deepseek 列表)、后端探测、自动教档位、档位可手改、OpenRouter `:online` 变体 | 维护者用例 16 项(8 纯函数 + 8 宿主壳) |
| `dsh-memory-lite` | 跨压缩、跨会话的记忆:压缩摘要沉淀、事实抽取、BM25 / 可选向量召回、首轮 + 相关度注入(单独上下文行)、`memory_recall` / `memory_note` 工具、逐会话上下文视图与**可编辑的压缩摘要**(写成真实压缩记录)、立即压缩、JSON 存储 | 维护者用例 36 项(26 纯函数 + 10 宿主壳) |
| `dsh-web-search-plus` | SillyTavern 同款联网搜索:五种来源 + DeepSeek 官方、四种方式(关闭 / 让模型自己决定 / 按触发词注入 / **走 API 自己的供应商搜索**)统一在 dsh 设置里配一次、ST 触发语义、模板 / 预算 / 带 SSRF 防护的访问页面、凭据系统存密钥;**`web_fetch` 网页读取**由本体的工具定义 + 钉住地址的自带传输拼装、前置公网地址守卫(自带预设默认关着) | 维护者用例 53 项 |
| `dsh-chat-editor` | 聊天记录编辑与删除:**改**和**删除**同时作用于两边(经 `compaction/prune` + 表面替换,改 AI 的话落成带说明的用户更正)、**折叠**、从任意已完成轮次**分叉**、冷会话按原预设恢复 | 维护者用例 15 项 |
| `dsh-temp-chat` | 不属于任何项目的临时对话:每次一个草稿目录、共用工作区、随包纯聊天预设、屏蔽全局工具、带守卫的清理 | 维护者用例 9 项 |
| `dsh-media-lab` | 生图 / 生视频 / 语音合成 / 语音识别统一面板,十种供应商 + 自定义 HTTP,每类媒体可选「自定义 / 共享全局 API(DSH)」两档(host 与密钥同源解析、失败即拒绝),按功能抓模型与价格,TTS 音色预设,参考图引导生图(OpenRouter `input_references` + seed + 分辨率档位),文件落到 `$DSH_HOME/media` 并在对话里直接播放,四个模型工具 | 维护者用例 104 项(60 适配器 + 33 宿主壳 + 6 模型侦察 + 5 来源/配置) |
| `dsh-desktop-pet` | 桌宠:独立人格 / 世界书 / 多模态 API,从你自己的历史里总结主人画像,知道当前任务,四档主动搭话,提醒,语音收发,8-24 帧序列帧动画,点一下就能说话的分层桌面窗口(拖动时倾斜拉伸,帧按窗口尺寸缓存、移动不重绘),三档看屏幕与操作电脑权限,dsh 内浮窗 + WinForms + Edge 三种窗口,配套做宠 Skill;设定集全量参数(关键词 / 二级关键词 / 触发逻辑 / 概率 / 顺序 / 扫描深度)并可「覆盖 / 共存」控制甲板世界书,另有最大输入 tokens 预算 | 维护者用例 94 项(34 纯函数 + 60 宿主壳) |
| `dsh-provider-sync` | OpenRouter 路由模型清单自动更新:启动 + 每 24 h + 设置卡片;新模型入表、上下文/输出上限刷新、可推理模型写入思考强度档位 | 15 单元 |
| `dsh-drop-files` | 把任意非图片文件拖进对话:落到工作区 `.dsh-uploads/`,输入框写入 `@.dsh-uploads/<名>`(图片仍走核心附件栏) | 9 单元 |
| `dsh-credentials-center` | 一页管全部凭据引用:绑定在哪些功能(llm 路由 / 多媒体 / 联网搜索 / 桌宠 / 记忆)、状态、来源、别名、备注;设置 / 删除走核心凭据库;**每个引用可存多把备用密钥**(一键切换,被换下的自动保留);启动器页 + 设置区 | 18 单元 |
| `dsh-vision-bridge-zh` | 社区图片理解桥的中文界面分支(MIT):路由不变,卡片看得懂 | 实机冒烟 |
| `dsh-import-note` | 插件配置里的一张说明卡:社区「会话导入」对源系统提示词的处理(默认丢弃;开启后也只是导入会话内的一条上下文消息,不碰 dsh 自己的提示词);只在装了导入插件时显示 | 维护者用例 2 项 |
| `dsh-lan-fence` | 手机远程的 LAN /api 防线:就地剥掉连接防线里自动推导的 LAN 授信(profile 的 patch 层,不是 bundle——由 `launcher/dsh-patch-layers.mjs` 登记) | 维护者用例 6 项 |
维护者测试集(504 个用例)不随发布树分发,位于被 git 忽略的 `.local/tests/`。

## ✦ 工程 Skills(七件套)

复制 `skills/` 下文件夹到 `~/.claude/skills/`,Claude Code 即可深度掌握 dsh 开发:
`dsh-architecture`(Cordis 架构)· `dsh-plugin-dev`(插件契约)· `dsh-frontend-dev`(client 槽位)· `dsh-env-ops`(环境运维)· `dsh-playbook`(玩法调优)· `dsh-testing`(测试分层)· `dsh-local-models`(LM Studio / Ollama 路由、思考档位、上下文对齐)。

dsh 内 Skill(`dsh-skills/`,`setup.cmd` 复制到 `~/.dsh/skills/`):`skin-studio`(皮肤工艺)· `control-deck-authoring`(提示词 / 正则 / 世界书 / 预设编写与 SillyTavern 迁移)· `desktop-pet`(做一只桌宠:人设、素材清单、出图提示词)。

## ✦ 原理:为什么能不改本体

dsh 基于 Cordis 插件框架,套件只用这些**官方扩展点**:

- `ctx.systemPrompt.section()` — 系统提示词分节注入;
- `agent/pre-step` — 改写进入模型的消息(正则/世界书/前缀注入);
- `agent/request` — 合并请求参数(采样覆盖);
- `tools/pre-execute` — 工具调用放行/拒绝(安全拦截/工具开关);
- `llm/stream` + `ctx.sessionProjections` — 用量捕获与会话费用投影(cost-meter);
- `ctx.webServer.register()` — 挂 HTTP 端点(快建工作区/皮肤下发/价格提示);
- `session/event` / `agent/status` / `ctx.tools.register()` / `ctx.agents.resume()` + `agent.runMaintenance()` + `session.append()` — 记忆插件的摘要沉淀、事实抽取、工具,以及编辑摘要用的压缩记录(和 `compaction-basic` 一样的只追加 + 位置替换协议);
- client `__ModuleLoader__` 槽位 — 前端注入(皮肤/价格悬停/费用与用量面板)。

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

**Q: 压缩之后模型记住的东西能改吗?**
能——「记忆与上下文」→ 选会话 → 改当前摘要 → 保存。它会写成一条新的压缩记录(原文仍在日志里),下一次请求就按你的文字继续;没打开的会话会被恢复、改完再关闭。

**Q: 记忆插件会多花模型调用吗?**
只有事实抽取(每 8 轮人类消息用会话自己的模型调一次短请求;在「记忆与上下文 → 设置」可关),以及你主动点的「立即压缩」。沉淀、召回、注入都在本地;向量可选且默认关闭(默认接口指向 LM Studio;Ollama 或任何 OpenAI 兼容 `/v1/embeddings` 都行)。

**Q:本体启动要 20 秒而不是 1.5 秒?**
本体尚未构建(缺 `core/apps/cli/lib/bin.js`),启动器回退到了 tsx 源码启动。在 `core/` 内执行 `corepack pnpm build:lib && corepack pnpm build:web`(或在更新页点「一键更新本体」)。

## ✦ 许可与致谢

套件原创代码 MIT(见 [LICENSE](LICENSE))。二开插件沿用上游 MIT:[dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(Han-1413141)、[dsh-usage-stats](https://github.com/Tastelessor/dsh-usage-stats)(Tastelessor)。控制甲板语义对齐 [SillyTavern](https://github.com/SillyTavern/SillyTavern)(行为参照,未包含其代码)。社区皮肤内容归原作者,并沿用其来源包声明的许可(再分发前请逐包核对;部分皮肤禁止商用)。启动器美术素材由套件作者使用即梦 AI 生成。启动器交互体验致敬 [秋叶 aaaki 的 ComfyUI 整合包启动器](https://space.bilibili.com/12566101)。
