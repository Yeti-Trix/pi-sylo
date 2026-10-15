/**
 * sylo-image-gen — local ComfyUI image generation for Sylo.
 *
 * §3/§8 step 4: the agent tool surface is wired. Five v1 tools (plan §3.1–§3.3)
 * run against the shared ComfyUI client + model catalog (§2) and the per-
 * workspace image library store (§4, SYLO_PI_CWD-resolved). Five v2 names are
 * reserved with full schemas and disclosure-clause executes (§3.6 — scaffold
 * only, see tools/v2-scaffold.ts). Config: extensions/config.ts (SYLO_IMAGEGEN_
 * CONFIG env → extensions-config/sylo-image-gen.json → defaults, §2.7).
 * Plan: .sylo/plans/db584c80-9ae0-4a02-828f-5aecd7b6b62c.md
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { registerDoctorTool } from './tools/doctor.ts'
import { registerGenerateTool } from './tools/generate.ts'
import { registerGetTool } from './tools/get.ts'
import { registerListTool } from './tools/list.ts'
import { registerOrganizeTool } from './tools/organize.ts'
import { registerV2ScaffoldTools } from './tools/v2-scaffold.ts'

export default function register(api: ExtensionAPI): void {
  // v1 (§3.1–§3.3)
  registerGenerateTool(api)
  registerListTool(api)
  registerGetTool(api)
  registerOrganizeTool(api)
  registerDoctorTool(api)
  // v2 name reservations (§3.6) — scaffolding executes only
  registerV2ScaffoldTools(api)
}