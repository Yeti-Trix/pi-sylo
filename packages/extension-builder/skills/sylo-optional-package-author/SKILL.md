---
name: sylo-optional-package-author
description: Scaffold a first-party sylo-* Pi package in the monorepo (extension + skill + scripts), register it for Capability manager → Sylo optional packages.
metadata:
  sylo:
    category: authoring
    icon: package
---

# Sylo optional package author

Use when adding a **first-party** `sylo-*` tool shipped in the Sylo repo, **off by default**, toggled in **Capability manager → Sylo optional packages**.

Do **not** use this for host-core (always-on) extensions like `skill-surface-extension` or `sylo-builtin-tools-guard`. Do **not** use for one-off drop-ins under `~/.pi/agent/extensions/` — see **sylo-extension-author** for that.

## Naming

- Folder + npm name: `sylo-<feature>` (e.g. `sylo-pdf-reader`, `sylo-template-docx-writer`).
- **`sylo-` prefix** = Sylo branding. Some packages need Sylo host UI later (routes/widgets); others are chat + tools only.

## Checklist (every new package)

1. **Scaffold** under `packages/sylo-<name>/`:

   ```text
   packages/sylo-<name>/
   ├── package.json          # "keywords": ["pi-package"], "pi": { extensions, skills }
   ├── extensions/index.ts   # pi.registerTool(...)
   ├── skills/<skill-name>/SKILL.md
   ├── scripts/              # optional Python/shell helpers (extension shells out)
   └── README.md
   ```

2. **Register** in `apps/host/src/shared/sylo-optional-packages.ts` — add one entry to `SYLO_OPTIONAL_PACKAGES` (id, title, description, `extensionRelPath`, `skillNames`, optional `pythonRequirementsRelPath`, `requiresSyloUi`).

3. **Node vs renderer:** Never import `node:fs` / `node:path` in `sylo-optional-packages.ts` (renderer imports it). Disk checks live in `apps/host/src/main/sylo-optional-packages-host.ts` only.

4. **Bootstrap skill** — add `ensureCopyTree` in `scripts/bootstrap-pi.mjs` for the package skill folder → `~/.pi/agent/skills/<skill-name>/`.

5. **Operator docs** — when behavior is user-visible, add/update **Sylo optional packages** in `docs/GETTING_STARTED.md`.

6. **Publish later (optional):** remove `"private": true`, `npm publish --access public`, operators `pi install npm:sylo-<name>`.

## Tiers (do not blur)

| Tier | Where | Loaded |
|------|--------|--------|
| Host-core | `packages/skill-surface-extension/`, tools-guard | Always (broker env) |
| **Sylo optional** | `packages/sylo-*/` + registry | When operator toggles **On** + **Restart broker** |
| Community | `pi install npm:…` | Downloaded packages section |

## Extension + skill split

- **Extension (TS):** typed tools the model calls (`registerTool`).
- **Skill (SKILL.md):** when/how to use those tools (workflow, not mail-merge).
- **Scripts:** any language; extension runs `python` / shell on PATH. Set `pythonRequirementsRelPath` for auto pip on enable.

## Python helpers

- Set `pythonRequirementsRelPath` in the registry (e.g. `packages/sylo-<name>/scripts/requirements.txt`).
- Sylo runs `python -m pip install -r …` when the operator enables the package in Capability manager.
- Document optional extras (OCR, etc.) in package README only.

## Reference implementation

Copy patterns from `packages/sylo-pdf-reader/` (search → render tools, skill protocol, Strict OOXML gotchas if docx).

## After scaffolding

Tell the operator:

1. `npm run bootstrap-pi` (skills)
2. **Capability manager → Sylo optional packages → On** (installs Python deps)
3. **Restart broker**
