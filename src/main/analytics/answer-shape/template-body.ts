/**
 * Shipped default for the answer-shape step (Docs/REPORT-SPEC.md section 9).
 * Classifies a stored AI Overview into the fixed vocabulary in `vocabulary.ts`.
 * `{{ var }}` only: `prompt_text` and `overview_text` are the shared template variables
 * for this kind. The code list below must match `ANSWER_SHAPE_LABELS`.
 */
import { JSON_ONLY_RULE } from '../../prompts/blocks'

export const ANSWER_SHAPE_TEMPLATE = `You are classifying the blocks of one Google AI Overview. Work from the text below only. Do not search and do not use outside knowledge.

The buyer prompt that produced it:
{{ prompt_text }}

The AI Overview text:
{{ overview_text }}

Split the overview into its blocks in reading order. A block is one of these:
- a paragraph;
- a list, or a group of list items under one lead-in sentence;
- a table;
- a heading with the text under it, up to the next heading.
Do not invent blocks. Every block must come from the text above, and the blocks must follow its order. Do not merge two blocks that make different points, and do not split one paragraph.

Give each block exactly one code from this fixed list. Use only these codes.

Foundations
- A1 What / Definition: what the thing is.
- A2 What / Capabilities: what it does, its features.
- A3 Why / Rationale: why it matters or why someone would choose it.

Audience, choices and cost
- B1 Audience / Persona: who it is for.
- B2 Which / Comparison: options, alternatives, or one thing compared with another.
- B3 Commercial / Pricing: price, plans, cost, or free tiers.

Requirements and setup
- C1 Requirements: what is needed before starting.
- C2 How / Quick start: the short way to get going.
- C3 How / Full setup: a complete setup or configuration.
- C4 How / Procedural: steps to do a task.

Real-world use and risk
- D1 Examples / Use cases: examples or situations where it is used.
- D2 Risks / Limitations: drawbacks, limits, warnings, or caveats.
- D3 Metrics / KPIs: numbers, measures, or results to track.

Context and operations
- E1 When / Timing: when to do it, deadlines, or how long it takes.
- E2 Where / Location: places, regions, or where something is found.
- E3 Support / Contact: help, support channels, or who to contact.
- E4 Legal / Compliance: laws, rules, registration, or compliance.

References
- F1 References / Further reading: pointers to sources or more reading.
- F2 Other: a block that fits none of the codes above.

For each block, write excerpt: the block's opening words copied exactly from the overview text, at most 160 characters. Do not reword, translate, or add an ellipsis.
${JSON_ONLY_RULE}
`
