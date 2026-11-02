/**
 * The help topics CiteFox ships (`Docs/help/<id>.md`), as both processes name
 * them: the ids, a fallback title for each (the file's own `title` wins when
 * it is loaded), which topic a screen's help is, and which screen a topic's
 * `screen` front matter opens. Main ranks the files' sections for Ask
 * CiteFox; the renderer links "Read more" and the screen's own topic.
 */

/** Every topic id the Guide, Ctrl+K and Ask CiteFox may link to. */
export const HELP_TOPIC_TITLES = {
  'getting-started': 'Getting started',
  summary: 'Summary',
  questions: 'Questions',
  topics: 'Topics',
  'question-page': 'A question’s page',
  competitors: 'Competitors',
  citations: 'Citations',
  fixes: 'Fixes',
  pages: 'Pages',
  history: 'Check history',
  reports: 'Reports',
  'reports-visibility': 'Visibility report',
  'reports-changed': 'What changed report',
  'reports-impact': 'Impact review',
  'reports-pitch': 'Pitch / audit',
  'reports-content': 'Content plan',
  'reports-rival': 'Head-to-head',
  'reports-branding': 'Reports branding',
  alerts: 'Alerts & schedules',
  settings: 'Settings',
  glossary: 'Words CiteFox uses'
} as const satisfies Readonly<Record<string, string>>

export type HelpTopicId = keyof typeof HELP_TOPIC_TITLES

export function isHelpTopicId(value: string): value is HelpTopicId {
  return Object.prototype.hasOwnProperty.call(HELP_TOPIC_TITLES, value)
}

/**
 * The help topic for an Ask CiteFox screen id (`overview`, `topic.todo`,
 * `page.results`, `drawer.drill`…): its own id, else its family, else
 * Getting started.
 */
const SCREEN_TOPIC: Readonly<Record<string, HelpTopicId>> = {
  overview: 'summary',
  summary: 'summary',
  questions: 'questions',
  topics: 'topics',
  topic: 'topics',
  prompt: 'question-page',
  page: 'pages',
  pages: 'pages',
  structure: 'pages',
  competitors: 'competitors',
  citations: 'citations',
  fixes: 'fixes',
  history: 'history',
  reports: 'reports',
  export: 'reports',
  alerts: 'alerts',
  settings: 'settings',
  'project-settings': 'settings',
  connections: 'settings',
  templates: 'settings',
  start: 'getting-started',
  add: 'getting-started',
  projects: 'getting-started',
  'new-project': 'getting-started'
}

export function helpTopicForScreen(screen: string): HelpTopicId {
  return SCREEN_TOPIC[screen] ?? SCREEN_TOPIC[screen.split('.')[0] ?? ''] ?? 'getting-started'
}

/**
 * The route section a topic's `screen` front matter opens, with its heading.
 * A GuideScreen id (`summary`, `topic`, `prompt`) maps to the list it lives
 * in; a section id maps to itself. Unknown screens open nothing.
 */
const SCREEN_SECTION: Readonly<Record<string, { section: string; heading: string }>> = {
  summary: { section: 'overview', heading: 'Summary' },
  overview: { section: 'overview', heading: 'Summary' },
  questions: { section: 'questions', heading: 'Questions' },
  prompt: { section: 'questions', heading: 'Questions' },
  topics: { section: 'topics', heading: 'Topics' },
  topic: { section: 'topics', heading: 'Topics' },
  competitors: { section: 'competitors', heading: 'Competitors' },
  citations: { section: 'citations', heading: 'Citations' },
  fixes: { section: 'fixes', heading: 'Fixes' },
  history: { section: 'history', heading: 'Check history' },
  pages: { section: 'pages', heading: 'Pages' },
  reports: { section: 'reports', heading: 'Reports' },
  alerts: { section: 'alerts', heading: 'Alerts & schedules' },
  settings: { section: 'settings', heading: 'App settings' },
  'project-settings': { section: 'project-settings', heading: 'Project settings' },
  connections: { section: 'connections', heading: 'Connections' }
}

export function sectionForHelpScreen(
  screen: string | null
): { section: string; heading: string } | null {
  if (screen === null) return null
  return SCREEN_SECTION[screen.trim().toLowerCase()] ?? null
}
