# Third-party code and patterns

This package is **owned, vendored code** — no third-party network tool runs
unaudited. The following external libraries (runtime dependencies) and design
patterns informed the implementation.

## Runtime dependencies (npm, MIT/Apache-2.0)

| Package | License | Use |
|---------|---------|-----|
| `@mozilla/readability` | Apache-2.0 | Main-content extraction from fetched HTML (F1 tier). |
| `linkedom` | ISC | Lightweight server-side DOM for Readability + SERP parsing. No native deps. |
| `turndown` | MIT | HTML → markdown conversion of extracted article content. |
| `typebox` | MIT | Tool parameter schemas (matches other Sylo packages). |

## Patterns borrowed (re-implemented, not copied)

| Source | License | What was borrowed |
|--------|---------|-------------------|
| Legacy Sylo (`backend/app/agent/...`) | Internal | DuckDuckGo HTML SERP parse (`search_tool.py`), `[PAGE NOT RELEVANT]` rewrite gate (`web_content_rewriter.py`), `UNTRUSTED_PREFIX/SUFFIX` markers (`context_trimming.py`), URL safety (`url_normalize.py`). |
| `@juicesharp/rpiv-web-tools` | MIT | SSRF guard shape (loopback / RFC1918 / link-local / CGNAT / IPv6 ULA). Re-implemented from scratch; no code copied. |
| Simon Willison — dual-LLM pattern | Article | Quarantined (toolless) rank/rewrite model; output stays untrusted to the privileged agent. |
| `@ollama/pi-web-search` | MIT (official Ollama) | Extension shape only (`registerTool` + `details`). Its Ollama-web-API transport was **rejected** for privacy (routes via `ollama.com`). |

## Runtime dependencies (Python, on package enable)

| Package | License | Use |
|---------|---------|-----|
| `crawl4ai==0.8.6` | Apache-2.0 | F2 headless render + markdown + viewport screenshot (Playwright). **Pinned** after 2026 litellm PyPI incident — audit before bumping. |
| `ddgs` | MIT | S2 privacy-backend search rotation (`scripts/search_ddgs.py`). |

Installed via Sylo Capability manager → `pip install -r scripts/requirements.txt`.

## Explicitly NOT used

- Ollama `web_search` / `web_fetch` cloud APIs — dropped (tracking/account).
- Provider-synthesized answers (`pi-web-access` / Perplexity / Gemini) — conflict with our own LLM rank/rewrite.
- Crawl4AI LLM extraction — we use our own toolless rank/rewrite models instead.
