// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
  type RenderResult
} from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { REPORT_SECTIONS, type AutoExport, type ExportPreview, type Market } from '@shared/domain'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import {
  AUTO_EXPORT_ERROR_MESSAGES,
  AUTO_EXPORT_UNAVAILABLE_NEXT_STEP,
  type AutoExportUnavailable,
  type CiteFoxApi,
  type ExportRequest
} from '@shared/ipc'
import { marketLabel } from '../shell/model'
import { revealLabel } from '../ui'
import { createLiveReportsClient, type ReportsClient } from './client'
import { localTimeZone } from './export/model'
import { SAMPLE_AUTO_EXPORT_FOLDER } from './engine'
import { createMockReportsClient } from './mockClient'
import { ExportScreen } from './export'

/** Every report section a page (not a topic) can carry. */
const PAGE_SECTIONS = REPORT_SECTIONS.filter((id) => id !== 'topic_coverage')

const HARBOR_MARKET: Market = {
  id: 'ca-en',
  country: 'CA',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

const AUTO_UNAVAILABLE: AutoExportUnavailable = {
  code: 'unavailable',
  message: AUTO_EXPORT_ERROR_MESSAGES.unavailable,
  nextStep: AUTO_EXPORT_UNAVAILABLE_NEXT_STEP
}

const EMPTY_PREVIEW: ExportPreview = {
  blocked: false,
  reason: null,
  nextStep: null,
  pageCount: 1,
  marketCount: 1,
  checkCount: 0,
  sections: ['overview'],
  estimatedBytes: 128,
  preview: ''
}

/** The header's one primary action, named after the format. */
const SAVE = /^Save (HTML report|PDF|Excel workbook|CSV tables|JSON)$/

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'citefox')
  // The export form lives on the URL: start each test from a clean one.
  window.location.hash = ''
})

describe('Export screen', () => {
  it('shows the summary and saves the HTML report and JSON', async () => {
    const view = renderWithMock(createMockReportsClient({ paceMs: 0 }))
    const body = within(view.container)
    expect(body.getByRole('heading', { level: 1, name: 'Export a report' })).toBeTruthy()
    await waitFor(() => {
      expect(body.getByText('1 check')).toBeTruthy()
    })
    expect(body.getByText('HTML report · .zip')).toBeTruthy()
    const summary = within(view.container.querySelector<HTMLElement>('.xpt-preview-panel')!)
    expect(summary.getByText('1 page')).toBeTruthy()
    expect(summary.getByText('1 market')).toBeTruthy()
    expect(body.getByText('Cover (always included)')).toBeTruthy()
    expect(body.getByText(`Sections · ${PAGE_SECTIONS.length}`)).toBeTruthy()
    expect(body.queryByLabelText('Folder')).toBeNull()
    // The automatic-export card stays hidden while the engine has no spec storage.
    expect(alertText(body)).not.toContain("Automatic exports aren't available yet.")
    expect(body.queryByRole('switch', { name: /automatic/i })).toBeNull()
    expect(body.getByText('Reports are made on this computer. Nothing is uploaded.')).toBeTruthy()
    for (const [pick, filename] of [
      [null, 'TextBolt-text-alerts-2026-10-19.zip'],
      [/Single index\.html/, 'TextBolt-text-alerts-2026-10-19.html'],
      [/JSON/, 'TextBolt-text-alerts-2026-10-19.json']
    ] as const) {
      if (pick) fireEvent.click(body.getByRole('radio', { name: pick }))
      await clickExport(body)
      await waitFor(() => {
        expect(body.getByText(filename)).toBeTruthy()
      })
      expect(exportStatus(body).textContent).toContain('Saved')
    }
  })

  it('labels every radio group and lists the v2 sections with their copy', () => {
    const view = renderWithMock(createMockReportsClient({ paceMs: 0 }))
    const body = within(view.container)
    expect(body.getByRole('group', { name: 'What to export' })).toBeTruthy()
    for (const name of ['Data window', 'Format', 'Packaging']) {
      expect(body.getByRole('radiogroup', { name })).toBeTruthy()
    }
    for (const id of REPORT_SECTIONS) {
      const box = body.getByRole('checkbox', {
        name: new RegExp(`^${REPORT_SECTION_COPY[id].title}`)
      })
      expect((box as HTMLInputElement).checked).toBe(id !== 'topic_coverage')
      expect(view.container.textContent).toContain(REPORT_SECTION_COPY[id].description)
    }
    expect(
      body.getAllByText('Shows a “Not measured yet” panel when there is no data.')
    ).toHaveLength(2)
    expect(body.getByText('Trends always use every check in the window.')).toBeTruthy()
    expect(view.container.textContent).not.toContain('Saved views')
    expect(view.container.textContent).not.toContain('Selected pages')
    expect(view.container.textContent).not.toContain('AI Mode')
  })

  it("turns automatic export on only after main's folder dialog picked a folder", async () => {
    const client = createMockReportsClient({ paceMs: 0 })
    const view = renderWithMock(client)
    const body = within(view.container)
    const toggle = await body.findByRole('switch', { name: 'Export after every scheduled check' })
    expect(body.getByText('No folder chosen yet')).toBeTruthy()
    // No folder yet: the switch stays off and says why.
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(alertText(body)).toContain('Choose a folder for automatic exports first.')
    })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    // The renderer never types a path: main's dialog chooses it.
    expect(body.queryByRole('textbox', { name: 'Folder' })).toBeNull()
    fireEvent.click(body.getByRole('button', { name: 'Choose folder' }))
    expect(await body.findByText(SAMPLE_AUTO_EXPORT_FOLDER)).toBeTruthy()
    expect(body.getByRole('button', { name: 'Change folder' })).toBeTruthy()
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true')
    })
    expect(alertText(body)).not.toContain('Choose a folder')
    expect(body.getByText(/Saved: HTML · \d+ sections/)).toBeTruthy()
    fireEvent.click(body.getByRole('radio', { name: /Excel/ }))
    fireEvent.click(body.getByRole('button', { name: 'Save these settings' }))
    expect(await body.findByText('Saved.')).toBeTruthy()
    await waitFor(() => {
      expect(body.getByText(/Saved: Excel · \d+ sections/)).toBeTruthy()
    })
    expect(body.queryByRole('radio', { name: /^Email$/ })).toBeNull()
  })

  it('shows the last automatic export and its history from main', async () => {
    const saved: AutoExport = {
      projectId: 'harbor',
      pageId: 'welcome',
      enabled: true,
      destination: 'folder',
      folder: '/Users/me/Reports',
      emailTo: null,
      spec: null,
      runs: [
        {
          id: 'run-2',
          finishedAt: '2026-10-20T09:00:00.000Z',
          outcome: 'failed',
          format: 'pdf',
          filename: null,
          bytes: null,
          reason: 'The export folder is missing or CiteFox cannot write to it.',
          nextStep: 'Open Export and choose the folder again.'
        },
        {
          id: 'run-1',
          finishedAt: '2026-10-19T09:00:00.000Z',
          outcome: 'ok',
          format: 'pdf',
          filename: 'Harbor-welcome-2026-10-19.pdf',
          bytes: 2048,
          reason: null,
          nextStep: null
        }
      ]
    }
    installBridge({
      'exports:preview': () => Promise.resolve(EMPTY_PREVIEW),
      'exports:getAuto': () => Promise.resolve(saved)
    })
    const view = render(
      <ExportScreen
        client={createLiveReportsClient()}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: HARBOR_MARKET }}
        pages={[{ id: 'welcome', label: 'Welcome' }]}
        readPage={() => Promise.resolve({ markets: [HARBOR_MARKET] })}
      />
    )
    const body = within(view.container)
    expect(await body.findByText('/Users/me/Reports')).toBeTruthy()
    const toggle = body.getByRole('switch', { name: 'Export after every scheduled check' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(body.getByTestId('auto-last').textContent).toContain(
      'failed. The export folder is missing'
    )
    expect(body.getByText('Recent automatic exports (2)')).toBeTruthy()
    const rows = within(body.getByRole('table', { name: /Recent automatic exports/ })).getAllByRole(
      'row'
    )
    // Header plus one row per run: the count matches the rows (NFR-14).
    expect(rows).toHaveLength(3)
    expect(rows[2]?.textContent).toContain('Harbor-welcome-2026-10-19.pdf')
    expect(rows[2]?.textContent).toContain('Saved · 2 KB')
  })

  it('sends PDF with v2 sections, the page, the market and the local time zone', async () => {
    const requests: ExportRequest[] = []
    const client = recording(createMockReportsClient({ paceMs: 0 }), requests)
    const view = renderWithMock(client)
    const body = within(view.container)
    fireEvent.click(body.getByRole('radio', { name: /Excel/ }))
    fireEvent.click(body.getByRole('radio', { name: /PDF/ }))
    expect((body.getByRole('radio', { name: /PDF/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(body.getByRole('radio', { name: 'A4' }))
    await clickExport(body)
    await waitFor(() => {
      expect(exportStatus(body).textContent).toContain('Saved')
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.format).toBe('pdf')
    expect(requests[0]?.pdf?.pageSize).toBe('a4')
    expect(requests[0]?.projectId).toBe('harbor')
    expect(requests[0]?.scope).toBe('page')
    expect(requests[0]?.pageIds).toEqual(['welcome'])
    expect(requests[0]?.marketIds).toEqual(['us-en'])
    expect(requests[0]?.sections).toEqual(PAGE_SECTIONS)
    expect(requests[0]?.timeZone).toBe(localTimeZone())
  })

  it('exports the whole project without content gaps', async () => {
    const requests: ExportRequest[] = []
    const view = renderWithMock(recording(createMockReportsClient({ paceMs: 0 }), requests))
    const body = within(view.container)
    fireEvent.click(body.getByRole('radio', { name: /Whole project/ }))
    const gaps = body.getByRole('checkbox', { name: /Content gaps/ }) as HTMLInputElement
    expect(gaps.disabled).toBe(true)
    expect(gaps.checked).toBe(false)
    expect(body.getByText(/Content gaps are built for one page/)).toBeTruthy()
    expect(body.queryByRole('radiogroup', { name: 'This page: pick' })).toBeNull()
    await clickExport(body)
    await waitFor(() => {
      expect(exportStatus(body).textContent).toContain('Saved')
    })
    expect(requests[0]?.scope).toBe('project')
    expect(requests[0]?.pageIds).toEqual([])
    expect(requests[0]?.sections).not.toContain('content_gaps')
    expect(requests[0]?.sections).toContain('prompts')
  })

  it('picks one market or all markets', async () => {
    const requests: ExportRequest[] = []
    const view = render(
      <ExportScreen
        client={recording(createMockReportsClient({ paceMs: 0 }), requests)}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: US_MARKET }}
        pages={[{ id: 'welcome', label: 'Welcome' }]}
        readPage={() => Promise.resolve({ markets: [US_MARKET, HARBOR_MARKET] })}
      />
    )
    const body = within(view.container)
    const group = await body.findByRole('radiogroup', { name: 'Markets' })
    expect(
      (within(group).getByRole('radio', { name: /All markets/ }) as HTMLInputElement).checked
    ).toBe(true)
    fireEvent.click(within(group).getByRole('radio', { name: marketLabel(HARBOR_MARKET) }))
    await clickExport(body)
    await waitFor(() => {
      expect(exportStatus(body).textContent).toContain('Saved')
    })
    expect(requests[0]?.marketIds).toEqual(['ca-en'])
    fireEvent.click(within(group).getByRole('radio', { name: /All markets/ }))
    await clickExport(body)
    await waitFor(() => {
      expect(requests).toHaveLength(2)
    })
    expect(requests[1]?.marketIds).toEqual(['us-en', 'ca-en'])
  })

  it('starts on the market the page was showing, so the numbers match the page', async () => {
    const requests: ExportRequest[] = []
    const view = render(
      <ExportScreen
        client={recording(createMockReportsClient({ paceMs: 0 }), requests)}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: US_MARKET }}
        pages={[{ id: 'welcome', label: 'Welcome' }]}
        initialMarketId={HARBOR_MARKET.id}
        readPage={() => Promise.resolve({ markets: [US_MARKET, HARBOR_MARKET] })}
      />
    )
    const body = within(view.container)
    const group = await body.findByRole('radiogroup', { name: 'Markets' })
    await waitFor(() => {
      expect(
        (within(group).getByRole('radio', { name: marketLabel(HARBOR_MARKET) }) as HTMLInputElement)
          .checked
      ).toBe(true)
    })
    await clickExport(body)
    await waitFor(() => {
      expect(requests).toHaveLength(1)
    })
    expect(requests[0]?.marketIds).toEqual([HARBOR_MARKET.id])
  })

  it('sends a date range and blocks one with no checks', async () => {
    const view = renderWithMock(createMockReportsClient({ paceMs: 0 }))
    const body = within(view.container)
    fireEvent.click(body.getByRole('radio', { name: 'Date range' }))
    fireEvent.change(body.getByLabelText('From'), { target: { value: '2027-01-01' } })
    fireEvent.change(body.getByLabelText('To'), { target: { value: '2027-02-01' } })
    await waitFor(() => {
      expect(alertText(body)).toContain('No checks fall in this date range.')
    })
    expect(alertText(body)).toContain('Widen the dates, or choose Every check.')
    expect(body.getByRole('button', { name: SAVE }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(body.getByRole('radio', { name: 'Every check' }))
    await waitFor(() => {
      expect(body.getByText('3 checks')).toBeTruthy()
    })
  })

  it('selects none, says what to do, and selects all again', async () => {
    const view = renderWithMock(createMockReportsClient({ paceMs: 0 }))
    const body = within(view.container)
    // Select all and Select none sit under the Sections card's ⋯.
    fireEvent.click(body.getByRole('button', { name: 'More actions for Sections' }))
    fireEvent.click(body.getByRole('menuitem', { name: 'Select none' }))
    await waitFor(() => {
      expect(alertText(body)).toContain('Pick at least one section.')
    })
    expect(body.getByText('No sections picked yet.')).toBeTruthy()
    expect(body.getByRole('button', { name: SAVE }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(body.getByRole('button', { name: 'More actions for Sections' }))
    fireEvent.click(body.getByRole('menuitem', { name: 'Select all' }))
    await waitFor(() => {
      expect(body.getByRole('button', { name: SAVE }).hasAttribute('disabled')).toBe(false)
    })
  })

  it('offers raw SerpApi data only with JSON and sends it last', async () => {
    const requests: ExportRequest[] = []
    const view = renderWithMock(recording(createMockReportsClient({ paceMs: 0 }), requests))
    const body = within(view.container)
    expect(body.queryByRole('checkbox', { name: /Raw search data/ })).toBeNull()
    fireEvent.click(body.getByRole('radio', { name: /CSV/ }))
    expect(body.queryByRole('checkbox', { name: /Raw search data/ })).toBeNull()
    fireEvent.click(body.getByRole('radio', { name: /JSON/ }))
    fireEvent.click(body.getByRole('checkbox', { name: /Raw search data/ }))
    await clickExport(body)
    await waitFor(() => {
      expect(exportStatus(body).textContent).toContain('Saved')
    })
    expect(requests[0]?.sections.at(-1)).toBe('raw')
    expect(body.getByText('Raw search data')).toBeTruthy()
  })

  it('saves a CSV and blocks a report with no markets', async () => {
    const view = renderWithMock(createMockReportsClient({ paceMs: 0 }))
    const body = within(view.container)
    fireEvent.click(body.getByRole('radio', { name: /CSV/ }))
    await clickExport(body)
    await waitFor(() => {
      expect(exportStatus(body).textContent).toContain('Saved')
      expect(body.getByRole('button', { name: revealLabel() })).toBeTruthy()
    })
    fireEvent.click(body.getByRole('button', { name: revealLabel() }))
    expect(
      await body.findByText(/Shown in Finder. On this computer: CiteFox exports\//)
    ).toBeTruthy()
    cleanup()
    const empty = render(
      <ExportScreen
        client={createMockReportsClient({ paceMs: 0 })}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: null }}
        pages={[{ id: 'welcome', label: 'Welcome' }]}
        readPage={() => Promise.resolve({ markets: [] })}
      />
    )
    const none = within(empty.container)
    expect(none.getByText('No markets yet.')).toBeTruthy()
    await waitFor(() => {
      expect(alertText(none)).toContain('Pick at least one market.')
    })
    expect(none.getByRole('button', { name: SAVE }).hasAttribute('disabled')).toBe(true)
  })

  it('starts on the page the user came from', async () => {
    const requests: ExportRequest[] = []
    const view = render(
      <ExportScreen
        client={recording(createMockReportsClient({ paceMs: 0 }), requests)}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: US_MARKET }}
        pages={[
          { id: 'welcome', label: 'Welcome' },
          { id: 'pricing', label: 'Pricing' }
        ]}
        initialPageId="pricing"
        readPage={() => Promise.resolve({ markets: [US_MARKET] })}
      />
    )
    const body = within(view.container)
    const picker = body.getByRole('radiogroup', { name: 'This page: pick' })
    expect(
      (within(picker).getByRole('radio', { name: /Pricing/ }) as HTMLInputElement).checked
    ).toBe(true)
    expect(body.getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe(
      '#/pages/pricing/results'
    )
    await clickExport(body)
    await waitFor(() => {
      expect(requests).toHaveLength(1)
    })
    expect(requests[0]?.pageIds).toEqual(['pricing'])
  })

  it('shows Export cancelled when the save dialog is dismissed', async () => {
    const view = renderWithMock(createMockReportsClient({ paceMs: 0, cancelled: true }))
    const body = within(view.container)
    fireEvent.click(body.getByRole('radio', { name: /Excel/ }))
    await clickExport(body)
    await waitFor(() => {
      expect(alertText(body)).toContain('Export cancelled')
    })
  })

  it('shows empty states in production and renders no mock catalog', async () => {
    installBridge({
      'exports:preview': () => Promise.reject(new Error('The engine is busy.')),
      'exports:getAuto': () => Promise.reject(new Error('The engine is busy.'))
    })
    const view = render(<ExportScreen client={createLiveReportsClient()} />)
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByText(/^No project yet\. Create a project/)).toBeTruthy()
    })
    expect(view.container.querySelector('.crumb')).toBeNull()
    expect(body.getByRole('link', { name: 'Back' }).getAttribute('href')).toMatch(/^#\//)
    expect(view.container.textContent).toContain('No pages yet.')
    expect(view.container.textContent).toContain('No markets yet.')
    expect(view.container.textContent).toContain(REPORT_SECTION_COPY.content_gaps.description)
    expect(view.container.textContent).toContain(REPORT_SECTION_COPY.reputation.description)
    expect(view.container.textContent).not.toContain('from the Oct 19 analysis')
    expectNoMockCatalog(view.container.textContent ?? '')
    expect(view.container.textContent).not.toContain('About 2 MB · 14 pages')
    expect(view.container.textContent).not.toContain('1 page')
    expect(view.container.textContent).not.toContain('3 checks')
    expect(view.container.textContent).not.toContain('Next scheduled check')
    expect(view.container.textContent).not.toContain('186 tracked pages')
    expect(view.container.textContent).not.toContain('Error invoking remote method')
    expect(body.getByRole('button', { name: SAVE }).hasAttribute('disabled')).toBe(true)
  })

  it('renders the project, page, and market from the shell and strips the invoke wrapper', async () => {
    installBridge({
      'exports:preview': () => Promise.resolve(EMPTY_PREVIEW),
      'exports:getAuto': () =>
        Promise.reject(
          new Error("Error invoking remote method 'exports:getAuto': Error: The engine is busy.")
        )
    })
    const view = render(
      <ExportScreen
        client={createLiveReportsClient()}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: HARBOR_MARKET }}
        pages={[{ id: 'welcome', label: 'Welcome' }]}
        readPage={() => Promise.resolve({ markets: [HARBOR_MARKET] })}
      />
    )
    await waitFor(() => {
      expect(view.container.textContent).toContain('The engine is busy.')
      expect(view.container.textContent).toContain('0 checks')
    })
    expect(within(view.container).getByRole('link', { name: 'Welcome' }).getAttribute('href')).toBe(
      '#/pages/welcome/results'
    )
    expect(view.container.textContent).toContain('CA · EN')
    expect(view.container.textContent).toContain('128 bytes')
    expectNoMockCatalog(view.container.textContent ?? '')
    expect(view.container.textContent).not.toContain('Error invoking remote method')
    expect(view.container.textContent).not.toContain('from the Oct 19 analysis')
  })

  it('links to the next step when there is no project, no page, or no page markets', async () => {
    installBridge({
      'exports:preview': () => Promise.resolve(EMPTY_PREVIEW),
      'exports:getAuto': () => Promise.resolve(AUTO_UNAVAILABLE)
    })
    const empty = render(<ExportScreen client={createLiveReportsClient()} />)
    expect(
      (await within(empty.container).findByRole('link', { name: 'New project' })).getAttribute(
        'href'
      )
    ).toBe('#/projects/new')
    cleanup()
    const noPages = render(
      <ExportScreen
        client={createLiveReportsClient()}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: HARBOR_MARKET }}
      />
    )
    const links = await within(noPages.container).findAllByRole('link', {
      name: 'Set up your site'
    })
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('href')).toBe('#/start')
    cleanup()
    let reads = 0
    const flaky = render(
      <ExportScreen
        client={createLiveReportsClient()}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: HARBOR_MARKET }}
        pages={[{ id: 'welcome', label: 'Welcome' }]}
        readPage={() => {
          reads += 1
          return reads === 1
            ? Promise.reject(new Error('The engine is busy.'))
            : Promise.resolve({ markets: [HARBOR_MARKET] })
        }}
      />
    )
    const body = within(flaky.container)
    await waitFor(() => {
      expect(alertText(body)).toContain('only the default market is listed')
    })
    fireEvent.click(body.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(alertText(body)).not.toContain('only the default market is listed')
    })
    expect(reads).toBe(2)
  })

  it('shows the CSV preview as a grid of data rows', async () => {
    installBridge({
      'exports:preview': () =>
        Promise.resolve({
          ...EMPTY_PREVIEW,
          checkCount: 1,
          preview: 'page_url,market\nhttps://textbolt.com/alerts,US\n'
        }),
      'exports:getAuto': () => Promise.resolve(AUTO_UNAVAILABLE)
    })
    const view = render(
      <ExportScreen
        client={createLiveReportsClient()}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: HARBOR_MARKET }}
        pages={[{ id: 'welcome', label: 'Welcome' }]}
        readPage={() => Promise.resolve({ markets: [HARBOR_MARKET] })}
      />
    )
    const body = within(view.container)
    fireEvent.click(body.getByRole('radio', { name: /CSV/ }))
    await waitFor(() => {
      expect(body.getAllByTestId('export-preview-row')).toHaveLength(1)
    })
    expect(body.getByRole('table', { name: 'Export preview' }).textContent).toContain(
      'https://textbolt.com/alerts'
    )
  })

  it('hides the automatic-export card while the engine cannot store a spec', async () => {
    let asked = false
    installBridge({
      'exports:preview': () => Promise.resolve(EMPTY_PREVIEW),
      'exports:getAuto': () => {
        asked = true
        return Promise.resolve(AUTO_UNAVAILABLE)
      }
    })
    const view = render(
      <ExportScreen
        client={createLiveReportsClient()}
        project={{ id: 'harbor', name: 'Harbor', defaultMarket: HARBOR_MARKET }}
        pages={[{ id: 'welcome', label: 'Welcome' }]}
        readPage={() => Promise.resolve({ markets: [HARBOR_MARKET] })}
      />
    )
    await waitFor(() => {
      expect(asked).toBe(true)
    })
    expect(view.container.textContent).not.toContain(AUTO_UNAVAILABLE.message)
    expect(view.queryByRole('switch', { name: 'Export after every scheduled check' })).toBeNull()
    expect(view.container.textContent).not.toContain('Error invoking remote method')
  })
})

const US_MARKET: Market = { ...HARBOR_MARKET, id: 'us-en', country: 'US' }

/** The export's own status line (saved, cancelled), in the summary panel. */
function exportStatus(scope: ReturnType<typeof within>): HTMLElement {
  const found = scope
    .getAllByRole('status')
    .filter((node: HTMLElement) => node.closest('.xpt-preview-panel') !== null)
  if (found.length !== 1) throw new Error(`Expected one export status, found ${found.length}`)
  return found[0] as HTMLElement
}

function renderWithMock(client: ReportsClient): RenderResult {
  return render(
    <ExportScreen
      client={client}
      project={{ id: 'harbor', name: 'Harbor', defaultMarket: US_MARKET }}
      pages={[{ id: 'welcome', label: 'Welcome' }]}
      readPage={() => Promise.resolve({ markets: [US_MARKET] })}
    />
  )
}

/** Records every `exports:start` request. */
function recording(client: ReportsClient, requests: ExportRequest[]): ReportsClient {
  const startExport = client.startExport
  return {
    ...client,
    startExport: (request) => {
      requests.push(request)
      return startExport(request)
    }
  }
}

function alertText(body: { queryAllByRole: (role: 'alert') => HTMLElement[] }): string {
  return body
    .queryAllByRole('alert')
    .map((alert) => alert.textContent ?? '')
    .join(' ')
}

async function clickExport(body: ReturnType<typeof within>): Promise<void> {
  const button = body.getByRole('button', { name: SAVE })
  await waitFor(() => {
    expect(button.hasAttribute('disabled')).toBe(false)
  })
  fireEvent.click(button)
}

function expectNoMockCatalog(text: string): void {
  expect(text).not.toContain('TextBolt')
  expect(text).not.toContain('Text alerts for business')
  expect(text).not.toContain('Money pages')
  expect(text).not.toContain('US · EN')
  expect(text).not.toContain('Austin')
  expect(text).not.toContain('UK · EN')
  expect(text).not.toContain('MX · ES')
}

function installBridge(api: Partial<CiteFoxApi>): void {
  Object.defineProperty(window, 'citefox', {
    configurable: true,
    value: {
      'exports:preview': () => Promise.reject(new Error('The engine is busy.')),
      'exports:start': () => Promise.reject(new Error('The engine is busy.')),
      'exports:getAuto': () => Promise.reject(new Error('The engine is busy.')),
      'exports:setAuto': () => Promise.reject(new Error('The engine is busy.')),
      'exports:chooseAutoFolder': () => Promise.reject(new Error('The engine is busy.')),
      'exports:progress': () => () => undefined,
      ...api
    } satisfies Partial<CiteFoxApi>
  })
}
