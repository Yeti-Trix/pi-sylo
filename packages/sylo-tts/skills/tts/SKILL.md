---
name: tts
description: Convert text to natural local speech via sylo_tts_speak (Kokoro and Orpheus voices).
metadata:
  sylo:
    category: media
    icon: volume
routes:
  - id: speech
    title: Speech
    icon: volume
    nav_section: domain
    entry: routes/speech/index.html
    fallback: routes/speech/fallback.md
route_protocol_version: 0
---

# Text-to-speech

Convert operator text to a local WAV using **`sylo_tts_speak`**. Default voice applies when the operator does not name one — pick a **voice_id** from the catalog when they ask.

## Default voice

**`kokoro-am_michael`** (deep US male). Override via extension **`default_voice_id`**.

## Voice catalog

### Kokoro
| voice_id | Label |
|----------|--------|
| kokoro-am_michael | Michael — deep US male |
| kokoro-am_adam | Adam — calm US male |
| kokoro-bm_george | George — British male |
| kokoro-af_heart | Heart — warm US female |
| *(see Speech route dropdown for full list)* |

### Orpheus (higher emotion; slower first run on Windows)
| voice_id | Label |
|----------|--------|
| orpheus-leo | Leo — deep, authoritative |
| orpheus-dan | Dan — friendly, casual |
| orpheus-tara | Tara — conversational |
| *(8 presets — see Speech route dropdown)* |

Map operator words: *"use Leo"* → `orpheus-leo`; *"use Michael"* → `kokoro-am_michael`.

## Workflow

1. Operator asks for TTS.
2. Normalize text lightly.
3. Call **`sylo_tts_speak({ text })`** — omit `voice_id` unless they named a voice.
4. **Stop.** No follow-up prose — the audio player is the deliverable.
