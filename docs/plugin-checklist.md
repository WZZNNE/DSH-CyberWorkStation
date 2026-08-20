# dsh 插件补充完整清单

生成:2026-08-19 · 基于 deepseek-harness 本体检出 @ rc.7(`99f6f02fec`)+ `~/.dsh` 实测 + 三线调研
图例:✅=源码/本机验证 · 🌐=社区来源(已注出处)

## A. 本地现状(✅ 实测)

- 仓库在库插件包:**219 个**(48 个分组)
- 你的 `~/.dsh/profiles/web`:**原装零插件**(`dependencies: {}`,`cordis.patch.yml` 为 `[]`),挂载 = `dsh-base`(~80 行:llm/session/tools/bash/pwsh/fs/web/subagent/goal/plan/compaction/skill/sandbox/approval…)+ `dsh-web-app`(~50 行 UI)
- 自修改能力(`tool-cordis`/`ui-cordis`/`cordis-host-runner`)**默认已挂载**

## B. 第一优先:库内已有、默认未挂载 → 零开发,patch 挂载即用(✅)

| 能力 | 在库包 | 说明 |
|---|---|---|
| **MCP 客户端** | `mcp/mcp-client` | 连接 MCP 服务器并把其工具注册到 ctx.tools |
| **LSP 代码智能** | `lsp/lsp` + `lsp-stdio` + `tool-lsp` | 跳转定义/引用/实现/hover,只读工具 |
| **持久终端 PTY** | `terminal/terminal` + `terminal-bash` + `tool-terminal` | 6 个模型侧持久终端工具 |
| **定时提醒/调度** | `schedule/schedule` | 会话级 after/at/固定频率 reminder |
| **Claude Code / Codex hook 桥** | `hooks/hooks-claude-code`、`hooks-codex` | 复用两家 hook 配置文件 |
| **E2B 远程沙箱** | `e2b/*` 三件套 | fs+subprocess 整体切进云沙箱(POC) |
| **外部 subagent 提供方** | `subagent-acp`/`-codex`/`-claude-code`/`-dsh-sdk` | base 仅挂 in-process+fork,其余按需 opt-in(AGENTS.md 明示 Profile 自装) |

挂载方式:`~/.dsh/profiles/web/cordis.patch.yml` 里 `- insert:` 对应行(id+name),包名入 profile `package.json` dependencies;`dsh --profile web --dump-config` 验证。

## C. 第二优先:社区即装即用(`dsh plugin --profile web add <pkg>`)

**基础设施栈(🌐 atlascloud "7 worth it"):**
`dsh-market`(设置页插件浏览器,awesome 列表官方推荐)· `dsh-find-plugin`(对话内找插件)· `dsh-poison-guard`(装前供应链扫描)· `dsh-plugin-doctor`(manifest/构建体检)· `dsh-cost-meter`(每会话成本)· `dsh-tier-router`(规划贵模型/执行便宜模型分流)· `dsh-context`(上下文占用可视化,bowenliang123/dsh-context)

**按需精选(🌐 awesome-dsh-plugin 1000+ 收录,标注高影响项):**
- 成本/用量:`dsh-token-usage`(本地优先)、`dsh-all-usage`(53 周热力图+缓存效率)、`Jannchie/dsh-bill`(8000+ 模型价目)
- UI 生产力:`0xsline/dsh-spotlight`(命令面板)、`omdsh-dev/DSH-better-sidebar`(文件渲染编辑侧栏)、`loadingvx/…workbench-plugin`(IDE 工作台)、`dsh-auto-collapse`(工作流折叠)
- 工具能力:`Js2Hou/dsh-mcp-manager`(MCP 可视化管理,配 B 项 mcp-client)、`taxueseek/dsh-files`(上传+PDF/DOCX 抽取)、`bitxeno/dsh-github-picker`
- 记忆:`dsh-sgme`(65–96% 会话 token 节省,🌐 dsh-handbook ch.15)、`dsh-memory-plugin`(OpenViking RAG)
- 安全:`PerryLink/dsh-permission-rules`(声明式权限)、`dsh-vault`(AES-256-GCM+TOTP 凭据)、`Ri0n72Y/dsh-workspace-scope`(按工作区启停 Skill/MCP)
- 工作流:`HsiangNianian/dsh-auto-continue`(断网自续)、`Mombrane/dsh-subagent-monitor`、`vibeinging/dsh-agent-budget`
- 可观测:`dsh-observe`(OTel/Langfuse)、`SenmuuuuW/dsh-whale-report`(会话报告导出)
- 客户端形态:`s3yf1337/dsh-desktop`(Tauri)、`ZichengGurrr/dsh-window`(WebView2)、`jasondu/dsh-ui-mobile`(PWA)、`ccch1mneyyy/dsh-TUI`/`openma-ai/…-tui`(终端 UI)

**装前规程(🌐 dshdocs + atlascloud):** 先 `dsh-poison-guard` 扫描;版本 pin 到匹配 `dsh --version`(npm `latest` 可能落后 `next`);装/删后 `--dump-config` 查残留;插件代码跑在你的 Node 进程里、无沙箱 —— 兼容性实测"41 可用 vs 219 需注意",别裸装陌生包。

## D. 二次开发候选(fork 起点)

- `omdsh-dev/dsh-genui`、`pengyue-polaron/deepseek-harness-genui`(生成式 UI 框架)
- `DamonKoy/dsh-web-ui`(多插件家族聚合仓,含 taskboard/Git graph/皮肤)
- `PerryLink/dsh-permission-rules`(权限规则语法可扩展)
- `Electricitysheep/dsh-handbook` 的 `examples/plugin-template`(官方推荐起手模板,🌐 handbook)
- 配套:`PerryLink/dsh-test-drive`(隔离冒烟)、`dsh-score`(质量评分)、`zoahdev/dsh-readme-forge`(从 cordis.patch.yml 生成 README)

## E. 真正的自研空档(社区没填、官方仅 proposed)

官方 `.agents/notes/proposed/` 25 项(✅)与社区缺口(🌐 handbook ch.15 六缺口)交叉后,值得自己动手的:
1. **pre-tool-input-rewrite**(官方 proposed/feature 2026-06-30)— 工具入参改写层
2. **recallable-compaction**(proposed 2026-07-06)— 可召回的压缩
3. **interactive-side-sessions**(proposed 2026-07-08)/ **task-surface**(2026-08-04)
4. **评测闭环**(handbook 六缺口之一,社区 sandbox/评测类仅 ~9 个)— 结合 dsh-score 二开
5. **Windows 一等公民**修补类(Temp 沙箱崩溃 workaround、路径规范化 guard)— 痛点集中但补丁类插件稀缺

## F. 隐藏层(比插件更重要,🌐 atlascloud)

模型提供方配置(`llm-pi-ai` 行的 YAML)决定成本地板:同一 47.6K token 回合,托管平价端点 $0.0089 vs 官方峰时 $0.0315。先调 provider/endpoint,再谈插件。
