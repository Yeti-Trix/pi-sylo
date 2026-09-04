#!/usr/bin/env python3
"""S2 search tier — ddgs multi-backend rotation + keyed Brave Search API (stdout JSON).

Backends:
  - duckduckgo / mojeek / brave / startpage : keyless, via the `ddgs` library.
  - brave_api                               : keyed Brave Search API
    (https://api.search.brave.com). Requires SYLO_BRAVE_API_KEY env var.
    Free credit ≈ 1,000 queries/month (Brave killed the old 2k free tier in 2025;
    now $5/mo credit, then $5/1k billed). This is the reliable non-DDG fallback
    used when DDG IP-blocks both the S1 HTML endpoint and the ddgs duckduckgo
    backend. Every brave_api response carries X-RateLimit-* headers which we
    surface as `brave_quota` so the operator can track remaining monthly quota.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request


BRAVE_API_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"


def _normalize_row(row: dict, max_results: int) -> list[dict]:
    """Extract title/url/snippet dicts from a raw ddgs result row."""
    results: list[dict] = []
    url = str(row.get("href") or row.get("url") or "").strip()
    if not url.startswith("http"):
        return results
    title = str(row.get("title") or "").strip()
    snippet = str(row.get("body") or row.get("snippet") or "").strip()
    results.append({"title": title, "url": url, "snippet": snippet})
    return results[:max_results]


def _parse_brave_quota(headers) -> dict | None:
    """Parse Brave rate-limit headers into a monthly quota snapshot.

    Brave returns comma-separated per-window values, e.g.
      X-RateLimit-Limit:     1, 1000       (1 req/s, 1000 req/month)
      X-RateLimit-Remaining: 0, 987        (0 left this second, 987 left this month)
      X-RateLimit-Reset:     1, 1419704    (seconds until each window resets)
    The monthly (2nd) value is what we surface.
    """
    def _nth(header_val: str | None, idx: int) -> int | None:
        if not header_val:
            return None
        parts = [p.strip() for p in header_val.split(",")]
        if idx >= len(parts):
            return None
        try:
            return int(parts[idx])
        except ValueError:
            return None

    limit = _nth(headers.get("X-RateLimit-Limit"), 1)
    remaining = _nth(headers.get("X-RateLimit-Remaining"), 1)
    reset_seconds = _nth(headers.get("X-RateLimit-Reset"), 1)
    if limit is None and remaining is None and reset_seconds is None:
        return None
    return {
        "limit": limit,
        "remaining": remaining,
        "reset_seconds": reset_seconds,
        "fetched_at": int(time.time()),
    }


def search_brave_api(
    query: str, max_results: int, api_key: str
) -> tuple[list[dict], str | None, dict | None]:
    """Query the Brave Search API. Returns (results, error_or_None, quota_or_None)."""
    if not api_key:
        return [], "brave_api: no API key set (SYLO_BRAVE_API_KEY)", None
    params = urllib.parse.urlencode({"q": query, "count": min(max(max_results, 1), 20)})
    req = urllib.request.Request(
        f"{BRAVE_API_ENDPOINT}?{params}",
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": api_key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                import gzip

                raw = gzip.decompress(raw)
            data = json.loads(raw.decode("utf-8"))
            quota = _parse_brave_quota(resp.headers)
    except Exception as exc:  # noqa: BLE001
        return [], f"brave_api: {exc}", None
    web = data.get("web") if isinstance(data, dict) else None
    results_raw = web.get("results") if isinstance(web, dict) else None
    if not isinstance(results_raw, list):
        return [], "brave_api: no results field", quota
    out: list[dict] = []
    for row in results_raw:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if not url.startswith("http"):
            continue
        title = str(row.get("title") or "").strip()
        snippet = str(row.get("description") or row.get("snippet") or "").strip()
        out.append({"title": title, "url": url, "snippet": snippet})
        if len(out) >= max_results:
            break
    return out, None, quota


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--max-results", type=int, default=10)
    parser.add_argument(
        "--backends",
        default="duckduckgo,brave_api",
        help="Comma-separated backend ids in rotation order",
    )
    args = parser.parse_args()
    backends = [b.strip() for b in args.backends.split(",") if b.strip()]
    if not backends:
        print(json.dumps({"ok": False, "error": "no_backends"}))
        return 1

    brave_key = os.environ.get("SYLO_BRAVE_API_KEY", "").strip()

    # brave_api is handled directly (keyed); the rest go through the ddgs library.
    ddgs_backends = [b for b in backends if b != "brave_api"]
    try:
        from ddgs import DDGS
    except ImportError as exc:
        # Still allow brave_api to work without ddgs installed.
        ddgs_backends = []
        ddgs_import_error = f"ddgs not installed: {exc}"
    else:
        ddgs_import_error = None

    errors: list[str] = []
    if ddgs_import_error and ddgs_backends:
        errors.append(ddgs_import_error)

    # Try each backend in the operator's declared order. The DDGS context spans
    # the loop; brave_api is handled directly and does not use ddgs_ctx.
    ddgs_ctx = None if (ddgs_import_error or not ddgs_backends) else DDGS()
    try:
        for backend in backends:
            if backend == "brave_api":
                results, err, quota = search_brave_api(args.query, args.max_results, brave_key)
                if err:
                    errors.append(err)
                    continue
                if results:
                    payload = {"ok": True, "tier": "S2-brave_api", "results": results}
                    if quota:
                        payload["brave_quota"] = quota
                    print(json.dumps(payload))
                    return 0
                errors.append("brave_api: No results found.")
                continue

            if ddgs_ctx is None:
                continue
            try:
                rows = list(
                    ddgs_ctx.text(args.query, max_results=args.max_results, backend=backend)
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{backend}: {exc}")
                continue
            results: list[dict] = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                results.extend(_normalize_row(row, args.max_results - len(results)))
                if len(results) >= args.max_results:
                    break
            if results:
                print(json.dumps({"ok": True, "tier": f"S2-{backend}", "results": results}))
                return 0
            errors.append(f"{backend}: No results found.")
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc), "backend_errors": errors}))
        return 1
    finally:
        if ddgs_ctx is not None:
            try:
                ddgs_ctx.close()
            except Exception:  # noqa: BLE001
                pass

    print(json.dumps({"ok": False, "error": "all_backends_failed", "backend_errors": errors}))
    return 1


if __name__ == "__main__":
    sys.exit(main())