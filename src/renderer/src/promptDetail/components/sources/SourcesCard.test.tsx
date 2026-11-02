// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitorsList,
  RemoveCompetitorsRequest,
  RestoreCompetitorsRequest,
  SaveCompetitorRequest,
  SavedCompetitor,
  SetSiteTypeRequest,
  TopicResults,
  UpdateTopicRequest
} from '@shared/ipc'
import type { SiteOverride } from '@shared/site-overrides'
import { DrillHost } from '../../../drill'
import { resetDrawersForTests } from '../../../shell/drawers'
import { axeViolations } from '../../../ui/axe.test-helper'
import { UndoToastHost } from '../../../ui/UndoToast'
import { resetUndoToastForTests } from '../../../ui/undoStore'
import { useSourceActions } from '../../../sites/useSourceActions'
import type { PromptDetailSource } from '../../source'
import { markdownCitations, sourceLines } from '../../../sites/sources'
import { RemoveCompetitorConfirm } from '../../../sites/RemoveCompetitorConfirm'
import { SourcesCard } from './SourcesCard'
import { REAL_MARKDOWN, REAL_REFERENCES } from './sources.fixtures.test-helper'

const TWILIO: SavedCompetitor = {
  id: 'c-twilio',
  name: 'Twilio',
  domain: 'twilio.com',
  aliases: [],
  tier: 'partial',
  productIds: [null]
}

interface Calls {
  saves: SaveCompetitorRequest[]
  removes: RemoveCompetitorsRequest[]
  restores: RestoreCompetitorsRequest[]
  updates: UpdateTopicRequest[]
  sets: SetSiteTypeRequest[]
}

function newCalls(): Calls {
  return { saves: [], removes: [], restores: [], updates: [], sets: [] }
}

/** A fake of the channels the sources' actions use, with a saved list and choices that change. */
function fakeSource(calls: Calls): PromptDetailSource {
  let saved: SavedCompetitor[] = [TWILIO]
  const overrides = new Map<string, SiteOverride>()
  const list = (): CompetitorsList => ({ projectId: 'textbolt', competitors: saved, products: [] })
  return {
    'pages:get': () => Promise.reject(new Error('unused')),
    'results:get': () => Promise.reject(new Error('unused')),
    'results:history': () => Promise.reject(new Error('unused')),
    'checks:getPrompt': () => Promise.reject(new Error('unused')),
    'competitors:list': async () => list(),
    'competitors:save': async (request) => {
      calls.saves.push(request)
      const added: SavedCompetitor = {
        id: 'c-new',
        name: request.name,
        domain: request.domain,
        aliases: [],
        tier: request.tier,
        productIds: [null]
      }
      saved = [...saved, added]
      return { competitor: added, names: [request.name], undoToken: 'undo-1' }
    },
    'competitors:remove': async (request) => {
      calls.removes.push(request)
      saved = saved.filter((item) => !request.ids.includes(item.id))
      return { competitor: null, names: [], undoToken: 'undo-remove' }
    },
    'competitors:restore': async (request) => {
      calls.restores.push(request)
      saved = [TWILIO]
      return list()
    },
    'competitors:siteTypes': async () => ({
      overrides: [...overrides.values()],
      customTypes: [{ id: 't1', name: 'Carrier', tone: 'info' }]
    }),
    'competitors:setSiteType': async (request) => {
      calls.sets.push(request)
      const previous = overrides.get(request.domain) ?? null
      const next: SiteOverride = {
        domain: request.domain,
        type: request.type === undefined ? (previous?.type ?? null) : request.type,
        role: request.role === undefined ? (previous?.role ?? null) : request.role
      }
      if (next.type === null && next.role === null) overrides.delete(request.domain)
      else overrides.set(request.domain, next)
      return { previous, override: overrides.get(request.domain) ?? null }
    },
    'topics:results': async () =>
      ({ topic: { targetPage: 'https://textbolt.com/pricing' } }) as unknown as TopicResults,
    'topics:update': async (request) => {
      calls.updates.push(request)
      return {} as never
    }
  }
}

function Harness({
  source,
  topicId = null
}: {
  source: PromptDetailSource
  topicId?: string | null
}): JSX.Element {
  const actions = useSourceActions(source, 'textbolt', topicId)
  const lines = sourceLines(
    REAL_REFERENCES.map((reference) => ({ ...reference, key: reference.id })),
    actions.competitors,
    markdownCitations(REAL_MARKDOWN),
    actions.tracked,
    actions.settings
  )
  return (
    <DrillHost>
      <SourcesCard
        headingId="pd-src-h"
        title="Sources Google listed"
        gridLabel="Sources in the order Google listed them"
        engine="Google"
        lines={lines}
        topic={topicId !== null}
        actions={actions}
      />
      <RemoveCompetitorConfirm pending={actions.pendingRemoval} />
      <UndoToastHost />
    </DrillHost>
  )
}

function rowOf(view: ReturnType<typeof render>, position: number): HTMLElement {
  const grid = view.getByRole('grid', { name: 'Sources in the order Google listed them' })
  const row = within(grid)
    .getAllByRole('row')
    .find((item) => item.querySelector('[role="gridcell"]')?.textContent?.endsWith(` ${position}`))
  if (!row) throw new Error(`no row ${position}`)
  return row
}

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
  resetDrawersForTests()
  window.location.hash = ''
})

describe('SourcesCard', () => {
  it('names each column plainly and says who each source is, never "Other"', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    const grid = view.getByRole('grid', { name: 'Sources in the order Google listed them' })
    const headers = within(grid).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      '#',
      'Page',
      'Type of site',
      'Who it is',
      'Cited in the answer',
      'Actions'
    ])
    expect(headers[0]?.getAttribute('title')).toBe("Google's order: 1 = shown first")
    // Twilio was stored as "other"; the saved list makes it a competitor.
    await waitFor(() =>
      expect(within(rowOf(view, 2)).getByText('Competitor · Twilio')).toBeTruthy()
    )
    expect(within(rowOf(view, 2)).getByText('Competitor site')).toBeTruthy()
    expect(within(rowOf(view, 7)).getByText('Community & social')).toBeTruthy()
    // A platform names itself and is never offered as a competitor.
    expect(within(rowOf(view, 7)).getByText('Community · Reddit r/msp')).toBeTruthy()
    expect(within(rowOf(view, 7)).queryByRole('button', { name: /as a competitor/ })).toBeNull()
    // A big company that is not a platform stays Neutral until the user says.
    expect(within(rowOf(view, 5)).getByText('Neutral')).toBeTruthy()
    expect(within(rowOf(view, 5)).getByTitle('Not on your competitor list')).toBeTruthy()
    expect(grid.textContent).not.toContain('Not a competitor yet')
    expect(within(rowOf(view, 7)).getByText('Listed only')).toBeTruthy()
    expect(within(rowOf(view, 5)).getByText('Docs & knowledge base')).toBeTruthy()
    expect(within(rowOf(view, 1)).getByText('Your page')).toBeTruthy()
    expect(within(rowOf(view, 1)).getByText('not tracked')).toBeTruthy()
    expect(within(rowOf(view, 1)).getByText('2 times')).toBeTruthy()
    expect(within(rowOf(view, 3)).getByText('This page')).toBeTruthy()
    expect(grid.textContent).not.toMatch(/\bOther\b(?! website)/)
    // The page: its title on top, its address under it, with Copy and Open.
    const page = within(rowOf(view, 7))
    expect(page.getByText('Email-to-SMS Gateway Service Recommendations? - Reddit')).toBeTruthy()
    expect(page.getByText(/reddit\.com\/r\/msp/)).toBeTruthy()
    expect(page.getByRole('button', { name: /^Copy / })).toBeTruthy()
    expect(page.getByRole('link', { name: /in a new tab$/ })).toBeTruthy()
    expect(view.getByRole('list', { name: 'In these sources' }).textContent).toBe(
      'Your site: 2 pagesCompetitors: 1Communities: 1Neutral: 3'
    )
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('marks a source as a competitor in its row, which turns in place, and Undo puts it back', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    await waitFor(() =>
      expect(within(rowOf(view, 2)).getByText('Competitor · Twilio')).toBeTruthy()
    )
    fireEvent.click(
      within(rowOf(view, 4)).getByRole('button', { name: 'Mark clicksend.com as a competitor' })
    )
    await waitFor(() => expect(calls.saves).toHaveLength(1))
    expect(calls.saves[0]).toEqual({
      projectId: 'textbolt',
      id: null,
      name: 'clicksend.com',
      domain: 'clicksend.com',
      aliases: [],
      tier: 'direct'
    })
    await waitFor(() =>
      expect(within(rowOf(view, 4)).getByText('Competitor · clicksend.com')).toBeTruthy()
    )
    const toast = await view.findByRole('status')
    expect(toast.textContent).toContain('clicksend.com is now a saved competitor.')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(calls.restores).toEqual([{ projectId: 'textbolt', undoToken: 'undo-1' }])
    )
    await waitFor(() => expect(within(rowOf(view, 4)).getByText('Neutral')).toBeTruthy())
  })

  it('offers the right actions in each row menu', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    await waitFor(() =>
      expect(within(rowOf(view, 2)).getByText('Competitor · Twilio')).toBeTruthy()
    )
    const items = async (position: number): Promise<string[]> => {
      fireEvent.click(within(rowOf(view, position)).getByRole('button', { name: /^Actions for/ }))
      const menu = await view.findByRole('menu')
      const labels = within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent ?? '')
      fireEvent.keyDown(menu, { key: 'Escape' })
      await waitFor(() => expect(view.queryByRole('menu')).toBeNull())
      return labels
    }
    expect(await items(4)).toEqual(['Mark as competitor', 'Open page', 'Copy URL'])
    // Reddit opens as what it is; it is never marked as a competitor.
    expect(await items(7)).toEqual(['Open the thread', 'Copy URL'])
    expect(await items(2)).toEqual(['Open page', 'Copy URL'])
    // Not in a topic: no target page to set.
    expect(await items(1)).toEqual(['Track this page', 'Open page', 'Copy URL'])
  })

  it('in a topic, sets an own page as the target page with Undo to the one before', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} topicId="topic-email" />)
    expect(within(rowOf(view, 3)).getByText('Your target page')).toBeTruthy()
    fireEvent.click(within(rowOf(view, 1)).getByRole('button', { name: /^Actions for/ }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Set as target page' }))
    await waitFor(() => expect(calls.updates).toHaveLength(1))
    expect(calls.updates[0]).toEqual({
      projectId: 'textbolt',
      topicId: 'topic-email',
      targetPage: 'https://textbolt.com/migration/verizon/'
    })
    const toast = await view.findByRole('status')
    expect(toast.textContent).toContain(
      "textbolt.com/migration/verizon/ is now this topic's target page."
    )
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.updates).toHaveLength(2))
    expect(calls.updates[1]?.targetPage).toBe('https://textbolt.com/pricing')
  })

  it('tracks an untracked own page from its row', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    fireEvent.click(
      within(rowOf(view, 1)).getByRole('button', { name: 'Track textbolt.com/migration/verizon/' })
    )
    await waitFor(() => expect(window.location.hash).toContain('drawer=track-page'))
  })

  it('sets the type of site from its menu for the whole domain, with Undo and an edited mark', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    const row = (): HTMLElement => rowOf(view, 5)
    fireEvent.click(within(row()).getByRole('button', { name: /^Type of site for att\.com/ }))
    const menu = await view.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => [item.textContent, item.getAttribute('aria-checked')])
    ).toEqual([
      ['Community & social', 'false'],
      ['Review site', 'false'],
      ['News & media', 'false'],
      ['Docs & knowledge base', 'true'],
      ['Directory & marketplace', 'false'],
      ['Other website', 'false'],
      ['Carrier', 'false']
    ])
    expect(
      within(menu)
        .getByRole('menuitem', { name: 'Reset to automatic' })
        .getAttribute('aria-disabled')
    ).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Carrier' }))
    await waitFor(() =>
      expect(calls.sets).toEqual([{ projectId: 'textbolt', domain: 'att.com', type: 'custom:t1' }])
    )
    await waitFor(() => expect(within(row()).getByText('Carrier')).toBeTruthy())
    expect(within(row()).getByTitle('You set this. Reset to automatic')).toBeTruthy()
    const toast = await view.findByRole('status')
    expect(toast.textContent).toContain('att.com is now “Carrier”.')
    expect(toast.textContent).toContain('On every sources list in this project.')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(calls.sets[1]).toEqual({ projectId: 'textbolt', domain: 'att.com', type: null })
    )
    await waitFor(() => expect(within(row()).getByText('Docs & knowledge base')).toBeTruthy())
    expect(within(row()).queryByTitle('You set this. Reset to automatic')).toBeNull()
  })

  it('who it is: a role is saved for the domain, and the edited mark puts it back', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    fireEvent.click(
      within(rowOf(view, 6)).getByRole('button', { name: /^Who email2phone\.net is/ })
    )
    const menu = await view.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent)
    ).toEqual([
      'Competitor',
      'Neutral',
      'Community',
      'Q&A',
      'Social',
      'Video',
      'Encyclopedia',
      'Review site',
      'Media'
    ])
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Media' }))
    await waitFor(() =>
      expect(within(rowOf(view, 6)).getByText('Media · email2phone.net')).toBeTruthy()
    )
    expect(calls.sets).toEqual([
      { projectId: 'textbolt', domain: 'email2phone.net', role: 'media' }
    ])
    fireEvent.click(
      within(rowOf(view, 6)).getByRole('button', {
        name: 'You set who it is for email2phone.net. Reset to automatic'
      })
    )
    await waitFor(() => expect(within(rowOf(view, 6)).getByText('Neutral')).toBeTruthy())
    expect(calls.sets[1]).toEqual({ projectId: 'textbolt', domain: 'email2phone.net', role: null })
  })

  it('choosing Competitor is Mark as competitor', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    fireEvent.click(
      within(rowOf(view, 6)).getByRole('button', { name: /^Who email2phone\.net is/ })
    )
    fireEvent.click(await view.findByRole('menuitemradio', { name: 'Competitor' }))
    await waitFor(() => expect(calls.saves).toHaveLength(1))
    expect(calls.saves[0]).toMatchObject({ name: 'email2phone.net', domain: 'email2phone.net' })
    await waitFor(() =>
      expect(within(rowOf(view, 6)).getByText('Competitor · email2phone.net')).toBeTruthy()
    )
  })

  it('a platform role for a saved competitor asks first, then takes it off the list, with Undo', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    await waitFor(() =>
      expect(within(rowOf(view, 2)).getByText('Competitor · Twilio')).toBeTruthy()
    )
    fireEvent.click(within(rowOf(view, 2)).getByRole('button', { name: /^Who twilio\.com is/ }))
    fireEvent.click(await view.findByRole('menuitemradio', { name: 'Community' }))
    const dialog = await view.findByRole('alertdialog', {
      name: 'Remove Twilio from your competitors?'
    })
    expect(calls.removes).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove competitor' }))
    await waitFor(() =>
      expect(within(rowOf(view, 2)).getByText('Community · twilio.com')).toBeTruthy()
    )
    expect(calls.removes).toEqual([{ projectId: 'textbolt', ids: ['c-twilio'] }])
    expect(calls.sets).toEqual([{ projectId: 'textbolt', domain: 'twilio.com', role: 'community' }])
    const toast = await view.findByRole('status')
    expect(toast.textContent).toContain('Twilio is no longer a competitor.')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(within(rowOf(view, 2)).getByText('Competitor · Twilio')).toBeTruthy()
    )
    expect(calls.restores).toEqual([{ projectId: 'textbolt', undoToken: 'undo-remove' }])
    expect(calls.sets[1]).toEqual({ projectId: 'textbolt', domain: 'twilio.com', role: null })
  })

  it('"New type…" opens Types of site on a new type', async () => {
    const calls = newCalls()
    const view = render(<Harness source={fakeSource(calls)} />)
    fireEvent.click(
      within(rowOf(view, 5)).getByRole('button', { name: /^Type of site for att\.com/ })
    )
    fireEvent.click(await view.findByRole('menuitem', { name: 'New type…' }))
    await waitFor(() => expect(window.location.hash).toContain('drawer=site-types'))
    expect(window.location.hash).toContain('st.new=1')
    expect(window.location.hash).not.toContain('att.com')
  })
})
