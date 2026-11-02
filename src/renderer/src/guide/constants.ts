import { PAGE_FIX_KIND_COPY } from '@shared/page-fixes'
import { promptHash, sectionHash, topicHash, type SectionId } from '../shell/routes'
import { patchHashQuery } from '../utils/hashQuery'
import type { GuideFacts, GuideLesson, GuideScreen, GuideStep, LessonId } from './types'
import { LESSONS } from './lessons'

/** The drawer the guide opens in (`?drawer=guide`). */
export const GUIDE_DRAWER = 'guide'

/** How long a coachmark looks for its element before it says it cannot find it. */
export const ANCHOR_WAIT_MS = 3000

export { LESSONS } from './lessons'
export { EXPLAINERS } from './explainers'

/** A real element by its `data-guide` name. */
function guide(name: string): string {
  return `[data-guide="${name}"]`
}

/** A value inside a quoted CSS attribute selector. */
function quoted(value: string): string {
  return value.replace(/["\\]/gu, '\\$&')
}

/** A tab list by its accessible name. */
function tabs(label: string): string {
  return `[role="tablist"][aria-label="${label}"]`
}

/** A region (a numbers strip, a list) by its accessible name, on the screen. */
function region(label: string): string {
  return `#main section[aria-label="${label}"]`
}

function topicRoute(facts: GuideFacts): string | null {
  return facts.topic ? topicHash(facts.topic.id, { marketId: facts.topic.marketId }) : null
}

function promptRoute(facts: GuideFacts, promptId: string | null, view?: string): string | null {
  if (!facts.topic || !promptId) return null
  const hash = promptHash(facts.topic.id, promptId, { marketId: facts.topic.marketId })
  return view ? patchHashQuery(hash, { view }) : hash
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** A section with its own keys (`#/fixes?pf=<fix>`), in this order. */
function withQuery(section: SectionId, query: Readonly<Record<string, string>> = {}): string {
  const params = new URLSearchParams(query).toString()
  return params ? `${sectionHash(section)}?${params}` : sectionHash(section)
}

function fixesRoute(query: Readonly<Record<string, string>> = {}): string {
  return withQuery('fixes', query)
}

/** Any page fix to show: an improve fix first, as it has every part of the drawer. */
function anyPageFix(facts: GuideFacts): string | null {
  return facts.pageFix.improve ?? facts.pageFix.owner ?? facts.pageFix.create
}

/** The improve fix's drawer in Fixes, on its brief or its Page edits tab. */
function improveRoute(facts: GuideFacts, tab?: 'edits'): string | null {
  const id = facts.pageFix.improve
  if (id === null) return null
  return fixesRoute(tab ? { pf: id, pft: tab } : { pf: id })
}

/** Reports home in the By report view, where every report kind has a card. */
const BY_REPORT = withQuery('reports', { layout: 'reports' })
/** An open report (the Visibility report has every kind of tab). */
const OPEN_REPORT = withQuery('reports', { report: 'visibility' })
const SETTINGS_GENERAL = withQuery('settings', { tab: 'general' })
const SETTINGS_REPORTS = withQuery('settings', { tab: 'reports' })

const NOTHING_TO_FIX =
  'Nothing to fix right now. When a check finds a search you can win, a fix shows up here.'
const NO_RESULTS = 'This fills in after your first check.'

/**
 * Every step, lesson by lesson (3 to 5 each, all on the lesson's screen). Each one
 * points at a real element, found by its `data-guide` name, accessible name or id,
 * never by its visible words; a step that teaches an action completes on the real
 * thing happening (a save main records, or something the user opened).
 */
export const STEPS: readonly GuideStep[] = [
  // ---- Summary ----
  {
    id: 'summary',
    lesson: 'summary',
    screen: 'summary',
    title: 'Your headline numbers',
    body: 'How many buyer questions show an AI answer, and how often it cites you. Click any number to see the questions behind it.',
    anchor: region('Headline numbers'),
    route: () => sectionHash('overview'),
    note: (facts) => (facts.hasResults ? null : NO_RESULTS)
  },
  {
    id: 'summary-edit',
    lesson: 'summary',
    screen: 'summary',
    title: 'Arrange your Summary',
    body: 'Edit widgets lets you move, resize, add and remove the cards, each with its own engine.',
    anchor: guide('summary-edit'),
    route: () => sectionHash('overview')
  },
  {
    id: 'sidebar',
    lesson: 'summary',
    screen: 'summary',
    title: 'The menu on the left',
    body: 'AI visibility holds your results, Tracking holds history, reports and alerts. Pages and Settings sit at the bottom.',
    anchor: guide('sidebar-nav'),
    route: () => sectionHash('overview')
  },
  {
    id: 'find-anything',
    lesson: 'summary',
    screen: 'summary',
    title: 'Find anything with Ctrl+K',
    body: 'Press Ctrl+K (⌘K on a Mac) on any screen and type a screen, setting, topic or question. Try “dark mode”.',
    anchor: guide('topbar-search'),
    route: () => sectionHash('overview'),
    doneOn: ['search-used']
  },
  // ---- A topic page ----
  {
    id: 'topic-kpis',
    lesson: 'topic',
    screen: 'topic',
    title: 'How this topic is doing',
    body: 'Searches where Google cites your target page, another page of yours, someone else, or shows no AI answer. Click a count to see them.',
    anchor: guide('topic-kpis'),
    route: topicRoute
  },
  {
    id: 'topic-todo',
    lesson: 'topic',
    screen: 'topic',
    title: 'Four ways to see the searches',
    body: 'List shows every search, best chance first. Tree groups them, Grid is one table, and Pages shows which pages get cited.',
    anchor: tabs('Topic views'),
    route: topicRoute
  },
  {
    id: 'set-target-page',
    lesson: 'topic',
    screen: 'topic',
    title: 'Set your target page',
    body: 'Pick the one page that should answer this topic. CiteFox then tells you when AI answers cite that page.',
    action: 'Click Set target page and pick a page.',
    anchor: guide('topic-target-page'),
    press: 'Open it for me',
    hints: [
      {
        anchor: guide('target-pages'),
        text: 'Pick the page that should answer this topic.',
        side: 'left'
      },
      {
        anchor: guide('target-suggestions'),
        text: 'Pick one of these suggested pages. AI answers already cite them.',
        side: 'left'
      },
      {
        anchor: guide('target-save'),
        text: 'Happy with the page? Click Save target page.',
        side: 'top'
      }
    ],
    route: topicRoute,
    doneOn: ['target-page-set'],
    doneWhen: (facts) => facts.topic?.targetPage != null,
    why: (facts) =>
      facts.citesOwn > 0 && facts.topic?.targetPage == null
        ? `${plural(facts.citesOwn, 'question already cites', 'questions already cite')} your site, but this topic has no target page yet.`
        : null
  },
  {
    id: 'check-now',
    lesson: 'topic',
    screen: 'topic',
    title: 'Check again',
    body: 'Check now asks every question again and updates the numbers. It uses CiteFox credits, so use it after you change a page.',
    anchor: guide('topic-check-now'),
    route: topicRoute,
    doneOn: ['check-started']
  },
  {
    id: 'open-question',
    lesson: 'topic',
    screen: 'topic',
    title: 'Open a question',
    body: 'Each row is one question a buyer asks. Open it to see the full AI answer and every site it cites.',
    action: 'Click a question in the list.',
    anchor: '#topic-views-list',
    // The likeliest win first (the List sorts by win odds), else its top row.
    target: (facts) => [
      ...(facts.prompt
        ? [`#topic-views-list [data-line-key="row:${quoted(facts.prompt.id)}"]`]
        : []),
      '#topic-views-list [role="row"][data-row]'
    ],
    press: 'Open it for me',
    route: (facts) => {
      const hash = facts.prompt ? topicRoute(facts) : null
      return hash ? patchHashQuery(hash, { view: 'list' }) : null
    },
    doneOn: ['prompt-opened']
  },
  // ---- A question page ----
  {
    id: 'ai-answer',
    lesson: 'prompt',
    screen: 'prompt',
    title: 'The AI answer, as Google showed it',
    body: 'The answer your buyers saw. Your brand is marked in yellow, and the numbered sources are the pages it trusted.',
    anchor: 'section[aria-labelledby="pd-aio-h"]',
    route: (facts) => promptRoute(facts, facts.prompt?.id ?? null)
  },
  {
    id: 'sources-tab',
    lesson: 'prompt',
    screen: 'prompt',
    title: 'See every source',
    body: 'Sources lists each site the answer cited, what kind of site it is, and who it is to you.',
    action: 'Click the Sources tab.',
    anchor: '#pd-tabs-tab-sources',
    press: 'Open it for me',
    route: (facts) => promptRoute(facts, facts.rival?.promptId ?? facts.prompt?.id ?? null),
    doneOn: ['sources-viewed']
  },
  {
    id: 'mark-competitor',
    lesson: 'prompt',
    screen: 'prompt',
    title: 'Mark a competitor',
    body: 'Mark a rival in the sources, and CiteFox counts how often it is cited instead of you, on every question.',
    action: 'Click the competitor button on a site you compete with.',
    anchor: '[data-guide^="mark-competitor:"]',
    // The site cited most instead of you; who counts as a rival is the user's call, so no "do it for me".
    target: (facts) =>
      facts.rival ? [`[data-guide="mark-competitor:${quoted(facts.rival.domain)}"]`] : [],
    route: (facts) =>
      promptRoute(facts, facts.rival?.promptId ?? facts.prompt?.id ?? null, 'sources'),
    doneOn: ['competitor-saved'],
    why: (facts) =>
      facts.rival
        ? `${facts.rival.domain} is cited in ${plural(facts.rival.answers, 'answer', 'answers')} but is not on your competitor list.`
        : null
  },
  {
    id: 'prompt-fix-brief',
    lesson: 'prompt',
    screen: 'prompt',
    title: 'Copy the fix brief',
    body: 'Copy fix brief puts what your page needs to win this question on the clipboard, ready for a writer.',
    anchor: guide('prompt-fix-brief'),
    route: (facts) => promptRoute(facts, facts.prompt?.id ?? null),
    doneOn: ['fix-brief-copied']
  },
  // ---- What to fix ----
  {
    id: 'fixes-tabs',
    lesson: 'fixes',
    screen: 'fixes',
    title: 'Three tabs',
    body: 'What to fix is your to-do list, Changes made logs what you changed, and Did it work? gives each change a verdict.',
    anchor: tabs('Fixes views'),
    exact: true,
    route: () => fixesRoute()
  },
  {
    id: 'fix-list',
    lesson: 'fixes',
    screen: 'fixes',
    title: 'Your to-do list',
    body: 'Every search that does not cite you becomes a page fix. Each row shows how many searches it can win.',
    anchor: guide('fixes-todo'),
    exact: true,
    route: () => fixesRoute(),
    note: (facts) => (anyPageFix(facts) === null ? NOTHING_TO_FIX : null),
    why: (facts) =>
      facts.noPage
        ? `${facts.noPage.label} has no page that answers it yet. What to fix shows the page to write.`
        : null
  },
  {
    id: 'fix-kinds',
    lesson: 'fixes',
    screen: 'fixes',
    title: 'Three kinds of fix',
    body: 'Improve a page that fits, pick which of your pages owns a search, or write a new page where none answers it.',
    anchor: guide('fixes-todo'),
    exact: true,
    route: (facts) => (anyPageFix(facts) === null ? null : fixesRoute())
  },
  {
    id: 'fix-open',
    lesson: 'fixes',
    screen: 'fixes',
    title: 'Open a fix',
    body: 'A fix opens as a panel over the screen, so you keep your place. Topics and pages open the same panel.',
    action: 'Open a group, then click Get fix brief on a row.',
    anchor: guide('fixes-todo'),
    // The fix the next lesson uses, else any fix; a closed group opens first.
    target: (facts) => {
      const id = anyPageFix(facts)
      const kind = facts.pageFix.improve ? 'improve' : facts.pageFix.owner ? 'owner' : 'new'
      const group = PAGE_FIX_KIND_COPY[kind].title
      return id === null
        ? []
        : [
            `[data-guide="fix-open:${quoted(id)}"]`,
            // The closed group's whole name cell, so the ring goes round its words.
            `${guide('fixes-todo')} [role="row"]:has(button[aria-label="Open ${quoted(group)}"]) .ui-lg-tree-cell`,
            `${guide('fixes-todo')} button[aria-label="Open ${quoted(group)}"]`
          ]
    },
    press: 'Open it for me',
    exact: true,
    route: (facts) => (anyPageFix(facts) === null ? null : fixesRoute()),
    doneOn: ['page-fix-opened']
  },
  // ---- Fix a page (the page fix drawer) ----
  {
    id: 'fix-read-brief',
    lesson: 'fix-brief',
    screen: 'fixes',
    title: 'Read the brief',
    body: 'CiteFox AI writes what the page is missing, then one change per step. It takes about 15 seconds and uses no searches.',
    anchor: guide('pagefix-brief'),
    exact: true,
    layer: 'drawer',
    route: (facts) => improveRoute(facts)
  },
  {
    id: 'fix-send-brief',
    lesson: 'fix-brief',
    screen: 'fixes',
    title: 'Send it to a writer',
    body: 'Copy the brief into an email or a document for whoever edits your site.',
    action: 'Click Copy brief.',
    anchor: guide('pagefix-copy'),
    press: 'Copy it for me',
    exact: true,
    layer: 'drawer',
    route: (facts) => improveRoute(facts),
    doneOn: ['fix-brief-copied']
  },
  {
    id: 'fix-page-edits',
    lesson: 'fix-brief',
    screen: 'fixes',
    title: 'See the changes on your page',
    body: 'Page edits shows your own page with every change marked on it.',
    action: 'Click the Page edits tab.',
    anchor: guide('pagefix-tabs'),
    target: () => [`${guide('pagefix-tabs')} [role="tab"]:last-child`],
    press: 'Open it for me',
    exact: true,
    layer: 'drawer',
    route: (facts) => improveRoute(facts),
    doneOn: ['page-edits-opened']
  },
  {
    id: 'fix-review-edits',
    lesson: 'fix-brief',
    screen: 'fixes',
    title: 'Review each change',
    body: 'Struck-through text goes, yellow text is added. Keep or Undo each change, then Download the finished page.',
    anchor: guide('pagefix-edits'),
    exact: true,
    layer: 'drawer',
    route: (facts) => improveRoute(facts, 'edits')
  },
  {
    id: 'fix-published',
    lesson: 'fix-brief',
    screen: 'fixes',
    title: 'Tell CiteFox when it is live',
    body: 'Once the change is on your site, click I published this. CiteFox then checks whether it worked.',
    anchor: guide('pagefix-publish'),
    exact: true,
    layer: 'drawer',
    route: (facts) => {
      const id = anyPageFix(facts)
      return id === null ? null : fixesRoute({ pf: id })
    },
    doneOn: ['fix-logged']
  },
  // ---- Did it work? ----
  {
    id: 'work-live-since',
    lesson: 'did-it-work',
    screen: 'fixes',
    title: 'Every fix you logged',
    body: 'Live since is the day a fix went live. CiteFox checks its searches for 14 days before it gives a verdict.',
    anchor: guide('changes-ledger'),
    exact: true,
    route: () => fixesRoute({ view: 'changes' }),
    note: (facts) =>
      facts.loggedFix === null
        ? 'No fix logged yet. Click I published this on a fix, and it shows up here.'
        : null
  },
  {
    id: 'work-verdicts',
    lesson: 'did-it-work',
    screen: 'fixes',
    title: 'Worked, No change or Worse',
    body: 'Worked: more of its searches cite your page. Too early: the 14 days are not up yet.',
    anchor: `${guide('changes-ledger')} [role="columnheader"][data-col="verdict"]`,
    exact: true,
    route: () => fixesRoute({ view: 'changes' })
  },
  {
    id: 'work-detail',
    lesson: 'did-it-work',
    screen: 'fixes',
    title: 'Open a fix to see why',
    body: 'The pill gives the verdict; before and now show how many searches cited the page. Click a number to see them.',
    anchor: guide('did-it-work'),
    exact: true,
    layer: 'drawer',
    route: (facts) =>
      facts.loggedFix === null ? null : fixesRoute({ view: 'changes', row: facts.loggedFix })
  },
  // ---- Your topics ----
  {
    id: 'topics-kpis',
    lesson: 'topics',
    screen: 'topics',
    title: 'Topics at a glance',
    body: 'Which topics get the right page cited, which need work, and which improved most.',
    anchor: region('Topics summary'),
    route: () => sectionHash('topics'),
    note: (facts) => (facts.hasResults ? null : NO_RESULTS)
  },
  {
    id: 'topics-views',
    lesson: 'topics',
    screen: 'topics',
    title: 'List, Tree or Grid',
    body: 'List shows every topic, Tree groups them in folders, and Grid compares folders by result.',
    anchor: tabs('Topics views'),
    route: () => sectionHash('topics')
  },
  {
    id: 'topics-open',
    lesson: 'topics',
    screen: 'topics',
    title: 'Open a topic',
    body: 'Each topic shows one number: the right page cited, of searches with an AI answer. Click a topic to see its searches.',
    anchor: '#topics-views-list',
    route: () => sectionHash('topics')
  },
  {
    id: 'topics-new',
    lesson: 'topics',
    screen: 'topics',
    title: 'Add a topic',
    body: 'New topic groups the questions buyers ask about one theme. CiteFox can suggest the questions.',
    anchor: guide('topics-new'),
    route: () => sectionHash('topics')
  },
  // ---- Your questions ----
  {
    id: 'questions-kpis',
    lesson: 'questions',
    screen: 'questions',
    title: 'Questions at a glance',
    body: 'How many questions you track, how many show an AI answer, and how many cite you.',
    anchor: region('Questions summary'),
    route: () => sectionHash('questions'),
    note: (facts) => (facts.hasResults ? null : NO_RESULTS)
  },
  {
    id: 'questions-views',
    lesson: 'questions',
    screen: 'questions',
    title: 'Four ways to see them',
    body: 'List, Tree, Grid and Pages show the same questions, across every topic.',
    anchor: tabs('Questions views'),
    route: () => sectionHash('questions')
  },
  {
    id: 'questions-list',
    lesson: 'questions',
    screen: 'questions',
    title: 'Filter and search',
    body: 'Filter by engine or group the rows, and search on the right. Click a question to open its AI answer.',
    anchor: '#questions-views-list',
    route: () => sectionHash('questions')
  },
  {
    id: 'questions-add',
    lesson: 'questions',
    screen: 'questions',
    title: 'Add questions',
    body: 'Type your own, import a file, or let CiteFox suggest questions buyers ask.',
    anchor: guide('questions-add'),
    route: () => sectionHash('questions')
  },
  // ---- Competitors ----
  {
    id: 'competitors',
    lesson: 'competitors',
    screen: 'competitors',
    title: 'Share of citations',
    body: 'Your share of the citations in AI answers, next to your top competitor’s.',
    anchor: region('Share of citations'),
    route: () => sectionHash('competitors'),
    note: (facts) => (facts.hasResults ? null : NO_RESULTS)
  },
  {
    id: 'competitors-sites',
    lesson: 'competitors',
    screen: 'competitors',
    title: 'Every cited site',
    body: 'Each site AI answers cite, how often, and for which questions. Pin, edit or merge one from its row.',
    anchor: region('Every cited site'),
    route: () => sectionHash('competitors')
  },
  {
    id: 'competitors-add',
    lesson: 'competitors',
    screen: 'competitors',
    title: 'Add a competitor',
    body: 'Add a rival by its site, and CiteFox counts it on every question.',
    anchor: guide('competitors-add'),
    route: () => sectionHash('competitors'),
    doneOn: ['competitor-saved'],
    why: (facts) =>
      facts.rival
        ? `${facts.rival.domain} is cited in ${plural(facts.rival.answers, 'answer', 'answers')} but is not on your list.`
        : facts.competitors === 0
          ? 'You have no competitors on your list yet.'
          : null
  },
  // ---- Citations ----
  {
    id: 'citations-views',
    lesson: 'citations',
    screen: 'citations',
    title: 'Pages or List',
    body: 'Pages groups citations by your pages; List shows every cited page or domain.',
    anchor: tabs('Citations views'),
    route: () => sectionHash('citations')
  },
  {
    id: 'citations-pages',
    lesson: 'citations',
    screen: 'citations',
    title: 'Who gets cited',
    body: 'Every page AI answers cited, yours and other sites. Use it to find sites worth pitching or learning from.',
    anchor: region('Pages'),
    route: () => sectionHash('citations'),
    note: (facts) => (facts.hasResults ? null : NO_RESULTS)
  },
  {
    id: 'citations-pin',
    lesson: 'citations',
    screen: 'citations',
    title: 'Pin it to your Summary',
    body: 'This pin puts who gets cited on your Summary, so you see it every week.',
    anchor: 'button[aria-label="Pin who gets cited to Summary"]',
    route: () => sectionHash('citations')
  },
  // ---- Reports (home) ----
  {
    id: 'reports',
    lesson: 'reports',
    screen: 'reports',
    title: 'By goal or by report',
    body: 'By goal starts from a question, such as “Did our fixes work?”. By report lists every report by name.',
    anchor: tabs('Reports views'),
    route: () => sectionHash('reports'),
    note: (facts) => (facts.hasResults ? null : NO_RESULTS)
  },
  {
    id: 'report-kinds',
    lesson: 'reports',
    screen: 'reports',
    title: 'Pitch, content plan, head-to-head',
    body: 'Beside Visibility, What changed and Impact: a pitch or audit, a content plan, and you against one competitor.',
    anchor: '[data-card="pitch"]',
    exact: true,
    route: () => BY_REPORT
  },
  {
    id: 'report-schedule',
    lesson: 'reports',
    screen: 'reports',
    title: 'Download or email it',
    body: 'Each card can download the report as one file, print it, or email it on a schedule.',
    anchor: '[data-card="visibility"] [role="group"][aria-label="Report tools"]',
    exact: true,
    route: () => BY_REPORT
  },
  {
    id: 'report-open',
    lesson: 'reports',
    screen: 'reports',
    title: 'Open a report',
    body: 'Open shows the report in the app, with every number clickable.',
    action: 'Click Open on the Visibility report.',
    anchor: '[data-card="visibility"]',
    press: 'Open it for me',
    exact: true,
    route: () => BY_REPORT,
    doneOn: ['report-opened']
  },
  // ---- Read a report ----
  {
    id: 'report-tabs',
    lesson: 'report',
    screen: 'reports',
    title: 'Grouped tabs',
    body: 'One line of tabs; a tab with several parts shows small pills under it. A grey tab needs more data.',
    anchor: tabs('Report sections'),
    exact: true,
    route: () => OPEN_REPORT
  },
  {
    id: 'report-search',
    lesson: 'report',
    screen: 'reports',
    title: 'Search this report',
    body: 'Type a question, site or page to jump to where the report mentions it.',
    anchor: '[data-report] [aria-label="Search this report"]',
    exact: true,
    route: () => OPEN_REPORT
  },
  {
    id: 'report-tools',
    lesson: 'report',
    screen: 'reports',
    title: 'Take it with you',
    body: 'Download it as one file, print it as a PDF, or email it to a client on a schedule.',
    anchor: '[data-report] [role="group"][aria-label="Report tools"]',
    exact: true,
    route: () => OPEN_REPORT
  },
  {
    id: 'report-back',
    lesson: 'report',
    screen: 'reports',
    title: 'Back to every report',
    body: 'Reports, at the start of this line, takes you back to all reports.',
    anchor: '[data-report] nav[aria-label="Breadcrumb"]',
    exact: true,
    route: () => OPEN_REPORT
  },
  // ---- Check history ----
  {
    id: 'history',
    lesson: 'history',
    screen: 'history',
    title: 'Every check',
    body: 'Each check CiteFox ran, when, and what it found.',
    anchor: region('Check history'),
    route: () => sectionHash('history'),
    note: (facts) => (facts.hasResults ? null : NO_RESULTS)
  },
  {
    id: 'history-compare',
    lesson: 'history',
    screen: 'history',
    title: 'Compare two checks',
    body: 'Tick two checks, then click Compare to see what moved and why.',
    anchor: region('Check history'),
    route: () => sectionHash('history')
  },
  {
    id: 'history-export',
    lesson: 'history',
    screen: 'history',
    title: 'Export the list',
    body: 'This saves every check as a CSV file for a spreadsheet.',
    anchor: 'button[aria-label="Export CSV"]',
    route: () => sectionHash('history')
  },
  // ---- Alerts ----
  {
    id: 'alerts',
    lesson: 'alerts',
    screen: 'alerts',
    title: 'Rules, notifications, log',
    body: 'Alert rules say what to watch, Notifications how you hear, and Alert log what happened.',
    anchor: tabs('Alerts sections'),
    route: () => sectionHash('alerts')
  },
  {
    id: 'alerts-rules',
    lesson: 'alerts',
    screen: 'alerts',
    title: 'Your alert rules',
    body: 'Each rule tells you when something changes, such as a citation won or lost. Click New rule to add one.',
    anchor: region('Alert rules'),
    route: () => sectionHash('alerts'),
    doneOn: ['alert-saved']
  },
  {
    id: 'alerts-schedule',
    lesson: 'alerts',
    screen: 'alerts',
    title: 'How often CiteFox checks',
    body: 'The check schedule is in Settings › Project settings › Schedule.',
    anchor: guide('nav-settings'),
    route: () => sectionHash('alerts')
  },
  // ---- Your pages ----
  {
    id: 'pages-hub',
    lesson: 'pages',
    screen: 'pages',
    title: 'Pages, YouTube, Communities',
    body: 'Your own pages, the videos and the community threads AI answers cite, one tab each.',
    anchor: guide('hub-pages'),
    route: () => sectionHash('pages')
  },
  {
    id: 'pages-list',
    lesson: 'pages',
    screen: 'pages',
    title: 'Every page you have',
    body: 'Each page CiteFox knows and whether AI answers cite it. Track a page to start checking its questions.',
    anchor: region('Pages'),
    route: () => sectionHash('pages')
  },
  {
    id: 'pages-views',
    lesson: 'pages',
    screen: 'pages',
    title: 'List or Tree',
    body: 'Tree groups pages in folders from their addresses. Track all tracks a whole folder, new pages included.',
    anchor: tabs('Pages views'),
    route: () => sectionHash('pages')
  },
  {
    id: 'pages-add',
    lesson: 'pages',
    screen: 'pages',
    title: 'Add a page',
    body: 'Add a page by its address, and CiteFox finds the questions it should answer.',
    anchor: guide('pages-add'),
    route: () => sectionHash('pages')
  },
  // ---- Settings ----
  {
    id: 'settings-tabs',
    lesson: 'settings',
    screen: 'settings',
    title: 'App settings',
    body: 'AI & searches, General, Email, Reports and Data & about: settings for every project.',
    anchor: tabs('Settings sections'),
    exact: true,
    route: () => SETTINGS_GENERAL
  },
  {
    id: 'theme',
    lesson: 'settings',
    screen: 'settings',
    title: 'Change the look',
    body: 'Sepia is warm like paper, Light is white, Dark is easy at night, and System follows your computer.',
    action: 'Click the button, then pick a look.',
    anchor: guide('topbar-theme'),
    press: 'Show me the looks',
    exact: true,
    route: () => SETTINGS_GENERAL,
    doneOn: ['theme-changed']
  },
  {
    id: 'celebrations',
    lesson: 'settings',
    screen: 'settings',
    title: 'A small celebration',
    body: 'When a check finds your site cited for the first time, CiteFox celebrates. See it here, or turn it off.',
    action: 'Click Preview.',
    anchor: guide('celebrations-preview'),
    press: 'Play it for me',
    exact: true,
    route: () => SETTINGS_GENERAL,
    doneOn: ['celebration-previewed']
  },
  {
    id: 'settings-guide',
    lesson: 'settings',
    screen: 'settings',
    title: 'This guide',
    body: 'Restart the guide, bring the page tips back, or turn them off here.',
    anchor: guide('settings-guide'),
    exact: true,
    route: () => SETTINGS_GENERAL
  },
  // ---- Report branding ----
  {
    id: 'branding-mode',
    lesson: 'branding',
    screen: 'settings',
    title: 'Who your reports are from',
    body: 'An agency for clients, your own company, or no branding. It shows on every report, download and email.',
    anchor: '[role="radiogroup"][aria-label="Who are these reports from?"]',
    exact: true,
    route: () => SETTINGS_REPORTS
  },
  {
    id: 'branding-details',
    lesson: 'branding',
    screen: 'settings',
    title: 'Name and logo',
    body: 'Add the name, logo and contact line. Each client’s own name lives in Project settings › Reports.',
    anchor: guide('report-branding'),
    exact: true,
    route: () => SETTINGS_REPORTS
  },
  {
    id: 'branding-save',
    lesson: 'branding',
    screen: 'settings',
    title: 'Save it once',
    body: 'Save, and every project’s reports use it from then on.',
    anchor: guide('branding-save'),
    exact: true,
    route: () => SETTINGS_REPORTS
  }
]

export function lessonById(id: LessonId): GuideLesson {
  return LESSONS.find((lesson) => lesson.id === id) ?? (LESSONS[0] as GuideLesson)
}

/** The lessons on `screen`, main lesson first. */
export function lessonsOn(screen: GuideScreen): readonly GuideLesson[] {
  return LESSONS.filter((lesson) => lesson.screen === screen)
}

export function stepById(id: string | null | undefined): GuideStep | null {
  return STEPS.find((step) => step.id === id) ?? null
}

export function stepsOf(lesson: LessonId): readonly GuideStep[] {
  return STEPS.filter((step) => step.lesson === lesson)
}
