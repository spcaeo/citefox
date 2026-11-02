import type { AssistantContextInput, AssistantIntent } from '@shared/ipc'

/**
 * The code router (deep audit crosscut §3.3 step 1): each question goes to
 * one single-purpose prompt. Rules are read in order; the first that matches
 * wins. A screen with no project data (settings, connections) answers "how
 * does this work" questions by default.
 */

/** Screens whose questions are about the app, not the project's results. */
export const HELP_SCREENS: ReadonlySet<string> = new Set([
  'settings',
  'connections',
  'permissions',
  'alerts',
  'templates',
  'playground',
  'project-settings',
  'new-project',
  'add',
  'add-page',
  'import-pages',
  'unavailable'
])

interface Rule {
  intent: AssistantIntent
  test: (question: string, context: AssistantContextInput) => boolean
}

const has = (pattern: RegExp) => (question: string) => pattern.test(question)

const RULES: readonly Rule[] = [
  {
    intent: 'draft',
    test: has(
      /\b(draft|write (an? |the )?(answer|answers|faq|faqs|section|fix|brief|page brief|reply|paragraph)|write answers)\b/
    )
  },
  {
    intent: 'questions',
    test: has(
      /\b(rewrite|rephrase|reword|similar questions|questions like|suggest (\d+|some|a few|more)? ?(more |similar |new )?(questions|similar)|more questions|questions (i am|i'm|we are|we're) missing|missing questions|the way buyers ask|in buyer words|in the words buyers)\b/
    )
  },
  {
    intent: 'summary',
    test: has(
      /\b(summari[sz]e|summary|executive summary|for my client|for a client|in \d+ lines)\b/
    )
  },
  {
    intent: 'help',
    test: (question, context) =>
      /\b(what does (this|the|that) (setting|option|alert|connection|template|permission|screen|button|tab|toggle|field)|how (do|does|can) (i|this|citefox) (set|use|turn|connect|work|change|edit)|why does citefox need|what happens if i|what is this (screen|page|setting)|how does this (screen|work))\b/.test(
        question
      ) ||
      (HELP_SCREENS.has(context.screen) &&
        !/\b(cited|citation|overview|rival|competitor)\b/.test(question))
  },
  {
    intent: 'list',
    test: (question) =>
      (/^(which|what|show( me)?|list|find)\b.*\b(questions|prompts|checks)\b/.test(question) &&
        !/\b(no target|target page|topic|stage|first|why|how)\b/.test(question)) ||
      /^where (am i|is my page|are we|is this page) not cited\b/.test(question) ||
      /^(which|what) (sites|domains|competitors) (beat|win|are cited)\b/.test(question)
  },
  {
    intent: 'why_not_cited',
    test: has(
      /\b(why (isn'?t|is not|aren'?t|am i not|are we not|is my page not|isn'?t my page)\b|why .* not (cited|the first|first)|why is [\w.-]+ (ahead|cited|winning)|who is cited instead|cited instead|not the first source|what does the (ai )?overview say that)\b/
    )
  },
  {
    intent: 'changes',
    test: has(
      /\b(what changed|changed since|change since|why did .* (change|drop|fall|rise|go up|go down)|since (the |my )?last check|between (these|my|the) (two )?checks|what moved|lost .* since|did my (last )?fix work|did (this|the) fix work)\b/
    )
  },
  {
    intent: 'next_steps',
    test: has(
      /\b(what should i (do|fix|change|add|track)|fix first|first this week|next step|next fix|where (do|should) i start|how (do|can) i (reach|get|improve|fix|raise|move)|what would (fix|move|help)|prioriti[sz]e|needs? (work|attention)|weakest|worth checking|should i (add|track|check))\b/
    )
  },
  { intent: 'explain', test: has(/\b(explain|what does .* mean|what am i looking at|why is)\b/) }
]

export function routeIntent(question: string, context: AssistantContextInput): AssistantIntent {
  const text = question.trim().toLowerCase().replace(/[’]/g, "'")
  for (const rule of RULES) if (rule.test(text, context)) return rule.intent
  return HELP_SCREENS.has(context.screen) ? 'help' : 'explain'
}
