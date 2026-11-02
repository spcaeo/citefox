import type { AiContext, AiEntityKind, AiEntityRef } from './context/types'

/**
 * "Suggested for this screen" (deep audit crosscut §3.3): 3 to 5 questions
 * built in code from where you are and what the screen shows, so listing
 * them never calls Claude. Each screen family has its own set; data on the
 * screen (a picked row, a rival, a trend, the market) changes the words.
 */

const MAX = 5

function entity(context: AiContext, kind: AiEntityKind): AiEntityRef | undefined {
  return context.entities.find((item) => item.kind === kind)
}

function quote(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return `“${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}”`
}

/** The top rival the screen names: a domain entity, or a "Top rival" number. */
function rival(context: AiContext): string | null {
  const named = context.entities.find(
    (item) => item.kind === 'domain' || item.kind === 'competitor'
  )
  if (named) return named.label
  const number = context.numbers.find((item) => /rival|cited instead|top site/i.test(item.label))
  return number && /[a-z]/i.test(number.value) ? number.value : null
}

function market(context: AiContext): string | null {
  return entity(context, 'market')?.label ?? context.filters.market ?? null
}

function trendSince(context: AiContext): string | null {
  for (const item of context.numbers) {
    const match = /since ([A-Z][a-z]{2} \d{1,2})/.exec(item.value)
    if (match) return match[1] ?? null
  }
  return null
}

type Builder = (context: AiContext) => (string | null | false)[]

const SCREENS: Readonly<Record<string, Builder>> = {
  overview: (context) => [
    'What should I fix first this week?',
    'Explain my headline numbers in plain words',
    trendSince(context)
      ? `Which questions lost a citation since ${trendSince(context)}, and who is cited instead?`
      : 'Which questions lost a citation since the last check?',
    rival(context)
      ? `Why is ${rival(context)} ahead of me?`
      : 'Who is cited instead of me most often?',
    'Summarise this project for my client in 5 lines'
  ],
  questions: (context) => {
    const picked = context.selection.filter((item) => item.kind === 'question').length
    if (picked > 0) {
      const these = picked === 1 ? 'this question' : `these ${picked} questions`
      return [
        `Group ${these} into topics`,
        `Rewrite ${these} the way buyers ask`,
        `Why aren't ${these} cited?`,
        `Which topic should ${these} move to?`
      ]
    }
    return [
      'Which questions are not cited in any market?',
      'Suggest 5 questions buyers ask that I am missing',
      'Which questions should I check again first?',
      rival(context)
        ? `Which questions does ${rival(context)} win?`
        : 'Which sites beat me most often?'
    ]
  },
  topics: () => [
    'Which topic needs work first?',
    'Which topics are below the 50–70% band?',
    'Suggest a new topic from my saved questions',
    'Summarise my topics for my client in 5 lines'
  ],
  topic: (context) => {
    const topic = entity(context, 'topic')?.label
    const name = topic ? quote(topic) : 'this topic'
    return [
      'Which stage is weakest, and what would fix it?',
      context.screen === 'topic.todo'
        ? 'Draft an answer for the first question we are not cited for'
        : 'Write answers for the questions we are not cited for',
      rival(context)
        ? `Why is ${rival(context)} cited for ${name}?`
        : `Who is cited instead of me in ${name}?`,
      `Summarise ${name} for my client in 5 lines`,
      context.screen === 'topic.progress' ? 'What changed since the last check?' : null
    ]
  },
  'page.results': (context) => [
    market(context)
      ? `Why isn't this page cited in ${market(context)}?`
      : "Why isn't this page cited more?",
    "What does the AI Overview say that my page doesn't?",
    'Which questions lost a citation since the last check?',
    'What should I change on this page first?'
  ],
  'page.progress': () => [
    'Did my last fix work?',
    'What changed since the last check?',
    'What should I fix next?',
    'Summarise this progress for my client in 5 lines'
  ],
  'page.markets': () => [
    'Which market is weakest, and why?',
    'Who is cited instead of me in each market?',
    'Should I add another market?'
  ],
  'page.sentiment': () => [
    'What do AI Overviews say about my brand?',
    'Which answers say something wrong about us?',
    'How do I fix a negative answer?'
  ],
  'page.communities': () => [
    'Which communities do AI Overviews cite for my questions?',
    'Where should I post first?',
    'Draft a helpful reply for the top thread'
  ],
  'page.gaps': () => [
    'Which gap should I close first?',
    'Draft the section that closes the biggest gap',
    'Why do these gaps matter for citations?'
  ],
  'page.prompts': () => [
    'Which questions are not cited for this page?',
    'Suggest 5 questions buyers ask that I am missing',
    'Rewrite my questions the way buyers ask'
  ],
  'page.audience': () => [
    'Is this buyer profile sharp enough?',
    'Which buyer questions does this profile miss?',
    'What makes this buyer start searching?'
  ],
  'page.history': () => [
    'What changed between my last two checks?',
    'Which questions moved, and in which market?',
    'When did I last lose a citation?'
  ],
  'page.read': () => [
    'What does my page promise, in plain words?',
    'Which buyer questions does this page not answer?',
    'What should I add to this page first?'
  ],
  'page.running': () => ['What is this check doing?', 'How many searches will this check use?'],
  prompt: (context) => {
    const question = entity(context, 'question')?.label
    const name = question ? quote(question) : 'this question'
    return [
      "Why isn't my page the first source?",
      `Who is cited instead for ${name}, and why?`,
      'Draft the fix for this question',
      `Rewrite ${name} the way buyers ask`
    ]
  },
  competitors: (context) => {
    const name = rival(context)
    return [
      name ? `Where did ${name} gain citations?` : 'Which rival gained the most citations?',
      name ? `Which of my questions does ${name} win?` : 'Which rival is cited most, and for what?',
      'Which of my pages compete with their cited pages?',
      "What do their cited pages have that mine don't?"
    ]
  },
  citations: () => [
    'Which of my pages are cited most, and for what?',
    'Which tracked pages are never cited?',
    'Which sites are cited instead of me?'
  ],
  fixes: () => ['Did my fixes work?', 'Which fix had the biggest effect?', 'Draft the next fix'],
  history: () => [
    'What changed between my last two checks?',
    'Which questions moved, and in which market?',
    'Which check found the most problems?'
  ],
  pages: () => [
    'Which pages should I track next?',
    'Which tracked pages are never cited?',
    'Which pages have no questions yet?'
  ],
  structure: () => [
    'Which part of my site is cited least?',
    'Which pages should link to each other?',
    'Which clusters have no tracked page?'
  ],
  youtube: () => [
    'Which videos do AI Overviews cite for my questions?',
    'Suggest a video that could get cited',
    'Which questions show videos in the overview?'
  ],
  communities: () => [
    'Which communities do AI Overviews cite for my questions?',
    'Where should I post first?',
    'Draft a helpful reply I could post'
  ],
  reports: () => [
    'Write the summary for my next report',
    'What should this report highlight?',
    'How often should this report go out?'
  ],
  export: () => [
    'Write the executive summary for this export',
    'What changed since the last report?',
    'Which numbers matter most for my client?'
  ],
  check: () => [
    'Which questions are worth checking now?',
    'How many searches will this check use?',
    'What did my last check find?'
  ],
  alerts: () => [
    'What does each alert do?',
    'Which alerts should I turn on?',
    'How often should CiteFox check?'
  ],
  'project-settings': () => [
    'Which competitors should I add?',
    'Which markets should I track?',
    'What do these settings change?'
  ],
  connections: () => [
    'Is my AI connection working?',
    'What does each connection do?',
    'What happens when a search key runs out?'
  ],
  permissions: () => [
    'Why does CiteFox need this?',
    'What happens if I say no?',
    'Which permissions are missing?'
  ],
  settings: () => [
    'What does this setting do?',
    'What should my default schedule be?',
    'Where is my data kept?'
  ],
  templates: (context) => {
    const template = entity(context, 'template')?.label
    return [
      template ? `What does the ${template} step do?` : 'What does this template do?',
      'How do I make this question better?',
      'What happens if I change a template?'
    ]
  },
  playground: () => [
    'How do I compare two templates?',
    'What does a playground run cost?',
    'How do I save a run?'
  ],
  projects: () => [
    'Which project needs attention?',
    'What changed across my projects this week?',
    'Which project uses the most searches?'
  ],
  status: () => [
    'Explain my usage this month',
    'Explain these errors',
    'How many searches do I have left?'
  ],
  'drawer.add-questions': () => [
    'Suggest 5 more questions for this target',
    'Rewrite these the way buyers ask',
    'Which of these are already tracked?'
  ],
  'drawer.new-topic': () => [
    'Suggest a name for this topic',
    'Which questions belong in this topic?',
    'Which page should be cited for this topic?'
  ],
  'drawer.drill': () => [
    'Explain these rows',
    'What do these rows have in common?',
    'What should I do about these?'
  ],
  'drawer.compare': () => [
    'What changed on the page between these reads?',
    'Did this change help my citations?'
  ]
}

const FALLBACK: Builder = (context) => [
  `What am I looking at on ${context.screenLabel}?`,
  'What should I do next here?',
  'Explain the numbers on this screen'
]

/**
 * No project open: questions about CiteFox itself and setting up, answered
 * from the app's stored data (the project list, the search keys) and the
 * shipped help. The app screens keep their own help questions first.
 */
const NO_PROJECT: Builder = () => [
  'How do I start tracking my site?',
  'How many searches do I have left?',
  'What does a check cost?',
  'How do I connect an AI?',
  'What does CiteFox check?'
]

/** App screens whose own questions still fit with no project open. */
const APP_SCREENS = new Set([
  'settings',
  'connections',
  'permissions',
  'templates',
  'playground',
  'status',
  'projects'
])

/** The screen's builder: its own id, else its family (`topic.todo` → `topic`). */
function builderFor(screen: string): Builder {
  return SCREENS[screen] ?? SCREENS[screen.split('.')[0] ?? ''] ?? FALLBACK
}

export function suggestionsFor(context: AiContext): string[] {
  if (context.projectId === null) return noProjectSuggestions(context)
  const out: string[] = []
  // A picked question row leads with the questions about it.
  const picked = context.selection.length === 1 ? context.selection[0] : undefined
  if (picked?.kind === 'question' && context.screen !== 'questions') {
    out.push(`Why isn't my page cited for ${quote(picked.label)}?`)
  }
  for (const item of builderFor(context.screen)(context)) {
    if (item && !out.includes(item)) out.push(item)
  }
  const fill = FALLBACK(context).filter((item): item is string => typeof item === 'string')
  for (const item of fill) {
    if (out.length >= 3) break
    if (!out.includes(item)) out.push(item)
  }
  return out.slice(0, MAX)
}

function noProjectSuggestions(context: AiContext): string[] {
  const own = APP_SCREENS.has(context.screen) ? (SCREENS[context.screen]?.(context) ?? []) : []
  const out: string[] = []
  for (const item of [...own.slice(0, 2), ...NO_PROJECT(context)]) {
    if (typeof item === 'string' && !out.includes(item)) out.push(item)
  }
  return out.slice(0, MAX)
}
