# dsh-web-search-plus

SillyTavern-style web search for DeepSeek Harness — configured **once for the whole deployment**,
either in dsh Settings → **联网搜索(全局)** or on the launcher's Control Deck → Web search tab.
Both write the same file (`$DSH_HOME/web-search.json`), which the plugin hot-reloads within 1.5 s.

## Modes

| Mode | What happens |
|---|---|
| `off` | the model's `web_search` tool is denied with a reason; nothing is injected |
| `tool` | the native `web_search` tool stays available, and this plugin serves the call through the `tools/execute` waterfall with the configured source (same result shape as `dsh-tool-web`, so the web card still renders). With `deepseek-official` the core's own web seam answers it |
| `inject` | SillyTavern semantics: when a trigger matches the message **you typed**, the plugin searches and adds the formatted results as a SEPARATE plugin-sourced context message right after yours (your words are untouched, the row renders as context); `web_search` is denied so the model cannot double-search |
| `provider` | **the API provider's own search**. On OpenRouter the request switches to the `<model>:online` variant, which OpenRouter serves server-side — any model, **billed per search** (openrouter.ai/docs/features/web-search). Routes without such a switch keep the `web_search` tool, served by the source below |

The `:online` variant is created in `llm-pi-ai` settings the first time it is needed (cloned from the
base model, revision-checked write with a retry on conflict), because pi-ai refuses a model id its
materialised catalog does not hold. A route that carries no `models` list of its own cannot gain an
id — the plugin logs why and leaves the request alone. `GET /status` reports which variants are live
(`providerNative.ready`) and which routes were given up on (`providerNative.unavailable`).

### The provider-native knobs

`providerNative` in `web-search.json` (no UI; `autoVariant` and `fallbackToTool` default to `true`,
`anthropicNative` to `false`, `testModel` to empty):

| Knob | Default | What it means |
|---|---|---|
| `autoVariant` | `true` | create the `<model>:online` entry when it is missing. `false` = never write to settings; provider mode then only works for models that already have an `:online` entry |
| `fallbackToTool` | `true` | leave `web_search` available even on a request that went native. This is the safe default, but it means a turn **can** pay OpenRouter's per-search fee **and** call your Serper/Tavily quota. Set it to `false` to deny the tool on exactly those requests |
| `providerNative.anthropicNative` | `false` | Send Anthropic models to OpenRouter's `:online` anyway. Off by default: with the harness's ~90 tool schemas attached, OpenRouter's web plugin never answers a Claude request (replayed 2026-09-02), so Claude models keep their plain id and use the tool search below. |
| `providerNative.testModel` | `''` | The model "Test search" uses for its one real `:online` request; empty picks a cheap non-Anthropic model of the route (kimi / deepseek-chat / gpt-5-mini / gemini flash / qwen / mistral first). |

## Page reader (`web_fetch`)

The shipped agent presets register `web_search` only (`tool-web` with `fetch: false`, the base
bundle's reason: "the model would choose the request target"). This plugin mounts `web_fetch` itself,
at the host plane so every agent sees it, from the core's own tool definition (`@deepseek-ai/dsh-tool-web`:
argument parsing, HTML→text, the result card) over its own transport (`lib/fetch.js`): the hostname is
resolved once, every address must be public (no credentials in the URL, no IP literals, no private /
loopback / link-local / documentation ranges in any IPv4 or IPv6 spelling, the `blacklist` hosts), and
the socket is opened to one of those addresses with the lookup overridden — the name is never resolved
a second time, which closes the DNS-rebinding window a resolve-then-fetch check leaves. Redirects are
followed within the same origin only, each hop validated the same way; only text-like content types
are read; bodies are capped in bytes and decoded characters. The tool runs in the harness process, not
in the Windows sandbox, so HTTPS works where a sandboxed `curl.exe` / `Invoke-WebRequest` cannot
(Schannel gets no credentials under the restricted token). With web search set to **off** the page
reader stays down too — "off" means the model works offline.

`fetch` in `web-search.json` (the dsh card and the launcher deck carry the switch):

| Knob | Default | What it means |
|---|---|---|
| `enabled` | `true` | mount `web_fetch`; `false` unmounts it within 1.5 s of saving |
| `timeoutMs` | `30000` | the tool-call budget (`ToolDefinition.timeoutMs`, enforced by the core's timeout policy); the provider backstop sits 5 s above it |
| `maxOutputChars` | `200000` | cap on one rendered result |
| `maxResponseBytes` / `maxBodyChars` | `5000000` / `100000` | the provider's byte and decoded-character caps |

`GET /status` reports `fetch: { enabled, mounted, missing, reason }` — `missing` names a core package
the profile cannot resolve (the launcher's peer links add them), `reason` says why the tool is down
(switched off, search mode off, a registry that already holds `web_fetch`, a package missing). The
Control Deck's "disabled tools" list is a separate, per-call denial; this switch removes the tool and
its prompt section altogether.

## Page visiting in tool mode (`toolVisit`)

Snippets from any search API are one or two sentences. With `toolVisit.links > 0` the plugin opens
that many of the top results **inside the same `web_search` call** and appends their article text to
the tool output — the equivalent of a paid API's `content` field, without a second `web_fetch` round
trip the model has to decide to take (a local model often does not).

| Knob | Default | What it means |
|---|---|---|
| `toolVisit.links` | `0` | how many top results to open, 0–5. `0` keeps the old snippet-only behaviour |
| `toolVisit.chars` | `2000` | per-page text budget, 200–20000 |
| `extractorUrl` | `''` | optional local extraction service; empty uses the built-in stripper |

The pages ride the **same guarded transport as `web_fetch`** (public addresses only, address pinning,
blacklist, byte and character caps), each with its own 12 s deadline inside a 15 s budget for the
whole visit phase; a page that will not open is dropped, never an error — a search must not fail
because one of its results does. Article text is stored with any search-provider answer in the
canonical result's `content` field, retaining each page's title and URL. The core therefore includes
it in model output, structured tool values and the result card. Multiple queries contribute sources
in rank order across queries, with duplicate URLs removed before the shared result cap is applied.

### The extractor service

`extractorUrl` points at a local `dsh-extract` service (trafilatura behind a
100-line ASGI app). **The plugin fetches the page itself and posts only the HTML** — the service
never receives a URL to fetch, so the decision to open a model-supplied address stays inside the
guard. Any failure (down, slow, empty answer) falls back to the built-in `htmlToText` silently.

Why bother: on `docs.sglang.ai` the built-in stripper yields 2 210 characters that begin with the
nav menu; trafilatura yields 17 866 characters of the actual article in 210 ms. On a GitHub repo page
it is 561 characters of "You signed in with another tab" versus 1 542 characters of the README
(measured 2026-09-03). The service also reports a date, which is deliberately dropped: htmldate falls
back to a last-modified or crawl date, and a confident wrong date in front of the model is worse than
none.

## Sources

Serper · SerpApi · Tavily · Brave · SearXNG (self-hosted) · DeepSeek official. Keys are credential
references (`SERPER_API_KEY`, …) stored through `ctx.credentials`; DeepSeek official needs only
`DEEPSEEK_API_KEY` and rides the core's own web seam, so this plugin stores no key for it. Every
source is also registered on the `ctx.web` seam, so a profile patch may pin one as the deployment's
`searchProvider`.

## Triggers (inject mode)

Backticks · `$N` regex with a query template · phrases · always; max words per query, result
template, character budget, optional page visits behind an SSRF guard, domain blacklist, result
cache.

## Routes

| Route | Purpose |
|---|---|
| `GET /dsh-web-search-plus/status` | config, per-source key state, provider-native state, `fetch` state |
| `POST /dsh-web-search-plus/config` | write the whole config (validated, atomic, hot-loaded) |
| `POST /dsh-web-search-plus/key` | store or clear one source's API key |
| `POST /dsh-web-search-plus/test` | one live search, with the formatted preview |

Behind the loopback + same-origin fence the rest of the suite uses.

## What the model is told

Each mode mounts its own system-prompt section: `off` says search is unavailable; `tool` says the
tool is served by the configured source; `inject` says results arrive as context and the tool is
denied; `provider` says the provider itself searches when the route supports it and the tool serves
the rest. Cite-the-URL guidance is included where results are involved.

**The trigger regex has a 60 ms budget.** It is your pattern and it runs on every user message, so
it is matched inside a worker thread with a deadline. A pattern that overruns it is abandoned: the
message simply does not trigger a search, and the pattern is named once in the dsh log
(`the trigger regex took too long and was abandoned`). Catastrophic backtracking therefore costs one
killed worker instead of a frozen harness — but a legitimately heavy pattern on a loaded machine can
be dropped too. Keep trigger patterns simple.
