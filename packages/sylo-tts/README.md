# sylo-tts

Local TTS for Sylo: **Kokoro** and **Orpheus** — preset voices, no reference WAV.

## Enable

1. Capability manager → **Speech / sylo-tts** → enable (auto pip install for both backends —
   Orpheus installs best-effort and self-heals on first Orpheus Generate/speak if it was skipped).
2. GPU PyTorch for Kokoro/Orpheus on RTX 50-series:
   ```powershell
   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
   ```
3. (Manual only, if auto-install was skipped) **Orpheus**:
   ```powershell
   pip install -r packages/sylo-tts/scripts/requirements-orpheus.txt
   ```
   That file includes `llama-cpp-python` (PyPI CPU wheels — no toolchain on Windows cp312).
   For RTX 50-series GPU inference swap the CUDA wheel:
   ```powershell
   pip install llama-cpp-python --force-reinstall --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu128
   ```
   vLLM is **not** used on Windows — only orpheus-cpp. Sylo patches a known SNAC int32/int64 ONNX bug in orpheus-cpp 0.0.3.
4. Restart broker after enable.

## Backends

| Backend | Voices in catalog | Notes |
|---------|-------------------|--------|
| **Kokoro** | 12 | Default; good balance of quality/speed. Verified on numpy 2.x. |
| **Orpheus** | 8 | orpheus-cpp + llama-cpp-python (CPU wheel by default; CUDA wheel optional). First run downloads GGUF + SNAC ONNX. |

Disable a backend: edit `voices/catalog.json` → `"disabled_backends": ["orpheus"]`.

## Speech settings (Speech tab or config file)

| Setting | Kokoro | Orpheus | Range |
|---------|--------|---------|-------|
| **Speed** | yes | — | 0.5–2.0 (1.0 = normal) |
| **Temperature** | — | yes | 0.3–1.2 |
| **Top P** | — | yes | 0.7–1.0 |

Defaults live in `%APPDATA%\@sylo\host\sylo-tts\config.json` or use **Save as defaults** in the Speech tab.

## Default voice

**`kokoro-am_michael`**

## Manual test

```powershell
python packages/sylo-tts/scripts/tts_synthesize.py --backend kokoro --kokoro-voice am_michael --text "Hello." --out $env:TEMP\test.wav
```
