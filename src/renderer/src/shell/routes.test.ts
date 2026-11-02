import { describe, expect, test } from 'vitest'
import {
  alertsHash,
  appSettingsHash,
  movedSettingsHash,
  projectSettingsHash,
  PAGE_TABS,
  addStartHash,
  exportHash,
  exportMarketFromHash,
  exportPageFromHash,
  landingHash,
  locationHash,
  pagesHash,
  structureHash,
  structureRedirectHash,
  templatesHash,
  isPageCurrent,
  isSectionCurrent,
  keepScreenQuery,
  pageHash,
  parseHash,
  plainLocation,
  projectHash,
  promptHash,
  readHash,
  runningHash,
  sectionTrail,
  sectionHash,
  sectionHeading,
  startHash,
  unavailableHash
} from './routes'
import { groupForLocation } from './sidebarNav'

describe('parseHash', () => {
  test('defaults an empty hash to Summary, the project landing', () => {
    expect(parseHash('')).toEqual({ kind: 'section', section: 'overview' })
    expect(parseHash('#')).toEqual({ kind: 'section', section: 'overview' })
    expect(parseHash('#/')).toEqual({ kind: 'section', section: 'overview' })
    expect(parseHash('#/overview')).toEqual({ kind: 'section', section: 'overview' })
    expect(landingHash()).toBe('#/overview')
    expect(parseHash('#/pages')).toEqual({ kind: 'section', section: 'pages' })
  })

  test('maps each shell section, including the longer project paths', () => {
    expect(parseHash('#/ask')).toEqual({ kind: 'section', section: 'ask' })
    expect(parseHash('#/structure')).toEqual({ kind: 'section', section: 'structure' })
    expect(parseHash('#/youtube')).toEqual({ kind: 'section', section: 'youtube' })
    expect(parseHash('#/reports')).toEqual({ kind: 'section', section: 'reports' })
    expect(parseHash('#/project-settings')).toEqual({
      kind: 'section',
      section: 'project-settings'
    })
    expect(parseHash('#/connections')).toEqual({ kind: 'section', section: 'connections' })
    expect(parseHash('#/settings')).toEqual({ kind: 'section', section: 'settings' })
    expect(parseHash('#/alerts')).toEqual({ kind: 'section', section: 'alerts' })
    expect(parseHash('#/alerts/email')).toEqual({
      kind: 'section',
      section: 'alerts',
      focusId: 'email'
    })
    // Alerts keeps its own query values (a rule's drawer, the log's filter, an old `?tab=`).
    expect(parseHash('#/alerts/log?log.f=r-1')).toEqual({
      kind: 'section',
      section: 'alerts',
      focusId: 'log',
      params: { 'log.f': 'r-1' }
    })
    expect(parseHash('#/alerts?tab=schedule')).toEqual({
      kind: 'section',
      section: 'alerts',
      params: { tab: 'schedule' }
    })
    expect(alertsHash()).toBe('#/alerts')
    expect(alertsHash('rules')).toBe('#/alerts')
    expect(alertsHash('notifications')).toBe('#/alerts/notifications')
    expect(alertsHash('log')).toBe('#/alerts/log')
    // Moved tabs: the old names give their one home now.
    expect(alertsHash('email')).toBe('#/settings?tab=email')
    expect(alertsHash('schedule')).toBe('#/settings?tab=general')
    expect(alertsHash('recheck')).toBe('#/project-settings?tab=schedule')
    expect(parseHash('#/templates')).toEqual({ kind: 'section', section: 'templates' })
    expect(parseHash('#/playground')).toEqual({ kind: 'section', section: 'playground' })
    expect(parseHash('#/playground/buyer-prompts')).toEqual({
      kind: 'section',
      section: 'playground',
      focusId: 'buyer-prompts'
    })
    expect(parseHash('#/projects')).toEqual({ kind: 'section', section: 'projects' })
    expect(parseHash('#/projects/new')).toEqual({ kind: 'section', section: 'new-project' })
    expect(parseHash('#/add-page')).toEqual({ kind: 'section', section: 'add-page' })
    expect(parseHash('#/add')).toEqual({ kind: 'section', section: 'add' })
    expect(parseHash('#/add/draft-1')).toEqual({
      kind: 'section',
      section: 'add',
      focusId: 'draft-1'
    })
    expect(parseHash('#/import-pages')).toEqual({ kind: 'section', section: 'import-pages' })
    expect(parseHash('#/status')).toEqual({ kind: 'section', section: 'status' })
    expect(parseHash('#/export')).toEqual({ kind: 'section', section: 'export' })
    expect(parseHash('#/check')).toEqual({ kind: 'section', section: 'check' })
  })

  test('reads a page tab and defaults a missing or unknown tab to Results', () => {
    expect(parseHash('#/pages/alerts/progress')).toEqual({
      kind: 'page',
      pageId: 'alerts',
      tab: 'progress'
    })
    expect(parseHash('#/pages/alerts')).toEqual({
      kind: 'page',
      pageId: 'alerts',
      tab: 'results'
    })
    expect(parseHash('#/pages/alerts/nope/')).toEqual({
      kind: 'page',
      pageId: 'alerts',
      tab: 'results'
    })
    expect(parseHash('#/pages/alerts/read')).toEqual({ kind: 'read', pageId: 'alerts' })
    expect(parseHash(readHash('alerts'))).toEqual({ kind: 'read', pageId: 'alerts' })
    expect(parseHash('#/pages/alerts/running')).toEqual({ kind: 'running', pageId: 'alerts' })
    expect(parseHash(runningHash('alerts'))).toEqual({ kind: 'running', pageId: 'alerts' })
  })

  test('opens "not available" for an unknown path', () => {
    expect(parseHash('#/missing')).toEqual({ kind: 'section', section: 'unavailable' })
    expect(parseHash('#/topicz')).toEqual({ kind: 'section', section: 'unavailable' })
    expect(parseHash('#/topics')).toEqual({ kind: 'section', section: 'topics' })
    expect(parseHash(unavailableHash())).toEqual({ kind: 'section', section: 'unavailable' })
    expect(parseHash(unavailableHash('project'))).toEqual({
      kind: 'section',
      section: 'unavailable',
      focusId: 'project'
    })
  })
})

describe('hashes and current state', () => {
  test('section and page hashes round-trip', () => {
    expect(parseHash(sectionHash('youtube'))).toEqual({ kind: 'section', section: 'youtube' })
    expect(parseHash(pageHash('alerts', 'gaps'))).toEqual({
      kind: 'page',
      pageId: 'alerts',
      tab: 'gaps'
    })
    expect(parseHash(pageHash('alerts'))).toEqual({
      kind: 'page',
      pageId: 'alerts',
      tab: 'results'
    })
  })

  test('marks the open section or pinned page, not both', () => {
    const section = parseHash('#/structure')
    expect(isSectionCurrent(section, 'structure')).toBe(true)
    expect(isSectionCurrent(section, 'pages')).toBe(false)
    const templates = parseHash('#/templates')
    expect(isSectionCurrent(templates, 'templates')).toBe(true)
    expect(isSectionCurrent(templates, 'project-settings')).toBe(true)
    expect(isSectionCurrent(templates, 'settings')).toBe(false)
    const playground = parseHash('#/playground/buyer-prompts')
    expect(isSectionCurrent(playground, 'playground')).toBe(true)
    expect(isSectionCurrent(playground, 'settings')).toBe(false)
    expect(isPageCurrent(section, 'alerts')).toBe(false)

    const page = parseHash('#/pages/alerts/history')
    expect(isPageCurrent(page, 'alerts')).toBe(true)
    expect(isPageCurrent(page, 'bulk')).toBe(false)
    expect(isSectionCurrent(page, 'pages')).toBe(false)

    const read = parseHash(readHash('alerts'))
    expect(isPageCurrent(read, 'alerts')).toBe(true)
    expect(isSectionCurrent(read, 'pages')).toBe(false)
    const running = parseHash(runningHash('alerts'))
    expect(isPageCurrent(running, 'alerts')).toBe(true)
    expect(isSectionCurrent(running, 'pages')).toBe(false)
    const prompt = parseHash(promptHash('alerts', 'prompt-1'))
    expect(isPageCurrent(prompt, 'alerts')).toBe(true)
    expect(isSectionCurrent(prompt, 'pages')).toBe(false)
  })

  test('reads question detail and round-trips encoded ids', () => {
    expect(promptHash('a b', 'p/1')).toBe('#/pages/a%20b/prompt/p%2F1')
    expect(parseHash(promptHash('a b', 'p/1'))).toEqual({
      kind: 'prompt',
      pageId: 'a b',
      promptId: 'p/1'
    })
    expect(parseHash('#/pages/alerts/prompt')).toEqual({
      kind: 'page',
      pageId: 'alerts',
      tab: 'results'
    })
  })

  test('uses the mock-up headings and crumbs', () => {
    expect(PAGE_TABS.map((tab) => tab.label)).toEqual([
      'Results',
      'Progress',
      'Markets',
      'Sentiment',
      'Communities',
      'Content gaps',
      'Questions',
      'Buyer profile',
      'History'
    ])
    expect(sectionHeading('add-page')).toBe('Add a page to track')
    expect(sectionHeading('export')).toBe('Export a report')
    expect(sectionTrail('connections')).toEqual({ parent: 'settings', current: 'Connections' })
    expect(sectionTrail('templates')).toEqual({
      parent: 'project-settings',
      current: 'Templates'
    })
    expect(sectionHeading('settings')).toBe('App settings')
    expect(sectionHeading('reports')).toBe('Reports')
    expect(sectionHeading('pages')).toBe('Pages')
    expect(sectionTrail('alerts')).toBeNull()
    expect(sectionHeading('alerts')).toBe('Alerts & schedules')
    const alerts = parseHash('#/alerts/email')
    expect(isSectionCurrent(alerts, 'alerts')).toBe(true)
    // Alerts has its own sidebar item (Tracking), so App settings is not current there.
    expect(isSectionCurrent(alerts, 'settings')).toBe(false)
    expect(sectionHeading('templates')).toBe('Templates')
    expect(sectionTrail('playground')).toBeNull()
    expect(sectionHeading('playground')).toBe('Playground')
    expect(sectionTrail('structure')).toEqual({ parent: 'pages', current: 'Site structure' })
    expect(sectionTrail('settings')).toBeNull()
  })

  test('a question route can pin a market and a check', () => {
    const hash = promptHash('pg 1', 'p/1', { marketId: 'mkt-uk', runId: 'run 7' })
    expect(hash).toBe('#/pages/pg%201/prompt/p%2F1?market=mkt-uk&run=run+7')
    expect(parseHash(hash)).toEqual({
      kind: 'prompt',
      pageId: 'pg 1',
      promptId: 'p/1',
      marketId: 'mkt-uk',
      runId: 'run 7'
    })
    expect(promptHash('a', 'b', { marketId: null, runId: null })).toBe('#/pages/a/prompt/b')
    expect(promptHash('a', 'b', { runId: 'r1' })).toBe('#/pages/a/prompt/b?run=r1')
  })

  test('a question route can open Edit question or Check now', () => {
    const hash = promptHash('a', 'b', { marketId: 'mkt-us', panel: 'edit' })
    expect(hash).toBe('#/pages/a/prompt/b?market=mkt-us&panel=edit')
    const parsed = parseHash(hash)
    expect(parsed).toEqual({
      kind: 'prompt',
      pageId: 'a',
      promptId: 'b',
      marketId: 'mkt-us',
      panel: 'edit'
    })
    expect(locationHash(parsed)).toBe(hash)
    expect(parseHash('#/pages/a/prompt/b?panel=recheck')).toMatchObject({ panel: 'recheck' })
    expect(parseHash('#/pages/a/prompt/b?panel=delete')).not.toHaveProperty('panel')
  })

  test('a page tab can pin a market, a check and a filter', () => {
    const hash = pageHash('pg', 'results', { runId: 'r2', marketId: 'mkt-us' })
    expect(hash).toBe('#/pages/pg/results?market=mkt-us&run=r2')
    expect(parseHash(hash)).toEqual({
      kind: 'page',
      pageId: 'pg',
      tab: 'results',
      marketId: 'mkt-us',
      runId: 'r2'
    })
    expect(parseHash(pageHash('pg', 'gaps', { filter: 'row:p1' }))).toEqual({
      kind: 'page',
      pageId: 'pg',
      tab: 'gaps',
      filter: 'row:p1'
    })
    expect(pageHash('pg', 'results', {})).toBe('#/pages/pg/results')
  })

  test('All pages, Site structure and Templates deep links', () => {
    expect(pagesHash({ preset: 'tracked', folder: '/blog', cluster: null })).toBe(
      '#/pages?preset=tracked&folder=%2Fblog'
    )
    // Callers and old links that name a preset as `view` get `preset`; List / Tree stay `view`.
    expect(pagesHash({ view: 'tracked', folder: '/blog' })).toBe(
      '#/pages?preset=tracked&folder=%2Fblog'
    )
    expect(pagesHash({ view: 'tree' })).toBe('#/pages?view=tree')
    expect(parseHash('#/pages?preset=tracked&folder=%2Fblog')).toEqual({
      kind: 'section',
      section: 'pages',
      params: { preset: 'tracked', folder: '/blog' }
    })
    expect(pagesHash()).toBe('#/pages')
    // Site structure is the Tree view of All pages.
    expect(structureHash()).toBe('#/pages?view=tree')
    expect(structureHash('silos')).toBe('#/pages?view=tree')
    expect(structureHash('clusters')).toBe('#/pages?view=tree&part=clusters')
    expect(structureHash('cl 1')).toBe('#/pages?view=tree&focus=cl+1')
    expect(structureRedirectHash('#/structure')).toBe('#/pages?view=tree')
    expect(structureRedirectHash('#/structure/groups')).toBe('#/pages?view=tree&part=groups')
    expect(structureRedirectHash('#/p/p2/structure/cl-1')).toBe(
      projectHash('p2', '#/pages?view=tree&focus=cl-1')
    )
    // A drawer the old link had open opens over the Tree view.
    expect(structureRedirectHash('#/p/p2/structure/clusters?drawer=cluster&cluster.id=cl-1')).toBe(
      projectHash('p2', '#/pages?view=tree&part=clusters&drawer=cluster&cluster.id=cl-1')
    )
    expect(parseHash('#/structure/cl-1')).toEqual({
      kind: 'section',
      section: 'structure',
      focusId: 'cl-1'
    })
    expect(parseHash('#/structure')).toEqual({ kind: 'section', section: 'structure' })
    expect(parseHash(templatesHash('tpl-1'))).toEqual({
      kind: 'section',
      section: 'templates',
      focusId: 'tpl-1'
    })
  })

  test('locationHash writes back what parseHash read', () => {
    const hashes = [
      '#/pages',
      '#/pages?preset=tracked',
      '#/pages?view=tree&part=clusters',
      '#/structure/cl-1',
      '#/templates/tpl-1',
      '#/alerts/email',
      '#/playground/run-1',
      '#/settings',
      '#/pages/pg/results?market=m1&run=r1',
      '#/pages/pg/gaps?filter=row%3Ap1',
      '#/pages/pg/read',
      '#/pages/pg/running',
      '#/pages/pg/prompt/p1?market=m2'
    ]
    for (const hash of hashes) expect(locationHash(parseHash(hash))).toBe(hash)
  })
})

describe('exportHash', () => {
  test('carries the page the user came from and still opens Export', () => {
    expect(exportHash()).toBe('#/export')
    expect(exportHash('a b')).toBe('#/export?page=a%20b')
    expect(parseHash(exportHash('a b'))).toEqual({ kind: 'section', section: 'export' })
    expect(exportPageFromHash(exportHash('a b'))).toBe('a b')
    expect(exportPageFromHash('#/export')).toBeNull()
    expect(exportPageFromHash('#/export?page=')).toBeNull()
    // The page's market rides along, so Export starts on what the page was showing.
    expect(exportHash('p1', 'mkt-uk')).toBe('#/export?page=p1&market=mkt-uk')
    expect(exportMarketFromHash(exportHash('p1', 'mkt-uk'))).toBe('mkt-uk')
    expect(exportMarketFromHash(exportHash('p1'))).toBeNull()
  })
})

describe('first-run journey routes', () => {
  test('empty states open the journey, never the bare URL form', () => {
    expect(addStartHash()).toBe('#/start')
    expect(parseHash(addStartHash())).toEqual({ kind: 'section', section: 'start' })
    expect(sectionHeading('start')).toBe('Your site')
  })

  test('every journey step has its own URL', () => {
    expect(startHash()).toBe('#/start')
    for (const step of ['choose', 'setup', 'plan', 'check', 'results'] as const) {
      expect(startHash(step)).toBe(`#/start/${step}`)
      expect(parseHash(startHash(step))).toEqual({
        kind: 'section',
        section: 'start',
        focusId: step
      })
    }
  })
})

describe('project-qualified routes', () => {
  test('parses #/p/<projectId>/… into the inner location plus its project', () => {
    expect(parseHash('#/p/p2/pages/a/results?market=m1&run=r1')).toEqual({
      kind: 'page',
      pageId: 'a',
      tab: 'results',
      marketId: 'm1',
      runId: 'r1',
      projectId: 'p2'
    })
    expect(parseHash('#/p/p2/pages/a/prompt/q')).toEqual({
      kind: 'prompt',
      pageId: 'a',
      promptId: 'q',
      projectId: 'p2'
    })
    expect(parseHash('#/p/p2/project-settings')).toEqual({
      kind: 'section',
      section: 'project-settings',
      projectId: 'p2'
    })
    expect(parseHash('#/p/p2')).toEqual({ kind: 'section', section: 'overview', projectId: 'p2' })
  })

  test('writes the project back, and round-trips', () => {
    const hashes = [
      projectHash('p 2', pageHash('a', 'history', { marketId: 'm1' })),
      projectHash('p2', promptHash('a', 'q', { runId: 'r1' })),
      projectHash('p2', runningHash('a')),
      projectHash('p2', sectionHash('project-settings')),
      projectHash('p2', structureHash('c1'))
    ]
    for (const hash of hashes) expect(locationHash(parseHash(hash))).toBe(hash)
  })

  test('plainLocation drops the project so the shell can open the inner route', () => {
    const location = parseHash('#/p/p2/pages/a/progress')
    expect(plainLocation(location)).toEqual({ kind: 'page', pageId: 'a', tab: 'progress' })
    expect(locationHash(plainLocation(location))).toBe(pageHash('a', 'progress'))
  })

  test('a page in a project is still the current page', () => {
    expect(isPageCurrent(parseHash('#/p/p2/pages/a/results'), 'a')).toBe(true)
    expect(isSectionCurrent(parseHash('#/p/p2/settings'), 'settings')).toBe(true)
  })

  test('?dialog= (the build menu) is not part of any route', () => {
    expect(parseHash('#/pages?view=tracked&dialog=reset')).toEqual(
      parseHash('#/pages?view=tracked')
    )
    expect(parseHash('#/pages?dialog=reset')).toEqual({ kind: 'section', section: 'pages' })
    expect(parseHash('#/ask?q=hi&dialog=reset')).toEqual(parseHash('#/ask?q=hi'))
    expect(parseHash('#/settings?dialog=fresh-test')).toEqual({
      kind: 'section',
      section: 'settings'
    })
    expect(parseHash('#/start/choose?dialog=reset')).toEqual(parseHash('#/start/choose'))
  })
})

describe('AI visibility sections (nav redesign)', () => {
  test('each has its own path, heading and round trip', () => {
    const sections = [
      ['overview', '#/overview', 'Summary'],
      ['questions', '#/questions', 'Questions'],
      ['competitors', '#/competitors', 'Competitors'],
      ['citations', '#/citations', 'Citations'],
      ['fixes', '#/fixes', 'Fixes'],
      ['history', '#/history', 'Check history']
    ] as const
    for (const [section, hash, heading] of sections) {
      expect(sectionHash(section)).toBe(hash)
      expect(parseHash(hash)).toEqual({ kind: 'section', section })
      expect(sectionHeading(section)).toBe(heading)
      expect(locationHash(parseHash(hash))).toBe(hash)
    }
  })

  test('their screens keep their own query on the route, without the dialog', () => {
    expect(parseHash('#/competitors?period=30d&product=p1&dialog=add-questions')).toEqual({
      kind: 'section',
      section: 'competitors',
      params: { period: '30d', product: 'p1' }
    })
    expect(locationHash(parseHash('#/fixes?status=open&fix=f1'))).toBe('#/fixes?status=open&fix=f1')
    // A project route's rewrite keeps them.
    const location = parseHash(projectHash('p2', '#/competitors?market=m1'))
    expect(locationHash(plainLocation(location))).toBe('#/competitors?market=m1')
  })

  test('project Communities keeps its section and filters on the route', () => {
    expect(sectionHash('communities')).toBe('#/communities')
    expect(sectionHeading('communities')).toBe('Communities')
    expect(sectionTrail('communities')).toEqual({ parent: 'pages', current: 'Communities' })
    expect(parseHash('#/communities')).toEqual({ kind: 'section', section: 'communities' })
    expect(parseHash('#/communities?view=reddit&market=m1&page=p1&dialog=add-questions')).toEqual({
      kind: 'section',
      section: 'communities',
      params: { view: 'reddit', market: 'm1', page: 'p1' }
    })
    expect(locationHash(parseHash('#/communities?view=reddit&market=m1'))).toBe(
      '#/communities?view=reddit&market=m1'
    )
    const location = parseHash(projectHash('p2', '#/communities?page=p1'))
    expect(locationHash(plainLocation(location))).toBe('#/communities?page=p1')
    expect(groupForLocation({ kind: 'section', section: 'communities' })).toBe('site')
    // The page tab stays where it was.
    expect(parseHash('#/pages/a/communities')).toEqual({
      kind: 'page',
      pageId: 'a',
      tab: 'communities'
    })
  })

  test('Check history keeps its filters, sort and comparison through a project route', () => {
    const hash =
      '#/history?scope=pages&market=mkt-us&status=partial&sort=date%3Aasc&compare=r1%2Cr2'
    expect(parseHash(hash)).toEqual({
      kind: 'section',
      section: 'history',
      params: {
        scope: 'pages',
        market: 'mkt-us',
        status: 'partial',
        sort: 'date:asc',
        compare: 'r1,r2'
      }
    })
    expect(locationHash(plainLocation(parseHash(projectHash('p2', hash))))).toBe(hash)
  })

  test('Scheduled reports and Templates keep their view through a project route', () => {
    expect(parseHash('#/reports?view=history')).toEqual({
      kind: 'section',
      section: 'reports',
      params: { view: 'history' }
    })
    expect(
      locationHash(plainLocation(parseHash(projectHash('p2', '#/reports?view=history'))))
    ).toBe('#/reports?view=history')
    const editor = '#/templates?view=editor&step=buyer_profile'
    expect(parseHash(editor)).toEqual({
      kind: 'section',
      section: 'templates',
      params: { view: 'editor', step: 'buyer_profile' }
    })
    expect(locationHash(plainLocation(parseHash(projectHash('p2', editor))))).toBe(editor)
    // A template id and its view both stay; the overlay dialog is not part of the route.
    const focused = parseHash('#/templates/tpl-1?view=library&dialog=add-questions')
    expect(focused).toEqual({
      kind: 'section',
      section: 'templates',
      focusId: 'tpl-1',
      params: { view: 'library' }
    })
    expect(locationHash(focused)).toBe('#/templates/tpl-1?view=library')
  })

  test('the + Add dialog rides on any route without changing it', () => {
    expect(parseHash('#/overview?dialog=add-questions')).toEqual({
      kind: 'section',
      section: 'overview'
    })
    expect(parseHash('#/pages/a/results?dialog=add-questions')).toEqual(
      parseHash('#/pages/a/results')
    )
  })
})

describe('keepScreenQuery', () => {
  test("keeps a screen's own query values the route model does not carry", () => {
    expect(
      keepScreenQuery('#/pages/p1/results', '#/p/acme/pages/p1/results?view=fixes&show=table')
    ).toBe('#/pages/p1/results?view=fixes&show=table')
  })

  test('values in the new hash win, and dropped keys are left behind', () => {
    expect(
      keepScreenQuery(
        '#/pages/p1/prompt/q1?panel=edit',
        '#/pages/p1/prompt/q1?market=m2&run=r1&panel=recheck&view=sources',
        ['market', 'run']
      )
    ).toBe('#/pages/p1/prompt/q1?panel=edit&view=sources')
  })

  test('no query on either side gives the plain hash', () => {
    expect(keepScreenQuery('#/overview', '#/p/acme/overview')).toBe('#/overview')
  })
})

describe('settings that moved to their one home', () => {
  test('old addresses open the new home, keeping the rest of the query and the project', () => {
    expect(movedSettingsHash('#/alerts/recheck')).toBe('#/project-settings?tab=schedule')
    expect(movedSettingsHash('#/alerts?tab=recheck')).toBe('#/project-settings?tab=schedule')
    expect(movedSettingsHash('#/alerts/schedule')).toBe('#/settings?tab=general')
    expect(movedSettingsHash('#/alerts?tab=schedule')).toBe('#/settings?tab=general')
    expect(movedSettingsHash('#/alerts/email?account=a1')).toBe('#/settings?tab=email&account=a1')
    expect(movedSettingsHash('#/project-settings?tab=notifications')).toBe('#/alerts/notifications')
    expect(movedSettingsHash('#/settings?tab=templates')).toBe('#/templates')
    expect(movedSettingsHash('#/settings?tab=connections')).toBe('#/settings')
    // Merged App settings tabs open the tab that holds them now.
    for (const tab of ['defaults', 'schedule', 'appearance', 'guide']) {
      expect(movedSettingsHash(`#/settings?tab=${tab}`)).toBe('#/settings?tab=general')
    }
    expect(movedSettingsHash('#/settings?tab=about')).toBe('#/settings?tab=data')
    expect(movedSettingsHash('#/p/proj-2/alerts/recheck')).toBe(
      projectHash('proj-2', '#/project-settings?tab=schedule')
    )
  })

  test('addresses that did not move stay', () => {
    for (const hash of [
      '#/alerts',
      '#/alerts/log',
      '#/alerts/notifications',
      '#/settings',
      '#/settings?tab=data',
      '#/settings?tab=general',
      '#/settings?tab=email',
      '#/project-settings?tab=schedule',
      '#/templates'
    ]) {
      expect(movedSettingsHash(hash)).toBeNull()
    }
    expect(appSettingsHash()).toBe('#/settings')
    expect(appSettingsHash('ai')).toBe('#/settings')
    expect(projectSettingsHash()).toBe('#/project-settings')
    expect(projectSettingsHash('general')).toBe('#/project-settings')
  })
})
