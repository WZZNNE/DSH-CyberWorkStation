---
name: dsh-plugin-dev
description: Write plugins for DeepSeek Harness (dsh) — model-facing tools, hook/policy plugins, LLM adapters, protocol drivers, and new workspace packages in the deepseek-harness repo. Use this whenever the user wants to add a tool, intercept tool execution, add a permission gate, register a command, add a model provider, create a new @deepseek-ai/dsh-* package, or says "写个插件"/"加个工具"/"写个 hook" for dsh — even for a quick experiment. Also use when reviewing or debugging an existing dsh plugin.
---

# dsh Plugin Development

Workflow + hard contracts for writing dsh plugins. Companion skill `dsh-architecture` owns the mental model; load it first if the extension-point taxonomy isn't fresh.

## Step 0: pick the extension point, not the code

Most plugin bugs are "right code, wrong extension point". Decide from the Goal → Mechanism table (`docs/architecture.md` § "Where new behavior goes", examples in `docs/cookbook/extension-cookbook.md`):

- New model capability → a **tool** on `ctx.tools`.
- Allow/deny/ask policy → **`tools/pre-execute`** waterfall (return `{ kind: 'deny', reason }` or delegate via `next()`).
- Final non-overridable deny → `ctx.tools.guard()`.
- Timeout/retry/metrics around dispatch → `tools/execute`.
- Transform result / attach context → `tools/post-execute`; observe immutably → `tools/result`.
- New provider for an existing seam → implement the Service Definition; never fork the consumer.
- Durable state → extend `SessionEventMap` (a new model-visible input REQUIRES a session event — repo invariant).
- MCP server integration → one plugin per server: discover its tools, `ctx.tools.register()` each (raw JSON-Schema `ToolDefinition`s are accepted directly — that is how MCP-sourced tools arrive).

Community-proven workflow (dsh-handbook ch.4): **separate pure logic from injection points** — extract the decision logic into pure functions (testable in milliseconds), keep the plugin body as thin wiring, then verify actual injection on a live run.

## The minimal tool

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',            // what the model sees
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                       // optional by default
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args is TYPED from the schema; honor exec.signal for cancellation
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

Registration is effect-based: disposing the plugin fiber unregisters the tool. Schemas flow into system-prompt assembly automatically. Code Mode gets `await tools.read_file(args)` for free from the same schema.

## execute() contract — the rules that bite

Full reference: `docs/cookbook/adding-a-tool.md`. `packages/shell/tool-bash` is the production-grade example. Summary:

- **Args are pre-validated** against the schema; still hand-check what the DSL can't express (non-empty strings, cross-field rules).
- **Return ONE canonical JSON value** matching `output.schema`; keep human prose in `output.render`. Never make callers parse prose for ids/fields (Code Mode consumes the canonical value).
- **Throwing = `isError`.** Throw for infrastructure failures; a non-ideal domain outcome (non-zero exit) is a successful value that render explains.
- **Honor `exec.signal`**; treat `args` and the registered definition as immutable; hot-swap = dispose effect + re-register.
- **Async notification** → `exec.agent.inject({ content, source: { kind: 'plugin', plugin: name } })` — durable context for the NEXT request, not a wake-up.
- **Long-running work** → gate `run_in_background` by config, register through `ctx.jobs.start()`, return a typed `{ kind: 'background', jobId }` handle. After the id is published, a task-owned signal (not `exec.signal`) owns the lifetime.
- **UI cards**: `presentCall`/`presentResult` return a `card` intent (`generic`/`terminal`/`diff`/`search`/`web`) and MUST be pure functions of args (+ result) — they run on live streaming AND on replay; no I/O, no clock, no session state. Result-time facts survive replay via `output.presentationMeta`. UI-only formatting stays out of the model result.

## Hook plugin (permission-gate shape)

```ts
export const name = 'permission-gate'
export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) return { kind: 'deny', reason: 'Denied by policy.' }
    return next()   // forgetting next() short-circuits the whole chain
  })
}
```

## New package checklist (condensed)

Full file-by-file checklist: `docs/cookbook/adding-a-package.md` — follow it exactly; `pnpm run constraints` enforces the package.json invariants. Essentials:

1. `packages/<group>/<pkg>/` with `package.json` (copy from `packages/core/tools`; `private: true`, `type: module`, `main: lib/index.js`, cordis in BOTH peer- and devDependencies), `tsconfig.json` (extends base, references vendor + deps), `src/index.ts`, `README.md`.
2. Register in exactly ONE aggregate: `tsconfig.host.json` OR `tsconfig.client.json` `references` (never both; only `api/remotes` splits).
3. Relative imports use `.ts` extensions; cross-package imports use package names.
4. Naming: name the stable current responsibility (role vocabulary table in the cookbook — Registry/Runtime/Provider/Policy/…); singular ctx key for one engine, plural for a registry.
5. README ends with the canonical **Model Experience** + **Known Limitations** sections (verifier-enforced; `None, as …` / `Indirectly, through …` sentences for no-context packages).
6. Verify ladder: `pnpm run doc-sync` → `pnpm run constraints && pnpm run typecheck && pnpm run lint` → `pnpm run build && pnpm run hygiene`.

## Mounting out-of-tree plugins (personal experiments)

For a quick personal plugin without a workspace package: build it as its own npm package, then mount via the profile patch layer —

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- insert:
    - id: my-plugin
      name: my-plugin
```

with the package resolvable from the profile (e.g. `"my-plugin": "link:C:\\path\\to\\my-plugin"` in the profile's package.json), or install with `dsh plugin --profile web add <package>`. Verify what actually mounted with `dsh --profile web --dump-config`. Raw/Web cordis.yml bare plugins must appear in their resolver manifest's `dependencies` (`verify-cordis-config` enforces it).

## Testing expectations (docs/testing.md owns policy; details in the dsh-testing skill)

- Unit tests colocated per package; per-file 100% coverage gate (`pnpm run test:coverage`) on `packages/*/*/src`. An uncovered line is often dead code the gate is flagging for deletion, not a missing test to bolt on.
- **Product-visible plugins require a REAL-composition test**: boot a test-only `cordis.yml` through Loader and app/process, mock only external services or nondeterminism, assert model-visible request/log, durable state, or user-visible output. Hand-built `ctx.plugin(...)` suites are insufficient (docs/testing.md § "Test the real entry path").
- Every non-trivial model- or user-visible behavior change adds/updates a **keyless snapshot** through a real runnable example in the same PR (`pnpm run test:snapshot`; `-t <name>` to filter). Mock-only fixtures don't substitute.
- With-key policy: "inference is cheap here — do not ration real-API tests." Highest-value are smoke tests that boot the real example, send one prompt, and **check the world** (re-read the file, re-run the command) — never keyword-probe the agent's own output. `test:e2e` self-skips without `DEEPSEEK_API_KEY` (root `.env` is read).
- Before pushing, select checks with the repo skill `.agents/skills/dsh-pre-push-checks/SKILL.md` — never default to the full suite.
- Non-trivial change → Agent Note in `.agents/notes/` in the same PR.

## Community tooling for out-of-tree plugins

`PerryLink/dsh-test-drive` (isolated smoke-test harness), `PerryLink/dsh-score` (plugin quality scoring), `plugin-doctor` (security scanning). Pin plugin dependency versions to match `dsh --version` — the npm `latest` tag on scoped plugins can lag `next` (community-reported, dshdocs.com). Test against the rc versions you target.
