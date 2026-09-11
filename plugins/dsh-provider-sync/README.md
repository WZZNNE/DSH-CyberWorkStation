# dsh-provider-sync

**中文** | English below

让 OpenRouter 路由的模型清单自己保持最新,并给支持推理的模型写好思考强度档位。

## 它解决什么

`~/.dsh/settings.yaml` 里 `llm-pi-ai.providers.<openrouter 路由>.models` 是一次性拉下来的快照:之后发布的新模型不会出现;而且条目没有 `reasoningEfforts`,dsh 的推理等级选择器就会回答 "does not support reasoning effort",尽管 OpenRouter 的 API 本身接受 `reasoning.effort`。

## 它做什么

- 启动后(等设置服务就绪,且距上次同步超过间隔时)以及每 `intervalHours`(默认 24)拉一次公开的 `GET https://openrouter.ai/api/v1/models`(无需密钥),通过 dsh 的设置服务合并进每一个 OpenRouter 路由(与「模型」页同一条写入路径,由 core 校验)。
- 合并规则:新 id 追加到清单末尾(你原有的顺序不动);已有 id 的 name / contextWindow / maxTokens 只在「仍是本插件上次写的值(或目录值)」时刷新——你手改过的值原样保留;OpenRouter 路由下 `anthropic/` 开头的模型名后附「【claude系模型不可走openrouter原生api搜索,建议自己配置api】」,模型选择器里自然可见(联网搜索插件对 Claude 保留原模型走工具检索);`supported_parameters` 含 `reasoning` 且没有手写 `reasoningEfforts` 的模型写入 `{off: null, minimal, low, medium, high, xhigh, max}`(off 表示什么都不发,其余对应 `reasoning.effort`);`:online` 变体按其基础模型重推;手改过的字段与已从目录消失的 id 一律保留。
- 设置页卡片「模型清单同步」:上次同步、间隔、立即同步、每条路由的计数。

## 路由

`GET /dsh-provider-sync/status` · `POST /dsh-provider-sync/sync` · `POST /dsh-provider-sync/settings {intervalHours?, anthropicNote?}`(套件统一的本机 + 同源防线;类型不对回 400,不会悄悄重置)。配置文件 `~/.dsh/provider-sync.json`(含本插件写过的字段记录 `written`、自动写入的档位 `autoEfforts`、失败计数与上次尝试时间——失败后按 5 → 15 → 60 分钟退避重试)。凭据中心页/区的「刷新模型清单」按钮调用的就是 `/sync`。

**Claude 提示后缀**:OpenRouter 路由下所有 `anthropic/` 与手写的 `~anthropic/…-latest` 别名条目,名字后面都会附「【claude系模型不可走openrouter原生api搜索,建议自己配置api】」(用户指定的原句,任何界面语言都一样)——这是唯一会碰手写名字的情况,且只追加。设置卡片和启动器凭据页上的复选框对应 `anthropicNote`,关掉后下一次同步把提示从名字里去掉。

## 依据

- openrouter.ai/docs/api-reference/list-available-models — 字段 `id / name / context_length / top_provider.max_completion_tokens / supported_parameters`
- openrouter.ai/docs/use-cases/reasoning-tokens — `reasoning.effort`: max / xhigh / high / medium / low / minimal / none
- core `llm-pi-ai` 目录规则 — `reasoningEfforts` 里 `off` 可为 null(不发送),其余档位写线上的值;OpenRouter 路由由 pi-ai 以 `reasoning: { effort }` 发送。

---

# dsh-provider-sync (English)

Keeps every OpenRouter route's model list in DeepSeek Harness current, and declares reasoning-effort levels for the models that support them.

The list under `llm-pi-ai.providers.<route>.models` is a one-time snapshot: models released later never appear, and no entry carries `reasoningEfforts`, so the reasoning picker answers "does not support reasoning effort" although OpenRouter accepts `reasoning.effort`. This plugin pulls the public catalog on boot and every `intervalHours` (24 by default), merges it through the settings service (the same validated write the Models page makes), adds new ids, refreshes name / context window / output limit, writes `{off: null, minimal, low, medium, high, xhigh, max}` for reasoning-capable models that have no hand-written map, re-derives `:online` variants from their base, and never overwrites what you edited by hand. A Settings card shows the last sync, the interval, a sync-now button and per-route counts.

## Claude note and settings (English)

- Every Anthropic entry on an OpenRouter route — catalog ids and the hand-written `~anthropic/…-latest` aliases alike — gets the fixed suffix "【claude系模型不可走openrouter原生api搜索,建议自己配置api】" appended to its name (the owner's own wording, the same in every UI language). It marks that OpenRouter's native web search never answers a Claude request carrying the harness's tool schemas; dsh-web-search-plus keeps those models on the tool search. This is the one case where a hand-written name is touched, and only by appending. The checkbox on the Settings card (and on the launcher's Credentials page) is `anthropicNote`; turning it off strips the suffix at the next sync, which the toggle runs at once.
- `POST /dsh-provider-sync/settings` accepts `{ intervalHours?: whole number 1–720, anthropicNote?: boolean }`; anything else is a 400, never a silent reset.
- A failed sync is retried after 5, then 15, then 60 minutes; `status` reports `failures`, `lastAttemptAt`, and this run's per-route record (`models / added / updated / noted / reasoning / at`).
- Hand edits stay: name / contextWindow / maxTokens are refreshed only while the field still holds what this plugin wrote last (or the catalog value); new ids are appended, the owner's order is kept.
