---
name: dsh-architecture
description: Mental model of DeepSeek Harness (dsh) internals — Cordis plugin system, profiles/bundles/patches, the turn flow, session log, capability seams, and the extension-point map. Use this whenever the user asks how dsh works, why something is designed a certain way, where a feature lives, which event/service to use, or before ANY change under packages/ in the deepseek-harness repo — even if they don't say "architecture". Also triggers on mentions of Cordis, profiles, waterfall events, session events, seams, agent loop, or "原理"/"怎么实现" questions about dsh.
---

# DeepSeek Harness Architecture Mental Model

dsh is a plugin-based agent harness on vendored Cordis: **everything is a plugin** — the model adapter, tool registry, session log, and the agent loop itself. There is no privileged core: you extend dsh by mounting a plugin beside the others, never by patching a core.

Authoritative sources in the repo (read them, don't guess; paths relative to repo root):
- `docs/architecture.md` — THE map. Read before changing anything under `packages/`.
- `docs/cordis-primer.md` — Cordis in 5 ideas + dispatch modes (44 lines, always worth reading).
- `docs/cordis-tutorial/01..07` — hands-on walkthrough if the concepts don't stick.
- `docs/glossary.md`, `docs/event-producer-consumer.md`, `docs/capability-seams.md`, `docs/graph-atlas.md` — lookup tables.
- `AGENTS.md` — repo conventions. The "Conventions" section is a contract, not advice.

## Cordis in five ideas

1. A **plugin** is `{ name, inject?, apply(ctx) }` or a `Service` subclass.
2. A **context** is a repository of services: `ctx.tools`, `ctx.llm`, `ctx.sessions`… found by key, never by importing a concrete implementation.
3. **`inject` declares service dependencies** — load order comes from service requirements, not manual boot sequencing.
4. **Typed events** (TS declaration merging) with four dispatch modes: `emit` (fire-and-forget), `waterfall` (around-middleware — listeners MUST call `next()` to delegate), `parallel` (awaited fan-out), `serial` (awaited in order). The mode is part of the event's public contract (`@mode` JSDoc).
5. **Registrations are reversible effects** — every contribution goes through `ctx.effect()` / `ctx.on()`; disposal unwinds it. This is why hot-reload "just works".

The waterfall rule that bites: a listener returning without `next()` SHORT-CIRCUITS the chain. A policy listener that owns the decision may short-circuit; an observer/annotator must delegate.

## Composition: profiles, bundles, patches

A running `dsh` is a plugin tree composed at boot from ordered layers:

- **Bundle** = distribution format for Cordis config rows + the code they mount. `dsh-base` (adapters, tools, persistence, sandbox/approval, settings, credentials, telemetry) is the first layer of every profile; `dsh-web-app` adds the browser app; `dsh-headless` adds the one-shot runner.
- **Profile** = named composition in the Harness home (`~/.dsh`, i.e. `$DSH_HOME/profiles/<name>`): lists its bundles, holds out-of-tree plugins it installs, keeps the user's `cordis.patch.yml`. `web` and `headless` ship as templates. User settings: `$DSH_HOME/settings.yaml`, hot-reloaded.
- Layer order: each bundle in profile order → profile's `cordis.patch.yml` → home-level patch → `--patch` overlay. A patch targets a row by id and replaces its whole config, or inserts new rows.

See the real boot tree of any machine — the single most useful exploration command:

```sh
dsh --profile web --dump-config
```

Any row it prints can be replaced by a patch of your own.

## Turn flow (memorize this)

A **step** = one model request + the tools it calls. A **turn** = zero or more steps.

```text
turn/start
  claim input → assemble prompt sections + tool schemas
  agent/pre-step (waterfall: reject | enter(messages))
    step/start → append user/message → derive model history from log
    agent/request → llm/stream → assistant/chunk* → assistant/message
    tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*
    step/end
    (tools owe another request, or next input arrived? → next step)
  agent/turn-stopping (serial, no next())
turn/end
```

Three event domains — picking the right one is the first decision in most changes:
- **Session events** (`turn/*`, `step/*`, `user/message`, `assistant/*`, `tool/*`): durable facts appended to the log; use when the fact must survive a reload.
- **Agent events** (`agent/*`): live in-flight interception — inbox, step, status, request, validation, continuation.
- **Capability events** (`fs/*`, `tools/*`, `telemetry/*`): policy/adapters on a seam without importing the loop.

## The session log invariant

**Model-visible ⟺ logged.** Anything reaching a model request must be reconstructable from the session log (`deriveMessages()` projects model history from it; raw `assistant/chunk` preserves replay/UI fidelity). A new model-visible input therefore requires a new `SessionEventMap` event — render and replay from the log. A runtime invariant asserts this; you cannot sneak context in. Fork, resume, transcripts, telemetry, and persistence all derive from this one stream.

## Capability seams

A **seam** = Service Definition + Service Provider + Consumer. Always all three roles; one role alone is not a seam. This is why one provider swap moves the whole product (pointing fs+subprocess providers at a remote sandbox moves Bash, PTY, and LSP with them, no forks). The shell trio (`packages/shell/*`) is the template.

## Where new behavior goes

Never modify `agent-loop` — new behavior attaches to a documented extension point ("Plugins, not loop changes"; changing the loop requires updating docs/architecture.md). The full Goal → Mechanism table is `docs/architecture.md` § "Where new behavior goes"; the feature → mechanism map with production examples is `docs/cookbook/extension-cookbook.md`. Highlights:

| Goal | Mechanism |
|---|---|
| Model provider | adapter registered on `ctx.llm` |
| Model-facing capability | `ctx.tools.register()` — schema joins prompt assembly automatically |
| Tool policy (allow/deny/ask) | `tools/pre-execute` waterfall; `ctx.tools.guard()` for a monotonic final deny |
| Wrap dispatch (timeout/retry/metrics) | `tools/execute` |
| Human command (no model turn) | `ctx.commands` |
| Background work | `ctx.jobs`; `job_*` tools collect/stop it |
| Inject model-facing context | `agent.inject()` — lands in the next admitted request |
| Web Chat business row | `ConversationNodeDefinition` + keyed renderer |
| Durable session state | extend `SessionEventMap` |
| Per-agent scoping | register through `agent.ctx` |
| Session title generation | the sole `ctx.sessionTitle` provider |

## Conventions that gate merges (from AGENTS.md)

- ESM everywhere; `.ts` extensions in relative imports; every package is `@deepseek-ai/dsh-<name>`.
- Branded ids (`Branded<B>` from `dsh-brand`) for opaque cross-boundary ids, never bare `string`.
- No hardcoded tunables: deployment-varying choices are validated `Config` fields changeable from cordis.yml.
- Misconfiguration fails loud at load, or at the earliest resolvable point; never silently skip a missing referent.
- Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- Non-trivial changes need an **Agent Note** (`.agents/notes/`) in the same PR.
- Strict TS; every export has JSDoc contract; per-file 100% coverage gate on `packages/*/*/src`.
- Read `docs/defensive-patterns.md` before lifecycle, concurrency, subprocess, or teardown work.
