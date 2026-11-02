import { describe, expect, test } from 'vitest'
import { HELP_TOPIC_IDS } from '@shared/help'
import { REPORT_KINDS, REPORT_TITLES, TAB_GROUPS } from '@shared/report/review'
import { SEARCH_CATALOG } from './searchCatalog'
import { findCatalog, findData, queryWords, scoreEntry, type SearchData } from './searchRank'

const HERE = '#/topics/t1?view=list'

type Group = 'actions' | 'screens' | 'help'

function first(query: string, group: Group): string | undefined {
  return findCatalog(query, HERE)[group][0]?.text
}

function texts(query: string, group: Group): string[] {
  return findCatalog(query, HERE)[group].map((option) => option.text)
}

describe('Ctrl+K catalog', () => {
  test('every screen and settings section is there, each with a link', () => {
    const names = SEARCH_CATALOG.map((entry) => entry.text)
    for (const name of [
      'Summary',
      'Questions',
      'Topics',
      'Competitors',
      'Citations',
      'Fixes · What to fix',
      'Fixes · Changes made',
      'Fixes · Did it work?',
      'Check history',
      'Reports',
      'Alerts & schedules · Alert rules',
      'Pages',
      'Pages · YouTube',
      'Pages · Communities',
      'Playground',
      'Project settings · Schedule',
      'Project settings · Markets',
      'App settings · Email',
      'Connections · API keys',
      'Check now',
      'Log a fix',
      'Add a topic',
      'Add a page to track',
      'Add questions',
      'Open the guide',
      'Ask CiteFox',
      'Switch theme to Light',
      'Switch theme to Dark',
      'Switch theme to Sepia',
      'Switch theme to System'
    ]) {
      expect(names).toContain(name)
    }
    for (const entry of SEARCH_CATALOG) {
      const target = entry.target
      expect('hash' in target || 'drawer' in target || 'theme' in target, entry.id).toBe(true)
      if ('hash' in target) expect(target.hash.startsWith('#/'), entry.id).toBe(true)
    }
    expect(new Set(SEARCH_CATALOG.map((entry) => entry.id)).size).toBe(SEARCH_CATALOG.length)
  })

  test('labels never name a provider; their names only find the right screen', () => {
    for (const entry of SEARCH_CATALOG) {
      expect(`${entry.text} ${entry.detail ?? ''}`).not.toMatch(
        /cloro|serpapi|claude|jina|anthropic/iu
      )
    }
    expect(first('serpapi', 'screens')).toBe('Connections · API keys')
    expect(first('claude', 'screens')).toBe('Connections · CiteFox AI')
  })

  test('everyday words find the right place', () => {
    expect(first('keys', 'screens')).toBe('Connections · API keys')
    expect(first('api', 'actions')).toBe('Add an API key')
    expect(first('dark mode', 'actions')).toBe('Switch theme to Dark')
    expect(first('sepia', 'actions')).toBe('Switch theme to Sepia')
    expect(texts('background', 'actions')).toEqual([
      'Switch theme to Light',
      'Switch theme to Dark',
      'Switch theme to Sepia',
      'Switch theme to System'
    ])
    expect(first('theme', 'actions')).toMatch(/^Switch theme to/u)
    expect(first('brief', 'screens')).toBe('Fixes · What to fix')
    expect(first('to do', 'screens')).toBe('Fixes · What to fix')
    expect(first('rivals', 'screens')).toBe('Competitors')
    expect(first('schedule', 'screens')).toBe('Project settings · Schedule')
    expect(first('how often', 'screens')).toBe('Project settings · Schedule')
    for (const word of ['help', 'tour', 'lesson', 'open the guide']) {
      expect(first(word, 'actions'), word).toBe('Open the guide')
    }
    expect(first('check now', 'actions')).toBe('Check now')
    expect(first('competitors', 'screens')).toBe('Competitors')
    expect(first('did it work', 'screens')).toBe('Fixes · Did it work?')
  })

  test('the start of a word is enough; a word that fits nothing finds nothing', () => {
    expect(first('comp', 'screens')).toBe('Competitors')
    expect(first('sett sched', 'screens')).toBe('Project settings · Schedule')
    expect(findCatalog('zzqx', HERE)).toEqual({ actions: [], screens: [], help: [] })
    expect(queryWords('open the guide')).toEqual(['guide'])
    expect(queryWords('to do')).toEqual(['to', 'do'])
    expect(scoreEntry('', { text: 'Summary' })).toBe(0)
  })

  test('a drawer action opens over the screen open now; a look has no link', () => {
    const check = findCatalog('check now', HERE).actions[0]
    expect(check?.href).toBe('#/topics/t1?view=list&drawer=check-now')
    const guide = findCatalog('tour', HERE).actions[0]
    expect(guide?.href).toBe('#/topics/t1?view=list&drawer=guide')
    const dark = findCatalog('dark mode', HERE).actions[0]
    expect(dark?.theme).toBe('dark')
    expect(dark?.href).toBe('')
    expect(findCatalog('keys', HERE).screens[0]?.href).toBe('#/connections')
  })
})

describe('Ctrl+K reports, settings and help', () => {
  const byText = (text: string): (typeof SEARCH_CATALOG)[number] | undefined =>
    SEARCH_CATALOG.find((entry) => entry.text === text)
  const hashOf = (text: string): string | undefined => {
    const target = byText(text)?.target
    return target && 'hash' in target ? target.hash : undefined
  }

  test('every report kind, its grouped tabs and their pills open the report on that tab', () => {
    for (const kind of REPORT_KINDS) {
      expect(hashOf(REPORT_TITLES[kind]), kind).toBe(`#/reports?report=${kind}`)
    }
    for (const [kind, groups] of Object.entries(TAB_GROUPS)) {
      const title = REPORT_TITLES[kind as keyof typeof REPORT_TITLES]
      for (const group of groups ?? []) {
        expect(hashOf(`${title} · ${group.title}`), group.id).toBe(
          `#/reports?report=${kind}&section=${group.sections[0]}`
        )
      }
    }
    expect(hashOf('Visibility report · Reputation & sources › Backlinks')).toBe(
      '#/reports?report=visibility&section=backlinks'
    )
    expect(hashOf('Impact review · Client asks › Not indexed')).toBe(
      '#/reports?report=impact&section=notindexed'
    )
    expect(hashOf('Content plan · Plan')).toBe('#/reports?report=content&section=writeplan')
    expect(hashOf('Pitch / audit · Summary')).toBe('#/reports?report=pitch&section=summary')
    // A tab named like its report is the report itself, never listed twice.
    expect(byText('Head-to-head · Head-to-head')).toBeUndefined()
  })

  test('the Reports goals and views, and every settings tab with Reports branding', () => {
    expect(hashOf('Where do we stand?')).toBe('#/reports?report=visibility&section=standing')
    expect(hashOf('Pitch a new client')).toBe('#/reports?report=pitch')
    expect(hashOf('What should we write next?')).toBe('#/reports?report=content')
    expect(hashOf('Us vs one competitor')).toBe('#/reports?report=rival')
    expect(hashOf('What changed?')).toBe('#/reports?report=changed')
    expect(hashOf('Did our fixes work?')).toBe('#/reports?report=impact')
    expect(hashOf('Reports · By report')).toBe('#/reports?layout=reports')
    expect(hashOf('Reports · Scheduled emails')).toBe('#/reports?tab=emails')
    expect(hashOf('App settings · Reports branding')).toBe('#/settings?tab=reports')
    expect(hashOf('Project settings · Reports')).toBe('#/project-settings?tab=reports')
    for (const tab of ['AI & searches', 'General', 'Email', 'Data & about']) {
      expect(byText(`App settings · ${tab}`), tab).toBeDefined()
    }
  })

  test('every help topic is there and opens the help drawer over the screen open now', () => {
    const help = SEARCH_CATALOG.filter((entry) => entry.group === 'help')
    expect(help.map((entry) => entry.id).sort()).toEqual(
      HELP_TOPIC_IDS.map((id) => `help-${id}`).sort()
    )
    const branding = findCatalog('agency logo', HERE).help[0]
    expect(branding?.text).toBe('Reports branding')
    expect(branding?.href).toBe('#/topics/t1?view=list&drawer=help&help.id=reports-branding')
  })

  test('ranks a screen first, then the report and its tabs; help answers questions', () => {
    expect(first('questions', 'screens')).toBe('Questions')
    expect(first('competitors', 'screens')).toBe('Competitors')
    expect(first('pages', 'screens')).toBe('Pages')
    expect(first('backlinks', 'screens')).toBe('Fixes · Backlinks')
    expect(first('reports', 'screens')).toBe('Reports')
    expect(first('impact review', 'screens')).toBe('Impact review')
    expect(first('head to head', 'screens')).toBe('Head-to-head')
    expect(first('pitch', 'screens')).toBe('Pitch a new client')
    expect(first('where do we stand', 'screens')).toBe('Where do we stand?')
    expect(first('agency logo', 'screens')).toBe('App settings · Reports branding')
    expect(first('white label', 'screens')).toBe('App settings · Reports branding')
    expect(first('reputation', 'screens')).toBe('Visibility report · Reputation & sources')
    expect(first('how do I add my agency logo', 'help')).toBe('Reports branding')
    expect(first('why is what changed empty', 'help')).toBe('What changed report')
    expect(first('what is the right page', 'help')).toBe('Words CiteFox uses')
    expect(first('glossary', 'help')).toBe('Words CiteFox uses')
    expect(texts('help', 'help')[0]).toBe('Getting started')
    // The guide stays the first action for "help"; topics are their own group.
    expect(first('help', 'actions')).toBe('Open the guide')
  })
})

describe('Ctrl+K project data', () => {
  const DATA: SearchData = {
    competitors: [{ id: 'c1', name: 'Twilio', domain: 'twilio.com' }],
    pageFixes: [
      { id: 'pf1', title: '/email-to-sms', kind: 'improve', topics: 'Text alerts' },
      { id: 'pf2', title: 'New page: SMS pricing', kind: 'new', topics: 'Pricing' }
    ],
    logged: [{ id: 'f1', number: 3, page: '/pricing' }],
    reports: [{ id: 'r1', name: 'Weekly client report' }]
  }

  test('competitors, fixes and reports open where the app opens them', () => {
    const rivals = findData('twilio', DATA, HERE)
    expect(rivals.competitors).toEqual([
      {
        key: 'competitor:c1',
        href: '#/topics/t1?view=list&drawer=competitor&competitor=c1',
        text: 'Twilio',
        detail: 'twilio.com'
      }
    ])
    const fix = findData('email', DATA, HERE).fixes[0]
    expect(fix?.href).toBe('#/topics/t1?view=list&drawer=page-fix&pfx.id=pf1')
    expect(fix?.detail).toBe('Improve a page · Text alerts')
    expect(findData('write a new page', DATA, HERE).fixes[0]?.text).toBe('New page: SMS pricing')
    expect(findData('pricing', DATA, HERE).fixes.map((item) => item.text)).toEqual([
      'New page: SMS pricing',
      'Fix 3 · /pricing'
    ])
    expect(findData('fix 3', DATA, HERE).fixes[0]?.href).toBe(
      '#/topics/t1?view=list&drawer=fix&fix=f1'
    )
    expect(findData('weekly', DATA, HERE).reports[0]?.href).toBe(
      '#/reports?drawer=schedule&schedule.id=r1'
    )
  })
})
