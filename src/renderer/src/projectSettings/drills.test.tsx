// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  CompetitorFindings,
  CompetitorOverviewRef,
  Market,
  ProjectUsageReport
} from '@shared/domain'
import type { ProjectSettingsView } from '@shared/ipc'
import type { AdminClient } from '../admin/client'
import { DrillHost } from '../drill'
import type { GridCsvExport } from '../grid/types'
import type { ShellClient } from '../projects/client'
import { CompetitorFinder } from './components/CompetitorFinder'
import { GeneralSection } from './components/GeneralSection'
import { UsagePopover } from './components/UsagePopover'
import { competitorDrill, hostIsCompetitor } from './utils/competitorDrill'

afterEach(() => {
  cleanup()
})

const MARKET: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

function ref(id: string, patch: Partial<CompetitorOverviewRef> = {}): CompetitorOverviewRef {
  return {
    overviewId: id,
    pageId: 'page-1',
    pageLabel: 'SMS API',
    promptId: `prompt-${id}`,
    promptLabel: `best sms api ${id}`,
    promptPosition: 2,
    marketId: 'mkt-us',
    runId: 'run-1',
    checkedAt: '2026-10-19T12:00:00.000Z',
    url: `https://twilio.com/${id}`,
    citations: 1,
    ...patch
  }
}

const FOUND: CompetitorFindings = {
  projectId: 'proj-1',
  domain: 'textbolt.com',
  overviewsRead: 4,
  latestCheckAt: '2026-10-19T12:00:00.000Z',
  candidates: [
    {
      domain: 'twilio.com',
      overviews: 3,
      citations: 4,
      likelyCompetitor: true,
      reason: 'Cited in 3 overviews instead of you',
      listed: false,
      overviewRefs: [ref('a', { citations: 2 }), ref('b'), ref('c')]
    },
    {
      domain: 'help.twilio.com',
      overviews: 1,
      citations: 1,
      likelyCompetitor: false,
      reason: 'Help or docs site, probably not a competitor',
      listed: false,
      overviewRefs: [ref('a', { url: 'https://help.twilio.com/x' })]
    }
  ],
  nextStep: null
}

const exportCsv: GridCsvExport = () =>
  Promise.resolve({ ok: false, reason: 'cancelled', message: 'test' })

function admin(patch: Partial<AdminClient> = {}): AdminClient {
  return {
    findCompetitors: vi.fn(() => Promise.resolve(FOUND)),
    projectUsage: vi.fn(() => Promise.resolve(REPORT)),
    ...patch
  } as unknown as AdminClient
}

const REPORT: ProjectUsageReport = {
  month: '2026-10',
  projects: [
    {
      projectId: 'proj-1',
      name: 'TextBolt',
      clientName: null,
      status: 'active',
      source: 'shared',
      searches: 1240,
      sharedSearches: 1000,
      cap: 3000,
      capRule: 'pause',
      allowance: 3000,
      dedicatedKeyId: null,
      sharePercent: 20,
      claudeCalls: 9,
      claudeLabel: 'CiteFox AI'
    }
  ],
  sharedUsed: 1000,
  sharedCapacity: 5000,
  unassigned: 2000,
  dedicatedUsed: 240,
  claudeCalls: 9
}

const VIEW = {
  project: {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: 'x',
    clientName: null,
    status: 'active',
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: ['twilio.com'],
    defaultMarket: MARKET,
    foundPageCount: 3,
    trackedPageCount: 1,
    markets: [MARKET]
  },
  markets: [MARKET],
  usage: { used: 1240, allowance: 3000, projectedMonthEnd: 2020, resetsOn: '2026-11-01' }
} as unknown as ProjectSettingsView

describe('competitor drill', () => {
  test('subdomains count once per overview; exact mode keeps one host', () => {
    expect(hostIsCompetitor('help.twilio.com', 'Twilio.com')).toBe(true)
    expect(hostIsCompetitor('nottwilio.com', 'twilio.com')).toBe(false)
    const all = competitorDrill(FOUND, 'twilio.com', { markets: [MARKET], brand: 'TextBolt' })
    expect(all.items).toHaveLength(3)
    expect(all.items.find((item) => item.id === 'a')?.cells?.links).toBe(3)
    const exact = competitorDrill(FOUND, 'twilio.com', {
      markets: [MARKET],
      brand: 'TextBolt',
      exact: true
    })
    expect(exact.items).toHaveLength(FOUND.candidates[0]!.overviews)
    expect(exact.items[0]?.target).toEqual({
      kind: 'prompt',
      pageId: 'page-1',
      promptId: 'prompt-a',
      marketId: 'mkt-us',
      runId: 'run-1'
    })
  })
})

describe('Competitor finder drills', () => {
  test('"3 overviews" opens a drawer of exactly 3 overviews; Escape returns focus', async () => {
    render(
      <DrillHost exportCsv={exportCsv}>
        <CompetitorFinder
          admin={admin()}
          projectId="proj-1"
          competitors={[]}
          markets={[MARKET]}
          brand="TextBolt"
          onAdd={() => Promise.resolve()}
        />
      </DrillHost>
    )
    fireEvent.click(screen.getByRole('button', { name: /Find competitors/ }))
    const opener = await screen.findByRole('button', {
      name: '3 overviews cite twilio.com: show them'
    })
    expect(opener.querySelector('[data-nfr-figure]')?.textContent).toBe('3')
    expect(opener.getAttribute('data-nfr-drill')).toBe('competitor:twilio.com')
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: /AI Overviews citing twilio\.com/ })
    expect(within(dialog).getAllByText(/^Question 2 · best sms api/)).toHaveLength(3)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
    expect(
      screen.getByRole('link', { name: 'Open twilio.com in a new tab' }).getAttribute('href')
    ).toBe('https://twilio.com')
  })

  test('a saved competitor chip opens the overviews that cite it', async () => {
    const client = { updateProject: vi.fn() } as unknown as ShellClient
    render(
      <DrillHost exportCsv={exportCsv}>
        <GeneralSection
          view={VIEW}
          admin={admin()}
          client={client}
          keys={[]}
          refresh={() => Promise.resolve()}
        />
      </DrillHost>
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'twilio.com: show the AI Overviews that cite it' })
    )
    const dialog = await screen.findByRole('dialog', { name: /AI Overviews citing twilio\.com/ })
    expect(within(dialog).getAllByText(/^Question 2 · best sms api/)).toHaveLength(3)
  })
})

describe('Searches used this month', () => {
  test('the bar opens the breakdown, starting with the number on the bar', async () => {
    render(<UsagePopover view={VIEW} admin={admin()} />)
    const opener = screen.getByRole('button', { name: /1,240 of 3,000 searches used this month/ })
    fireEvent.keyDown(opener, { key: 'Enter' })
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Searches this month' })
    await waitFor(() => expect(within(dialog).getByText('On its own key')).toBeTruthy())
    expect(within(dialog).getByText('1,240')).toBeTruthy()
    expect(within(dialog).getByText('240')).toBeTruthy()
  })
})
