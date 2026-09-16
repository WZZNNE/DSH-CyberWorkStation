# dsh-control-deck

SillyTavern-grade control deck for DeepSeek Harness: leveled system-prompt entries (roles, intervals,
macros), regex scripts (user input, world info, display-only assistant output), World Info lorebooks with the
full field set, sampling overrides, per-preset tool switches, presets, and SillyTavern JSON import / export.
Everything goes through documented extension points (`systemPrompt.section`, `agent/pre-step`,
`agent/request`, `tools/pre-execute`, `webServer.register`); no core behaviour is patched. The usage follows
SillyTavern; none of its code is used.

## Where it shows up

- **Launcher → 控制甲板 / Control Deck**: the editor for prompts, regex, lorebook, sampling, tools and presets.
  Saving writes `~/.dsh/control-deck.json`; the plugin hot-reloads it within 1.5 s.
- **Launcher → Skills**: the `control-deck-authoring` skill (installed into `~/.dsh/skills`) teaches a model
  to write deck entries.
- Presets live in `~/.dsh/control-deck-presets/<name>.json`; the launcher switches, saves and deletes them.

## Routes (dsh web port, loopback only)

| Route | Purpose |
|---|---|
| `GET /dsh-control-deck/status` | Loaded preset, counts, load errors, skipped work |
| `GET /dsh-control-deck/display-regex.json` | The display-only regex rules the browser half applies |

Reads are GET-only and refuse a foreign `Host` (DNS rebinding) through `dsh-cyberworkstation-kit/fence`.

## Files

- `lib/index.js` host half (injection, regex, lorebook scoring, tool switches, routes)
- `lib/client.js` browser half (display-only regex on rendered messages)
- `lib/deck.js`, `lib/deck-runner.js`, `lib/deck-worker.js`, `lib/st-format.js`, `lib/history.js` pure
  modules: config normalisation, macro expansion, the regex worker (a backtracking pattern is killed, not
  the host), SillyTavern conversions, session history reads

Reasoning effort stays out of the deck: the core model picker owns it (`dsh-local-reasoning` teaches local
models the levels).
