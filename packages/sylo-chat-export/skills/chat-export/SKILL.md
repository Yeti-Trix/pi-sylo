---
name: chat-export
description: Export the current chat (or all chats in the workspace) from the on-disk session JSONL to markdown — compaction-proof. Powers the chat-recap / journal-entry workflows. Use when the operator wants to recap a chat into a journal entry, or backfill journal entries for every past chat from one chat.
metadata:
  sylo:
    category: journaling
    icon: book
---

# Chat export — compaction-proof chat recap

Exports chat conversation(s) from Pi's **on-disk session JSONL** to markdown
files so they can be turned into journal entries. The key fact that makes this
safe: **Pi compaction does not delete the chat.** Compaction appends a summary
entry to the session JSONL but leaves the original user/assistant message
entries in the file forever. This tool reads those raw entries, so it captures
the **full** conversation even after compaction has already run, and even from
a resumed session. Timing is never urgent.

## Tool

### `sylo_chat_export`

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `all_sessions` | `false` | `true` → export **every** session for the current workspace (via `SessionManager.list(cwd)`), one file per session. `false` → current session only. |
| `include_thinking` | `false` | Include assistant thinking blocks. |
| `include_tools` | `false` | Include tool calls + results. |
| `out_path` | *(auto)* | Override output path (single-session mode only). Default: `journal/.chat-export-<timestamp>.md` under the Pi cwd. |

The tool **writes the transcript to a file** under `journal/` (creating the
folder if missing) and returns a small manifest — per-session path, turn counts,
time span, and the first few user messages (a table-of-contents). Writing to a
file (instead of returning the transcript inline) keeps a long transcript from
bloating the live context, which would itself trigger compaction.

Only `user` and `assistant` **text** turns are exported by default; tool calls,
bash output, and compaction summaries are skipped (enable `include_tools` if
needed). Images in user messages are noted by count, not rendered.

## How to use it

This package ships the **tool**. The **workflow** that orchestrates export-then-journal lives in the operator's synced `sylo-user` workspace:

- **`chat-recap`** — the operator states the **scope** when firing it:
  - **`current`** (default) — export the current chat, write one `journal/YYYY-MM-DD-<slug>.md`.
  - **`all`** — export **every** session, one subagent per session, **overwrite** existing entries.
  - **`new`** — export every session, one subagent per session, **skip** chats already journaled (idempotent backfill).

`all` and `new` keep each chat's transcript inside its subagent's context so recapping many chats doesn't bloat the chat you're running it from.

Run the workflows from **Tools → Workflows** in Sylo.

## When to use

- The operator says "journal this chat" / "recap this chat" / "write a journal
  entry for what we just did" → use the `chat-recap` workflow, scope `current`.
- The operator says "journal all my chats" / "recap every chat" → `chat-recap`,
  scope `all`.
- The operator says "backfill" / "journal only new chats" / "catch up the
  journal" → `chat-recap`, scope `new`.
- The operator asks whether compaction loses chat content → reassure them it
  does not; the raw transcript persists on disk and this tool recovers it.

## Notes

- The journal folder lives in the current workspace (git-tracked with the
  project). One project per workspace → one journal per project.
- The journal is a *record*, not a transcript. Keep entries short and factual;
  the raw export (and the session JSONL itself) preserves full detail if ever
  needed.
- If a chat had no substantive problem-solving, skip writing an entry for it.