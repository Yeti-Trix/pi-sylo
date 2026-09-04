#!/usr/bin/env python3
"""F2 fetch tier — Crawl4AI headless render + markdown + optional viewport screenshot (stdout JSON)."""
from __future__ import annotations

import argparse
import json
import sys


async def run_fetch(url: str, screenshot: bool) -> dict:
    from crawl4ai import AsyncWebCrawler, CacheMode, CrawlerRunConfig

    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        screenshot=screenshot,
        force_viewport_screenshot=True,
        screenshot_wait_for=1.0,
        page_timeout=45_000,
    )
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, config=config)

    if not result.success:
        return {
            "ok": False,
            "url": url,
            "error": result.error_message or "crawl_failed",
            "escalate": False,
        }

    markdown = (result.markdown or "").strip()
    title = ""
    if getattr(result, "metadata", None) and isinstance(result.metadata, dict):
        title = str(result.metadata.get("title") or "").strip()

    shot = None
    if screenshot and result.screenshot:
        shot = result.screenshot

    adequate = len(markdown) >= 500
    return {
        "ok": True,
        "url": url,
        "title": title or url,
        "markdown": markdown,
        "adequate": adequate,
        "inadequate_reason": None if adequate else "F2 markdown under 500 chars",
        "screenshot_b64": shot,
        "tier": "F2",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument(
        "--screenshot",
        action="store_true",
        help="Capture viewport PNG as base64",
    )
    args = parser.parse_args()

    try:
        import asyncio
    except ImportError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    try:
        payload = asyncio.run(run_fetch(args.url, args.screenshot))
    except ImportError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"crawl4ai not installed: {exc}",
                    "escalate": False,
                }
            )
        )
        return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "url": args.url, "error": str(exc), "escalate": False}))
        return 1

    print(json.dumps(payload))
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
