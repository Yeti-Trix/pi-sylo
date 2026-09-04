# sylo-workflows

Base, always-on Sylo package: a **database of operator prompt playbooks** (markdown + YAML frontmatter). A workflow is a saved prompt — Tools → Workflows → *Send to agent* substitutes `{workspace}` and loads the body into a new chat. The agent follows it with whatever tools are available.

- **Agent tool:** `sylo_workflows_list` — list workflows (id, title, description, source, path).
- **Agent CRUD:** standard file tools (`read` / `write` / `edit` / `bash`) on `sylo-user/.sylo/workflows/*.md`. No custom save/delete tools.
- **Engine:** pure TypeScript (`extensions/workflows-engine.ts`) — no Python. Ported from the LogicForge `_workflows_lib.py` concept and generalized.

## Layout

| Path | Purpose |
|------|---------|
| `extensions/index.ts` | Registers `sylo_workflows_list` |
| `extensions/workflows-engine.ts` | Discover / parse frontmatter / read / `{workspace}` substitution |
| `skills/sylo-workflows/SKILL.md` | Skill: where files live, frontmatter contract, CRUD via file tools |
| `shared/workflows/*.md` | Bundled workflows (read-only; operator overrides by `id`) |

## Sources (precedence: operator > legacy > bundled)

- Bundled: `packages/sylo-workflows/shared/workflows/*.md`
- Operator (shared, editable, GitHub-synced): `sylo-user/.sylo/workflows/*.md`
- Legacy (pre-refactor operator, read-only fallback): `~/.pi/agent/workflows/*.md`
- Legacy (from LogicForge, read-only fallback): `~/.pi/agent/logicforge/workflows/*.md`

## Optional-package wiring

Registered in `SYLO_OPTIONAL_PACKAGES` (`apps/host/src/shared/sylo-optional-packages.ts`). Enable in Capability Manager → Sylo optional packages to load `sylo_workflows_list` and show the Tools → Workflows route. Off by default. No host broker/env wiring (unlike the sylo-builtin subagents/scheduler).

## Tracker

`features_tracker/active/2026-07-17_17-00-00_sylo_workflows_base_package.md`

**Pending phases:** route UI under Tools (port of LogicForge WorkflowsTab) + host IPC (`syloWorkflow*`), then strip LogicForge workflow references and repoint the logicforge skill.