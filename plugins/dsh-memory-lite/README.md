# dsh-memory-lite

Lightweight memory for DeepSeek Harness — across compaction and across sessions — plus a per-session view of the **active compaction summary that you can edit**.

dsh never drops history to fit a cap: at `contextWindow × thresholdRatio` (0.8 by default) the shipped presets' `compaction-basic` replaces the oldest surface span with one model-written `<compacted-summary>` checkpoint (`/compact` does the same on demand). This plugin makes that checkpoint visible and editable, stores it as memory, and adds a small long-term memory the next session can use.

## What it does

| Part | Behaviour | Where |
|---|---|---|
| Deposit | Every `compaction/summary` the core lands for a top-level session is stored as a `summary` item (latest per session; pinned ones are kept) | `session/event` |
| Extract | Every `extractEveryTurns` human turns (default 8) the session's **own routed model** is asked for durable facts (JSON array of `{text, global}`; global = about the user, otherwise workspace-scoped); near-duplicates are dropped (token Jaccard ≥ 0.8); a per-session watermark avoids re-reading the same turns | `agent/status` → `ctx.llm.stream` |
| Recall | Okapi BM25 (k1 1.2, b 0.75) over lowercase ASCII words + CJK character bigrams, with pin (×1.25), same-workspace (×1.15) and recency boosts; optional cosine blend (0.5 / 0.5) when vectors exist; strict gate on later turns (≥ 2 matched query tokens, or a 1–2 token query) | `lib/recall.js` |
| Inject | At `agent/pre-step`, for the user's own message only (never sub-agents, snapshots or tool results): first turn of a session → pinned + relevant items, later turns → relevant items not injected before in this session (already-injected ids are read back from the log, so an aborted step does not consume them); summaries keep their section structure (2 000-char budget each inside a 4 000-char block, facts / notes one line of ≤ 700); added as ONE separate user-role message with `source: { kind: 'plugin', plugin: 'memory-lite', memoryIds }` right after the user's message (the same pattern as `dsh-time-context` and `dsh-web-search-plus`); the user's words are never rewritten | `agent/pre-step` |
| Tools | `memory_recall(query, limit?)` and `memory_note(text, scope?)` + a two-sentence system-prompt section | `ctx.tools.register`, `ctx.systemPrompt.section` |
| Context view | `/dsh-memory-lite/sessions` lists every session (attached or cold) with title, turns, compactions, active checkpoints; `/session?id=` returns pressure (latest request tokens for attached sessions, surface estimate for cold ones), routed model, contextWindow, threshold (attached sessions: from the preset's engine config incl. `modelPolicies`; cold sessions assume the 0.8 default, labelled as such), active checkpoints with the editable summary text, compaction history, composition | `ctx.sessions`, `ctx.get('sessionPersistence')`, `ctx.get('tokenMeter')` |
| Edit summary | `POST /session/summary {id, checkpointSeq, summary}` writes a genuine compaction bracket under `agent.runMaintenance`: `compaction/start {turn:null}` → `compaction/summary {provider:'dsh-memory-lite', model:'manual-edit', shadowedRange/Seqs = the checkpoint, shadowedTokenCount = its meter estimate}` → `user/message` with `compactCheckpointSource(id)` and `surfaceOp {op:'replace', start:end:checkpointSeq}` + `sourceEventSeqs [start, summary, checkpoint]` → `compaction/end`; then `ctx.sessions.flush`. The original checkpoint's framing (preamble + tags) is kept; only the text between the tags changes. Refused while a turn is open, a compaction is active, the checkpoint left the surface, or the agent is busy (409) | `session.append` |
| Compact now | `POST /session/compact` calls the compaction engine's `compactNow(agent, signal)`; in the web profile that engine lives in the agent preset's `isolate` realm, so it is read through `agentPresets.serviceFor(agent, 'compaction')` | `ctx.get('agentPresets')` |
| Cold sessions | A session that is not attached is resumed through `ctx.agents.resume` with the preset its log recorded (last `agent-preset/selected`, else the header → `agentPresets.mount`; an unknown preset is a 409, never a silent default), edited / compacted, flushed once and disposed again; if a prompt reached the transient agent meanwhile (the web UI adopts live agents by id), it is kept alive instead of being disposed under the user | `ctx.agents.resume`, `handle.dispose()` |

Embeddings are optional: any OpenAI-compatible `POST /v1/embeddings` (LM Studio, Ollama) — request `{ model, input: string[] }`, reply `{ data: [{ index, embedding }] }`. Vectors live in `~/.dsh/memory/vectors.json`, tagged with the model name; changing the model drops them.

## Files

- `~/.dsh/memory-lite.json` — config (hot-reloaded every 1.5 s; `POST /settings` writes only the values that differ from the defaults below; `inject` is one of `relevant | first-turn | off`):

```jsonc
{
  "enabled": true,
  "depositSummaries": true,
  "extractFacts": true, "extractEveryTurns": 8, "extractMaxChars": 12000,
  "inject": "relevant",
  "topK": 5, "maxInjectChars": 4000, "summaryChars": 2000, "itemChars": 700,
  "tools": true,
  "maxItems": 2000,
  "embeddings": { "enabled": false, "baseURL": "http://127.0.0.1:1234/v1", "model": "", "apiKeyEnv": "" }
}
```

- `~/.dsh/memory/memory.json` — items `{ id, kind: summary|fact|note, text, scope: global|workspace, cwd, sessionId, source, pinned, createdAt, updatedAt, meta }` + extraction watermarks; written atomically; watched for external changes (the launcher's config restore, a hand edit) — every save decides from the file on disk: an external write since the last load / save is merged first (newer by id wins, ids deleted in memory stay deleted), an unparsable file is moved aside as `memory.json.corrupt-<stamp>`, and a file that cannot be read (lock, permission) makes the write refuse (503 on the routes) rather than overwrite it; an unparsable file never empties the loaded store. The merge is additive (a deletion made outside dsh inside the 1.5 s poll window is re-added by the next save); a restore that should win outright is best done while dsh is stopped. Summary items keep up to 20 000 characters, facts / notes 4 000.

## Routes (`/dsh-memory-lite/*`, loopback `Host` + same-origin JSON only; mounted only where `webServer` exists — the rest of the plugin can run headless, though `setup.cmd` registers it in the web profile only)

`GET status` · `POST settings` · `GET items?q&kind&cwd&limit` · `POST items` · `POST items/update|delete|clear` · `GET export` · `POST import` · `POST recall` · `POST embeddings/test|rebuild` · `GET sessions` · `GET session?id=` · `POST session/summary` · `POST session/compact` · `POST session/deposit`.

The launcher proxies them under `/api/memory/*` and renders the **Memory & context** page.

## Peers

`@deepseek-ai/dsh-llm` (createUserMessage, BlockAssembler), `dsh-compaction` (compactCheckpointSource), `dsh-session` (foldSurface, foldRequestHeader, deriveEventMessage), `dsh-tools` (defineTool), `dsh-credentials` (credentialRef) — all optional; preset resolution / mount go through the `agentPresets` service (the `resolveSessionPreset` rule is re-implemented locally), resolved through the suite's `launcher/peer-links.mjs`; without them the matching feature reports a clear 503 / skips.

## Boundaries

- Extraction reads the current positional surface, including corrected user/assistant text; deleted text and old shadowed nodes are excluded. Any surface replacement during an extraction discards that result without advancing its watermark.
- Editing a source conversation withdraws its earlier automatic facts/summaries from recall, including pinned items. Records are retained and labelled in the Memory page. Legacy records are reconciled against their source logs on load; unreadable source logs temporarily withhold automatic recall until a refresh verifies them.
- Saving an item's text explicitly confirms it as a user-maintained record (saving the same text can reaffirm it). When old recalled content was already injected into another session, its next step receives a replayable withdrawal/correction notice, even with new recall injection set to `off`. Old append-only logs are retained; this is not physical erasure of history. The plugin must remain enabled to deliver notices.
- Successful re-extraction records the processed edit revision, so refreshing/restarting does not repeatedly reset the watermark for the same edit.
- A `withdrawals` dictionary in the same atomic `memory.json` preserves pending context updates after ordinary item pruning, summary replacement or item deletion. Export/import and external reload merge newer revisions; a missing/empty field does not clear existing records. Legacy item metadata is migrated before pruning. Same-text confirmation restores validity once in sessions that already received the withdrawal; sessions that did not receive it need no restoration notice.
- These per-id records retain at most 500 characters of old text and 4,000 characters of a confirmed correction. They are separate from the `maxItems` active-item budget and currently have no automatic expiry/reset API. Deleting an item is not physical erasure of prior conversation logs or pending context updates; retention controls are a follow-up improvement.
- `memory_recall` also tracks returned IDs: native results carry tool-private metadata, and a short ID-only deferred context is ferried through `run_code` and recorded when the core lands it. Unlanded executions are not receipts. A cancelled/failed parent can still land a receipt for a completed nested lookup, conservatively causing a later update even if its curated output omitted the item. Historical native results must match their recorded tool call; historical code-dispatch results must belong to `run_code`. Old rendered entries are recognized only by the exact entry header plus the retained old-text prefix. That old format is ambiguous; spilled/truncated output without enough identifying text cannot be reconstructed reliably. New receipts do not depend on rendered text or spill previews.

- Only top-level sessions deposit, extract and receive injections; sub-agent sessions are read-only in the context view.
- Facts are extracted with the session's own routed model (one short call every N turns, and only after a human turn actually finished in this process — opening, resuming or editing a session never triggers a call); switch `extractFacts` off to make the plugin fully local.
- The edit is a new compaction record — the original summary stays in the log (shadowed), nothing is rewritten in place; it needs the token meter (`ctx.tokenMeter`) to price the replaced node, and is refused without it.
- Only the saved `embeddings.apiKeyEnv` is ever forwarded (the test route ignores a credential name in the request); the query embedding on the conversation path is capped at 2.5 s and falls back to lexical recall.
