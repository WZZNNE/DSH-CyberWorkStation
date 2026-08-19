---
name: dsh-testing
description: Design and run tests for DeepSeek Harness (dsh) changes — choosing the right tier (unit/coverage/e2e/snapshot/web), writing real-composition and smoke tests, snapshot record/refresh workflow, and coverage-gate rules in the deepseek-harness repo. Use this whenever the user adds or changes tests, asks which checks to run for a dsh change, hits a coverage or snapshot gate failure, or says "写测试"/"跑哪些测试"/"快照怎么更新" about dsh. Also use before claiming any dsh change is verified.
---

# dsh Testing Strategy

Policy owner: `docs/testing.md` (read it for anything not summarized here). Commands: root `AGENTS.md`. Pre-push selection: `.agents/skills/dsh-pre-push-checks/SKILL.md` — run the narrowest checks that cover the surface you touched; CI owns exhaustive coverage.

## The tiers

| Tier | Command | What it proves |
|---|---|---|
| Unit | `pnpm run test` | package/example specs under `tests/**`; every registry gets an HMR-safety test (dispose fiber → assert cleanup) |
| Coverage gate | `pnpm run test:coverage` | per-file 100% on `packages/*/*/src` — this is the CI gate, `test` is not |
| Real-API e2e | `pnpm run test:e2e` | live provider behavior; self-skips without `DEEPSEEK_API_KEY` (root `.env`) |
| Snapshot | `pnpm run test:snapshot` (`-t <name>` filters) | keyless expected outputs: ACP JSON-RPC transcripts + headless JSONL logs pin assembled behavior |
| Web browser snapshot | `DSH_SNAPSHOT=replay pnpm run test:web` | Chromium diff of replayed browser output vs `apps/web/tests/snapshots/`; required Linux PR gate; builds first |
| GUI inner loop | `pnpm run test:gui` | client + host GUI packages, seconds, no browser |

Snapshot modes: `record` (with key, model transcript changed), `refresh` (replay input still valid), `replay` (read-only; what CI uses). Review every JSONL/expected-output diff — snapshots are the product's transcript contract.

## Rules that decide test design

1. **Real composition over hand-built contexts.** A product-visible plugin needs a non-unit test that boots a test-only `cordis.yml` through Loader and app/process; `ctx.plugin(...)` suites alone are insufficient. Mock only the expensive/non-deterministic boundary (LLM adapter, network, clock); keep everything downstream real.
2. **Verify the world, not the self-report.** e2e assertions re-run the command or re-read the file externally; keyword-probing the agent's own output lets a cheating agent pass. Assert untouched files are byte-identical.
3. **Test the real entry path.** Package `bin` smokes run built `lib/bin.js` under plain `node` (tsx masks settle races and resolution failures). For composition plugins without `inject`, assert `expect('default' in mod).toBe(false)` + an `unwrapExports` round-trip — and prove the guard by introducing the regression once.
4. **With-key policy: inference is cheap here.** Do not ration real-API tests; the highest-value tests are smokes that boot the real example, send one prompt, and check the world. Self-skip exists for keyless CI, not as a cost signal.
5. **Coverage nuance:** an uncovered line is often dead code the gate is correctly flagging for deletion. Genuinely unreachable defensive arms take `/* v8 ignore -- <reason> */` with a real reason.
6. **Source plane only:** vitest resolves workspace imports through `tsconfig.base.json` paths to `src`, never through package `exports` to `lib/` (stale artifacts load duplicate singletons). Built artifacts are consumed only by explicit built smokes and lib-mode subprocesses.
7. **When a snapshot is required:** every non-trivial model-, protocol-, or human-visible change updates a keyless scenario in the same PR — ACP scenarios in `examples/<name>/tests/snapshots/` (`examples/acp-agent` primary), headless canonical-event JSONL in `examples/headless-agent`, terminal journeys in `apps/cli/tests/snapshots/`, browser journeys in `apps/web/tests/snapshots/`. Agent-loop/`SessionEventMap` changes update BOTH SDK projections (TS: `examples/jsonrpc-agent`; Python: `scripts/snapshots/python-sdk-single-exe/`) — `pnpm run test` covers neither.
8. Test ownership: e2e tests create their harness in the test and dispose in `afterEach`; shared fixtures live in `tests/harness.ts`, never imported from another `*.e2e.ts` (re-registers describes, duplicates API calls). Fixtures must replay on macOS/Linux — fix fixtures, not normalizers.

## Choosing checks for a change (match evidence to surface)

- Behavior change → focused unit tests + the owning snapshot scenario.
- Client/GUI code → `test:gui`; assembled browser output → also `DSH_SNAPSHOT=replay test:web`.
- Docs → `pnpm run doc-sync`. Published paths/packaging → `build` + `hygiene`. Provider behavior → with-key `test:e2e`.
- Never default to the full suite or repeat a passing check; escalate only when the change surface demands it.
