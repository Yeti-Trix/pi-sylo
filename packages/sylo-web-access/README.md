# sylo-web-access

Privacy-first web **search** and **fetch** (L1/L2) for the Sylo/Pi harness, with
**mandatory LLM relevance ranking** and a **toolless quarantined rewrite model**
for prompt-injection defense.

> Optional Sylo package — **off by default**. Enable in Capability manager →
> Sylo optional packages (runs `pip install` for heavy tiers). Not "deep research"
> (separate future capability that will *consume* these tools).

## Tools

| Tool | Behavior |
|------|----------|
| `sylo_web_search` | S1/S2 search → **LLM rank** (fail-closed) → F1/F2 fetch → rewrite → markdown + **Sources** links + optional vision previews/screenshots. |
| `sylo_web_fetch` | SSRF-guarded F1/F2 fetch → rewrite → untrusted markdown + optional images. |
| `sylo_youtube_transcript` | YouTube captions via `youtube-transcript-api` (not HTML fetch). Watch/shorts/youtu.be URL or video id. |

## Design

- **Privacy by default:** DuckDuckGo HTML + local `fetch` + local Ollama models. No cloud
  accounts, no API keys, no tracking. An optional **Brave Search API key** can be set
  to add a reliable keyed S2 fallback (`brave_api`) for when DuckDuckGo IP-blocks the
  keyless HTML endpoint (HTTP 202) — opt-in, free credit ≈ 1,000 queries/mo (then
  $5/1k billed). Remaining monthly quota is surfaced in the Web access sidebar →
  Settings.
- **Ranking is LLM-only and mandatory** on the search path (fail-closed).
- **Dual-LLM quarantine:** rank/rewrite models have **no tools**; output is UNTRUSTED.
- **Tiered (cheap-first):** S1 DDG HTML → S2 `ddgs` duckduckgo (different DDG endpoint) → S2 `brave_api` (keyed Brave Search API, optional). F1 Readability → F2 Crawl4AI on thin/SPA/bot-wall. Escalation is deterministic (no LLM gate). The keyless scrapers (mojeek/brave/startpage) are no longer in the default rotation — they bot-wall headless clients — but remain configurable in `searchBackends`.
- **Vision (optional):** F1 attaches up to 2 `og:image`/hero previews; F2 may attach a viewport PNG after headless render — only when the main model supports vision.

## Python heavy tiers

On enable, Sylo installs `scripts/requirements.txt`:

- `ddgs` — S2 multi-backend search rotation
- `crawl4ai==0.8.6` — F2 headless fetch + screenshot (Playwright; first run may download browsers)
- `youtube-transcript-api` — `sylo_youtube_transcript` captions

Toggle `heavy_tiers_enabled` in Web access settings to disable escalation without uninstalling.

## Configuration

Host JSON via `SYLO_WEB_ACCESS_CONFIG`. Key fields:

| Field | Default | Notes |
|-------|---------|-------|
| `rank_model` / `rewrite_model` | main model | Overridable in Settings. |
| `heavy_tiers_enabled` | `true` | S2 + F2 escalation. |
| `preview_images_enabled` | `true` | F1 og:image for vision models. |
| `max_preview_images_per_page` | `2` | Cap per fetched page. |
| `searchBackends` | duckduckgo, brave_api | S2 rotation order (after S1 DDG HTML fails). `brave_api` is used only when `brave_api_key` is set. Keyless scrapers (mojeek/brave/startpage) are removable but bot-wall headless clients. |
| `brave_api_key` | `''` | Brave Search API key (free credit ≈ 1,000 queries/mo, then $5/1k billed). Enables the keyed `brave_api` S2 backend — the reliable non-DDG fallback when DuckDuckGo IP-blocks the S1 HTML endpoint (HTTP 202). Set via Web access sidebar → Settings or Capability manager → Web access config. Remaining quota is shown in the Web access sidebar. |

See `THIRD_PARTY.md` for dependencies.

## Folder structure

```
extensions/
  index.ts              Tools + orchestration
  search-tier.ts        S1 → S2
  fetch-tier.ts         F1 → F2
  fetch-readability.ts  F1
  fetch-headless.ts     F2 bridge
  preview-images.ts     F1 og:image for vision
  page-pipeline.ts      Fetch → adequacy → rewrite → attachments
  python-runner.ts      Script exec helper
scripts/
  search_ddgs.py        S2
  fetch_headless.py     F2
  youtube_transcript.py YouTube captions
  requirements.txt
skills/web-access/      Agent skill + sidebar route
```
