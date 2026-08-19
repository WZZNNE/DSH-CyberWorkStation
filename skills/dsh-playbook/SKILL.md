---
name: dsh-playbook
description: Operate and tune DeepSeek Harness (dsh) as a power user — run modes (web/headless/ACP/SDK), model & API key configuration, reasoning-effort and cache/cost tuning, profile patching, and the community plugin ecosystem. Use this whenever the user wants to run dsh, configure models or keys, make sessions faster or cheaper, install/discover plugins, automate dsh from CI or scripts, or asks "怎么玩"/"怎么用"/"调优"/"省钱" about dsh — even without naming a specific mode.
---

# dsh Operating & Tuning Playbook

## Run modes (pick by consumer)

| Mode | Command | For |
|---|---|---|
| Web UI | `pnpm dsh web` (source) / `npx -y @deepseek-ai/dsh web` | interactive use; http://127.0.0.1:3080 |
| Headless one-shot | `pnpm dsh --profile headless "task"` | CI, scripts; needs `DEEPSEEK_API_KEY` |
| ACP server | `pnpm run demo:acp` | editor/automation clients over Agent Client Protocol (stdio JSON-RPC) |
| TS/Python SDK | `packages/sdk` / `python/` | programmatic embedding. Python SDK: Linux/macOS only — use WSL on Windows |
| Self-modification demo | `pnpm run demo:cordis` | the agent mounts/edits its own plugins — the best "aha" demo of the architecture |

## Models & credentials

- Harness home is `~/.dsh` (`$DSH_HOME`); user settings live in `$DSH_HOME/settings.yaml` (hot-reloaded), keys in `$DSH_HOME/.credentials.yaml` (write-only) — sources: `packages/boot/app-boot/src/index.ts`, `packages/credentials/credentials-local/src/index.ts`.
- Web UI: Settings → Models. Model selection changes take effect on the next request — no restart. The default model row is `agent-default-model` (ships as `deepseek-official` / `deepseek-v4-flash` in `packages/bundle/base/cordis.patch.yml`); a saved settings selection overrides it.
- Env/CI: `DEEPSEEK_API_KEY` (+ `DEEPSEEK_BASE_URL`) from env or root `.env`.
- Providers: DeepSeek direct; Anthropic/OpenAI; Bedrock/Vertex/Azure via native credentials; custom providers need lowercase id + base URL + protocol + credentials + model name.
- Common errors: `MISSING_CREDENTIAL` → key not stored; `UNKNOWN_MODEL` → configure the model; 401 on model listing → bad key; image rejected → add `input: [text, image]` to the model's settings.

## Speed & cost tuning (community-measured, dsh-handbook ch.6/14)

Tool-chain tasks spend ~90% of wall time in model reasoning — tune the model, not the I/O:

1. **Reasoning effort is the highest-leverage speed multiplier.** Tiers: `off`/`low`/`high`/`max` (source: `packages/llm/llm-deepseek/src/adapter.ts:95-104`); the default resolves to `high` when thinking is enabled. Set via settings namespace `agent-default-model` (`{ provider, model, reasoningEffort }`). Downshift for simple rounds. Two community-reported caveats (dshdocs.com): a session captures `reasoningEffort` at creation — changing it mid-session has no effect; and tool-heavy multi-turn workflows at `high`/`max` can hit `400 INVALID_REQUEST` (missing `reasoning_content` on later turns) — use `off`/`low` for tool-heavy work or start a new session.
2. **KV cache**: real-world hit rates ~97%; cached tokens are discounted ~98-99%. Cache reuse depends on a stable prompt prefix — every package README documents its "KV Cache effect" (append-only vs replacing); prefer append-only workflows, avoid churning early-request content (system prompt sections, tool schemas) mid-session.
3. **Compaction** auto-reduces long conversations (the `ctx.compaction` seam; manual compact available). Long sessions → let it work rather than restarting.
4. Cost visibility: per-session token spend is in session telemetry; community meters exist (dsh-balance-meter).

## Profile patching (make it yours without forking)

1. `dsh --profile web --dump-config` — print the actual boot tree; every row is patchable.
2. `$DSH_HOME/profiles/<profile>/cordis.patch.yml` — target a row by id to replace its config, or `- insert:` new rows. Layer order: bundles → profile patch → home patch → `--patch` overlay.
3. Install plugins: `dsh plugin --profile web add <package>` (the `--profile` matters — profiles decide which bundle a session runs).
4. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal — environment-conditional composition uses overlays.

## In-tree but unmounted capabilities (mount before shopping)

Before installing community plugins, check the repo's own opt-in packages — mount via profile patch, zero development: `mcp-client` (MCP servers → ctx.tools), the `lsp` trio (tool-lsp code intelligence), the `terminal` trio (persistent PTY tools), `schedule` (durable reminders), `hooks-claude-code`/`hooks-codex` (reuse existing hook configs), `e2b` trio (remote sandbox), and the external subagent providers (`subagent-acp`/`-codex`/`-claude-code`) which base deliberately leaves to profiles. Verify with `dsh --profile web --dump-config`.

## The layer that outweighs plugins (community insight, atlascloud.ai)

The model-provider endpoint config (the `llm-pi-ai` row's YAML) decides your cost floor — the same 47.6K-token turn can differ ~3.5× between endpoints. Tune provider/endpoint before tuning plugins.

## Ecosystem map (community-surveyed, 2026-08)

- Discovery: GitHub topic `dsh-plugin` (official convention); curated lists — `Dominic789654/awesome-deepseek-harness` (16 categories incl. Skills/orchestrators), `0xsline/awesome-deepseek-harness`, `awesome-dsh-plugin/awesome-dsh-plugin`; directory site dshplugin.store; GitHub Discussions for support.
- Notable community plugins: `loadingvx/deepseek-harness-workbench-plugin` (IDE workbench in Web UI — the best large slot-composition study), `LaplaceYoung/oh-my-dsh` (700+ plugins, all through extension seams), `PerryLink/dsh-permission-rules` (Claude-Code-style declarative permissions), `dsh-sgme` (memory engine, 65–96% session-token savings), `dsh-vault` (AES-256-GCM+TOTP credentials), `dsh-context-doctor`/`dsh-balance-meter` (token/cost auditing), `dsh-observe` (OpenTelemetry/Langfuse export).
- Plugin-install hygiene (community-reported, dshdocs.com): pin versions when installing `@deepseek-ai`-scoped plugins (`latest` npm tag can lag `next`; match `dsh --version`); `dsh plugin remove` may leave stale bundle entries; a duplicated `dsh-tools` crashes tool calls (`reading 'prepare'`). Sandbox-category tooling is scarce — audit third-party plugins before trusting them with credentials (`plugin-doctor` and `PerryLink/dsh-score` help).
- Known rc-phase rough edges: Windows paths, serialization bug family (unknown tool errors, reasoning omission, run_code data loss) — check Discussions before debugging "impossible" behavior as your own bug.
- Deep-dive reference: dsh-handbook (github.com/Electricitysheep/dsh-handbook) — plugin template, cost model, benchmark appendix, cheatsheet.

## Demos & examples in the repo

`examples/*/cordis.yml` are runnable leaves over `packages/examples/*` bundles: `web-cordis` (self-modification), `web-schedule`, `acp-agent`, `headless-agent`, `jsonrpc-agent`, `mcp-memory`. Reading a leaf's cordis.yml is the fastest way to learn composition; copying one is the fastest way to start an experiment.
