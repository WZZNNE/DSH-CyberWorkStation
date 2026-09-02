---
name: dsh-local-models
description: Configure and debug locally served models (LM Studio, Ollama, other OpenAI-compatible gateways) in DeepSeek Harness (dsh) — llm-pi-ai route fields (api, baseURL, models[], reasoningEfforts, compat, contextWindow, maxTokens), thinking-level control per model family, context-window alignment with the backend, and the dsh-local-reasoning plugin/launcher page. Use this whenever the user mentions LM Studio, Ollama, 本地模型, 思考强度/reasoning effort for a local model, context window conflicts, or a 400/UNSUPPORTED_REASONING_EFFORT from a local route.
---

# dsh Local Models (LM Studio / Ollama)

## Where local models live in dsh

- Settings namespace `llm-pi-ai` (`$DSH_HOME/settings.yaml`): `providers.<route>` with `api` (protocol: `openai-completions` | `openai-responses` | …), `baseURL`, `apiKeyEnv`, `models[]` entries `{ id, name, contextWindow, maxTokens, reasoningEfforts, compat }`. Source: `core/packages/llm/llm-pi-ai/src/config.ts` + README.
- Defaults for a model neither config nor catalog sizes: `contextWindow` 262,144 and `maxTokens` 32,768 (`DEFAULT_CONTEXT_WINDOW` / `DEFAULT_MAX_TOKENS` in config.ts). Local backends rarely load that much → set `contextWindow` per model.
- Compaction (`compaction-basic`) triggers at `thresholdRatio` (0.8) × contextWindow — so contextWindow is the effective "max context" knob.

## Thinking levels per family (verified sources)

| family | how | config |
|---|---|---|
| any Ollama model with the `thinking` capability (Qwen3, DeepSeek-R1, cogito …) | Ollama's OpenAI endpoint accepts `reasoning_effort` none/low/medium/high/max (docs.ollama.com/api/openai-compatibility); level semantics per docs.ollama.com/capabilities/thinking | `reasoningEfforts: {off: none, low: low, medium: medium, high: high}`, `compat.supportsReasoningEffort: true` |
| gpt-oss on Ollama | `think` must be low/medium/high; true/false ignored | `reasoningEfforts: {low: low, medium: medium, high: high}`, `compat.supportsReasoningEffort: true` |
| gpt-oss on LM Studio | `reasoning.effort` documented on `/v1/responses` (0.3.29+); the chat-completions docs list no reasoning field | route `api: openai-responses` + `{low, medium, high}` (no off: the model always reasons) |
| Qwen3 (non-instruct) on LM Studio | soft switch `/think` `/no_think` in the prompt (Qwen3 model card; follows the most recent instruction) — on/off only: Qwen3's depth is a continuous thinking budget (Qwen3 blog); LM Studio's OpenAI-compatible endpoint documents no reasoning level, and the native `/api/v1/chat` `reasoning` field follows the model's `capabilities.reasoning.allowed_options` (documented examples Gemma 4 `off/on`, R1 `on`) | `reasoningEfforts: {off:, high: high}`, `compat.supportsReasoningEffort: false`; dsh-local-reasoning appends the switch to the last user-typed message (recorded in the log) |
| DeepSeek-R1 / QwQ / *-thinking on LM Studio | always reasons, no OpenAI-endpoint switch | `reasoningEfforts: false` |
| GLM-4.5+ | `chat_template_kwargs` (vLLM / llama.cpp / SGLang); dsh can send it via `compat.thinkingFormat: qwen-chat-template` / `chat-template` + `chatTemplateKwargs` (llm-pi-ai README "Wire-compatibility switches") | LM Studio / Ollama do not document the field on their OpenAI endpoints → leave `false` |
| LM Studio model whose v1 `capabilities.reasoning.allowed_options` is `[off, on]` (e.g. Gemma 4) | switch only on LM Studio's native `/api/v1/chat` `reasoning` field | not controllable from dsh's OpenAI route |

pi-ai sends `reasoning_effort` on `openai-completions` only when `compat.supportsReasoningEffort` is true; with no effort selected it sends the `off` wire value if one is mapped (e.g. `off: none`), otherwise nothing (`@earendil-works/pi-ai dist/api/openai-completions.js`).

## Any model (not only local)

`contextWindow` / `maxTokens` (max output per reply) can be set for every route: llm-pi-ai routes with a `models` list → edit the entry; catalog routes (OpenRouter …) → `modelOverrides.<id>` (llm-pi-ai README, keeps the rest of the catalog); the official DeepSeek route → the `llm-deepseek` settings `models` list (`{id, name, contextWindow, maxTokens, inputModalities…}`; levels there are adapter-owned: `thinking` / `reasoningEffort` route settings). The launcher **Model parameters** page does all three (`dsh-local-reasoning` `/status`, `/apply`).

## Fast path

Use the DSH Launcher → Model parameters page (plugin `dsh-local-reasoning`; local models are auto-taught their levels on boot): Probe → Apply recommended (writes the fields above through `ctx.settings.mutate` with the descriptor revision) → optionally edit levels (`off,low,medium,high` / `off=none,high` / `false`), the wire checkbox, contextWindow / maxTokens → Save. Thinking mode per model (soft-switch models only): auto / follow-picker (next request after a picker change; first message of a new session follows the default-model level) / on / off.

## Context alignment

LM Studio: `GET {origin}/api/v0/models` → `max_context_length`; `GET /api/v1/models` → `loaded_instances[].config.context_length` (what is actually loaded) and `capabilities.reasoning.allowed_options`. Ollama: default 4096 (`OLLAMA_CONTEXT_LENGTH`), `POST /api/show` → `model_info.<arch>.context_length`, `GET /api/ps` loaded models. Set dsh `contextWindow` ≤ what the backend loaded, otherwise the backend overflows before dsh compacts.

## Gotchas

- The picker's provider/model/effort override applies to the next request of the session (`model-selection.ts` on `agent/request`); only the Qwen3 soft switch lags one request behind it (it reads the latest request header).
- `UNSUPPORTED_REASONING_EFFORT` = the selected level is not in the model's `reasoningEfforts` — add it or pick another level.
- Keyless local servers still need `apiKeyEnv` pointing at a placeholder credential (pi-ai requires an Authorization header).
