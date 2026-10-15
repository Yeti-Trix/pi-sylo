# Changelog

All notable changes to the sylo-image-gen package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Package-level
mirror of the root `CHANGELOG.md` (the workspace's other optional packages keep their entries in
the root file only; sylo-image-gen keeps its own too, starting at v1).

## [Unreleased]

- **A ComfyUI port flip no longer bricks image generation ("ComfyUI not reachable … even though comfyui is running", found live 2026-10-13):** the operator restarted ComfyUI Desktop and the engine bound :8189 while the config pinned `http://127.0.0.1:8188` — every tool call refused with ECONNREFUSED and the doctor printed NOT REACHABLE. `shared/comfyui/client.ts` gained `resolveComfyEndpoint(configuredUrl)`: the configured URL wins when it answers; when the configured LOOPBACK port refuses and the sibling known port (8188/8189) answers, the sibling is used — generate resolves FIRST and reports the fallback in chat, and the doctor consumes the returned health (§3 note 5 stats dedupe kept) plus prints an "engine answered on a FALLBACK probe" line with an update-hint. When nothing answers the ORIGINAL url is returned so the rich not_reachable guidance still names it. Custom (non-loopback-default) URLs are never probed on other ports. Tests: down-fallback / up-wins / dead-returns-original / custom-URLs-never-probed.

### Added

- **Image studio optional package (v1):** agent tools (`sylo_image_gen_generate` / `_list` / `_get` /
  `_organize` / `_doctor`) over an all-local **ComfyUI** HTTP backend — no cloud providers, no
  provider keys, no Python of its own. Draft→final preset loop (draft `z-image-turbo`, final
  `qwen-image-2`, all-Apache by default; FLUX dev models opt-in with non-commercial badges), per-model
  ComfyUI workflow builders with pre-submit node validation, and a guided model/VRAM doctor report.

- **Per-workspace image library** at `<workspace>/.sylo/images/` (`library.json` index + dated pixel
  files): atomic tmp+rename writes, malformed-index recovery, prompt/tag/favorite/model/date queries,
  `draft`/`final` auto-tagging, lineage (`parent_id`) for remix/rerun-as-final, and broker→host change
  notifications (`sylo-image-gen:changed`) fanned to the sidebar route. Agent tools and host main share
  the same store modules.

- **Images sidebar route** (domain section): Generate composer (draft/final segmented control, model
  dropdown with license badges, count 1–4, inline job card, result strip with Remix / Rerun-as-final /
  Send-to-agent), Library grid (search, favorites, model filter chips, delete, cost/time ledger
  footer), detail drawer (full params, copy buttons, Send to agent, lineage link), and Settings
  (ComfyUI health card, guided model-install table with detected/missing state, preset defaults).
  Served from built assets in `skills/image-gen/routes/images/`; degrades to a chat fallback without
  the desktop host.

- **Inline chat results with provenance:** generated images render in chat with a "Generated images"
  class (no misleading "untrusted web image" footnote), full-res files referenced via `sylo-file://`,
  sub-512px JPEG previews kept under the telemetry cap, and every record carrying model/steps/guidance/
  seed/gen-time metadata.

### Fixed

- **Template filenames re-anchored to verified hosted artifacts (2026-10-11):** 6 of 9 hard-coded
  catalog/template names had drifted vs today's HuggingFace listings — z-image TE is
  `qwen_3_4b_fp8_mixed` (not `_fp8_scaled`), Qwen-Image 2 UNet is `qwen_image_2512_fp8_e4m3fn`
  (Comfy-Org repack; gated `Qwen/Qwen-Image-2` pointed at instead), FLUX.2 dev UNet is
  `flux2_dev_fp8mixed`, its TE is `mistral_3_small_flux2_fp8` (not a Mistral-3 24B file), and both
  klein + flux2-dev reference the hyphenated `flux2-vae.safetensors`. Klein's UNet/TE stay flagged
  VERIFY (no open repack matches yet — download-later); Qwen-Image-2.1 intentionally deferred.
  **Round-2 (live-evidence refutations, same day):** the live ComfyUI Desktop
  `/object_info/CLIPLoader` type enum has no `z_image` entry — z-image's clip_type is `lumina2`
  (Z-Image's Qwen3-4B TE rides the Lumina-2 loader path, matching the official Desktop
  Z-Image-Turbo template), and the "shared Qwen VAE" claim is refuted by blob SHA-256s:
  z-image ships its own `ae.safetensors` (335,304,388 B, `afc8e282…`), byte-identical to the FLUX.1
  AE (so `models/vae/ae.safetensors` serves flux1-dev + z-image-turbo — shared file, not a
  collision), while Qwen finals keep `qwen_image_vae.safetensors` (253,806,246 B, `a70580f0…`);
  per-family VAEs. The z-image builder now matches the official template: ModelSamplingAuraFlow
  shift 3.0 / sampling flow + KSampler `res_multistep`/`simple` (round-1's euler corrected);
  download URL re-anchored to Comfy-Org/z_image_turbo (open, 200 unauthenticated;
  Tongyi-MAI upstream is not gated but ships the diffusers layout, not these loader basenames).