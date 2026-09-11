# DSH Launcher — the DeepSeek Harness visual workbench

Modelled on the feature shape of Aki (秋葉aaaki)'s ComfyUI launcher (one-click start, version and plugin management, updates, skinning) and built for dsh. Zero dependencies — the server itself runs on any current Node, while the dsh core it launches requires Node `^22.19 || >=24` (24 LTS recommended): double-click `DSH启动器.exe`, or `start-launcher.cmd` / `node server.mjs`, then open http://127.0.0.1:3090.

## Features

| Section | Content |
|---|---|
| Dashboard | one-click start / stop, open the Web UI, live status, dsh output tail, quick workspace |
| Plugins | profile plugin list (version / source / bundle layer) + built-in capability rows, npm or link: install, remove, npm market, one-click update |
| Skills | user skills (~/.dsh/skills) + repo skills, GitHub market, open folder |
| Sessions | sessions grouped by workspace (newest first), filter, one-click ZIP export through the core endpoint, open folder |
| Storage | sizes of 9 key directories (60 s cache) + Explorer shortcuts; **config backup / restore** (one JSON bundle of the suite's ~/.dsh configuration — settings.yaml as-is, deck + presets, web search, safety rules, model params, memory, profile patches, skills, hooks, frontend skin; restore copies the current files to ~/.dsh/backups first, lists the files before confirming and flags hooks / profiles / settings.yaml; the credential store and session logs are never included) |
| Self-check | Node, core build, peer links, the profile's plugin roster read from `plugins/` (every `dsh-*` package unless its package.json says `suiteDefault: false`), ports, config files |
| Updates | local vs latest upstream release, core (git pull + install + build:lib + build:web), upgrade the vendored core to any upstream tag, plugins (pnpm update), launcher self-check panel — all in the background with live output |
| Tokens | Claude-Code-style overview, ≈26-week heatmap (Monday-aligned, 26–27 columns), per-model and per-day tables (data: the cost-meter-plus ledger) |
| Control Deck | Prompts / Regex / World Info / Sampling & context / Web search / Safety rules / Quick start tabs, presets, SillyTavern import/export, one Save button writing all three files. The Web search tab now offers the fourth mode (the API provider's own search, billed per search), the `web_fetch` page-reader switch, and writes the same file as the dsh Settings section |
| Model parameters | Every route (DeepSeek official / OpenRouter / local) and model: context window, max output, thinking levels; local models are probed and auto-taught; OpenRouter `<model>:online` web-search variants added / removed per row (routes that carry their own `models` list) |
| Memory & context | Session list (open and cold); per session: context pressure vs the compaction threshold, the active compaction summary in an editable box (saved as a real compaction record through the dsh-memory-lite plugin), compaction history, compact-now, store-in-memory; long-term memory items (search / pin / scope / edit / delete / export / import / clear), plugin settings (deposit, extraction, injection mode, tools, optional local embeddings) and a recall test |
| Credentials | every credential reference with bindings / status / source, alias and note, set / replace / delete through the core store; **spare keys** per reference (add / keep the current one / use / rename / delete; a switch keeps the secret it replaces); **refresh model list** (provider-sync) and **dsh default model** (route → model) |
| Appearance | launcher skins and frontend skins imported / switched **separately**; community skin market; "(none)" restores the stock look |
| Logs | launcher log (`.local/logs/launcher-<date>.log`, every action), dsh output, both update logs |

## How dsh is launched

`server.mjs` boots the core from its built CLI (`core/apps/cli/lib/bin.js`) under plain Node — cold start ≈ 1.5 s. When the core has not been built yet it falls back to the source launch (`corepack pnpm dsh web`, tsx, ≈ 20 s). Before every start it runs `peer-links.mjs`, which links the core packages the suite plugins import (`@deepseek-ai/dsh-tools`, `dsh-settings`, …) into `plugins/node_modules/` so plain Node can resolve them. `dsh plugin …` operations (install / remove / market) also use the built CLI; because that command forwards to a bare `pnpm`, they fall back to `corepack pnpm dsh plugin …` when `pnpm` is not on PATH (corepack not enabled system-wide).

All launch helpers honor `DSH_HOME` (default `~/.dsh`), `DSH_LAUNCHER_PORT` (3090), and `DSH_WEB_PORT` (3080). Ports must be distinct integers in 1–65535. The EXE and CMD authenticate the selected launcher's status before opening its page. They do not open a page when the token is missing/invalid or a different service occupies the port.

`DSH_HOME` uses the core's path rules: an empty or whitespace-only value selects the default, `~`, `~/` and `~\` expand to the user home, and a relative path starts at the directory from which setup, CMD, EXE or the Node entry point was invoked. Each launcher entry resolves it once before changing working directories and passes the absolute result to child processes. Suite plugins use the core resolver when started directly through dsh as well. The bootstrap resolver needs only Node, so setup also works before core is downloaded or built.

Stop checks the complete listening port and the process's CLI path, profile and creation identity. It never terminates ancestor terminals. If a manually launched source command used a relative path and this launcher cannot establish its working directory, stop it in its original terminal. Repeated start/stop clicks are serialized; a process still preparing after the readiness timeout remains tracked so another click does not spawn a duplicate.

## Removing patch-layer plugins

`dsh-credentials-keyring` and `dsh-lan-fence` are referenced by the web profile's own `cordis.patch.yml`. The launcher refuses to uninstall either dependency while that reference remains, because the next boot would otherwise try to load a missing module. Other plugins keep their normal uninstall behavior.

1. Stop dsh and back up `$DSH_HOME/profiles/web/cordis.patch.yml` (normally `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`).
2. For `dsh-lan-fence`, remove its `lan-fence` insert entry. Review your connection trust settings before restarting.
3. For `dsh-credentials-keyring`, first retain or migrate every key you need from Windows Credential Manager through the credentials UI. Removing the plugin does not delete keyring secrets, but the stock file provider cannot read them. Remove the `credentials-keyring` insert entry and remove the associated `id: credentials` / `disabled: true` override so the stock provider can start. Re-enter retained keys through the credentials UI after restarting with that provider.
4. Keep the remaining patch file a valid YAML array (`[]` if empty), then uninstall the package in the launcher and restart dsh. If the file cannot be read or parsed, uninstall is cancelled until it is repaired.

## Skin mechanism

- **Launcher skins**: `skins/launcher/*.css`, override the `--lc-*` variables; switching applies instantly. Built-in: `default` (light / dark / system), `cyberpunk-2077` (neon yellow #fcee0a × electric cyan #00f0ff, chamfered cards, glitch animations) and `night-city-holo` (graphite base, holographic cyan hairlines, 2077 gold for the active state, vector navigation icons, one easing and short distances — no flicker, no scanlines).
- **Frontend skins**: `skins/frontend/*.css`, override dsh's `--dsw-alias-*` tokens (light `:root` + dark `body[data-ds-dark-theme]`, see the core's `packages/client/ui-theme/src/styles/design-platform.css`). Switching = copy to `~/.dsh/frontend-skin.css`, served by the `dsh-skin-loader` plugin (`ctx.webServer.register` route + a browser-side style tag); refresh the dsh page to apply, "(none)" restores the stock look.

## Security boundary

- **The API needs this launcher's own token.** It is minted on first boot and reused across restarts (delete `~/.dsh/launcher.token` to rotate it), handed to the page through a one-time `?t=` query (sent only to this loopback server, scrubbed from the address bar immediately; `#t=` also accepted for hand-opened links — but Edge's `--app` handoff drops fragments, so the launcher itself uses the query), and kept in that owner-only file. Without it every `/api/` request is refused — the origin check alone only ever stopped a web page, and several routes install packages, spawn Explorer or write under `~/.dsh`. Scripts of your own can read the token file; anything else on the machine cannot drive the launcher just by knowing the port.

- Binds 127.0.0.1 only; folder shortcuts use an allow-list; plugin install arguments are filtered for shell metacharacters; skin names are sanitised and CSS is capped at 500 KB.
- Every suite router that accepts a write carries the same loopback + same-origin fence (a foreign `Host`, a cross-site or same-site fetch, a mismatched Origin, or a non-JSON POST is refused with 403). The read-only routes — `dsh-control-deck`, `dsh-price-hint`, `dsh-skin-loader` — serve derived data over GET and also refuse a foreign `Host`, which is what a DNS-rebinding page presents.
- Nine suite plugins put their panels inside dsh itself rather than here: `dsh-chat-editor` (edit / delete messages), `dsh-temp-chat` (project-less chats), `dsh-media-lab` (image / video / voice APIs), `dsh-desktop-pet` (the desktop companion), `dsh-provider-sync` (model-list sync card), `dsh-drop-files` (no panel: a drop handler), `dsh-credentials-center` (also a launcher page), `dsh-vision-bridge-zh` (a card under Plugins) and `dsh-import-note` (a card under Plugins). The launcher only registers them and checks they are mounted.
- No session deletion (read-only list + folder shortcut; delete in Explorer yourself). Summary edits and compaction go through the dsh-memory-lite plugin inside the core (append-only compaction bracket under `agent.runMaintenance`), never by rewriting session files.
- Backup restore accepts only whitelisted relative paths under ~/.dsh (no traversal, no absolute paths, depth-limited directories by extension) and keeps a copy of every overwritten file.
