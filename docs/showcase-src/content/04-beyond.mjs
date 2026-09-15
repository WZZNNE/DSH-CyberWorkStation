// Section 04 — capabilities the screenshots cannot show, grouped by purpose.
export default {
  id: 'beyond',
  num: '03',
  kicker: '',
  title: '截图里看不到的部分',
  intro: `
有些功能没有自己的面板，或者面板只露出一角。这里按用途分组说明。
`,
  blocks: [
    { type: 'md', md: `
### 安全

危险命令拦截（\`dsh-safe-guard\`，原创）。\`rm -rf /\`、无 lease 的 \`git push --force\`、裸设备写入、\`mkfs\`、Windows 盘符根删除和格式化、fork 炸弹这类命令直接拦下，其他命令照常走确认流程，插件不额外打扰。在控制甲板「安全规则」分页里可以加自己的拒绝、需确认（弹审批卡）和自动放行正则。

密钥进系统钥匙串（\`dsh-credentials-keyring\`，原创）。API Key 存进 Windows 凭据管理器，而不是明文文件。环境变量仍然优先；钥匙串出问题时只是暂时读不到，已存的密钥不会被删除或覆盖。

手机远程的局域网围栏（\`dsh-lan-fence\`，原创）。开了手机扫码远程之后，未配对的局域网设备访问 dsh 的 \`/api\` 一律 403，配对通道照常工作。它是纯插件实现，升级本体之后围栏还在。

只本机可用。启动器的每个请求都要带令牌，套件所有能写配置的接口都拒绝跨站请求和外来 Host。
`},
    { type: 'md', md: `
### 对话

临时对话（\`dsh-temp-chat\`，原创）。侧栏一个按钮开一个不属于任何项目的对话，放在共用的「临时对话」工作区里，用纯聊天预设，没有文件也没有终端。不会自动删除，想清理时用清理按钮删掉目录。

拖文件（\`dsh-drop-files\`，原创）。把任意非图片文件拖进对话区，它会存进当前工作区的 \`.dsh-uploads/\`，输入框里自动写入 \`@.dsh-uploads/<名>\`，模型用文件工具读；单个文件最多 25 MB。PDF、Office、压缩包会存下来，但模型读不出内容，拖入时会提示。

皮肤工坊（\`dsh-skin-studio\` + Skill \`skin-studio\`，原创）。在对话里让模型给启动器或 dsh 做皮肤。它会先问风格、主色、明暗和背景图，然后写好 CSS 直接启用。没有图而模型又不能生图时，它会向你要一张，而不是自己编一张。

`},
    { type: 'md', md: `
### 更小的部件

有三个插件完全不需要面板。\`dsh-price-hint\` 在模型选择器里悬停任意模型时显示输入、输出、缓存每百万 tokens 的价格。\`dsh-quick-workspace\` 是仪表盘「文件夹」一栏背后的实现，目录不存在就创建。\`dsh-skin-loader\` 把「外观皮肤」页里选的前端皮肤套到 dsh 网页上。
`},
    { type: 'md', md: `
### 本体自带、默认不开的能力（上游包）

| 能力 | 作用 |
|---|---|
| 持久终端（\`dsh-terminal\` 三件） | 模型可以开一个持久的 PTY 终端，交互式发命令、读输出、发信号，配合后台作业 |
| 定时提醒（\`dsh-schedule\`） | 按时间点或固定频率提醒 agent |
| LSP 代码智能（\`dsh-lsp\` 三件） | 配了 TypeScript 语言服务器，模型可以跳转定义、查引用、看类型 |
| MCP 客户端 + 参考记忆服务器 | 官方示例接法的知识图谱记忆（实体 / 关系 / 观察），与套件的记忆插件是两套独立机制 |
| Claude Code / Codex hook 桥 | 直接复用 Claude Code、Codex 格式的 hooks.json |
`},
  ],
};
