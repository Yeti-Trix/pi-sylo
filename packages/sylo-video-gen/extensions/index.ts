/**
 * sylo-video-gen — local ComfyUI video generation for Sylo.
 *
 * §3/§8 step 6 (this step): the agent tool surface is wired. Five v1 tools
 * (plan §3.1–§3.3) run against the shared ComfyUI client + model catalog (§2;
 * §8.2–§8.4) and the per-workspace video library + durable render ledger (§4;
 * §8.5 + its §8.6 image-link/jobs residual). Five v2 NAMES are reserved with full
 * schemas and disclosure-clause executes (§3.6 — scaffold only, tools/v2-scaffold.ts).
 * Tool NAMES are fixed at build time (plan §8 header). Config: extensions/config.ts
 * (SYLO_VIDEOGEN_CONFIG env → extensions-config/sylo-video-gen.json → defaults,
 * §2.7).
 *
 * Cross-package (§3.5): generate's from_image_id reads the IMAGES library through
 * shared/image-link.ts — a guarded dynamic import of sylo-image-gen's
 * library-store, READ-ONLY (getRecord only), soft-failing with a plain-language
 * note; never a back-write. sylo-image-gen can be uninstalled/disabled with no
 * static or type-level coupling from this package.
 *
 * Plan: .sylo/plans/2cd6e56d-eee7-4523-8a46-94151f7dd348.md — ALL-LOCAL ONLY
 * (§2.6): ComfyUI is the only backend; no remote endpoints, no provider keys,
 * nothing cloud-shaped; the package detects, never spawns.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { registerDoctorTool } from './tools/doctor.ts'
import { registerGenerateTool } from './tools/generate.ts'
import { registerGetTool } from './tools/get.ts'
import { registerListTool } from './tools/list.ts'
import { registerOrganizeTool } from './tools/organize.ts'
import { registerV2ScaffoldTools } from './tools/v2-scaffold.ts'

export default function register(api: ExtensionAPI): void {
  // v1 (§3.1–§3.3) — names fixed at build time (§8 header)
  registerGenerateTool(api)
  registerListTool(api)
  registerGetTool(api)
  registerOrganizeTool(api)
  registerDoctorTool(api)
  // v2 name reservations (§3.6) — scaffolding executes only
  registerV2ScaffoldTools(api)
}