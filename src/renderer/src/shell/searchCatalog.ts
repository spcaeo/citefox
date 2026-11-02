import type { ThemePreference } from '@shared/domain'
import type { DrawerId, DrawerParamPatch } from './drawerUrl'
import { alertsHash, appSettingsHash, projectSettingsHash, sectionHash } from './routes'
import { helpEntries, REPORT_ENTRIES, REPORT_TAB_ENTRIES } from './searchCatalogReports'

/**
 * Everything Ctrl+K finds without asking main: every screen, tab and settings
 * section, each ready report with its goals and tabs, every help topic, and the
 * actions the app offers anywhere (Check now, Log a fix, the theme…). Each entry has the words people use for it ("keys", "dark mode",
 * "rivals", "how often"), so a first-time user finds it in their own words.
 * Labels never name a provider; the provider names are only search words.
 */

/** Where an entry goes: a route, a window-wide drawer over the current screen, or a look. */
export type CatalogTarget =
  { hash: string } | { drawer: DrawerId; values?: DrawerParamPatch } | { theme: ThemePreference }

export interface CatalogEntry {
  id: string
  group: 'actions' | 'screens' | 'help'
  text: string
  /** Where it lives ("Project settings"), shown beside it. */
  detail: string | null
  /** Other words for it, each a word or a short phrase. */
  words: readonly string[]
  target: CatalogTarget
}

const FIXES = sectionHash('fixes')
const REPORTS = sectionHash('reports')
const CONNECTIONS = sectionHash('connections')

const ACTIONS: readonly CatalogEntry[] = [
  {
    id: 'check-now',
    group: 'actions',
    text: 'Check now',
    detail: 'Ask the questions again',
    words: ['run', 'run check', 'recheck', 're-check', 'refresh', 'update', 'scan', 'test now'],
    target: { drawer: 'check-now' }
  },
  {
    id: 'log-fix',
    group: 'actions',
    text: 'Log a fix',
    detail: 'Tell CiteFox you changed a page',
    words: ['published', 'i changed', 'change', 'record', 'add fix', 'new fix', 'went live'],
    target: { drawer: 'fix', values: { fix: 'new' } }
  },
  {
    id: 'add-topic',
    group: 'actions',
    text: 'Add a topic',
    detail: null,
    words: ['new topic', 'create topic', 'cluster', 'theme of questions'],
    target: { drawer: 'new-topic' }
  },
  {
    id: 'add-page',
    group: 'actions',
    text: 'Add a page to track',
    detail: null,
    words: ['track page', 'new page', 'url', 'add url', 'track'],
    target: { drawer: 'track-page' }
  },
  {
    id: 'add-questions',
    group: 'actions',
    text: 'Add questions',
    detail: null,
    words: ['new question', 'prompts', 'add prompt', 'keywords', 'searches', 'import questions'],
    target: { drawer: 'add-questions' }
  },
  {
    id: 'add-competitor',
    group: 'actions',
    text: 'Add a competitor',
    detail: null,
    words: ['rival', 'rivals', 'new competitor', 'competition'],
    target: { drawer: 'competitor', values: { competitor: 'new' } }
  },
  {
    id: 'new-schedule',
    group: 'actions',
    text: 'New report schedule',
    detail: 'Reports',
    words: ['email report', 'send report', 'weekly report', 'monthly report', 'client report'],
    target: { hash: `${REPORTS}?drawer=schedule&schedule.id=new` }
  },
  {
    id: 'new-alert',
    group: 'actions',
    text: 'New alert rule',
    detail: 'Alerts & schedules',
    words: ['notify me', 'tell me', 'alert', 'notification', 'warn'],
    target: { hash: `${sectionHash('alerts')}?drawer=alert-rule&rule.id=new` }
  },
  {
    id: 'add-key',
    group: 'actions',
    text: 'Add an API key',
    detail: 'Connections',
    words: ['key', 'keys', 'api', 'token', 'credentials', 'serpapi', 'cloro', 'jina', 'claude'],
    target: { drawer: 'add-key' }
  },
  {
    id: 'add-market',
    group: 'actions',
    text: 'Add a market',
    detail: null,
    words: ['country', 'language', 'location', 'region', 'locale'],
    target: { drawer: 'add-market' }
  },
  {
    id: 'export',
    group: 'actions',
    text: 'Export a report',
    detail: null,
    words: ['pdf', 'download report', 'share', 'csv', 'print'],
    target: { hash: sectionHash('export') }
  },
  {
    id: 'guide',
    group: 'actions',
    text: 'Open the guide',
    detail: 'Getting started',
    words: ['help', 'tour', 'lesson', 'lessons', 'tutorial', 'how to', 'learn', 'onboarding'],
    target: { drawer: 'guide' }
  },
  {
    id: 'ask',
    group: 'actions',
    text: 'Ask CiteFox',
    detail: 'Ask CiteFox AI about your results',
    words: ['chat', 'assistant', 'ai', 'question', 'help me', 'explain'],
    target: { drawer: 'ask' }
  },
  ...(
    [
      ['light', 'Light', ['white', 'bright', 'day']],
      ['dark', 'Dark', ['dark mode', 'night', 'black', 'dim']],
      ['sepia', 'Sepia', ['warm', 'paper', 'beige', 'cream', 'default']],
      ['system', 'System', ['auto', 'automatic', 'match computer', 'os']]
    ] as const
  ).map(([theme, label, words]): CatalogEntry => ({
    id: `theme-${theme}`,
    group: 'actions',
    text: `Switch theme to ${label}`,
    detail: 'The look of CiteFox',
    words: ['theme', 'look', 'colours', 'colors', 'background', 'appearance', 'mode', ...words],
    target: { theme }
  }))
]

const SCREENS: readonly CatalogEntry[] = [
  {
    id: 'summary',
    group: 'screens',
    text: 'Summary',
    detail: 'AI visibility',
    words: ['home', 'overview', 'dashboard', 'start', 'score'],
    target: { hash: sectionHash('overview') }
  },
  {
    id: 'questions',
    group: 'screens',
    text: 'Questions',
    detail: 'AI visibility',
    words: ['prompts', 'searches', 'keywords', 'queries', 'all questions'],
    target: { hash: sectionHash('questions') }
  },
  {
    id: 'topics',
    group: 'screens',
    text: 'Topics',
    detail: 'AI visibility',
    words: ['clusters', 'themes', 'groups'],
    target: { hash: sectionHash('topics') }
  },
  {
    id: 'competitors',
    group: 'screens',
    text: 'Competitors',
    detail: 'AI visibility',
    words: ['rivals', 'competition', 'other brands', 'vs'],
    target: { hash: sectionHash('competitors') }
  },
  {
    id: 'citations',
    group: 'screens',
    text: 'Citations',
    detail: 'AI visibility',
    words: ['sources', 'cited pages', 'links', 'mentions', 'who is cited', 'pitch'],
    target: { hash: sectionHash('citations') }
  },
  {
    id: 'fixes',
    group: 'screens',
    text: 'Fixes · What to fix',
    detail: 'AI visibility',
    words: ['brief', 'briefs', 'fix brief', 'to do', 'todo', 'tasks', 'improve', 'page fixes'],
    target: { hash: FIXES }
  },
  {
    id: 'fixes-log',
    group: 'screens',
    text: 'Fixes · Changes made',
    detail: 'AI visibility',
    words: ['log', 'changes', 'logged fixes', 'edits', 'what i changed'],
    target: { hash: `${FIXES}?view=log` }
  },
  {
    id: 'fixes-work',
    group: 'screens',
    text: 'Fixes · Did it work?',
    detail: 'AI visibility',
    words: ['verdict', 'worked', 'impact', 'measure', 'results of fixes', 'live since'],
    target: { hash: `${FIXES}?view=changes` }
  },
  {
    id: 'fixes-round',
    group: 'screens',
    text: 'Fixes · Next round',
    detail: 'AI visibility',
    words: ['next steps', 'repeat', 'round'],
    target: { hash: `${FIXES}?view=round` }
  },
  {
    id: 'fixes-backlinks',
    group: 'screens',
    text: 'Fixes · Backlinks',
    detail: 'AI visibility',
    words: ['links', 'anchors', 'internal links'],
    target: { hash: `${FIXES}?view=backlinks` }
  },
  {
    id: 'history',
    group: 'screens',
    text: 'Check history',
    detail: 'Tracking',
    words: ['history', 'past checks', 'runs', 'compare checks', 'what changed'],
    target: { hash: sectionHash('history') }
  },
  {
    id: 'reports',
    group: 'screens',
    text: 'Reports',
    detail: 'Tracking',
    words: ['report', 'schedules', 'email report', 'scheduled reports'],
    target: { hash: REPORTS }
  },
  {
    id: 'reports-history',
    group: 'screens',
    text: 'Reports · Delivery history',
    detail: 'Tracking',
    words: ['sent', 'deliveries', 'emails sent'],
    target: { hash: `${REPORTS}?view=history` }
  },
  {
    id: 'alerts',
    group: 'screens',
    text: 'Alerts & schedules · Alert rules',
    detail: 'Tracking',
    words: ['alerts', 'notify', 'notifications', 'rules', 'warn me'],
    target: { hash: alertsHash() }
  },
  {
    id: 'alerts-notifications',
    group: 'screens',
    text: 'Alerts & schedules · Notifications',
    detail: 'Tracking',
    words: ['slack', 'email me', 'where alerts go'],
    target: { hash: alertsHash('notifications') }
  },
  {
    id: 'alerts-log',
    group: 'screens',
    text: 'Alerts & schedules · Alert log',
    detail: 'Tracking',
    words: ['sent alerts', 'alert history'],
    target: { hash: alertsHash('log') }
  },
  {
    id: 'pages',
    group: 'screens',
    text: 'Pages',
    detail: 'Pages',
    words: ['site', 'urls', 'all pages', 'sitemap', 'my pages', 'website'],
    target: { hash: sectionHash('pages') }
  },
  {
    id: 'structure',
    group: 'screens',
    text: 'Pages · Tree',
    detail: 'Pages',
    words: ['site structure', 'folders', 'tree'],
    target: { hash: `${sectionHash('pages')}?view=tree` }
  },
  {
    id: 'youtube',
    group: 'screens',
    text: 'Pages · YouTube',
    detail: 'Pages',
    words: ['videos', 'video'],
    target: { hash: sectionHash('youtube') }
  },
  {
    id: 'communities',
    group: 'screens',
    text: 'Pages · Communities',
    detail: 'Pages',
    words: ['reddit', 'forums', 'quora', 'discussions'],
    target: { hash: sectionHash('communities') }
  },
  {
    id: 'playground',
    group: 'screens',
    text: 'Playground',
    detail: 'Settings',
    words: ['try', 'test', 'sandbox', 'experiment'],
    target: { hash: sectionHash('playground') }
  },
  {
    id: 'ask-screen',
    group: 'screens',
    text: 'Ask CiteFox',
    detail: 'Full screen',
    words: ['chat', 'assistant'],
    target: { hash: sectionHash('ask') }
  },
  ...(
    [
      ['general', 'General', ['name', 'domain', 'brand', 'rename project']],
      ['track', 'What to track', ['engines', 'chatgpt', 'perplexity', 'gemini', 'ai mode']],
      ['markets', 'Markets', ['country', 'countries', 'language', 'location', 'region']],
      [
        'schedule',
        'Schedule',
        ['how often', 'often', 'frequency', 'daily', 'weekly', 'recheck', 'auto check', 'cadence']
      ],
      ['searches', 'Searches & cost', ['budget', 'cap', 'credits', 'spend', 'cost', 'limit']],
      ['claude', 'CiteFox AI', ['ai', 'model', 'ai fallback']],
      ['rules', 'Project rules', ['rules', 'instructions', 'always', 'never', 'tone', 'wording']],
      ['templates', 'Templates', ['prompt templates', 'buyer profile']],
      [
        'reports',
        'Reports',
        ['client name', 'client logo', 'prepared for', 'prepared by', 'report branding']
      ],
      ['data', 'Data', ['export project', 'archive', 'delete project', 'duplicate']]
    ] as const
  ).map(([tab, label, words]): CatalogEntry => ({
    id: `project-settings-${tab}`,
    group: 'screens',
    text: `Project settings · ${label}`,
    detail: 'Settings',
    words: ['project settings', 'settings', ...words],
    target: { hash: projectSettingsHash(tab) }
  })),
  ...(
    [
      ['ai', 'AI & searches', ['ai', 'searches', 'concurrency']],
      [
        'general',
        'General',
        ['celebrations', 'guide', 'tips', 'check time', 'sounds', 'restart guide']
      ],
      ['email', 'Email', ['smtp', 'mail', 'sending account', 'gmail']],
      [
        'reports',
        'Reports branding',
        [
          'branding',
          'logo',
          'agency logo',
          'agency',
          'white label',
          'company name',
          'prepared for',
          'who are these reports from',
          'reports'
        ]
      ],
      [
        'data',
        'Data & about',
        [
          'version',
          'about',
          'backup',
          'import settings',
          'update',
          'account',
          'my details',
          'unsubscribe',
          'privacy'
        ]
      ]
    ] as const
  ).map(([tab, label, words]): CatalogEntry => ({
    id: `app-settings-${tab}`,
    group: 'screens',
    text: `App settings · ${label}`,
    detail: 'Settings',
    words: ['app settings', 'settings', 'preferences', ...words],
    target: { hash: appSettingsHash(tab) }
  })),
  {
    id: 'connections',
    group: 'screens',
    text: 'Connections · API keys',
    detail: 'Settings',
    words: ['keys', 'key', 'api', 'api keys', 'token', 'credits', 'serpapi', 'cloro', 'jina'],
    target: { hash: CONNECTIONS }
  },
  {
    id: 'connections-ai',
    group: 'screens',
    text: 'Connections · CiteFox AI',
    detail: 'Settings',
    words: ['ai', 'connect ai', 'claude', 'anthropic', 'plan limit'],
    target: { hash: `${CONNECTIONS}?tab=claude` }
  },
  {
    id: 'connections-youtube',
    group: 'screens',
    text: 'Connections · YouTube',
    detail: 'Settings',
    words: ['youtube key', 'video key'],
    target: { hash: `${CONNECTIONS}?tab=youtube` }
  },
  {
    id: 'templates',
    group: 'screens',
    text: 'Templates',
    detail: 'Settings',
    words: ['report templates', 'email templates'],
    target: { hash: sectionHash('templates') }
  },
  {
    id: 'status',
    group: 'screens',
    text: 'Status',
    detail: 'Settings',
    words: ['health', 'searches left', 'credits left', 'problems', 'errors'],
    target: { hash: sectionHash('status') }
  },
  {
    id: 'permissions',
    group: 'screens',
    text: 'What CiteFox needs',
    detail: 'Settings',
    words: ['permissions', 'access', 'setup steps'],
    target: { hash: sectionHash('permissions') }
  },
  {
    id: 'projects',
    group: 'screens',
    text: 'Projects',
    detail: 'Every project',
    words: ['switch project', 'all projects', 'clients', 'sites'],
    target: { hash: sectionHash('projects') }
  },
  {
    id: 'new-project',
    group: 'screens',
    text: 'New project',
    detail: 'Every project',
    words: ['add project', 'create project', 'new site', 'new client'],
    target: { hash: sectionHash('new-project') }
  },
  {
    id: 'import-pages',
    group: 'screens',
    text: 'Import pages',
    detail: 'Pages',
    words: ['upload', 'csv', 'bulk pages', 'sitemap import'],
    target: { hash: sectionHash('import-pages') }
  }
]

/**
 * Every entry: actions first, then screens and settings, the reports and their goals,
 * each report's tabs (after the screens, so a screen wins a tie), then help topics.
 */
export const SEARCH_CATALOG: readonly CatalogEntry[] = [
  ...ACTIONS,
  ...SCREENS,
  ...REPORT_ENTRIES,
  ...REPORT_TAB_ENTRIES,
  ...helpEntries()
]
