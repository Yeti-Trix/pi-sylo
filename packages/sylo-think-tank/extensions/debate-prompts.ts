/** Phase-aware research and final-report prompt blocks (Think Tank). */

export type DebatePhase = 'opening' | 'mid'

export function inferDebatePhase(cycle: number): DebatePhase {
  return cycle <= 1 ? 'opening' : 'mid'
}

export function debaterRoleOverrideBlock(debaterIndex: number, debaterCount: number): string | null {
  if (debaterCount === 2) {
    if (debaterIndex === 0) {
      return [
        '### ROLE: Primary Case',
        'Build the **strongest affirmative answer** to the think tank question.',
        '- Lead with your recommended decision in one sentence.',
        '- Support it with sourced evidence and clear reasoning.',
        '- Acknowledge real risks without abandoning your case unless evidence forces it.',
      ].join('\n')
    }
    if (debaterIndex === 1) {
      return [
        '### ROLE: Counter Case',
        'Stress-test the primary case and present the **strongest alternative**.',
        '- What would change the answer? What does the primary case overlook?',
        '- Cite evidence for counter-claims, failure modes, and missing information.',
        '- Surface what the operator must weigh before deciding — not debate points for their own sake.',
      ].join('\n')
    }
    return null
  }

  if (debaterCount < 3) return null
  if (debaterIndex === 0) {
    return [
      '### ROLE: Primary Case',
      'State and defend the **direct answer** to the think tank question.',
      '- Lead with the bottom line in one sentence.',
      '- Defend it with sourced evidence.',
      '- Respond to counter-claims from other researchers with facts, not rhetoric.',
    ].join('\n')
  }
  if (debaterIndex === 1) {
    return [
      '### ROLE: Methodology Reviewer',
      'Challenge whether the evidence and reasoning support a decision.',
      '- Is the evidence appropriate for the claim?',
      '- Are they using the right decision criterion?',
      '- Are they conflating precision, accuracy, or causation?',
      'Your value is methodological scrutiny. State your own recommendation only after that work.',
    ].join('\n')
  }
  if (debaterIndex === 2) {
    return [
      '### ROLE: Practical Skeptic',
      'Test whether any answer would **actually work in practice**.',
      '- What are the failure modes if we act on this conclusion?',
      '- What operational constraints does it ignore?',
      '- What is the blast radius if it is wrong?',
      'Your value is practical stress-testing. State your own recommendation only after that work.',
    ].join('\n')
  }
  return null
}

export function buildDebaterPhaseInstructions(args: {
  phase: DebatePhase
  seatLabel: string
  opponentLabels: string[]
}): string {
  const opponents =
    args.opponentLabels.length > 0 ?
      args.opponentLabels.join(', ')
    : '(no other researchers yet)'

  if (args.phase === 'opening') {
    return [
      '## PHASE: Opening research pass',
      '',
      'Your job:',
      '1. State your **recommended answer** to the think tank question in one sentence.',
      '2. List the 3–5 strongest facts supporting your view, each with a **source tag**.',
      '3. Flag the single assumption you are **least confident** in and what would resolve it.',
      '4. If you conduct web research this cycle, **cite findings NOW**. You cannot hold them for later cycles or the final report.',
      '',
      'Rules:',
      '- Cite every non-trivial fact. Use tags from context: `[file: path L42]`, `[url: …]`, `[chat: turn T]`. For your own web research, give the full URL.',
      '- State confidence (low/med/high) on each major claim.',
      '- Do **not** restate the question. Do **not** praise other seats (there are none yet).',
      '- Help the operator decide. Skip debate theater.',
    ].join('\n')
  }

  return [
    '## PHASE: Follow-up research',
    '',
    `Prior turns from **${opponents}** are in the transcript above.`,
    '',
    'Your job:',
    `1. Address the strongest counter-claim or gap raised by **${opponents}** — with new evidence or a revised recommendation.`,
    '2. If the evidence changed your answer, say so explicitly and explain why.',
    '3. Add any new findings from research **in this turn**.',
    '4. If you have nothing new to add this cycle, use **`no_more_to_add`**. Do not restate your opening list.',
    '',
    'Rules:',
    '- Reference others by **label**. Never "Seat A" or "the other side."',
    '- Any new number must have a source. Unsourced numbers are treated as fabrication.',
    '- Focus on facts, tradeoffs, and decision impact — not concessions, retractions, or scoring debate points.',
  ].join('\n')
}

export function buildModeratorCycleInstructions(args: {
  cycle: number
  debaterLabels: string[]
}): string {
  const debaters = args.debaterLabels.join(', ')
  return [
    '## PHASE: Moderator synthesis (advisory only — operator cannot pick you)',
    '',
    `Cycle **${args.cycle}**. Researchers this cycle: **${debaters}**.`,
    '',
    'Your job, **in this order**:',
    '1. **KEY FINDING:** The single most important thing learned this cycle toward answering the question. One sentence.',
    `2. **EVIDENCE CHECK:** For each researcher (${debaters}), note their best supported claim and what is still unsourced or shaky.`,
    '3. **GAPS:** What information is still missing before the operator can decide confidently?',
    '4. **READINESS:** Can we synthesize a final answer now, or do we need another research cycle? Assign **sylo_think_tank_task_assign** tasks when specific proof is still needed.',
    '',
    'Rules:',
    '- Quote claims directly when checking evidence. Never paraphrase vaguely.',
    '- Do **not** write vague "both sides have merit" fluff. Name what is known vs unknown.',
    '- You may assign proof tasks with **sylo_think_tank_task_assign**; only you mark **complete** with **sylo_think_tank_task_complete** using the full `task_id` line from **sylo_think_tank_task_list**.',
    '- If core facts are sourced and remaining gaps are minor, you may go **`satisfied`** to enable early exit.',
  ].join('\n')
}

export function buildDebaterFinalReportSections(): string {
  return [
    'Write a **FinalReport** (one perspective the operator may pick). Required markdown sections:',
    '',
    '1. **## BOTTOM LINE** — Your recommended answer in one sentence.',
    '2. **## SUPPORTING FACTS** — The 3 strongest facts supporting your answer, each with a source tag.',
    '3. **## RISKS & LIMITATIONS** — What could make this answer wrong; what the other perspective got right.',
    '4. **## RESIDUAL CONFIDENCE** — low/med/high. State the one fact that, if proven wrong, would flip your answer.',
    '',
    'Rules:',
    '- **NO NEW EVIDENCE** not introduced during research cycles. Web research must have been cited in a prior turn.',
    '- Confidence must match citation depth. "High" with one source is a red flag the Moderator will flag.',
    '- End JSON stance footer with **`satisfied`** or **`no_more_to_add`** only (not `continue`).',
  ].join('\n')
}

export function buildModeratorFinalReportSections(): string {
  return [
    'Write a **FINAL MODERATOR REPORT** for the operator (advisory synthesis — not pickable). Required sections:',
    '',
    '1. **## BOTTOM LINE** — Your best answer to the think tank question given all research. One clear recommendation, or **insufficient evidence to decide** if the bar is not met.',
    '2. **## WHAT WE FOUND** — Consolidated facts everyone agrees on, plus contested facts with sourcing status.',
    '3. **## OPTIONS** — 2–4 viable paths forward with tradeoffs (not "pick Debater A").',
    '4. **## WHAT TO DO NOW** — Concrete next actions for the operator.',
    '5. **## GAPS & MORE WORK** — Missing information, recommended follow-up research, or whether another think tank pass is warranted.',
    '6. **## CONFIDENCE** — low/med/high in the bottom line. State what would change it.',
    '',
    'Also include **## Recommended tests** (scripts, searches, or checks to validate key claims).',
  ].join('\n')
}

export const STANCE_FOOTER_INSTRUCTIONS = [
  'End with a JSON footer on its own line:',
  '`{"stance":"continue|satisfied|no_more_to_add","summary":"one line"}`',
  '',
  '- **continue:** genuinely more evidence or analysis to introduce later (not restatement)',
  '- **satisfied:** done; enough to synthesize a final answer',
  '- **no_more_to_add:** done researching; prefer this over empty **continue** when you have nothing new',
  '',
  'After the JSON footer, **stop**. Do not simulate the next seat.',
].join('\n')
