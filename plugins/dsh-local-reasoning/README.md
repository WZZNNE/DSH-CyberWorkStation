# dsh-local-reasoning

Per-model **context window / max output / thinking levels for every route** in DeepSeek Harness — DeepSeek official, OpenRouter and other catalog routes, and locally served models (LM Studio, Ollama, other local OpenAI-compatible gateways), which also get backend probing, recommended levels and automatic teaching. Managed from the DSH Launcher **Model parameters** page; no core code is patched.

## Install

```sh
dsh plugin --profile web add dsh-local-reasoning
```

Restart dsh afterwards. As part of [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation) the plugin is registered by `setup.cmd` from the repository checkout instead.

Its settings page is the DSH Launcher's Model parameters page. Without the launcher, the routes below and the file `~/.dsh/local-reasoning.json` drive it.

## Any route

`GET /status` lists every registered route (`ctx.llm.listProviders`), its models (`ctx.llm.listModels`) and the effective values the core resolved (`ctx.llm.resolveModelInfo`: `context.contextWindow`, `defaultMaxTokens`, `reasoning.efforts`). `POST /apply {route, modelId, changes}` writes `contextWindow` / `maxTokens` / `reasoningEfforts` / `compat.supportsReasoningEffort`: a route whose user profile carries a `models` list gets the entry edited; a catalog route gets `modelOverrides.<id>` (llm-pi-ai README: reshapes one catalog model, the rest keeps serving); the official DeepSeek route (`llm-deepseek` adapter) gets its `models` list rewritten with the numbers (image limits / modalities copied, levels are adapter-owned — the UI shows them locked), and when no number is left the list is unset so the adapter defaults return. Every write carries the descriptor revision and is retried on `SETTINGS_CONFLICT`.

## Auto-teach

Four seconds after boot (and on `POST /settings {teachNow:true}`) the plugin probes the local routes and writes the recommended levels for local models that declare none, so the native model picker offers them like any API model. `autoTeach: false` in `$DSH_HOME/local-reasoning.json` (or the switch on the page) turns it off; declared levels are never overwritten.

## Local routes (LM Studio / Ollama / other local gateways)

1. **Finds local routes** in the `llm-pi-ai` settings namespace (providers whose `baseURL` points at localhost / 127.0.0.1 / 192.168.x / …).
2. **Probes the backend**: LM Studio `GET /api/v0/models` (id, arch, state, max_context_length) + `GET /api/v1/models` (`loaded_instances[].config.context_length`, `capabilities.reasoning.allowed_options`) and Ollama `GET /api/tags`, `POST /api/show` (a few in flight at a time, each bounded), `GET /api/ps` → model list, loaded state, max / loaded context length, capabilities.
3. **Classifies the model family** and recommends settings:
   | family | kind | what dsh receives |
   |---|---|---|
   | Ollama model with the `thinking` capability (Qwen3, DeepSeek-R1, cogito …) | effort levels | `reasoningEfforts: {off: none, low, medium, high}` + `compat.supportsReasoningEffort: true` — Ollama's OpenAI endpoint accepts `reasoning_effort` none/low/medium/high/max (docs.ollama.com/api/openai-compatibility); level semantics follow docs.ollama.com/capabilities/thinking (true/false or low/medium/high/max, gpt-oss low/medium/high only) |
   | gpt-oss | effort levels | `{low, medium, high}` on both backends (the model always reasons; Ollama ignores true/false); LM Studio adds a route `api` hint to `openai-responses`, where `reasoning.effort` is documented (LM Studio API changelog 0.3.29) |
   | Qwen3 (non-instruct) on LM Studio | prompt soft switch — **on/off only** | `reasoningEfforts: {off, high}` with `compat.supportsReasoningEffort: false` (nothing on the wire) + the plugin appends `/no_think` or `/think` at `agent/pre-step` (Qwen3 model card: soft switch in user prompts, the model follows the most recent instruction). Qwen3's reasoning depth is a continuous thinking budget (Qwen3 blog), not discrete levels; LM Studio's OpenAI-compatible endpoint documents no reasoning level, and its native `/api/v1/chat` `reasoning` field is honoured per model (`capabilities.reasoning.allowed_options` in `/api/v1/models`; documented examples Gemma 4 `off/on`, R1 `on` — what a given Qwen3 build reports is a probe observation, shown on the page as "backend offers"), so the picker gets Off = no thinking, High = thinking |
   | R1 / QwQ / *-thinking on LM Studio | always thinks | `reasoningEfforts: false` — nothing to control over the OpenAI endpoint |
   | GLM-4.5+; LM Studio models whose v1 capabilities list only `off/on` | not switchable here | GLM needs `chat_template_kwargs` (the core can send it through `compat.thinkingFormat`, but LM Studio / Ollama do not document that field on their OpenAI endpoints); LM Studio's on/off switch lives only on its native `/api/v1/chat` → `reasoningEfforts: false` |
4. **Writes** `reasoningEfforts`, `compat.supportsReasoningEffort`, `contextWindow`, `maxTokens` (and optionally the route `api`) through `ctx.settings.mutate('llm-pi-ai', ops, revision)` — the user layer is read through `ctx.settings.describe()`, schema-materialised empties are stripped, the descriptor revision is sent so a concurrent edit raises `SETTINGS_CONFLICT` and the write is re-read and re-applied rather than clobbered, and only llm-pi-ai / llm-deepseek routes with a declared or catalog model are accepted; `compat.supportsReasoningEffort` is written only on chat-completions routes (the core refuses it elsewhere). The native model picker then shows the thinking levels, and compaction sizes itself to the real context window instead of dsh's 262,144 default — which is how the "LM Studio max context" conflict is resolved. Levels can also be typed on the launcher page (`off,low,medium,high`, `off=none,high`, `false`, or `inherit` to drop the override); the core's write-time rules are mirrored (a non-off level needs a wire value, `off` alone is refused) so a typo is a 400, never a broken settings file. Plugin routes accept same-origin JSON writes only.

## Thinking mode (per model, `$DSH_HOME/local-reasoning.json`)

`auto` (hands off) · `follow-picker` (off → `/no_think`, any other level → `/think`; the level comes from the session's latest request header — the picker selection itself is private to the web host — so a level changed in the picker reaches the switch from the next request on, and a new session's first message follows the `agent-default-model` level) · `on` / `off` (force, no lag). The suffix is appended only to the last user-typed message of a step (never to plugin context snapshots, whose byte-identity the runtime-context projection relies on, nor to tool results); being a pre-step message it is recorded in the session log and visible in the transcript.

## Routes (prefix `/dsh-local-reasoning`)

`POST /online-variant {route, modelId, action: add|remove}` adds / removes the OpenRouter `<model>:online` web-search variant as a models-list entry cloned from the base (OpenRouter routes that carry their own `models` list only; a catalog route is refused with an explanation, because `modelOverrides` cannot introduce an id the catalog lacks; `remove` also clears an orphan variant). Every method refuses a foreign `Host` header (loopback only). · `GET /status` · `POST /probe` · `POST /apply {route, modelId, changes}` · `POST /apply-recommended {route, modelId}` (local) · `POST /route-api {route, api}` (local) · `POST /settings {autoTeach?, teachNow?}`.

## Model Experience

Indirectly, through the `llm-pi-ai` settings it writes (thinking levels offered by the picker, effort sent on the wire where supported) and through the soft-switch suffix appended to the last user-typed message for prompt-toggle families.

### KV Cache effect

Append-only: the suffix is appended to the latest user message; system prompt and history are untouched.

## Sources

LM Studio REST API (`/api/v0/models`; `/api/v1/models` with `loaded_instances[].config.context_length` and `capabilities.reasoning.allowed_options`; API changelog 0.3.29 `/v1/responses` reasoning.effort); Ollama docs (`/api/tags`, `/api/show`, `/api/ps`; OpenAI compatibility `reasoning_effort` none/low/medium/high/max; thinking levels and gpt-oss low/medium/high only; default 4096 context / `OLLAMA_CONTEXT_LENGTH`); Qwen3 model card soft switch; pi-ai `openai-completions` reasoning dispatch (`reasoning_effort` sent only with `compat.supportsReasoningEffort`, `off` wire value sent when mapped); dsh `packages/llm/llm-pi-ai` README "Per-model reasoning efforts" / "Wire-compatibility switches"; dsh settings seam (`describe().revision`, `mutate(ns, ops, expectedRevision)`, `SettingsConflictError`); dsh agent loop (`agent/pre-step` messages are appended to the log; runtime-context snapshot dedupe).
