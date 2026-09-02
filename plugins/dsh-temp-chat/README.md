# dsh-temp-chat

Temporary conversations that belong to no project.

Stock dsh always opens a session inside a workspace directory. A quick question ("what does this
error mean?") then either pollutes a real project's history or needs a throwaway folder made by
hand. This plugin adds a one-click temp chat:

- a fresh scratch directory per conversation: `$DSH_HOME/scratch/tmp-YYYYMMDD-HHmmss-xxxxxx`;
- one shared workspace, `临时对话 / Temporary chats`, so they group together in the sidebar;
- a shipped **chat-only agent preset** (`temp-chat`), installed into `~/.dsh/.agent-presets/` on
  first run: persona, agent instructions, skills, ask-user, todo and web tools — no filesystem
  writes, no shell, no jobs, no subagents, no workflows. `POST /new` accepts `{preset}` to run a
  different one (`"default"` composes the deployment's normal preset), which deliberately opts out
  of that sandbox — the scratch directory stays, the tool restrictions do not;
- nothing is deleted automatically; `POST /dsh-temp-chat/clean` removes one folder, and refuses
  while that session is still open in dsh.

The sidebar gets a **🗒 临时对话** button; the plugin creates the session, attaches it to the scratch
workspace and flushes it so a reload finds it.

## Routes

| Route | Purpose |
|---|---|
| `GET /dsh-temp-chat/status` | scratch root, preset state, folders on disk with size |
| `POST /dsh-temp-chat/new` | create one temp session (optionally `{preset}`) |
| `POST /dsh-temp-chat/clean` | delete one scratch folder (`409` while it is open) |

Behind the loopback + same-origin fence.

## What "sandboxed" means

The shipped preset mounts no file, shell, job, subagent or workflow tools. That alone is not enough:
a preset only decides what the *preset* mounts, and a tool another plugin (or your own profile)
registered globally is visible to every agent. So each temp chat also calls `tools.restrict({ allow: [] })`
on its own agent context, which masks the global set. `POST /dsh-temp-chat/new {"tools":"all"}` opts
out when you do want the deployment's tools, and every reply says `sandboxed: true|false`.

## Tests

`node --test .local/tests/dsh-temp-chat/*.mjs` — 9 maintainer cases: the shipped preset really being chat-only, the global-tool mask (on, opted out of, and on a core that cannot restrict), preset installation, session
creation with preset + workspace + flush, a deployment without the presets service, the cleanup
guard (name shape, live session, idempotence), the loopback fence, and folder listing.
