# dsh-cyberworkstation-kit

Shared helpers for the [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation) plugins: the loopback write fence every
suite router uses and the stored-session reader. It is not a dsh plugin and is never registered in a profile:
plugins installed from npm pull it in as a regular dependency, nothing to do by hand. In the repository it
is `plugins/_shared`, and `launcher/peer-links.mjs` links it next to the plugins so `link:` installs resolve it.

| Module | What it holds | Used by |
|---|---|---|
| `dsh-cyberworkstation-kit/session-read` | Stored-session reads on the core's persistence handles (`list()`, `open(id, 'read')`, `read()`, `close()`), live reads without the removed `Session.events`, and the source-extras sidecar (`~/.dsh/session-source-extras.json`: per-message plugin members keyed by message id, fork lineage, the lock file) | chat-editor, memory-lite, desktop-pet, drop-files, temp-chat, control-deck |
| `dsh-cyberworkstation-kit/fence` | The loopback write fence for plugin HTTP routes: `hostOf`, `isLoopbackRequest`, `rejectCrossSite(req, { requireJson, allowLoopbackOrigins })`, `readBody(req, limit)`, `json(res, code, data)`, `refuse(req, res)` | every suite-authored router (the forks that carry routes — dsh-vision-bridge-zh and the retired dsh-token-usage-plus — keep their upstream route code) |

## How it resolves

Plugins are linked into the dsh profile from this directory, so Node resolves their imports from
`plugins/<name>/lib/`, walking up to `plugins/node_modules/`. `launcher/peer-links.mjs` creates a junction
`plugins/node_modules/dsh-cyberworkstation-kit → plugins/_shared` there, the same way it links the core's own
`@deepseek-ai/*` packages. The launcher runs it before every dsh start and `setup.cmd` runs it once; a plugin
that names `dsh-cyberworkstation-kit` in its `dependencies` (a `link:` install never fetches it, so the junction stands in; an npm install fetches it) gets the link.

## Rules

- A change here reaches every consumer at once: run the maintainer suite (`npm test`; it lives outside the repository) after editing.
- Comments in English; no plugin-specific behaviour (a plugin that needs a different body reader keeps its own).
- The fence's strict form is the default. Only a route that a launcher *page* calls directly from the browser
  (another loopback port) passes `allowLoopbackOrigins: true`; the launcher server itself proxies most calls
  and never needs it.
