import type {
  AssistDescribeRequest,
  AssistDescription,
  AssistItem,
  AssistLabel,
  AssistResult,
  AssistRunRequest
} from '@shared/ipc'
import { MOCK_PACE_STORAGE_KEY } from '../onboarding/flags'
import { fallbackAssistTitle } from './model'
import { playMockSteps } from './progress'

/**
 * Canned TextBolt answers for the dev harness and the mock e2e build.
 * Never a release build: `client.ts` loads this module behind the mock guard.
 */

interface Canned {
  seconds: number
  summary: string | null
  items: readonly Omit<AssistItem, 'id'>[]
  caution: string | null
}

function item(
  text: string,
  detail: string | null = null,
  tag: string | null = null,
  verify: string | null = null,
  sign: AssistItem['sign'] = null
): Omit<AssistItem, 'id'> {
  return { text, detail, tag, verify, sign }
}

const CANNED: Readonly<Record<string, Canned>> = {
  'page.shorterTitle': {
    seconds: 6,
    summary:
      'Three options under 60 characters that keep "No Developer" in view. The H1 can stay long; only the title tag needs to be short.',
    items: [
      item(
        'Business Text Alerts From Email, No Developer Needed',
        '52 characters · leads with the product'
      ),
      item(
        'Send Scheduled Text Alerts From Email (No Developer)',
        '51 characters · keeps scheduling first'
      ),
      item(
        'Text Alerts for Business: No Developer, No New App',
        '50 characters · matches buyer wording'
      )
    ],
    caution: null
  },
  'page.promises': {
    seconds: 8,
    summary:
      'Summarized from the title, meta description, H1 and body. The buyer profile and questions are written from these three promises.',
    items: [
      item(
        'Business text alerts',
        'Get urgent updates to staff and customers as SMS instead of emails nobody reads in time.'
      ),
      item(
        'Scheduled alerts sent from email',
        'Write the alert in Gmail, Outlook or any tool that already sends email, and pick when it goes out.'
      ),
      item('No developer needed', 'No API, no code, nothing new for staff to install.')
    ],
    caution: null
  },
  'page.checkFacts': {
    seconds: 20,
    summary: '2 things to fix',
    items: [
      item(
        'A standard SMS holds 160 GSM characters, not 155',
        'The page says "155 characters" in Step 3 and again in Best practices.'
      ),
      item(
        'The carrier section the intro promises is missing',
        'The intro says the page covers which carrier gateways no longer work. There is no section for it.',
        null,
        "Verizon's vtext.com shutdown date [March 31, 2027]"
      )
    ],
    caution: 'Dates such as carrier shutdowns cannot be confirmed from the page alone.'
  },
  'page.verifyClaims': {
    seconds: 60,
    summary: '1 wrong, 1 to update, 1 confirmed',
    items: [
      item(
        'A standard SMS holds 155 GSM characters',
        'A single SMS holds 160 GSM-7 characters (70 with Unicode). Long messages split into 153-character parts.',
        'wrong',
        'https://en.wikipedia.org/wiki/SMS https://www.twilio.com/docs/glossary/what-sms-character-limit'
      ),
      item(
        'Verizon is shutting down vtext.com',
        'Verizon has announced the vtext.com email-to-text gateway shutdown; check the date on its notice.',
        'outdated',
        'https://www.verizon.com/support/'
      ),
      item(
        'Carrier email-to-text gateways are not built for business alerts',
        'Carriers describe them as person-to-person services with no delivery guarantee.',
        'confirmed',
        'https://www.fcc.gov/'
      )
    ],
    caution: 'Web results change. Open each source before you edit the page.'
  },
  'audience.triggers': {
    seconds: 10,
    summary: '3 named events from the page',
    items: [
      item(
        'Verizon announces its vtext.com email-to-text gateway is shutting down',
        'Alerts sent to @vtext.com addresses will stop arriving, so they need a replacement now.',
        'Step 5'
      ),
      item(
        'A WIN-911 alarm email sat unread overnight and nobody was paged',
        'A missed plant alarm is the moment they look for alerts that reach a phone.',
        'Use case: SCADA and alarm alerts'
      ),
      item(
        'Staff miss a same-day schedule change sent by email',
        'They want the change to arrive as a text from the tool they already use.',
        'Use case: staff scheduling'
      )
    ],
    caution: null
  },
  'audience.sharpen': {
    seconds: 15,
    summary: '4 changes',
    items: [
      item(
        'MSP owners, service-desk leads and IT leads',
        'Adds MSP owners next to IT leads.',
        'who'
      ),
      item('A client server went down overnight and the alert email sat unread.', null, 'triggers'),
      item('Works with the monitoring and RMM tools they already run.', null, 'values')
    ],
    caution: null
  },
  'prompts.more': {
    seconds: 12,
    summary:
      '3 more in the same voice, from the buyer profile trigger events and objections. None name a brand.',
    items: [
      item(
        'Our monitoring tool only sends email and my on-call tech sleeps through it. How do I turn those emails into texts without code?',
        null,
        'Problem'
      ),
      item(
        'I run a small cleaning company and want to text crews tomorrow’s schedule the night before from Outlook. What is the simplest way?',
        null,
        'Solution'
      ),
      item(
        'Is an email-to-SMS gateway reliable enough for urgent staff alerts, or do I need a paging tool?',
        null,
        'Evaluation'
      )
    ],
    caution: null
  },
  'prompts.rephrase': {
    seconds: 6,
    summary: 'Two ways a buyer might really ask this.',
    items: [
      item(
        'How do I text my field techs early Saturday morning with a message I write on Friday, without an app?'
      ),
      item('Can I schedule a text to my weekend crew from my email so it goes out at 6 a.m.?')
    ],
    caution: null
  },
  'prompts.checkPage': {
    seconds: 25,
    summary: 'The page already answers 5 of 10 questions well.',
    items: [
      item(
        'Questions 2, 3, 7, 9, 10',
        'Answered under a heading, step or FAQ that matches.',
        'Strong'
      ),
      item(
        'Questions 1, 4, 6, 8',
        'Covered, but the buyer has to piece the answer together.',
        'Partial'
      ),
      item('Question 5', 'One clause in the carrier FAQ. Highest priority.', 'Weak')
    ],
    caution: null
  },
  'gaps.draftFix': {
    seconds: 12,
    summary: 'Written in the page’s own voice, with where each piece goes.',
    items: [
      item(
        'The people you text do not install anything either. They get a normal SMS on the phone they already have.',
        'Add at the end of the FAQ "Can I set up text alerts without writing any code?"',
        'Existing FAQ'
      ),
      item(
        'How can I send text alerts to employees without hiring a developer or adding a new app?',
        'Use an email-to-SMS gateway. You send an email to each employee’s gateway address and they receive a standard text message. Plans start at [$29] a month.',
        'New FAQ',
        'The plan price [$29] a month'
      )
    ],
    caution: 'Re-check the price in brackets before you publish.'
  },
  'results.explainChange': {
    seconds: 6,
    summary:
      'The score went from 38 to 50 because the page earned 3 more points out of 24 possible.',
    items: [
      item('Question 1: Not cited → Page cited at position 2', 'It was not a fix target.', '+3'),
      item('Question 6: Brand mentioned → Page cited at position 3', 'A Fix 1 target.', '+2'),
      item(
        'Question 9: Page cited at position 5 → Not cited',
        'Two other sites are cited now.',
        '−3'
      )
    ],
    caution:
      'The page changed between these checks. CiteFox shows both facts side by side; it cannot tell you the edit caused the change.'
  },
  'results.topActions': {
    seconds: 8,
    summary: 'Three changes most likely to win more citations, from this run.',
    items: [
      item(
        'Add a FAQ on the vtext.com shutdown',
        'Question 5 has an overview but no answer on the page.',
        'Question 5'
      ),
      item(
        'Shorten the title tag',
        'The part that matches buyers is cut off in results.',
        'Page-wide'
      ),
      item('Add the carrier migration step', 'Question 4 asks how to switch.', 'Question 4')
    ],
    caution: null
  },
  'results.whyNotFirst': {
    seconds: 8,
    summary:
      'Position 1 goes to a page that answers this exact question under a matching heading. Your page answers it too, but in pieces.',
    items: [
      item('The overview’s first sentence says staff need no new app. Your page only implies it.'),
      item('No heading or FAQ asks the question the way a buyer does.'),
      item('Your title is cut around 60 characters, so the matching part does not show.')
    ],
    caution:
      'Google does not publish how it orders sources. This is a read of the pages and the overview, not a guarantee.'
  },
  'results.overviewRead': {
    seconds: 12,
    summary:
      'The overview offers TextBolt as one drop-in middleware option, after the API routes it recommends first.',
    items: [
      item('neutral', 'How it works: You subscribe to a service like TextBolt or .', 'tone'),
      item(
        'Twilio earns the API row with low per-message cost and open-source library support.',
        'Very low per-message cost; robust open-source library support',
        'competitor: Twilio'
      ),
      item(
        'Add a Koha setup section that shows the routing domain step by step.',
        'They give you a unique routing domain.',
        'action'
      ),
      item(
        'Answer the AT&T shutdown in the first paragraph and name TextBolt there.',
        'The permanent shutdown of AT&T’s email-to-text gateway',
        'action'
      ),
      item('Add 10DLC compliance to the setup steps.', 'github.com', 'action')
    ],
    caution: 'Confidence: medium. One sample, and the search data left a name out.'
  },
  'report.summary': {
    seconds: 7,
    summary:
      'Google showed an AI Overview for 8 of 10 questions. This page was cited in 3, up from 2 last time.',
    items: [
      item('Gained question 1 and question 6'),
      item('Lost question 9 to two competitors'),
      item('Question 5 is the biggest open gap')
    ],
    caution: null
  },
  'progress.nextFix': {
    seconds: 7,
    summary: 'CiteFox AI read the gap analysis and this check.',
    items: [
      item(
        'Add a FAQ on the Verizon vtext.com shutdown',
        'The deadline is live and the page has only one clause on it.',
        'Question 5',
        'The shutdown date [March 31, 2027]'
      ),
      item('Add the migration step to the setup section', null, 'Question 4'),
      item(
        'Wait one more check before changing the Saturday section',
        'Its coverage is Strong.',
        'Question 9'
      )
    ],
    caution: null
  },
  'progress.otherMarkets': {
    seconds: 5,
    summary: 'Question 6 moved in both US markets. Nothing moved in the UK.',
    items: [
      item('US · EN: Brand → Page cited · 3', null, 'Question 6'),
      item('UK · EN: Not cited, no change', null, 'Question 6')
    ],
    caution: 'This is a pattern across two checks, not proof the edit caused it.'
  },
  'progress.draftFix': {
    seconds: 7,
    summary: 'A short plan you can edit before saving.',
    items: [
      item(
        'Add a FAQ on the vtext.com shutdown and the migration step',
        'Targets questions 4 and 5.',
        null,
        'The shutdown date [March 31, 2027]'
      )
    ],
    caution: null
  },
  'fixes.recoveryPlan': {
    seconds: 12,
    summary: 'The rewrite dropped two broad sections. The questions it lost lived there.',
    items: [
      item(
        'Bring back the comparison section, written for today’s page',
        'Covers 2 lost questions.'
      ),
      item('Link the moved questions to the pages that took them', 'So the site keeps both.'),
      item('Re-check the lost questions at the next scheduled check')
    ],
    caution: null
  },
  'markets.suggest': {
    seconds: 6,
    summary: 'From your buyer profile and these results.',
    items: [
      item(
        '🇨🇦 CA · EN',
        'Same carriers moved off email-to-text, and buyers ask in English.',
        'Country'
      ),
      item('🇺🇸 US · Chicago · EN', 'Field-service buyers search with the city name.', 'City')
    ],
    caution: 'Each market adds 10–20 searches per check.'
  },
  'markets.localPrompts': {
    seconds: 12,
    summary: 'Written for this market from the buyer profile, not translated word for word.',
    items: [
      item(
        'How can I text my crews in Chicago early Saturday with a message I write on Friday?',
        'Adds the city where a local buyer would.'
      ),
      item('Which email-to-text gateways still work after the carrier shutdowns?', null)
    ],
    caution: null
  },
  'markets.whatsDifferent': {
    seconds: 6,
    summary: 'Google answers the same questions from different sources here.',
    items: [
      item('UK overviews cite UK SMS providers', 'Your page is a US page, so it rarely matches.'),
      item('Two questions show no overview here', null)
    ],
    caution: null
  },
  'status.explainUsage': {
    seconds: 4,
    summary: 'You have used 1,258 shared searches in 19 days, about 66 a day.',
    items: [
      item('At this pace you will use about 2,050 by the end of the month, under your 5,250.'),
      item(
        'CiteFox AI made 31 calls today. CiteFox AI does not report how much of your plan is left.'
      )
    ],
    caution: null
  },
  'status.explainErrors': {
    seconds: 4,
    summary: 'One recent problem, already resolved.',
    items: [
      item(
        'The search service paused the main key for 3 minutes',
        'CiteFox moved 18 searches to the backup key.',
        'Resolved'
      )
    ],
    caution: null
  },
  'template.improve': {
    seconds: 10,
    summary: 'Two line changes.',
    items: [
      item('Never name a brand in a question.', null, null, null, 'add'),
      item('Write exactly 10 questions.', null, null, null, 'remove')
    ],
    caution: null
  },
  'communities.reply': {
    seconds: 10,
    summary: 'Draft reply for r/sysadmin',
    items: [
      item(
        'Point the alarm panels at a business text address instead of @vtext.com. The panels keep sending email as they do now, and each email arrives as a normal text on any carrier. Send one test alert to each phone before the shutdown date.',
        null,
        'answer',
        "Check Verizon's current vtext.com shutdown date before posting."
      ),
      item(
        'Full disclosure: I work at TextBolt, which does this. Setup steps: https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
        null,
        'disclosure'
      )
    ],
    caution: "Read the subreddit's rules on self-promotion before you post."
  }
}

const GENERIC: Canned = {
  seconds: 6,
  summary: 'Here is what CiteFox AI found in your saved data.',
  items: [item('A sample suggestion from the mock assist.')],
  caution: null
}

function cannedFor(assistId: string): Canned {
  return CANNED[assistId] ?? GENERIC
}

function labelFor(seconds: number): AssistLabel {
  return {
    connection: 'claude-code',
    connectionText: 'CiteFox AI · on your plan',
    expectedSeconds: seconds,
    text: `CiteFox AI · on your plan · about ${seconds} s`
  }
}

function readPace(fallback: number): number {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(MOCK_PACE_STORAGE_KEY)
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

let runCount = 0

export async function describeMockAssist(
  request: AssistDescribeRequest
): Promise<AssistDescription> {
  const canned = cannedFor(request.assistId)
  return {
    assistId: request.assistId,
    title: fallbackAssistTitle(request.assistId),
    label: labelFor(canned.seconds),
    savedDataOnly: true,
    searchCost: 0,
    acceptsInstruction: true
  }
}

export async function runMockAssist(request: AssistRunRequest): Promise<AssistResult> {
  const canned = cannedFor(request.assistId)
  // The same live steps main pushes, spread over the mock pace.
  const ms = readPace(0)
  await playMockSteps({
    channel: 'assist:run',
    scope: request.assistId,
    steps: [
      {
        kind: 'read',
        label: 'Reading your saved data',
        doneDetail: 'No new searches',
        ms: ms * 0.2
      },
      {
        kind: 'claude',
        label: 'Asking CiteFox AI',
        ms: ms * 0.7,
        claude: {
          connection: 'claude-code',
          connectionText: 'CiteFox AI · on your plan',
          model: null
        }
      },
      { kind: 'check', label: 'Checking the answer', ms: ms * 0.1 },
      {
        kind: 'result',
        label: `${canned.items.length} ${canned.items.length === 1 ? 'suggestion' : 'suggestions'} ready`,
        ms: 0
      }
    ]
  })
  runCount += 1
  const runId = `mock-run-${runCount}`
  const instruction = request.instruction?.trim() ?? ''
  return {
    runId,
    assistId: request.assistId,
    title: fallbackAssistTitle(request.assistId),
    summary:
      instruction.length > 0 && canned.summary
        ? `${canned.summary} Changed for: "${instruction}".`
        : canned.summary,
    items: canned.items.map((entry, index) => ({ ...entry, id: `${runId}-${index + 1}` })),
    caution: canned.caution,
    label: labelFor(canned.seconds),
    savedDataOnly: true,
    searchesUsed: 0,
    durationMs: canned.seconds * 1000,
    model: null
  }
}
