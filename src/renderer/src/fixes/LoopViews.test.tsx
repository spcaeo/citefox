// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistRunRequest } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { describeMockAssist, runMockAssist } from '../assist/mock'
import { fakeLoopSource, ledger, NOW, SCHEDULE_URL, ALERTS_URL } from './fixtures'
import { FixesScreen } from './index'
import type { ProjectFixesSource } from './source'

const AXE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function recordingAssist(): { client: AssistClient; requests: AssistRunRequest[] } {
  const requests: AssistRunRequest[] = []
  return {
    requests,
    client: {
      describe: describeMockAssist,
      run: async (request) => {
        requests.push(request)
        return runMockAssist(request)
      }
    }
  }
}

function show(source: ProjectFixesSource, assistClient?: AssistClient): ReturnType<typeof render> {
  return render(
    <FixesScreen
      projectId="proj-1"
      source={source}
      now={NOW}
      {...(assistClient ? { assistClient } : {})}
    />
  )
}

describe('Fixes screen: Next round (from Did it work?)', () => {
  it('shows the five steps with counts and owners, the numbers, the index and the round', async () => {
    window.location.hash = '#/fixes?view=round'
    const { source } = fakeLoopSource()
    const view = show(source)
    expect(await view.findByRole('heading', { name: 'The next round' })).toBeTruthy()
    const tabs = view.getByRole('tablist', { name: 'Fixes views' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('aria-label') ?? tab.textContent?.replace(/\d+$/, ''))
        .map((name) => name?.trim())
    ).toEqual(['What to fix', 'Changes made', 'Did it work?'])
    // Next round is a part of Did it work?, with the way back.
    expect(
      within(tabs)
        .getByRole('tab', { name: /^Did it work\?/ })
        .getAttribute('aria-selected')
    ).toBe('true')
    expect(view.getByRole('link', { name: '← Did it work?' }).getAttribute('href')).toBe(
      '#/fixes?view=changes'
    )
    const steps = view.getByRole('heading', { name: 'The next round' }).closest('section')
    expect(steps?.textContent).toContain('6 pages · every 14 days')
    for (const name of ['Measure', 'Re-optimise', 'Publish', 'Get indexed', 'Build backlinks']) {
      expect(
        within(steps as HTMLElement).getByRole('heading', { name: new RegExp(name) })
      ).toBeTruthy()
    }
    expect(view.getByRole('button', { name: 'Re-optimise is done by You. Rename' })).toBeTruthy()
    expect(view.getByText('Next measurement on Nov 2, then every 14 days.')).toBeTruthy()
    const numbers = view.getByRole('region', { name: 'Next round numbers' })
    expect(
      within(numbers).getByRole('region', { name: 'In the next round now' }).textContent
    ).toContain('2')
    expect(view.getByRole('heading', { name: 'Google index' })).toBeTruthy()
    const grid = view.getByRole('grid', { name: 'In the next round' })
    expect(within(grid).getByText('Schedule text messages')).toBeTruthy()
    expect(within(grid).getByText('How to set up text alerts for business')).toBeTruthy()
    expect(within(grid).queryByText('Pricing')).toBeNull()
    expect(
      view.getAllByRole('link', {
        name: 'Send /blog/schedule-text-messages/ to Google with FreshlyCited (opens in your browser)'
      }).length
    ).toBeGreaterThan(0)
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('a step count opens exactly its pages, each linking to its change', async () => {
    window.location.hash = '#/fixes?view=round'
    const { source } = fakeLoopSource()
    const view = show(source)
    fireEvent.click(await view.findByRole('button', { name: '2 pages: Pages to re-optimise' }))
    const drawer = await view.findByRole('dialog', { name: /Pages to re-optimise/ })
    expect(drawer.textContent).toContain('/blog/schedule-text-messages/')
    expect(drawer.textContent).toContain('/blog/how-to-set-up-text-alerts-for-business/')
  })

  it('the tabs write the view to the URL; Next round and Backlinks are a link away', async () => {
    window.location.hash = '#/fixes?view=changes'
    const { source } = fakeLoopSource()
    const view = show(source)
    const tabs = await view.findByRole('tablist', { name: 'Fixes views' })
    expect(await view.findByRole('grid', { name: 'Changes you made' })).toBeTruthy()
    fireEvent.click(view.getByRole('link', { name: 'Backlinks' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=backlinks'))
    fireEvent.click(view.getByRole('link', { name: '← Did it work?' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=changes'))
    fireEvent.click(view.getByRole('link', { name: 'Next round' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=round'))
    fireEvent.click(within(tabs).getByRole('tab', { name: /^Changes made/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=log'))
    fireEvent.click(within(tabs).getByRole('tab', { name: /^What to fix/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes'))
  })

  it('renames a step’s owner in place, with the edit in the URL', async () => {
    window.location.hash = '#/fixes?view=round'
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    fireEvent.click(await view.findByRole('button', { name: 'Re-optimise is done by You. Rename' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=round&owner=reoptimise'))
    const input = view.getByLabelText('Who does Re-optimise?')
    fireEvent.change(input, { target: { value: '  Priya  ' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(calls.owners).toEqual([{ projectId: 'proj-1', step: 'reoptimise', label: 'Priya' }])
    )
    expect(
      await view.findByRole('button', { name: 'Re-optimise is done by Priya. Rename' })
    ).toBeTruthy()
    expect(window.location.hash).toBe('#/fixes?view=round')
  })

  it('Check index shows what it spends and runs only after Confirm', async () => {
    window.location.hash = '#/fixes?view=round'
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    fireEvent.click(await view.findByRole('button', { name: 'Check index' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=round&index=confirm'))
    const confirm = await view.findByRole('alertdialog', { name: 'Check the Google index?' })
    await waitFor(() =>
      expect(confirm.textContent).toContain(
        'Checks 4 pages with a Google site: search. Uses 4–8 searches; 52 left this month.'
      )
    )
    expect(calls.previews).toEqual([
      {
        projectId: 'proj-1',
        pageIds: ['page-gmail', 'page-schedule', 'page-pricing', 'page-alerts']
      }
    ])
    expect(calls.checks).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: 'Check index' }))
    await waitFor(() => expect(calls.checks).toHaveLength(1))
    expect(calls.checks[0]).toMatchObject({ projectId: 'proj-1', confirmedSearches: 8 })
    expect(await view.findByText('Checked 4 pages with Google · used 5 searches.')).toBeTruthy()
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=round'))
  })

  it('Check index says why it cannot run and keeps its button off', async () => {
    window.location.hash = '#/fixes?view=round&index=confirm'
    const { source } = fakeLoopSource(
      ledger(),
      {},
      {
        pages: 4,
        searchesMin: 4,
        searchesMax: 8,
        left: 2,
        canRun: false,
        reason: 'This needs up to 8 searches and 2 are left this month.'
      }
    )
    const view = show(source)
    const confirm = await view.findByRole('alertdialog', { name: 'Check the Google index?' })
    await waitFor(() =>
      expect(confirm.textContent).toContain(
        'This needs up to 8 searches and 2 are left this month.'
      )
    )
    expect(
      (within(confirm).getByRole('button', { name: 'Check index' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=round'))
  })

  it('drafts the fix for a page in a drawer kept in the URL, then logs it as a fix', async () => {
    window.location.hash = '#/fixes?view=round'
    const { source } = fakeLoopSource()
    const { client, requests } = recordingAssist()
    const view = show(source, client)
    const grid = await view.findByRole('grid', { name: 'In the next round' })
    fireEvent.click(
      within(grid).getByRole('button', { name: 'Actions for Schedule text messages' })
    )
    fireEvent.click(await view.findByRole('menuitem', { name: 'Draft the fix' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=round&draft=page-schedule'))
    const panel = await view.findByRole('dialog', {
      name: 'Draft the fix · Schedule text messages'
    })
    fireEvent.click(
      within(panel).getByRole('button', { name: `AI actions for /blog/schedule-text-messages/` })
    )
    fireEvent.click(await view.findByRole('menuitem', { name: /Draft Fix 2/ }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      assistId: 'progress.draftFix',
      projectId: 'proj-1',
      pageId: 'page-schedule',
      inputs: { fixNumber: 2 }
    })
    fireEvent.click(await within(panel).findByRole('button', { name: /^Log as a fix/ }))
    await waitFor(() => expect(window.location.hash).toContain('drawer=fix&fix=new'))
    expect(window.location.hash).toContain('fix.page=page-schedule')
    expect(window.location.hash).toContain('fix.text=')
    expect(window.location.hash).not.toContain('draft=')
  })

  it('See what happened opens lost ground for a lost page', async () => {
    window.location.hash = '#/fixes?view=round'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('grid', { name: 'In the next round' })
    fireEvent.click(
      within(grid).getByRole('button', {
        name: 'Actions for How to set up text alerts for business'
      })
    )
    fireEvent.click(await view.findByRole('menuitem', { name: 'See what happened' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=lost&lost=page-alerts'))
  })
})

describe('Fixes screen: Changes', () => {
  it('shows how fast changes get cited and the ledger, with the filter in the URL', async () => {
    window.location.hash = '#/fixes?view=changes'
    const { source } = fakeLoopSource()
    const view = show(source)
    const bar = await view.findByRole('button', {
      name: /^8–13 days\s*1 of 2 pages cited\s*\.? Show the pages$/
    })
    expect(
      view.getByRole('button', { name: /^0–3 days\s*0 of 1 page cited\s*\.? Show the pages$/ })
    ).toBeTruthy()
    fireEvent.click(bar)
    expect(await view.findByRole('dialog', { name: /Changes live 8–13 days/ })).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    const grid = view.getByRole('grid', { name: 'Changes you made' })
    expect(within(grid).getByText('Rewrite')).toBeTruthy()
    expect(within(grid).getByText('Updated Oct 8 on the page')).toBeTruthy()
    const filters = view.getByRole('group', { name: 'Show changes' })
    fireEvent.click(within(filters).getByRole('button', { name: /^Lost ground/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=changes&show=lost'))
    expect(within(grid).queryByText('Schedule text messages')).toBeNull()
    expect(within(grid).getByText('How to set up text alerts for business')).toBeTruthy()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('cited before and now open the fix searches they count', async () => {
    window.location.hash = '#/fixes?view=changes&show=lost'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('grid', { name: 'Changes you made' })
    fireEvent.click(
      within(grid).getByRole('button', {
        name: '5 searches: Cited before the fix · /blog/how-to-set-up-text-alerts-for-business/'
      })
    )
    const drawer = await view.findByRole('dialog', { name: /Cited before the fix/ })
    expect(drawer.textContent).toContain('How do I handle alerts case 5?')
  })

  it('each change shows its verdict: worse, too early with the days left', async () => {
    window.location.hash = '#/fixes?view=changes'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('grid', { name: 'Changes you made' })
    const alerts = within(grid).getByRole('row', { name: /How to set up text alerts/ })
    expect(within(alerts).getByText('Worse')).toBeTruthy()
    const pricing = within(grid).getByRole('row', { name: /Pricing/ })
    expect(within(pricing).getByText('Too early · 2 days left')).toBeTruthy()
  })

  it('the change drawer says Did it work? and opens the lost searches in place', async () => {
    window.location.hash = '#/fixes?view=changes&row=fix-alerts'
    const { source } = fakeLoopSource()
    const view = show(source)
    const panel = await view.findByRole('dialog', {
      name: 'How to set up text alerts for business'
    })
    const work = within(panel).getByTestId('did-it-work')
    expect(work.textContent).toContain('Won none, lost 4 searches. Live 15 days.')
    fireEvent.click(within(work).getByRole('button', { name: 'Open the 4 lost searches' }))
    const lost = await view.findByRole('dialog', { name: /Searches lost/ })
    expect(lost.textContent).toContain('How do I handle alerts case 2?')
    expect(window.location.hash).toContain('view=changes')
  })

  it('a row opens the change detail in the URL, with every question before and now', async () => {
    window.location.hash = '#/fixes?view=changes'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('grid', { name: 'Changes you made' })
    fireEvent.click(within(grid).getByText('How to set up text alerts for business'))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=changes&row=fix-alerts'))
    const panel = await view.findByRole('dialog', {
      name: 'How to set up text alerts for business'
    })
    const questions = within(panel).getByRole('grid', { name: 'Questions before and now' })
    expect(within(questions).getAllByText('Your other page')).toHaveLength(3)
    expect(within(questions).getAllByText('Right page #2')).toHaveLength(3)
    expect(within(panel).getByText('step-by-step').tagName).toBe('STRONG')
    fireEvent.click(within(panel).getByRole('button', { name: 'See what happened' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=lost&lost=page-alerts'))
  })

  it('Edit the change closes the detail and opens the fix drawer on it', async () => {
    window.location.hash = '#/fixes?view=changes&row=fix-alerts'
    const { source } = fakeLoopSource()
    const view = show(source)
    const panel = await view.findByRole('dialog', {
      name: 'How to set up text alerts for business'
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit the change' }))
    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/fixes?view=changes&drawer=fix&fix=fix-alerts&fix.mode=edit'
      )
    )
  })

  it('changes a change’s kind from the row menu', async () => {
    window.location.hash = '#/fixes?view=changes'
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('grid', { name: 'Changes you made' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Pricing' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Change kind to Rewrite' }))
    await waitFor(() =>
      expect(calls.kinds).toEqual([{ projectId: 'proj-1', fixId: 'fix-pricing', kind: 'rewrite' }])
    )
    expect(await view.findByText('Pricing is now a rewrite.')).toBeTruthy()
  })
})

describe('Fixes screen: Backlinks', () => {
  it('lists the pages to link to, First first, with anchors, and copies every URL', async () => {
    window.location.hash = '#/fixes?view=backlinks'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('grid', { name: 'Backlink ask list' })
    expect(within(grid).getAllByText('First')).toHaveLength(2)
    expect(within(grid).getByText('schedule text messages from email')).toBeTruthy()
    // Copy and Download sit under the list's ⋯; Copy keeps the menu open to show its tick.
    fireEvent.click(view.getByRole('button', { name: 'More actions for the backlink list' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Copy all URLs' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${ALERTS_URL}\n${SCHEDULE_URL}`))
    expect(await view.findByRole('menuitem', { name: 'Copied' })).toBeTruthy()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('downloads the list as CSV', async () => {
    window.location.hash = '#/fixes?view=backlinks'
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    fireEvent.click(await view.findByRole('button', { name: 'More actions for the backlink list' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Download CSV' }))
    await waitFor(() => expect(calls.csv).toHaveLength(1))
    expect(calls.csv[0]?.fileName).toBe('textbolt.com-backlink-ask-list-2026-10-23.csv')
    expect(calls.csv[0]?.rows.map((row) => row[2])).toEqual([ALERTS_URL, SCHEDULE_URL])
    expect(
      await view.findByText('Saved textbolt.com-backlink-ask-list-2026-10-23.csv.')
    ).toBeTruthy()
  })

  it('the AI menu writes anchor text for the pages without one', async () => {
    window.location.hash = '#/fixes?view=backlinks'
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    fireEvent.click(await view.findByRole('button', { name: 'AI actions for the backlink list' }))
    fireEvent.click(await view.findByRole('menuitem', { name: /Suggest anchor text for 1 page/ }))
    await waitFor(() =>
      expect(calls.anchors).toEqual([
        { projectId: 'proj-1', pageIds: ['page-alerts'], refresh: false }
      ])
    )
    expect(await view.findByText('Wrote anchor text for 1 page.')).toBeTruthy()
    expect(await view.findByText('anchor for page-alerts')).toBeTruthy()
  })
})
