---
name: control-deck-authoring
description: 为 DSH 控制甲板(dsh-control-deck)编写提示词条目、正则脚本、世界书条目与预设的工艺:字段含义、ST 兼容 JSON 格式、宏、触发与预算规则,以及落盘路径 ~/.dsh/control-deck.json(1.5 秒热载)。
whenToUse: 用户要求你帮他写/改控制甲板的提示词、正则、世界书(World Info / lorebook)、联网搜索触发规则或预设,或要把 SillyTavern 的世界书/正则/预设迁到 dsh 时。
---

# 控制甲板编写工艺

配置文件:`~/.dsh/control-deck.json`(启动器「控制甲板」页编辑;你也可以直接写文件,插件 1.5 秒内热载)。结构:

```json
{
  "presetName": "默认",
  "prompts":  [{ "name": "风格", "text": "用简洁中文回答。今天是 {{date}}。", "position": "system", "role": "system", "order": 100, "interval": 1, "enabled": true }],
  "regex":    [{ "name": "去表情", "findRegex": "\\p{Extended_Pictographic}", "flags": "gu", "replaceString": "", "trimStrings": [], "placement": ["user_input"], "enabled": true }],
  "lorebook": [{ "name": "城市", "keys": ["夜之城", "/night\\s*city/i"], "secondaryKeys": [], "selectiveLogic": "andAny", "content": "夜之城是……", "constant": false, "probability": 100, "order": 100, "caseSensitive": false, "matchWholeWords": true, "scanDepth": null, "group": "", "groupWeight": 100, "prioritize": false, "useGroupScoring": false, "sticky": 0, "cooldown": 0, "delay": 0, "excludeRecursion": false, "preventRecursion": false, "delayUntilRecursion": false, "enabled": true }],
  "sampling": { "enabled": false, "temperature": null, "maxTokens": null, "stop": [] },
  "settings": { "scanDepth": 6, "maxRecursionSteps": 2, "budgetChars": 8000, "includeNames": false, "minActivations": 0, "maxDepth": 0, "macros": true, "caseSensitive": false, "matchWholeWords": true },
  "disabledTools": []
}
```

## 规则速查

- **prompts**:`position=system` 进系统提示词(按 order 升序,每次组装重新展开宏;`{{model}} {{provider}} {{cwd}}` 由本体填充);`user-prefix` 与 `interval>1` 的条目作为一条单独的 plugin 来源上下文消息放在本步用户消息之后(用户原话不改);`interval=N` 每 N 条**用户**消息注入一次(作者注记;工具回合不计)。`role` 可为 system/user/assistant(仅标注,导出 ST 时带回)。宏:`{{date}} {{time}} {{weekday}} {{isodate}} {{isotime}} {{model}} {{provider}} {{workspace}} {{cwd}} {{newline}} {{random:a,b,c}} {{random::a::b}} {{roll:2d6}}`;其他 `{{…}}`(如 ST 的 `{{user}}`)在系统提示词里会被改成 `{user}`(本体渲染器对未知引用会报错)。重名条目自动加 `(2)` 后缀。
- **regex**:JS 正则,`flags` 原样使用(不含 `g` 只替换第一处,同 ST regexFromString);`replaceString` 同 ST runRegexScript:`{{match}}`(不分大小写,= `$0`)、`$1`…任意位数、`$<name>`,没有 `$$` 转义(`$$5` = `$` + 第 5 组),`$&` 是普通文字;`trimStrings` 从每个代入值中剔除;`placement`:`user_input`(只改写用户自己发的消息)、`world_info`(改写注入的世界书)、`ai_output`(只改网页显示,按渲染后的文本节点逐个匹配)。无效正则保存时报 400;ST 导入时 `promptOnly` 的 AI 输出脚本会禁用导入。
- **lorebook**:`keys` 纯文本或 `/re/flags`;副键逻辑 andAny/andAll/notAny/notAll;`constant` 常驻;`probability` 概率;分组按 `groupWeight` 抽一条,`prioritize` 时取最高 order,`useGroupScoring` 时取命中键最多者;`sticky/cooldown/delay` 按消息数;递归三开关 + 全局 `maxRecursionSteps`;`minActivations/maxDepth` 不够就往更早历史扫;`includeNames` 扫描文本带 `User:`/`Assistant:`;字符预算 `budgetChars`。`caseSensitive` / `matchWholeWords` 为 `null` 时跟随全局 `settings.caseSensitive`(默认 false)/ `settings.matchWholeWords`(默认 true);`delayUntilRecursion` 可为 true 或递归层级数。命中内容作为一条单独的上下文消息放在本步用户消息之后(≈ ST in-chat depth 0;注入内容不会被再次扫描)。
- **sampling**:`enabled=false` 完全不碰请求。最大上下文与每次回复的最大输出不在此处:按模型设置 `contextWindow` / `maxTokens`(启动器「模型参数」页,任何路由都可 / dsh-local-reasoning)。
- **联网搜索**:`~/.dsh/web-search.json`(启动器「联网搜索」页):`mode` off/tool/inject、`provider`、`triggers`(backticks/regex/phrases/always)、`template` 含 `{{query}} {{text}}`、`budgetChars`、`visitLinks`。
- **安全规则**:`~/.dsh/safe-guard.json` `{ "denyPatterns": [], "askPatterns": [] }`。

## SillyTavern 迁移

启动器「导入」支持:ST 世界书 JSON(`{entries:{…}}`,字段 key/keysecondary/selectiveLogic 0-3/constant/order/disable/probability/group/groupOverride/groupWeight/useGroupScoring/scanDepth/caseSensitive/matchWholeWords/递归/sticky/cooldown/delay)、ST 正则脚本 JSON(findRegex 可为 `/pattern/flags`,placement 1=用户输入 2=AI 输出 5=世界书)、ST 提示词预设(`prompts[]` 非 marker 条目 + `prompt_order`)。导出反向同理。

## 写作建议

1. 先用 1–3 条常驻提示词定风格,再用世界书放设定(按主题分条,keys 3–6 个同义词)。
2. 正则优先做"去噪"(表情、口癖),显示层规则用 `ai_output`,不要改变模型看到的内容。
3. 预算:世界书总注入 ≤ 上下文的 10–15%;本地小模型把 `budgetChars` 调低。
4. 每改完一项保存一次并在 dsh 里发一条消息验证。
