---
name: sylo-workflows
description: Sylo workflows — a database of operator prompt playbooks. List with sylo_workflows_list; create/edit/delete with read/write/edit/bash on sylo-user/.sylo/workflows/*.md.
metadata:
  sylo:
    category: tools
    icon: list
routes:
  - id: workflows
    title: Workflows
    icon: list
    nav_section: tools
    entry: routes/workflows/index.html
    fallback: routes/workflows/fallback.md
route_protocol_version: 0
---

# Sylo Workflows

Workflows are **saved prompts** (markdown + YAML frontmatter), not executable code. In **Tools → Workflows**, pick a workflow → **Send to agent** loads its body into a new chat (with `{workspace}` substituted). The agent then follows it using whatever tools are available (logicforge, pdf-reader, etc.).

This is a **Sylo optional package** — enable it in Capability Manager (→ Sylo optional packages) to load `sylo_workflows_list` and show the Tools → Workflows route. When disabled, neither the tool nor the route is available (you can still `read` workflow files directly).

## Where workflows live

| Source | Path | Editable |
|--------|------|----------|
| Bundled | `packages/sylo-workflows/shared/workflows/*.md` | no — duplicate to edit |
| Operator (shared, synced) | `sylo-user/.sylo/workflows/*.md` | yes |
| Legacy (pre-refactor operator) | `~/.pi/agent/workflows/*.md` | read-only fallback |
| Legacy (from LogicForge) | `~/.pi/agent/logicforge/workflows/*.md` | read-only fallback |

Same `id` in frontmatter → **operator overrides bundled**. The operator dir is shared across workspaces.

## Frontmatter contract

````md
---
id: my-workflow
title: My workflow
description: Short description for the workflow list
---

Body — markdown prompt the agent follows. Use `{workspace}` for the project folder.
````

- `id` (required): lowercase letters, digits, hyphens. Defaults to the filename stem if omitted.
- `title`, `description`: shown in the list.
- `{workspace}` and `{project_dir}` in the body are substituted with the workspace Pi cwd when the workflow is sent to the agent.

## Agent tools

| Tool | Use |
|------|-----|
| `sylo_workflows_list` | List workflows (id, title, description, source, path) |

**Create / edit / delete** workflows with the standard file tools — no custom tool needed (works whether or not the package is enabled, since these are plain files):

- `write` → `sylo-user/.sylo/workflows/<id>.md` to create a new workflow.
- `edit` → change an existing **operator** workflow in place.
- `read` → read a workflow body (substitute `{workspace}` yourself with the workspace cwd, or let the operator use Tools → Workflows → Send to agent, which substitutes it).
- `bash` → `rm` to delete an operator workflow.

Do **not** edit or delete **bundled** workflows — duplicate to an operator copy first (Tools → Workflows → Duplicate, or copy the file to `sylo-user/.sylo/workflows/` and change the `id`).

## When to use

- The operator names a workflow ("run the I/O scaffold", "use the I/O scaffold workflow") → `sylo_workflows_list`, find it by id/title, `read` the body, follow it.
- The operator wants a new reusable prompt → author a markdown file in `sylo-user/.sylo/workflows/` with frontmatter, or ask the operator to create it from Tools → Workflows.
- A workflow body references other tools (e.g. `logicforge_run_prepare`) — load the relevant skill and call those tools as the workflow's steps describe.