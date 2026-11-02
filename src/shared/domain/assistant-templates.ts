/**
 * The Ask CiteFox template kinds (deep audit crosscut §3.3, §3.5): one
 * single-purpose prompt per kind of question, each versioned and editable in
 * Templates like every other Claude step. Bodies and the reply schema live in
 * main (`src/main/assistant/templates.ts`). The `list` questions ("which
 * questions…") keep the Ask filter prompt (`ask.citefox`), whose answer is
 * written in code.
 */

export const ASSISTANT_TEMPLATE_KINDS = [
  'assistant_explain',
  'assistant_why_not_cited',
  'assistant_next_steps',
  'assistant_draft',
  'assistant_questions',
  'assistant_changes',
  'assistant_summary',
  'assistant_help'
] as const

export type AssistantTemplateKind = (typeof ASSISTANT_TEMPLATE_KINDS)[number]

/** Seconds each answer usually takes, until `llm_calls` has history. */
export const ASSISTANT_EXPECTED_SECONDS: Readonly<Record<AssistantTemplateKind, number>> = {
  assistant_explain: 8,
  assistant_why_not_cited: 10,
  assistant_next_steps: 10,
  assistant_draft: 15,
  assistant_questions: 10,
  assistant_changes: 8,
  assistant_summary: 10,
  assistant_help: 6
}

function v(name: string, holds: string): { name: string; holds: string } {
  return { name, holds }
}

const COMMON = [
  v('business', 'The project: its name and domain'),
  v('screen', 'Where the user is: the screen, its crumbs, filters and what they picked'),
  v('about', 'The thing the question is about (a question row, a number), when one was picked'),
  v('numbers', 'Numbers counted in code from the stored checks, each with its ref (N1…)'),
  v('screen_numbers', 'The numbers the screen shows, as shown'),
  v('rows', 'Stored prompt checks in scope, each with its ref (R1…), status and cited sites'),
  v('rivals', 'Sites the stored overviews cite besides the business, with counts'),
  v('pages', 'Tracked pages with their refs (P1…), for a target page'),
  v('check_facts', 'Checks finished, the next scheduled check and fixes logged, read in code'),
  v('help', 'The CiteFox help sections that match the question, each with its ref (H1…)'),
  v('history', 'The last turns of this conversation, short'),
  v('question', "The user's question, fenced as data"),
  v('today', "Today's date")
]

/** Variables each Ask CiteFox step fills (the template editor lists these). */
export const ASSISTANT_TEMPLATE_VARIABLES: Readonly<
  Record<AssistantTemplateKind, readonly { name: string; holds: string }[]>
> = {
  assistant_explain: COMMON,
  assistant_why_not_cited: COMMON,
  assistant_next_steps: COMMON,
  assistant_draft: COMMON,
  assistant_questions: COMMON,
  assistant_changes: COMMON,
  assistant_summary: COMMON,
  assistant_help: [
    v('business', 'The project: its name and domain'),
    v('screen', 'Where the user is: the screen, its crumbs and what it shows'),
    v('screen_help', 'What this screen is for and what its settings do, shipped with CiteFox'),
    v('help', 'The CiteFox help sections that match the question, each with its ref (H1…)'),
    v('check_facts', 'Checks finished, the next scheduled check and fixes logged, read in code'),
    v('numbers', 'Numbers counted in code from the stored checks, each with its ref (N1…)'),
    v('history', 'The last turns of this conversation, short'),
    v('question', "The user's question, fenced as data"),
    v('today', "Today's date")
  ]
}

/** Copy for the template editor. */
export const ASSISTANT_TEMPLATE_INFO: Readonly<
  Record<AssistantTemplateKind, { label: string; description: string; usage: [string, string] }>
> = {
  assistant_explain: {
    label: 'Ask: explain a number',
    description:
      'Explains a number or a screen in plain words from the stored checks. Uses only numbers counted in code.',
    usage: ['explanation', 'explanations']
  },
  assistant_why_not_cited: {
    label: 'Ask: why not cited',
    description:
      'Says why the stored overviews cite other sites for a question or page, and who is cited instead. Timing, not proof.',
    usage: ['diagnosis', 'diagnoses']
  },
  assistant_next_steps: {
    label: 'Ask: what to do next',
    description:
      'Picks the next few things to do from the stored misses, each tied to the rows it comes from.',
    usage: ['next-steps answer', 'next-steps answers']
  },
  assistant_draft: {
    label: 'Ask: draft an answer',
    description:
      'Drafts the answer or section a page needs for a question. Unconfirmed facts in [brackets].',
    usage: ['draft', 'drafts']
  },
  assistant_questions: {
    label: 'Ask: rewrite or suggest questions',
    description:
      'Rewrites questions the way buyers ask, or suggests similar ones to track. Nothing is added until you confirm.',
    usage: ['question set', 'question sets']
  },
  assistant_changes: {
    label: 'Ask: what changed',
    description:
      'Explains what moved since the check before, from the stored movement of each question.',
    usage: ['change summary', 'change summaries']
  },
  assistant_summary: {
    label: 'Ask: summarise for a client',
    description: 'Writes a short client-ready summary of what the screen shows.',
    usage: ['summary', 'summaries']
  },
  assistant_help: {
    label: 'Ask: how this screen works',
    description:
      'Answers how, why and where questions from the help CiteFox ships, with the project’s own check facts and counts.',
    usage: ['help answer', 'help answers']
  }
}
