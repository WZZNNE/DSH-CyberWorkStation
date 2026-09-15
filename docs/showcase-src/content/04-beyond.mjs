// Section 04 — capabilities the screenshots cannot show, as a plain feature list.
export default {
  id: 'beyond',
  num: '03',
  kicker: '',
  title: '截图里看不到的部分',
  intro: `
有些功能没有自己的面板，或者面板只露出一角，这里按用途列一下。
`,
  blocks: [
    { type: 'md', md: `
### 安全

- 危险命令拦截（\`dsh-safe-guard\`，原创）：\`rm -rf /\`、无 lease 的 \`git push --force\`、裸设备写入、\`mkfs\`、Windows 盘符根删除 / 格式化、fork 炸弹等直接拦下，不打扰正常确认流；在控制甲板「安全规则」里可以加自己的拒绝、需确认（弹审批）、自动放行正则。
- 密钥进系统钥匙串（\`dsh-credentials-keyring\`，原创）：API Key 存进 Windows 凭据管理器而不是明文文件；环境变量仍然优先；钥匙串出问题时只会读不到，不会丢密钥。
- 手机远程的局域网围栏（\`dsh-lan-fence\`，原创）：开了手机扫码远程后，未配对的局域网设备访问 dsh 的 \`/api\` 一律 403，配对通道不受影响；纯插件实现，升级本体不会重开这个口子。
- 只本机可用：启动器只监听 127.0.0.1，每个请求都要带令牌；套件所有能写配置的接口都拒绝跨站请求和外来 Host。
`},
    { type: 'md', md: `
### 对话

- 临时对话（\`dsh-temp-chat\`，原创）：侧栏一个按钮开一个不属于任何项目的对话，放在共用的「临时对话」工作区，用纯聊天预设（不能动文件和终端）；不会自动删除，想清理时删掉目录就行。
- 拖文件（\`dsh-drop-files\`，原创）：把任意非图片文件拖进对话区，文件存进当前工作区的 \`.dsh-uploads/\`，输入框自动写入 \`@.dsh-uploads/<名>\`，模型用文件工具读；单个文件最多 25 MB；PDF / Office / 压缩包会存下来但模型读不出内容，拖入时会提示。
- 皮肤工坊（\`dsh-skin-studio\` + Skill \`skin-studio\`，原创）：在对话里让模型给启动器或 dsh 做皮肤，它会先问风格、主色、明暗、背景图，写好直接落盘启用；没有图且模型不能生图时会向你要图，不会瞎编。
- 模型悬停价格（\`dsh-price-hint\`，原创）：模型选择器里悬停任意模型，显示输入 / 输出 / 缓存每百万 tokens 的价格。
- 快建工作区（\`dsh-quick-workspace\`，原创）：启动器仪表盘输入路径新建工作区（目录不存在会创建）。
- 前端皮肤注入（\`dsh-skin-loader\`，原创）：把启动器里选的前端皮肤套到 dsh 网页上。
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
