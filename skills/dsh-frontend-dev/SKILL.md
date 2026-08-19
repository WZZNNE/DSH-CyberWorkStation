---
name: dsh-frontend-dev
description: Modify the DeepSeek Harness (dsh) Web UI — client plugin packages under packages/client/*, the slot system, conversation Chat nodes, stores, styling, and apps/web. Use this whenever the user wants to change anything visible in the dsh browser GUI — add a panel, settings card, tool card, conversation row, sidebar item, theme/style tweak, or a new packages/client package — or says "改前端"/"改界面"/"加个 UI" in the deepseek-harness repo. Also use when debugging why a client plugin fails to load or a slot fails to render.
---

# dsh Web Frontend Development

The browser side of dsh is itself plugins: `packages/client/*` (`@deepseek-ai/dsh-client-<name>`) + build entry `apps/web`. Authoritative rules: `packages/client/AGENTS.md` — read it before touching slots, props, stores, or plugin structure. This skill is the working summary + workflow.

## The three layers (one-way knowledge; red lines)

1. **Data object layer** (`client/runtime`, React-free): `ConnectionController` → `SessionManager` → `Session` own ALL business state (event windows, streaming accumulation, reconnect). Zero React imports — grep-assertable.
2. **Render machinery** (`client/web-react`, shell-only glue): slot renderer, `SessionProvider`, hook binding. Business packages carry NO web-react dependency.
3. **Presentation components** (plugin packages' `src/client/`, pure props): rewritable consumables; everything arrives through props.

Non-negotiables: business data lives in the object layer, never a store (stores carry viewing/interaction state only — selection, drafts, panel widths). The web layer is pure presentation — "how to draw" never enters the session log; a new model-visible input still requires a session event.

## Slot system (the only composition route)

1. One API: `ctx.slots.register({ name, children?, store?, inject? }, Component)`. Only the shell renders `'root'`.
2. **children = declaration + authorization**: you may render exactly the slot keys you declared; rendering undeclared or re-declaring someone else's slot fails at load — the conflict is the design speaking, don't work around it. Slot names mirror the path: `<domain>.<entry>.<hole>` (e.g. `tool.call.toolview`).
3. **Props are the four derived shares**: `PropsRuntime<K>` & `PropsRenderSlots<S>` & `PropsStore<H>` & the inject face. Never hand-write a member a share derives.
4. **Hooks are framework-made only**: `useSession`, `useSessions`, `useWorkspaces`, `useStore`, `renderSlot` + renderer-bound `use<Name>` hooks. Business code never creates hooks as prop values.
5. Live data channels (exactly three): parent knows it → owner props; only the component knows it → local state; shared/survives remounts → a store declared at register.
6. Stores: exported `createXXXStore()` factory (module-level handles forbidden); read `props.useStore`, write `props.actions.*`. Production never calls the factory outside `apply`; tests do.
7. `inject` returns plain JSON-compatible data + callbacks from the apply closure; bare observables only in the reserved `hooks` compartment. **Components never see ctx** — no service imports, no React contexts.
8. Registering into ANOTHER package's slot: use `ctx.slots.inject(name, () => ctx.slots.register(...))` — it waits for the declaration, unwinds and re-runs correctly. A bare register into an undeclared slot is an error.

## Conversation (Chat) nodes

A Chat business feature = one `ConversationNodeDefinition` + its keyed `conversation.chat.node` renderer. Cookbook: `docs/cookbook/adding-a-conversation-node.md`. Rules: `match(event)` reads only the current event; every event in a multi-event context carries/derives the same stable business id; `update` folds one Match into State, deterministically replayable by log `seq`; hot path and renderers never scan the full event window.

## New client package: the three registration surfaces

All three are required; missing any one fails at a different, later point:

1. `tsconfig.client.json` aggregate `references` entry (client packages extend `tsconfig.base.client.json`).
2. A `dsh.client` row in `packages/bundle/web-app/cordis.patch.yml`.
3. A `packages/bundle/web-app/package.json` dependency.

Package skeleton (ui-workspace = complete example; ui-sidebar = minimal): `package.json` with `dsh.client` manifest + exports `.`/`./invariant`/`./client`/`./src/*`, `tsdown.config.ts` calling the shared `clientBundle()` preset, `src/index.ts` (empty node half), `src/invariant.ts` with a real reason, `src/css-modules.d.ts` if using CSS Modules. `dsh.client.inject` edges are informational only (preflight/HMR display) — activation order comes from cordis service waiting, nothing else.

## Styling

`docs/web-styling.md` is authoritative: shared `--dsw-*` tokens + global sheets live in `ui-theme/src/styles/`; components consume semantic aliases via CSS Modules + `clsx`. No literal colors, no component library, no Tailwind. Product copy is Chinese; code comments English.

## The local check ladder (run the narrowest rung)

1. **Every GUI change** — `pnpm run test:gui` (seconds, no browser). Inner loop; run as freely as a typecheck.
2. **Anything altering assembled browser output** (components/copy, apps/web, Vite, webserver, connection/SSE) — also `DSH_SNAPSHOT=replay pnpm run test:web` (rebuilds frontend dist + keyless replayed e2e; real-host case self-skips without `DEEPSEEK_API_KEY`). `DSH_SNAPSHOT=refresh` only after confirming an intentional output change.
3. **Before PR** — `.agents/skills/dsh-pre-push-checks/SKILL.md` selects the narrow checks.

Live-probing gotcha: the registry serves `lib/client.js`, not sources — rebuild the package bundle (`pnpm --filter <pkg> bundle`) before testing against a running `dsh web`.

Coverage: client sources are in the per-file 100% gate; unreachable defensive arms need `/* v8 ignore -- <reason> */` with a real reason. Component specs feed props directly (`createXXXStore().create()` + plain stubs), assert user-visible behavior, `// @vitest-environment jsdom` pragma on line 1.

## Study material

In-repo: `ui-workspace` (complete package example), `ui-sidebar`/`ui-user-questions` (minimal skeletons), `ui-conversation` (multi-domain split with `contract/` + `apply.ts` assembly). Community: `loadingvx/deepseek-harness-workbench-plugin` builds a full IDE workbench (chat/editor/files/Git columns, tabs, terminal) purely through the slot system — the best large-scale composition reference outside the repo.

## Export discipline

The `/client` entrypoint is public API, not a barrel: export only `apply`/`inject`/`Config`, type-only store factories, and shared types. Same-package tests import internals via relative paths. Cross-package imports of another plugin's symbols are forbidden — the sanctioned routes are slots and ctx services; if neither fits, stop and escalate.
