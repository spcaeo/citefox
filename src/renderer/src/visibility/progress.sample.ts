/**
 * Harness and tests only. Production screens do not import this module.
 */
import type {
  ChangeGroup,
  ChangeItem,
  MarketTrend,
  ProgressDetail,
  PromptHistoryRow
} from './progress'

const PROMPTS: readonly { n: number; label: string; full: string }[] = [
  {
    n: 1,
    label: 'Alerts to employees, no developer, no new app',
    full: 'How can I send text alerts to my employees without hiring a developer or learning a new app?'
  },
  {
    n: 2,
    label: 'Schedule a text to the whole team from Gmail/Outlook',
    full: 'Is there a way to schedule a text message to my whole team from Gmail or Outlook?'
  },
  {
    n: 3,
    label: 'Monitoring tool email alerts → texts',
    full: 'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?'
  },
  {
    n: 4,
    label: 'txt.att.net stopped working, what to use instead',
    full: 'My email-to-text through txt.att.net stopped working. What’s the best replacement for business alerts?'
  },
  {
    n: 5,
    label: 'Verizon vtext.com shutdown, what to switch to',
    full: 'Verizon is shutting down vtext.com. What should a small business switch to so our automated alerts keep reaching phones?'
  },
  {
    n: 6,
    label: 'Scheduling software emails → SMS reminders',
    full: 'What’s the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?'
  },
  {
    n: 7,
    label: '10DLC for own employees, service handles it',
    full: 'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?'
  },
  {
    n: 8,
    label: 'Cheap Twilio alternative without developers',
    full: 'What’s a cheap alternative to Twilio for sending business text alerts if we don’t have developers?'
  },
  {
    n: 9,
    label: 'Text field techs Saturday morning, written Friday',
    full: 'How do I send a text to my field techs early Saturday morning when I’m writing the update Friday afternoon?'
  },
  {
    n: 10,
    label: 'Employees reply, reply comes back to email',
    full: 'Can employees reply to an automated business text alert and have the reply come back to my email?'
  }
]

function prompt(n: number): { id: string; n: number; label: string; full: string } {
  const found = PROMPTS.find((item) => item.n === n)
  if (!found) throw new Error(`Missing sample question ${n}`)
  return { id: `tb-${n}`, n, label: found.label, full: found.full }
}

function item(n: number, detail: string, extra: string, extraMono: boolean): ChangeItem {
  const row = prompt(n)
  return { ...row, detail, extra, extraMono }
}

function group(
  title: string,
  tone: ChangeGroup['tone'],
  items: readonly ChangeItem[]
): ChangeGroup {
  const count = items.length
  const aria =
    count === 0 ? `${title}: none` : `${title}: ${count} ${count === 1 ? 'question' : 'questions'}`
  return { title, tone, count, aria, items }
}

function row(
  n: number,
  baseline: string,
  oct5: string,
  oct19: string,
  fix1: boolean,
  fix2: boolean
): PromptHistoryRow {
  return { ...prompt(n), baseline, oct5, oct19, fix1, fix2 }
}

function market(name: string, a: number | null, b: number, c: number): MarketTrend {
  const scores = [a, b, c] as const
  const deltaN = c - b
  const listed = scores.filter((value): value is number => value !== null)
  return {
    name,
    sep21: a === null ? 'Added Oct 5' : String(a),
    oct5: String(b),
    oct19: String(c),
    scores,
    delta: deltaN > 0 ? `+${deltaN}` : String(deltaN),
    tone: deltaN > 0 ? 'up' : deltaN < 0 ? 'down' : 'flat',
    aria: `${name} visibility: ${listed.join(', ')}`,
    checks: [
      { label: 'Sep 21', value: a === null ? 'Added Oct 5' : String(a) },
      { label: 'Oct 5', value: String(b) },
      { label: 'Oct 19', value: String(c) }
    ]
  }
}

const PAGE = 'textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

const SAMPLE: ProgressDetail = {
  changedHeading: 'What changed since the last check (Oct 5 → Oct 19)',
  changedIntro:
    '🇺🇸 US · EN · all 10 questions checked both times · 4 questions changed, 6 didn’t. The page content also changed in this period (Fix 1, Oct 8). CiteFox shows both side by side and doesn’t claim one caused the other.',
  groups: [
    group('Gained a citation', 'up', [
      item(1, 'Page cited at position 2 · was Not cited', PAGE, true),
      item(6, 'Page cited at position 3 · was Brand mentioned', PAGE, true)
    ]),
    group('Lost a citation', 'down', [
      item(
        9,
        'Was page cited at position 5 · now Not cited',
        'Cited instead: simpletexting.com, clicksend.com',
        false
      )
    ]),
    group('Newly named in the text', 'named', [
      item(
        5,
        'TextBolt named in the overview, no link · was Not cited',
        'Overview cites verizon.com, clicksend.com',
        false
      )
    ]),
    group('No longer named', 'flat', [])
  ],
  unchangedNote: 'Not in these lists: questions 2, 3, 4, 7, 8 and 10.',
  unchanged: [
    { ...prompt(2), note: 'Other own page cited at position 4 both times' },
    { ...prompt(3), note: 'Page cited at position 1 both times' },
    { ...prompt(4), note: 'Not cited both times' },
    {
      ...prompt(7),
      note: 'Other own page (/blog/10dlc-registration-guide/) cited both times, moved from position 4 to 2'
    },
    { ...prompt(8), note: 'No AI Overview either time' },
    { ...prompt(10), note: 'No AI Overview either time' }
  ],
  fixIntro:
    'Log a fix, pick the questions it should help, and CiteFox re-checks just those questions a few days after it goes live.',
  fix1Rows: [
    {
      ...prompt(6),
      before: 'Brand mentioned',
      after: 'Page cited · 3',
      result: 'Worked'
    },
    { ...prompt(4), before: 'Not cited', after: 'Not cited', result: 'No change' },
    { ...prompt(9), before: 'Page cited · 5', after: 'Not cited', result: 'Got worse' }
  ],
  fixTargets: [prompt(4), prompt(5), prompt(1), prompt(8)],
  prompts: [
    row(1, 'Not cited', 'Not cited', 'Page cited · 2', false, false),
    row(2, 'Own page · 5', 'Own page · 4', 'Own page · 4', false, false),
    row(3, 'Page cited · 4', 'Page cited · 1', 'Page cited · 1', false, false),
    row(4, 'Not cited', 'Not cited', 'Not cited', true, true),
    row(5, 'No overview', 'Not cited', 'Brand', false, true),
    row(6, 'Not cited', 'Brand', 'Page cited · 3', true, false),
    row(7, 'Own page · 4', 'Own page · 4', 'Own page · 2', false, false),
    row(8, 'No overview', 'No overview', 'No overview', false, false),
    row(9, 'Not cited', 'Page cited · 5', 'Not cited', true, false),
    row(10, 'No overview', 'No overview', 'No overview', false, false)
  ],
  markets: [
    market('🇺🇸 US · EN', 24, 38, 50),
    market('🇺🇸 US · Austin · EN', 18, 30, 44),
    market('🇬🇧 UK · EN', 12, 12, 19),
    market('🇲🇽 MX · ES', null, 6, 6)
  ],
  rateFootnote:
    'Rate = **page cited** ÷ overviews shown. Citations = links to textbolt.com in the overview sources: 1, 2 and 3 to this page, plus 2 each time to your other pages.'
}

export function progressDetail(pageId: string): ProgressDetail | null {
  if (pageId !== 'alerts' && pageId !== 'textbolt-alerts') return null
  return SAMPLE
}
