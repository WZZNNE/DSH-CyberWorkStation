# dsh-quick-workspace

The core's "ungrouped" session group has no `workspaceId`, and its **+** button is guarded by
`group.workspaceId !== undefined` (`packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx`),
so clicking it does nothing — a session must belong to a workspace by design. This plugin does not
touch the core; it adds a side door: the DSH Launcher POSTs an absolute path, the workspace is
created, and a page refresh lets you pick it and start chatting.

## Install

```sh
dsh plugin --profile web add dsh-quick-workspace
```

Restart dsh afterwards. As part of [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation) the plugin is registered by `setup.cmd` from the repository checkout instead.

The DSH Launcher's dashboard is its only user interface; without the launcher it only exposes the routes below.

## Routes

| Route | What it does |
|---|---|
| `POST /dsh-quick-workspace/create` | `{ "path": "D:/projects/my-project", "title": "optional" }` — creates the directory if it does not exist, then registers a workspace for it |
| `GET /dsh-quick-workspace/list` | the registered workspaces (`id`, `path`, `title`) |

## What it will do to your disk

`create` runs `mkdirSync(path, { recursive: true })` on **any absolute path this process can write**,
with no allow-list, and then registers it. That is the feature — it is how you make a workspace for a
folder that does not exist yet — but it is worth knowing before you point it somewhere. On Windows a
UNC path (`\\host\share\x`) makes the dsh process authenticate outbound to that share.

## Fence

Both routes carry the suite's loopback + same-origin fence: a foreign `Host` header is refused on
every method (DNS rebinding), a `cross-site` or `same-site` fetch is refused, the `Origin` must match
the whole authority, a POST must be `application/json`, the body is counted in bytes and capped at
64 KB (a refused body is drained, not reset), and an array body is not an object.

Without that fence any web page could have made this route create directories, which is what a review
round found: a cross-site POST created a directory on the running instance before the fence landed.
