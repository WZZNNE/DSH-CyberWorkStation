---
name: dsh-env-ops
description: Set up, upgrade, build, and troubleshoot the DeepSeek Harness (dsh) development environment, especially on Windows — Node/pnpm/corepack versions, the build pipeline, git hooks, and known failure modes. Use this whenever the user hits a build/install/startup error in the deepseek-harness repo, wants to update the repo or its toolchain, asks why pnpm/lefthook/tsc fails, or says "环境"/"升级"/"装不上"/"构建失败" about dsh. Also use before advising any pnpm/build command in this repo, to pick the right gate instead of the full suite.
---

# dsh Environment Ops (Windows-first)

## Version contract

- Node `^22.19.0 || >=24.0.0` (CI covers 22.19 / 24 / 26 — Node 24 LTS is the sweet spot; note every 23.x is excluded by this range).
- pnpm pinned `11.7.0` via corepack (`packageManager` field). `corepack enable` needs an elevated shell on Windows (writes `C:\Program Files\nodejs`); until then `corepack pnpm <cmd>` works unelevated.
- Git ≥ 2.26 (worktree-local hooks).

## Canonical pipelines

```sh
pnpm install          # deps + lefthook hooks + merge driver (postinstall)
pnpm run build        # tsc host → tsdown host → tsc client → tsdown client → web dist
pnpm run typecheck    # "setup is complete when this exits 0" (docs/development.md)
pnpm dsh web          # run Web UI from source (tsx ESM hook); http://127.0.0.1:3080
```

Upgrade an existing checkout: `git pull` → `pnpm install` → `pnpm run build` → `pnpm run typecheck`. If build outputs look stale or a deleted package leaves residue: `pnpm run clean` first.

## Choosing checks (never default to the full suite)

Match evidence to the surface (AGENTS.md): focused `pnpm run test` for behavior; `test:gui` for client; `DSH_SNAPSHOT=replay test:web` for assembled browser output; `test:snapshot` for model/user-visible transcripts; `doc-sync` for docs; `build` + `hygiene` for published paths; `test:e2e` for provider behavior (needs `DEEPSEEK_API_KEY`, else self-skips). `test:coverage` (per-file 100%) is the CI coverage gate, not `test`. Pre-push selection: repo skill `.agents/skills/dsh-pre-push-checks/SKILL.md`.

## Known failure modes and fixes (verified on this machine or documented)

| Symptom | Cause | Fix |
|---|---|---|
| `git clone` → "destination path already exists" | target dir non-empty (e.g. `.claude/`) | `git init` + `remote add origin` + `fetch` + `checkout -b master origin/master` in place |
| postinstall: `Lefthook installer lock ownership changed … refusing to remove it` | stale `.git/dsh-lefthook-install.lock` from a dead process | confirm the PID in the lockfile is dead, delete the lock, rerun `node scripts/install-lefthook.mjs` (or `pnpm install`). Never edit worktree metadata speculatively |
| `build:web` fails: `'pnpm' 不是内部或外部命令` | root scripts shell out to bare `pnpm`; corepack shim not enabled | run `corepack enable` in an elevated shell, then rerun |
| `'pnpm' is not recognized` generally | same | `corepack enable` (preferred) or `npm install -g pnpm` |
| `.claude/skills` is a text file containing `../.agents/skills` | repo symlink degraded (`core.symlinks=false` checkout) | replace with a junction: delete file, `cmd /c mklink /J .claude\skills .agents\skills`, then `git update-index --skip-worktree .claude/skills` to keep status clean |
| WARN `Unsupported platform` for `native/landlock-run/*` | Linux-only sandbox addon | benign on win32/macOS; ignore |
| WARN cyclic workspace dependencies (api/gateway ↔ client/connection …) | known repo cycles | benign; ignore |
| WARN `Failed to create bin … lib/bin.js.EXE` on fresh install | demo bins not built yet | benign; disappears after `pnpm run build` + reinstall |
| Engine mismatch warning on Node 22.x < 22.19 | below floor | upgrade to Node 24 LTS (winget: `OpenJS.NodeJS.LTS`) |
| Plugin install registry timeouts | npm registry routing | retry with `--registry=https://registry.npmjs.org` |
| Sandbox blocks `gh`/network/watchers in agent runs | agent sandbox, not the project | retry with narrowest host escalation; require sandbox evidence; never bypass the product sandbox under test |
| `check:windows-wine` locally | needs wine; CI owns this signal | only run when diagnosing a known Windows failure |

Community-reported startup errors for the npm-installed `dsh` (source: dshdocs.com, 2026-08 — verify against your version before applying):

| Symptom | Reported cause | Reported fix |
|---|---|---|
| `Cannot find package '@deepseek-ai/cordis-plugin-group'` | `legacy-peer-deps` enabled skips peer deps | `npm config get legacy-peer-deps`; clear if true |
| `--expose-internals is required for HMR service` | native addon fails on non-official Node builds (Nix, musl, some arm64) | `node --expose-internals "$(which dsh)" web` (not via NODE_OPTIONS) |
| `Failed to load native module: pty.node` (Linux) | no node-pty prebuild; missing C toolchain | install `build-essential`/`base-devel`, `npm rebuild` |
| `transport failure for /api/…: HTTP 403` in Web UI | loopback trust check vs address form / browser extensions | open `http://localhost:3080` instead of `127.0.0.1`; try incognito |
| Windows sandbox crash during Temp cleanup | known rc-phase issue cluster | check GitHub Discussions/issues before self-debugging |
| Tool calls crash `reading 'prepare'` after plugin ops | duplicated `dsh-tools` in the profile | dedupe the profile's plugin deps; `dsh plugin remove` can leave stale bundle entries — inspect with `--dump-config` |

## Secrets

Real-API tests and demos read `DEEPSEEK_API_KEY` (+ optional `DEEPSEEK_BASE_URL`) from env or root `.env`. Web UI keys entered in Settings → Models persist to `$DSH_HOME/.credentials.yaml`. Never commit credentials; CI e2e self-skips without a key.

## Source launch contract

`pnpm dsh …` runs `node --import tsx/esm apps/cli/src/bin.ts` — ESM only end to end; a CJS-only export anywhere on the import path breaks source launch even when the built `lib/` works. Config subprocesses run built `lib/` under plain Node — rebuild before probing built paths.
