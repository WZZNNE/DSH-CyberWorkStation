# dsh-import-note

**中文** | English below

设置 → 插件 → 插件配置 里的一张说明卡:社区插件 dsh-chat-import(侧栏「导入会话」)对源记录系统提示词的处理。

- 默认丢弃源记录里的 system / developer 提示词(`lib/import-prefs.mjs`,开关 `importSystemPrompt` 默认 false)。
- 开关打开后,那段提示词也只是跟在「环境变更提示」后面,作为导入会话历史里的一条 `user/message`(`source.kind = 'plugin'`)保留(`lib/convert/core.mjs` 的 `contextInjectionText` / `synthesizeSession`)。
- 全链路不写 `ctx.systemPrompt`、不动任何插件的提示段——**不会覆盖** dsh 本体、控制甲板、多媒体、桌宠等注入的系统提示词。

为什么是一张单独的卡而不是写在导入插件自己的设置页里:那一页属于社区插件,它的语言命名空间只允许一个所有者(核心 locale 服务对重复的 (ns, locale) 直接抛错),页内也没有可供插入的 slot;猜 DOM 类名不可靠。卡片用的是核心给插件的 `settings.plugin.item` 槽位,和「图片理解」等卡片同一处。

无路由、无配置;随 dsh 界面语言切换中英文。

---

One card under Settings → Plugins for the community session importer (dsh-chat-import): source system / developer prompts are dropped by default; with the importer's switch on they survive only as one plugin-sourced context message inside the imported session's history; dsh's own system prompt and every plugin section are never touched. The importer's page cannot carry the sentence (single-owner locale namespace, no slot), hence the card.
