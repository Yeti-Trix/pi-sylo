---
name: sylo-extension-author
description: Scaffold a TypeScript Pi extension with Sylo `syloConfig` wiring.
metadata:
  sylo:
    category: authoring
    icon: code
---

# Extension author (Sylo)

For **first-party monorepo packages** (`packages/sylo-*/`, Capability manager toggles), use **sylo-optional-package-author** instead.

Guide the operator through creating `~/.pi/agent/extensions/<name>.ts` (ad-hoc drop-in):

- `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"`
- Optional `import { syloConfig } from "@sylo/pi-helpers"` and a TypeBox schema for operator JSON config
- Default export `function (pi: ExtensionAPI) { ... }`
- Register tools with `pi.registerTool` using `typebox` `Type.Object`

Use `write` to place the file, then suggest `/reload`.
