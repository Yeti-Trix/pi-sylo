# sylo-chat-export

Export chat conversation(s) from Pi's **on-disk session JSONL** to markdown files —
**compaction-proof**. Powers the chat-recap / journal-entry workflows.

## Why

Pi's context compaction replaces the live LLM context with a summary, but the
raw user/assistant message entries stay in the session JSONL file forever
(compaction only *appends* a summary entry; it never deletes the originals). So
a tool that reads those raw entries captures the **full** conversation even
after compaction has already run, and even from a resumed session. Timing is
not urgent — you can journal anytime.

## Tool

### `sylo_chat_export`

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `all_sessions` | `false` | `true` → export **every** session for the current workspace (via `SessionManager.list(cwd)`), one file per session. `false` → export the current session only. |
| `include_thinking` | `false` | Include assistant thinking blocks. |
| `include_tools` | `false` | Include tool calls + results. |
| `out_path` | *(see below)* | Override output path (single-session mode only). Default: `journal/.chat-export-<timestamp>.md` under the Pi cwd. |

Behavior:

- Reads the raw session entries (`ctx.sessionManager.getBranch()`), sorts by
  timestamp, and extracts `user` + `assistant` **text** turns (skips tool
  chatter, bash execution, compaction summaries by default).
- **Writes the transcript to a file** under `journal/` (creating the folder if
  missing) rather than returning it inline — so a long transcript doesn't bloat
  the live context (which would itself trigger compaction).
- Returns a small **manifest**: per-session export path, turn counts, time span,
  and the first few user messages (a table-of-contents). In `all_sessions` mode
  the manifest lists every exported session.

## Workflow (operator-owned, in `sylo-user`)

This package ships the **tool**. The **workflow** that uses it lives in the
operator's synced `sylo-user` workspace so it's editable and git-tracked:

- **`chat-recap`** — the operator states the **scope** when firing it:
  - **`current`** (default) — export the current chat, write one
    `journal/YYYY-MM-DD-<slug>.md`.
  - **`all`** — export **every** session, one subagent per session, **overwrite**
    existing entries (force-refresh).
  - **`new`** — export every session, one subagent per session, **skip** chats
    already journaled (idempotent backfill).

## Enable

Capability manager → **Sylo optional packages → Chat export → On**, then
**Restart broker**. No Python; works in chat via Pi tools.