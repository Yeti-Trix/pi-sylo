#!/usr/bin/env python3
"""Local TTS synthesis for sylo-tts. Prints one JSON object to stdout."""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import warnings
import wave
from pathlib import Path

_ORIGINAL_STDOUT = sys.stdout


def _configure_quiet_env() -> None:
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    warnings.filterwarnings("ignore")


@contextlib.contextmanager
def _stdout_to_stderr():
    """Third-party TTS libs print progress to stdout; keep stdout JSON-only."""
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = _ORIGINAL_STDOUT


def _prepend_torch_cuda_dll_path() -> None:
    """On Windows, llama-cpp CUDA wheels need cudart/cublas from the torch install."""
    if sys.platform != "win32":
        return
    try:
        import torch

        torch_lib = Path(torch.__file__).resolve().parent / "lib"
        if torch_lib.is_dir():
            os.environ["PATH"] = str(torch_lib) + os.pathsep + os.environ.get("PATH", "")
    except ImportError:
        pass


_prepend_torch_cuda_dll_path()
_configure_quiet_env()


def emit(obj: dict) -> None:
    print(json.dumps(obj), file=_ORIGINAL_STDOUT, flush=True)


def wav_duration_ms(path: Path) -> int:
    with wave.open(str(path), "rb") as wf:
        frames = wf.getnframes()
        rate = wf.getframerate()
        if rate <= 0:
            return 0
        return int(1000 * frames / rate)


def synth_kokoro(text: str, voice: str, lang_code: str, out_path: Path, *, speed: float = 1.0) -> dict:
    try:
        import numpy as np
        import soundfile as sf
    except ImportError as exc:
        return {
            "ok": False,
            "error": (
                f"Missing numpy/soundfile ({exc}). "
                "Run: pip install -r packages/sylo-tts/scripts/requirements.txt "
                "or re-enable Speech in Capability manager."
            ),
        }

    lang = (lang_code or "").strip().lower()
    if not lang:
        lang = "b" if voice.startswith("b") else "a"

    chunks: list = []
    try:
        with _stdout_to_stderr():
            from kokoro import KPipeline

            pipeline = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
            for _gs, _ps, audio in pipeline(
                text, voice=voice, speed=speed, split_pattern=r"\n+"
            ):
                if audio is None:
                    continue
                arr = np.asarray(audio, dtype=np.float32).squeeze()
                if arr.size:
                    chunks.append(arr)
    except ImportError as exc:
        return {
            "ok": False,
            "error": (
                f"Kokoro import failed ({exc}). "
                "Run: pip install -r packages/sylo-tts/scripts/requirements.txt "
                "or re-enable Speech in Capability manager."
            ),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Kokoro synthesis failed: {exc}"}

    try:
        if not chunks:
            return {"ok": False, "error": "Kokoro returned no audio"}

        merged = np.concatenate(chunks)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out_path), merged, 24000)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Kokoro synthesis failed: {exc}"}

    if not out_path.is_file():
        return {"ok": False, "error": "Kokoro did not write output file"}
    return {
        "ok": True,
        "wavPath": str(out_path.resolve()),
        "durationMs": wav_duration_ms(out_path),
        "backend": "kokoro",
        "voice": voice,
    }


def _patch_orpheus_cpp_snac_int64() -> None:
    """orpheus-cpp 0.0.3 feeds int32 into SNAC ONNX; the model expects int64 (breaks on Windows)."""
    try:
        from orpheus_cpp import OrpheusCpp
    except ImportError:
        return
    if getattr(OrpheusCpp, "_sylo_snac_int64_patch", False):
        return

    import numpy as np

    def _convert_to_audio_int64(self, multiframe: list[int]):  # noqa: ANN001
        if len(multiframe) < 28:
            return None

        num_frames = len(multiframe) // 7
        frame = multiframe[: num_frames * 7]

        codes_0 = np.array([], dtype=np.int64)
        codes_1 = np.array([], dtype=np.int64)
        codes_2 = np.array([], dtype=np.int64)

        for j in range(num_frames):
            i = 7 * j
            codes_0 = np.append(codes_0, frame[i])
            codes_1 = np.append(codes_1, [frame[i + 1], frame[i + 4]])
            codes_2 = np.append(
                codes_2, [frame[i + 2], frame[i + 3], frame[i + 5], frame[i + 6]]
            )

        codes_0 = np.expand_dims(codes_0, axis=0)
        codes_1 = np.expand_dims(codes_1, axis=0)
        codes_2 = np.expand_dims(codes_2, axis=0)

        if (
            np.any(codes_0 < 0)
            or np.any(codes_0 > 4096)
            or np.any(codes_1 < 0)
            or np.any(codes_1 > 4096)
            or np.any(codes_2 < 0)
            or np.any(codes_2 > 4096)
        ):
            return None

        snac_input_names = [x.name for x in self._snac_session.get_inputs()]
        input_dict = dict(zip(snac_input_names, [codes_0, codes_1, codes_2], strict=True))
        audio_hat = self._snac_session.run(None, input_dict)[0]
        audio_np = audio_hat[:, :, 2048:4096]
        audio_int16 = (audio_np * 32767).astype(np.int16)
        return audio_int16.tobytes()

    OrpheusCpp._convert_to_audio = _convert_to_audio_int64  # noqa: SLF001
    OrpheusCpp._sylo_snac_int64_patch = True


def _orpheus_n_gpu_layers() -> int:
    """GPU layer offload for llama.cpp (-1 = all layers). Override: SYLO_ORPHEUS_GPU_LAYERS."""
    raw = os.environ.get("SYLO_ORPHEUS_GPU_LAYERS", "").strip()
    if raw:
        return int(raw)
    return -1


def synth_orpheus_cpp(
    text: str,
    voice: str,
    out_path: Path,
    *,
    temperature: float = 0.8,
    top_p: float = 0.95,
) -> dict:
    """Windows-friendly Orpheus path (llama.cpp GGUF, no vLLM)."""
    try:
        import numpy as np
        import soundfile as sf
        from orpheus_cpp import OrpheusCpp
    except ImportError as exc:
        return {
            "ok": False,
            "error": (
                f"Orpheus-cpp import failed ({exc}). "
                "Install optional deps: pip install -r packages/sylo-tts/scripts/requirements-orpheus.txt "
                "Then Windows may also need: pip install llama-cpp-python "
                "--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124"
            ),
        }

    try:
        _patch_orpheus_cpp_snac_int64()
        with _stdout_to_stderr():
            orpheus = OrpheusCpp(
                verbose=False,
                lang="en",
                n_gpu_layers=_orpheus_n_gpu_layers(),
            )
            sr, samples = orpheus.tts(
                text,
                options={
                    "voice_id": voice,
                    "temperature": temperature,
                    "top_p": top_p,
                },
            )
        arr = np.asarray(samples).squeeze()
        if arr.ndim > 1:
            arr = arr.mean(axis=0)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # orpheus-cpp returns int16 PCM; writing those as float32 without scaling clips hard.
        if arr.dtype == np.int16:
            sf.write(str(out_path), arr, int(sr), subtype="PCM_16")
        else:
            arr = arr.astype(np.float32)
            peak = float(np.max(np.abs(arr))) if arr.size else 0.0
            if peak > 1.0:
                arr = arr / peak
            sf.write(str(out_path), arr, int(sr))
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Orpheus-cpp synthesis failed: {exc}"}

    if not out_path.is_file():
        return {"ok": False, "error": "Orpheus-cpp did not write output file"}
    return {
        "ok": True,
        "wavPath": str(out_path.resolve()),
        "durationMs": wav_duration_ms(out_path),
        "backend": "orpheus-cpp",
        "voice": voice,
    }


def synth_orpheus_vllm(text: str, voice: str, out_path: Path) -> dict:
    """Linux/CUDA path via orpheus-speech + vLLM."""
    try:
        import numpy as np
        import soundfile as sf
    except ImportError as exc:
        return {
            "ok": False,
            "error": f"Missing numpy/soundfile: {exc}. Run: pip install -r scripts/requirements.txt",
        }

    model = None
    last_err = ""
    for import_path in ("orpheus_speech", "orpheus_tts"):
        try:
            mod = __import__(import_path, fromlist=["OrpheusModel"])
            OrpheusModel = getattr(mod, "OrpheusModel")
            model = OrpheusModel(model_name="canopylabs/orpheus-tts-0.1-finetune-prod")
            break
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            model = None
    if model is None:
        return {
            "ok": False,
            "error": f"Orpheus vLLM import failed ({last_err}). pip install orpheus-speech",
        }

    try:
        if hasattr(model, "generate_speech"):
            audio = model.generate_speech(prompt=text, voice=voice)
        elif hasattr(model, "generate"):
            audio = model.generate(prompt=f"{voice}: {text}", voice=voice)
        else:
            return {"ok": False, "error": "Unsupported OrpheusModel API (no generate_speech)"}

        if audio is None:
            return {"ok": False, "error": "Orpheus returned no audio"}

        arr = audio
        if hasattr(audio, "detach"):
            arr = audio.detach().cpu().numpy()
        elif not hasattr(arr, "__len__"):
            return {"ok": False, "error": "Unexpected Orpheus audio type"}

        arr = np.asarray(arr, dtype=np.float32)
        if arr.ndim > 1:
            arr = arr.squeeze()
        sr = getattr(model, "sample_rate", None) or 24000
        out_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out_path), arr, int(sr))
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Orpheus vLLM synthesis failed: {exc}"}

    if not out_path.is_file():
        return {"ok": False, "error": "Orpheus did not write output file"}
    return {
        "ok": True,
        "wavPath": str(out_path.resolve()),
        "durationMs": wav_duration_ms(out_path),
        "backend": "orpheus-vllm",
        "voice": voice,
    }


def synth_orpheus(
    text: str,
    voice: str,
    out_path: Path,
    *,
    temperature: float = 0.8,
    top_p: float = 0.95,
) -> dict:
    """Windows: orpheus-cpp + llama.cpp only (vLLM does not run on Windows)."""
    if sys.platform == "win32":
        return synth_orpheus_cpp(
            text, voice, out_path, temperature=temperature, top_p=top_p
        )
    result = synth_orpheus_cpp(text, voice, out_path, temperature=temperature, top_p=top_p)
    if result.get("ok"):
        return result
    return synth_orpheus_vllm(text, voice, out_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="sylo-tts synthesize → WAV")
    parser.add_argument("--backend", choices=["kokoro", "orpheus"], required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--out", required=True, help="Output .wav path")
    parser.add_argument("--kokoro-voice", default="am_michael")
    parser.add_argument("--kokoro-lang", default="")
    parser.add_argument("--orpheus-voice", default="leo")
    parser.add_argument("--kokoro-speed", type=float, default=1.0)
    parser.add_argument("--orpheus-temperature", type=float, default=0.8)
    parser.add_argument("--orpheus-top-p", type=float, default=0.95)
    args = parser.parse_args()

    text = args.text.strip()
    if not text:
        emit({"ok": False, "error": "Empty text"})
        return 1

    out_path = Path(args.out)
    if args.backend == "kokoro":
        speed = max(0.5, min(2.0, float(args.kokoro_speed)))
        result = synth_kokoro(
            text,
            args.kokoro_voice.strip() or "am_michael",
            args.kokoro_lang.strip(),
            out_path,
            speed=speed,
        )
    else:
        temperature = max(0.3, min(1.2, float(args.orpheus_temperature)))
        top_p = max(0.7, min(1.0, float(args.orpheus_top_p)))
        result = synth_orpheus(
            text,
            args.orpheus_voice.strip() or "leo",
            out_path,
            temperature=temperature,
            top_p=top_p,
        )

    emit(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
