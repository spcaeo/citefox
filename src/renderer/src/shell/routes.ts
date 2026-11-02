import { projectRouteHash, splitProjectRoute } from '@shared/project-route'
import { screenQuery } from './drawerUrl'

export const PAGE_TABS = [
  { id: 'results', label: 'Results' },
  { id: 'progress', label: 'Progress' },
  { id: 'markets', label: 'Markets' },
  { id: 'sentiment', label: 'Sentiment' },
  { id: 'communities', label: 'Communities' },
  { id: 'gaps', label: 'Content gaps' },
  { id: 'prompts', label: 'Questions' },
  { id: 'audience', label: 'Buyer profile' },
  { id: 'history', label: 'History' }
] as const

export type PageTabId = (typeof PAGE_TABS)[number]['id']

/** A topic's views (`view=`): Tree · Grid · List · Pages, then Progress. */
export const TOPIC_TABS = ['tree', 'grid', 'list', 'pages', 'progress'] as const

export type TopicTabId = (typeof TOPIC_TABS)[number]

export function isTopicTabId(value: string | undefined | null): value is TopicTabId {
  return TOPIC_TABS.some((tab) => tab === value)
}

/** The view an old `tab=` link meant (before the views); the screen rewrites the URL. */
const OLD_TOPIC_TABS: Readonly<Record<string, TopicTabId>> = {
  todo: 'tree',
  keywords: 'tree',
  stage: 'grid',
  progress: 'progress'
}

export const PAGE_TABPANEL_ID = 'page-tabpanel'

export function pageTabDomId(tab: PageTabId): string {
  return `page-tab-${tab}`
}

export function isPageTabId(value: string | undefined): value is PageTabId {
  return PAGE_TABS.some((tab) => tab.id === value)
}

/**
 * Sidebar and shell destinations. The sidebar's groups and their order live in
 * `sidebarNav.ts`; this list also includes routes that are reached from the
 * switcher, the page header, and the + Add menu.
 */
export const SECTIONS = [
  { id: 'overview', path: '/overview', heading: 'Summary' },
  { id: 'questions', path: '/questions', heading: 'Questions' },
  { id: 'topics', path: '/topics', heading: 'Topics' },
  { id: 'competitors', path: '/competitors', heading: 'Competitors' },
  { id: 'citations', path: '/citations', heading: 'Citations' },
  { id: 'fixes', path: '/fixes', heading: 'Fixes' },
  { id: 'history', path: '/history', heading: 'Check history' },
  { id: 'ask', path: '/ask', heading: 'Ask CiteFox' },
  { id: 'pages', path: '/pages', heading: 'Pages' },
  { id: 'structure', path: '/structure', heading: 'Site structure' },
  { id: 'youtube', path: '/youtube', heading: 'YouTube' },
  { id: 'communities', path: '/communities', heading: 'Communities' },
  { id: 'reports', path: '/reports', heading: 'Reports' },
  { id: 'project-settings', path: '/project-settings', heading: 'Project settings' },
  { id: 'connections', path: '/connections', heading: 'Connections' },
  { id: 'permissions', path: '/permissions', heading: 'What CiteFox needs' },
  { id: 'settings', path: '/settings', heading: 'App settings' },
  { id: 'alerts', path: '/alerts', heading: 'Alerts & schedules' },
  { id: 'templates', path: '/templates', heading: 'Templates' },
  { id: 'playground', path: '/playground', heading: 'Playground' },
  { id: 'projects', path: '/projects', heading: 'Projects' },
  { id: 'new-project', path: '/projects/new', heading: 'New project' },
  { id: 'add', path: '/add', heading: 'Add page or topic' },
  { id: 'add-page', path: '/add-page', heading: 'Add a page to track' },
  { id: 'import-pages', path: '/import-pages', heading: 'Import pages' },
  { id: 'status', path: '/status', heading: 'Status' },
  { id: 'export', path: '/export', heading: 'Export a report' },
  { id: 'check', path: '/check', heading: 'Check now' },
  { id: 'start', path: '/start', heading: 'Your site' },
  { id: 'unavailable', path: '/unavailable', heading: 'Not available' }
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

/**
 * Where a project opens: an empty hash, `#/p/<id>`, the brand mark and the
 * project's name in a breadcrumb all land here. An unknown path opens
 * `unavailable` instead ("This page isn't available").
 */
export const LANDING_SECTION = 'overview' satisfies SectionId

/**
 * A market and a check (run) that a page tab or a prompt route can pin, so a
 * drill target opens exactly what was clicked. Absent: the page's picked
 * market and its latest check.
 */
export interface RouteScope {
  marketId?: string | null
  runId?: string | null
}

/** Panels Prompt detail opens from its route (`?panel=`). */
export type PromptPanelId = 'edit' | 'recheck'

export function isPromptPanelId(value: string | null | undefined): value is PromptPanelId {
  return value === 'edit' || value === 'recheck'
}

export type ShellRoute =
  | {
      kind: 'section'
      section: SectionId
      focusId?: string
      /** Query values, such as All pages `?view=tracked&folder=/blog`. */
      params?: Readonly<Record<string, string>>
    }
  | {
      kind: 'page'
      pageId: string
      tab: PageTabId
      marketId?: string
      runId?: string
      /** A tab-defined filter or focus, such as `row:<promptId>` on Content gaps. */
      filter?: string
    }
  | { kind: 'read'; pageId: string }
  | { kind: 'running'; pageId: string }
  | {
      kind: 'prompt'
      pageId: string
      promptId: string
      marketId?: string
      runId?: string
      /** An open panel: `edit` (Edit question) or `recheck` (Re-check now). */
      panel?: PromptPanelId
    }
  | {
      /** Topic results (§4). A topic is a `pages` row with `kind = 'topic'`. */
      kind: 'topic'
      pageId: string
      /** The view named in the URL; absent means the screen's own default (List) or the remembered one. */
      tab?: TopicTabId
      marketId?: string
      runId?: string
      /** A drill focus, such as `stage:compare`, `group:<name>`, `state:no_page` or `target:<promptId>`. */
      filter?: string
    }

/**
 * A route, optionally in a named project (`#/p/<projectId>/…`). With
 * `projectId`, the shell switches to that project first, then opens the route.
 */
export type ShellLocation = ShellRoute & { projectId?: string }

/** Sections whose path can carry one id after it: `#/<section>/<id>`. */
const FOCUS_SECTIONS = [
  'add',
  'alerts',
  'permissions',
  'playground',
  'start',
  'structure',
  'templates',
  'unavailable'
] as const

/**
 * Sections whose screen keeps its own state in the hash query, so the route
 * carries `params` and `locationHash` writes them back (a project route's
 * rewrite keeps them). All pages has its own case in `parseRoute`. A focus
 * section here (Templates) keeps both its id and its query.
 */
const PARAM_SECTIONS = [
  'ask',
  'overview',
  'questions',
  'topics',
  'competitors',
  'citations',
  'fixes',
  'history',
  'communities',
  'reports',
  'templates',
  'alerts'
] as const satisfies readonly SectionId[]

function isParamSection(section: SectionId): boolean {
  return PARAM_SECTIONS.some((item) => item === section)
}

/**
 * `?dialog=<id>` opens a window-wide dialog (the build menu's reset) over any
 * route; it is not part of the route, so screens never see it as a filter.
 */
export const OVERLAY_PARAM = 'dialog'

const SECTION_BY_PATH = new Map<string, SectionId>(
  SECTIONS.map((section) => [section.path, section.id])
)

export function sectionHash(section: SectionId): string {
  const found = SECTIONS.find((item) => item.id === section)
  return `#${found?.path ?? '/overview'}`
}

/** The project landing (Summary; its path stays `#/overview`). */
export function landingHash(): string {
  return sectionHash(LANDING_SECTION)
}

/**
 * Where every "no pages yet" empty state goes: the first-run journey
 * (`#/start`), never a blank URL box (owner feedback 4). "Add page or topic"
 * itself opens the chooser (`#/add`).
 */
export function addStartHash(): string {
  return sectionHash('start')
}

/** The first-run journey steps (focus mode). */
export const START_STEPS = ['choose', 'setup', 'plan', 'check', 'results'] as const
export type StartStep = (typeof START_STEPS)[number]

/**
 * `#/start` is "What we found"; the other steps have their own path.
 * `#/start/choose` is "How do you want to start?" (owner feedback 6).
 */
export function startHash(step?: StartStep): string {
  return step ? `#/start/${step}` : sectionHash('start')
}

/**
 * What a link that cannot open shows: `#/unavailable` for a path CiteFox does
 * not have, `#/unavailable/project` for a project this copy of CiteFox cannot
 * open (deleted, or a link from another computer). No id goes in the URL.
 */
export type UnavailableReason = 'page' | 'project'

export function unavailableHash(reason: UnavailableReason = 'page'): string {
  return reason === 'project' ? '#/unavailable/project' : sectionHash('unavailable')
}

/** A tab of Alerts: `#/alerts` is Alert rules; the others have their own path. */
export type AlertsRoutePart = 'rules' | 'notifications' | 'log'

/**
 * Alerts tabs that moved to their one home (second monday review #10): Re-check
 * is Project settings › Schedule; Check timing and Email accounts are App
 * settings tabs. `alertsHash` still takes them and returns the new home, and an
 * old `#/alerts/<part>` link redirects there (`movedSettingsHash`).
 */
export type MovedAlertsPart = 'recheck' | 'schedule' | 'email'

/** Alerts (`#/alerts`, the rules), or one of its tabs: `alertsHash('log')` is `#/alerts/log`. */
export function alertsHash(part?: AlertsRoutePart | MovedAlertsPart): string {
  if (part === 'recheck') return projectSettingsHash('schedule')
  if (part === 'schedule') return appSettingsHash('general')
  if (part === 'email') return appSettingsHash('email')
  return part === undefined || part === 'rules' ? sectionHash('alerts') : `#/alerts/${part}`
}

/** App settings tabs (`#/settings?tab=…`). The first, AI & searches, has no `tab`. */
export const APP_SETTINGS_TABS = ['ai', 'general', 'email', 'reports', 'data'] as const
export type AppSettingsTab = (typeof APP_SETTINGS_TABS)[number]

/** App settings, on a tab, with any extra query values (`account` on Email accounts). */
export function appSettingsHash(
  tab?: AppSettingsTab,
  extra: Readonly<Record<string, string | null | undefined>> = {}
): string {
  return `${sectionHash('settings')}${query({ tab: tab === 'ai' ? null : tab, ...extra })}`
}

/** Project settings tabs (`#/project-settings?tab=…`). General has no `tab`. */
export type ProjectSettingsTab =
  | 'general'
  | 'track'
  | 'markets'
  | 'schedule'
  | 'searches'
  | 'claude'
  | 'rules'
  | 'templates'
  | 'reports'
  | 'data'

export function projectSettingsHash(tab?: ProjectSettingsTab): string {
  return `${sectionHash('project-settings')}${query({ tab: tab === 'general' ? null : tab })}`
}

/** Old App settings tabs, merged into fewer: each opens the tab that holds it now. */
const MOVED_APP_SETTINGS_TABS: Readonly<Record<string, AppSettingsTab>> = {
  defaults: 'general',
  schedule: 'general',
  appearance: 'general',
  guide: 'general',
  about: 'data'
}

/**
 * Where an address of a setting that moved opens now, or null when it did not
 * move. Each setting has one home (second monday review #10):
 * - Alerts & schedules › Re-check is Project settings › Schedule;
 * - Alerts & schedules › Check timing and Email accounts are App settings tabs;
 * - Project settings › Notifications is Alerts & schedules › Notifications;
 * - App settings › Templates is the Templates screen;
 * - App settings › Connections is the AI & searches tab (keys live in Connections);
 * - App settings › Defaults, Check timing, Appearance and Guide & tips are General;
 * - App settings › About is Data & about.
 * The rest of the query comes along (`account=` on Email accounts, an open drawer).
 */
export function movedSettingsHash(hash: string): string | null {
  const { projectId, hash: plain } = splitProjectRoute(hash)
  const bare = plain.startsWith('#') ? plain.slice(1) : plain
  const [pathOnly = '', search = ''] = bare.split('?')
  const path = pathOnly.replace(/\/+$/, '')
  const tab = new URLSearchParams(search).get('tab')
  const alertsPart = path.startsWith('/alerts/')
    ? path.slice('/alerts/'.length)
    : path === '/alerts'
      ? tab
      : null
  let target: string | null = null
  if (alertsPart === 'recheck' || alertsPart === 'schedule' || alertsPart === 'email') {
    target = alertsHash(alertsPart)
  } else if (path === '/project-settings' && tab === 'notifications') {
    target = alertsHash('notifications')
  } else if (path === '/settings' && tab === 'templates') {
    target = templatesHash()
  } else if (path === '/settings' && tab === 'connections') {
    target = appSettingsHash()
  } else if (path === '/settings' && tab !== null && tab in MOVED_APP_SETTINGS_TABS) {
    target = appSettingsHash(MOVED_APP_SETTINGS_TABS[tab])
  }
  if (target === null) return null
  const next = keepScreenQuery(target, plain, ['tab'])
  return projectId === null ? next : projectHash(projectId, next)
}

/**
 * Export screen, starting on `pageId` and the market the page shows when given
 * (`#/export?page=<id>&market=<id>`), so the report counts what the page counts.
 */
export function exportHash(pageId?: string | null, marketId?: string | null): string {
  const base = sectionHash('export')
  if (!pageId) return base
  const market = marketId ? `&market=${encodeURIComponent(marketId)}` : ''
  return `${base}?page=${encodeURIComponent(pageId)}${market}`
}

/** The `market` query of an export hash. Null when there is none. */
export function exportMarketFromHash(hash: string): string | null {
  const query = hash.split('?')[1]
  if (!query) return null
  const value = new URLSearchParams(query).get('market')
  return value && value.length > 0 ? value : null
}

/** The `page` query of an export hash. Null when there is none. */
export function exportPageFromHash(hash: string): string | null {
  const query = hash.split('?')[1]
  if (!query) return null
  const value = new URLSearchParams(query).get('page')
  return value && value.length > 0 ? value : null
}

/** Hash navigation stays in the same document, which the main process allows. */
export function navigateHash(hash: string): void {
  window.location.hash = hash.startsWith('#') ? hash : `#${hash}`
}

let replacing = false

/**
 * True while `replaceHash` tells listeners about its change, so a listener can
 * tell a rewrite of the current history entry from a new entry (shell/drawers).
 */
export function isReplacingHash(): boolean {
  return replacing
}

/**
 * Replaces the current history entry with `hash` and tells listeners, so Back
 * skips a route the shell rewrote (a project route after its switch).
 */
export function replaceHash(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`
  if (window.location.hash === next) return
  window.history.replaceState(window.history.state, '', next)
  replacing = true
  try {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } finally {
    replacing = false
  }
}

/**
 * `hash` in project `projectId`: opening it switches to that project first,
 * then opens the route, in one step. Use it for every link to a page or
 * project-level screen of a project that may not be the open one.
 */
export function projectHash(projectId: string, hash: string): string {
  return projectRouteHash(projectId, hash)
}

/** The location without its project, as the shell opens it once that project is open. */
export function plainLocation(location: ShellLocation): ShellLocation {
  if (location.projectId === undefined) return location
  const rest = { ...location }
  delete rest.projectId
  return rest
}

/**
 * `next` with the query values of `current` that the route model does not
 * carry (a screen's own `view`, `show`, `panel`…), so rewriting a hash keeps
 * them. Keys in `next` win; keys in `drop` are left behind.
 */
export function keepScreenQuery(
  next: string,
  current: string,
  drop: readonly string[] = []
): string {
  const [path = '', nextSearch = ''] = next.split('?')
  const values = new URLSearchParams(nextSearch)
  const given = new Set(values.keys())
  // Append, so a repeated key (a stacked `drawer=`) keeps every value.
  new URLSearchParams(current.split('?')[1] ?? '').forEach((item, key) => {
    if (item && !given.has(key) && !drop.includes(key)) values.append(key, item)
  })
  const search = values.toString()
  return search ? `${path}?${search}` : path
}

function query(values: Readonly<Record<string, string | null | undefined>>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, value)
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

/**
 * A page tab. `marketId` and `runId` pin the market and the check (History
 * "View results" for an old check); `filter` is a tab-defined filter or focus.
 */
export function pageHash(
  pageId: string,
  tab: PageTabId = 'results',
  options: RouteScope & { filter?: string | null } = {}
): string {
  return `#/pages/${encodeURIComponent(pageId)}/${tab}${query({
    market: options.marketId,
    run: options.runId,
    filter: options.filter
  })}`
}

/** The views of All pages (`?view=`): the list grid, or the folder tree. */
export const PAGES_VIEWS = ['list', 'tree'] as const
export type PagesView = (typeof PAGES_VIEWS)[number]

export function isPagesView(value: string | null | undefined): value is PagesView {
  return PAGES_VIEWS.some((view) => view === value)
}

/**
 * All pages, optionally with grid query values such as `preset`, `folder`,
 * `cluster`, `group`. `view` is the screen view (`list` / `tree`); any other
 * `view` is a grid preset from before the Tree view and goes in `preset`, so
 * old links and callers (`{ view: 'tracked' }`) keep working.
 */
export function pagesHash(
  params: Readonly<Record<string, string | null | undefined>> = {}
): string {
  const { view, ...rest } = params
  if (view === null || view === undefined || view === '' || isPagesView(view)) {
    return `#/pages${query(params)}`
  }
  return `#/pages${query({ preset: rest.preset ?? view, ...rest })}`
}

/**
 * The parts of Site structure, which lives in All pages' Tree view now
 * (`#/pages?view=tree&part=clusters`). The old Silos tab is the tree itself.
 */
export const STRUCTURE_PARTS = ['clusters', 'groups', 'sitemaps', 'sync', 'noticed'] as const
export type StructurePart = (typeof STRUCTURE_PARTS)[number]

export function isStructurePart(value: string | null | undefined): value is StructurePart {
  return STRUCTURE_PARTS.some((part) => part === value)
}

/**
 * Site structure in All pages' Tree view: a part (`clusters`, `groups`,
 * `sitemaps`, `sync`, `noticed`), or a cluster or group id whose drawer opens
 * (`focus`). No id, or `silos`, is the folder tree itself.
 */
export function structureHash(focusId?: string): string {
  if (!focusId || focusId === 'silos') return pagesHash({ view: 'tree' })
  if (isStructurePart(focusId)) return pagesHash({ view: 'tree', part: focusId })
  return pagesHash({ view: 'tree', focus: focusId })
}

/**
 * Where an old `#/structure…` link opens now (the Site structure menu item is
 * gone). Its query comes along, so a drawer it had open (`drawer=cluster`)
 * opens over the Tree view.
 */
export function structureRedirectHash(hash: string): string {
  const { projectId } = splitProjectRoute(hash)
  const location = parseHash(hash)
  const focusId = location.kind === 'section' ? location.focusId : undefined
  const next = keepScreenQuery(structureHash(focusId), hash)
  return projectId === null ? next : projectHash(projectId, next)
}

/** Templates, optionally focused on one template id. */
export function templatesHash(templateId?: string): string {
  return templateId ? `#/templates/${encodeURIComponent(templateId)}` : sectionHash('templates')
}

/**
 * Topic results. `tab` is the view (`view=`; none means the remembered
 * one, else List); `marketId` and `runId` pin the market and check; `filter=target:<promptId>`
 * opens Change target page (older `stage:`/`state:` filters become drills).
 */
export function topicHash(
  topicId: string,
  options: RouteScope & { tab?: TopicTabId | null; filter?: string | null } = {}
): string {
  return `#/topics/${encodeURIComponent(topicId)}${query({
    view: options.tab ?? null,
    market: options.marketId,
    run: options.runId,
    filter: options.filter
  })}`
}

/**
 * Ask CiteFox scoped to one page or topic: `page` and `market` prefill the
 * filters and `q` the question. No search is ever run.
 */
export function askHash(
  options: { pageId?: string | null; marketId?: string | null; question?: string | null } = {}
): string {
  return `#/ask${query({ page: options.pageId, market: options.marketId, q: options.question })}`
}

/**
 * The Topics screen (Docs/TOPICS-SPEC.md §8), optionally with its own query values
 * such as `results=stage` or `action=rename&topic=<id>`. A topic's results are
 * `topicHash(topicId)` (`#/topics/<id>`).
 */
export function topicsHash(
  params: Readonly<Record<string, string | null | undefined>> = {}
): string {
  return `#/topics${query(params)}`
}

/** Page read is a setup step, not one of the page-detail tabs. */
export function readHash(pageId: string): string {
  return `#/pages/${encodeURIComponent(pageId)}/read`
}

/** First-check progress (FR-5.6). Not a page-detail tab. */
export function runningHash(pageId: string): string {
  return `#/pages/${encodeURIComponent(pageId)}/running`
}

/**
 * Prompt detail (FR-13). Not a page-detail tab. Without options it follows the
 * page's market picker and the latest check; `marketId` and `runId` pin them.
 * `panel` opens Edit question or Re-check now over it.
 */
export function promptHash(
  pageId: string,
  promptId: string,
  options: RouteScope & { panel?: PromptPanelId | null } = {}
): string {
  return `#/pages/${encodeURIComponent(pageId)}/prompt/${encodeURIComponent(promptId)}${query({
    market: options.marketId,
    run: options.runId,
    panel: options.panel
  })}`
}

export function sectionHeading(section: SectionId): string {
  const found = SECTIONS.find((item) => item.id === section)
  return found?.heading ?? 'Summary'
}

/** Breadcrumb parent for sections whose mock-up header has one. */
export function sectionTrail(
  section: SectionId
): { parent: 'pages' | 'settings' | 'project-settings'; current: string } | null {
  switch (section) {
    case 'structure':
      return { parent: 'pages', current: 'Site structure' }
    case 'youtube':
      return { parent: 'pages', current: 'YouTube' }
    case 'communities':
      return { parent: 'pages', current: 'Communities' }
    case 'project-settings':
      return { parent: 'pages', current: 'Project settings' }
    case 'connections':
      return { parent: 'settings', current: 'Connections' }
    case 'permissions':
      return { parent: 'settings', current: 'What CiteFox needs' }
    case 'templates':
      // Its one home is Project settings › Templates; this is the editor under it.
      return { parent: 'project-settings', current: 'Templates' }
    default:
      return null
  }
}

export function parseHash(hash: string): ShellLocation {
  const { projectId, hash: plain } = splitProjectRoute(hash)
  const route = parseRoute(plain)
  return projectId === null ? route : { ...route, projectId }
}

/**
 * A screen's own query values, or null when there are none. The overlay dialog
 * and every open drawer's values (shell/drawerUrl) are left out, so opening a
 * drawer never changes the route under it.
 */
function screenParams(values: URLSearchParams): Record<string, string> | null {
  const params: Record<string, string> = {}
  values.forEach((item, key) => {
    if (item && key !== OVERLAY_PARAM && !(key in params)) params[key] = item
  })
  return Object.keys(params).length > 0 ? params : null
}

function parseRoute(hash: string): ShellRoute {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash
  const [pathOnly = '', search = ''] = withoutHash.split('?')
  const withSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
  // The drawers' values never reach the route (a drawer's `tab` is not the page's tab).
  const values = screenQuery(new URLSearchParams(search))
  const value = (key: string): string | undefined => values.get(key) || undefined

  if (trimmed === '/') return { kind: 'section', section: LANDING_SECTION }

  if (trimmed === '/pages') {
    const params = screenParams(values)
    return params
      ? { kind: 'section', section: 'pages', params }
      : { kind: 'section', section: 'pages' }
  }

  for (const section of FOCUS_SECTIONS) {
    const path = `/${section}`
    if (trimmed === path || trimmed.startsWith(`${path}/`)) {
      const raw = trimmed === path ? '' : trimmed.slice(path.length + 1)
      const params = isParamSection(section) ? screenParams(values) : null
      return {
        kind: 'section',
        section,
        ...(raw.length > 0 ? { focusId: decodeURIComponent(raw) } : {}),
        ...(params ? { params } : {})
      }
    }
  }

  if (trimmed.startsWith('/topics/')) {
    const topicId = trimmed.split('/')[2]
    if (topicId) {
      const view = value('view')
      const old = value('tab')
      const filter = value('filter')
      const tab = isTopicTabId(view) ? view : old ? OLD_TOPIC_TABS[old] : undefined
      return {
        kind: 'topic',
        pageId: decodeURIComponent(topicId),
        ...(tab ? { tab } : {}),
        ...(value('market') ? { marketId: value('market') } : {}),
        ...(value('run') ? { runId: value('run') } : {}),
        ...(filter ? { filter } : {})
      }
    }
  }

  if (trimmed.startsWith('/pages/')) {
    const parts = trimmed.split('/')
    const pageId = parts[2]
    if (pageId) {
      const decoded = decodeURIComponent(pageId)
      const tabPart = parts[3]
      const scope = {
        ...(value('market') ? { marketId: value('market') } : {}),
        ...(value('run') ? { runId: value('run') } : {})
      }
      if (tabPart === 'read') return { kind: 'read', pageId: decoded }
      if (tabPart === 'running') return { kind: 'running', pageId: decoded }
      if (tabPart === 'prompt' && parts[4]) {
        const panel = value('panel')
        return {
          kind: 'prompt',
          pageId: decoded,
          promptId: decodeURIComponent(parts[4]),
          ...scope,
          ...(isPromptPanelId(panel) ? { panel } : {})
        }
      }
      const tab = isPageTabId(tabPart) ? tabPart : 'results'
      const filter = value('filter')
      return { kind: 'page', pageId: decoded, tab, ...scope, ...(filter ? { filter } : {}) }
    }
  }

  const section = SECTION_BY_PATH.get(trimmed)
  if (section && isParamSection(section)) {
    // These screens keep their own state on the route (Ask's `page`, `market`,
    // `q`; Competitors' `period`, `product`; Fixes' `status`, `fix`…).
    const params = screenParams(values)
    return params ? { kind: 'section', section, params } : { kind: 'section', section }
  }
  if (section) return { kind: 'section', section }
  return { kind: 'section', section: 'unavailable' }
}

/** The hash for a location. `parseHash(locationHash(location))` gives the same location. */
export function locationHash(location: ShellLocation): string {
  const hash = routeHash(location)
  return location.projectId === undefined ? hash : projectHash(location.projectId, hash)
}

function routeHash(location: ShellRoute): string {
  switch (location.kind) {
    case 'section': {
      if (location.section === 'pages') return pagesHash(location.params ?? {})
      if (location.section === 'ask' && location.params) {
        return askHash({
          pageId: location.params.page ?? null,
          marketId: location.params.market ?? null,
          question: location.params.q ?? null
        })
      }
      const base = sectionHash(location.section)
      const path = location.focusId ? `${base}/${encodeURIComponent(location.focusId)}` : base
      if (isParamSection(location.section) && location.params) {
        return `${path}${query(location.params)}`
      }
      return path
    }
    case 'page':
      return pageHash(location.pageId, location.tab, {
        marketId: location.marketId ?? null,
        runId: location.runId ?? null,
        filter: location.filter ?? null
      })
    case 'read':
      return readHash(location.pageId)
    case 'running':
      return runningHash(location.pageId)
    case 'prompt':
      return promptHash(location.pageId, location.promptId, {
        marketId: location.marketId ?? null,
        runId: location.runId ?? null,
        panel: location.panel ?? null
      })
    case 'topic':
      return topicHash(location.pageId, {
        tab: location.tab ?? null,
        marketId: location.marketId ?? null,
        runId: location.runId ?? null,
        filter: location.filter ?? null
      })
  }
}

export function isSectionCurrent(location: ShellLocation, section: SectionId): boolean {
  if (location.kind !== 'section') return false
  if (location.section === section) return true
  // Permissions opens from App settings; the Templates editor from Project settings.
  if (section === 'project-settings') return location.section === 'templates'
  return section === 'settings' && location.section === 'permissions'
}

export function isPageCurrent(location: ShellLocation, pageId: string): boolean {
  return (
    (location.kind === 'page' ||
      location.kind === 'read' ||
      location.kind === 'running' ||
      location.kind === 'prompt' ||
      location.kind === 'topic') &&
    location.pageId === pageId
  )
}
