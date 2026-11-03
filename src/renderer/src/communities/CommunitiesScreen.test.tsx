// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistResult, AssistRunRequest } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { promptHash } from '../shell/routes'
import { THREAD, US, VIDEO, fakeSource } from './fixtures.test-helper'
import { CommunitiesScreen } from './index'
import type { CommunitiesSource } from './source'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('Communities screen', () => {
  it('shows the source mix, drills to exactly the answers clicked, and switches scope', async () => {
    const source = fakeSource()
    const view = render(
      <CommunitiesScreen
        source={source}
        projectId="proj-1"
        pageId="page-1"
        marketId="mkt-us"
        markets={[US]}
      />
    )
    expect(
      await view.findByText(/5 citations \(links, not questions\) across 2 overviews/)
    ).toBeTruthy()
    const legend = view.getByRole('grid', { name: /Citations by source type/ })
    expect(within(legend).getByRole('button', { name: '2 citations: Reddit' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '1 answer cite YouTube' }))
    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'YouTube cited · 1 answer' })).toBeTruthy()
    expect(within(dialog).getAllByRole('row')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'Whole project' }))
    await view.findByRole('button', { name: 'Whole project', pressed: true })
    expect(source.requests.at(-1)?.scope).toBe('project')
    fireEvent.click(view.getByRole('button', { name: 'All markets' }))
    await view.findByRole('button', { name: 'All markets', pressed: true })
    expect(source.requests.at(-1)?.marketId).toBeNull()
  })

  it('checks threads on demand and reports that nothing is open to reply to', async () => {
    const view = render(
      <CommunitiesScreen
        source={fakeSource()}
        projectId="proj-1"
        pageId="page-1"
        marketId="mkt-us"
        markets={[US]}
      />
    )
    await view.findByText(/5 citations \(links, not questions\)/)
    showTab(view, /^Reddit/)
    expect(await view.findByText('Unchecked')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Check threads' }))
    expect(await view.findByText('Read 1 thread.')).toBeTruthy()
    expect(await view.findByText('Archived')).toBeTruthy()
    expect(view.getByText(/nothing to reply to here/)).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: /YouTube/ }))
    expect(view.getByText('48,210')).toBeTruthy()
    expect(view.getAllByText('Send SMS Alerts from Grafana in 5 Minutes')).toHaveLength(1)
    const results = await axe.run(view.container, {
      rules: { region: { enabled: false }, 'landmark-one-main': { enabled: false } }
    })
    expect(results.violations).toEqual([])
  })

  it('every drill drawer lists exactly the number that opened it (NFR-14)', async () => {
    const view = await renderScreen()
    const checked = new Set<string>()
    const sweep = (): void => {
      for (const button of view.container.querySelectorAll<HTMLElement>('button[data-nfr-drill]')) {
        const id = button.getAttribute('data-nfr-drill') ?? ''
        const figure =
          button.querySelector('[data-nfr-figure]') ??
          view.container.querySelector(`[data-nfr-figure="${CSS.escape(id)}"]`)
        expect(figure, id).not.toBeNull()
        fireEvent.click(button)
        const dialog = view.getByRole('dialog')
        expect(dialog.querySelectorAll('[data-drill-row]').length, id).toBe(
          Number(figure?.textContent)
        )
        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0] as HTMLElement)
        checked.add(id)
      }
    }
    for (const name of [
      /^Source mix/,
      /^Reddit/,
      /^YouTube/,
      /^LinkedIn/,
      /^Other/,
      /^Opportunities/
    ]) {
      showTab(view, name)
      sweep()
    }
    for (const id of [
      'mix:aios',
      'links:type:reddit',
      'links:all',
      'links:owner:external',
      'type:youtube',
      'owner:yours',
      'change:reddit:0:links',
      'change:all:0:links',
      `source:${THREAD}`,
      `gap:${THREAD}`,
      `source:${VIDEO}`,
      'opportunities',
      'opportunity:r1|p2:others'
    ]) {
      expect(checked.has(id), id).toBe(true)
    }
  }, 30_000)

  it('a citation count lists its links: each opens in the browser, its question in Question detail', async () => {
    const view = await renderScreen()
    fireEvent.click(view.getByRole('button', { name: '2 citations: Reddit' }))
    const dialog = view.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Reddit citations · 2 citations' })
    ).toBeTruthy()
    // Each link is a title that opens in the browser, with its own Copy and Open icons.
    const links = [...dialog.querySelectorAll(`a[href="${THREAD}"][target="_blank"]`)]
    const icons = links.filter((link) => link.closest('.ui-url-actions') !== null)
    expect(links.length - icons.length).toBe(2)
    expect(icons).toHaveLength(2)
    const href = promptHash('page-1', 'p2', { marketId: 'mkt-us', runId: 'r1' })
    expect(dialog.querySelector(`a[href="${href}"]`)).not.toBeNull()
    // Enter on a row opens that answer's Prompt detail.
    const rows = dialog.querySelectorAll<HTMLElement>('[data-drill-row]')
    fireEvent.keyDown(rows[1] as HTMLElement, { key: 'Enter' })
    expect(window.location.hash).toBe(href)
  })

  it('a Reddit row opens the thread: status, counts and the questions citing it', async () => {
    const view = await renderScreen()
    showTab(view, /^Reddit/)
    const table = view.getByTestId('cm-reddit-table')
    const row = within(table).getByRole('row', { name: /vtext\.com shutting down/ })
    fireEvent.click(row.querySelector('[role="gridcell"]') as HTMLElement)
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('data-drill')).toBe(`source:${THREAD}`)
    expect(dialog.textContent).toContain('Can we reply?')
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(2)
    expect(
      within(dialog).getByRole('link', { name: /Open the thread in your browser/ })
    ).toBeTruthy()
  })

  it('a YouTube row opens the questions citing the video', async () => {
    const view = await renderScreen()
    showTab(view, /^YouTube/)
    const table = view.getByTestId('cm-youtube-table')
    const row = within(table).getByRole('row', { name: /Send SMS Alerts/ })
    fireEvent.click(row.querySelector('[role="gridcell"]') as HTMLElement)
    const dialog = view.getByRole('dialog')
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(1)
    expect(dialog.textContent).toContain('Ops Shortcuts')
  })

  it('shows the gap, and drill openers are buttons in the tab order', async () => {
    const view = await renderScreen()
    showTab(view, /^Reddit/)
    const table = view.getByTestId('cm-reddit-table')
    expect(within(table).getByRole('columnheader', { name: /Gap/ })).toBeTruthy()
    expect(
      within(table).getByRole('button', { name: /1 answer cite it and nothing of yours/ })
    ).toBeTruthy()
    for (const button of view.container.querySelectorAll<HTMLElement>('[data-nfr-drill]')) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('tabindex')).not.toBe('-1')
    }
    showTab(view, /^Source mix/)
    for (const mark of view.container.querySelectorAll<HTMLElement>('.mark-btn')) {
      expect(mark.getAttribute('tabindex')).toBe('-1')
    }
    const opener = view.getByRole('button', { name: '2 citations: Reddit' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('"First seen" opens the first check and question that cited the source (FR-17.3)', async () => {
    const view = await renderScreen()
    showTab(view, /^Reddit/)
    const table = view.getByTestId('cm-reddit-table')
    const first = within(table).getAllByRole('link', {
      name: /First seen Oct 5, .+ for question 1 in .*: open that check/
    })
    expect(first[0]?.getAttribute('href')).toBe(
      promptHash('page-1', 'p1', { marketId: 'mkt-us', runId: 'r0' })
    )
  })

  it('"Brand in thread" shows the sentence that names the brand and the thread excerpt', async () => {
    const view = await renderScreen(fakeSource('open'))
    showTab(view, /^Reddit/)
    fireEvent.click(view.getByRole('button', { name: 'Check threads' }))
    const brand = await view.findByRole('button', { name: /Brand in thread: Yes/ })
    fireEvent.click(brand)
    const dialog = view.getByRole('dialog')
    const quotes = dialog.querySelectorAll('blockquote')
    expect(quotes[0]?.textContent).toContain('TextBolt worked for us, took 20 minutes.')
    expect(quotes[1]?.textContent).toContain('Our alarm panels send to @vtext.com. What now?')
  })

  it('drafts a helpful reply from the row menu: answer first, copy only, never posted (FR-17.6)', async () => {
    const requests: AssistRunRequest[] = []
    const result = (runId: string): AssistResult => ({
      runId,
      assistId: 'communities.reply',
      title: 'Draft a helpful reply',
      summary: 'Draft reply for r/sysadmin',
      items: [
        {
          id: `${runId}-1`,
          text: 'Point the panels at a business text address.',
          detail: null,
          tag: 'answer',
          verify: 'Check the shutdown date.',
          sign: null
        },
        {
          id: `${runId}-2`,
          text: 'Full disclosure: I work at TextBolt.',
          detail: null,
          tag: 'disclosure',
          verify: null,
          sign: null
        }
      ],
      caution: null,
      label: {
        connection: 'claude-code',
        connectionText: 'CiteFox AI · on your plan',
        expectedSeconds: 10,
        text: 'CiteFox AI · on your plan · about 10 s'
      },
      savedDataOnly: true,
      searchesUsed: 0,
      durationMs: 5,
      model: null
    })
    const client: AssistClient = {
      describe: async (request) => ({
        assistId: request.assistId,
        title: 'Draft a helpful reply',
        label: result('x').label,
        savedDataOnly: true,
        searchCost: 0,
        acceptsInstruction: true
      }),
      run: async (request) => {
        requests.push(request)
        return result(`run-${requests.length}`)
      }
    }
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = await renderScreen(fakeSource('open'), client)
    showTab(view, /^Reddit/)
    fireEvent.click(view.getByRole('button', { name: 'Check threads' }))
    await view.findByText('Read 1 thread.')
    fireEvent.click(view.getByRole('button', { name: 'Actions for vtext.com shutting down' }))
    fireEvent.click(view.getByRole('menuitem', { name: /Draft a helpful reply/ }))
    const panel = await view.findByRole('region', { name: 'Draft reply for r/sysadmin' })
    const text = await within(panel).findByTestId('cm-reply-text')
    const parts = [...text.querySelectorAll('p')].map((node) =>
      node.getAttribute('data-reply-part')
    )
    expect(parts).toEqual(['answer', 'disclosure'])
    expect(within(panel).getByText('Re-verify: Check the shutdown date.')).toBeTruthy()
    expect(panel.textContent).toContain('CiteFox never posts for you')
    expect(requests[0]).toMatchObject({
      assistId: 'communities.reply',
      projectId: 'proj-1',
      pageId: 'page-1',
      inputs: { threadUrl: THREAD },
      instruction: null
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy reply' }))
    await within(panel).findByRole('button', { name: 'Copied' })
    expect(writeText).toHaveBeenCalledWith(
      'Point the panels at a business text address.\n\nFull disclosure: I work at TextBolt.'
    )
    expect(
      within(panel)
        .getByRole('link', { name: /Open thread/ })
        .getAttribute('href')
    ).toBe(THREAD)
    fireEvent.change(
      within(panel).getByRole('textbox', { name: 'Tell CiteFox AI what to change' }),
      {
        target: { value: 'Shorter' }
      }
    )
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }))
    await within(panel).findByRole('button', { name: 'Copy reply' })
    expect(requests.at(-1)?.instruction).toBe('Shorter')
    const results = await axe.run(view.container, {
      rules: { region: { enabled: false }, 'landmark-one-main': { enabled: false } }
    })
    expect(results.violations).toEqual([])
    fireEvent.click(within(panel).getByRole('button', { name: 'Close the draft' }))
    expect(view.queryByRole('region', { name: 'Draft reply for r/sysadmin' })).toBeNull()
  })

  it('has no axe violations on any section tab', async () => {
    const view = await renderScreen()
    for (const name of [
      /^Source mix/,
      /^Reddit/,
      /^YouTube/,
      /^LinkedIn/,
      /^Other/,
      /^Opportunities/
    ]) {
      showTab(view, name)
      const results = await axe.run(view.container, {
        rules: { region: { enabled: false }, 'landmark-one-main': { enabled: false } }
      })
      expect(results.violations.map((item) => `${String(name)} ${item.id}`)).toEqual([])
    }
  }, 30_000)

  it('keeps the section and both filters in the URL, and opens from it', async () => {
    window.location.hash = '#/pages/page-1/communities?view=youtube&markets=all'
    const source = fakeSource()
    const view = render(
      <CommunitiesScreen
        source={source}
        projectId="proj-1"
        pageId="page-1"
        marketId="mkt-us"
        markets={[US]}
      />
    )
    expect(await view.findByTestId('cm-youtube-table')).toBeTruthy()
    expect(view.getByRole('tab', { name: /^YouTube/ }).getAttribute('aria-selected')).toBe('true')
    expect(source.requests.at(-1)?.marketId).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Whole project' }))
    expect(window.location.hash).toContain('scope=project')
    showTab(view, /^Source mix/)
    expect(window.location.hash).not.toContain('view=')
    fireEvent.click(view.getByRole('button', { name: 'This market' }))
    expect(window.location.hash).not.toContain('markets=')
    await waitFor(() => expect(source.requests.at(-1)?.marketId).toBe('mkt-us'))
  })

  it('an archived thread offers no reply draft', async () => {
    const view = await renderScreen()
    showTab(view, /^Reddit/)
    fireEvent.click(view.getByRole('button', { name: 'Check threads' }))
    expect(await view.findByText('Archived')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Actions for vtext.com shutting down' }))
    expect(view.getByRole('menuitem', { name: /Show the answers citing it/ })).toBeTruthy()
    expect(view.queryByRole('menuitem', { name: /Draft a helpful reply/ })).toBeNull()
  })
})

function showTab(view: ReturnType<typeof render>, name: RegExp): void {
  fireEvent.click(view.getByRole('tab', { name }))
}

async function renderScreen(
  source: CommunitiesSource = fakeSource(),
  assistClient?: AssistClient
): Promise<ReturnType<typeof render>> {
  const view = render(
    <CommunitiesScreen
      source={source}
      {...(assistClient ? { assistClient } : {})}
      projectId="proj-1"
      pageId="page-1"
      marketId="mkt-us"
      markets={[US]}
    />
  )
  await view.findByText(/5 citations \(links, not questions\)/)
  return view
}
