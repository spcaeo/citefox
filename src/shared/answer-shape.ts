/**
 * The fixed answer-shape vocabulary (Docs/REPORT-SPEC.md section 9), shared so the
 * Full report (main) and the ready reports (app and download) name blocks the same way.
 * Each AI answer text block is one of these codes. The list is closed: `F2` is "Other".
 * Pure: the overview hash that keys stored classifications lives in main.
 */
export const ANSWER_SHAPE_CODES = [
  'A1',
  'A2',
  'A3',
  'B1',
  'B2',
  'B3',
  'C1',
  'C2',
  'C3',
  'C4',
  'D1',
  'D2',
  'D3',
  'E1',
  'E2',
  'E3',
  'E4',
  'F1',
  'F2'
] as const

export type AnswerShapeCode = (typeof ANSWER_SHAPE_CODES)[number]

export const ANSWER_SHAPE_LABELS = {
  A1: 'What / Definition',
  A2: 'What / Capabilities',
  A3: 'Why / Rationale',
  B1: 'Audience / Persona',
  B2: 'Which / Comparison',
  B3: 'Commercial / Pricing',
  C1: 'Requirements',
  C2: 'How / Quick start',
  C3: 'How / Full setup',
  C4: 'How / Procedural',
  D1: 'Examples / Use cases',
  D2: 'Risks / Limitations',
  D3: 'Metrics / KPIs',
  E1: 'When / Timing',
  E2: 'Where / Location',
  E3: 'Support / Contact',
  E4: 'Legal / Compliance',
  F1: 'References / Further reading',
  F2: 'Other'
} as const satisfies Record<AnswerShapeCode, string>

/** Plain names for a marketer: what the block is, in two or three words. */
export const ANSWER_SHAPE_NAMES = {
  A1: 'Definition',
  A2: 'What it can do',
  A3: 'Why it matters',
  B1: 'Who it is for',
  B2: 'Comparison',
  B3: 'Pricing',
  C1: 'What you need',
  C2: 'Quick start',
  C3: 'Full setup',
  C4: 'Step-by-step',
  D1: 'Examples',
  D2: 'Risks and limits',
  D3: 'Numbers to track',
  E1: 'Timing',
  E2: 'Location',
  E3: 'Support and contact',
  E4: 'Legal and rules',
  F1: 'Further reading',
  F2: 'Other'
} as const satisfies Record<AnswerShapeCode, string>

/** What each block means, for the legend. */
export const ANSWER_SHAPE_MEANINGS = {
  A1: 'Says what the thing is.',
  A2: 'Lists its features or what it does.',
  A3: 'Explains why it matters or why to use it.',
  B1: 'Names the people or teams it suits.',
  B2: 'Weighs options or brands against each other.',
  B3: 'Gives prices, plans or costs.',
  C1: 'Lists what you need before you start.',
  C2: 'A short way to get going.',
  C3: 'A complete setup guide.',
  C4: 'Numbered steps to do a task.',
  D1: 'Real examples or use cases.',
  D2: 'Downsides, risks or limits.',
  D3: 'Numbers, metrics or results to watch.',
  E1: 'When to do it, or how long it takes.',
  E2: 'Where it applies or is available.',
  E3: 'How to get help or contact someone.',
  E4: 'Laws, rules or compliance.',
  F1: 'Links or sources to read next.',
  F2: 'Anything that fits none of the above.'
} as const satisfies Record<AnswerShapeCode, string>

/** How to write each block on your own page, for "Write a page in this order". */
export const ANSWER_SHAPE_TIPS = {
  A1: 'Open with a one- or two-sentence definition.',
  A2: 'List the main features in short bullets.',
  A3: 'Say in plain words why it matters to the reader.',
  B1: 'Name who it suits: roles, team sizes, industries.',
  B2: 'Add a fair comparison table against the main options.',
  B3: 'Show prices or plans, with what each includes.',
  C1: 'List what the reader needs before they start.',
  C2: 'Give a three-to-five step quick start.',
  C3: 'Walk through the full setup with headings per stage.',
  C4: 'Write numbered steps, one action per step.',
  D1: 'Give two or three real examples.',
  D2: 'Be honest about limits and how to work around them.',
  D3: 'Name the numbers to track and good targets.',
  E1: 'Say when to do it and how long it takes.',
  E2: 'Say where it applies or is available.',
  E3: 'Tell the reader how to get help.',
  E4: 'Cover the rules or compliance points that apply.',
  F1: 'Link to a few trusted sources.',
  F2: 'Cover the remaining points the answers mention.'
} as const satisfies Record<AnswerShapeCode, string>

export interface AnswerShapeGroup {
  id: 'foundations' | 'audience' | 'requirements' | 'real_world' | 'context' | 'references'
  label: string
  codes: readonly AnswerShapeCode[]
}

export const ANSWER_SHAPE_GROUPS: readonly AnswerShapeGroup[] = [
  { id: 'foundations', label: 'Foundations', codes: ['A1', 'A2', 'A3'] },
  { id: 'audience', label: 'Audience, choices and cost', codes: ['B1', 'B2', 'B3'] },
  { id: 'requirements', label: 'Requirements and setup', codes: ['C1', 'C2', 'C3', 'C4'] },
  { id: 'real_world', label: 'Real-world use and risk', codes: ['D1', 'D2', 'D3'] },
  { id: 'context', label: 'Context and operations', codes: ['E1', 'E2', 'E3', 'E4'] },
  { id: 'references', label: 'References', codes: ['F1', 'F2'] }
]

export function isAnswerShapeCode(value: string): value is AnswerShapeCode {
  return (ANSWER_SHAPE_CODES as readonly string[]).includes(value)
}

/**
 * The ordered fingerprint of an answer, such as `A1 → C4 → D2`. Repeated neighbours
 * collapse to one code, so two definition paragraphs in a row read as one `A1`.
 */
export function shapeFingerprint(blocks: readonly { code: AnswerShapeCode }[]): AnswerShapeCode[] {
  const codes: AnswerShapeCode[] = []
  for (const block of blocks) {
    if (codes[codes.length - 1] !== block.code) codes.push(block.code)
  }
  return codes
}

export function fingerprintLabel(codes: readonly AnswerShapeCode[]): string {
  return codes.join(' → ')
}
