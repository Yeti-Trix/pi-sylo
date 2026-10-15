# sylo-image-gen

Local-first image generation for Sylo: agent tools, a per-workspace **image library**, and the
**Images** sidebar route — powered entirely by a local **ComfyUI** install. All-local: no cloud
providers, no provider keys, no Python on Sylo's side (ComfyUI does the GPU work; the package
talks to it over HTTP).

## Setup

1. **Enable** — Capability manager → **Image studio** (sylo-image-gen).
2. **ComfyUI is an external dependency** (never bundled): install [ComfyUI Desktop](https://www.comfy.org/download).
   Default API endpoint: `http://127.0.0.1:8188` (configurable; the package detects, never spawns, ComfyUI).
3. **Models** — out-of-box defaults are commercial-safe, all-Apache:
   draft **`z-image-turbo`** (~8 steps, fast) + final **`qwen-image-2`** (~20 steps, best text-in-image).
   **FLUX dev** models offer more quality but their outputs are **non-commercial-use** — opt-in only,
   badged wherever selectable (doctor, Settings).
   Model sizes are ~13–32 GB each — download what you use.
4. **Diagnostics** — ask the agent to run **`sylo_image_gen_doctor`**: checks ComfyUI reachability,
   GPU/VRAM, queue depth, installed models (with download links), and library stats.
5. **Images route** — domain section of the sidebar (**Images**: Generate · Library · Settings tabs).
   Served only inside the Sylo desktop app; on vanilla Pi (no desktop host) the route degrades to a
   chat fallback — the same tools work from chat, and the package's fallback doc explains the setup.

## Tools

| Tool | Purpose |
|------|---------|
| `sylo_image_gen_generate` | Generate 1–4 images (prompt, draft/final preset, aspect, size, seed) and save to the library |
| `sylo_image_gen_list` | Search the library — text/tags/favorites/model/date, paginated |
| `sylo_image_gen_get` | Full record for one image (params + lineage) |
| `sylo_image_gen_organize` | Tag / favorite / album / delete (confirm before delete) |
| `sylo_image_gen_doctor` | Setup copilot — reachability, GPU, models, library health |

## Image library

Images land in `<workspace>/.sylo/images/` — index `library.json`, pixels under `files/<yyyy>/<mm>/`.
Per-workspace by design; the agent is a librarian too ("tag these drafts by concept", "find the logo
drafts from Tuesday"). Tip: gitignore `.sylo/images/files/` (binary bloat), keep `library.json`.