/* Sample rows for the gallery's list grids (the Theme board and Keywords-Groups mock-ups). */

export interface TodoRow {
  id: string
  n: number
  text: string
  url: string | null
  odds: number
  stage: string
  group: 'exists' | 'none' | 'right'
}

export const TODO_GROUPS = {
  exists: 'Page exists, not cited',
  none: 'No page yet',
  right: 'Cited by the right page'
} as const

function todo(
  n: number,
  text: string,
  url: string | null,
  odds: number,
  stage: string,
  group: TodoRow['group']
): TodoRow {
  return { id: `q${n}`, n, text, url, odds, stage, group }
}

export const TODO_ROWS: TodoRow[] = [
  todo(
    6,
    'I run three clinic locations and need to tell staff about closures',
    '/use-cases/multi-location/',
    81,
    'Problem',
    'exists'
  ),
  todo(
    10,
    "Our carrier's email-to-text address stopped delivering. What now?",
    '/blog/carrier-email-to-text-shutdown/',
    76,
    'Options',
    'exists'
  ),
  todo(
    4,
    'We lost a client because a server-down email went unnoticed',
    '/use-cases/it-alerts/',
    72,
    'Problem',
    'exists'
  ),
  todo(
    12,
    'Do I need 10DLC registration just to text alerts to my own team?',
    '/blog/how-to-set-up-text-alerts/',
    64,
    'Doubts',
    'exists'
  ),
  todo(
    5,
    'My office manager sends the same urgent notice by email and nobody reads it',
    '/email-to-sms/',
    61,
    'Problem',
    'exists'
  ),
  todo(21, '12-person HVAC company: is email-to-text enough for on-call?', null, 60, 'Fit', 'none'),
  todo(17, 'Our on-call maintenance crew changes every week', null, 52, 'Fit', 'none'),
  todo(
    25,
    'How does a free carrier email-to-text address compare with a paid service?',
    null,
    55,
    'Compare',
    'none'
  ),
  todo(2, 'Text alerts for teams without a developer', '/', 40, 'Decide', 'right'),
  todo(8, 'Cheapest way to send texts from a monitoring tool', '/pricing/', 38, 'Decide', 'right')
]

export interface KeywordRow {
  id: string
  keyword: string
  group: string
  groupKind: 'Coverage' | 'Intent'
  intent: 'Commercial' | 'Informational'
  funnel: 'TOFU' | 'MOFU' | 'BOFU'
  pageType: string
}

const CORE = ['email to text', 'sms alert', 'text alert', 'email to sms', 'business text']
const VARIANTS = ['service', 'software', 'app', 'gateway', 'for business', 'free', 'pricing', 'api']
const INTENT_GROUPS = [
  'Core Commercial / Category',
  'Best / top lists',
  'Pricing / free / trial',
  'Alternatives & vs',
  'How-to'
]

/** About 118 keywords in 22 groups, deterministic. */
export function keywordRows(): KeywordRow[] {
  const rows: KeywordRow[] = []
  let id = 0
  for (const core of CORE) {
    for (const variant of VARIANTS.slice(0, 6)) {
      rows.push({
        id: `k${id++}`,
        keyword: `${core} ${variant}`,
        group: `Cover — ${core}`,
        groupKind: 'Coverage',
        intent: 'Commercial',
        funnel: 'MOFU',
        pageType: 'landing page'
      })
    }
  }
  for (const [at, group] of INTENT_GROUPS.entries()) {
    for (let index = 0; index < 6; index += 1) {
      const core = CORE[(at + index) % CORE.length] ?? 'text alert'
      rows.push({
        id: `k${id++}`,
        keyword:
          at === 4
            ? `how to set up ${core}s ${index + 1}`
            : `${group.split(' ')[0]?.toLowerCase()} ${core} ${index + 1}`,
        group,
        groupKind: 'Intent',
        intent: at === 4 ? 'Informational' : 'Commercial',
        funnel: at === 4 ? 'TOFU' : at === 2 ? 'BOFU' : 'MOFU',
        pageType:
          at === 3 ? 'comparison page' : at === 1 ? 'listicle' : at === 4 ? 'blog' : 'landing page'
      })
    }
  }
  for (let extra = 0; rows.length < 118; extra += 1) {
    const core = CORE[extra % CORE.length] ?? 'text alert'
    rows.push({
      id: `k${id++}`,
      keyword: `${core} question ${extra + 1}`,
      group: `Question long-tail ${(extra % 12) + 1}`,
      groupKind: 'Intent',
      intent: 'Informational',
      funnel: 'TOFU',
      pageType: 'blog'
    })
  }
  return rows
}
