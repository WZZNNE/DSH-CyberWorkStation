# @dsh-suite/kit

The code every suite plugin shares, in one place instead of a copy per plugin. It is not a plugin: the
launcher's roster only counts `plugins/dsh-*`, and `setup.cmd` registers plugins by name.

| Module | What it holds | Used by |
|---|---|---|
| `@dsh-suite/kit/session-read` | Stored-session reads on the core's persistence handles (`list()`, `open(id, 'read')`, `read()`, `close()`), live reads without the removed `Session.events`, and the source-extras sidecar (`~/.dsh/session-source-extras.json`: per-message plugin members keyed by message id, fork lineage, the lock file) | chat-editor, memory-lite, desktop-pet, drop-files, temp-chat, control-deck |
| `@dsh-suite/kit/fence` | The loopback write fence for plugin HTTP routes: `hostOf`, `isLoopbackRequest`, `rejectCrossSite(req, { requireJson, allowLoopbackOrigins })`, `readBody(req, limit)`, `json(res, code, data)`, `refuse(req, res)` | every suite-authored router (the forks that carry routes — dsh-vision-bridge-zh and the retired dsh-token-usage-plus — keep their upstream route code) |

## How it resolves

Plugins are linked into the dsh profile from this directory, so Node resolves their imports from
`plugins/<name>/lib/`, walking up to `plugins/node_modules/`. `launcher/peer-links.mjs` creates a junction
`plugins/node_modules/@dsh-suite/kit → plugins/_shared` there, the same way it links the core's own
`@deepseek-ai/*` packages. The launcher runs it before every dsh start and `setup.cmd` runs it once; a plugin
that names `@dsh-suite/kit` in its `peerDependencies` gets the link.

## Rules

- A change here reaches every consumer at once: run the maintainer suite (`npm test`; it lives outside the repository) after editing.
- Comments in English; no plugin-specific behaviour (a plugin that needs a different body reader keeps its own).
- The fence's strict form is the default. Only a route that a launcher *page* calls directly from the browser
  (another loopback port) passes `allowLoopbackOrigins: true`; the launcher server itself proxies most calls
  and never needs it.
