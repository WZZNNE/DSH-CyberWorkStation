// Sections 07–09 — skills, contributors, skins & art, license.
export const skills = {
  id: 'skills',
  num: '06',
  kicker: '',
  title: 'Skill 清单',
  intro: `
Skill 分两类。工程 Skill 给 Claude Code 用，放在 \`skills/\`，复制到 \`~/.claude/skills/\` 之后，Claude Code 在这个仓库里干活时会照着它们来。给 dsh 内的模型用的 Skill 放在 \`dsh-skills/\`，安装时复制到 \`~/.dsh/skills/\`，在启动器「Skill 管理」页可以看到。全部是为本套件写的。
`,
  blocks: [
    { type: 'md', md: `
### 工程 Skill（Claude Code，7 个）

| Skill | 用来 |
|---|---|
| \`dsh-architecture\` | 弄懂 dsh 的插件系统、profile / bundle / patch、回合流程，深入本体内部之前先读 |
| \`dsh-plugin-dev\` | 写 dsh 插件：工具、hook、权限门、命令、模型适配器 |
| \`dsh-frontend-dev\` | 改 dsh 网页界面：面板、设置卡、侧栏项、主题 |
| \`dsh-env-ops\` | 搭环境、升级、排查构建 / 安装 / 启动错误（Windows 为主） |
| \`dsh-playbook\` | 怎么跑、怎么配模型和 API Key、怎么更快更便宜、怎么装插件 |
| \`dsh-testing\` | 该跑哪些测试、怎么写、快照怎么更新 |
| \`dsh-local-models\` | LM Studio / Ollama 本地模型的路由、思考档位、上下文对齐 |

### dsh 内 Skill（3 个）

| Skill | 用来 |
|---|---|
| \`skin-studio\` | 让模型给启动器或 dsh 做皮肤（变量表、模板、背景图用法） |
| \`control-deck-authoring\` | 让模型帮你写提示词、正则、世界书、预设，或迁移 SillyTavern 资产 |
| \`desktop-pet\` | 让模型带你做一只桌宠：问需求、写人设、列素材、出图、写进插件 |

### 随本体而来（照搬）

本体自带 12 个开发规程 Skill（代码评审、文档标准、推送前检查、翻译等），在启动器 Skill 页列为 repo 来源。
`},
  ],
};

export const contributors = {
  id: 'contributors',
  num: '',
  kicker: '',
  title: '给贡献者',
  intro: '',
  blocks: [
    { type: 'md', md: `
套件插件就是 \`plugins/dsh-*\` 这些目录，纯 ES 模块包，没有构建步骤。\`plugins/_shared\` 是共享包 \`dsh-cyberworkstation-kit\`，里面是套件各接口共用的会话读取和只允许本机写入的围栏；\`launcher/peer-links.mjs\` 把它和本体的包一起链接到插件旁边，插件才能直接 import。启动器在 \`launcher/\`，\`server.mjs\` 在最上层，各部分在 \`lib/\` 下。\`core/\` 里原样内置的本体从不手改。

仓库根目录下的常用命令：\`npm run lint\`（ESLint，flat config）、\`npm run peer-links\`（重建插件链接）、\`npm run readme:zh\`（本文由 \`docs/showcase-src/content\` 生成）、\`npm run repair:preview\` / \`npm run repair\`（修复旧会话日志的脚本，需要先停 dsh）、\`npm run publish:npm\`（维护者发 npm 用，先 \`npm login\`；\`publish:npm:dry\` 只打包不发布）。

注释用英文。套件文件统一 LF，由 \`.gitattributes\` 保证；内置本体保留它自己的规则。
`},
  ],
};

export const skins = {
  id: 'skins',
  num: '07',
  kicker: '',
  title: '皮肤与美术',
  intro: `
两类皮肤都在启动器「外观皮肤」页切换和导入，下表说明各自的来源和样子。
`,
  blocks: [
    { type: 'md', md: `
| 皮肤 | 端 | 归属 | 说明 |
|---|---|---|---|
| \`default\` | 启动器 | 原创 | 明 / 暗 / 跟随系统三态 |
| \`cyberpunk-2077\` | 启动器 + 前端 | 原创 | 霓虹黄 × 电青、切角卡片、glitch、电流 / 闪电特效；美术由即梦 AI 生成 |
| \`night-city-holo\` | 启动器 + 前端 | 原创 | 石墨底、全息青细线、2077 金激活态、矢量导航图标，无扫描线无闪烁；背景为 gpt-image-2 生成的夜之城 |
| 社区皮肤 | 前端 | 社区作者（照搬） | 启动器「获取社区皮肤」从 npm 转换成本地 CSS 后使用（可用 miku、matrix、minecraft、xp 等），沿用各包许可，不入库 |

桌宠的全息 UI 三件套（气泡、输入条、发送键）随桌宠插件附带。桌宠「王胖子」的表情序列帧由 gpt-image-2 生成。
`},
  ],
};

export const principles = {
  id: 'license',
  num: '08',
  kicker: '',
  title: '许可与致谢',
  intro: '',
  blocks: [
    { type: 'md', md: `
- 套件原创代码 MIT（\`LICENSE\`）。
- 二改插件沿用上游 MIT：[Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)、[Tastelessor/dsh-usage-stats](https://github.com/Tastelessor/dsh-usage-stats)、[@goodandready/dsh-vision-bridge](https://www.npmjs.com/package/@goodandready/dsh-vision-bridge)。
- 照搬的社区插件各自许可（MIT / Apache-2.0）见清单；社区皮肤归原作者。
- 控制甲板与联网搜索的用法对齐 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 与其 WebSearch 扩展（参照用法，不含其代码）。
- 启动器交互体验致敬 [秋叶 aaaki 的 ComfyUI 整合包启动器](https://space.bilibili.com/12566101)。
- 本体：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）。
- 启动器美术由即梦 AI 生成；夜之城背景与桌宠序列帧由 gpt-image-2 生成。
`},
  ],
};

export default [skills, contributors, skins, principles];
