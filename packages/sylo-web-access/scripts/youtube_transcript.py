#!/usr/bin/env python3
"""Fetch YouTube captions via youtube-transcript-api (stdout JSON)."""
from __future__ import annotations

import argparse
import json
import re
import sys
from urllib.parse import parse_qs, urlparse

VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")


def parse_video_id(raw: str) -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    if VIDEO_ID_RE.match(value):
        return value

    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"

    try:
        parsed = urlparse(value)
    except ValueError:
        return None

    host = (parsed.hostname or "").lower().removeprefix("www.")
    path = parsed.path or ""

    if host in {"youtu.be", "youtube.com", "m.youtube.com", "music.youtube.com"}:
        if host == "youtu.be":
            candidate = path.strip("/").split("/")[0]
            return candidate if VIDEO_ID_RE.match(candidate) else None

        if path.startswith("/watch"):
            qs = parse_qs(parsed.query)
            vid = (qs.get("v") or [None])[0]
            return vid if vid and VIDEO_ID_RE.match(vid) else None

        for prefix in ("/embed/", "/shorts/", "/live/", "/v/"):
            if path.startswith(prefix):
                candidate = path[len(prefix) :].split("/")[0]
                return candidate if VIDEO_ID_RE.match(candidate) else None

    return None


def watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def emit_json(payload: dict) -> None:
    text = json.dumps(payload, ensure_ascii=False)
    if hasattr(sys.stdout, "buffer"):
        sys.stdout.buffer.write(text.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
        sys.stdout.buffer.flush()
    else:
        print(text)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="", help="YouTube watch/shorts/youtu.be URL")
    parser.add_argument("--video-id", default="", help="11-char video id (alternative to --url)")
    parser.add_argument(
        "--languages",
        default="en",
        help="Comma-separated language codes in preference order (default: en)",
    )
    parser.add_argument(
        "--timestamps",
        action="store_true",
        help="Include HH:MM:SS lines in plain_text output",
    )
    args = parser.parse_args()

    video_id = parse_video_id(args.video_id or args.url)
    if not video_id:
        emit_json({"ok": False, "error": "invalid_youtube_url_or_video_id"})
        return 1

    languages: list[str] = [lang.strip() for lang in args.languages.split(",") if lang.strip()]
    if not languages:
        languages = ["en"]

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError as exc:
        emit_json({"ok": False, "error": f"youtube-transcript-api not installed: {exc}"})
        return 1

    try:
        transcript = YouTubeTranscriptApi().fetch(
            video_id,
            languages=languages,
            preserve_formatting=False,
        )
    except Exception as exc:  # noqa: BLE001
        emit_json(
            {
                "ok": False,
                "error": str(exc),
                "error_type": type(exc).__name__,
                "video_id": video_id,
                "watch_url": watch_url(video_id),
            }
        )
        return 1

    segments = [
        {"text": snippet.text, "start": snippet.start, "duration": snippet.duration}
        for snippet in transcript.snippets
    ]
    if args.timestamps:
        plain_lines = [
            f"[{format_timestamp(seg['start'])}] {seg['text']}".strip() for seg in segments
        ]
        plain_text = "\n".join(line for line in plain_lines if line)
    else:
        plain_text = " ".join(seg["text"].strip() for seg in segments if seg["text"].strip())

    emit_json(
        {
            "ok": True,
            "video_id": video_id,
            "watch_url": watch_url(video_id),
            "language_code": transcript.language_code,
            "language": transcript.language,
            "is_generated": transcript.is_generated,
            "segment_count": len(segments),
            "segments": segments,
            "plain_text": plain_text,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
