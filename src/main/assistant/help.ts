/**
 * What each screen is for, shipped with CiteFox, for the "how does this work"
 * answers (`assistant_help`). Short, factual, and about the app only: no
 * project data, no prices CiteFox does not set.
 */
const SCREEN_HELP: Readonly<Record<string, string>> = {
  settings:
    'App settings: the CiteFox AI model, the default schedule, data and backups, templates and About. Changes apply to every project unless a project overrides them.',
  connections:
    'Connections: the search keys that run Google searches (each search uses one CiteFox credit from the monthly allowance, with a cap per key), the CiteFox AI connection used for writing and reading (on your own AI plan, or an API key), page reading, and YouTube. A key can be tested, paused, capped or replaced. When one key runs out, CiteFox moves to the next.',
  permissions:
    'What CiteFox needs: each permission says what it is for, what happens without it, and how to grant it. CiteFox asks before it uses anything.',
  alerts:
    'Schedule & alerts: how often each page or topic is checked again (each check uses one search per question per market), and which changes send an alert (a lost citation, a new rival, a failed check) by email or in the app.',
  templates:
    'Templates: every CiteFox AI step, with its prompt. You can edit a step for the whole app or for one project, keep versions, and go back to the CiteFox default. A changed template applies from the next run.',
  playground:
    'Playground: try a template on a page or a question without saving anything, compare up to 3 templates side by side, and save a run you like.',
  'project-settings':
    "Project settings: the project's name, domain, brand names, products, competitors per product, markets (country, city and language) and schedule. Adding a market adds one search per question at every check.",
  'new-project':
    'New project: a domain and a name. CiteFox can fill the profile from the website (no searches), then you add pages or topics to track.',
  add: 'Add page or topic: track one page (its buyer questions) or a topic (one buyer problem, its questions, and the page that should be cited for each).',
  'add-page':
    'Add a page to track: paste its URL; CiteFox reads it (no search) and writes buyer questions you review before any check.',
  'import-pages':
    'Import pages: from a sitemap, a list of URLs or a CSV. Nothing is checked until you press Check now.',
  status:
    'Status: searches left this month, CiteFox AI calls, recent errors and what each connection is doing.',
  projects:
    'Projects: every project with its score, last check and searches used. Open one to work in it.',
  check:
    'Check now: pick pages, topics, questions and markets to check now. Each question in each market uses one search; the footer shows the total and what is left.',
  export:
    'Export a report: an HTML or CSV report of a page or topic for one market, from stored checks. No searches.',
  reports:
    'Scheduled reports: reports CiteFox writes and emails on a schedule, from stored checks.',
  unavailable:
    'This link opens something that is not in this copy of CiteFox, or not available to you.'
}

const DEFAULT_HELP =
  'CiteFox tracks whether Google AI Overviews cite your pages. It stores each check (one search per question per market) and every screen reads those stored checks; Ask CiteFox reads them too and never searches.'

export function screenHelp(screen: string): string {
  return SCREEN_HELP[screen] ?? SCREEN_HELP[screen.split('.')[0] ?? ''] ?? DEFAULT_HELP
}
