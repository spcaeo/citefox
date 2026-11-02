// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  ProjectSchedule,
  ProjectScoreList,
  ProjectScoreSummary,
  ProjectUsageReport,
  ProjectUsageRow
} from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { GlanceStrip } from './components/GlanceStrip'
import { ProjectTable } from './components/ProjectTable'
import type { ProjectActions } from './types'
import { UsageSection } from './components/UsageSection'
import { meanOf, pageScoreList, searchRows, type PageScoreRow } from './utils/drills'
import type { ProjectRow } from './utils/rows'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const MARKET = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop' as const,
  localWording: false,
  serpapiLocation: null
}

function project(id: string, name: string, patch: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id,
    name,
    slug: id,
    domain: `${id}.example`,
    dbPath: `projects/${id}.sqlite`,
    clientName: null,
    status: 'active',
    includeSubdomains: false,
    brandNames: [name],
    competitors: [],
    defaultMarket: MARKET,
    foundPageCount: 40,
    trackedPageCount: 12,
    markets: [MARKET],
    ...patch
  }
}

const ALPHA = project('alpha', 'Alpha')
const BETA = project('beta', 'Beta', { status: 'paused', trackedPageCount: 5, foundPageCount: 9 })

const SCORE: ProjectScoreSummary = {
  projectId: 'alpha',
  averageScore: 50,
  change: -2,
  nextCheckAt: '2026-10-21T09:00:00.000Z',
  searchesUsed: 120,
  searchCap: 500,
  pagesDueToday: 3
}

const SCHEDULE: ProjectSchedule = {
  projectId: 'alpha',
  defaultIntervalDays: 14,
  dailyCheckTime: '09:00',
  quietFrom: null,
  quietUntil: null,
  spreadAcrossDay: false,
  catchUp: true,
  paused: false,
  nextCheckAt: '2026-10-21T09:00:00.000Z',
  pagesDueToday: 3
}

const USAGE: ProjectUsageRow = {
  projectId: 'alpha',
  name: 'Alpha',
  clientName: null,
  status: 'active',
  source: 'shared',
  searches: 120,
  sharedSearches: 120,
  cap: 500,
  capRule: 'pause',
  allowance: 500,
  dedicatedKeyId: null,
  sharePercent: 12,
  claudeCalls: 7,
  claudeLabel: 'CiteFox AI'
}

const PAGES: readonly PageScoreRow[] = [
  { pageId: 'p1', label: 'Pricing', score: 70, change: 4 },
  { pageId: 'p2', label: 'Blog', score: 30, change: -8 },
  { pageId: 'p3', label: 'New page', score: null, change: null }
]

function actions(): ProjectActions & { go: ReturnType<typeof vi.fn> } {
  const go = vi.fn()
  return {
    go,
    onOpen: vi.fn(() => Promise.resolve()),
    onSettings: vi.fn(),
    onToggleStatus: vi.fn(() => Promise.resolve()),
    onRestore: vi.fn(() => Promise.resolve()),
    onGo: go,
    loadPageScores: vi.fn(() => Promise.resolve(PAGES))
  }
}

const ROW: ProjectRow = { project: ALPHA, score: SCORE, schedule: SCHEDULE, usage: USAGE }

function renderTable(a: ProjectActions, rows: readonly ProjectRow[] = [ROW]): void {
  render(
    <ProjectTable
      rows={rows}
      total={rows.length}
      actions={a}
      statusFilter={{
        label: 'Status',
        value: 'all',
        options: [{ value: 'all', label: 'All' }],
        onChange: vi.fn()
      }}
      empty={<p>No projects</p>}
    />
  )
}

describe('Projects drill helpers', () => {
  test('page score list and mean match the project average the engine rounds', () => {
    const listed = pageScoreList(PAGES, 'score')
    expect(listed.map((row) => row.pageId)).toEqual(['p2', 'p1'])
    expect(meanOf(listed.map((row) => row.score))).toBe(SCORE.averageScore)
    expect(pageScoreList(PAGES, 'change').map((row) => row.pageId)).toEqual(['p2', 'p1'])
  })

  test('the searches popover starts with the clicked number and splits shared and own', () => {
    const rows = searchRows(120, 500, USAGE)
    expect(rows[0]).toMatchObject({ label: 'Searches this month', value: '120' })
    expect(rows.find((row) => row.id === 'shared')?.value).toBe('120')
    expect(rows.find((row) => row.id === 'own')?.value).toBe('0')
  })
})

describe('Projects table drills', () => {
  test('tracked pages opens the project on All pages, tracked preset', () => {
    const a = actions()
    renderTable(a)
    fireEvent.click(
      screen.getByRole('link', { name: 'Open the 12 tracked pages of Alpha in All pages' })
    )
    expect(a.go).toHaveBeenCalledWith('alpha', '#/pages?preset=tracked')
  })

  test('avg score opens a popover whose average equals the number clicked; rows open Progress', async () => {
    const a = actions()
    renderTable(a)
    const opener = screen.getByRole('button', { name: /Avg score of Alpha/ })
    expect(opener.textContent).toBe('50')
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Page scores' })
    await waitFor(() => expect(within(dialog).getByText('Average of 2 pages')).toBeTruthy())
    expect(within(dialog).getByTestId('dpop-total').textContent).toContain('50')
    const rows = within(dialog).getAllByRole('button', { name: /Open the Progress tab/ })
    expect(rows).toHaveLength(2)
    fireEvent.click(rows[0]!)
    expect(a.go).toHaveBeenCalledWith('alpha', '#/pages/p2/progress')
  })

  test('Escape closes the popover and focus returns to the opener', async () => {
    const a = actions()
    renderTable(a)
    const opener = screen.getByRole('button', { name: /searches this month in Alpha/ })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Searches this month' })
    expect(opener.getAttribute('aria-expanded')).toBe('true')
    expect(within(dialog).getByText('On shared keys')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  test('markets, schedule and domain open their places', () => {
    const a = actions()
    renderTable(a)
    fireEvent.click(screen.getByRole('link', { name: /open the markets of Alpha/ }))
    expect(a.go).toHaveBeenLastCalledWith('alpha', '#/project-settings', 'ps-markets-h')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Schedule: Every 14 days/ }))
    expect(a.go).toHaveBeenLastCalledWith('alpha', '#/settings?tab=general')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Open alpha\.example/ }))
    expect(open).toHaveBeenCalledWith('https://alpha.example', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })
})

describe('Project list rows', () => {
  test('the name opens the project, and so does the row', () => {
    const a = actions()
    renderTable(a)
    fireEvent.click(screen.getByRole('link', { name: 'Open Alpha' }))
    expect(a.onOpen).toHaveBeenCalledWith('alpha')
  })

  test('the row menu opens, sets up, and pauses or restores the project', () => {
    const a = actions()
    const archived = project('gamma', 'Gamma', { status: 'archived' })
    renderTable(a, [
      ROW,
      { project: archived, score: undefined, schedule: undefined, usage: undefined }
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Pause/ }))
    expect(a.onToggleStatus).toHaveBeenCalledWith(ALPHA)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Project settings/ }))
    expect(a.onSettings).toHaveBeenCalledWith('alpha')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Gamma' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Restore/ }))
    expect(a.onRestore).toHaveBeenCalledWith(archived)
  })

  test('change opens the pages by change, the loss first', async () => {
    const a = actions()
    renderTable(a)
    fireEvent.click(screen.getByRole('button', { name: /Score change of Alpha/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Score change by page' })
    await waitFor(() => expect(within(dialog).getByText('Mean change of 2 pages')).toBeTruthy())
    expect(within(dialog).getAllByRole('button', { name: /Progress/ })[0]?.textContent).toContain(
      'Blog'
    )
  })
})

describe('Glance strip drills', () => {
  const scores = {
    projects: {
      projects: [SCORE],
      searchesUsed: 120,
      nextCheckAt: SCORE.nextCheckAt
    } as ProjectScoreList,
    pages: null,
    schedules: [SCHEDULE],
    queue: null
  }

  test('status parts filter the list; Projects N clears it', () => {
    const onFilter = vi.fn()
    render(
      <GlanceStrip
        projects={[ALPHA, BETA]}
        scores={scores}
        report={null}
        actions={actions()}
        onFilter={onFilter}
        onShowUsage={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show the 1 paused projects' }))
    expect(onFilter).toHaveBeenLastCalledWith({ statuses: ['Paused'], clients: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2 projects' }))
    expect(onFilter).toHaveBeenLastCalledWith(null)
  })

  test('pages tracked lists each project and the rows add up to the number clicked', async () => {
    const a = actions()
    render(
      <GlanceStrip
        projects={[ALPHA, BETA]}
        scores={scores}
        report={null}
        actions={a}
        onFilter={vi.fn()}
        onShowUsage={vi.fn()}
      />
    )
    const opener = screen.getByRole('button', { name: '17 pages tracked: show each project' })
    expect(opener.textContent).toBe('17')
    fireEvent.keyDown(opener, { key: 'Enter' })
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Pages tracked' })
    const rows = within(dialog).getAllByRole('button', { name: /tracked pages of/ })
    const sum = rows.reduce(
      (total, row) => total + Number(/(\d+) of/.exec(row.textContent ?? '')?.[1]),
      0
    )
    expect(sum).toBe(17)
    fireEvent.click(rows[1]!)
    expect(a.go).toHaveBeenCalledWith('beta', '#/pages?preset=tracked')
  })

  test('next check opens that project schedule', () => {
    const a = actions()
    render(
      <GlanceStrip
        projects={[ALPHA]}
        scores={scores}
        report={null}
        actions={a}
        onFilter={vi.fn()}
        onShowUsage={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('link', { name: /Next check.*Check timing/ }))
    expect(a.go).toHaveBeenCalledWith('alpha', '#/settings?tab=general')
  })

  test('searches opens the breakdown, whose Usage by project opens that tab', async () => {
    const onShowUsage = vi.fn()
    const report: ProjectUsageReport = {
      month: '2026-10',
      projects: [USAGE],
      sharedUsed: 120,
      sharedCapacity: 1000,
      unassigned: 500,
      dedicatedUsed: 0,
      claudeCalls: 7
    }
    render(
      <GlanceStrip
        projects={[ALPHA]}
        scores={scores}
        report={report}
        actions={actions()}
        onFilter={vi.fn()}
        onShowUsage={onShowUsage}
      />
    )
    const opener = screen.getByRole('button', { name: /Used by CiteFox this month: show/ })
    expect(opener.textContent).toBe('120')
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Used by CiteFox this month' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usage by project' }))
    expect(onShowUsage).toHaveBeenCalled()
  })
})

describe('Usage by project drills', () => {
  const report: ProjectUsageReport = {
    month: '2026-10',
    projects: [USAGE],
    sharedUsed: 120,
    sharedCapacity: 1000,
    unassigned: 500,
    dedicatedUsed: 0,
    claudeCalls: 7
  }

  test('name opens, searches pops the breakdown, cap opens search settings', async () => {
    const a = actions()
    render(
      <UsageSection
        report={report}
        error={null}
        keys={[]}
        scheduleById={new Map([['alpha', SCHEDULE]])}
        projectById={new Map([['alpha', ALPHA]])}
        actions={a}
      />
    )
    fireEvent.click(screen.getByRole('link', { name: 'Open Alpha' }))
    expect(a.onOpen).toHaveBeenCalledWith('alpha')
    fireEvent.click(screen.getByRole('link', { name: /Cap 500: open search settings/ }))
    expect(a.go).toHaveBeenLastCalledWith('alpha', '#/project-settings', 'ps-searches-h')
    fireEvent.click(screen.getByRole('button', { name: /120 searches this month in Alpha/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Searches this month' })
    expect(within(dialog).getByText('AI calls')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: '7 AI calls for Alpha: open Connections' })
    ).toBeTruthy()
  })
})

describe('Projects table at 1134 px', () => {
  test('its columns fit the 1134 px window, so Status is never cut by a sideways scroll', () => {
    renderTable(actions())
    const inner = document.querySelector<HTMLElement>('.ui-lg-inner')
    // 1134 - 220 sidebar - 2 x 32 page gutter - 2 border - a 15 px scrollbar.
    expect(Number.parseInt(inner?.style.minWidth ?? '9999', 10)).toBeLessThanOrEqual(833)
  })

  test('shows the client chip only when the client is not the project name', () => {
    renderTable(actions(), [
      { ...ROW, project: project('acme', 'Acme Clinics', { clientName: 'Acme Clinics' }) },
      { ...ROW, project: project('field', 'FieldPro', { clientName: 'FieldPro HVAC' }) }
    ])
    const rows = screen.getAllByRole('row')
    const acme = rows.find((row) => row.textContent?.includes('acme.example'))
    const field = rows.find((row) => row.textContent?.includes('field.example'))
    expect(acme?.textContent?.match(/Acme Clinics/g)).toHaveLength(1)
    expect(field?.textContent).toContain('FieldPro HVAC')
  })
})
