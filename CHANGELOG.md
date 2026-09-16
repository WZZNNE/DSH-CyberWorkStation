# Changelog

All notable changes to DSH CyberWorkStation. The vendored core (`core/`) tracks the upstream [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) release named in each entry.

## v1.12.0 — 2026-09-16

The suite packages go to npm. Two renames come with that, both because the names were already taken on the registry:

- **Shared kit renamed**: `@dsh-suite/kit` is now `dsh-cyberworkstation-kit` (the `dsh-suite` npm organisation belongs to another project). Consumers list it as a regular dependency; `launcher/peer-links.mjs` links any `_`-prefixed package under `plugins/` by its name, scoped or not. Existing installs need no action: the kit is never registered as a plugin.
- **Three plugins renamed**: `dsh-desktop-pet` → `dsh-desktop-pet-cws`, `dsh-temp-chat` → `dsh-temp-chat-cws`, `dsh-skin-studio` → `dsh-skin-studio-cws` (directories, routes and data files unchanged). An existing install should re-register them once: run `setup.cmd` again (it removes the old registrations first), or in the launcher press Remove on `dsh-desktop-pet`, `dsh-temp-chat` and `dsh-skin-studio` and then install `link:<repo>/plugins/dsh-desktop-pet` (and the other two); remove first, otherwise two bundle entries point at one directory. Old registrations are not guaranteed to load (the core may still resolve them through its module fallback); the self-check lists the new names as missing until they are re-registered.
- Every suite package carries repository / homepage / bugs / keywords / `publishConfig: public` metadata, an Install section with its npm name, and is published from the repository as-is (`npm run publish:npm`; `dsh-token-usage-plus` stays unpublished). The two forks number their own releases from now on (`dsh-cost-meter-plus` 1.6.0 on upstream 1.5.19, `dsh-vision-bridge-zh` 0.4.6 on upstream 0.4.5): a suffixed version such as `1.5.19-plus.4` counts as a prerelease on npm and would never be picked up by `dsh plugin update`.
- Launcher: installing a plugin directory that is still registered under an old package name removes the old registration first, and the self-check names such entries (`旧名注册` / `registered under an old name`) instead of reporting the new name as missing.

- Desktop pet: the settings panel previews the three custom UI drawings; for a pet that has none (the normal case) the route answered 404 and the browser console logged three errors each time the section opened. The two preview routes (`/ui` and `/ui-skin/part`) now answer 204 No Content for a missing drawing; an unknown part name is still 404.
- setup.cmd: the fallback clone tag, used only when `core/` is absent, names the vendored core (dsh-v0.1.5-rc.2); it still said 0.1.1-rc.2.
- READMEs and the launcher README: the core start time is stated as about 5 s, which is what the full plugin set measures, instead of 1.5 s.

## v1.11.1 — 2026-09-15

Repository engineering pass and plainer READMEs. Format and usability work on the suite itself; no plugin behaviour changed except where noted.

- **One shared kit instead of copies**: `plugins/_shared` is the package `@dsh-suite/kit`
  (`session-read`, `fence`), linked into `plugins/node_modules/@dsh-suite/kit` by
  `launcher/peer-links.mjs` the way the core's packages are. The six byte-identical `session-read.js`
  copies are gone, and fourteen of the fifteen inline loopback fences (the retired fork
  `dsh-token-usage-plus` keeps its upstream copy): the writers import the same `rejectCrossSite` / `json`
  (eight of them the shared `readBody`, three keep a body reader of their own), the GET-only routers
  `isLoopbackRequest`. The strict fence is the default (foreign Host, cross-site or
  same-site fetch, an Origin on another port, a non-JSON POST are refused); local-reasoning and memory-lite
  keep accepting other loopback origins (`allowLoopbackOrigins`) because a launcher page reads them
  directly. Two small drifts: the sidecar's 30 s passive-write backoff is now one per process instead of
  one per plugin, and quick-workspace's over-limit message reads `body too large`. After pulling this
  change run `npm run peer-links` (or start dsh once from the launcher, which runs it): the kit resolves
  through a junction under `plugins/node_modules`, and a dsh started by hand from `core/` before that
  cannot load the fourteen plugins.
- **Launcher server split**: `launcher/server.mjs` (1592 → 1137 lines) keeps the routes; the dsh CLI invocation
  and process inspection (`lib/dsh-cli.mjs`), skins (`lib/skins.mjs`), configuration backup / restore
  (`lib/backup.mjs`) and the small helpers (`lib/util.mjs`) are modules with explicit inputs. Same
  routes, same behaviour; smoke-tested live.
- **Repair from the launcher**: Update page → *修复旧会话日志 / Repair old session logs* — *Preview* runs the
  repair script without writing, *Repair* runs it for real; the script's own refusal while dsh listens is
  shown as is. `POST /api/sessions/repair`. Documented in `launcher/README.md`.
- **Line endings**: `.gitattributes` pins LF for every suite file, root files included (CRLF only for
  `.cmd` / `.bat`); the working tree was normalised to match, and commits no longer print an autocrlf
  warning per file.
- **Generated README marked**: `README.zh.md` starts with a generated-file comment; its generator moved into
  the repository (`docs/showcase-src/build.mjs`, `npm run readme:zh`).
- **Root `package.json` + ESLint**: `npm run lint` (flat config: Node modules, browser halves, the
  launcher's classic-script pages), `npm run peer-links`, `npm run readme:zh`, `npm run repair`; `npm test`
  runs the maintainer suite, which lives outside the repository and fails loudly when it is absent.
  The lint pass removed dead imports and write-only variables, a BOM literal inside a regex, and useless
  escapes; the remaining warnings are unused arguments and helper components in the two forked plugins
  plus two unused arguments in desktop-pet's browser half.
- **READMEs** for dsh-control-deck, dsh-price-hint, dsh-skin-loader, dsh-skin-studio and the kit.
- **Top-level READMEs rewritten in a plainer register** (zh and en): no per-figure template labels, no numbered
  chapter prefixes, no slogan lists; facts, tables and screenshots unchanged. The zh renderer
  (`docs/showcase-src/render-md.mjs`) emits the same plain layout.
- Not split, on purpose: `dsh-cost-meter-plus/lib/client.js` (the core serves a client half as one bundle
  read from `exports["./client"]`; sibling files are not served, so a split needs a build step) and
  `dsh-memory-lite/lib/index.js` (its route section closes over some sixty bindings; a factory taking them
  all would add indirection, not clarity).

## v1.11.0 — 2026-09-15

Core bump **0.1.1-rc.2 → 0.1.5-rc.2** (upstream tag `dsh-v0.1.5-rc.2`) and the plugin fixes it needed.
0.1.6-alpha.1 was published the same day and skipped on purpose: the community plugins target 0.1.5-rc.

### Core and community plugins
- Vendored core 0.1.5-rc.2; `launcher/vendor-core.mjs` no longer overflows Node's 1 MB `spawnSync`
  buffer on a large mirror (robocopy `/NP` + 64 MB buffer). Community plugins bumped:
  dsh-context 0.52.2, dsh-better-sidebar 0.19.1, @linxin666/dsh-remote-web-ui 0.3.22,
  dsh-chat-import 0.11.5, @syncended/dsh-retry 0.2.3, dsh-automation 0.2.0-alpha.0 (this one needs Node ≥ 24;
  on Node 22 stay on 0.1.4); `dsh-voice-input-plugin` follows its upstream rename to `dsh-voice-input-web` 0.1.2.
- `dsh-at-file` 0.6.3 is dropped from the profile: it imports the removed `settingsNamespace`
  export and, on a core without per-plugin isolation, takes the whole plugin tree down. dsh 0.1.5
  carries its own `@` file references and general file upload.

### Plugins on the 0.1.5 contracts
- **Session reads** (memory-lite, chat-editor, desktop-pet, drop-files, control-deck, temp-chat):
  `sessionPersistence.inspect()` and `listSnapshots()` are gone; stored sessions are read through `list()`
  snapshots and `open(id, 'read')` → `read()` → `close()`, live sessions through `snapshotEvents()` /
  `eventAt()` (the `Session.events` getter was removed). One shared `lib/session-read.js` per plugin.
- **Replace surface ops** (memory-lite, chat-editor): the core renamed `{ op: 'replace', start, end }`
  to `{ startSeq, endSeq }`; writers emit the new keys, readers accept both.
- **Plugin source members leave the log**: every 0.1.5 migration stage (v0→v1, v1→v2, v2→v3) rejects
  plugin-authored `user/message` sources that carry members beyond the documented ones (chat-editor's `editedSeq` / `editKind` / …,
  memory-lite's `memoryIds` / `memoryInvalidations` / `memoryRecallCallId`), which made those sessions
  unopenable; the v1→v2 and v2→v3 stages renumber event seqs (v2→v3 also inserts a `system/message`).
  chat-editor and memory-lite now write only
  `{ kind, plugin }` into the log and keep their members in `~/.dsh/session-source-extras.json`, keyed by
  session and MESSAGE id (the identity a migration preserves); the shared reader merges them back.
  `launcher/repair-session-sources.mjs` moves the members of pre-sidecar logs (`session.jsonl`, `session.v1`,
  `session.v2`) into the same file (backup kept beside each log, the core's zstd framing preserved, the log
  replaced by one rename, the sidecar written atomically); a v0 message without an id is keyed by the id the
  core's v0→v1 stage mints for it, an `editedSeq` gains its `editedMessageId`, an unparsable sidecar is set
  aside under a unique name, and the script refuses to run beside a listening dsh (`--force` overrides). The
  sidecar itself is rewritten under an exclusive lock from a fresh read (the repair script holds the same lock
  for its run), so two dsh processes sharing one home never lose each other's records.
- **Forks and display overrides survive the sidecar**: a chat-editor fork is created the way the core's own
  fork is (a seeded child whose copied prefix is inherited), seeded from the core's own bytes (no sidecar
  member is written into the child log), and records the parent link, so the child inherits the parent's
  recorded members through its lineage without copying them; a display override remembers the message id
  and is re-anchored (id first, then seq + original text, then a unique text of the same role, else it stays
  on its seq) after the core renumbers a log — all text comparisons use the store's own normalisation.
- **temp-chat**: the footer button crashed (`useSessions` is a selector hook now); the persona
  config key `text` became `prefix`, in the shipped preset and, once, in the user's copy under
  `~/.dsh/.agent-presets/temp-chat/` (dated backup).
- **provider-sync**: pi-ai now refuses a route whose model list names an id its catalog does not
  describe unless the route declares its `api`; the OpenRouter sync writes `api: openai-completions` once
  when the resolved route has none.
- **local-reasoning / cost-meter / price-hint**: the DeepSeek catalog gained `deepseek-flash`
  (DeepSeek-V4.1-Flash, the new default model); local-reasoning reads the adapter's default list from
  the settings schema (its serialized reference graph) instead of a literal, keeps `systemPromptUpdate`
  when it rewrites the list (never re-adding one the user's list dropped) and calls the list "still the
  catalog" only when name, description, image fields and that flag all match the schema default; cost-meter
  prices `deepseek-flash` and bills the legacy `deepseek-v4-flash` / `-vision-exp` names at the Flash price
  (official pricing page, 2026-09-15) — an existing ledger's entry for those two ids follows the new default
  only when it still equals the pre-upgrade default as stored (off-peak tier included, no member beyond the
  tiers). local-reasoning says once when the schema exposes no default list (the catalog then stays pinned).
- **cost-meter backfill**: a session directory now holds `session.v3.jsonl.zstd` beside the preserved legacy
  log; the backfill reads one log per session, the newest generation.
- **media-lab / chat-editor / cost-meter (browser halves)**: declare `slots` in their client inject list; the
  0.1.5 client runner mounts a half by its declared injects, and media-lab's settings section had gone missing.
- **web-search-plus**: `web_fetch` is not mounted twice when a profile keeps the core's own
  `tool-web` fetch on. The 0.1.5 shipped presets (`standard`, `cordis`, `ptc`) mount the core's own
  `web_fetch` per session, which shadows the plugin's host-plane registration there, so the plugin now also
  hooks `tools/execute` for `web_fetch`: whichever registration a session resolves, the call runs through the
  same guarded reader (public addresses only, blacklist, byte and character caps, the output cap carried
  inside the value because the core re-renders from it) while the switch is on; a call without a url string
  is left to the tool's own schema check; status reports `fetch.hooked` (true only while the reader can
  serve). A caller's cancel is reported as a cancel, not a timeout. **import-note / vision-bridge-zh**: the removed `dsh-client-runtime` package
  is no longer named in the client inject list. **memory-lite**: the recall route reads its body before
  reconciling; a tool host without `deferContext` is tolerated; a memory-update notice whose invalidation
  ids cannot be recorded is withheld instead of being sent and repeated on every step (one warning per session).

### Launcher
- The core gates the web index and `/api/*` behind a per-process launch token and prints the
  authenticated URL on its `dsh web:` line; the launcher reads that line back from the dsh log,
  hands the token URL to the browser (dashboard, "open dsh", start reply) and treats the line, not the
  open port, as readiness — a load failure is reported as a failed start, an exited process by its exit
  code. The token is forgotten when the process exits; after a launcher restart it is recovered from the
  log only for a process the launcher started (pid written beside the start marker, the URL taken only from
  the lines after it, listening pids cached for 10 s). That recovery covers built-mode starts: in source
  mode the recorded pid is the `cmd` / corepack wrapper's, and the launcher falls back to the token-less
  URL after its own restart; the pid cache is dropped on stop and exit. The boot-log parsing lives in
  `launcher/boot-probe.mjs`. `vendor-core.mjs` also refuses a robocopy run that reported mismatched entries.

### Docs
- README (zh / en): roster versions, community count 8 (+ 1 MCP server), figure 25 (the dropped plugin's
  settings page) removed and later figures renumbered, vendored-core badge 0.1.5-rc.2, the core's 12 shipped
  skills, and how `web_fetch` behaves on the core's shipped presets.

## v1.10.0 — 2026-09-11

- **Docs**: README (zh / en) rewritten around 33 screenshots — every launcher page, every panel inside dsh, and the full plugin roster with provenance (original / fork / adopted).
- **Launcher**: self-check parses the profile patch with a real YAML parser; uninstalling the two patch-layer plugins (keyring, LAN fence) is blocked while the profile still references them; `DSH_WEB_PORT` is passed to the core; stop verifies the process identity before terminating; `DSH_HOME` is resolved once at the entry point; the Web search form saves through a field patch so hidden settings survive; EXE rebuilt.
- **Web search**: SearXNG source with an optional local extractor (`toolVisit`, `extractorUrl`); page text stays in the tool value; multi-query sources are distributed round-robin.
- **Memory**: facts and summaries taken from messages that were later edited or deleted are withdrawn, and sessions that already received them get a correction notice; `memory_recall` results are tracked too.
- **Chat editor**: display edits are derived from the log (exact seq matching); **Control deck**: macros read the current turn, lorebook scans the current surface, display regex runs in a worker, saving keeps drafts; **Temp chat** opens the created session; **Vision bridge** sends multi-image requests jointly and checks directory containment by real path; **Price hint** hides ambiguous prices; **Token usage** reads the ledger from the current home; **Drop files** refuses junctions that leave the workspace.

## v1.9.0 — 2026-09-02

A second pass on the same day, from a list of eight things noticed while using v1.8.0; the record
is `.local/docs/2026-09-02-round2.md`.

### Page reader: `web_fetch` for every model
- The shipped agent presets register `web_search` only (`tool-web` with `fetch: false`), so a
  model that wanted a page had nothing but the shell — and under the Windows ACL sandbox the shell's
  HTTPS is dead (Schannel's `AcquireCredentialsHandle` returns `SEC_E_NO_CREDENTIALS` under the
  write-restricted token; reproduced with the sandbox runner, `.local/docs/2026-09-02-regression.md`).
- `dsh-web-search-plus` 0.4.1 mounts `web_fetch` itself at the host plane, built from the core's own
  `@deepseek-ai/dsh-tool-web` (arguments, HTML→text, result card) over the plugin's own transport:
  the name is resolved once, every address must be public (no IP literals, no private / loopback /
  link-local / documentation ranges in any IPv4 or IPv6 spelling, the `blacklist` hosts), and the
  socket opens to that address with the lookup overridden — a resolve-then-fetch check leaves a
  DNS-rebinding window, this does not. Same-origin redirects only, each hop validated; text-like
  content only; byte and character caps. A switch on the dsh card and the launcher deck
  (`fetch.enabled`, on by default) mounts / unmounts it within 1.5 s; "web search: off" takes it
  down too. Verified end to end with the local model: one call, 1 s, the page text back.

### Credentials Center
- The Settings section's rows were a five-column table whose action column sat past the panel's
  right edge — "set / replace / delete" existed but could not be seen. Rows are cards now: name,
  status, source and the actions on one line, alias / note / bindings on the next.
- Spare keys: a reference can hold several secrets (`REF__SLOT_<id>` records in the same
  credential store, labels in the aliases file). "Use" makes one the secret in force and keeps the
  one it replaces as a spare unless it already is one; "keep the current" stores a hand-typed secret
  before switching; rename / delete. "In use" is derived by value at view time (a hand-typed secret
  marks no spare), writes are serialized, a failed switch withdraws its own copy, a reference that
  still holds spares cannot be forgotten, a read-only reference cannot be replaced. Both surfaces
  (dsh section, launcher page) have the panel — with a filter and "bound only" on both now; the
  launcher proxies `/api/creds/slots*` and never echoes a value.
- The reference list is not a fixed roster: it is joined at request time from the llm routes, the
  media / search / pet / memory configs, the aliases file and the store — a new route or plugin
  appears by itself.

### Context tab (dsh-context)
- "上下文" stayed on "正在读取会话日志…" forever: the installed community plugin (0.13.0, Aug 19)
  registered its projections with the old `schema` field, which the current core ignores
  (`ProjectionDefinition.stateSchema` / `wire.viewSchema`), so the client never received a view.
  Updated to dsh-context 0.40.1 through the launcher; the tab renders. (A community plugin from the
  launcher's plugin market, not part of `setup.cmd`: a fresh install adopts it at ≥ 0.40.)

### Look
- Dropdowns: native `<select>` popups painted their `<option>`s with browser defaults (black text on
  a dark list, or white on white for a transparent select). Every suite panel, the dsh skin and the
  launcher now set option colors from the theme tokens.
- Launcher navigation: vector holo icons (SVG masks whose color follows the state — dim cyan, cyan on
  hover, gold when active — crisp at 20 px; distinct fallback glyphs for the other skins), a hairline
  that slides in beside the active entry, views that rise in, cards that lift a pixel on hover, the
  toast that slides up; gold checkboxes; the background as a fixed layer instead of
  `background-attachment`; reduced-motion honoured throughout. The suite's sidebar buttons in
  dsh (temp chat, pet, chats) use the same line-icon language instead of emoji. No scanlines, no
  flicker, no data streams — the glow stays where it was.
- Vision card: title and description stack like the other plugin cards (the head text lacked a
  column layout).

### Fixed along the way
- Cost meter: the custom-balance card's checkbox rendered the literal word "enable" in both
  languages — the string was called `enable` while only `enableBudget` existed. Found by a
  dictionary sweep that now also proves every `T.x` / `t('…')` in all eight suite panels exists in
  both language halves, and that the launcher's 536 keys line up one for one across zh and en.

### Launcher
- The self-check names a community plugin that is too old for this core to talk to — `dsh-context`
  below 0.40 registered its projections with a field the core no longer reads, so its Context tab
  loaded forever with nothing in any log. `/api/selfcheck` reports `profile.outdated`.
- The other skin's navigation had nine sprite cells for thirteen entries, so four pages wore another
  page's icon and every glyph was soft at 20 px; `cyberpunk-2077` now draws the same thirteen vector
  icons as the holo skin in its own neon palette.
- The self-check's suite roster is read from `plugins/` (every `dsh-*` package; a plugin kept in the
  repo but out of the default profile says `suiteDefault: false`, as `dsh-token-usage-plus` does),
  so a new plugin is expected the moment it lands. When that directory cannot be read the check says so
  rather than comparing against a hand-written list that would drift.

### Desktop pet
- **The right-click menu was invisible on Windows 11** — a transparent plate with dark text, while a
  screenshot of the same menu looked correct. `ACCENT_ENABLE_ACRYLICBLURBEHIND` through
  `SetWindowCompositionAttribute` is the Windows 10 way to blur a Win32 popup; on 11 it renders the
  window fully transparent instead, and screen capture composites it the old way, which is why the
  bug could not be photographed. The host now reads the real build from the registry
  (`Environment.OSVersion` lies without a manifest) and asks DWM for `DWMWA_SYSTEMBACKDROP_TYPE`
  there; the legacy call is only made on Windows 10. Both callers paint an opaque plate of their
  own, so a refused effect is still readable.
- The window did not always come back after a dsh restart: the host-exit handler cleared the
  reopen marker whenever the plugin was still alive, and on a launcher stop the host notices the
  server going away before the harness process is gone — a race that erased the marker. Only an
  owner's stop clears it now; any other exit leaves it for the next boot (+1 test).

### Adversarial reviews and regression
- Two full review rounds by three independent reviewers each (server / integration, UI / skin / pet,
  and needs-and-convenience from a demanding daily user), plus three real-use rounds. Round 1 scored
  5 / 5 / 6 of 10; round 2, after the fixes, 7 / 7 / 8. Every finding and its fix is recorded in
  `.local/docs/2026-09-02-round2.md` and `.local/docs/2026-09-02-regression.md`.
- What round 2 caught and this release fixes: a save landing inside a spare-key switch destroyed the
  just-saved secret (`/set`, `/unset` and forget now share the switch's write chain, and the switch
  re-reads the secret in force immediately before replacing it); a `content-encoding` the reader
  never checked handed compressed bytes to the model as text (gzip / deflate / brotli are undone, an
  encoding we cannot undo is refused); same-origin-only redirects broke http→https and apex→www for
  no security gain (any hop that passes the whole guard is followed, and every hop re-runs it); the
  transport's own test never ran the transport (four suites now drive a real server through it);
  the credentials page forced the whole launcher to scroll sideways, leaving Delete off-screen;
  its text fields were indistinguishable from its buttons; and the low-balance warning painted an
  unreadable colour from a token that does not exist.
- The page reader's resolved state is written into `web-search.json` on first load, so the switch in
  both UIs shows a value that is stored rather than a default nobody chose.
- Suite: 504 maintainer cases green (19 new: the `web_fetch` mount, guard, pinned transport, its
  four transport suites, the switch and disposal; the spare-key round trip, the save-during-switch
  race and label collisions; the pet reopen marker).

## v1.8.0 — 2026-09-02

Thirteen user-reported defects taken one by one with evidence first (real pages, logs, replayed
requests); the record is `.local/docs/2026-09-02-bugfix-round.md` (`.local/` is the maintainer's
git-ignored folder, like the test suite — see the README).

### The headline: Claude on OpenRouter "never answers" (bugs 5 + 6)
- Reproduced in the web UI: `UNSUPPORTED_REASONING_EFFORT` for any reasoning level, and with the
  default level a request that shows "Deep diving…" for minutes (a stream idle timeout retried five
  times by the retry plugins). Two causes: the OpenRouter route's model entries carried no
  `reasoningEfforts`, and — found by replaying dsh's own request through a logging proxy —
  OpenRouter's web plugin (`:online`, which the search plugin's provider-native mode applies)
  never answers an Anthropic model when the request carries the harness's ~90 tool schemas
  (93 tools / 87 KB stalls, 60 tools / 69 KB answers in 2 s; kimi with the same tools answers).
- New plugin `dsh-provider-sync`: keeps every OpenRouter route's model list current (on boot when
  the last sync is older than the interval, then every 24 h, and on demand from a Settings card),
  adds new models, refreshes name / context / output limits, and declares the effort ladder for
  reasoning-capable models. Hand-written entries and their order are kept; new ids are appended.
- `dsh-web-search-plus`: Anthropic models keep their plain id in provider-native mode
  (`providerNative.anthropicNative` opts in); "Test search" in that mode makes one real
  `:online` request and shows the citations and cost.

### Cost meter (bug 7)
- Local routes are free — the LM Studio model had been billed at the DeepSeek default table; a
  paid vendor's route behind a loopback gateway is still billed. The ledger is repriced from its
  tokens once (rule v1). The display currency follows the API by default (USD here); the settings
  section is named "用量与费用"; the duplicate `dsh-token-usage-plus` page left the profile.
- The settings page now leads with the money: official balance, today / month / total, today's
  sessions; token heat-map, per-model and budget follow; the vendor quota panels (OpenCode Go,
  Coding Plan, custom balance — collapsed unless enabled) sit at the end.

### Desktop pet (bugs 2, 8, 11)
- An expression is shown once (at least 2.5 s, at most 12 s) and the pet goes back to an idle
  drawing; idles rotate every 45–90 s.
- Empty leftover chats are pruned and never created before a first message.
- "Follow dsh" shows what it resolves to (the default itself is set in the Credentials Center,
  see below).

### New plugins
- `dsh-drop-files` (bug 9): any non-image file dropped on the chat lands in the workspace's
  `.dsh-uploads/` and is referenced as `@.dsh-uploads/<name>`.
- `dsh-credentials-center` (bug 10): every credential reference with its bindings, status, source,
  alias and note; set / replace / delete through the core store; a launcher page and a Settings section.
- `dsh-vision-bridge-zh` (bug 3): a Chinese-UI fork of the community vision bridge replaces the
  English-only card.
- `dsh-import-note` (follow-up 4): one card under Settings → Plugins stating, with the source
  lines, that the community session importer never overrides dsh's or a plugin's system prompt
  (its own page cannot carry the sentence: single-owner locale namespace, no slot).
- Media lab (bug 4, pending the user's confirmation of which control was meant): the appended
  "you have media tools" prompt section is now a visible switch, and the text says it only appends —
  no prompt of the harness, the control deck or the user is ever replaced.

### Credentials Center gains the model controls (user follow-ups 1 and 8)
- "Refresh model list" — on the launcher's Credentials page and in dsh Settings → Credentials —
  runs `POST /dsh-provider-sync/sync` and shows the last sync time and this run's counts. The
  core's model picker is left untouched.
- "dsh default model" — route first, then a model of that route — writes `agent-default-model`
  through the settings service from both places (`GET /dsh-credentials-center/models`,
  `POST /dsh-credentials-center/default-model`, validated against the route's list unless the
  "allow an id outside the list" box is ticked). The pet
  panel only shows what "follow dsh" resolves to; its `/default-model` route is gone.

### Claude on OpenRouter, said where it is chosen (follow-ups 5 and 6)
- provider-sync appends "【claude系模型不可走openrouter原生api搜索,建议自己配置api】" to the
  name of every `anthropic/` model on an OpenRouter route, so the picker says it; the web-search
  settings note carries the same sentence. The rule itself is unchanged (Claude stays off
  `:online`; `providerNative.anthropicNative` opts in).
- Replaying dsh's own 93-tool request as `:online` through OpenAI, Google, DeepSeek, Moonshot,
  Qwen and Mistral answered in 2–11 s each (Grok: a 400 from its provider, not a hang); only
  Anthropic hangs, so the rule stays Anthropic-only (`.local/docs/2026-09-02-bugfix-round.md`).

### Session import and prompts (follow-up 4)
- Read in full: the community importer keeps source system / developer prompts only when its
  "import system prompt" switch is on (default off), and then as a plugin-sourced context
  message inside the imported session's own log — never in dsh's system prompt or any plugin
  section. The `dsh-import-note` card under Settings → Plugins says so (the importer's own page
  cannot carry a line of ours).

### Fixed after the adversarial reviews
- cost meter: the balance handler wrote a flag that only existed in another scope (every
  balance fetch rejected); the one-time reprice now only frees local rows and re-prices paid rows
  that had tokens but no cost; the paid-vendor rule matches whole vendor names.
- provider-sync: hand edits to name / context / output limit are kept (the plugin only refreshes
  what it wrote last time), the owner's order is kept (new ids appended), a failed sync backs off
  (5 → 15 → 60 min, see the second paragraph), `/settings` accepts only `intervalHours` and the
  `anthropicNote` switch.
- The three new routers carry the suite's loopback + same-origin fence (foreign Host, cross-site,
  mismatched Origin, non-JSON POST → 403); drop-files also refuses a folder that is not the
  workspace of a session dsh knows, and ends the core's drag overlay after a handled drop.
- Desktop pet: a window that was open when dsh went down comes back after the next boot (a
  marker under `~/.dsh/pets/_host/` lives while the window runs and is removed when the owner
  stops it or the host exits on its own) — a dsh restart, launcher-driven or not, no longer makes
  the pet vanish until someone opens it again.
- Desktop pet: "new chat" keeps a stable draft that `GET /chat` answers; the empty-chat prune
  only removes a real empty list; the holo UI set ships with the plugin (`assets/ui-skins/holo`,
  drawn by `tools/draw-holo-ui.ps1`) with 6 px lines for a 10 % slice and a dark button.
- Skins: tokens on the body element (the light theme lost them), missing tokens added, no
  uppercase in tables, readable selection; launcher primary buttons legible again, hero / heat
  variables defined; both skins whitelisted in `.gitignore` and built-in.
- Vision bridge: the expanded card renders Chinese too, one locale source for every label.
- Third review round (a fourth confirmed it): a stray file in a pet's chats folder no longer takes the pet's
  status down; the credentials list derives the vendor default for pets and media that borrow or
  follow a route; "add reference" is create-if-absent (re-adding never wipes a label) and unbound
  references can be forgotten; an unlisted default model id is also written into the route's model
  list so pi-ai accepts it (a registered adapter route such as deepseek-official is a fixed set: an
  id outside it is refused and both pickers hide the switch there); the Claude-note switch is on the provider-sync card and the launcher
  page, sync results say state and delta apart; `/settings` refuses non-number / non-boolean values;
  the launcher's credential rows work (`$`), disabled buttons look disabled, the skin's stylesheet
  carries validators (304), file names lose Windows-hostile trailing dots, a dropped PDF / Office
  file says the model cannot read it, the pet window's reopen behaviour is stated in the panel.
- Second review round: drop-files awaits the core's async snapshot list and checks the session the
  browser names first (the snapshot fallback was dead code), its refusals carry codes the browser
  turns into its own language, and the uploads folder ignores itself in git; the credentials
  center lists every configurable route (DeepSeek's official route included) and fills a route
  without a list from the adapter's catalog, so any of them can be the default; the cost meter
  bills a loopback route only when it names a paid vendor AND carries that vendor's credential
  (an Ollama route named after a DeepSeek model stays free) — with tests for the rules and the
  ledger repair; provider-sync gained an `anthropicNote` switch (off strips the note), a 5 → 15 →
  60 min retry ladder, honest counters (an id counts once; notes are reported apart) and a 400 for
  a bad interval; the pet's bundled UI set is copied into the library on boot, pet-only asides
  (proactive lines nobody answered) are folded in both chat lists, rename works on a draft, a
  one-shot loop plays once; the import-note card only renders while the importer is installed and
  is collapsible like its neighbours; the launcher's credential rows work again (`$`), the sync
  button posts, offline / failed states show, "apply" waits for a real change, the model select
  groups by vendor, the dashboard links to the Credentials page; three more clients follow the dsh
  UI language instead of the browser's; the frontend skin inlines its background (no dependency
  on the launcher), covers the light-theme residue tokens and leaves disabled buttons alone; the
  launcher skin's selection colour is readable; the self-check reads the profile's patch file for
  the two patch-layer plugins and `launcher/dsh-patch-layers.mjs` registers them on a fresh install.
- Fresh-install lists (`setup.cmd`, launcher self-check) name every current plugin; the two
  patch-layer plugins (keyring, LAN fence) are registered by `launcher/dsh-patch-layers.mjs` and
  counted by the self-check from the profile's patch file; launcher static assets carry
  validators; the credentials table uses the launcher's table styles.

### Look (bug 12)
- Frontend skin `night-city-holo`, launcher skin of the same name, a gpt-image-2 Night City
  background, and a vector-drawn holographic nine-slice UI set for the desktop pet.

### Also
- The headless profile boots again (control-deck's web routes are optional now).
- Suite: 485 maintainer cases green (`node --test ".local/tests/*/*.mjs"`), 46 of them new this round (the new plugins, the web-search native test, the cost-meter rules).

## v1.7.1 — 2026-09-02

Desktop pet drag rework + render cache, reference-guided image generation in the media lab, and the
王胖子 (pangzi2) animation set being completed with gpt-image-2 instead of by hand.

### dsh-desktop-pet host (`plugins/dsh-desktop-pet/host/PetHost.cs`)
- **Drag lag, root cause 1**: the `Move` handler re-pushed the whole 32-bit layered surface on every
  pixel of travel, and the bubble and chat windows repainted themselves on every move as well. Moves
  now only reposition the companions; a 60 Hz timer owns the visuals while a drag is in progress.
- **Drag lag, root cause 2**: every render resampled the 2048² source drawing down to the window
  (measured 28.8 ms per idle frame at 14 fps, 15.3 ms per drag tick against a 16 ms tick, so mouse
  moves queued behind the renderer). Frames are now scaled once per window size into premultiplied
  bitmaps (`scaledFrames`) and blitted 1:1; measured idle render ≈ 3 ms steady, drag tick 10.9 ms,
  idle CPU 1.9 % of a core, all 50 test moves processed (41 before). The premultiplied cache also
  removes the coloured rim that transparent pixels bled into scaled edges.
- **Omnidirectional drag animation**: the pet leans against the drag direction (±16°, pivot near the
  head) and stretches with vertical speed, on a damped spring that settles after release (trace:
  lean reaches 16–19° in a fast drag, springs back and the timer stops). "Echo" `MouseMove`s raised
  by moving the window under a still cursor no longer cancel the lean.
- Maintainer switches `--demo-tilt <deg>` (freeze the lean for a screenshot) and `--drag-log <file>`.
- Review round: the cache is invalidated on the window size, not the fitted frame size (frames of
  unequal pixel size would have evicted each other); the lean timer starts when a press becomes a
  drag, so a press-and-hold renders nothing (measured 0 renders over 1.8 s); the timer stops with
  the window; the trace writer stays open and flushes on release.
- Test note (recorded in `.local/docs/pangzi2-gpt-image-pipeline-and-drag.md`): any host instance
  started for a pet id posts `/window-position` on release and overwrites that pet's saved geometry,
  and synthetic `mouse_event` deltas are scaled by the display's 125 % DPI — both looked like drag
  bugs and were not.

### dsh-media-lab
- OpenRouter image adapter forwards `resolution` (512 / 1K / 2K / 4K), an integer `seed` and
  `references[]` as the documented `input_references` (openrouter.ai/docs/features/multimodal/image-generation);
  `/generate` accepts them (references: `data:image/png|jpeg|webp;base64` or http(s) only, ≤ 12 MB
  each under 4 MB, at most four) and reads its body with a 6 MB limit so a 1024² reference fits —
  every other route keeps the 256 KB default, and a declared `content-length` over the limit is
  refused before a byte is buffered. The tier is case-folded and anything outside 512/1K/2K/4K, or
  a seed that is not a non-negative safe integer, is a 400 at the route. Three new tests (adapter
  wire shape and folding; route filtering/capping; body room and validation).

### pangzi2 (王胖子) animations
- Five finished sets migrated from the Codex staging (60 frames, 2048² RGBA). The remaining 33 sets
  (414 frames) are drawn by `.local/tools/gen-frames.mjs`: canon drawing as reference, one seed per
  set, flat magenta backdrop (the model refuses `background: transparent`) keyed out locally with
  despill and black under alpha, raw outputs kept for re-keying, whole sets synced into the pet's
  assets only when complete. 1K / medium ≈ 38 s and ≈ $0.065 per frame.
- Review round on the driver: transport errors are retried instead of ending the run, staged files
  are written tmp + rename under a pid lock, a bad staged file is removed and redrawn, rejected
  attempts keep their own raw names, a rejected re-key blocks the set's sync, the despill only
  touches silhouette pixels, and a set is published last frame first so the window never latches a
  short run.

Suite: 439 maintainer cases green (3 new: dsh-media-lab).

## v1.7.0 — 2026-09-01

Six-axis adversarial pass (advancement / usability / aesthetics / potential / engineering / extensibility)
with a hard rule: check everything first, verify each finding, fix in small reversible steps, keep a
baseline. A full config baseline was archived (`launcher /api/backup` + profile files) before any edit.

### The headline fix — the LAN /api fence moved out of the vendored core (zero core change restored)
- v1.6.0 added a `lanTrust` field to `core/packages/bundle/web-app` to keep an all-interfaces bind from
  trusting LAN IPs on `/api`. Two reviewers flagged it: it made the "**zero core rewrites**" claim false,
  and the launcher's "upgrade core to any tag" (`robocopy /MIR` over `src`) would silently wipe the patch
  and **reopen the LAN /api hole** on the next upgrade.
- Fixed by **reverting the core change entirely** and moving the fence into a new plugin, **`dsh-lan-fence`**:
  `dsh-client-connection` keeps the *same array reference* it is handed for `trustedHosts` and re-reads it
  per request, and `web-app` mirrors the removable LAN literals in `webRuntime.lanAddresses`, so the plugin
  strips exactly those authorities **in place** — no core edit, and a core upgrade can never reopen the hole.
  A fail-loud self-check warns if a future core version stops sharing the array. Verified live: LAN `/api`
  → 403, loopback → 200, `/pair-accept` over LAN → 200. The "zero core rewrites" claim is true again.

### `dsh-credentials-keyring`
- The helper's `stdin` now has an `error` listener: a write to a helper that died between its exit event
  and the next request breaks the pipe asynchronously on some platforms — with no listener that is an
  `uncaughtException` that takes the harness down, the one thing this fail-open transport must never do.
  It now routes to the same cooldown/fallback as every other failure.

### `dsh-desktop-pet`
- `/asset` text uploads no longer let a program plant a **constant (every-turn) lorebook entry**, closing a
  gap with the `/lore` program-path hardening. A panel upload still makes a constant entry (the owner is
  present, as documented); a program upload becomes a keyword-gated, non-constant entry instead.
- Cleaned up corrupted test-conversation records (mojibake titles from an earlier PowerShell test that sent
  CJK bodies as GBK — a client-side encoding artifact, not a plugin bug; the pet's own writes were intact).

### `dsh-media-lab`
- `status()` now awaits the credential-ref helper like every other lookup, so the first status after boot
  no longer reports a configured key as unconfigured for one tick.

### Deliberately NOT changed (recorded in `.local/docs/six-axis-review.md` with rationale)
- The shared http-guard / harness-borrow duplication across ~11 plugins (a real extensibility cost) is left
  for a dedicated refactor — extracting a shared seam mid-pass carries more risk than it removes here.
- memory-lite / chat-editor coupling to the core compaction event protocol, the WinForms/SendKeys screen
  control, Windows-only scope, and the pre-1.0 upstream maintenance tax are inherent trade-offs, not defects.

Suite: 436 maintainer cases green (6 new: dsh-lan-fence). Adversarial review scores after fixes recorded in
the six-axis doc.

## v1.6.0 — 2026-09-01

The ecosystem round: nine community plugins adopted through the launcher's own plugin flow, plus
three in-house pieces the community did not have — auto-allow safety rules, a Windows Credential
Manager backend, and a LAN /api fence switch in the vendored core.

### Community plugins adopted (installed via the launcher, loaded and verified live)
- **`@goodandready/dsh-vision-bridge`** — vision for text-only models: pasted images auto-rewritten
  through a vision model (hybrid mode), plus 26 explicit tools (`describe_image`, OCR incl. local
  Tesseract, grounding, crop, colors, long-screenshot). Channels chain the DSH catalog first, so it
  rides the same providers the Models page already holds.
- **`dsh-at-file`** — `@` mentions search workspace files from the composer (its own settings page
  appears as 文件提及).
- **`dsh-better-sidebar`** — workbench sidebar: 文件 / 源代码管理 / 任务管理 / 终端 / 浏览器 tabs
  (needed `node-pty` + `cloudflared` build approval, granted by name in the profile workspace yaml).
- **`@linxin666/dsh-remote-web-ui`** — scan-to-pair mobile/PC remote running the one official Web
  GUI (portrait touch layer on phones), one-time tokens, revocable devices. LAN bind enabled through
  the plugin's own managed patch block (`0.0.0.0:3080`).
- **`dsh-automation`** — session-scoped recurring self-prompts / timed tasks.
- **`dsh-chat-import`** — import Claude Code / Codex / ChatGPT / Cursor histories as resumable
  sessions (导入会话 in the sidebar, 会话导入 in settings).
- **`dsh-voice-input-plugin`** — mic button in the composer, browser Web Speech API, zero keys
  (mounted via the profile patch, its documented path).
- **`dsh-notification`** — desktop notifications on task results.
- **`@syncended/dsh-retry`** — automatic retries and interrupted-session recovery.
- Evaluated and **rejected**: `dsh-auto-approval` (requires core client packages newer than the
  vendored rc.2 — crashed boot, removed), `dsh-filesnap` (registers event types by mutating a
  harness constant; uninstalling leaves captured sessions unopenable — not an acceptable trade).

### In-house — `dsh-safe-guard` auto-allow rules
- `allowPatterns` joins `denyPatterns`/`askPatterns` in `~/.dsh/safe-guard.json` and the launcher's
  安全规则 tab: a matching shell command skips the generic confirmation. Precedence is fixed and
  cautious — deny beats ask beats allow, built-ins always first, non-shell tools untouched.

### In-house — `dsh-credentials-keyring` (new plugin)
- The stock credential provider subclassed so environment-variable-shaped secrets live in the
  **Windows Credential Manager** (`dsh:<NAME>` generic credentials) instead of the plaintext yaml:
  process env still wins, records/grants stay inherited, secrets migrate on the next 保存密钥, and
  every keyring failure falls back to the stock path (a broken keyring can lose a lookup, never a
  credential). Persistent PowerShell helper (advapi32 CredRead/Write/Delete), serialized, timeout →
  cooldown → fail-open. Verified live end-to-end: a key saved from the media panel landed in the
  Credential Manager, out of the yaml, and resolved as configured.

### Vendored core — `lanTrust` fence switch (packages/bundle/web-app)
- Binding 0.0.0.0 used to auto-trust every local LAN IP on the /api fence, so an **unpaired** LAN
  device could reach the full desktop API — the remote plugin's posture probe flagged exactly this.
  New `lanTrust` config (default true = stock behavior) excludes the derived LAN literals from
  `trustedHosts` when false; the profile patches it off now that pairing fronts remote access.
  Verified live: LAN `/api` → 403, loopback → 200, `/pair-accept` over LAN → 200.

Suite: 428 maintainer cases green (11 new: safe-guard allow layer, keyring transport + layering).

## v1.5.0 — 2026-09-01

Unified DSH credentials across the feature panels, a full-parameter pet lorebook, and a launcher
token that survives restarts.

### `dsh-media-lab` — borrow the harness's API, discover models with prices
- Every media kind gets a **source switch**: 自定义 (exactly the old behavior) or **共享全局 API(DSH)** — the section borrows a provider saved on the harness's Models page, host and credential resolved **together, fail-closed** at request time (a provider whose host cannot be named refuses to lend its key rather than letting an adapter default host receive it; nothing about the borrow is ever written to disk). Only bearer OpenAI-style adapters may borrow (`HARNESS_ADAPTERS`).
- `GET /dsh-media-lab/models` lists a provider's models **filtered by what the page generates** — the image page only sees image-out models — with per-million prices from OpenRouter's modality metadata, id heuristics for plain OpenAI-compatible hosts, and a 10-minute cache keyed by host+kind+credential. The host is never taken from the query.
- TTS **voice presets**: save the current voice id under a name, recall or delete it with one click (per-section, capped at 50).
- The settings panel no longer eats its own state: key save/delete refresh status only (staged edits survive), and a save can no longer write the `(hidden)` header mask over a real custom-endpoint token.

### `dsh-desktop-pet` — full-parameter 设定集 + max input
- Lorebook entries carry the full SillyTavern-style set: enabled / constant / keywords / secondary keys with four trigger logics / per-entry case & whole-word tri-states / probability / order / per-entry scan depth; `/pattern/flags` keys are regexes with deck-faithful flags. Book-level settings (scan depth, char budget, case, whole word) live on the pet. Old `{key, content, always}` books map losslessly.
- **覆盖 / 共存** against the control deck's world info: coexist evaluates the deck's book (read-only, deck defaults baked in, deck-dead entries stay dead) into the pet's prompt alongside its own; the deck and the harness are never touched. A program can neither flip this switch nor rewrite the owner's entries — the append route may only add entries and refresh the content of ones it names.
- `llm.maxInput` (tokens, 0 = off) trims the oldest turns before every request — CJK/Hangul/emoji-aware estimation — and rides the per-pet preset. Follow/harness sources now refuse to borrow a credential whose provider has no nameable host, matching media-lab.

### `dsh-web-search-plus`
- A read-only **「DSH」已保存凭据** card shows every provider credential the Models page holds and whether it is configured (checked via describe — the secret value is never read).

### Launcher
- The API token is minted once and **reused across restarts** (delete `~/.dsh/launcher.token` to rotate): a restart no longer turns every open launcher page into silent 403s. The page shows a full-screen notice when it holds no valid token, and the token now travels as a `?t=` query — Edge's `--app` handoff drops `#fragments`, which is why exe-opened windows were born dead. `start-launcher.cmd` no longer deletes the token file on every run.

Adversarial review: three independent reviewers (credential security / lorebook semantics / UI-i18n), final scores 9, 8, 8.5 of 10 after fixes; every HIGH and MEDIUM finding closed and pinned by tests. Suite: 417 maintainer cases, all green.

## v1.4.0 — 2026-08-31

Four new plugins that live inside the dsh page rather than the launcher: editing and deleting chat
messages, project-less temporary chats, image / video / voice APIs, and a desktop pet — plus web
search finally configured in one place, with the API provider's own search as a fourth mode.

### New plugin — `dsh-chat-editor` (edit / delete chat messages)
- The session header gets a **✎** panel listing every node in the log (role, whether it is still on the model's surface, what shadowed it, fork boundaries). Per row, four actions: **改** and **删除** — each moving *both* views at once, what you see and what the model reads — **折叠** (fold a long message away in the transcript; one click opens it again, nothing else changes), and **分叉**. "Display only" and "model context" used to be two settings for one idea, which nobody outside this file could tell apart; they are one action now, and the original stays in the log either way. Assistant messages also get an inline edit entry in the official assistant-actions slot.
- A model-visible edit is not a rewrite: the plugin appends a `compaction/prune` carrying `{shadowedRange, shadowedSeqs, shadowedTokenCount}` and then a `user/message` with `surfaceOp {op:'replace', start, end}` + `sourceEventSeqs` — the same shadow-price protocol the core's own compaction uses, so the token meter stays correct and the log stays append-only and byte-exact. Editing an **assistant** message lands as a user-role correction with explicit framing, because `assistant/message` requires an open step (`core/packages/core/session/src/invariant.ts`); deletion is a placeholder replacement, because a surface replace cannot produce zero nodes. Tool-call pairing is checked before and after every replacement, replacements are anchored at the position of the node they replace (an edited message stays where it was), cold sessions are resumed with their recorded preset and disposed again unless the browser adopted them, and subagent sessions are read-only.
- Display overrides live in `$DSH_HOME/chat-edits.json` (500 per session, 20 000 chars each) and are matched by text, so a shifting log cannot repaint the wrong row. 16 maintainer cases (9 pure + 7 host-shell against a fake session that enforces the core's surface rules).

### New plugin — `dsh-temp-chat` (conversations that belong to no project)
- **🗒 临时对话** in the sidebar creates a session in a fresh `$DSH_HOME/scratch/tmp-YYYYMMDD-HHmmss-xxxxxx` directory, attached to a shared "临时对话 / Temporary chats" workspace, running a shipped **chat-only agent preset** (persona, agent instructions, skills, ask-user, todo, web — no filesystem writes, no shell, no jobs, no subagents, no workflows) installed into `~/.dsh/.agent-presets/temp-chat` on first run.
- Nothing is deleted automatically. `POST /dsh-temp-chat/clean` removes one folder, refuses anything that is not a scratch folder name, and refuses (409) while that session is still open in dsh. Each temp agent also masks the globally registered tools on its own context (`tools.restrict({ allow: [] })`), because a preset only decides what the preset mounts; `{"tools":"all"}` opts out. 9 maintainer cases.

### New plugin — `dsh-media-lab` (image / video / voice APIs)
- One settings panel (**多媒体 API**) for four kinds, each with its own provider, base URL, model, key and live test: **image** — OpenAI-compatible `/v1/images/generations`, OpenRouter `/api/v1/images`, Google Gemini `/v1beta/interactions`, Replicate, fal; **video** — OpenAI video jobs (Sora), OpenRouter `/api/v1/videos`, Google Veo `:predictLongRunning`, Replicate, fal, MiniMax (Hailuo); **speech** — OpenAI-compatible `/v1/audio/speech` (incl. local Kokoro-FastAPI), ElevenLabs, Fish Audio, MiniMax `t2a_v2`; **transcription** — OpenAI-compatible `/v1/audio/transcriptions` (incl. local Whisper servers). Plus a **custom HTTP** adapter (URL, headers with `{{key}}`, body template with `{{prompt}}` / `{{text}}` / `{{model}}` / `{{voice}}` / `{{size}}` / `{{seconds}}`, `resultPath`, `resultType` base64 / url / hex / binary / text).
- **Image-to-video**: a video request may carry a first frame — `{"kind":"video","image":"<absolute path | data: URL | https: URL>"}` — read through the same filesystem seam as everything else and handed to the provider as its own image-to-video field (`frame_images` on OpenRouter). A provider that cannot take one ignores it.
- Tools `generate_image`, `generate_video`, `text_to_speech`, `transcribe_audio` (each registered only while its kind is enabled and its switch is on). Results are written to `$DSH_HOME/media/` with a JSON sidecar and announced as `[[dsh-media:<id>]]`; the browser half turns that marker into a real `<img>` / `<video>` / `<audio>` served from `/dsh-media-lab/file/<id>` — the core has no image content block, so the transcript stays text and the page draws the media. Async providers are polled to completion with a per-kind timeout, remote URLs are downloaded (authenticated where the provider requires it), `keepDays` sweeps old files, a local endpoint needs no key, and only well-formed media ids resolve to a file. 90 maintainer cases (59 adapter cases driven by a scripted fetch, 31 host-shell).

### New plugin — `dsh-desktop-pet` (+ the `desktop-pet` dsh skill)
- A companion with **its own persona, lorebook and API**: `openai-compatible`, `anthropic` or `gemini`, all multimodal, deliberately separate from the model doing the work. Persona scope is pet-only or **global** (the harness's own assistant takes the persona too).
- **Knows the owner**: opt-in, it reads only what *you* typed in this machine's dsh sessions (never assistant replies, never tool output) through `ctx.sessionPersistence`, distils one paragraph with its own model, and shows it in an editable, erasable box.
- **Knows the work**: `agent/status` transitions make it say one short line when a run starts and finishes; session title and last tool are part of its prompt. **Talks first** on four bands (低 30–60 / 中 15–30 / 高 5–15 / 繁 1–5 minutes), mixing work context and small talk, optionally glancing at the screen first, staying quiet while the harness is busy. **Reminders** parsed from "1小时后…", "in 30 minutes…", "20:30 …". **Voice** both ways through `dsh-media-lab` (hold to talk, or always-on listening in the pet window) — and when that TTS section is **Fish Audio**, the prompt gains the `[tag]` emotion vocabulary from [its emotion reference](https://docs.fish.audio/api-reference/emotion-reference), whose S2 line performs the markers instead of reading them: what the pet writes reaches the voice with its markers and the bubble without them. **Its own artwork** through `generate_image`, with the appearance description carried as the character reference so it stays on model.
- **Permissions in three levels** (`none` / `ask` / `full`) for screen reading and for computer control, separately. The pet has no tool loop: it asks with tags (`[screen]`, `[click:x,y]`, `[type:…]`, `[key:ctrl+s]`, `[scroll:n]`, `[image:…]`, `[search:…]`, `[remind:…]`, `[speak]`), and every tag is checked against those levels — `ask` raises an Allow / Deny card in dsh and in the pet window and times out as a refusal after two minutes. Screen capture is a downscaled PNG via PowerShell + System.Drawing; control is SendKeys / `mouse_event`.
- **Which model it uses** is a switch, not a second setup: **"the same one dsh uses"** reads the harness's own provider settings (`llm-pi-ai.providers`) and borrows that route's host and credential, leaving the owner to pick a model from the list it already has — no second key for the same account. **"its own"** keeps the independent endpoint, and its key row now says where the key goes (dsh's credential store, under the named variable), whether one is stored, and that the button next to it saves immediately rather than with the panel's Save. A base URL that already ends in `/v1` — which is how LM Studio, Ollama and most local servers print their address — no longer becomes `/v1/v1`.
- **The conversations are managed like any other conversation**, in a workspace of their own: a list on the left (with the pet picker, a heading the owner can rename, and 新建), the conversation on the right — title editable, every message editable or deletable, resume or delete the lot. It opens from the sidebar, where the pet now contributes **one narrow entry of two icon buttons**: that footer is a single non-wrapping row shared with the other plugins, and a wide entry there squeezes theirs.
- **The look is the pet's own**: a `theme` block (bubble fill, text, accent, opacity, frost, corner, text size) that the desktop bubble, the pet page and the in-app pet all draw from, so one pet is frosted glass and another is flat paper without either surface being edited. The panel edits it over a chequerboard — what is being chosen is how much of the desktop shows through — with Glass / Solid / Warm-paper presets. On the desktop that is a real frosted backdrop (`SetWindowCompositionAttribute`, acrylic on Windows 10+), a rounded region and the pet's own colours, replacing the system-grey box; on the web surfaces it is `backdrop-filter` with one square corner on the speaking side.
- The sprite stage is a **fixed box** on every surface: an `<img>` that has not decoded yet is 0×0, and a frame run that collapses and re-expands twelve times a second shakes everything laid out under it — which is what made the sidebar's other buttons flicker while the pet was open.
- **The desktop host is per-monitor DPI aware** (`SetProcessDpiAwarenessContext`). Without it Windows renders the pet at 96dpi and bitmap-stretches the whole window to the display's scale — which is why an unaware pet looks soft on a 4K screen: sprite and bubble text alike were blown-up copies rather than drawn at the size they are shown. The frame runs are cut at 720px to match.
- **No stand-in on the way in.** The window is handed the sprite the pet is wearing on its command line, so it starts fetching before it is shown, and it draws *nothing at all* until a load comes back — a layered window makes "nothing" really nothing. The placeholder is kept for the one case it was for: a pet with no artwork, which would otherwise have no window to drag. Waking the pet used to flash a blue blob every time while the drawings were still being fetched.
- **One pet, one window.** The sidebar's 🐾 wakes the pet in whichever form it is set to — the in-dsh panel, the sprite window or the Edge window — and waking it in one ends the other; the panel's own × and the settings panel's start / stop go through the same door. Two pets on one desktop, each polling the same queue and answering the same owner, was nobody's idea of a pet. A host left behind by an earlier dsh run also ends when a new one starts, since it does not know it was replaced.
- **The speech bubble is a layered window that paints itself** — the plaque and then the text — instead of a Label on a coloured form, so there is no rectangle of background colour around a drawing that does not fill it. It sizes itself to the sentence and its menu is drawn in the pet's own colours; the stock context menu was white with black text next to a drawn pet.
- **Chat furniture is a library**, the way skins are: name the three pieces a pet is wearing and save them (`/ui-skin/save`), list the sets, apply one to any pet (`/ui-skin/apply` — copied, so deleting a set never undresses a pet wearing it), delete one. Sets live in `$DSH_HOME/pets/_ui-skins/<name>/`. Generating with the image model is one option among import / save / apply, not the headline. The desktop resize grip is invisible until hovered (alpha 1 — enough for a layered window's hit test, imperceptible on any wallpaper; the old faint pad read as a grey square parked next to the pet).
- **A chat UI the image model draws.** One button asks for three pieces — bubble plaque, input bar, send key — asks for them with `background: "transparent"` and `output_format: "png"` (openrouter.ai/docs/features/multimodal/image-generation), so the alpha comes from the provider and nothing has to be cut — with the cutout kept as the fallback for a provider that ignores the request, now able to take its key colour from the four corners (`--key=auto`) because a plaque drawn to order does not come back on the field it was asked for and stores them with the sprites. All three surfaces then draw them as a **nine-slice**: corners at their own size, edges stretched one way, middle both, so one drawing wraps any sentence. `/ui?pet=&part=` serves them; the plain colour-and-blur look is still a dropdown away. **The field you type into is opaque on every surface** — translucency belongs behind text, never under it.
- **The desktop window resizes freely** between 90 and 1400 px: drag the bottom-right corner (the handle draws itself when the cursor is over it), Ctrl + wheel, or the slider in the panel — both sides together, so the drawings are never stretched to a different aspect, and the size is remembered the same way the position is.
- **Frame animations**: an expression is either one drawing with a named CSS motion over it (breathe / bob / nod / sway / shake / burst / pop / wobble / stretch / sleep) or a real run of **8–24 drawings** played at its own frame rate. Frame 1 is the sprite's own file and the rest sit beside it numbered (`rest.png`, `rest-02.png` … `rest-24.png`), served by `/sprite?…&frame=n`; all three windows play them, **forwards and then back** by default so a run that does not end where it began still loops without a jump. Frames are mounted once and shown or hidden rather than re-pointed, because sprites are served `no-store`. `prefers-reduced-motion` stops both kinds.
- **Three windows**: the in-dsh floating pet (nothing to install), an always-on-top **WinForms sprite**, and the pet page in a **Microsoft Edge app window** styled frameless + always-on-top. Both desktop variants are one C# file compiled on demand with the .NET Framework compiler Windows ships (`csc.exe`) — no SDK, no NuGet; stopping the window from dsh closes the Edge window too.
- The sprite window is a **layered window** (`UpdateLayeredWindow`), so a cut-out drawing keeps its own alpha: soft edges blend with the desktop instead of leaving a rim of a key colour, and the transparent part of the window is click-through. **Click the pet** and a one-line box opens under it — type, Enter, and the reply comes back in the bubble; drag it and it moves instead (a few pixels of wobble is still a click). The menu carries 跟它说话 / 打开完整聊天 / 设置 / 静音 / 退出, and a window that has just started is handed the pet's own sprite so it never sits as a placeholder waiting for the first line.
- Conversations are the pet's own store: a fresh one per dsh restart, older ones resumable, every message viewable, editable and deletable. Unlimited custom expressions / actions, material upload (images become sprites, text becomes lorebook entries), sprite names resolved strictly inside the pet's asset folder.
- The companion skill `desktop-pet` (installed to `~/.dsh/skills/`) walks the model through designing a pet: what to ask, how to write a persona that small models follow, the artwork checklist (sizes, transparency, naming, frame counts), prompt recipes for consistent expression sheets, the drawing → image-to-video → chroma-key → frames pipeline, and the routes to write the result. 76 maintainer cases (18 pure + 58 host-shell).

### Web search: one place, four modes (`dsh-web-search-plus` 0.2.0)
- The deployment is configured **once** — a new **联网搜索(全局)** section in dsh Settings writes the same `~/.dsh/web-search.json` the launcher's Control Deck tab writes; there is no per-model setting any more.
- Fourth mode **"走 API 自己的供应商搜索"**: on OpenRouter the request switches to the `<model>:online` variant, which OpenRouter serves with its own server-side search (openrouter.ai/docs/features/web-search — equivalent to `plugins:[{id:'web'}]`, any model, **billed per search**; both the settings section and the launcher say so). The variant is created in `llm-pi-ai` settings the first time it is needed (cloned from the base model, revision-checked write with a retry on conflict) because pi-ai refuses a model id its catalog does not hold; routes with no such switch keep the `web_search` tool served by the configured source, and a catalog-only route is left alone. 24 → 37 maintainer cases.

### Review-driven hardening (before release)

Eleven adversarial review passes over the new code (three areas, in parallel, each round re-verifying the last round's claims against the code). Everything they found is fixed and covered by a test — including several fixes that a later round proved were not what the previous round's note said they were.

- **`dsh-media-lab`**: the fal adapter treated the queue envelope as the finished file (its own `status_url` was picked up as "the media"), so fal never worked — a queued request is now polled through to its `response_url`; a failed MiniMax video job errors out instead of polling until the timeout and reporting the wrong reason; the `size` a caller asks for (and voice / language) reaches the wire instead of being silently dropped; the file route streams through `pipeline`, so a file deleted mid-send cannot raise an uncaught error in the harness process; an oversized download is refused before it is buffered; a JSON body where bytes were expected fails loudly instead of saving `undefined`; transcription accepts only audio extensions and reads through the deployment's `ctx.fs` seam when it has one; a config file may only name a credential the plugin itself declares (an arbitrary `keyEnv` plus the custom adapter's free-form URL was an exfiltration path); every generation is time-bounded even when the caller passes no signal.
- **`dsh-desktop-pet` (safety model)**: what may drive the mouse is now decided by what is in the prompt, not by a list of channels. A conversation is clean only while every word in the prompt is the owner's own; a screenshot, a search result, uploaded material, the stored profile or the harness task block marks it — on disk, so resuming it or restarting dsh does not make it clean again — and a control request at **full access** is put to the user anyway. Four review rounds found four different ways past the earlier channel-by-channel rule (a first-turn screenshot, the lorebook, resuming an older conversation, and the tool names the harness reports); the inverted rule closes them as a class.
- **`dsh-desktop-pet`**: the current task's title is folded from the log's `session/title` event and the profile digest orders sessions by the numeric `createdAt` — `SessionHeader` carries neither `title` nor `updatedAt`, so both features had silently done nothing; the reminder tick can no longer take dsh down with an unhandled rejection; closing the webview window gives its host time to close the Edge window instead of orphaning it, the window is closed when the plugin is disposed, and a host left behind by a previous run is found again through a pid file; `/status` no longer parses every conversation on every two-second poll (cached per file mtime) and the media-plugin probe is cached for 30 s; a config write no longer restarts the proactive countdown, so dragging the pet cannot postpone it forever; the window queue stops replaying old lines to a window that reconnects; the screenshot path is quoted with the same helper as everything else and its width is clamped; the consent card states the effect in the plugin's own words and quotes the pet's request; tool output is fed back with its tags stripped, and a control request that follows something the pet read asks again even at full access; the Edge window is matched by the page's exact title (a bare fragment could restyle an unrelated browser window); and the C# host polls off the UI thread, disposes sprites, deletes its temp audio, closes the audio device, answers permission requests with its own Yes/No dialog, and says so instead of exiting silently when its window never appears.
- **`dsh-web-search-plus`**: the "this request went native" flag is per agent (a `WeakMap`) instead of one flag shared by every session; OpenRouter is recognised by host rather than by route name; every give-up branch logs why and `/status` reports which `:online` variants are live; the variant cache is cleared when the config reloads; the config write is atomic (tmp + rename), so a torn write can no longer silently turn search off; the launcher tab carries `providerNative` through a save instead of resetting it; and the DeepSeek source no longer offers a key field this plugin cannot store.
- **all five suite routers touched by this release** (`dsh-chat-editor`, `dsh-temp-chat`, `dsh-media-lab`, `dsh-desktop-pet`, `dsh-web-search-plus`): the origin check compares the whole authority — another loopback port is another origin, as the core's own trust check does — `sec-fetch-site: same-site` is refused, a refused body is drained, and a response that already started is never answered twice. The launcher's own catch got the same guard, its config writes are atomic (tmp + rename with a per-process name, including the Control Deck save), and the one user-written trigger regex now runs inside a worker with a 60 ms deadline: a pattern that backtracks exponentially costs one killed worker and a warning naming that pattern — a match running concurrently for another session is re-run on the replacement worker rather than failed — instead of stalling every session in a single-threaded process. (A save-time shape check was tried first and dropped — it refused safe patterns like `(\w+) *(\w+)` while missing `((a+))+b`, `(a{1,})+b` and `(a|a)+b`.)

**Later rounds** (the reviews kept going until every area scored 8+):

- **`dsh-media-lab` — credentials and SSRF.** A section that points at a host of its own (a custom endpoint, or any provider given a `baseURL`) may now carry only that provider's own credential or `MEDIA_LAB_CUSTOM_KEY` — the earlier rule constrained the custom adapter alone, so `{provider:'openai-compatible', baseURL:'https://attacker.tld', keyEnv:'MINIMAX_API_KEY'}` was a legal config that shipped one provider's key to any server; switching provider now also drops the credential and the base URL the old one used. A poll or download URL that came out of a provider's response body is refused when it points at this machine or this network (loopback, link-local, RFC1918, CGNAT, ULA, `.local`/`.internal`), unless that origin is the one the configuration itself named — and a body fetched from such a URL is never echoed into the error the model sees. Redirects are followed by hand with the credential re-scoped at every hop, a portable header (`user-agent`, `accept`…) is dropped when the key was templated into it, and the 404-fallback leg re-scopes from its own URL.
- **`dsh-media-lab` — wire shapes checked against the official docs.** Gemini's aspect ratio moves from a non-existent `image_config` to the documented `response_format` (ai.google.dev/gemini-api/docs/image-generation); MiniMax video polls `/v2/query/video_generation/{id}`, the only path the API reference documents; fal stops polling once the result leg has been taken (it echoes `request_id` in the result body, which previously looked like "still queued" until the timeout); Fish Audio gets a format it accepts and an mp3 bitrate of 64/128/192; MiniMax speech gets its documented ranges (speed 0.5–2, vol ≤ 10, pitch ±12) and enumerated sample rate and bitrate — the plugin's config is shared across providers, so a value left behind by another one is snapped instead of sent. Base64 is validated before it is written (a half-valid string used to become a 6-byte "PNG"), a URL under a key that says nothing about a payload is no longer treated as the result, and generations run one at a time per kind.
- **`dsh-desktop-pet` — the last way past the permission rule.** The proactive line built its text from the harness task block whatever `taskAwareness` said, so with task awareness off — the setting that makes unattended full access usable — a poisoned session title reached the model and a control tag ran with no card. The block now enters a proactive line only when task awareness is on, and `petTurn` is told when it did. A `/say` posted by a program rather than typed in the panel counts as untrusted too. Tag stripping runs to a fixed point and then sweeps any opener the bound left behind, so a deeply nested `[click…` cannot survive into the visible text and be read back next turn. The permission level is re-read from the pet as it is now, not from the copy the turn started with; `[scroll:向下]` scrolls one notch instead of emitting `NaN`; uploaded assets are served `nosniff`; and the window single-flight is keyed per window. New route `POST /proactive/now` ("say something now").
- **The fence, everywhere.** `dsh-quick-workspace` (which creates directories on POST) and `dsh-token-usage-plus` (which writes the price table) had no fence at all and no body cap; both now carry the same loopback + same-origin check and a byte-counted, capped body. Verified live: a cross-site POST that used to create a directory is refused 403.
- **Launcher.** `#deck` deep links work (`$` returns one element and has no `.find`; it is `$$`) — verified in a browser, including Back/Forward; `?noanim` no longer un-hides the toast in screenshots; the backup-restore write uses a random tmp name and cleans it up on failure.
- **`dsh-control-deck` — the deck's own text work runs where it can be killed.** A regex rule and a lorebook `/re/` key are user-authored (an ST import brings in other people's) and both run against the user's own message on the agent's hot path, where a regex cannot be interrupted: `(a+)+$` on a 30-character message froze the harness for 64 seconds, and a `/re/` key on a lorebook's own constant content for 85. Rule application and the lorebook scan now happen inside a worker that imports `deck.js` itself, with a 250 ms deadline that starts when the worker picks the job up rather than when it is queued (charging it from submission made two concurrent turns lose one turn's deck for no reason); if it overruns, the worker is killed and the deck does nothing that turn — the rules are then retried one at a time so a single bad pattern costs only itself — and that pattern is then parked until the deck is saved again, because retrying it would cost a worker terminate and respawn on every later message. What was skipped is named in `/dsh-control-deck/status` (`skippedWork`), logged, and shown on the launcher's deck status line. Two earlier attempts are worth recording, because both looked right: a shape-based check that rejected `(\w+) *(\w+)` while passing `((a+))+b`, and a load-time probe screen that a reviewer walked past with `(q+q+)+Z` (an alphabet no probe used) and `NOTE:(a+)+Z` (a literal no probe started with) — measuring a pattern is not the same work as running it. The browser half times each display rule once and drops one that costs more than a frame.
- **`launcher` — the API answers the launcher's own page, and nothing else on the machine.** The origin / `sec-fetch-site` check only ever stopped a *web page*; a local process sends no fetch metadata at all, and `/api/plugins/op` npm-installs a package (running its `postinstall`), `/api/open` spawns Explorer, `/api/backup/restore` writes under `~/.dsh`. Every request now has to carry a token minted at boot, written into the served page as a `<meta>` tag (the page keeps `script-src 'self'`) and into `~/.dsh/launcher.token` with owner-only permissions, so your own scripts can use it deliberately. This is what makes the skin sandbox below meaningful: Node's permission model does not cover sockets, so an escaped payload could otherwise have driven the launcher's own API.
- **`launcher` — a community skin's `client.js` is no longer run without a sandbox.** Extraction runs it in a child process under Node's permission model with an empty environment; the `vm` context around it is a DOM stub, not a boundary (code in a `vm` realm reaches the outer one through any constructor it is handed). The unsandboxed retry that fired when the first attempt's **stderr** matched `/bad option|--permission/` is gone — the package being extracted controls that stderr, so it was a one-line path to arbitrary code in the launcher process. A runtime with no permission model now declines to extract at all.
- **Smaller.** The trigger regex and the template that reads its capture groups come from one config snapshot; `regexMatcher.dispose()` is final, so a matcher cannot outlive the plugin; a chat-editor store with a pathological number of entries in one session is trimmed rather than thrown away; and a still-open session is flushed **and kept** on teardown, so nothing is left with no owner.

**Final rounds.**

- **`dsh-desktop-pet` — PowerShell quoting.** `psQuote` doubled the ASCII apostrophe, but PowerShell 5.1 also ends a single-quoted string on U+2018–U+201B — and U+2019 is the ordinary curly apostrophe, so `[type:I don't know]` alone corrupted the command and executed the tail. Nothing the model writes is quoted into a script any more: text is carried as base64 and decoded inside PowerShell.
- **`dsh-desktop-pet` — a reminder is stamped with how it arrived.** `POST /schedule` wrote `by:'user'` unconditionally, so a program could plant a reminder whose text fired later into whatever conversation was open — including a brand-new clean one, which is the escape hatch the docs recommend. It now records `user` or `program`, and a program-written one marks the conversation when it fires. A persona, appearance line or expression description written through `/pet` by a program does the same, because all of them go into the system prompt verbatim. `POST /config` with a `pets` value that is not a non-empty array is a 400 instead of silently replacing every pet on disk, and an unreadable `at` is a 400 instead of a 500.
- **`dsh-media-lab` — the credential rule no longer has an escape hatch.** A section carries its own provider's credential or `MEDIA_LAB_CUSTOM_KEY`, full stop; the earlier "on its own host anything declared is fine" rule meant the settings panel's own provider switch (which posts the whole section back) handed the old provider's key to the new provider's server. Switching provider drops the stored `keyEnv` and `baseURL` before the body is applied, and the panel clears the key field too. `isPrivateAddress` now reads IPv4-mapped IPv6 in the hex form `new URL` normalises to, and a trailing-dot FQDN; `fc`/`fd` are only private as IPv6 literals (`fc2.com` is a public host); and a name is resolved before it is fetched, so `cdn.example A 127.0.0.1` is refused too. A failing download from a host the configuration did not name reports its status, never its body.
- **`dsh-web-search-plus` — `htmlToText` walked a visited page with two lazy regex scans**, which is quadratic on the harness's only thread: 512 KB of `<script ` took 12 s, and the cap allowed 1.5 MB. It is an `indexOf` pass now, and the input is capped at eight times the character budget.
- **`dsh-temp-chat` — the sandbox is enforced, not just presumed.** A preset only decides what the preset mounts; a tool another plugin or your profile registered globally was visible in every temp chat (this deployment's own profile mounts a terminal). Each temp chat now calls `tools.restrict({ allow: [] })` on its own agent context, with `{"tools":"all"}` to opt out.
- **The two read-only routers** (`dsh-price-hint`, `dsh-skin-loader`) refuse a foreign `Host`: no-CORS stops a cross-origin read but not a DNS-rebinding page, and `prices.json` lists every model the user configured.
- **Smaller.** The launcher's update tail catches its own rejection instead of taking the process down; `/api/open` looks up an own property; the empty hash restores the dashboard; `boundedSignal` no longer has a fallback that silently drops the deadline; the pre-step reads one config snapshot for the whole turn; a refused body in `dsh-quick-workspace` is drained rather than answered with a socket reset; and `dsh-token-usage-plus` no longer advertises a `prepare` rebuild that would erase the fence added to its vendored bundle.

### Suite
- `setup.cmd` registers the four new plugins and installs the `desktop-pet` skill; the launcher self-check expects them; `peer-links.mjs` links `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-credentials` for the new plugins.
- The four new routers carry the same loopback + same-origin fence: a foreign `Host` header is refused on every method, POSTs must be JSON, the Origin must match the whole authority, and a refused body is drained. In this release the fence was extended to every router in the suite that accepts a write — `dsh-web-search-plus`, `dsh-quick-workspace` (which creates directories) and `dsh-token-usage-plus` (which writes the price table) had none. The three remaining routers (`dsh-control-deck`, `dsh-price-hint`, `dsh-skin-loader`) are GET-only and set no CORS headers, and all three gained the loopback `Host` check: no-CORS stops a cross-origin read but not a DNS-rebinding page, which the browser treats as same-origin — and `/dsh-control-deck/status` reports the whole deck, `prices.json` every model the user configured.
- README (en/zh): four matrix rows, a new "Inside dsh itself" section, roster rows, counts; plugin READMEs for all four; maintainer tests 182 → 361 cases (the roster rows now also count `dsh-quick-workspace` (2) and the read-only-router fence (1)).

## v1.3.0 — 2026-08-23

The last feature release before the suite goes into maintenance mode: memory across compaction and across sessions, an editable compaction summary per session, config backup / restore, OpenRouter `:online` one-click variants, and the DeepSeek-search label fix.

### New plugin
- **`dsh-memory-lite`** — (1) **Session context**: lists every session (attached or cold) with its context pressure against the compaction threshold (engine config incl. per-model policies, read through `agentPresets.serviceFor(agent, 'compaction')` because the web profile mounts `compaction-basic` inside the agent preset's `isolate` realm), the **active compaction summary in an editable box**, the compaction history and "Compact now". Saving an edit appends a genuine compaction bracket under `agent.runMaintenance` — `compaction/start {turn:null}` → `compaction/summary {provider:'dsh-memory-lite', model:'manual-edit'}` → a replacement `user/message` with `compactCheckpointSource` + `surfaceOp replace` + `sourceEventSeqs` → `compaction/end` — then flushes; the log stays append-only, the token meter's shadow-price protocol holds, and the model continues from the edited text on the next request. Cold sessions are resumed with the preset their log recorded, edited, flushed once and disposed. Guards: open turn / active compaction / checkpoint no longer on the surface / busy agent → 409; sub-agent sessions read-only. (2) **Long-term memory**: compaction summaries are deposited automatically (latest per session), the session's own model extracts durable facts every 8 human turns (`{text, global}`; near-duplicates dropped; per-session watermark), notes via `memory_note`; recall = Okapi BM25 over ASCII words + CJK bigrams with pin / workspace / recency boosts and an optional cosine blend through a local OpenAI-compatible `/v1/embeddings` endpoint (LM Studio / Ollama); injection at `agent/pre-step` as ONE separate plugin-sourced context row after the user's message (first turn: pinned + relevant; later: relevant items not injected before; never sub-agents / snapshots / tool results); tools `memory_recall` / `memory_note`; JSON store `~/.dsh/memory/memory.json`, config `~/.dsh/memory-lite.json` (hot-reloaded), routes `/dsh-memory-lite/*`. Review-driven hardening before release: every write of `memory.json` decides from the file on disk — an external write since the last load / save (the launcher's restore, a hand edit) is merged first (newer by id wins, ids deleted in memory stay deleted), an unparsable file (torn write, hand edit) is moved aside as `memory.json.corrupt-<stamp>` and never empties the loaded store, a file that cannot be read (lock, permission) makes the write refuse (503) instead of overwriting it; compaction summaries are kept whole (summary items up to 20 000 chars, other items 4 000) and injected with their section structure (2 000-char summary budget inside a 4 000-char block); a cold session whose recorded preset cannot be composed is refused (409) instead of falling back to the default preset; a transient maintenance agent that received a prompt mid-job is kept alive instead of being disposed under the user; edits need the token meter (no zero shadow price); a flush failure after a committed edit is reported as "committed but not yet durable"; the query-embedding call on the conversation path is capped at 2.5 s; the BM25 index is cached per store version; the routes are mounted only where a web server exists (deposit / extraction / injection / tools can run headless, though `setup.cmd` registers the plugin in the web profile only); `/embeddings/test` never forwards a credential the saved config does not name. 36 maintainer cases (26 pure + 10 host-shell with a fake session log that enforces the core's surface rules).

### Launcher
- New **Memory & context** page (Session context / Long-term memory / Settings tabs): session list with filter and "only with summary", pressure bar with the threshold mark, editable summary with char count / reset, compaction history with text, compact-now, store-in-memory; item cards (search with BM25 scores, pin / scope / edit / delete, export / import JSON, clear unpinned); settings form (deposit, extraction interval, injection mode, topK, tools, embeddings endpoint + test + fill missing vectors) and a recall test that renders the hits as the injection block they would form. Proxies under `/api/memory/*`.
- **Config backup / restore** on the Storage page: one JSON bundle (`GET /api/backup`, preview, `POST /api/backup/restore`) of the suite's configuration under `~/.dsh` — settings.yaml, control-deck.json + presets, web-search.json, safe-guard.json, local-reasoning.json, memory-lite.json, memory/memory.json, frontend-skin.css, profiles/{web,headless}/cordis.patch.yml, skills/**.md (two levels), hooks/*.json; restore accepts only whitelisted relative paths (no traversal / absolute paths, depth-limited directories by extension, 2 MB per file / 8 MB total), copies every overwritten file to `~/.dsh/backups/before-restore-<stamp>/` first and reports what was written / skipped; the credential store (`.credentials.yaml`) and session logs are never included (settings.yaml is bundled as-is); restore skips NTFS alternate data streams / reserved device names per file, refuses bundles over 500 files, answers `ok:false` when nothing was written, and names profile / hooks files as restart-needed; the memory plugin watches `memory.json` so a restored store is picked up while dsh runs. Request bodies for import / restore may be up to 8 MB (the general cap stays 1 MB).
- Model parameters: OpenRouter routes that carry their own `models` list get a **"+ :online" / "− :online"** button per row (`POST /dsh-local-reasoning/online-variant`) that adds / removes the `<model>:online` entry cloned from the base model (name + " (online)", same contextWindow / maxTokens / levels / compat) — OpenRouter's web search, extra cost per search, any model; catalog routes without a models list are refused with an explanation (`modelOverrides` cannot introduce a model id the catalog lacks). Round-tripped add + remove restores the original models list (same ids and fields; byte-identical on the reference machine, where the list was already in the normalised form the settings writer emits); `− :online` also removes an orphan variant whose base model is gone.
- Web search: the DeepSeek source is now labelled "DeepSeek official search (needs DEEPSEEK_API_KEY; independent of the chat model)" with a matching note.
- `setup.cmd` registers `dsh-memory-lite`; `peer-links.mjs` links `dsh-compaction` and `dsh-session` for it.

### Docs & tests
- Security: the three suite plugin routers (`dsh-memory-lite`, `dsh-web-search-plus`, `dsh-local-reasoning`) now refuse a foreign `Host` header on every method (DNS-rebinding reads), the same fence the core's `/api` and the launcher apply.
- README (en/zh): matrix rows for Memory & context and Config backup, tutorial §9, page tour, roster, FAQ; plugin README; launcher README. Maintainer tests 145 → 182 cases.

## v1.2.1 — 2026-08-23

### Fixes & UX (user feedback round)
- **One Save button on the Control Deck page**: the per-tab "Save & hot-reload" buttons on the Web search and Safety tabs were a confusing duplicate of the page-level button; the page-level button now writes the deck, the web-search config and the safety rules together (API keys keep their own "Save key", they go to the credential store).
- **Model parameters for any model**: the "Local models" page became **Model parameters** — every registered route is listed (DeepSeek official, OpenRouter, local LM Studio / Ollama …) with the effective context window / max output / thinking levels the core resolved (`ctx.llm.listModels` + `resolveModelInfo`) and per-row editing: routes with a `models` list get the entry edited, catalog routes get `modelOverrides.<id>` (llm-pi-ai README), the official DeepSeek route gets its `llm-deepseek` `models` list rewritten (image limits and modalities preserved; levels are adapter-owned and shown locked). `maxTokens` is the per-reply max output. Filter box; routes with > 12 models collapsed.
- **Auto-teach**: on boot the plugin probes local routes and writes the recommended thinking levels for local models that declare none, so the native model picker offers them like any API model (switch + "Teach now" on the page; `autoTeach` in `~/.dsh/local-reasoning.json`).
- **Web search wording**: modes are now "Off / Let the model decide (tool call; provider below) / Search automatically on trigger words (ST style; no tool calling needed)" — "let the model decide" works with every API provider, not only DeepSeek; the regex trigger, query template, injection template, page visits and blacklist moved into an "Advanced" block with one-line labels.
- **Qwen3 on LM Studio**: the level kind reads "soft switch (Qwen3 is on/off only: Off = no thinking, High = thinking)" — Qwen3's reasoning is a continuous thinking budget, not discrete levels, and LM Studio's OpenAI-compatible endpoint documents no reasoning level at all; its native `/api/v1/chat` `reasoning` field (`off|low|medium|high|on`) is honoured per model according to `GET /api/v1/models` `capabilities.reasoning.allowed_options` (documented examples: Gemma 4 `off/on`, DeepSeek R1 `on`) — for Qwen3 the documented control is the on/off soft switch; gpt-oss keeps low/medium/high.
- **Help texts**: every launcher help box / hint is now one or two sentences (details stay in the README); the inline fallback copy in `index.html` is regenerated from the zh dictionary.
- Fixes found by review: `compat.supportsReasoningEffort` is only written when the wire box was actually toggled and only on chat-completions routes (the core refuses that compat on `openai-responses` / Anthropic / Google protocols; recommendations and auto-teach are api-aware, switching a route to `openai-responses` strips it); the Control Deck import handler no longer fails after writing (a `skipped` counter was scoped inside the try block); the deck Save button attempts every tab and names the ones that were not loaded; the Sampling & context summary lists local routes only; local rows no longer pre-fill the dsh default into the input; `inherit` drops a level override; the DeepSeek `models` list is unset only when it is back to the adapter's own catalog; SearXNG without an instance URL is refused in tool mode too; the deck Save answer carries soft-validation warnings (dropped entries) into the toast; tab switches, "Save key", a rejected write and a detour to another page no longer refetch the Web search / Safety forms (unsaved edits survive; only a pane whose own write succeeded is re-read); soft-validation warnings also stay in the deck status line; maintainer tests 142 → 145 cases.

## v1.2.0 — 2026-08-22

### New plugins
- **`dsh-local-reasoning`** — reasoning effort and context budget for locally served models. Detects local `llm-pi-ai` routes, probes LM Studio (`/api/v0/models`; `/api/v1/models` → `loaded_instances[].config.context_length`, `capabilities.reasoning.allowed_options`) and Ollama (`/api/tags`, bounded-concurrency `/api/show`, `/api/ps`), classifies the model family (Ollama thinking models → native `reasoning_effort` none/low/medium/high · gpt-oss effort levels · Qwen3 on LM Studio `/think` `/no_think` soft switch · always-on R1/QwQ · GLM / LM-Studio-native toggles marked not switchable) and writes `reasoningEfforts` / `compat.supportsReasoningEffort` / `contextWindow` / `maxTokens` (optionally the route `api`) through `ctx.settings.mutate(ns, ops, revision)` (conflict → re-read and retry; only local routes and declared models accepted; levels validated) — the native model picker then offers the thinking levels and compaction sizes itself to the real backend window instead of the 262,144 default. Per-model thinking mode (`auto` / `follow-picker` / `on` / `off`) in `~/.dsh/local-reasoning.json`; the soft switch is appended at `agent/pre-step` to the last user-typed message only (never to context snapshots or tool results; recorded in the log like every pre-step message). Levels are editable on the launcher page (`off,low,medium,high`, `off=none,high`, `false`). Routes under `/dsh-local-reasoning/*`.
- **`dsh-web-search-plus`** — SillyTavern-style web search with a hard split between **"core tool call"** (the model's native `web_search` stays, the selected provider serves it through the `tools/execute` waterfall) and **"web search API"** (trigger-based search at `agent/pre-step`, results added as a separate plugin-sourced context message after the user's message; `web_search` denied to avoid double searches). Providers Serper / SerpApi / Tavily / Brave / SearXNG (also registered on the `ctx.web` seam); triggers (backticks / regex / phrases / always, max words), template, character budget, optional page visits with an SSRF guard, domain blacklist, result cache; API keys stored through `ctx.credentials`. Routes `/dsh-web-search-plus/{status,test,key}`. Config `~/.dsh/web-search.json`, hot-reloaded.

### Control Deck v0.3.0 (plugin + launcher)
- Tabbed editor (Prompts / Regex / World Info / Sampling & context / Web search / Safety rules / Quick start) with a per-tab help box and a live "hot-loaded" status line.
- Injection model aligned with the core's own pattern: user-prefix prompts, interval prompts and activated World Info are added as ONE separate plugin-sourced context message after the user's message (the user's words are never rewritten; earlier injections are not re-scanned); `user_input` regex rewrites only user-typed messages; system-position prompts are prompt-section providers (fresh macros per assembly, `{{model}}`/`{{provider}}`/`{{cwd}}` left to the core, any other `{{…}}` neutralised so the core renderer never throws); duplicate prompt names are suffixed and a rejected section can no longer take the hot-reload watcher down; intervals count user messages only.
- The browser half (`client.js`) uses the same regex engine as the host (ST tokens, flags as written); `neutralizeBraces` splits brace runs to a fixpoint so no `{{` ever reaches the core renderer; system-position prompts expand every macro from the assembly context's agent (`{{workspace}}` / `{{cwd}}` included); `@deepseek-ai/dsh-llm` is declared as a peer so `peer-links.mjs` always links it and the status route reports `separateMessages`.
- Regex engine follows ST `runRegexScript` exactly: flags as written (no forced `g`), `{{match}}` = `$0` (any case), multi-digit `$N`, `$<name>`, no `$$` escape; World Info gains tri-state per-entry `caseSensitive` / `matchWholeWords` (null = the new global settings), `delayUntilRecursion` recursion levels, uid-keyed timers (duplicate names no longer collide); `validateDeck` reports invalid regexes / dropped entries and the launcher returns 400 naming the rule; status lists rules that failed to compile.
- ST import: prompt presets follow the `prompt_order` sequence and keep `assistant` roles; `promptOnly` AI-output scripts (not expressible in dsh) are imported disabled and counted; wrong-format or empty imports are refused instead of wiping a kind; exports keep tri-state fields.
- Prompts gain `role`; regex gains the `ai_output` placement — a **display-only** rewrite of assistant text in the dsh web page (new `client.js`: rewrites only text nodes under assistant containers from their original text, schedules with `setTimeout` so background tabs still update, shares its originals map across module instances and applies once — verified in the live dsh UI to add exactly one marker per rule; never touches the log or the model's context); lorebook gains `prioritize`, `useGroupScoring`, per-entry `scanDepth`; global `includeNames`, `minActivations`, `maxDepth`, `macros`; macros `{{date}} {{time}} {{weekday}} {{isodate}} {{isotime}} {{model}} {{provider}} {{workspace}} {{newline}} {{random:…}} {{roll:NdM}}`.
- Presets (save / load / delete, `~/.dsh/control-deck-presets/`) and **SillyTavern import / export** in ST's own formats (World Info `entries{}`, regex scripts with `/pattern/flags` and placement 1/2/5, prompt presets with `prompt_order`) or the whole deck — new pure module `lib/st-format.js`.
- Sampling tab lists every local model's `contextWindow` next to the backend's loaded context and links to the Local models page (the "max context vs LM Studio" conflict is resolved per model, not by truncating history — shipped dsh does not truncate, and the request-reconstruction note keeps every request a pure function of the session log).
- `dsh-safe-guard` hot-loads extra `denyPatterns` / `askPatterns` (ask → `{kind:'ask'}` approval) from `~/.dsh/safe-guard.json`; edited on the Safety rules tab.

### Launcher
- New **Local models** page (probe, per-model thinking levels / mode, contextWindow / maxTokens, apply recommended, route api switch).
- Sessions grouped by project directory (registered workspaces resolved to their real path through a port of the core's `projectKey`, others labelled ≈ best-effort) with filter and one-click ZIP export through the core's `/api/session.export`.
- Update page: local vs latest upstream release (GitHub releases + npm dist-tags, cached 10 min), **upgrade the vendored core to any tag** (`launcher/vendor-core.mjs`: download → mirror into `core/` keeping `node_modules` / build outputs → install → build:lib → build:web), launcher self-check panel (Node range, built CLI, pnpm, peer links, profile bundles, ports, config files).
- Logs page: errors-only toggle, keyword filter, copy, download (full file).
- Launcher hardening: request bodies are read byte-exactly (a non-object JSON body such as `null` is a 400 in the launcher and in both new plugins; `vendor-core.mjs` exits with code 1 on a failed download instead of tripping a libuv assertion) (Buffers decoded once — a CJK character split across socket reads previously became U+FFFD — and the 1 MB cap counts bytes; the two new plugins read their bodies the same way), `/api/*` refuses foreign `Host` headers (DNS rebinding), oversized bodies are drained so the 413 is delivered, whole-deck imports must carry deck keys and may not empty the deck with merge off, preset names refuse Windows device names with extensions, `delayUntilRecursion` levels are editable; deck values are HTML-escaped in every card input (a crafted preset could previously inject markup), a Content-Security-Policy meta limits the page to same-origin scripts, the saved deck is always the normalised shape, request bodies are capped at 1 MB, preset names refuse Windows device names, configured-agent session folders (`<id>-session-<uuid>`) are listed and `~XXXX` escapes decoded, a failed upstream lookup is not cached, `vendor-core.mjs` removes its temp dir on every exit path; `/api/deck` and whole-deck import reject non-object bodies and validate through the engine before writing; `vendor-core.mjs` treats robocopy exit codes 0–7 as success (any copy with changes previously threw).
- Hash deep links now restore the view after every script has loaded (a `$`/`$$` selector slip made `#deck` land on the dashboard).
- `setup.cmd` registers the two new plugins and installs the `control-deck-authoring` in-dsh skill.

### Skills & docs
- New engineering skill `skills/dsh-local-models` and in-dsh skill `dsh-skills/control-deck-authoring`; READMEs for both new plugins; README feature matrix / tutorial / page tour / roster updated; maintainer tests 85 → 142 cases (`.local/tests`).

## v1.1.0 — 2026-08-22

### Core
- Vendored core updated from dsh **0.1.0-rc.8** to **0.1.1-rc.2** (upstream tag `dsh-v0.1.1-rc.2`, 2026-08-21): DeepSeek-V4-Flash-Vision-Exp multimodal model, Files-API image uploads with automatic resizing, multiline `ask_user_question` answers, wide Markdown tables, Bubblewrap `/proc/<pid>/root` sandbox fix, cache-hit 99.x% precision, the structured `webserver/index-inject` table, and the split session-projection API (`stateSchema` / `wire`).
- `dsh-cost-meter-plus`: the `costUsage` projection now carries both projection contracts (`schema`/`view` for 0.1.0-rc.8, `stateSchema`/`wire` for the 0.1.1 line), so the per-session cost badge keeps working on the new core; the view tolerates checkpoints without the reasoning bucket. Core imports (`@deepseek-ai/dsh-credentials`, `dsh-home-paths`) became peer dependencies resolved from the vendored core instead of a second npm copy (`pnpm-workspace.yaml` / `.npmrc` disable peer auto-install; lockfile regenerated).

### Launcher
- **~10× faster start**: dsh is booted from the built CLI (`core/apps/cli/lib/bin.js`) under plain Node (≈ 1.5 s to port-up) instead of `corepack pnpm dsh web` (tsx source launch, ≈ 20 s). Falls back to the source launch when the core has not been built. The launcher no longer spawns a second browser (`--no-open`).
- New `launcher/peer-links.mjs`: links every `@deepseek-ai/*` package a suite plugin declares as peer/dependency into `plugins/node_modules/` (junctions into the vendored core) so plain Node resolves them; run automatically before every start and by `setup.cmd`.
- "Update core" now runs four explicit steps — `git -C <repo-root> pull --ff-only` (the suite root, because the core is vendored without its own `.git`), `pnpm install`, `build:lib`, `build:web` in the core — each spawned with an argument array (no shell string, so paths with spaces are safe); previously a single shell string in the core directory ran the full `pnpm run build`.
- Stop never kills the launcher's own process chain (one CIM query builds the process table); built-in `--dump-config` and `dsh plugin` calls use the fast CLI path (plugin operations fall back to `corepack pnpm dsh plugin` when no bare `pnpm` is on PATH); storage sizes are measured asynchronously and in parallel (the dashboard no longer freezes for seconds); the active frontend skin copy is refreshed on launcher start after a skin file changes; skin names can no longer name a path; every API call must come from the launcher's own origin (cross-site fetch metadata / foreign `Origin` → 403) and mutating calls must be JSON (→ 415 otherwise); update steps carry a 30-minute watchdog; community skin `client.js` extraction runs in a separate, permission-restricted Node process instead of an in-process `vm` context; server messages follow the UI language (`x-lang`).
- Removed the development-only asset upload endpoint and every local path residue; internal logs moved to `.local/logs/`.
- `setup.cmd`: checks the Node version against the core's engines range (`^22.19 || >=24`) up front, pins the fallback upstream clone to the verified tag (`dsh-v0.1.1-rc.2`), registers plugins through the built CLI (falling back to `corepack pnpm dsh` when bare `pnpm` is not on PATH) and runs `peer-links.mjs`; a new `.gitattributes` checks batch files out with CRLF regardless of the user's autocrlf setting.
- Control Deck: new lorebook entries default to whole-word matching like the engine (the checkbox previously saved `false`); interval prompts count per session instead of globally; deck labels are translated.
- Skins: the CRT scanline overlay and the roaming scan band were removed from both cyberpunk-2077 skins (launcher and dsh frontend); everything else is unchanged.
- Stale copy fixed: the community-skin note described skins as plugins; dashboard folder labels named the old checkout.

### Repository hygiene
- Every comment in launcher, plugins, skins, assets and scripts is English; the forked `dsh-cost-meter-plus` / `dsh-token-usage-plus` sources keep English headers only. `DSH启动器.exe` was rebuilt from the updated `launcher-shell.cs` (its fallback message now names `.local/logs/`).
- Maintainer-only material lives under the git-ignored `.local/` directory: plugin unit tests (85 cases, still run with `node --test .local/tests/*/*.mjs`), dev notes, the publish script, runtime logs and intermediate artwork.

## v1.0.4 — 2026-08-20
- Removed local-path residue (placeholder text, doc note, dead repo fallback).

## v1.0.3 — 2026-08-20
- cost-meter ledger persists in one-shot runs on rc.8.

## v1.0.2 — 2026-08-20
- Adversarial hardening: 26 new tests, regex `$`-escape fix, i18n key fix.

## v1.0.1 — 2026-08-20
- token-usage-plus client load fixed on dsh rc.8.

## v1.0.0 — 2026-08-20
- First release: deepseek-harness rc.8 vendored + full suite.
