/**
 * Host capability envelope for skill widgets + routes (ADR-31 / ADR-32).
 * Widget iframe + sendToAgent bridge ship from Phase B; persistent routes + full bridge set still TODO.
 */
export const SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR = {
  widget_protocol_version: 1,
  route_protocol_version: 0,
  supports_widget: true,
  supports_route: true,
  /** Implemented bridge ops for widgets + persistent routes (routes add RPC replies). */
  bridge_capabilities: [
    'sendToAgent',
    'requestAgentAction',
    'readSkillData',
    'writeSkillData',
  ] as const,
  max_widget_bytes: 65536,
  /** Routes may inline Vite bundles (e.g. optional-package dashboards). */
  max_route_bytes: 2_097_152,
  skill_data_quota_bytes: 10485760,
} as const
