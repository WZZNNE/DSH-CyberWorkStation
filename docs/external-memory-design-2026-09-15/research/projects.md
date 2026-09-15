# 外置 AI 记忆系统：开源项目全景与选型

核对日期：**2026-09-15**。本报告覆盖 **42 条相关项目记录**：23 条核心记忆系统（含历史实现）、9 条框架与协议、7 条检索存储基座、2 条生命周期评测，以及 1 条同名模型架构辨析。它们不是 42 个功能相同、均适合直接部署的产品。

**结论：已有项目已经覆盖用户方案中的大量组合。** 外部持久化、结构化记忆、标签/作用域、混合检索、时态处理、可编辑文件、管理界面和跨会话接入均有明确先例。尤其应先对照 ReMe、EverOS、LongMemory、MemOS、Mem0、Hindsight 和 Engram，再决定自建范围。潜在增量应写成可验证的具体保障与使用体验，而不是宣称“外部数据库加记忆 agent”本身首次出现。

## 阅读方法与证据边界

- “已有能力”是对官方 README/文档的概括；“建议”是针对本项目的工程判断。**所有条目均未安装、未运行、未复现其 benchmark，也未完成源码或依赖审计。** README 出现某能力不等于已验证其实现正确。
- 对每条核对官方仓库及根 LICENSE 原文；对有独立文档、改名、迁移、SaaS 范围争议的条目补读相关官方资料。许可证结论只覆盖链接的仓库/版本范围，不自动覆盖第三方依赖、模型权重、资产或托管后端。
- JSON 保留 `checked_at`、实际取回时间、README/许可证据链接与文本 SHA-256。13 个现版仓库另固定 commit SHA；历史 OpenMemory 使用删除前的固定提交。其他分支链接会变化，不应将本报告日期与未来网页状态混用。
- “未归档”来自所列 GitHub 元数据，不代表功能持续开发或提供生产支持；最近推送也可能只是依赖更新。MELT、MemoryStackBench、Redis Agent Memory Server 及补充的 P38–P42 的机器可读归档字段未核对成功，已明确记录。
- `projects.json` 是同一调查的机器可读索引。本文不使用 star 数量或厂商榜单分数作为选型依据。

## 首轮选型：按要验证的问题挑基线

| 要验证的问题 | 优先候选 | 选择理由与边界 |
|---|---|---|
| 现有 DSH 的最短接入与可编辑共享记忆 | P38 ReMe | 已有 DSH 插件；先核对宿主版本，再测异步落盘、子 agent 覆盖与撤销 |
| 文件可读、手改后同步到 SQL/向量索引 | P10 EverOS | 与原构想最直接重合；先试修改、删除、并发和 watcher 故障 |
| 时态、来源、作用域与可解释取回 | P19 LongMemory | 当前文档已明确治理和证据选择；需要逐条验证保证 |
| 当前工作站的本地插件体验 | P05 MemOS；P18 Engram | 分别对照较完整插件与单二进制轻量路径 |
| 自动事实抽取及低上下文检索 | P02 Mem0；P06 Hindsight | 对照累积事实检索，以及 retain/recall/reflect 分离 |
| 原子分块与笔记组织 | P09 SimpleMem；P12 A-MEM | 用于抽取质量、来源保真和召回消融 |
| 时间关系和跨实体推理 | P03 Graphiti | 可选第二阶段图适配器，首版不必强制引入图服务 |
| 约束纠正、撤销、隔离与审计 | P35 MELT；P36 MemoryStackBench；P41 OpenClaw | 复用生命周期评测并对照宿主已有来源/删除机制，明确适配器是否代做操作 |
| 最小持久化基座 | P29 SQLite + FTS5 | 一个外置记忆服务拥有写入口；从真实事件和明确规则开始 |
| 多机器与多写者 | P30 PostgreSQL + pgvector | 共享服务与数据库事务；保留可重建检索投影 |

这是待实测的候选顺序，不是性能排名。首轮可以只跑 5–7 个最相关候选；其余保留为算法、接入或架构参照。

## 2026 版本变化：会直接影响设计判断

1. **Mem0 需分清 2025 论文和当前实现。** 当前 README 的流程已改为 ADD-only 事实积累，并结合语义、BM25、实体及时间信号检索；不能继续把早期 ADD/UPDATE/DELETE/NOOP 写成现版默认行为。README 也明确平台结果包含专有优化，不能据此给开源 SDK 承诺同样成绩。[当前固定版本 README](https://raw.githubusercontent.com/mem0ai/mem0/c7ee362aff94a369af70f13f2b4f853f6793ff4c/README.md)
2. **Letta 主实现已迁移。** 原 `letta-ai/letta` 主分支指向 Letta Code；V1 server 在历史分支。当前 MemFS、Git 上下文与宿主接入应按新仓库评估。[旧仓库迁移说明](https://github.com/letta-ai/letta)、[现版 Letta Code](https://github.com/letta-ai/letta-code)
3. **EverOS 与 LongMemory 是直接架构对照。** EverOS 当前采用可编辑 Markdown、SQLite 与 LanceDB；LongMemory 当前已有来源、时态事实、项目治理、证据解释与 token 上限。不能把这些能力整体列为市场空白。[EverOS 固定版本](https://raw.githubusercontent.com/EverMind-AI/EverOS/5076683ab88d714390573d8f88ff3c470e51129a/README.md)、[LongMemory 固定版本](https://raw.githubusercontent.com/CaviraOSS/LongMemory/4da4986d0069dbaa59d9209a84e2267749a67b3f/README.md)
4. **OpenMemory 至少有三个需分开的身份。** Mem0 旧子目录已经 sunset；新 `mem0ai/openmemory` 是会话迁移 CLI/TUI，实时 autosync 等仍列在路线图；原 CaviraOSS/OpenMemory 已改名 LongMemory，属于独立项目。[旧版 sunset 原文](https://raw.githubusercontent.com/mem0ai/mem0/553e2751126b240632967339723260fa30421615/openmemory/README.md)、[新迁移工具](https://github.com/mem0ai/openmemory)、[LongMemory](https://github.com/CaviraOSS/LongMemory)
5. **“SDK 开源”不能推出托管服务端开源。** Zep 当前公开仓库明确是示例和集成，旧 CE 已不支持；Graphiti 是可单独评估的开源引擎。Supermemory 官方现在宣称提供本地开源自托管，但本次仅闭环核实了公开仓库 MIT 许可，未确认完整本地引擎与公开源码、发布件的一一对应；因此既不能断言全部闭源，也不能宣称全部服务已可从源码重建。[Zep 范围](https://github.com/getzep/zep)、[Supermemory 本地与企业版差别](https://supermemory.ai/docs/self-hosting/local-vs-enterprise)
6. **许可与维护状态也在变化。** OpenViking 当前根许可是 AGPLv3；memU 的 Apache 声明与改写的 LICENSE.txt 需要进一步澄清；MCP 参考仓库有 Apache/MIT 贡献来源过渡和文档许可。GraphRAG 未归档但已进入维护模式；Redis Agent Memory Server 的现版说明把生产路径指向 Iris，旧实现定位为 V0 研究基础。具体证据见 P14、P15、P26、P28、P37。

7. **ReMe 已有现成 DSH 接入，OpenClaw 已有细化的来源与删除契约。** ReMe 官方插件覆盖指南注入、检索、自动捕获、后台整合和状态 UI；默认按已完成回合异步批量提交，且排除子 agent，因此不能直接据此承诺每事件耐久性。OpenClaw 的来源文档已讨论派生 lineage、禁止再次摄取、缓存清理和索引发布前复查，并明确删除边界。优先试装对照这些组件，仅在本产品关键生命周期测试不满足时补建控制层。[ReMe 固定 DSH 指南](https://raw.githubusercontent.com/agentscope-ai/ReMe/16269c9a76a094c8b58cb0523ed73504e33fe79f/integrations/dsh/README.md)、[OpenClaw 固定来源/删除文档](https://raw.githubusercontent.com/openclaw/openclaw/e00500a654295dac85d6a461f9e46c67e6bf5197/docs/concepts/memory-provenance.md)

## 逐项核对

以下各项均是文档/许可级核对。建议中的“采用”“试装”表示后续设计候选，**不表示已经替用户安装或完成运行验证**。

### P01 · Letta / Letta Code（MemGPT 演进项目）

[仓库](https://github.com/letta-ai/letta-code) · [文档](https://docs.letta.com/letta-code/memory) · [README/资料原文](https://raw.githubusercontent.com/letta-ai/letta-code/5bc853fd6fd69f00c115e320316fa4c0654a3dfb/README.md) · [许可原文](https://raw.githubusercontent.com/letta-ai/letta-code/5bc853fd6fd69f00c115e320316fa4c0654a3dfb/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0（代码）；LICENSE 明确排除品牌名称、标志、图像和 ASCII art 等资产。
- **已有能力：** 有状态 agent harness，记忆块、历史消息检索、跨会话身份和技能；MemFS 以 Git 跟踪上下文；支持子 agent、hooks 和本地 App Server。
- **与本项目的关系：** 适合作为完整 agent 产品和可编辑、可版本化上下文的对照。
- **局限与未证实：** 旧 letta-ai/letta 主分支已转为迁移说明；V1 server 在 archive 分支，不能混用 V1 文档判断现版行为；跨电脑 Cloud 功能和本地源码范围需分别评估；未验证项目约束撤销后的所有缓存传播。
- **选型建议：** 借鉴 MemFS、记忆可视化和固定上下文块；优先作为集成对照，避免为本项目整体替换现有 harness。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 7:54:35；活动源码已迁移至 letta-code；letta 原仓库未归档但 V1 实现已退役。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:29。
- **固定版本：** `5bc853fd6fd69f00c115e320316fa4c0654a3dfb`。README 与 LICENSE 原文链接已固定到该提交。

### P02 · Mem0

[仓库](https://github.com/mem0ai/mem0) · [文档](https://docs.mem0.ai/open-source/overview) · [README/资料原文](https://raw.githubusercontent.com/mem0ai/mem0/c7ee362aff94a369af70f13f2b4f853f6793ff4c/README.md) · [许可原文](https://raw.githubusercontent.com/mem0ai/mem0/c7ee362aff94a369af70f13f2b4f853f6793ff4c/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** 提取对话事实，按 user/session/agent 组织；提供库、自托管服务和托管平台；当前 README 的 2026 新流程为 ADD-only 提取、实体关联及向量/BM25/实体多信号检索。
- **与本项目的关系：** 最重要的事实提取与检索比较基线；可避免从零写各模型/向量库适配。
- **局限与未证实：** 2025 论文的 ADD/UPDATE/DELETE/NOOP 与 2026 当前主分支流程必须分版本描述；README 明示榜单包含平台专有优化，不等于开源 SDK 的成绩；agent 输出等权入库并不适合直接作为用户约束权威。
- **选型建议：** 纳入优先基线；可采用适配和提取组件，约束生效/撤销由独立规则服务裁决。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/14 19:12:46。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:24。
- **固定版本：** `c7ee362aff94a369af70f13f2b4f853f6793ff4c`。README 与 LICENSE 原文链接已固定到该提交。

### P03 · Graphiti

[仓库](https://github.com/getzep/graphiti) · [文档](https://github.com/getzep/graphiti) · [README/资料原文](https://raw.githubusercontent.com/getzep/graphiti/main/README.md) · [许可原文](https://raw.githubusercontent.com/getzep/graphiti/main/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** 从原始 episodes 建立可追溯的实体和事实关系；事实有效时间及历史失效管理；语义、关键词、图遍历混合检索。
- **与本项目的关系：** 适合判断同一事实在不同时间是否成立，以及从检索结果追溯证据。
- **局限与未证实：** 独立图基座与模型处理增加运行和写入成本；事实 invalidation 不等于所有原文、摘要、索引、备份的彻底删除；跨存储撤销需要额外验证。
- **选型建议：** 作为时间语义/关系推理基线或第二阶段可选适配器；首版不必强制上图数据库。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/11 20:16:31。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:23。

### P04 · Cognee

[仓库](https://github.com/topoteretes/cognee) · [文档](https://docs.cognee.ai/core-concepts/architecture) · [README/资料原文](https://raw.githubusercontent.com/topoteretes/cognee/main/README.md) · [许可原文](https://raw.githubusercontent.com/topoteretes/cognee/main/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** 文档、代码、会话转为实体、关系和可检索片段；remember/recall/improve/forget 接口，session 缓存与后台图记忆衔接。
- **与本项目的关系：** 与项目知识、代码依赖、会话经验整理有关，适合多源知识整合。
- **局限与未证实：** Cloud 与自托管范围不同；模型和图加工成本需计入；未实测手工修改、会话蒸馏和异步入图并发时的版本一致性。
- **选型建议：** 作为多源图记忆基线，借鉴 ingest/recall 分离及 session 到长期记忆的审核入口。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 12:33:55。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:24。

### P05 · MemOS（MemTensor）

[仓库](https://github.com/MemTensor/MemOS) · [文档](https://github.com/MemTensor/MemOS) · [README/资料原文](https://raw.githubusercontent.com/MemTensor/MemOS/de8069428a9247bfa7a3d35f59a9b39fa8f231d2/README.md) · [许可原文](https://raw.githubusercontent.com/MemTensor/MemOS/de8069428a9247bfa7a3d35f59a9b39fa8f231d2/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** Memory Cube 组织、隔离和组合知识库；编辑、删除、自然语言反馈；本地插件使用 SQLite、FTS5+向量、技能演化和 Memory Viewer；另有自托管/Cloud。
- **与本项目的关系：** 直接覆盖用户的多 agent、项目隔离、可编辑记忆和当前 DSH 工作流。
- **局限与未证实：** 完整自托管方案与本地插件底层不同，前者要求的外部服务不能强加给后者；README 的隔离/并发宣称未做安全与一致性实测；图反馈不等于明确约束覆盖协议。
- **选型建议：** 优先试装候选之一；对照本地插件的最小体验和 Cube 作用域管理。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/9 12:54:27。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:26。
- **固定版本：** `de8069428a9247bfa7a3d35f59a9b39fa8f231d2`。README 与 LICENSE 原文链接已固定到该提交。

### P06 · Hindsight

[仓库](https://github.com/vectorize-io/hindsight) · [文档](https://hindsight.vectorize.io/) · [README/资料原文](https://raw.githubusercontent.com/vectorize-io/hindsight/main/README.md) · [许可原文](https://raw.githubusercontent.com/vectorize-io/hindsight/main/LICENSE)

- **类别/许可：** 核心记忆系统；MIT。
- **已有能力：** retain/recall/reflect 三类操作，按 bank 管理记忆；提供 observations、mental models、MCP、控制界面及本地/服务/Cloud 接入。
- **与本项目的关系：** 可对照辅助模型整理、综合判断与事实检索的分工。
- **局限与未证实：** 一般部署需要数据库和模型配置；嵌入开发模式与生产外部 PostgreSQL 的建议不同；反思生成结论仍应标注为推断；未验证用户撤销对已派生 mental models 的完整影响。
- **选型建议：** 优先完整产品基线；借鉴 retain 与 reflect 分离，不把反思结论提升为用户授权。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 12:39:19。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:24。

### P07 · MemMachine

[仓库](https://github.com/MemMachine/MemMachine) · [文档](https://docs.memmachine.ai/getting_started/quickstart) · [README/资料原文](https://raw.githubusercontent.com/MemMachine/MemMachine/main/README.md) · [许可原文](https://raw.githubusercontent.com/MemMachine/MemMachine/main/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** episodic 图记忆、SQL profile 记忆和 working memory 分层；API/SDK/MCP；org/project/group/agent/user/session 多维上下文。
- **与本项目的关系：** 高度符合 SQL 管理结构信息、长短期分层与跨会话持久化。
- **局限与未证实：** 客户端示例依赖运行中的服务，不能把安装 SDK 当作已持久化；图和 SQL 双存储的一致性、权威优先级与撤销传播未实测。
- **选型建议：** 纳入分层记忆基线；借鉴事件原文与 profile 分开。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 6:22:04。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:24。

### P08 · Memobase

[仓库](https://github.com/memodb-io/memobase) · [文档](https://github.com/memodb-io/memobase) · [README/资料原文](https://raw.githubusercontent.com/memodb-io/memobase/main/readme.md) · [许可原文](https://raw.githubusercontent.com/memodb-io/memobase/main/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** 可配置用户画像与用户事件时间线；缓冲会话批量处理，通过 API 组装用户相关上下文。
- **与本项目的关系：** 适合用户偏好、个人事实和画像类长期记忆。
- **局限与未证实：** README 明确重点为用户画像而非通用 agent 经验；后台缓冲可能引入新鲜度延迟；仓库未归档，但最后推送较早且 README 导流 Acontext；不能由未归档推断积极维护。
- **选型建议：** 用户偏好基线；不单独承担项目规则、任务工作状态和多 agent 权限。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/1/11 3:51:40；GitHub 记录 pushed_at 为 2026-01-11；README 宣传新项目 Acontext。此处仅记录观测，不推断弃用。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:25。

### P09 · SimpleMem / Omni-SimpleMem / EvolveMem

[仓库](https://github.com/aiming-lab/SimpleMem) · [文档](https://github.com/aiming-lab/SimpleMem/blob/main/docs/PACKAGE_USAGE.md) · [README/资料原文](https://raw.githubusercontent.com/aiming-lab/SimpleMem/main/README.md) · [许可原文](https://raw.githubusercontent.com/aiming-lab/SimpleMem/main/LICENSE)

- **类别/许可：** 核心记忆系统；MIT。
- **已有能力：** 从对话生成结构化原子记忆，再索引和检索；当前统一 Python 包包含文本/多模态后端以及离线检索优化入口。
- **与本项目的关系：** 直接对应语义单元切分、元数据索引、查询意图与 token 控制。
- **局限与未证实：** semantic lossless 是项目表述，不能解释为信息理论上的无损或任意约束都保真；文本 MCP 与完整多模态 Python 能力不同；自动优化必须用独立开发集。
- **选型建议：** 优先语义切块/压缩基线，保留原文证据；首版不自动演化线上检索配置。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/7/24 7:40:38。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:25。

### P10 · EverOS（原 EverMemOS）

[仓库](https://github.com/EverMind-AI/EverOS) · [文档](https://docs.evermind.ai) · [README/资料原文](https://raw.githubusercontent.com/EverMind-AI/EverOS/5076683ab88d714390573d8f88ff3c470e51129a/README.md) · [许可原文](https://raw.githubusercontent.com/EverMind-AI/EverOS/5076683ab88d714390573d8f88ff3c470e51129a/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** 可读可编辑 Markdown 为源，SQLite 与 LanceDB 为索引；文件 watcher 级联同步；user/agent/app/project/session 检索维度；用户画像、案例、skills、wiki、离线反思。
- **与本项目的关系：** 是与用户“可编辑文件+SQL+向量+跨任务”方案最直接重叠的候选。
- **局限与未证实：** 现版与旧 EverMemOS 的 MongoDB/Elasticsearch/Redis 服务栈不同，需锁定版本；直接编辑文件的并发冲突、watcher 失败、删除再派生及实时落盘保证尚未实测。
- **选型建议：** 优先试装与架构对照；必须先验证修改/删除/崩溃恢复链路，再决定复用程度。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/9 2:59:13；官方旧仓库地址重定向 EverMind-AI/EverOS，现 README 描述本地 Markdown+SQLite+LanceDB 架构。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:26。
- **固定版本：** `5076683ab88d714390573d8f88ff3c470e51129a`。README 与 LICENSE 原文链接已固定到该提交。
- **别名/旧地址：** EverMind-AI/EverMemOS。

### P11 · MemoryBank / SiliconFriend

[仓库](https://github.com/zhongwanjun/MemoryBank-SiliconFriend) · [文档](https://github.com/zhongwanjun/MemoryBank-SiliconFriend) · [README/资料原文](https://raw.githubusercontent.com/zhongwanjun/MemoryBank-SiliconFriend/main/README.md) · [许可原文](https://raw.githubusercontent.com/zhongwanjun/MemoryBank-SiliconFriend/main/LICENSE)

- **类别/许可：** 核心记忆系统；MIT。
- **已有能力：** 按重要性与时间进行记忆遗忘/强化；回顾会话形成事件摘要与用户人格信息，附中英实验和聊天演示。
- **与本项目的关系：** 对应用户提出的记忆退化机制。
- **局限与未证实：** 参考实现最后推送为 2023 年，依赖和模型样例需适配；遗忘曲线适合软偏好或检索优先级，不适合自动使禁止项/明确承诺失效；代码许可不覆盖所有基础模型权重。
- **选型建议：** 作为历史算法基线和遗忘策略消融，首版禁止对有效硬约束应用衰减。
- **维护观测：** GitHub API 核对未归档；最后推送 2023/5/24 3:19:27；未归档；GitHub pushed_at 为 2023-05-24，按历史研究实现处理。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:28。

### P12 · A-MEM

[仓库](https://github.com/agiresearch/A-mem) · [文档](https://github.com/agiresearch/A-mem) · [README/资料原文](https://raw.githubusercontent.com/agiresearch/A-mem/main/README.md) · [许可原文](https://raw.githubusercontent.com/agiresearch/A-mem/main/LICENSE)

- **类别/许可：** 核心记忆系统；MIT。
- **已有能力：** 生成包含标签、关键词、时间戳及上下文描述的笔记；通过语义关联建立链接，更新相关历史笔记；支持记忆 CRUD。
- **与本项目的关系：** 是用户“辅助模型分块打标、更新关联记忆”的直接研究先例。
- **局限与未证实：** 系统实现与论文复现实验仓库是两个仓库；动态演化可能改动历史表达；未验证强来源权威、权限或多写者一致性。
- **选型建议：** 结构化记忆与链接算法基线；保留不可变源事件，再评估可变派生笔记。
- **维护观测：** GitHub API 核对未归档；最后推送 2025/12/12 21:15:29。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:25。

### P13 · MemoryOS（BAI-LAB）

[仓库](https://github.com/BAI-LAB/MemoryOS) · [文档](https://bai-lab.github.io/MemoryOS/docs) · [README/资料原文](https://raw.githubusercontent.com/BAI-LAB/MemoryOS/main/README.md) · [许可原文](https://raw.githubusercontent.com/BAI-LAB/MemoryOS/main/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** 短期、中期、长期个人记忆分层；存储、更新、检索、生成模块；MCP、Playground 和 Chroma 变体。
- **与本项目的关系：** 适合研究长期偏好留存与短期会话迁移。
- **局限与未证实：** 与 MemTensor/MemOS 无关，名字相似不能互换文档；多个实现入口的状态和支持可能不同；未验证项目粒度权限及删除语义。
- **选型建议：** 分层/晋升策略研究基线；避免直接把个人记忆流程当团队规则服务。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/7/7 12:32:18。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:26。

### P14 · memU

[仓库](https://github.com/NevaMind-AI/memU) · [文档](https://github.com/NevaMind-AI/memU) · [README/资料原文](https://raw.githubusercontent.com/NevaMind-AI/memU/08e1ed4cdf4c0cb1fe5387e4a532ea588a8cbe46/README.md) · [许可原文](https://raw.githubusercontent.com/NevaMind-AI/memU/08e1ed4cdf4c0cb1fe5387e4a532ea588a8cbe46/LICENSE.txt)

- **类别/许可：** 核心记忆系统；Apache-2.0 声明；LICENSE.txt 为改写文本，标准许可一致性未核实（GitHub NOASSERTION）。
- **已有能力：** 主 agent 从会话历史准备并提交可读 memory/skill Markdown；服务负责存储、embedding 和检索；多个编码助手 host adapter；本地 SQLite/PostgreSQL 与 Cloud 模式。
- **与本项目的关系：** 高度对应跨 agent 的个人 wiki、可复用技能和外部统一存储。
- **局限与未证实：** README 宣称 Apache-2.0，但 LICENSE.txt 有改写且 GitHub 标为 NOASSERTION，标准许可证一致性未核实；依赖日志桥接与 host 指令注入，支持范围随宿主变化；不代表任何网页聊天均可接入。
- **选型建议：** 借鉴 prepare→agent→commit 与渐进取回；正式直接复用前先澄清 LICENSE.txt 的许可标识。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/14 8:30:50。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:27。
- **固定版本：** `08e1ed4cdf4c0cb1fe5387e4a532ea588a8cbe46`。README 与 LICENSE 原文链接已固定到该提交。

### P15 · OpenViking

[仓库](https://github.com/volcengine/OpenViking) · [文档](https://docs.openviking.ai/en/concepts/01-architecture) · [README/资料原文](https://raw.githubusercontent.com/volcengine/OpenViking/main/README.md) · [许可原文](https://raw.githubusercontent.com/volcengine/OpenViking/main/LICENSE)

- **类别/许可：** 核心记忆系统；AGPL-3.0（当前根 LICENSE，未进一步推断 only/or-later）。
- **已有能力：** viking:// 虚拟文件系统统一 resources、memories、skills；L0摘要/L1概览/L2原文逐级加载；目录内检索与会话提交后后台记忆提取。
- **与本项目的关系：** 直接对应“先读简介再读完整上下文”和可浏览记忆组织。
- **局限与未证实：** 当前根 LICENSE 为 AGPLv3，旧资料可能列出其他许可，采用时需按具体版本核对；提交会话后的后台提取不保证当前回合已经完成索引；虚拟路径本身不等于权限验证。
- **选型建议：** 优先对照渐进加载/可浏览目录方案；需要闭源分发集成时先核对具体许可要求。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 12:36:59。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:26。

### P16 · Memento

[仓库](https://github.com/Memento-Teams/Memento) · [文档](https://github.com/Memento-Teams/Memento) · [README/资料原文](https://raw.githubusercontent.com/Memento-Teams/Memento/main/README.md) · [许可原文](https://raw.githubusercontent.com/Memento-Teams/Memento/main/LICENSE)

- **类别/许可：** 核心记忆系统；MIT。
- **已有能力：** planner/executor 与 Case Bank；复用成功及失败经验；非参数/参数化案例选择策略，MCP 工具执行；不更新主 LLM 权重。
- **与本项目的关系：** 对应从多 agent 任务轨迹中复用方法和避坑经验。
- **局限与未证实：** 重点是任务经验而非用户事实与约束生命周期；完整执行环境及实验依赖较多；部分参数化案例选择需要额外训练/推理配置。
- **选型建议：** 案例/技能层研究基线，首版借鉴 task→action→outcome 记录结构。
- **维护观测：** GitHub API 核对未归档；最后推送 2025/10/5 14:34:18；旧组织地址重定向 Memento-Teams/Memento；最后推送 2025-10-05，研究实现按锁定版本复现。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:27。
- **别名/旧地址：** Agent-on-the-Fly/Memento。

### P17 · claude-mem（当前 README 品牌为 Grok Mem）

[仓库](https://github.com/thedotmack/claude-mem) · [文档](https://docs.claude-mem.ai/) · [README/资料原文](https://raw.githubusercontent.com/thedotmack/claude-mem/main/README.md) · [许可原文](https://raw.githubusercontent.com/thedotmack/claude-mem/main/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0（当前根 LICENSE）；托管 observer/CMEM Pro 不由该文件授予服务端源码权利。
- **已有能力：** 宿主 hooks 或日志观察收集工作记录；渐进检索和上下文注入；本地 worker、SQLite/FTS5、Web Viewer 和观察记录引用；可选择托管 observer。
- **与本项目的关系：** 适合可视化记忆、编码助手接入和渐进披露体验。
- **局限与未证实：** 宿主是否有 hooks 影响实时性；捕获记录并非隐含的内部思考状态；当前品牌、安装默认及许可已变化；root Apache-2.0 不自动覆盖托管 observer/CMEM Pro 服务。
- **选型建议：** UX 与接入基线；本地/托管模式明确区分，首版优先借鉴可见引用与预览→详情检索。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/13 9:42:20。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:26。

### P18 · Engram（Gentleman-Programming，agent 记忆）

[仓库](https://github.com/Gentleman-Programming/engram) · [文档](https://github.com/Gentleman-Programming/engram/blob/main/DOCS.md) · [README/资料原文](https://raw.githubusercontent.com/Gentleman-Programming/engram/main/README.md) · [许可原文](https://raw.githubusercontent.com/Gentleman-Programming/engram/main/LICENSE)

- **类别/许可：** 核心记忆系统；MIT。
- **已有能力：** Go 单二进制、SQLite+FTS5，CLI/HTTP/MCP/TUI；稳定 topic_key 更新主题，按 search→timeline→完整 observation 渐进取回，保存 session handoff。
- **与本项目的关系：** 非常适合做用户想要的本地、直观、低依赖 MVP 对照。
- **局限与未证实：** 不是 DeepSeek Engram 模型模块；保存质量依赖宿主按协议写入；全文搜索不能单独保证同义中文意图召回或复杂时态推理。
- **选型建议：** 优先轻量可用性基线；借鉴稳定主题键、项目确认、检索预览与完整证据分离。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 9:31:09。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:27。

### P19 · LongMemory（原 CaviraOSS/OpenMemory）

[仓库](https://github.com/CaviraOSS/LongMemory) · [文档](https://github.com/CaviraOSS/LongMemory) · [README/资料原文](https://raw.githubusercontent.com/CaviraOSS/LongMemory/4da4986d0069dbaa59d9209a84e2267749a67b3f/README.md) · [许可原文](https://raw.githubusercontent.com/CaviraOSS/LongMemory/4da4986d0069dbaa59d9209a84e2267749a67b3f/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** 本地 SQLite 持久化，不可变内容、来源和时态事实；可解释证据选择、token 上限、project governance，API/MCP/dashboard/VS Code 多入口。
- **与本项目的关系：** 与用户当前构想在存储、来源、范围及可解释检索上高度重叠。
- **局限与未证实：** 旧 OpenMemory SDK/文档不能默认与现 LongMemory API 兼容；README 明示的治理能力需要故障注入/越权/撤销实测；Python 包只是 HTTP 客户端，主引擎在 TypeScript 服务。
- **选型建议：** 优先治理类对照；检验其已满足哪些需求后，才决定自建哪些控制功能。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/14 12:02:21；原仓库重定向 LongMemory；已核对现版 README 和 Apache LICENSE。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:25。
- **固定版本：** `4da4986d0069dbaa59d9209a84e2267749a67b3f`。README 与 LICENSE 原文链接已固定到该提交。
- **别名/旧地址：** CaviraOSS/OpenMemory。

### P20 · Supermemory

[仓库](https://github.com/supermemoryai/supermemory) · [文档](https://supermemory.ai/docs/self-hosting/overview) · [README/资料原文](https://raw.githubusercontent.com/supermemoryai/supermemory/2415a5c796d62c7ea9d709bc9337a6e1b6f6d837/README.md) · [许可原文](https://raw.githubusercontent.com/supermemoryai/supermemory/2415a5c796d62c7ea9d709bc9337a6e1b6f6d837/LICENSE)

- **类别/许可：** 核心记忆系统；MIT（已核实公开仓库代码）；本地引擎完整对应源码/发布件许可范围未完成核实。
- **已有能力：** 官方文档提供本地二进制、用户 profile、时态事实与混合检索；公开仓库含 Web/MCP/集成代码；本地及平台具有 API 兼容入口。
- **与本项目的关系：** 适合作为零配置体验、用户画像和统一检索 API 的产品基线。
- **局限与未证实：** 已核实公开仓库 MIT；本地完整引擎对应源码/发布件许可范围尚未闭环核实，不将官方 open source 宣传等价为已验证可从源码重建全部服务；本地单组织单 API key；连接器、组织权限及专有提取模型属平台/Enterprise，不能套用平台分数推断本地效果。
- **选型建议：** 可以保留产品/API对照；在本地引擎源码与许可范围核清前，不作为“全部可审计开源”的唯一核心依赖。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/14 18:02:22。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:25。
- **固定版本：** `2415a5c796d62c7ea9d709bc9337a6e1b6f6d837`。README 与 LICENSE 原文链接已固定到该提交。

### P21 · OpenMemory（mem0ai 新独立仓库，会话迁移）

[仓库](https://github.com/mem0ai/openmemory) · [文档](https://github.com/mem0ai/openmemory) · [README/资料原文](https://raw.githubusercontent.com/mem0ai/openmemory/main/README.md) · [许可原文](https://raw.githubusercontent.com/mem0ai/openmemory/main/LICENSE)

- **类别/许可：** 框架和协议；MIT。
- **已有能力：** TUI/CLI 发现、预览、选择并导入导出编码助手会话；当前 Beta 涵盖 Claude Code、Codex、OpenCode。
- **与本项目的关系：** 对跨宿主迁移会话和用户能看见正在迁移什么有用。
- **局限与未证实：** 这是会话迁移工具，不是旧 OpenMemory MCP 记忆服务；README 把实时 autosync、Skills/MCP/AGENTS.md 迁移列为 roadmap，不能当成已提供。
- **选型建议：** 借鉴迁移预览与宿主会话适配；不承担记忆语义处理或实时跨 agent 一致性。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/7/29 9:40:39。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:28。

### P22 · OpenMemory MCP（mem0 旧子目录，已 sunset）

[仓库](https://github.com/mem0ai/mem0/tree/553e2751126b240632967339723260fa30421615/openmemory) · [文档](https://github.com/mem0ai/mem0/blob/553e2751126b240632967339723260fa30421615/openmemory/README.md) · [README/资料原文](https://raw.githubusercontent.com/mem0ai/mem0/553e2751126b240632967339723260fa30421615/openmemory/README.md) · [许可原文](https://raw.githubusercontent.com/mem0ai/mem0/553e2751126b240632967339723260fa30421615/LICENSE)

- **类别/许可：** 核心记忆系统（历史）；Apache-2.0（对应历史提交根 LICENSE，子目录范围未做逐文件审计）。
- **已有能力：** 历史版本提供本地记忆 API、MCP 和可视化 UI；README 提供不同 LLM/embedding 服务配置。
- **与本项目的关系：** 能解释用户可能看到的 OpenMemory 旧教程，以及本地多客户端共享记忆设计。
- **局限与未证实：** 历史 README 明确 Sunsetting，建议改用 Mem0 self-hosted server；2026-07-29 从主仓库删除；旧 main/openmemory 安装路径失效，不应给用户作为当前快速开始。
- **选型建议：** 只作历史参照；新部署使用现版 Mem0 自托管或其他候选。
- **维护观测：** 未完成机器可读归档状态核对；历史提交 README 已声明 sunset；2026-07-29 删除主分支 openmemory 子目录。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；归档元数据未核实；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:51:31。
- **固定版本：** `553e2751126b240632967339723260fa30421615`。README 与 LICENSE 原文链接已固定到该提交。

### P23 · Zep SDK / examples（区分托管 Zep 与 Graphiti）

[仓库](https://github.com/getzep/zep-python) · [文档](https://help.getzep.com/sdks) · [README/资料原文](https://raw.githubusercontent.com/getzep/zep-python/main/README.md) · [许可原文](https://raw.githubusercontent.com/getzep/zep-python/main/LICENSE)

- **类别/许可：** 框架和协议；Apache-2.0（SDK/示例代码）；不覆盖 Zep Cloud 服务端。
- **已有能力：** 公开 Python 客户端与集成入口，访问 Zep Cloud/历史 CE 接口；getzep/zep 现为示例、框架集成与工具集合。
- **与本项目的关系：** 便于接入托管基线及理解 managed service 与开源引擎差别。
- **局限与未证实：** SDK 开源不代表 Zep Cloud 后端开源；getzep/zep README 明示其不是产品服务源码；legacy Community Edition 已不再支持，SDK README 的旧 CE 指南需谨慎。
- **选型建议：** 只作托管适配/评测入口；如要完全自托管的时序图引擎，评估 Graphiti。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/11 15:35:28；SDK 仓库未归档；Zep CE 的不再支持声明来自 getzep/zep 当前 README，不等于 SDK 仓库归档。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:23。

### P24 · LangGraph

[仓库](https://github.com/langchain-ai/langgraph) · [文档](https://docs.langchain.com/oss/python/langgraph/overview) · [README/资料原文](https://raw.githubusercontent.com/langchain-ai/langgraph/main/README.md) · [许可原文](https://raw.githubusercontent.com/langchain-ai/langgraph/main/LICENSE)

- **类别/许可：** 框架和协议；MIT。
- **已有能力：** 持久执行、checkpoint、暂停恢复和人工干预；区分 thread 工作状态与跨会话 store；支持长期运行/多步骤 agent。
- **与本项目的关系：** 适合在模型容器故障后恢复流程，承载幂等写入与任务状态机。
- **局限与未证实：** 框架不会替用户定义事实权威、约束优先级、撤销规则；持久化必须配置后端；云部署/LangSmith 与开源库范围不同。
- **选型建议：** 需要复杂 agent 工作流时采用；首版简单服务可不引入，用其持久执行思想设计恢复协议。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/14 19:45:22。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:24。

### P25 · LangMem

[仓库](https://github.com/langchain-ai/langmem) · [文档](https://langchain-ai.github.io/langmem/) · [README/资料原文](https://raw.githubusercontent.com/langchain-ai/langmem/main/README.md) · [许可原文](https://raw.githubusercontent.com/langchain-ai/langmem/main/LICENSE)

- **类别/许可：** 框架和协议；MIT。
- **已有能力：** 结构化记忆提取、管理和搜索工具；热路径/后台整合及提示更新原语；可接任意存储，也可接 LangGraph Store。
- **与本项目的关系：** 适合作为可插拔抽取器/记忆工作流组件而非重造所有基础能力。
- **局限与未证实：** README 的 InMemoryStore 示例重启会丢失；持久服务应选数据库 Store；提示自动优化和语义合并不应直接修改已批准项目规则。
- **选型建议：** 优先抽取管线基线；将输出作为候选变更，由独立验证器提交。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/9 6:44:43。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:24。

### P26 · MCP Knowledge Graph Memory 参考服务

[仓库](https://github.com/modelcontextprotocol/servers) · [文档](https://github.com/modelcontextprotocol/servers/blob/main/src/memory/README.md) · [README/资料原文](https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/memory/README.md) · [许可原文](https://raw.githubusercontent.com/modelcontextprotocol/servers/main/LICENSE)

- **类别/许可：** 框架和协议；Apache-2.0 / MIT 按贡献来源过渡；文档 CC-BY-4.0（根 LICENSE 明示）。
- **已有能力：** 以实体、关系、原子 observations 保存本地知识图谱；提供创建、删除、search_nodes、open_nodes 与可读资源，接入 MCP 客户端。
- **与本项目的关系：** 是最小可互操作外部记忆工具面和基本 CRUD 基线。
- **局限与未证实：** 参考实现不是完整语义记忆平台；未验证服务器端租户权限/时态约束策略；MCP 只规定工具通信，不提供全局记忆真实性与一致性；当前 LICENSE 处于过渡。
- **选型建议：** 采用 MCP 作为接入协议，参考原子 observation 和工具 schema；不直接把参考服务器当生产治理层。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/3 1:42:26。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:51:31。

### P27 · LlamaIndex OSS

[仓库](https://github.com/run-llama/llama_index) · [文档](https://developers.llamaindex.ai/python/framework/) · [README/资料原文](https://raw.githubusercontent.com/run-llama/llama_index/main/README.md) · [许可原文](https://raw.githubusercontent.com/run-llama/llama_index/main/LICENSE)

- **类别/许可：** 框架和协议；MIT。
- **已有能力：** 文档摄取、分块、索引、检索与 agent 编排组件；core 与独立集成包可组合模型、embedding 和向量存储。
- **与本项目的关系：** 适合处理文档格式、检索流程和 parent/child 内容组织。
- **局限与未证实：** OSS 框架与 LlamaParse/LlamaCloud 付费服务不同；README 明示公司重心转向文档解析；开源框架仍提供，不应误写成已归档。
- **选型建议：** 按需采用文档接入/检索组件；用户规则数据模型和事务控制自行维护。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 1:48:43。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:27。

### P28 · Microsoft GraphRAG

[仓库](https://github.com/microsoft/graphrag) · [文档](https://microsoft.github.io/graphrag) · [README/资料原文](https://raw.githubusercontent.com/microsoft/graphrag/main/README.md) · [许可原文](https://raw.githubusercontent.com/microsoft/graphrag/main/LICENSE)

- **类别/许可：** 框架和协议；MIT。
- **已有能力：** 从语料提取图结构、组织社区和相关上下文用于问答；提供图驱动语料检索/摘要的研究管线。
- **与本项目的关系：** 适用于跨文档全局主题和关系问答，对普通对话规则只属中等相关。
- **局限与未证实：** 当前 README 明确 maintenance mode，不再接受新功能PR，仍做适当修复/依赖更新；官方明确索引可能昂贵，且为研究演示而非正式支持产品；不是实时约束服务。
- **选型建议：** 保留全局知识问答研究基线；首版不作为核心在线记忆引擎。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/14 7:35:41；GitHub 未归档，但 README 明示 maintenance mode、无新功能；不能仅依据近期推送称积极扩展。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:27。

### P29 · SQLite（含 FTS5/关系元数据基座）

[仓库](https://sqlite.org/src) · [文档](https://sqlite.org/docs.html) · [README/资料原文](https://sqlite.org/fts5.html) · [许可原文](https://sqlite.org/copyright.html)

- **类别/许可：** 检索与存储基座；Public domain（交付的 SQLite 代码与文档；部分构建脚本另有许可证）。
- **已有能力：** 本地单文件事务型数据库，适合事件、版本、标签和当前有效状态；可用全文索引做关键词召回，服务层把多个查询组合成小型上下文包。
- **与本项目的关系：** 最适合本地易用首版的权威状态存储。
- **局限与未证实：** 同一数据库同时只有一个写者；不应让多容器直接在网络文件系统共写数据库文件；数据库持久化不等于向量/文件投影同步；备份需使用一致性备份方法并正确处理 WAL。
- **选型建议：** 首版采用：单记忆服务持有SQLite写入口；规模/写并发增长后迁移PostgreSQL。
- **维护观测：** 未完成机器可读归档状态核对；官方仍维护；本条未取 Fossil 提交 SHA，不据此提供版本支持承诺。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；归档元数据未核实；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:54:46。

### P30 · PostgreSQL + pgvector

[仓库](https://github.com/pgvector/pgvector) · [文档](https://github.com/pgvector/pgvector) · [README/资料原文](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md) · [许可原文](https://raw.githubusercontent.com/pgvector/pgvector/master/LICENSE)

- **类别/许可：** 检索与存储基座；PostgreSQL License（pgvector 根 LICENSE 原文；GitHub 自动识别 NOASSERTION）。
- **已有能力：** 在 PostgreSQL 行中存向量，支持精确/近似邻近查询；可与SQL过滤、JOIN、事务、备份和数据库权限结合。
- **与本项目的关系：** 可把内容、状态、标签和embedding放在同一事务域，降低多库指针失配复杂度。
- **局限与未证实：** 近似索引有召回/速度取舍，过滤后的候选量仍需测试；不负责语义切块或规则冲突；选 PostgreSQL 不会自动产生正确行级权限策略。
- **选型建议：** 团队/多写者阶段优先采用；把向量字段视作可重建投影。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/10 13:49:14。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:27。

### P31 · Qdrant

[仓库](https://github.com/qdrant/qdrant) · [文档](https://qdrant.tech/documentation/) · [README/资料原文](https://raw.githubusercontent.com/qdrant/qdrant/master/README.md) · [许可原文](https://raw.githubusercontent.com/qdrant/qdrant/master/LICENSE)

- **类别/许可：** 检索与存储基座；Apache-2.0。
- **已有能力：** 向量 points 与 metadata payload，过滤检索和 API；可自托管服务；另有 Cloud 与 Edge 形态。
- **与本项目的关系：** 适用于需要独立向量服务、标签预过滤和较大规模召回。
- **局限与未证实：** 根仓库许可不自动覆盖所有云/Edge商业形态；SQL权威状态与外部向量库双写时，需 outbox、版本过滤、删除确认和重建机制。
- **选型建议：** 当单库向量方案不够时选用；仅存检索投影，不以向量库决定有效约束。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 12:03:10。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:27。

### P32 · Chroma

[仓库](https://github.com/chroma-core/chroma) · [文档](https://docs.trychroma.com) · [README/资料原文](https://raw.githubusercontent.com/chroma-core/chroma/main/README.md) · [许可原文](https://raw.githubusercontent.com/chroma-core/chroma/main/LICENSE)

- **类别/许可：** 检索与存储基座；Apache-2.0。
- **已有能力：** 文档、metadata 和 embedding 的 collection API；提供增删改、相似检索、metadata/文档内容过滤及本地/服务形态。
- **与本项目的关系：** 接入容易，适合向量召回原型与 A-MEM 类基线。
- **局限与未证实：** README 最小 Client 示例是内存形态，持久化需配置；Cloud 的无服务器混合检索表述不直接证明本地版本同功能；没有用户约束治理语义。
- **选型建议：** 作为轻量向量适配/基线；生产持久、访问控制与索引删除单独验证。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 7:28:54。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:27。

### P33 · LanceDB

[仓库](https://github.com/lancedb/lancedb) · [文档](https://docs.lancedb.com) · [README/资料原文](https://raw.githubusercontent.com/lancedb/lancedb/main/README.md) · [许可原文](https://raw.githubusercontent.com/lancedb/lancedb/main/LICENSE)

- **类别/许可：** 检索与存储基座；Apache-2.0。
- **已有能力：** 基于 Lance 列式格式的本地/云向量与多模态存储；支持向量、全文、SQL和metadata过滤，数据版本管理。
- **与本项目的关系：** 适合本地大文件/多模态及可重建检索索引，与 EverOS 选型相关。
- **局限与未证实：** 表版本管理并不自动等价于用户规则版本/撤销语义；外部SQL权威记录与LanceDB投影一致性需要应用协议；Cloud/Enterprise能力需分开。
- **选型建议：** 本地向量后端候选，先与 SQLite FTS 和 pgvector 对照成本及删除恢复行为。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/9/15 12:40:48。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:28。

### P34 · Engram（DeepSeek，模型条件记忆）

[仓库](https://github.com/deepseek-ai/Engram) · [文档](https://github.com/deepseek-ai/Engram) · [README/资料原文](https://raw.githubusercontent.com/deepseek-ai/Engram/main/README.md) · [许可原文](https://raw.githubusercontent.com/deepseek-ai/Engram/main/LICENSE)

- **类别/许可：** 边界澄清：模型架构；Apache-2.0（当前仓库 LICENSE；演示代码，未核实完整模型权重发布）。
- **已有能力：** 通过静态 N-gram 记忆查表与动态隐状态融合，为模型提供条件记忆；官方仓库提供核心数据流演示；与 MoE 条件计算作对照。
- **与本项目的关系：** 只用于澄清用户 MoE 类比，与外部用户可编辑数据库不是同一层。
- **局限与未证实：** 官方明确演示代码模拟 Attention/MoE/mHC 等标准组件，不能当完整可部署模型；不提供项目级 CRUD、标签权限、来源撤销或跨任务事件存储。
- **选型建议：** 不作为此项目依赖或记忆服务基线；在术语章节区分参数/架构内记忆与外部状态服务。
- **维护观测：** GitHub API 核对未归档；最后推送 2026/1/14 1:13:02。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文、GitHub 元数据核对；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:28。

### P35 · MELT（Memory Evaluation for Lifecycle Testing）

[仓库](https://github.com/shisa-ai/MELT) · [文档](https://github.com/shisa-ai/MELT) · [README/资料原文](https://raw.githubusercontent.com/shisa-ai/MELT/47c819f417b0d81a57f781ec54d8a5cf84e0c833/README.md) · [许可原文](https://raw.githubusercontent.com/shisa-ai/MELT/47c819f417b0d81a57f781ec54d8a5cf84e0c833/LICENSE)

- **类别/许可：** 生命周期评测；Apache-2.0。
- **已有能力：** 评测写入、纠正、矛盾、时态、项目隔离、来源、衰减、撤销和拒答；SUT 适配协议；冻结 suite/scorer/比较键，支持 checkpoint 和严格报告元数据。
- **与本项目的关系：** 直接覆盖用户真正关心的记忆生命周期，优先于只测问答回忆率。
- **局限与未证实：** 官方称 early release，语料及适配器仍在发展；不同 suite/scorer/比较键不可混作同榜；能力不支持应标 not_supported，不应由适配器代做后虚报。
- **选型建议：** 作为首要生命周期评测框架，增加本产品特有的并发编辑、容器崩溃和撤销传播测试。
- **维护观测：** 未完成机器可读归档状态核对；官方页面未见归档提示；GitHub API 配额耗尽，未核对机器可读归档字段/最后推送日期。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；归档元数据未核实；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:29。
- **固定版本：** `47c819f417b0d81a57f781ec54d8a5cf84e0c833`。README 与 LICENSE 原文链接已固定到该提交。

### P36 · MemoryStackBench

[仓库](https://github.com/aetna000/MemoryStackBench) · [文档](https://github.com/aetna000/MemoryStackBench) · [README/资料原文](https://raw.githubusercontent.com/aetna000/MemoryStackBench/main/README.md) · [许可原文](https://raw.githubusercontent.com/aetna000/MemoryStackBench/main/LICENSE)

- **类别/许可：** 生命周期评测；Apache-2.0。
- **已有能力：** plant→interfere→probe 多会话场景与统一 adapter；记录转录、记忆快照、检索证据、删除行为和独立可审计性矩阵。
- **与本项目的关系：** 可检查记忆污染、删除残留、原始来源和适配器对结果的影响。
- **局限与未证实：** 当前 seven_sins_v0_1 为少量场景/断言，不能把通过率推广为一般安全保证；官方明确部分分数来自带显式写入/更新/删除策略的 store harness，不是各产品所有自动抽取路径。
- **选型建议：** 作为第二生命周期/审计评测；同时报告原生系统与加控制层后的结果，透明记录适配器代做哪些工作。
- **维护观测：** 未完成机器可读归档状态核对；官方页面未见归档提示；GitHub API 配额耗尽，未核对机器可读归档字段/最后推送日期。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；归档元数据未核实；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:28。

### P37 · Redis Agent Memory Server（V0 研究实现）

[仓库](https://github.com/redis/agent-memory-server) · [文档](https://github.com/redis/agent-memory-server/tree/main/V0) · [README/资料原文](https://raw.githubusercontent.com/redis/agent-memory-server/main/README.md) · [许可原文](https://raw.githubusercontent.com/redis/agent-memory-server/main/LICENSE)

- **类别/许可：** 核心记忆系统（历史/研究）；Apache-2.0（本参考实现）；Redis 数据库版本/托管 Iris 的许可和服务条款另核。
- **已有能力：** V0 提供 REST/MCP、working/long-term memory 和可配置提取策略；Redis 支持语义检索；现产品 Iris 提供托管记忆路径。
- **与本项目的关系：** 适合作为短期状态、后台记忆晋升与 TTL 策略的参考。
- **局限与未证实：** 当前 README 明示 V0 是研究基础而非当前受支持生产路径；仓库 Apache-2.0 不等于依赖 Redis 各版本或托管 Iris 许可；TTL 不能直接抹去有效硬约束。
- **选型建议：** 只列研究基线或已有Redis团队的对照；本项目首版避免新增不必要服务依赖。
- **维护观测：** 未完成机器可读归档状态核对；当前主README将受支持路径指向托管Iris，原开源实现移至V0；未据此推断整个仓库归档；官方页面未见归档提示；GitHub API 配额耗尽，未核对机器可读归档字段/最后推送日期。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；归档元数据未核实；未安装、未运行、未完成源码审计；核对日期 2026-09-15；证据取回 2026/9/15 12:46:28。

### P38 · ReMe（AgentScope）

[仓库](https://github.com/agentscope-ai/ReMe) · [文档](https://reme.agentscope.io) · [README 原文](https://raw.githubusercontent.com/agentscope-ai/ReMe/16269c9a76a094c8b58cb0523ed73504e33fe79f/README.md) · [许可原文](https://raw.githubusercontent.com/agentscope-ai/ReMe/16269c9a76a094c8b58cb0523ed73504e33fe79f/LICENSE)

- **类别/许可：** 核心记忆系统；Apache-2.0。
- **已有能力：** Markdown、frontmatter、wikilink 为可编辑长期源；session/resource→daily→digest 分层，索引可重建；BM25、可选向量与链接扩展；独立 CLI/HTTP/MCP/Python 服务及 DSH/OpenClaw 等宿主插件。
- **与本项目的关系：** 与用户的外置、可编辑、跨 agent 共享和后台整合构想高度相关，也贴近当前 DSH 工作站。
- **局限与未证实：** 默认关闭 embeddings，基础文件/BM25/链接功能不需要 LLM；自动抽取、Auto Dream 等需要模型配置，不能混算成本；reindex 从已摄取 chunks 重建索引，不重新扫描文件；文件 watcher、异步抽取和派生 digest 的删除一致性仍需故障实测；DSH 插件默认每 5 个完成回合异步批量提交，rootAgentsOnly=true，关闭仅有限 drain；聊天完成不等于记忆已持久化，不能据此承诺逐事件防丢失。
- **选型建议：** 加入首轮直接基线，优先检查 DSH 接入、手工编辑同步和 auto_memory/auto_dream 的来源与撤销语义。
- **维护观测：** 已取得当前远程 HEAD；GitHub API 配额限制，未核对机器可读归档字段与最后推送日期。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；未安装、未运行、未完成源码审计；机器可读归档元数据未核实；核对日期 2026-09-15；证据取回 2026/9/15 13:03:36。
- **固定版本：** `16269c9a76a094c8b58cb0523ed73504e33fe79f`。README 与 LICENSE 原文链接已固定到该提交。
- **DSH 具体接入：** [固定版本官方指南](https://raw.githubusercontent.com/agentscope-ai/ReMe/16269c9a76a094c8b58cb0523ed73504e33fe79f/integrations/dsh/README.md)；包名 `@agentscope-ai/reme-dsh-plugin`，指南对应 DSH `0.1.5-rc.2`。提供会话使用指南、`reme_search`、回合结束自动捕获、定时整合和 ReMe Status。指南报告的示例测试由项目方完成，本次没有复测；本机 DSH 版本兼容性尚未核对。
- **索引边界证据：** [固定版本 memory_search](https://raw.githubusercontent.com/agentscope-ai/ReMe/16269c9a76a094c8b58cb0523ed73504e33fe79f/docs/en/memory_search.md) 区分文件 watcher 与 `reindex`；后者不重新扫描文件。

### P39 · Memvid（v2 单文件记忆）

[仓库](https://github.com/memvid/memvid) · [文档](https://docs.memvid.com) · [README 原文](https://raw.githubusercontent.com/memvid/memvid/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/README.md) · [许可原文](https://raw.githubusercontent.com/memvid/memvid/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/LICENSE)

- **类别/许可：** 检索与存储基座；Apache-2.0。
- **已有能力：** 将内容、metadata、全文/向量/时间索引组织在 .mv2 文件中；immutable Smart Frames 与内嵌 WAL；Rust core、CLI、Python/Node SDK；可选本地 ONNX embedding、BM25、多模态及历史状态查询。
- **与本项目的关系：** 可移植、断网使用与崩溃恢复的存储对照，也适合研究可携带的记忆快照。
- **局限与未证实：** v1 的 QR/视频存储路线已弃用，不能以旧宣传描述 v2；崩溃安全和历史回溯只是本次文档观察；单文件及 append-only 不自动保证多写者、权限或派生内容彻底删除；README 性能及准确率宣称未复现。
- **选型建议：** 作为便携存储对照；首版不替换事务权威层，先验证提交恢复、增删改及并发访问。
- **维护观测：** 已取得当前远程 HEAD；GitHub API 配额限制，未核对机器可读归档字段与最后推送日期。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；未安装、未运行、未完成源码审计；机器可读归档元数据未核实；核对日期 2026-09-15；证据取回 2026/9/15 13:03:36。
- **固定版本：** `e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813`。README 与 LICENSE 原文链接已固定到该提交。

### P40 · QMD（Query Markup Documents）

[仓库](https://github.com/tobi/qmd) · [文档](https://github.com/tobi/qmd#sdk--library-usage) · [README 原文](https://raw.githubusercontent.com/tobi/qmd/04e4dbd8245c527a88f1a8f0bda547aef9ca81fb/README.md) · [许可原文](https://raw.githubusercontent.com/tobi/qmd/04e4dbd8245c527a88f1a8f0bda547aef9ca81fb/LICENSE)

- **类别/许可：** 检索与存储基座；MIT（根 LICENSE；另有第三方 notices）。
- **已有能力：** 本地 Markdown/代码集合搜索，BM25+向量+查询扩展+RRF+本地 LLM 重排；SQLite 索引、上下文目录、metadata 过滤、CLI/SDK/MCP；按结果预览到指定行原文渐进取回。
- **与本项目的关系：** 直接检验“标签筛选+混合检索+少量原文”是否足够，能作为较小的本地检索组件。
- **局限与未证实：** collection/metadata 过滤不等于访问控制；README 明确 HTTP 端点没有身份认证，远程使用需独立控制；索引 update 与 embedding 分步；本地模型仍有下载/内存/推理成本，中文意图与时间约束正确性未测。
- **选型建议：** 加入轻量检索基线；借鉴上下文目录和 preview→get，权限、规则生效和撤销由外部服务负责。
- **维护观测：** 已取得当前远程 HEAD；GitHub API 配额限制，未核对机器可读归档字段与最后推送日期。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；未安装、未运行、未完成源码审计；机器可读归档元数据未核实；核对日期 2026-09-15；证据取回 2026/9/15 13:03:06。
- **固定版本：** `04e4dbd8245c527a88f1a8f0bda547aef9ca81fb`。README 与 LICENSE 原文链接已固定到该提交。

### P41 · OpenClaw memory（harness 机制参照）

[仓库](https://github.com/openclaw/openclaw) · [文档](https://docs.openclaw.ai/concepts/memory) · [README 原文](https://raw.githubusercontent.com/openclaw/openclaw/e00500a654295dac85d6a461f9e46c67e6bf5197/README.md) · [许可原文](https://raw.githubusercontent.com/openclaw/openclaw/e00500a654295dac85d6a461f9e46c67e6bf5197/LICENSE)

- **类别/许可：** 框架和协议；MIT（根 LICENSE；另有第三方 notices）。
- **已有能力：** USER.md/MEMORY.md/每日笔记分层；默认 SQLite 混合检索，压缩前 flush、dreaming、可插拔 memory engine；官方来源/删除机制记录 session lineage、admission、forget 与派生追踪，清理索引及缓存并在发布前重查来源。
- **与本项目的关系：** 作为完整宿主如何捕获、注入、压缩、回顾、删除记忆的现实对照；不是独立通用数据库产品。
- **局限与未证实：** memory 文档明确记忆能保留许可上下文但不会强制执行政策；真实控制来自宿主工具权限等机制；forget 不覆盖原始转录、无来源旧笔记、自由手改与外部副本；跨 agent/备份删除和延迟写入处理必须依各自边界验证。
- **选型建议：** 用其 memory-provenance、action-sensitive memory 和宿主生命周期做设计及测试对照，不为记忆需求整体替换当前宿主。
- **维护观测：** 已取得当前远程 HEAD；GitHub API 配额限制，未核对机器可读归档字段与最后推送日期。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；未安装、未运行、未完成源码审计；机器可读归档元数据未核实；核对日期 2026-09-15；证据取回 2026/9/15 13:03:37。
- **固定版本：** `e00500a654295dac85d6a461f9e46c67e6bf5197`。README 与 LICENSE 原文链接已固定到该提交。
- **来源与删除证据：** [固定版本 memory-provenance](https://raw.githubusercontent.com/openclaw/openclaw/e00500a654295dac85d6a461f9e46c67e6bf5197/docs/concepts/memory-provenance.md)。文档已讨论合并/替换后来源保留、禁止再次摄取、embedding cache 清理与索引发布前复查；同时明确不覆盖原始转录、无来源旧记录和外部副本。这些是直接设计对照，不能把全部机制当作尚无先例，也不能从文档推定所有不变量已经成立。

### P42 · LightRAG（HKUDS）

[仓库](https://github.com/HKUDS/LightRAG) · [文档](https://github.com/HKUDS/LightRAG) · [README 原文](https://raw.githubusercontent.com/HKUDS/LightRAG/0edad35089f42f40ed72000f65592512fc7ab27a/README.md) · [许可原文](https://raw.githubusercontent.com/HKUDS/LightRAG/0edad35089f42f40ed72000f65592512fc7ab27a/LICENSE)

- **类别/许可：** 框架和协议；MIT。
- **已有能力：** 图结构与向量结合的文档检索，实体/关系抽取、引用、检索上下文返回和 WebUI/API；多种文本分块、可替换存储后端、多模态接入；文档删除可触发知识图谱重建。
- **与本项目的关系：** 文档/代码知识层、语义分块、图检索和删除后索引修复的组件及实验基线。
- **局限与未证实：** 文档知识 RAG 不等于用户约束或 agent 工作状态；删除引起图重建不等于已验证跨缓存撤销；多模型角色与存储后端增加部署/提取成本；未经配置的默认网络服务不提供本项目所需租户策略。
- **选型建议：** 按需采用文档接入或图检索组件；在线规则服务仍保留独立的数据模型与事务控制。
- **维护观测：** 已取得当前远程 HEAD；GitHub API 配额限制，未核对机器可读归档字段与最后推送日期。
- **证据等级与时间：** V1：官方 README/文档与 LICENSE 原文核对；未安装、未运行、未完成源码审计；机器可读归档元数据未核实；核对日期 2026-09-15；证据取回 2026/9/15 13:03:06。
- **固定版本：** `0edad35089f42f40ed72000f65592512fc7ab27a`。README 与 LICENSE 原文链接已固定到该提交。

## 从已有项目中提取的设计决策

下面是本报告的工程判断，尚需实现和实验验证。

1. **先定义权威记录与派生索引。** SQL 事件、明确约束及来源记录应有稳定 ID 和版本；全文、向量、图和摘要可作为可重建投影。采用 Markdown 为权威源同样可行，但必须定义文件修改如何进入事务、冲突和失败如何恢复。EverOS 是后一方向的重要对照。
2. **把“用户说了什么”“模型推断什么”“当前必须遵守什么”分开。** 标签适合查询筛选，不能单独决定谁有权覆盖约束。抽取 agent 提交候选事实或变更，明确的生效、撤销与作用域由服务处理；反思结论保留其推断身份。
3. **避免只用向量相似度和最新时间戳裁决。** 相似句可能是另一项目、另一时间条件、引用或否定。应先明确对象、作用域、权限、来源、有效时间和变更关系，再用语义匹配辅助识别候选。
4. **把可见编辑体验作为第一阶段功能。** 支持查看原文依据、当前有效规则、替换关系与最近取回原因；用户可编辑并看见结果。需要重点验证手工删除如何影响原文、摘要、向量、缓存和其他 agent 已拿到的上下文。
5. **不要从 README 的完整程度推导可靠性。** MELT 和 MemoryStackBench 已覆盖多种生命周期问题；用它们做共同基线，再增加当前工作站的容器崩溃、并发编辑、重复事件、撤销后迟到写入、跨 agent 缓存失效和恢复测试。
6. **创新主张应限定到实验能证实的增量。** 例如特定的约束版本协议、可编辑文件与事务状态的一致性保证、可执行的撤销传播契约、面向真实宿主的低配置接入。在没有检索到完全相同实现、也没有基线实测的情况下，仍不能声称这些方向首次出现。撤销、治理、可解释性本身已有相关系统和研究。

## 检索方式、筛选与未覆盖边界

### 代表性查询与核对路径

- 核心项目及许可证：`MemOS MemTensor GitHub LICENSE`、`MemMachine Memobase GitHub memory`、`site:github.com MemoryOS BAI-LAB`、`site:github.com memU NevaMind`。
- 同名和范围辨析：`OpenMemory CaviraOSS mem0 GitHub`、`Supermemory GitHub self host open source license`、`Engram memory DeepSeek Gentleman Programming`。
- 历史工作与生命周期：`MemoryBank Enhancing Large Language Models Long-Term Memory github`，以及 MELT、MemoryStackBench 官方仓库的 README、适配说明和根许可。
- 收尾定向补检：`ReMe AgentScope github memory`、`memvid github official`、`tobi qmd github`、`OpenClaw memory docs github`；另直接核对 HKUDS/LightRAG。P38–P42 完成后截止扩搜。
- 从已确认的官方仓库继续检查 README 指向的官网/文档、仓库迁移页、源码目录与 LICENSE 原文；关键候选使用远程 HEAD 固定 commit，避免只引用会移动的主分支。

这是一组代表性检索路径，不是声称具有完整可复现日志的系统综述。论文预印本与基准论文另见同一设计包的论文研究文件。

### 纳入原则

纳入用户点名或与其目标直接相关的记忆系统；补入可编辑/可治理/本地持久化/多 agent 接入的对照；同时覆盖框架、存储基座和生命周期评测。保留少量历史或边界条目，是为了防止把旧部署文档、SaaS SDK、同名模型模块误当当前自托管记忆服务。

### 明确未覆盖

- 未穷尽 GitHub、新发布预印本、各语言生态和全部宿主插件；没有检索到某功能不等于该项目不存在此功能。
- 未安装、未测吞吐/延迟/token 成本、未复现宣传分数，也未验证离线可用性、Windows 适配、删除彻底性、跨租户隔离或灾难恢复。
- 未做逐文件许可证、依赖、模型权重、SaaS 条款审计；开源标签和根 LICENSE 不能替代这些检查。
- 未将云端平台独有功能或 proprietary 优化成绩转移到 OSS 版本；使用开源 SDK 不代表可以自行部署其服务端。
- 维护状态为核对时点观察；API 配额限制下，P35–P42 的归档字段与最后推送日期标为未核实。其余未固定 SHA 的链接以后可能变化。
- 评测必须分开报告系统原生行为、适配器补充策略和新增控制层；否则可能测到评测脚本的能力，而不是记忆系统本身。

## 下一步：最小可判定实验

先核对当前 DSH 版本并试装 ReMe 的独立插件，再选 EverOS、LongMemory、MemOS、Mem0/Hindsight 中至少一个，以及 Engram/QMD + SQLite 轻量对照；用相同宿主事件和作用域运行。OpenClaw 作为已有宿主来源/删除契约参照。优先回答四个问题：**约束是否正确生效，明确撤销是否传播，崩溃后能否恢复，用户能否理解和修改当前记忆**。在同等任务成功率和约束违例率下再比较总 token、模型调用、延迟及人工修复成本。优先适配已有组件；仅在具体生命周期能力确实不足时补建控制层。通过这些实验决定复用与自建边界，才足以支撑“更省 token 且不损精度”的结论。
