/**
 * sylo-workflows — agent tool for listing operator workflow playbooks.
 *
 * Workflows are a database of saved prompts (markdown + frontmatter). The agent creates/edits/deletes
 * them with the standard file tools on `~/.pi/agent/workflows/*.md`; this extension registers only the
 * convenience list tool (discovery + frontmatter parsing is nicer than `bash ls` + parse by hand).
 *
 * Optional Sylo package (enable in Capability Manager) — not a base/always-on builtin.
 *
 * @see features_tracker/active/2026-07-17_17-00-00_sylo_workflows_base_package.md
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { discoverWorkflows } from './workflows-engine.ts'

export default function syloWorkflowsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'sylo_workflows_list',
    label: 'List Sylo workflows',
    description:
            'List Sylo operator workflow playbooks (bundled + sylo-user/.sylo/workflows + legacy ~/.pi/agent/workflows). ' +
      'Returns id, title, description, source, path. Use when the operator names a workflow or before following one. ' +
      'Workflows are markdown prompts — create/edit/delete them with read/write/edit/bash on sylo-user/.sylo/workflows/*.md (see the sylo-workflows skill).',
    parameters: Type.Object({}),
    async execute() {
      const workflows = await discoverWorkflows()
      if (workflows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No workflows found. Create one at `sylo-user/.sylo/workflows/<id>.md` with frontmatter (id, title, description) + a markdown body, or ask the operator to add one from Tools → Workflows.',
            },
          ],
          details: undefined,
        }
      }
      const lines = workflows.map(
        (w) =>
          `- **${w.title}** \`${w.id}\` [${w.source}]${w.editable ? ' (yours)' : ''} — ${w.description || '(no description)'}\n  path: ${w.path}`,
      )
      return {
        content: [
          { type: 'text', text: `${workflows.length} workflow(s):\n\n${lines.join('\n')}` },
        ],
        details: { workflows },
      }
    },
  })
}