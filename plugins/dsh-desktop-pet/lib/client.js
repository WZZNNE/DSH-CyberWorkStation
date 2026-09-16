/**
 * dsh-desktop-pet-cws browser half:
 *   1. a floating pet inside dsh itself (drag it anywhere; no desktop window needed),
 *   2. a sidebar button that shows/hides it,
 *   3. a Settings section with everything the pet has: persona, its own multimodal API, lorebook,
 *      user profile, permissions, proactive frequency, voice, reminders, conversations and the
 *      desktop window (WinForms sprite or Edge app window).
 *
 * Permission requests raised by the pet appear as an inline approve / reject card, both here and in the
 * desktop window — the pet can never read the screen or drive the mouse without that click, unless
 * the owner set the level to "full access".
 */
window.__ModuleLoader__.load({
  id: 'dsh-desktop-pet-cws',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

/** The sprite motions, injected once: the in-app pet has no stylesheet of its own. */
function installMotionStyles() {
  if (document.getElementById('dsh-pet-motions')) return
  const el = document.createElement('style')
  el.id = 'dsh-pet-motions'
  el.textContent = `
select option, select optgroup { background: var(--dsw-alias-bg-layer-2, #1c1f28); color: var(--dsw-alias-label-primary, #e8ecf5) } select option:checked { background: var(--dsw-alias-state-business-tertiary, rgba(106,163,255,.18)) }
@keyframes dshPetBreathe { 0%,100% { transform: scale(1) translateY(0) } 50% { transform: scale(1.035) translateY(-2px) } }
@keyframes dshPetBob     { 0%,100% { transform: translateY(0) rotate(0) } 25% { transform: translateY(-7px) rotate(-1.5deg) } 75% { transform: translateY(-3px) rotate(1.5deg) } }
@keyframes dshPetNod     { 0%,100% { transform: rotate(0) translateY(0) } 30% { transform: rotate(4deg) translateY(2px) } 60% { transform: rotate(1deg) translateY(0) } }
@keyframes dshPetSway    { 0%,100% { transform: rotate(-2.5deg) translateX(-3px) } 50% { transform: rotate(2.5deg) translateX(3px) } }
@keyframes dshPetShake   { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-4px) rotate(-1deg) } 40% { transform: translateX(4px) rotate(1deg) } 60% { transform: translateX(-3px) } 80% { transform: translateX(3px) } }
@keyframes dshPetBurst   { 0%,100% { transform: scale(1) translateX(0) } 10% { transform: scale(1.06) translateX(-6px) rotate(-2deg) } 30% { transform: scale(1.06) translateX(6px) rotate(2deg) } 50% { transform: scale(1.03) translateX(-4px) } 70% { transform: scale(1.03) translateX(4px) } }
@keyframes dshPetPop     { 0%,100% { transform: scale(1,1) translateY(0) } 30% { transform: scale(1.08,.92) translateY(4px) } 55% { transform: scale(.94,1.09) translateY(-9px) } 80% { transform: scale(1.02,.98) translateY(0) } }
@keyframes dshPetWobble  { 0%,100% { transform: rotate(0) skewX(0) } 25% { transform: rotate(-5deg) skewX(2deg) } 50% { transform: rotate(3deg) skewX(-2deg) } 75% { transform: rotate(-2deg) skewX(1deg) } }
@keyframes dshPetStretch { 0%,100% { transform: scale(1,1) translateY(0) } 35% { transform: scale(.96,1.08) translateY(-8px) } 60% { transform: scale(1.05,.95) translateY(2px) } }
@keyframes dshPetSleep   { 0%,100% { transform: scale(1) rotate(-1deg) } 50% { transform: scale(1.02) rotate(1deg) } }
.dsh-pet-motion-breathe { animation: dshPetBreathe 4s ease-in-out infinite }
.dsh-pet-motion-bob     { animation: dshPetBob 1.6s ease-in-out infinite }
.dsh-pet-motion-nod     { animation: dshPetNod 2.4s ease-in-out infinite }
.dsh-pet-motion-sway    { animation: dshPetSway 3.4s ease-in-out infinite }
.dsh-pet-motion-shake   { animation: dshPetShake .45s ease-in-out infinite }
.dsh-pet-motion-burst   { animation: dshPetBurst .6s ease-in-out infinite }
.dsh-pet-motion-pop     { animation: dshPetPop 1.1s ease-in-out infinite }
.dsh-pet-motion-wobble  { animation: dshPetWobble 1.5s ease-in-out infinite }
.dsh-pet-motion-stretch { animation: dshPetStretch 3s ease-in-out infinite }
.dsh-pet-motion-sleep   { animation: dshPetSleep 6s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { [class*="dsh-pet-motion-"] { animation: none } }
`
  document.head.appendChild(el)
}

    const React = require('react')
    const h = React.createElement
    const activeLocale = ctx => { try { const a = ctx?.locale?.getSnapshot?.().active; if (typeof a === 'string' && a) return a } catch { /* browser language below */ } return String(navigator.language ?? '') }
    const zh = activeLocale(null).toLowerCase().startsWith('zh')
    const makeT = zh => zh ? {
      title: '桌宠', open: '🐾 显示桌宠', hide: '🐾 收起桌宠', enable: '启用桌宠', name: '名称',
      persona: '人格设定(系统提示词)', appearance: '外观描述(生成图片时作为角色参考)', greeting: '开场白',
      scope: '人格作用范围', scopePet: '仅作用于桌宠', scopeGlobal: '全局(主助手同样使用此人格)',
      llm: '对话模型', provider: '接口格式', baseURL: 'API 地址', model: '模型', key: 'API 密钥', keySave: '保存密钥',
      source: '模型来源', sourceFollow: '跟随全局(免配置)', sourceHarness: '共享全局 API(DSH,自选供应商与模型)', sourceOwn: '自定义(独立接口与密钥)', hProvider: 'DSH 供应商', hGone: '(已失效)', hNoHost: '(无可借用地址)',
      followNote: '跟随 dsh 当前默认模型,无需任何配置;全局换模型时桌宠自动跟着换。',
      followNow: (p, m, u) => `实际调用:${m || '—'}(${p || '—'}${u ? ' @ ' + String(u).replace(/^https?:\/\//, '') : ''})`, reopenNote: 'dsh 重启后窗口会自动回来;从托盘退出则下次不再自动打开。', followSet: 'dsh 默认模型(agent-default-model)', asides: n => `还有 ${n} 段只有宠物说话的旁白记录`, showAsides: '显示旁白', hideAsides: '收起旁白', followWhere: '要改 dsh 默认模型,去 设置 → 凭据中心 →「dsh 默认模型」(启动器的「凭据中心」页也有);这里只显示。',
      presetSave: '保存为本宠预设', presetLoad: '恢复预设', presetSaved: '预设已保存', vendor: '供应商', vendorCustom: '自定义',
      noProviders: 'dsh 尚未配置任何模型供应商。请先在「模型」设置中添加,或将模型来源改为「自定义」。',
      borrowHint: env => `使用 dsh 已保存的凭据(${env}),无需重复填写;此处选择的模型仅作用于桌宠,不影响主助手。`,
      keyHint: env => `API 密钥保存在 dsh 凭据库(${env})中。点击「保存密钥」立即生效,与页面底部的「保存」相互独立。`,
      keyStored: '✓ 已配置', keyMissing: '· 未配置', keyDelete: '删除密钥', keyDeleteConfirm: '删除已保存的 API 密钥?使用同一密钥的其他桌宠将同时失效。', keyDeleted: '密钥已删除',
      wake: '显示桌宠(使用当前设置的窗口形态)', sleep: '关闭桌宠(同时关闭浮窗与桌面窗口)',
      chatsArea: '桌宠对话', openChatsTip: '打开桌宠对话记录', renameArea: '重命名该分组',
      look: '外观(气泡样式)', lookHint: '桌面精灵的气泡、桌面网页窗与 dsh 内浮窗共用此配置;透明度与模糊度共同决定玻璃质感。',
      lookBg: '气泡底色', lookText: '文字颜色', lookAccent: '强调色(你的消息)', lookOpacity: '透明度', lookBlur: '模糊度', lookRadius: '圆角', lookFont: '字号', temp: '温度', maxTok: '最大输出(tokens)',
      lookSample: '这是桌宠回复的预览效果。', lookSampleMine: '这是你发出的消息。', lookGlass: '玻璃', lookFlat: '不透明', lookWarm: '暖色纸感',
      lookUi: '界面素材', lookPlain: '纯色/玻璃(不使用图片)', lookArt: '图片素材(九宫格)',
      lookDraw: '使用图像生成模型生成', lookDrawing: '生成中…(共三张,需要一些时间)',
      lookDrawConfirm: '将调用图像生成 API 生成三张界面素材(气泡底板、输入框、发送键),消耗三次生成额度。是否继续?',
      lookPartial: '部分素材生成失败,未切换为「图片素材(九宫格)」模式;请重试,或手动导入缺失的素材。',
      lookSetName: '套装名称', lookSaveSet: '保存为套装', lookApply: '应用', lookNoSets: '暂无已保存的界面套装。导入或生成三张素材后即可命名保存,供任意桌宠使用。',
      lookIncomplete: '(不完整)', lookDeleteConfirm: '删除该界面套装?正在使用它的桌宠不受影响(素材已复制)。',
      lookSlice: '九宫格切边',
      partBubble: '气泡底板', partInput: '输入框', partButton: '发送键', partImport: '导入',
      partHint: '三张素材可自行绘制后导入(PNG,透明背景),也可由图像生成模型生成。九宫格切边决定四边保留的宽度:四角保持原样、四边单向拉伸、中间双向拉伸,因此一张图可适配任意长度的文本。',
      pickChat: '请从左侧选择一段对话', untitled: '(未命名)', noChats: '暂无对话', delChatConfirm: '删除该对话?',
      permissions: '权限', screen: '读取屏幕', control: '操作电脑', pNone: '不允许', pAsk: '每次询问', pFull: '完全允许',
      proactive: '主动对话', proactiveOn: '启用主动对话', freq: '频率', low: '低(30-60 分钟)', medium: '中(15-30 分钟)', high: '高(5-15 分钟)', chatty: '极高(1-5 分钟)',
      shotFirst: '发言前先读取屏幕(遵循「读取屏幕」权限:「每次询问」会先请求确认)', quiet: '任务进行期间不主动发言',
      taskAware: '感知当前任务(在任务开始与完成时发送提示)', longTask: '长任务提醒(分钟,0 为关闭)', voice: '语音', voiceOn: '启用语音', autoSpeak: '自动朗读回复', ttsVoice: '音色 ID',
      profile: '用户画像', profileOn: '启用用户画像', refresh: '从历史对话重新总结', profileHint: '从本机 dsh 对话记录中读取你本人输入的内容,总结为桌宠对你的了解。内容可直接编辑,也可清空。',
      lore: '设定集', addLore: '添加条目', key2: '名称', content: '内容',
      loreMode: '与本体世界书', loreOverride: '覆盖(只用桌宠设定集)', loreCoexist: '共存(两边都读,仅注入桌宠)', loreScan: '扫描深度(条)', loreBudget: '字数预算',
      loreOn: '启用', loreConst: '常驻', loreKw: '关键词(逗号分隔,留空=常驻)', loreKw2: '二级关键词', loreLogic: '触发逻辑',
      logicAndAny: '并且命中任一', logicAndAll: '并且全部命中', logicNotAny: '并且全部未命中', logicNotAll: '并且不全命中',
      loreProb: '概率%', loreOrder: '顺序', loreDepth: '扫描深度(空=全书)', loreCase: '大小写', loreWord: '全词', loreInherit: '跟随全书',
      loreCaseBook: '全书大小写敏感', loreWordBook: '全书全词匹配',
      loreHint: '常驻条目每轮都注入;带关键词的条目只在最近对话命中关键词时注入。共存模式会同时读取控制甲板的世界书(只读,不影响本体)。',
      maxInput: '最大输入(tokens,0=不限)',
      window: '桌面窗口', variant: '形态', vIn: 'dsh 内浮窗(免安装)', vWin: '桌面精灵(WinForms)', vWeb: '桌面网页窗(Edge 应用窗口)',
      size: '大小', start: '显示桌宠', stop: '关闭桌宠', chats: '对话记录', newChat: '新建对话', resume: '继续', del: '删除', edit: '编辑',
      schedules: '提醒', addSchedule: '添加提醒', save: '保存', saved: '已保存', failed: '请求失败:', material: '上传角色素材', expressions: '表情/动作',
      addExpr: '添加表情', exprName: '名称', exprAsset: '图片文件名', exprWhen: '使用场景', exprFrames: '帧数', exprFps: '帧率', talk: '输入消息…', send: '发送', think: '思考中…',
      allow: '同意', deny: '拒绝', pets: '当前桌宠', newPet: '+ 新建桌宠', deletePet: '删除当前桌宠', newPetName: '为新桌宠命名', deletePetConfirm: '删除该桌宠?其对话、素材与设定将一并删除。', mediaOff: '尚未配置图像/语音 API,请先在「多媒体 API」中设置。', search: '联网搜索', searchFrom: '来源', sFollow: '跟随全局设置', sOwn: '独立来源(使用桌宠单独的搜索设置)', sOff: '关闭',
      running: '运行中', offline: '桌宠服务未连接', working: '处理中…', started: '已显示桌宠', stopped: '已关闭桌宠', resumed: '已继续该对话',
      personaPlaceholder: '请描述桌宠的人格与说话方式', msgCount: n => `${n} 条消息`, sessionsRead: n => `已读取 ${n} 段对话`,
      noMessages: '暂无消息', noProvidersShort: '尚未配置供应商', editPrompt: '编辑这条消息:', lookDrawTip: '调用图像生成 API 生成三张界面素材',
      schedulePlaceholder: '例:30 分钟后提醒我喝水',
    } : {
      title: 'Desktop pet', open: '🐾 Show pet', hide: '🐾 Hide pet', enable: 'Enable the pet', name: 'Name',
      persona: 'Persona (system prompt)', appearance: 'Appearance (character reference for image generation)', greeting: 'Greeting',
      scope: 'Persona applies to', scopePet: 'the pet only', scopeGlobal: 'everything (the main assistant too)',
      llm: 'Chat model', provider: 'Wire format', baseURL: 'Base URL', model: 'Model', key: 'API key', keySave: 'Save key',
      source: 'Model source', sourceFollow: 'follow dsh (zero config)', sourceHarness: 'share the global API (DSH, pick provider & model)', sourceOwn: 'custom (own endpoint & key)', hProvider: 'DSH provider', hGone: ' (gone)', hNoHost: ' (no host)',
      followNote: "Follows dsh's current default model; nothing to configure here.",
      followNow: (p, m, u) => `Calls: ${m || '—'} (${p || '—'}${u ? ' @ ' + String(u).replace(/^https?:\/\//, '') : ''})`, reopenNote: 'The window comes back by itself after a dsh restart; quitting it from the tray keeps it closed.', followSet: 'dsh default model (agent-default-model)', asides: n => `${n} more pet-only asides`, showAsides: 'Show asides', hideAsides: 'Hide asides', followWhere: 'To change the dsh default model go to Settings → Credentials → dsh default model (the launcher Credentials page has it too); this panel only shows it.',
      presetSave: 'Save as this pet\'s preset', presetLoad: 'Restore preset', presetSaved: 'Preset saved', vendor: 'Provider', vendorCustom: 'custom',
      noProviders: 'dsh has no model provider configured yet — set one up under Models, or give the pet its own.',
      borrowHint: env => `Uses dsh's own key (credential ${env}); nothing to type here. The model you pick applies to the pet only.`,
      keyHint: env => `The key is stored in dsh's credential store (${env}) by the "Save key" button — not by Save at the bottom.`,
      keyStored: '✓ configured', keyMissing: '· not configured', keyDelete: 'Delete key', keyDeleteConfirm: 'Delete the saved API key? Every pet using this key loses it.', keyDeleted: 'Key deleted',
      wake: 'Show the pet (in its configured window form)', sleep: 'Close the pet (both the floating panel and the desktop window)',
      chatsArea: 'Pet chats', openChatsTip: "Open the pet's conversations", renameArea: 'Rename this group',
      look: 'Look (speech bubbles)', lookHint: 'Shared by the desktop bubble, the desktop web window and the floating pet in dsh. Opacity and blur together make the glass effect.',
      lookBg: 'Bubble fill', lookText: 'Text', lookAccent: 'Accent (your side)', lookOpacity: 'Opacity', lookBlur: 'Blur', lookRadius: 'Corner', lookFont: 'Text size', temp: 'Temperature', maxTok: 'Max output (tokens)',
      lookSample: 'This is a preview of a pet reply.', lookSampleMine: 'This is one of your messages.', lookGlass: 'Glass', lookFlat: 'Opaque', lookWarm: 'Warm paper',
      lookUi: 'UI artwork', lookPlain: 'colour and blur (no artwork)', lookArt: 'image set (nine-slice)',
      lookDraw: 'Generate with the image model', lookDrawing: 'Drawing… (three images, give it a minute)',
      lookDrawConfirm: 'Draw three UI pieces (bubble plate, input bar, send key) with the image API. That is three generations. Go ahead?',
      lookPartial: 'Some pieces did not come out, so the drawn look was not switched on. Retry, or import the missing one.',
      lookSetName: 'Set name', lookSaveSet: 'Save as a UI set', lookApply: 'Apply', lookNoSets: 'No saved UI sets yet. Import or generate the three pieces, then save them under a name for any pet to use.',
      lookIncomplete: ' (incomplete)', lookDeleteConfirm: 'Delete this UI set? A pet currently using it keeps its copies.',
      lookSlice: 'Nine-slice inset',
      partBubble: 'Bubble', partInput: 'Input bar', partButton: 'Send key', partImport: 'Import',
      partHint: 'Bring your own PNGs (transparent background) or let the image model draw them. The inset says how much of each edge is kept unstretched: corners as drawn, edges stretched one way, middle both — which is how one drawing wraps any sentence.',
      pickChat: 'Pick a conversation on the left', untitled: '(untitled)', noChats: 'No conversations yet', delChatConfirm: 'Delete this conversation?',
      permissions: 'Permissions', screen: 'Read the screen', control: 'Control the computer', pNone: 'no access', pAsk: 'ask every time', pFull: 'full access',
      proactive: 'Proactive chat', proactiveOn: 'Enable proactive chat', freq: 'Frequency', low: 'low (30–60 min)', medium: 'medium (15–30 min)', high: 'high (5–15 min)', chatty: 'very high (1–5 min)',
      shotFirst: 'Read the screen before speaking (follows the "Read the screen" permission; "ask every time" asks first)', quiet: 'Stay quiet while a task is running',
      taskAware: 'Follow the current task (say something when it starts and finishes)', longTask: 'Long-task alert (minutes, 0 = off)', voice: 'Voice', voiceOn: 'Enable voice', autoSpeak: 'Speak replies aloud', ttsVoice: 'Voice id',
      profile: 'User profile', profileOn: 'Enable the user profile', refresh: 'Re-summarise from past conversations', profileHint: 'Reads what you typed in this machine\'s dsh conversations and distils a summary. Editable and erasable.',
      lore: 'Lorebook', addLore: 'Add entry', key2: 'Name', content: 'Content',
      loreMode: 'With the deck world info', loreOverride: 'override (pet lorebook only)', loreCoexist: 'coexist (read both, inject into the pet only)', loreScan: 'Scan depth (messages)', loreBudget: 'Budget (chars)',
      loreOn: 'On', loreConst: 'Constant', loreKw: 'Keywords (comma-separated; empty = constant)', loreKw2: 'Secondary keys', loreLogic: 'Logic',
      logicAndAny: 'and any', logicAndAll: 'and all', logicNotAny: 'not any', logicNotAll: 'not all',
      loreProb: 'Probability %', loreOrder: 'Order', loreDepth: 'Scan depth (empty = book)', loreCase: 'Case', loreWord: 'Whole word', loreInherit: 'book default',
      loreCaseBook: 'book case-sensitive', loreWordBook: 'book whole-word',
      loreHint: 'Constant entries always inject; keyword entries inject when the recent conversation mentions them. Coexist mode also reads the control deck world info (read-only; the deck itself is untouched).',
      maxInput: 'Max input (tokens, 0 = unlimited)',
      window: 'Desktop window', variant: 'Form', vIn: 'floating inside dsh (nothing to install)', vWin: 'desktop sprite (WinForms)', vWeb: 'desktop web window (Edge app window)',
      size: 'Size', start: 'Show the pet', stop: 'Close the pet', chats: 'Conversations', newChat: 'New conversation', resume: 'Resume', del: 'Delete', edit: 'Edit',
      schedules: 'Reminders', addSchedule: 'Add reminder', save: 'Save', saved: 'Saved', failed: 'Request failed: ', material: 'Upload character assets', expressions: 'Expressions / actions',
      addExpr: 'Add expression', exprName: 'Name', exprAsset: 'Image filename', exprWhen: 'When to use it', exprFrames: 'Frames', exprFps: 'FPS', talk: 'Type a message…', send: 'Send', think: 'Thinking…',
      allow: 'Allow', deny: 'Deny', pets: 'Current pet', newPet: '+ New pet', deletePet: 'Delete this pet', newPetName: 'Name the new pet', deletePetConfirm: 'Delete this pet? Its conversations, assets and settings go with it.', mediaOff: 'No image/speech API yet — set one up under “Media APIs”.', search: 'Web search', searchFrom: 'Source', sFollow: 'follow the global setting', sOwn: "independent (the pet's own search settings)", sOff: 'off',
      running: 'running', offline: 'pet service not connected', working: 'Working…', started: 'Pet shown', stopped: 'Pet closed', resumed: 'Resumed this conversation',
      personaPlaceholder: "Describe the pet's persona and speaking style", msgCount: n => `${n} messages`, sessionsRead: n => `${n} conversations read`,
      noMessages: 'No messages yet', noProvidersShort: 'no providers configured', editPrompt: 'Edit this message:', lookDrawTip: 'Draw the three UI pieces with the image API',
      schedulePlaceholder: 'e.g. in 30 minutes remind me to drink water',
    }

    const VENDORS = [
      { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api', provider: 'openai-compatible' },
      { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', provider: 'openai-compatible' },
      { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com', provider: 'openai-compatible' },
      { id: 'moonshot', label: 'Moonshot (Kimi)', baseURL: 'https://api.moonshot.cn', provider: 'openai-compatible' },
      { id: 'anthropic', label: 'Anthropic', baseURL: 'https://api.anthropic.com', provider: 'anthropic' },
      { id: 'gemini', label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com', provider: 'gemini' },
      { id: 'ollama', label: 'Ollama (本地)', baseURL: 'http://127.0.0.1:11434', provider: 'openai-compatible' },
      { id: 'lmstudio', label: 'LM Studio (本地)', baseURL: 'http://127.0.0.1:1234', provider: 'openai-compatible' },
    ]
    const MSG_ZH = {
      'same-origin requests only': '仅允许同源请求',
      'the last pet cannot be deleted': '最后一个桌宠无法删除',
      'credentials service unavailable': '凭据服务不可用',
      'no such conversation': '未找到该对话',
      'no such message': '未找到该消息',
      'nothing to say': '消息内容为空',
      'that pet is too large (64 KB of text and settings)': '桌宠数据过大(文本与设置合计不可超过 64 KB)',
      'there is no chat history to read yet': '尚无可读取的历史对话',
      'the user profile is off; turn it on in the dsh panel first': '用户画像未启用;请先在设置中开启',
      'the set needs a name': '请先填写套装名称',
      'this pet has no UI drawings to save yet — import or generate them first': '该桌宠尚无界面素材可保存;请先导入或生成',
      'no such set': '未找到该套装',
      'that set is empty': '该套装为空',
      'none of those are UI parts': '文件中没有可用的界面素材',
      'that file name cannot be used': '该文件名不可用',
      'no file content': '文件内容为空',
      'the file is over 20 MB': '文件超过 20 MB',
      'transcription failed': '语音转写失败',
      'body too large': '请求体过大',
      'network error': '网络请求失败',
      'no audio': '没有音频内容',
      'could not read a time out of that': '无法从输入中解析出时间',
      'unknown window variant': '未知的窗口形态',
      'a pet window left by an earlier dsh run is still open; close it from its own tray menu': '上一次 dsh 运行留下的桌宠窗口仍在;请从它的托盘菜单关闭后重试',
      'that credential belongs to another module': '该凭据由其他模块管理,请到对应设置页操作',
      'no permission': '未授予权限',
      'the user said no': '用户已拒绝',
      'timed out waiting for the user': '等待确认超时',
    }
    const msgZh = m => { const key = String(m ?? ''); return (zh && MSG_ZH[key]) || key }

    let T = makeT(zh)
    /** A chat the owner never spoke in (a proactive line, a task announcement) is an aside: folded unless asked for. */
    const isAside = c => typeof c?.userMessages === 'number' && c.userMessages === 0 && c.messages > 0
    const asideCount = chats => chats.filter(isAside).length
    const visibleChats = (chats, showAsides) => (showAsides ? chats : chats.filter(c => !isAside(c)))
    const S = {
      section: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 2px 24px', fontSize: '13px' },
      card: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-alias-border-l1)' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      head: { fontWeight: 600, fontSize: '13px' },
      label: { minWidth: '96px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' },
      input: { padding: '5px 9px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'inherit', fontSize: '12.5px' },
      area: { padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'inherit', fontSize: '12.5px', width: '100%', minHeight: '90px', fontFamily: 'inherit' },
      note: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.6 },
      btn: { padding: '5px 11px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', cursor: 'pointer' },
    }
    const api = async (path, body) => {
      const init = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      let r
      try { r = await fetch('/dsh-desktop-pet' + path, init) } catch { return { ok: false, message: 'network error' } }
      try { return await r.json() } catch { return { ok: false, message: 'HTTP ' + r.status } }
    }

    // ── the floating pet inside dsh ─────────────────────────────────────────
    const store = window.__dshPetStore__ ?? (window.__dshPetStore__ = { open: localStorage.getItem('dsh-pet-open') === '1', reader: null, workspace: false, listeners: new Set() })
    const tell = () => { for (const fn of store.listeners) fn() }
    const setOpen = value => { store.open = value; localStorage.setItem('dsh-pet-open', value ? '1' : '0'); tell() }
    /** Which conversation the reader is showing, or null for closed. */
    /** Whether the conversation workspace is open over the page. */
    const setWorkspace = value => { store.workspace = value; tell() }

    /**
     * Wake the pet, or send it away. There is one pet and one window: which window it appears in is
     * the pet's own `variant` setting, and waking it in one form ends the other. Two pets on one
     * desktop, each polling the same queue and answering the same owner, is nobody's idea of a pet.
     */
    async function wakePet(on, variantOverride) {
      const st = await api('/status')
      const petId = st?.config?.activeId
      const variant = variantOverride ?? st?.active?.window?.variant ?? 'in-app'
      if (!on) {
        setOpen(false)
        return petId ? api('/window/stop', { pet: petId }) : undefined
      }
      if (variant === 'in-app') {
        // Whatever is on the desktop goes first, then the panel opens.
        if (petId) await api('/window/stop', { pet: petId })
        setOpen(true)
        return
      }
      setOpen(false)
      if (petId) return api('/window/start', { pet: petId, variant })
    }

    const MEDIA_MARKER = /\[\[dsh-media:([a-z]{3}-\d{8}-\d{6}-[0-9a-f]{6})\]\]/
    /** A pet line may carry a generated file; show it instead of the raw marker. */
    function petLine(text) {
      const match = MEDIA_MARKER.exec(text ?? '')
      if (!match) return { text, mediaId: '' }
      return { text: String(text).replace(MEDIA_MARKER, '').trim(), mediaId: match[1] }
    }
    const mediaKind = id => (id.startsWith('img') ? 'img' : id.startsWith('vid') ? 'video' : 'audio')

    /**
     * The pet's own look, turned into the handful of CSS values every surface needs. A translucent
     * fill over a blurred backdrop is what makes a bubble read as glass rather than as a box; the
     * owner sets the colour, how see-through it is, how frosted, and how round.
     */
    const DEFAULT_THEME = { bg: '#141821', text: '#e9edf6', accent: '#6aa3ff', radius: 16, blur: 0, opacity: 1, fontSize: 13, ui: 'plain', slice: 28 }
    const uiArt = (petId, part) => `/dsh-desktop-pet/ui?pet=${encodeURIComponent(petId)}&part=${part}`
    /**
     * One drawing, stretched to whatever the sentence needs: the corners are kept and only the
     * middle is pulled, which is what `border-image` does natively. `inset` is how thick the kept
     * border is on screen; the slice percentage says where the middle starts in the drawing.
     */
    const nineSlice = (url, slice, inset) => ({
      borderStyle: 'solid',
      borderWidth: inset + 'px',
      borderImageSource: 'url("' + url + '")',
      borderImageSlice: slice + '% fill',
      borderImageRepeat: 'stretch',
      background: 'transparent',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      boxShadow: 'none',
      borderRadius: 0,
    })

    function glassOf(theme, petId) {
      const t = { ...DEFAULT_THEME, ...(theme && typeof theme === 'object' ? theme : {}) }
      const hex = /^#[0-9a-f]{6}$/i.test(String(t.bg)) ? String(t.bg) : DEFAULT_THEME.bg
      const rgb = [1, 3, 5].map(n => parseInt(hex.slice(n, n + 2), 16)).join(', ')
      const blur = Number(t.blur) > 0 ? `blur(${Math.round(t.blur)}px) saturate(1.6)` : 'none'
      const fill = `rgba(${rgb}, ${Number(t.opacity) || DEFAULT_THEME.opacity})`
      return {
        ...t,
        fill,
        panel: `rgba(${rgb}, ${Math.min(1, (Number(t.opacity) || DEFAULT_THEME.opacity) + 0.16)})`,
        // Never translucent: text being typed has to stay readable over whatever is behind the
        // window, and a frosted field turns it to mush.
        field: hex,
        blurCss: blur,
        art: t.ui === 'art' && typeof petId === 'string' && petId.length > 0,
        /** The drawn input bar and send key, for the surfaces that have a composer. */
        fieldArt: () => nineSlice(uiArt(petId, 'input'), Math.round(t.slice ?? 28), 14),
        buttonArt: () => nineSlice(uiArt(petId, 'button'), Math.round(t.slice ?? 28), 12),
        // One square corner on the side the message comes from, the owner's radius on the rest —
        // unless the pet has a drawn UI, in which case the drawing is the bubble.
        bubble(mine) {
          const r = Math.round(Number(t.radius) >= 0 ? t.radius : DEFAULT_THEME.radius)
          if (t.ui === 'art' && typeof petId === 'string' && petId.length > 0) {
            return {
              alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              padding: '2px 4px', fontSize: Math.round(Number(t.fontSize) || DEFAULT_THEME.fontSize) + 'px', lineHeight: 1.6,
              color: t.text,
              ...nineSlice(uiArt(petId, 'bubble'), Math.round(t.slice ?? 28), 18),
            }
          }
          return {
            alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            padding: '8px 12px', fontSize: Math.round(Number(t.fontSize) || DEFAULT_THEME.fontSize) + 'px', lineHeight: 1.6,
            borderRadius: mine ? `${r}px ${r}px 4px ${r}px` : `${r}px ${r}px ${r}px 4px`,
            background: mine
              ? `color-mix(in srgb, ${t.accent} 26%, ${fill})`
              : fill,
            backdropFilter: blur, WebkitBackdropFilter: blur,
            border: '1px solid rgba(255,255,255,.10)', boxShadow: '0 6px 22px rgba(0,0,0,.26)',
            color: t.text,
          }
        },
      }
    }

    function FloatingPet() {
      const [, force] = React.useReducer(x => x + 1, 0)
      const [lines, setLines] = React.useState([])
      const [pet, setPet] = React.useState(null)
      const [sprite, setSprite] = React.useState('')
      const [motion, setMotion] = React.useState('none')
      // A sprite with several drawings is a real frame animation: `play` is what to show now.
      const [play, setPlay] = React.useState({ frames: 1, fps: 12, loop: 'pingpong' })
      const [frame, setFrame] = React.useState(1)
      React.useEffect(installMotionStyles, [])
      const [busy, setBusy] = React.useState(false)
      const [text, setText] = React.useState('')
      // Bottom right, not top left: the top of the page is where the sidebar and its glow are, and
      // a pet parked on top of them looks like a bug rather than a pet. Dragged once, it stays put.
      // Bottom right, clear of the sidebar; in a short window it rides up rather than off-screen.
      const defaultPos = () => ({
        x: Math.max(16, (window.innerWidth || 1200) - 296),
        y: Math.max(16, (window.innerHeight || 800) - 420),
      })
      const [pos, setPos] = React.useState(() => {
        try {
          // The stamp is written on EVERY first run, not only when a position already exists:
          // otherwise a fresh install that deliberately parks the pet top-left gets "migrated"
          // away on its second load, because the stamp was never set.
          const legacy = localStorage.getItem('dsh-pet-pos-v') !== '2'
          localStorage.setItem('dsh-pet-pos-v', '2')
          const saved = JSON.parse(localStorage.getItem('dsh-pet-pos') ?? 'null')
          if (!saved || typeof saved.x !== 'number') return defaultPos()
          // A position saved before the pet stopped defaulting to the top left is still the top
          // left, and that is where the sidebar and the page's own glow are. Anything parked over
          // the sidebar is moved once; anywhere else the owner put it is left alone.
          if (legacy && saved.x < 320 && saved.y < 320) {
            const fresh = defaultPos()
            localStorage.setItem('dsh-pet-pos', JSON.stringify(fresh))
            return fresh
          }
          return saved
        } catch { return defaultPos() }
      })
      const since = React.useRef(0)
      const drag = React.useRef(null)
      // Cards the owner already clicked, so a stale /status snapshot cannot bring them back.
      const answered = React.useMemo(() => new Set(), [])
      React.useEffect(() => { store.listeners.add(force); return () => store.listeners.delete(force) }, [])
      React.useEffect(() => {
        if (!store.open) return undefined
        let alive = true
        const audio = new Audio()
        let first = true
        let watching = ''
        const tick = async () => {
          const s = await api('/status')
          if (!alive) return
          if (s.ok !== false) setPet(s.active)
          const petId = s?.config?.activeId
          if (!petId) return
          // Cards come from /status, not from the queue: the queue drain de-duplicates poorly on
          // reopen, and a card raised by a NON-active pet never reaches this pet's queue at all —
          // it used to time out unseen. /permission answers by id, so any pet's card works here.
          if (s.ok !== false) {
            const cards = (s.pending ?? [])
              .filter(x => !answered.has(x.id))
              .map(x => ({ kind: 'perm', id: x.id, text: x.text ?? x.effect ?? '', effect: x.effect ?? '' }))
            setLines(l => {
              const live = new Set(cards.map(x => x.id))
              const kept = l.filter(x => x.kind !== 'perm' || live.has(x.id))
              const have = new Set(kept.filter(x => x.kind === 'perm').map(x => x.id))
              const add = cards.filter(x => !have.has(x.id))
              return add.length === 0 && kept.length === l.length ? l : [...kept, ...add].slice(-15)
            })
          }
          // A different pet is a different queue: carrying the old cursor over would skip
          // everything the new pet had said before roughly the same sequence number.
          if (watching !== petId) { watching = petId; first = true }
          if (first) {
            // Start from what the queue holds now — reopening the pet must not replay old lines —
            // but a permission request that is still waiting has to be shown, not skipped.
            first = false
            // Show the pet straight away rather than the placeholder: without this it stays a blue
            // blob until it happens to speak, which on a quiet setting is half an hour away.
            const boot = (s.active?.expressions ?? [])[0] ?? (s.active?.actions ?? [])[0]
            if (boot) {
              setSprite(boot.name)
              setMotion(boot.motion || 'none')
              setPlay({ frames: boot.frames || 1, fps: boot.fps || 12, loop: boot.loop || 'pingpong' })
              setFrame(1)
            }
            const current = await api('/window-state?pet=' + encodeURIComponent(petId) + '&since=0')
            if (!alive) return
            since.current = current.seq ?? 0
            return
          }
          const state = await api('/window-state?pet=' + encodeURIComponent(petId) + '&since=' + since.current)
          if (!alive || state.ok === false) return
          since.current = state.seq ?? since.current
          for (const item of state.items ?? []) {
            if (item.permission) continue          // cards are reconciled from /status above
            if (item.text) setLines(l => [...l.slice(-14), { kind: 'pet', ...petLine(item.text) }])
            if (item.expression) {
              setSprite(item.expression)
              setMotion(item.motion || 'none')
              setPlay({ frames: item.frames || 1, fps: item.fps || 12, loop: item.loop || 'pingpong' })
              setFrame(1)
            }
            if (item.audio) { audio.src = item.audio; audio.play().catch(() => {}) }
          }
        }
        const timer = setInterval(tick, 2000)
        tick()
        return () => { alive = false; clearInterval(timer) }
      }, [store.open])

      const spriteFrame = (n) => (pet && sprite ? `/dsh-desktop-pet/sprite?pet=${encodeURIComponent(pet.id)}&name=${encodeURIComponent(sprite)}&frame=${n}` : '')
      // A viewer who asked for less motion gets the first drawing and nothing else — the CSS rule
      // only stops CSS animations, and a frame run is a timer, not an animation.
      const stillPlease = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const frameCount = stillPlease ? 1 : Math.max(1, Math.min(24, Math.round(play.frames) || 1))
      // Walk the frames on a timer, forwards and then back so the loop always joins.
      React.useEffect(() => {
        if (!pet || !sprite || frameCount < 2) return undefined
        const order = []
        for (let n = 1; n <= frameCount; n++) order.push(n)
        if (play.loop !== 'forward') for (let n = frameCount - 1; n > 1; n--) order.push(n)
        let at = 0
        const id = setInterval(() => { at = (at + 1) % order.length; setFrame(order[at]) },
          Math.max(33, Math.round(1000 / Math.min(30, Math.max(1, play.fps || 12)))))
        return () => clearInterval(id)
      }, [pet && pet.id, sprite, frameCount, play.fps, play.loop])
      // Every hook has now run. React counts them per render, so an early return above this line
      // would make opening and closing the pet look like two different components — which is what
      // "the button disappears when you click it" was: the shell caught the hook-count error and
      // replaced the whole entry, buttons and all.
      if (!store.open) return null
      const send = async () => {
        const value = text.trim()
        if (!value || !pet) return
        setText('')
        setLines(l => [...l.slice(-14), { kind: 'me', text: value }])
        setBusy(true)
        const out = await api('/say', { pet: pet.id, text: value })
        setBusy(false)
        if (out.ok === false) setLines(l => [...l.slice(-14), { kind: 'pet', text: T.failed + msgZh(out.message) }])
      }
      const onPointerDown = e => {
        drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      const onPointerMove = e => {
        if (!drag.current) return
        const next = { x: Math.max(0, e.clientX - drag.current.x), y: Math.max(0, e.clientY - drag.current.y) }
        setPos(next)
      }
      const onPointerUp = () => { drag.current = null; localStorage.setItem('dsh-pet-pos', JSON.stringify(pos)) }
      const skin = glassOf(pet && pet.theme, pet && pet.id)
      return h('div', {
        style: {
          position: 'fixed', left: pos.x + 'px', top: pos.y + 'px', zIndex: 60, width: '268px',
          background: skin.panel, backdropFilter: skin.blurCss, WebkitBackdropFilter: skin.blurCss,
          border: '1px solid rgba(255,255,255,.12)', borderRadius: Math.round(skin.radius + 4) + 'px',
          boxShadow: '0 18px 50px rgba(0,0,0,.38)', overflow: 'hidden', fontSize: '12.5px', color: skin.text,
        },
      },
        h('div', {
          onPointerDown, onPointerMove, onPointerUp,
          style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 11px', cursor: 'move', borderBottom: '1px solid rgba(255,255,255,.10)' },
        },
          h('span', { style: { fontWeight: 600 } }, pet?.name ?? T.title),
          busy ? h('span', { style: S.note }, T.think) : null,
          h('span', { style: { flex: 1 } }),
          h('button', { style: { ...S.btn, padding: '2px 8px' }, onClick: () => wakePet(false), title: T.sleep }, '×'),
        ),
        h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px', height: '136px' } },
          pet && sprite
            // Every frame is its own element, mounted once and then only shown or hidden: sprites
            // are served no-store, so re-pointing one <img> would re-request the file every tick.
            // A single drawing gets the named CSS motion instead, run at the display's own rate.
            ? Array.from({ length: frameCount }, (_, i) => h('img', {
              key: i,
              src: spriteFrame(i + 1),
              alt: sprite,
              className: frameCount < 2 && motion && motion !== 'none' ? 'dsh-pet-motion-' + String(motion).replace(/[^a-z]/g, '') : '',
              // A fixed box, not just a maximum: an <img> that has not decoded yet is 0×0, and a
              // frame run that collapses and re-expands twelve times a second shakes the whole
              // sidebar under it. `contain` keeps the drawing's own shape inside that box.
              style: { width: '120px', height: '120px', objectFit: 'contain', borderRadius: '10px', display: i + 1 === frame ? 'block' : 'none' },
              // Frame 1 missing means no sprite at all; a later one missing means the run is shorter
              // than the count says, and playing on would blink a broken image into the pet.
              // Math.min, because with several frames missing every one of them fires this and
              // the unordered updates used to leave the count one past the last real drawing.
              onError: i === 0 ? () => setSprite('') : () => { setPlay(p => ({ ...p, frames: Math.min(p.frames, i) })); setFrame(1) },
            }))
            // Nothing rather than a stand-in: the sprite arrives a moment later either way, and a
            // blue blob in between reads as "the pet broke" every time the panel opens.
            : h('div', { style: { width: '86px', height: '86px' } }),
        ),
        h('div', { style: { maxHeight: '210px', overflowY: 'auto', padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: '6px' } },
          lines.map((line, i) => line.kind === 'perm'
            ? h('div', { key: i, style: { padding: '6px 8px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-3)', border: '1px solid var(--dsw-alias-border-l1)' } },
              h('div', null, line.text),
              h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
                // Removed by id, not object identity: a /status that was in flight when the button
                // was pressed re-adds the same card as a NEW object for one tick otherwise.
                h('button', { style: S.btn, onClick: async () => { answered.add(line.id); await api('/permission', { id: line.id, allowed: true }); setLines(l => l.filter(x => x.id !== line.id)) } }, T.allow),
                h('button', { style: S.btn, onClick: async () => { answered.add(line.id); await api('/permission', { id: line.id, allowed: false }); setLines(l => l.filter(x => x.id !== line.id)) } }, T.deny),
              ),
            )
            : h('div', { key: i, style: skin.bubble(line.kind === 'me') },
            line.text,
            line.mediaId
              ? h(mediaKind(line.mediaId), {
                src: '/dsh-media-lab/file/' + line.mediaId,
                controls: mediaKind(line.mediaId) !== 'img',
                style: { maxWidth: '100%', borderRadius: '8px', display: 'block', marginTop: '4px' },
              })
              : null,
            ),
          ),
        ),
        h('div', { style: { display: 'flex', gap: '6px', padding: '8px', borderTop: '1px solid rgba(255,255,255,.10)' } },
          h('input', {
            // Never see-through: what is being typed has to stay readable whatever is behind the
            // pet. Either the drawn input bar, or a solid field in the pet's own colour.
            style: skin.art
              ? { ...S.input, flex: 1, color: skin.text, ...skin.fieldArt() }
              : { ...S.input, flex: 1, background: skin.field, color: skin.text, border: '1px solid rgba(255,255,255,.16)' },
            value: text, placeholder: T.talk,
            onChange: e => setText(e.target.value), onKeyDown: e => { if (e.key === 'Enter') send() },
          }),
          h('button', {
            // The drawn key eats twelve pixels a side as its border, so the label needs room told
            // to it explicitly or it wraps in the middle of a two-character word.
            style: skin.art
              ? { ...S.btn, color: skin.text, whiteSpace: 'nowrap', minWidth: '78px', textAlign: 'center', ...skin.buttonArt() }
              : { ...S.btn, background: skin.accent, color: '#fff', border: 'none' },
            onClick: send,
          }, T.send),
        ),
      )
    }

    // ── settings ────────────────────────────────────────────────────────────
    const Field = ({ label, children }) => h('div', { style: S.row }, h('span', { style: S.label }, label), children)

    function PetSettings() {
      const [status, setStatus] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [key, setKey] = React.useState('')
      const [lore, setLore] = React.useState([])
      const [chats, setChats] = React.useState([])
      const [showAsides, setShowAsides] = React.useState(false)
      const [schedules, setSchedules] = React.useState([])
      const [providers, setProviders] = React.useState([])
      const [dshDefault, setDshDefault] = React.useState({ provider: '', model: '' })
      const [resolved, setResolved] = React.useState(null)
      // The pieces are served no-store but the browser still holds the decoded image; this makes the
      // preview show the file that was just imported rather than the one it replaced.
      const [uiVersion, setUiVersion] = React.useState(0)
      const [uiSets, setUiSets] = React.useState([])
      const [uiSetName, setUiSetName] = React.useState('')
      React.useEffect(() => { api('/ui-skins').then(r => setUiSets(r.sets ?? [])).catch(() => {}) }, [])
      const loadProviders = () => api('/providers').then(r => {
        setProviders(r.providers ?? [])
        if (r.default) setDshDefault(r.default)
        setResolved(r.resolved ?? null)
      }).catch(() => {})
      React.useEffect(() => { loadProviders() }, [])
      const refresh = React.useCallback(async () => {
        const s = await api('/status')
        setStatus(s)
        if (s.ok === false) return
        setDraft(JSON.parse(JSON.stringify(s.active)))
        const petId = s.config.activeId
        const [l, c, sc] = await Promise.all([
          api('/lore?pet=' + encodeURIComponent(petId)),
          api('/chats?pet=' + encodeURIComponent(petId)),
          api('/schedules?pet=' + encodeURIComponent(petId)),
        ])
        setLore(l.entries ?? [])
        setChats(c.chats ?? [])
        setSchedules(sc.schedules ?? [])
      }, [])
      React.useEffect(() => { refresh() }, [refresh])
      if (status === null) return h('div', { style: S.note }, '…')
      if (status.ok === false || !draft) return h('div', { style: S.note }, T.offline + (status.message ? `:${msgZh(status.message)}` : ''))
      const patch = next => setDraft({ ...draft, ...next })
      const patchIn = (group, next) => setDraft({ ...draft, [group]: { ...draft[group], ...next } })
      const save = async () => {
        const r = await api('/pet', { id: draft.id, pet: draft })
        setNote(r.ok === false ? T.failed + msgZh(r.message) : T.saved)
        // Status and draft only: a full refresh() would re-fetch the lorebook and silently wipe
        // entry edits staged in that card but not yet saved through its own button.
        const s = await api('/status')
        if (s.ok !== false) { setStatus(s); setDraft(JSON.parse(JSON.stringify(s.active))) }
      }
      const level = (group, field) => h('select', {
        style: { ...S.input, width: '130px' }, value: draft[group][field],
        onChange: e => patchIn(group, { [field]: e.target.value }),
      }, [['none', T.pNone], ['ask', T.pAsk], ['full', T.pFull]].map(([v, l]) => h('option', { key: v, value: v }, l)))

      const switchTo = async id => { await api('/config', { activeId: id }); await refresh() }
      return h('div', { style: S.section },
        h('div', { style: S.row },
          h('span', { style: S.label }, T.pets),
          h('select', {
            style: { ...S.input, width: '190px' }, value: status.config.activeId,
            onChange: e => switchTo(e.target.value),
          }, (status.pets ?? []).map(p => h('option', { key: p.id, value: p.id }, p.name || p.id))),
          h('button', {
            style: S.btn,
            onClick: async () => {
              const name = window.prompt(T.newPetName, '')
              if (name === null) return
              const r = await api('/pet', { id: 'pet-' + Date.now().toString(36), pet: { name: name.trim() || undefined }, activate: true })
              setNote(r.ok === false ? T.failed + msgZh(r.message) : T.saved)
              await refresh()
            },
          }, T.newPet),
          h('button', {
            style: S.btn,
            onClick: async () => {
              if (!window.confirm(T.deletePetConfirm)) return
              const r = await api('/pet/delete', { id: draft.id })
              setNote(r.ok === false ? T.failed + msgZh(r.message) : T.saved)
              await refresh()
            },
          }, T.deletePet),
        ),
        h('div', { style: S.row },
          h('label', { style: { ...S.row, gap: '6px' } },
            h('input', { type: 'checkbox', checked: status.config.enabled === true, onChange: async e => { await api('/config', { enabled: e.target.checked }); await refresh() } }),
            T.enable,
          ),
          h('button', { style: S.btn, onClick: () => setOpen(!store.open) }, store.open ? T.hide : T.open),
          status.media?.available ? null : h('span', { style: S.note }, T.mediaOff),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.persona),
          h(Field, { label: T.name }, h('input', { style: { ...S.input, width: '200px' }, value: draft.name, onChange: e => patch({ name: e.target.value }) })),
          h('textarea', { style: S.area, value: draft.persona.prompt, placeholder: T.personaPlaceholder, onChange: e => patchIn('persona', { prompt: e.target.value }) }),
          h(Field, { label: T.appearance }, h('input', { style: { ...S.input, flex: 1, minWidth: '260px' }, value: draft.persona.appearance, onChange: e => patchIn('persona', { appearance: e.target.value }) })),
          h(Field, { label: T.greeting }, h('input', { style: { ...S.input, flex: 1, minWidth: '260px' }, value: draft.persona.greeting, onChange: e => patchIn('persona', { greeting: e.target.value }) })),
          h(Field, { label: T.scope }, h('select', { style: { ...S.input, width: '260px' }, value: draft.personaScope, onChange: e => patch({ personaScope: e.target.value }) },
            h('option', { value: 'pet' }, T.scopePet), h('option', { value: 'global' }, T.scopeGlobal))),
        ),

        (() => {
          const borrowed = draft.llm.source === 'harness'
          const route = providers.find(p => p.route === draft.llm.harnessRoute)
          return h('div', { style: S.card },
            h('div', { style: S.head }, T.llm),
            h(Field, { label: T.source }, h('select', {
              style: { ...S.input, width: '260px' }, value: draft.llm.source,
              onChange: e => {
                const source = e.target.value
                // Borrowing with no route chosen would silently fall back to the pet's own block;
                // default to the first provider the harness has so the choice means something.
                const first = providers[0]
                patchIn('llm', source === 'harness' && !draft.llm.harnessRoute && first ? { source, harnessRoute: first.route } : { source })
              },
            }, h('option', { value: 'follow' }, T.sourceFollow), h('option', { value: 'harness' }, T.sourceHarness), h('option', { value: 'own' }, T.sourceOwn))),
            draft.llm.source === 'follow' ? h(React.Fragment, null,
              h('div', { style: S.note }, T.followSet + ':' + (dshDefault.provider || '—') + ' / ' + (dshDefault.model || '—') + ' · ' + T.followNow(resolved?.provider, resolved?.model, resolved?.baseURL)),
              h('div', { style: S.note }, T.followWhere),
            ) : borrowed
              ? h(React.Fragment, null,
                h(Field, { label: T.hProvider }, h('select', { style: { ...S.input, width: '260px' }, value: draft.llm.harnessRoute, onChange: e => patchIn('llm', { harnessRoute: e.target.value }) },
                  providers.length === 0 ? h('option', { value: '' }, T.noProvidersShort) : null,
                  !draft.llm.harnessRoute && providers.length > 0 ? h('option', { value: '' }, '—') : null,
                  draft.llm.harnessRoute && !providers.some(p => p.route === draft.llm.harnessRoute)
                    ? h('option', { value: draft.llm.harnessRoute }, '【DSH】' + draft.llm.harnessRoute + T.hGone) : null,
                  providers.map(p => h('option', { key: p.route, value: p.route, disabled: p.borrowable === false }, '【DSH】' + p.route + (p.borrowable === false ? T.hNoHost : p.baseURL ? ' — ' + p.baseURL : ''))))),
                h(Field, { label: T.model },
                  h('input', { style: { ...S.input, width: '300px' }, value: draft.llm.model, list: 'dsh-pet-harness-models', placeholder: (route?.models ?? [])[0]?.id ?? '', onChange: e => patchIn('llm', { model: e.target.value }) }),
                  h('datalist', { id: 'dsh-pet-harness-models' }, (route?.models ?? []).slice(0, 300).map(m => h('option', { key: m.id, value: m.id }, m.name)))),
                h('div', { style: S.note }, route ? T.borrowHint(route.keyEnv || '—') : T.noProviders),
              )
              : h(React.Fragment, null,
                h(Field, { label: T.vendor }, h('select', {
                  style: { ...S.input, width: '260px' },
                  value: (VENDORS.find(v => v.baseURL === draft.llm.baseURL) ?? { id: 'custom' }).id,
                  onChange: e => {
                    const v = VENDORS.find(x => x.id === e.target.value)
                    if (v) patchIn('llm', { baseURL: v.baseURL, provider: v.provider })
                  },
                }, ...VENDORS.map(v => h('option', { key: v.id, value: v.id }, v.label)), h('option', { value: 'custom' }, T.vendorCustom))),
                h(Field, { label: T.provider }, h('select', { style: { ...S.input, width: '200px' }, value: draft.llm.provider, onChange: e => patchIn('llm', { provider: e.target.value }) },
                  ['openai-compatible', 'anthropic', 'gemini'].map(v => h('option', { key: v, value: v }, v)))),
                h(Field, { label: T.baseURL }, h('input', { style: { ...S.input, flex: 1, minWidth: '260px' }, value: draft.llm.baseURL, placeholder: 'https://api.openai.com', onChange: e => patchIn('llm', { baseURL: e.target.value }) })),
                h(Field, { label: T.model }, h('input', { style: { ...S.input, width: '260px' }, value: draft.llm.model, placeholder: 'gpt-5-mini / claude-haiku-4.5 / gemini-3-flash', onChange: e => patchIn('llm', { model: e.target.value }) })),
                h(Field, { label: T.key },
                  h('input', { style: { ...S.input, width: '240px' }, type: 'password', value: key, placeholder: draft.llm.keyEnv, onChange: e => setKey(e.target.value) }),
                  h('button', { style: S.btn, onClick: async () => { const r = await api('/key', { pet: draft.id, value: key }); setKey(''); setNote(r.ok === false ? T.failed + msgZh(r.message) : T.saved); const s = await api('/status'); if (s.ok !== false) setStatus(s) } }, T.keySave),
                  h('button', { style: S.btn, onClick: async () => { if (!window.confirm(`${T.keyDeleteConfirm}(${draft.llm.keyEnv || 'DESKTOP_PET_API_KEY'})`)) return; const r = await api('/key', { pet: draft.id, value: '' }); setKey(''); setNote(r.ok === false ? T.failed + msgZh(r.message) : T.keyDeleted); const s = await api('/status'); if (s.ok !== false) setStatus(s) } }, T.keyDelete),
                  h('span', { style: S.note }, status.keySet?.[draft.id] ? T.keyStored : T.keyMissing),
                ),
                h('div', { style: S.note }, T.keyHint(draft.llm.keyEnv || 'DESKTOP_PET_API_KEY')),
                h('div', { style: S.row },
                  h('button', {
                    style: S.btn,
                    onClick: async () => {
                      const next = { ...draft, llmPreset: { provider: draft.llm.provider, baseURL: draft.llm.baseURL, model: draft.llm.model, keyEnv: draft.llm.keyEnv, temperature: draft.llm.temperature, maxTokens: draft.llm.maxTokens, maxInput: draft.llm.maxInput ?? 0 } }
                      setDraft(next)
                      const r = await api('/pet', { id: draft.id, pet: next })
                      setNote(r.ok === false ? T.failed + msgZh(r.message) : T.presetSaved)
                    },
                  }, T.presetSave),
                  draft.llmPreset ? h('button', {
                    style: S.btn,
                    onClick: () => patchIn('llm', { ...draft.llmPreset }),
                  }, T.presetLoad) : null,
                  draft.llmPreset ? h('span', { style: S.note }, `${draft.llmPreset.model || '?'} @ ${draft.llmPreset.baseURL || '?'}`) : null,
                ),
              ),
          )
        })(),

        h('div', { style: S.card },
          h(Field, { label: T.temp }, h('input', { type: 'number', min: 0, max: 2, step: 0.1, style: { ...S.input, width: '90px' }, value: draft.llm.temperature, onChange: e => patchIn('llm', { temperature: Number(e.target.value) }) })),
          h(Field, { label: T.maxTok }, h('input', { type: 'number', min: 64, max: 32000, step: 64, style: { ...S.input, width: '110px' }, value: draft.llm.maxTokens, onChange: e => patchIn('llm', { maxTokens: Number(e.target.value) }) })),
          h(Field, { label: T.maxInput }, h('input', { type: 'number', min: 0, max: 1000000, step: 512, style: { ...S.input, width: '120px' }, value: draft.llm.maxInput ?? 0, onChange: e => patchIn('llm', { maxInput: Number(e.target.value) }) })),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.permissions),
          h(Field, { label: T.screen }, level('permissions', 'screen')),
          h(Field, { label: T.control }, level('permissions', 'control')),
          h('div', { style: S.note }, zh
            ? '「每次询问」会在本页与桌宠窗口中先征求你的确认;「完全允许」表示桌宠可直接读取屏幕或操作鼠标键盘,请谨慎启用。'
            : '“Ask every time” asks for your confirmation here and in the pet window; “full access” lets the pet read the screen and drive the mouse and keyboard without asking.'),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.proactive),
          h('label', { style: { ...S.row, gap: '6px' } },
            h('input', { type: 'checkbox', checked: draft.proactive.enabled, onChange: e => patchIn('proactive', { enabled: e.target.checked }) }), T.proactiveOn),
          h(Field, { label: T.freq }, h('select', { style: { ...S.input, width: '200px' }, value: draft.proactive.frequency, onChange: e => patchIn('proactive', { frequency: e.target.value }) },
            [['low', T.low], ['medium', T.medium], ['high', T.high], ['chatty', T.chatty]].map(([v, l]) => h('option', { key: v, value: v }, l)))),
          h('label', { style: { ...S.row, gap: '6px' } }, h('input', { type: 'checkbox', checked: draft.proactive.screenshotFirst, onChange: e => patchIn('proactive', { screenshotFirst: e.target.checked }) }), T.shotFirst),
          h('label', { style: { ...S.row, gap: '6px' } }, h('input', { type: 'checkbox', checked: draft.proactive.quietWhileBusy, onChange: e => patchIn('proactive', { quietWhileBusy: e.target.checked }) }), T.quiet),
          h('label', { style: { ...S.row, gap: '6px' } }, h('input', { type: 'checkbox', checked: draft.taskAwareness.enabled, onChange: e => patchIn('taskAwareness', { enabled: e.target.checked }) }), T.taskAware),
          h(Field, { label: T.longTask }, h('input', { type: 'number', min: 0, max: 240, style: { ...S.input, width: '90px' }, value: draft.taskAwareness.longTaskMinutes ?? 30, onChange: e => patchIn('taskAwareness', { longTaskMinutes: Number(e.target.value) }) })),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.voice),
          h('label', { style: { ...S.row, gap: '6px' } }, h('input', { type: 'checkbox', checked: draft.voice.enabled, onChange: e => patchIn('voice', { enabled: e.target.checked }) }), T.voiceOn),
          h('label', { style: { ...S.row, gap: '6px' } }, h('input', { type: 'checkbox', checked: draft.voice.autoSpeak, onChange: e => patchIn('voice', { autoSpeak: e.target.checked }) }), T.autoSpeak),
          h(Field, { label: T.ttsVoice }, h('input', { style: { ...S.input, width: '220px' }, value: draft.voice.ttsVoice, onChange: e => patchIn('voice', { ttsVoice: e.target.value }) })),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.search),
          h(Field, { label: T.searchFrom }, h('select', { style: { ...S.input, width: '200px' }, value: draft.search.mode, onChange: e => patchIn('search', { mode: e.target.value }) },
            [['follow', T.sFollow], ['own', T.sOwn], ['off', T.sOff]].map(([v, l]) => h('option', { key: v, value: v }, l)))),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.profile),
          h('div', { style: S.note }, T.profileHint),
          h('label', { style: { ...S.row, gap: '6px' } }, h('input', { type: 'checkbox', checked: draft.profile.enabled, onChange: e => patchIn('profile', { enabled: e.target.checked }) }), T.profileOn),
          h('textarea', { style: S.area, value: draft.profile.text, onChange: e => patchIn('profile', { text: e.target.value }) }),
          h('div', { style: S.row },
            h('button', {
              style: S.btn,
              onClick: async () => { setNote(T.working); const r = await api('/profile/refresh', { pet: draft.id }); setNote(r.ok === false ? T.failed + msgZh(r.message) : T.saved); await refresh() },
            }, T.refresh),
            draft.profile.updatedAt ? h('span', { style: S.note }, draft.profile.updatedAt.slice(0, 19).replace('T', ' ') + ' · ' + T.sessionsRead(draft.profile.sessionsRead)) : null,
          ),
        ),

        (() => {
          const skin = glassOf(draft.theme, draft.id)
          const slider = (label, field, min, max, step) => h(Field, { label },
            h('input', {
              type: 'range', min, max, step, value: draft.theme[field],
              style: { width: '150px' },
              onChange: e => patchIn('theme', { [field]: Number(e.target.value) }),
            }),
            h('span', { style: S.note }, String(draft.theme[field])),
          )
          const colour = (label, field) => h(Field, { label },
            h('input', {
              type: 'color', value: draft.theme[field], style: { width: '44px', height: '26px', padding: 0, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', background: 'transparent' },
              onChange: e => patchIn('theme', { [field]: e.target.value }),
            }),
            h('span', { style: S.note }, draft.theme[field]),
          )
          return h('div', { style: S.card },
            h('div', { style: S.head }, T.look),
            h('div', { style: S.note }, T.lookHint),
            colour(T.lookBg, 'bg'),
            colour(T.lookText, 'text'),
            colour(T.lookAccent, 'accent'),
            slider(T.lookOpacity, 'opacity', 0.25, 1, 0.01),
            slider(T.lookBlur, 'blur', 0, 40, 1),
            slider(T.lookRadius, 'radius', 0, 28, 1),
            slider(T.lookFont, 'fontSize', 10, 20, 1),
            draft.theme.ui === 'art' ? slider(T.lookSlice, 'slice', 8, 45, 1) : null,
            // The preview sits on a chequerboard, because what the owner is choosing is how much of
            // the desktop shows through.
            h('div', {
              style: {
                display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '12px',
                backgroundColor: '#2a2f3a',
                backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.06) 75%), linear-gradient(45deg, rgba(255,255,255,.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.06) 75%)',
                backgroundSize: '18px 18px', backgroundPosition: '0 0, 9px 9px',
              },
            },
            h('div', { style: skin.bubble(false) }, T.lookSample),
            h('div', { style: skin.bubble(true) }, T.lookSampleMine)),
            h(Field, { label: T.lookUi },
              h('select', { style: { ...S.input, width: '210px' }, value: draft.theme.ui, onChange: ev => patchIn('theme', { ui: ev.target.value }) },
                h('option', { value: 'plain' }, T.lookPlain), h('option', { value: 'art' }, T.lookArt)),
            ),
            h('div', { style: { ...S.row, gap: '10px', alignItems: 'flex-start' } }, [['bubble', T.partBubble], ['input', T.partInput], ['button', T.partButton]].map(([part, label]) => h('div', {
              key: part, style: { display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' },
            },
            // On a chequerboard, because what matters about these files is where they are see-through.
            h('div', {
              style: {
                width: '104px', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px',
                backgroundColor: '#2a2f3a',
                backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,.07) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.07) 75%), linear-gradient(45deg, rgba(255,255,255,.07) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.07) 75%)',
                backgroundSize: '12px 12px', backgroundPosition: '0 0, 6px 6px',
              },
            },
            h('img', {
              src: '/dsh-desktop-pet/ui?pet=' + encodeURIComponent(draft.id) + '&part=' + part + '&v=' + (uiVersion || 0),
              style: { maxWidth: '98px', maxHeight: '46px' }, alt: label,
              onError: ev => { ev.target.style.visibility = 'hidden' },
              onLoad: ev => { ev.target.style.visibility = 'visible' },
            })),
            h('label', { style: { ...S.btn, fontSize: '11px', padding: '3px 8px', cursor: 'pointer' } }, T.partImport,
              h('input', {
                type: 'file', accept: 'image/png,image/webp', style: { display: 'none' },
                onChange: async ev => {
                  const file = ev.target.files && ev.target.files[0]
                  if (!file) return
                  const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file) })
                  const out = await api('/asset', { pet: draft.id, name: '__ui-' + part + '.png', base64 })
                  setNote(out.ok === false ? T.failed + msgZh(out.message) : T.saved)
                  setUiVersion(Date.now())
                },
              })),
            h('span', { style: { ...S.note, fontSize: '10.5px' } }, label),
          ))),
          h('div', { style: S.note }, T.partHint),
          // The library: current pieces saved under a name, any saved set applied or deleted —
          // the same shape the skin system has, because that is what the furniture is.
          h('div', { style: { ...S.row, marginTop: '4px' } },
            h('input', { style: { ...S.input, width: '170px' }, value: uiSetName, placeholder: T.lookSetName, onChange: ev => setUiSetName(ev.target.value) }),
            h('button', {
              style: S.btn,
              onClick: async () => {
                const r = await api('/ui-skin/save', { pet: draft.id, name: uiSetName })
                setNote(r.ok === false ? T.failed + msgZh(r.message) : T.saved)
                if (r.ok !== false) { setUiSets(r.sets ?? []); setUiSetName('') }
              },
            }, T.lookSaveSet),
            h('button', {
              style: { ...S.btn, fontSize: '11px' },
              title: T.lookDrawTip,
              onClick: async () => {
                if (!window.confirm(T.lookDrawConfirm)) return
                setNote(T.lookDrawing)
                const r = await api('/ui-skin', { pet: draft.id })
                setNote(r.ok === false ? T.failed + msgZh(r.message) : (r.complete === false ? T.lookPartial : T.saved))
                setUiVersion(Date.now())
                await refresh()
              },
            }, T.lookDraw),
          ),
          uiSets.length === 0 ? h('div', { style: S.note }, T.lookNoSets) : null,
          ...uiSets.map(set => h('div', { key: set.name, style: { ...S.row, gap: '8px' } },
            ...['bubble', 'input', 'button'].map(part => h('img', {
              key: part,
              src: '/dsh-desktop-pet/ui-skin/part?name=' + encodeURIComponent(set.name) + '&part=' + part,
              style: { height: '26px', maxWidth: '58px', objectFit: 'contain' }, alt: part,
              onError: ev => { ev.target.style.visibility = 'hidden' },
            })),
            h('span', { style: { flex: 1, minWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              set.name + (set.complete ? '' : T.lookIncomplete)),
            h('button', {
              style: S.btn,
              onClick: async () => {
                const r = await api('/ui-skin/apply', { pet: draft.id, name: set.name })
                setNote(r.ok === false ? T.failed + msgZh(r.message) : (r.complete === false ? T.lookPartial : T.saved))
                setUiVersion(Date.now())
                await refresh()
              },
            }, T.lookApply),
            h('button', {
              style: S.btn,
              onClick: async () => {
                if (!window.confirm(T.lookDeleteConfirm)) return
                const r = await api('/ui-skin/delete', { name: set.name })
                if (r.ok !== false) setUiSets(r.sets ?? [])
              },
            }, T.del),
          )),
            h('div', { style: S.row },
              h('button', { style: S.btn, onClick: () => patch({ theme: { ...draft.theme, bg: '#141821', text: '#e9edf6', accent: '#6aa3ff', radius: 16, blur: 18, opacity: 0.72, fontSize: 13 } }) }, T.lookGlass),
              h('button', { style: S.btn, onClick: () => patch({ theme: { ...draft.theme, bg: '#0f1116', text: '#e9edf6', accent: '#7c8aa5', radius: 6, blur: 0, opacity: 1, fontSize: 13 } }) }, T.lookFlat),
              h('button', { style: S.btn, onClick: () => patch({ theme: { ...draft.theme, bg: '#fdf6ec', text: '#3a2f26', accent: '#d98b4a', radius: 20, blur: 14, opacity: 0.78, fontSize: 13 } }) }, T.lookWarm),
            ),
          )
        })(),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.expressions),
          ...draft.expressions.map((e, i) => h('div', { key: i, style: S.row },
            h('input', { style: { ...S.input, width: '110px' }, value: e.name, placeholder: T.exprName, onChange: ev => { const list = [...draft.expressions]; list[i] = { ...e, name: ev.target.value }; patch({ expressions: list }) } }),
            h('input', { style: { ...S.input, width: '150px' }, value: e.asset, placeholder: T.exprAsset, onChange: ev => { const list = [...draft.expressions]; list[i] = { ...e, asset: ev.target.value }; patch({ expressions: list }) } }),
            h('input', { style: { ...S.input, flex: 1, minWidth: '120px' }, value: e.when, placeholder: T.exprWhen, onChange: ev => { const list = [...draft.expressions]; list[i] = { ...e, when: ev.target.value }; patch({ expressions: list }) } }),
            // 1 drawing plays the CSS motion; 8–24 of them (rest.png, rest-02.png…) play as frames.
            h('input', { type: 'number', min: 1, max: 24, style: { ...S.input, width: '64px' }, value: e.frames ?? 1, title: T.exprFrames, placeholder: T.exprFrames, onChange: ev => { const list = [...draft.expressions]; list[i] = { ...e, frames: Number(ev.target.value) }; patch({ expressions: list }) } }),
            h('input', { type: 'number', min: 1, max: 30, style: { ...S.input, width: '64px' }, value: e.fps ?? 12, title: T.exprFps, placeholder: T.exprFps, onChange: ev => { const list = [...draft.expressions]; list[i] = { ...e, fps: Number(ev.target.value) }; patch({ expressions: list }) } }),
            h('button', { style: S.btn, onClick: () => patch({ expressions: draft.expressions.filter((_, j) => j !== i) }) }, '×'),
          )),
          h('div', { style: S.row },
            h('button', { style: S.btn, onClick: () => patch({ expressions: [...draft.expressions, { name: '', asset: '', when: '', frames: 1, fps: 12 }] }) }, T.addExpr),
            h('label', { style: { ...S.btn, display: 'inline-flex', alignItems: 'center' } }, T.material,
              h('input', {
                type: 'file', style: { display: 'none' }, accept: 'image/*,.txt,.md,.json,.csv',
                onChange: async ev => {
                  const file = ev.target.files?.[0]
                  if (!file) return
                  const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file) })
                  const out = await api('/asset', { pet: draft.id, name: file.name, base64 })
                  setNote(out.ok === false ? T.failed + msgZh(out.message) : T.saved + ' ' + out.name)
                  await refresh()
                },
              })),
          ),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.lore),
          h('div', { style: S.note }, T.loreHint),
          h('div', { style: S.row },
            h('span', { style: S.label }, T.loreMode),
            h('select', { style: { ...S.input, width: '280px' }, value: draft.lorebook?.mode ?? 'override', onChange: e => patchIn('lorebook', { mode: e.target.value }) },
              h('option', { value: 'override' }, T.loreOverride), h('option', { value: 'coexist' }, T.loreCoexist)),
            h('span', { style: S.label }, T.loreScan),
            h('input', { type: 'number', min: 0, max: 50, style: { ...S.input, width: '70px' }, value: draft.lorebook?.scanDepth ?? 6, onChange: e => patchIn('lorebook', { scanDepth: Number(e.target.value) }) }),
            h('span', { style: S.label }, T.loreBudget),
            h('input', { type: 'number', min: 200, max: 50000, step: 100, style: { ...S.input, width: '90px' }, value: draft.lorebook?.budgetChars ?? 6000, onChange: e => patchIn('lorebook', { budgetChars: Number(e.target.value) }) }),
            h('label', { style: { ...S.note, display: 'flex', alignItems: 'center', gap: '4px' } },
              h('input', { type: 'checkbox', checked: draft.lorebook?.caseSensitive === true, onChange: e => patchIn('lorebook', { caseSensitive: e.target.checked }) }), T.loreCaseBook),
            h('label', { style: { ...S.note, display: 'flex', alignItems: 'center', gap: '4px' } },
              h('input', { type: 'checkbox', checked: draft.lorebook?.matchWholeWords === true, onChange: e => patchIn('lorebook', { matchWholeWords: e.target.checked }) }), T.loreWordBook),
          ),
          ...lore.map((e, i) => {
            const up = next => { const list = [...lore]; list[i] = { ...e, ...next }; setLore(list) }
            const tri = (value, onChange) => h('select', { style: { ...S.input, width: '96px' }, value: value === true ? 'on' : value === false ? 'off' : '', onChange: ev => onChange(ev.target.value === 'on' ? true : ev.target.value === 'off' ? false : null) },
              h('option', { value: '' }, T.loreInherit), h('option', { value: 'on' }, '✓'), h('option', { value: 'off' }, '✗'))
            const kwText = e.kwDraft ?? (Array.isArray(e.keywords) ? e.keywords.join(', ') : '')
            const kw2Text = e.kw2Draft ?? (Array.isArray(e.secondaryKeys) ? e.secondaryKeys.join(', ') : '')
            const splitKw = s => s.split(/[,，]/).map(x => x.trim()).filter(Boolean)
            return h('div', { key: i, style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
              h('div', { style: S.row },
                h('label', { style: { ...S.note, display: 'flex', alignItems: 'center', gap: '4px' } },
                  h('input', { type: 'checkbox', checked: e.enabled !== false, onChange: ev => up({ enabled: ev.target.checked }) }), T.loreOn),
                h('input', { style: { ...S.input, width: '130px' }, value: e.key ?? '', placeholder: T.key2, onChange: ev => up({ key: ev.target.value }) }),
                h('input', { style: { ...S.input, flex: 1, minWidth: '220px' }, value: e.content ?? '', placeholder: T.content, onChange: ev => up({ content: ev.target.value }) }),
                h('button', { style: S.btn, onClick: () => setLore(lore.filter((_, j) => j !== i)) }, '×'),
              ),
              h('div', { style: S.row },
                h('label', { style: { ...S.note, display: 'flex', alignItems: 'center', gap: '4px' } },
                  h('input', { type: 'checkbox', checked: e.constant === true || (e.constant === undefined && splitKw(kwText).length === 0), onChange: ev => up({ constant: ev.target.checked }) }), T.loreConst),
                h('input', { style: { ...S.input, width: '220px' }, value: kwText, placeholder: T.loreKw, onChange: ev => up({ kwDraft: ev.target.value, keywords: splitKw(ev.target.value) }) }),
                h('input', { style: { ...S.input, width: '160px' }, value: kw2Text, placeholder: T.loreKw2, onChange: ev => up({ kw2Draft: ev.target.value, secondaryKeys: splitKw(ev.target.value) }) }),
                h('span', { style: S.note }, T.loreLogic),
                h('select', { style: { ...S.input, width: '140px' }, value: e.selectiveLogic ?? 'andAny', onChange: ev => up({ selectiveLogic: ev.target.value }) },
                  [['andAny', T.logicAndAny], ['andAll', T.logicAndAll], ['notAny', T.logicNotAny], ['notAll', T.logicNotAll]].map(([v, l]) => h('option', { key: v, value: v }, l))),
                h('span', { style: S.note }, T.loreProb),
                h('input', { type: 'number', min: 0, max: 100, style: { ...S.input, width: '62px' }, value: e.probability ?? 100, onChange: ev => up({ probability: ev.target.value === '' ? 100 : Number(ev.target.value) }) }),
                h('span', { style: S.note }, T.loreOrder),
                h('input', { type: 'number', min: -100000, max: 100000, style: { ...S.input, width: '76px' }, value: e.order ?? 100, onChange: ev => up({ order: ev.target.value === '' ? 100 : Number(ev.target.value) }) }),
                h('span', { style: S.note }, T.loreDepth),
                h('input', { type: 'number', min: 0, max: 50, style: { ...S.input, width: '62px' }, value: e.scanDepth ?? '', onChange: ev => up({ scanDepth: ev.target.value === '' ? null : Number(ev.target.value) }) }),
                h('span', { style: S.note }, T.loreCase),
                tri(e.caseSensitive ?? null, v => up({ caseSensitive: v })),
                h('span', { style: S.note }, T.loreWord),
                tri(e.matchWholeWords ?? null, v => up({ matchWholeWords: v })),
              ),
            )
          }),
          h('div', { style: S.row },
            h('button', { style: S.btn, onClick: () => setLore([...lore, { key: '', content: '', enabled: true, constant: true, keywords: [], secondaryKeys: [], probability: 100, order: 100 }]) }, T.addLore),
            h('button', { style: S.btn, onClick: async () => {
              // One button, both halves of the card: the entries go to /lore, and the book
              // settings (mode / depth / budget) live on the pet document, so they are saved
              // here too — otherwise picking "coexist" and pressing this button kept override.
              const r = await api('/lore', { pet: draft.id, entries: lore.map(({ kwDraft, kw2Draft, ...rest }) => rest) })
              const r2 = r.ok === false ? r : await api('/pet', { id: draft.id, pet: draft })
              setNote(r.ok === false || r2.ok === false ? T.failed + msgZh((r.ok === false ? r : r2).message) : T.saved)
            } }, T.save),
          ),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.window),
          h(Field, { label: T.variant }, h('select', { style: { ...S.input, width: '280px' }, value: draft.window.variant, onChange: e => patchIn('window', { variant: e.target.value }) },
            [['in-app', T.vIn], ['winforms', T.vWin], ['webview', T.vWeb]].map(([v, l]) => h('option', { key: v, value: v }, l)))),
          // Both sides at once, by the shape it has now: a pet stretched to a different aspect is
          // the one thing that always looks wrong. The desktop window can also be dragged by its
          // bottom-right corner, or scaled with Ctrl + wheel.
          h(Field, { label: T.size },
            h('input', {
              type: 'range', min: 120, max: 900, step: 10, value: draft.window.width, style: { width: '190px' },
              onChange: e => {
                const width = Number(e.target.value)
                const ratio = draft.window.height / Math.max(1, draft.window.width)
                patchIn('window', { width, height: Math.round(width * ratio) })
              },
            }),
            h('span', { style: S.note }, draft.window.width + ' × ' + draft.window.height),
          ),
          h('div', { style: S.row },
            h('button', {
              style: S.btn,
              // Through the same door as the sidebar button — but with the variant the dropdown
              // shows right now, saved or not: starting the OLD form after the owner just picked a
              // new one is the opposite of what the button says.
              onClick: async () => { setNote(T.working); const r = await wakePet(true, draft.window.variant); setNote(r && r.ok === false ? T.failed + msgZh(r.message) : T.started) },
            }, T.start),
            h('button', {
              style: S.btn,
              onClick: async () => { const r = await wakePet(false); setNote(r && r.ok === false ? T.failed + msgZh(r.message) : T.stopped) },
            }, T.stop),
            status.windowRunning ? h('span', { style: S.note }, T.running) : null,
          ),
          h('div', { style: S.note }, T.reopenNote),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.chats),
          ...visibleChats(chats, showAsides).slice(0, 12).map(c => h('div', { key: c.id, style: S.row },
            h('span', { style: { flex: 1, minWidth: '160px' } }, `${String(c.startedAt).slice(0, 16).replace('T', ' ')} · ${c.title || T.untitled} · ${T.msgCount(c.messages)}`),
            h('button', { style: S.btn, onClick: async () => { await api('/chat/resume', { pet: draft.id, id: c.id }); setNote(T.resumed) } }, T.resume),
            h('button', { style: S.btn, onClick: async () => { await api('/chat/delete', { pet: draft.id, id: c.id }); await refresh() } }, T.del),
          )),
          asideCount(chats) > 0 ? h('div', { style: S.row }, h('button', { style: S.btn, onClick: () => setShowAsides(v => !v) }, (showAsides ? T.hideAsides : T.showAsides) + ' · ' + T.asides(asideCount(chats)))) : null,
          h('div', { style: S.row }, h('button', { style: S.btn, onClick: async () => { await api('/chat/new', { pet: draft.id }); await refresh() } }, T.newChat)),
        ),

        h('div', { style: S.card },
          h('div', { style: S.head }, T.schedules),
          ...schedules.map(s => h('div', { key: s.id, style: S.row },
            h('span', { style: { flex: 1 } }, `${new Date(s.at).toLocaleString()} · ${s.text}`),
            h('button', { style: S.btn, onClick: async () => { await api('/schedule/delete', { pet: draft.id, id: s.id }); await refresh() } }, '×'),
          )),
          h('div', { style: S.row },
            h('input', { style: { ...S.input, flex: 1, minWidth: '220px' }, id: 'dsh-pet-schedule', placeholder: T.schedulePlaceholder }),
            h('button', {
              style: S.btn,
              onClick: async () => {
                const input = document.getElementById('dsh-pet-schedule')
                const r = await api('/schedule', { pet: draft.id, text: input.value })
                setNote(r.ok === false ? T.failed + msgZh(r.message) : T.saved)
                input.value = ''
                await refresh()
              },
            }, T.addSchedule),
          ),
        ),

        h('div', { style: S.row },
          h('button', { style: { ...S.btn, borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' }, onClick: save }, T.save),
          note ? h('span', { style: S.note }, note) : null,
        ),
      )
    }

    /**
     * The pet's conversations, managed the way any other conversation is: a list on the left, the
     * conversation itself on the right, rename / delete / resume / new. It opens over the page from
     * one button in the sidebar, because the sidebar's own conversation list is a single slot that
     * belongs to the workspaces and cannot be shared.
     */
    function PetWorkspace() {
      const [, force] = React.useReducer(x => x + 1, 0)
      const [pets, setPets] = React.useState([])
      const [petId, setPetId] = React.useState('')
      const [chats, setChats] = React.useState([])
      const [showAsides, setShowAsides] = React.useState(false)
      const [current, setCurrent] = React.useState('')
      const [openId, setOpenId] = React.useState('')
      const [doc, setDoc] = React.useState(null)
      const [title, setTitle] = React.useState('')
      const [theme, setTheme] = React.useState(null)
      const [label, setLabel] = React.useState('')
      const [renamingArea, setRenamingArea] = React.useState(false)
      React.useEffect(() => { store.listeners.add(force); return () => store.listeners.delete(force) }, [])

      const loadList = React.useCallback(async (wanted) => {
        const st = await api('/status')
        if (st.ok === false) return
        const list = st.config?.pets ?? []
        setPets(list.map(p => ({ id: p.id, name: p.name })))
        const id = wanted || petId || st.config?.activeId || (list[0] ? list[0].id : '')
        setPetId(id)
        const mine = list.find(p => p.id === id)
        setTheme(mine ? mine.theme : null)
        setLabel((mine && mine.chatsLabel) || '')
        const c = await api('/chats?pet=' + encodeURIComponent(id))
        setChats(c.chats ?? [])
        setCurrent(c.current ?? '')
        return c.chats ?? []
      }, [petId])

      const openChat = React.useCallback(async (id) => {
        setOpenId(id)
        const r = await api('/chat?pet=' + encodeURIComponent(petId) + '&id=' + encodeURIComponent(id))
        if (r.ok === false) return
        setDoc(r.chat)
        setTitle((r.chat && r.chat.title) || '')
      }, [petId])

      React.useEffect(() => {
        if (!store.workspace) return
        loadList().then(list => {
          if (!openId && list && list.length > 0) openChat(list[0].id)
        })
      }, [store.workspace])

      if (!store.workspace) return null
      const close = () => setWorkspace(false)
      const skin = glassOf(theme, petId)
      const act = async (path, body) => {
        const r = await api(path, { pet: petId, chat: openId, ...body })
        if (r.ok !== false && r.chat) { setDoc(r.chat); await loadList() }
        return r
      }
      const messages = (doc && doc.messages) || []

      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(6,8,12,.62)',
        },
        onClick: e => { if (e.target === e.currentTarget) close() },
      },
      h('div', {
        style: {
          width: 'min(1080px, 94vw)', height: 'min(760px, 88vh)', display: 'flex',
          borderRadius: '16px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
          boxShadow: '0 30px 80px rgba(0,0,0,.5)', overflow: 'hidden',
        },
      },
      // ── the list ──
      h('div', { style: { width: '268px', flex: 'none', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--dsw-alias-border-l1)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '12px 12px 8px' } },
          renamingArea
            ? h('input', {
              style: { ...S.input, flex: 1, minWidth: 0 }, value: label, placeholder: T.chatsArea, autoFocus: true,
              onChange: e => setLabel(e.target.value),
              onKeyDown: e => { if (e.key === 'Enter') e.currentTarget.blur() },
              onBlur: async () => { await api('/pet', { id: petId, pet: { chatsLabel: label } }); setRenamingArea(false); loadList() },
            })
            : h('div', { style: { ...S.head, flex: 1 } }, label || T.chatsArea),
          h('button', { style: { ...S.btn, padding: '3px 7px' }, title: T.renameArea, onClick: () => setRenamingArea(!renamingArea) }, '✎'),
        ),
        pets.length > 1
          ? h('select', {
            style: { ...S.input, margin: '0 12px 8px' }, value: petId,
            onChange: e => { setOpenId(''); setDoc(null); loadList(e.target.value) },
          }, pets.map(p => h('option', { key: p.id, value: p.id }, p.name)))
          : null,
        h('div', { style: { padding: '0 12px 8px' } },
          h('button', {
            style: { ...S.btn, width: '100%' },
            onClick: async () => { await api('/chat/new', { pet: petId }); const list = await loadList(); if (list && list[0]) openChat(list[0].id) },
          }, T.newChat)),
        h('div', { style: { flex: 1, overflowY: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: '2px' } },
          chats.length === 0 ? h('div', { style: { ...S.note, padding: '6px 8px' } }, T.noChats) : null,
          ...visibleChats(chats, showAsides).map(c => h('button', {
            key: c.id,
            style: {
              ...S.btn, width: '100%', textAlign: 'left', border: 'none', padding: '7px 9px',
              background: c.id === openId ? 'var(--dsw-alias-bg-layer-3)' : 'transparent',
              display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'stretch',
            },
            onClick: () => openChat(c.id),
          },
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            (c.id === current ? '● ' : '') + (c.title || T.untitled)),
          h('span', { style: { ...S.note, fontSize: '10.5px' } },
            String(c.startedAt).slice(0, 16).replace('T', ' ') + ' · ' + T.msgCount(c.messages)))),
          asideCount(chats) > 0 ? h('button', { style: { ...S.btn, width: '100%', border: 'none', textAlign: 'left', padding: '7px 9px', color: 'var(--dsw-alias-label-secondary)' }, onClick: () => setShowAsides(v => !v) }, (showAsides ? T.hideAsides : T.showAsides) + ' · ' + T.asides(asideCount(chats))) : null,
        ),
      ),
      // ── the conversation ──
      h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          h('input', {
            style: { ...S.input, flex: 1, fontSize: '13px', fontWeight: 600 }, value: title, placeholder: T.untitled,
            disabled: !openId,
            onChange: e => setTitle(e.target.value),
            onBlur: () => openId && act('/chat/rename', { title }),
            onKeyDown: e => { if (e.key === 'Enter') e.currentTarget.blur() },
          }),
          h('button', { style: S.btn, disabled: !openId, onClick: () => act('/chat/resume', { id: openId }) }, T.resume),
          h('button', {
            style: S.btn, disabled: !openId,
            onClick: async () => {
              if (!window.confirm(T.delChatConfirm)) return
              await api('/chat/delete', { pet: petId, id: openId })
              setOpenId(''); setDoc(null)
              const list = await loadList()
              if (list && list[0]) openChat(list[0].id)
            },
          }, T.del),
          h('button', { style: { ...S.btn, padding: '5px 9px' }, onClick: close }, '×'),
        ),
        h('div', { style: { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
          messages.map(m => {
            const mine = m.role !== 'assistant'
            const line = petLine(m.text)
            const kind = line.mediaId ? mediaKind(line.mediaId) : ''
            return h('div', { key: m.id, style: { display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: '3px' } },
              h('div', { style: skin.bubble(mine) },
                line.text,
                kind ? h(kind === 'img' ? 'img' : kind, {
                  src: '/dsh-media-lab/file/' + line.mediaId,
                  controls: kind !== 'img',
                  style: { display: 'block', marginTop: '6px', maxWidth: '100%', borderRadius: '10px' },
                }) : null),
              h('div', { style: { ...S.note, display: 'flex', gap: '8px' } },
                h('span', null, String(m.at ?? '').slice(11, 16)),
                m.expression ? h('span', null, m.expression) : null,
                h('button', {
                  style: { ...S.btn, border: 'none', padding: '0 3px', fontSize: '11px' },
                  onClick: async () => {
                    const next = window.prompt(T.editPrompt, m.text)
                    if (next === null) return
                    await act('/chat/message', { id: m.id, op: 'edit', text: next })
                  },
                }, T.edit),
                h('button', { style: { ...S.btn, border: 'none', padding: '0 3px', fontSize: '11px' }, onClick: () => act('/chat/message', { id: m.id, op: 'delete' }) }, T.del),
              ),
            )
          }),
          openId && messages.length === 0 ? h('div', { style: S.note }, T.noMessages) : null,
          !openId ? h('div', { style: S.note }, T.pickChat) : null,
        ),
      )))
    }

    /**
     * Everything the pet puts in the sidebar, in one entry: two icon buttons, the floating pet and
     * the conversation workspace. The footer is a single non-wrapping row shared with the other
     * plugins, so this has to stay narrow and fixed — a wide entry here is what squeezes theirs.
     */
    /**
     * The sidebar footer is one `flex-direction: row; nowrap` line that every plugin registers into.
     * Collapsed, that line is about 57px wide and the entries in it add up to more than double
     * that, so the row overflows to the left and whatever is first is pushed off the screen. One
     * rule fixes it for all of them: let the line wrap.
     */
    function installFooterWrap() {
      const id = 'dsh-pet-footer-wrap'
      if (document.getElementById(id)) return
      const el = document.createElement('style')
      el.id = id
      el.textContent = '[class*="footerActions"]{flex-wrap:wrap;gap:4px;align-items:center}'
      document.head.appendChild(el)
    }

    function PetChatsPanel(props) {
      const [, force] = React.useReducer(x => x + 1, 0)
      const [onDesktop, setOnDesktop] = React.useState(false)
      React.useEffect(() => { store.listeners.add(force); return () => store.listeners.delete(force) }, [])
      React.useEffect(installFooterWrap, [])
      // The desktop window can also be closed from its own menu, so the button asks rather than
      // assumes: awake is "the panel is up" or "a window is running".
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          const st = await api('/status')
          if (alive && st.ok !== false) setOnDesktop(st.windowRunning === true)
        }
        tick()
        const timer = setInterval(tick, 4000)
        return () => { alive = false; clearInterval(timer) }
      }, [])
      // The shell tells the entry whether the sidebar is expanded; collapsed, two icons side by side
      // do not fit the rail, so they stack instead.
      const wide = props.wide !== false
      // 36px tall, 8px radius, the same hover — the row is shared with the cost meter and
      // the temp-chat button, and three plugins each inventing their own look is what it looked like.
      const icon = on => ({
        ...S.btn, width: '36px', height: '36px', flex: 'none', padding: 0, fontSize: '14px', lineHeight: '34px',
        textAlign: 'center', borderRadius: '8px', border: '1px solid transparent',
        // Quiet when it is on: an outline, not a filled block. A solid highlight in a rail of flat
        // icons is the one thing your eye lands on, which is not what "the pet is showing" deserves.
        background: 'transparent',
        borderColor: on ? 'var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))' : 'transparent',
        color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
      })
      const awake = store.open || onDesktop
      return h('div', { style: { display: 'flex', flexDirection: wide ? 'row' : 'column', gap: '4px', flex: 'none', alignItems: 'center', alignSelf: 'center' } },
        h('button', {
          style: icon(awake),
          title: awake ? T.sleep : T.wake,
          onClick: async () => { await wakePet(!awake); const st = await api('/status'); setOnDesktop(st.windowRunning === true) },
        }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { display: 'block', margin: 'auto' } }, h('path', { d: 'M12 20c-3 0-5-1.6-5-3.6 0-1.8 2.2-3.6 5-3.6s5 1.8 5 3.6c0 2-2 3.6-5 3.6z' }), h('circle', { cx: 7.5, cy: 9.5, r: 1.7 }), h('circle', { cx: 16.5, cy: 9.5, r: 1.7 }), h('circle', { cx: 10, cy: 5.5, r: 1.6 }), h('circle', { cx: 14, cy: 5.5, r: 1.6 }))),
        h('button', { style: icon(store.workspace), title: T.openChatsTip, onClick: () => setWorkspace(true) }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { display: 'block', margin: 'auto' } }, h('path', { d: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V16H7.5A2.5 2.5 0 0 1 5 13.5z' }), h('path', { d: 'M9 9h6M9 12h4' }))),
        // Both of these paint themselves over the page; neither takes part in this row's layout.
        h(FloatingPet, null),
        h(PetWorkspace, null),
      )
    }

    async function apply(ctx) {
      const pickLocale = () => { T = makeT(activeLocale(ctx).toLowerCase().startsWith('zh')) }
      pickLocale()
      try { ctx.locale?.subscribe?.(pickLocale) } catch { /* browser language stays */ }
      const slots = ctx.get('slots')
      if (slots === undefined) return

      slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'desktop-pet', order: 27, label: () => T.title }, PetSettings))
      // The conversations belong on the main page, not buried in settings. This is the sidebar's
      // one slot that takes several entries — `sidebar.workspaces` holds the workspace list itself
      // and registering there would shadow it rather than sit beside it. The reader is a fixed
      // overlay, so it rides along in the same entry and covers the page from wherever it mounts.
      slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'desktop-pet-chats', order: 22 }, PetChatsPanel))
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
