# dsh-chat-editor

Edit and delete chat messages — yours and the assistant's — from inside the dsh conversation view.

## Install

```sh
dsh plugin --profile web add dsh-chat-editor
```

Restart dsh afterwards. As part of [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation) the plugin is registered by `setup.cmd` from the repository checkout instead.

Zero core rewrites, and no rewriting of history: the dsh session log is append-only and its
invariants are enforced by the core (`core/packages/core/session/src/invariant.ts`). This plugin
therefore offers five honest operations instead of pretending to mutate the past.

## What each button does

| Action | What actually happens |
|---|---|
| **改** (edit) | For an active message, one surface replacement records the change. The browser derives its displayed text from that same log record; there is no second sidecar write. Repeated edits retain the original message seq and role. Off-surface messages can only receive an explicitly labelled display change. |
| **隐藏** | the row is hidden in the browser only, same store |
| — the model half of **改** | a `compaction/prune` event followed by a surface `replace` — the new text takes the old node's place in the model's context, the token meter's shadow price stays correct, and the log stays append-only. Editing an **assistant** message lands as a user-role correction node with explicit framing, because `assistant/message` requires an open step |
| **删除** (delete) | The same replacement mechanism with a placeholder (a surface replace cannot produce zero nodes), with tool-call pairing checked before and after. Browser hiding is derived from the log, including the synthetic placeholder row. Deleted messages cannot be edited back into context. |
| **折叠** (collapse) | browser only: the message folds to a stub in the transcript and one click opens it again. For a wall of tool output in the middle of a conversation — it changes nothing about what anyone reads |
| **从这里分叉** | a new session seeded with the events up to the cut (the api-proxy fork recipe), attached to the same workspace. The cut must fall after a completed turn, so the first turn is refused (409) |

A deployment that does not expose `@deepseek-ai/dsh-compaction` cannot have its pairing checked, so a model-visible edit is refused there (503) rather than risking a split tool call.

Cold sessions are resumed with their recorded preset, edited under `runMaintenance`, flushed once
and disposed again — unless work arrived while the edit was in flight, in which case the handle is
kept and the session is left running; subagent sessions are read-only.

## Where it lives

- the conversation header gets a ✎ button that opens the message list (every node, with its role,
  whether it is still on the surface, and what shadowed it);
- the official assistant-actions slot gets an inline edit entry;
- `$DSH_HOME/chat-edits.json` holds independent display overrides (max 500 per session, 20 000 characters each).
  Matching uses session id + immutable event seq, mapped through the core's live chat nodes to flow keys.
  Markdown and duplicate text therefore do not determine identity. Plugin overlays preserve React's original DOM children.
  Tool sub-results without their own chat row do not offer ineffective display controls.

An explicit display-only write records the current context-edit revision; a later context edit wins over that old display write. Legacy sidecar entries without this revision cannot override authoritative log edits. Collapsing remains independent. A failed sidecar write retains the last successfully saved state; failed external reloads (including temporary missing files) retain the last good document. Use `clear` or a valid empty `sessions` object to clear it deliberately.

## Routes

`status` · `messages` · `display` · `clear` · `overrides` · `context/edit` · `context/delete` ·
`fork` — behind the loopback + same-origin fence.

**Limits.** The store keeps overrides for the **200 most recently touched sessions**; when a 201st
session is edited, the least recently touched session's overrides are dropped — on write *and* on
load, so a hand-restored file is trimmed the same way. Within a session: 500 overrides, 20 000
characters each.
