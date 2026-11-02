// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitorsList,
  MergeCompetitorsRequest,
  RemoveCompetitorsRequest,
  RestoreCompetitorsRequest,
  SaveCompetitorRequest,
  SavedCompetitor
} from '@shared/ipc'
import { resetDrawersForTests, useDrawerEntry } from '../../shell/drawers'
import { UndoToastHost } from '../../ui/UndoToast'
import { resetUndoToastForTests } from '../../ui/undoStore'
import type { CompetitorsSource } from '../source'
import { CompetitorDrawer } from './CompetitorDrawer'

const SIMPLE: SavedCompetitor = {
  id: 'ssimple',
  name: 'SimpleTexting',
  domain: 'simpletexting.com',
  aliases: [],
  tier: 'direct',
  productIds: [null]
}
const TWILIO: SavedCompetitor = { ...SIMPLE, id: 'stwilio', name: 'Twilio', domain: 'twilio.com' }

interface Calls {
  saves: SaveCompetitorRequest[]
  removes: RemoveCompetitorsRequest[]
  merges: MergeCompetitorsRequest[]
  restores: RestoreCompetitorsRequest[]
}

function fakeSource(): { source: CompetitorsSource; calls: Calls } {
  const calls: Calls = { saves: [], removes: [], merges: [], restores: [] }
  const list: CompetitorsList = { projectId: 'proj-1', competitors: [SIMPLE, TWILIO], products: [] }
  const unused = (): Promise<never> => Promise.reject(new Error('not used'))
  const source: CompetitorsSource = {
    'competitors:overview': unused,
    'competitors:sortSites': unused,
    'competitors:list': () => Promise.resolve(list),
    'competitors:save': (request) => {
      calls.saves.push(request)
      return Promise.resolve({
        competitor: { ...SIMPLE, id: 'snew', name: request.name, domain: request.domain },
        names: [request.name],
        undoToken: 'undo-save'
      })
    },
    'competitors:remove': (request) => {
      calls.removes.push(request)
      return Promise.resolve({ competitor: null, names: ['Twilio'], undoToken: 'undo-remove' })
    },
    'competitors:merge': (request) => {
      calls.merges.push(request)
      return Promise.resolve({ competitor: SIMPLE, names: ['Twilio'], undoToken: 'undo-merge' })
    },
    'competitors:restore': (request) => {
      calls.restores.push(request)
      return Promise.resolve(list)
    },
    'competitors:setSiteKind': unused,
    'competitors:siteTypes': unused,
    'competitors:setSiteType': unused,
    'prompts:addTargets': unused,
    'prompts:addQuestions': unused,
    'fixes:searches': unused
  }
  return { source, calls }
}

/** The shell's way: the drawer reads its live entry from the URL. */
function Harness({ source }: { source: CompetitorsSource }): JSX.Element {
  const api = useDrawerEntry('competitor')
  return (
    <>
      {api ? (
        <CompetitorDrawer projectId="proj-1" entry={api.entry} depth={api.depth} source={source} />
      ) : null}
      <UndoToastHost />
    </>
  )
}

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
  resetDrawersForTests()
  window.location.hash = ''
})

describe('CompetitorDrawer', () => {
  it('adds a competitor from its domain, with a site icon preview and Undo', async () => {
    window.location.hash = '#/competitors?drawer=competitor&competitor=new'
    const { source, calls } = fakeSource()
    const view = render(<Harness source={source} />)
    await view.findByLabelText('Domain')
    const drawer = view.getByRole('dialog', { name: 'Add competitor' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add competitor' }))
    expect(await within(drawer).findByText('Give the competitor a name or a domain')).toBeTruthy()
    expect(calls.saves).toEqual([])
    fireEvent.change(within(drawer).getByLabelText('Domain'), {
      target: { value: 'https://www.clicksend.com/us' }
    })
    expect(
      within(drawer).getByText('Matches links on clicksend.com and its subdomains.')
    ).toBeTruthy()
    const aliases = within(drawer).getByLabelText('Other domains')
    fireEvent.change(aliases, { target: { value: 'clicksend.co.uk' } })
    fireEvent.keyDown(aliases, { key: 'Enter' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Partial' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add competitor' }))
    await waitFor(() => expect(calls.saves).toHaveLength(1))
    expect(calls.saves[0]).toEqual({
      projectId: 'proj-1',
      id: null,
      name: 'clicksend.com',
      domain: 'clicksend.com',
      aliases: ['clicksend.co.uk'],
      tier: 'partial'
    })
    const toast = await view.findByRole('status')
    expect(toast.textContent).toContain('Added clicksend.com as a competitor.')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(calls.restores).toEqual([{ projectId: 'proj-1', undoToken: 'undo-save' }])
    )
  })

  it('edits a saved competitor, and Remove acts at once with Undo', async () => {
    window.location.hash = '#/competitors?drawer=competitor&competitor=stwilio'
    const { source, calls } = fakeSource()
    const view = render(<Harness source={source} />)
    const drawer = await view.findByRole('dialog', { name: 'Edit Twilio' })
    const save = within(drawer).getByRole('button', { name: 'Save changes' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(drawer).getByLabelText('Name'), { target: { value: 'Twilio Inc' } })
    fireEvent.click(save)
    await waitFor(() => expect(calls.saves[0]).toMatchObject({ id: 'stwilio', name: 'Twilio Inc' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())

    window.location.hash = '#/competitors?drawer=competitor&competitor=stwilio'
    const again = await view.findByRole('dialog', { name: 'Edit Twilio' })
    fireEvent.click(within(again).getByRole('button', { name: 'Remove Twilio from competitors' }))
    await waitFor(() => expect(calls.removes).toEqual([{ projectId: 'proj-1', ids: ['stwilio'] }]))
    const toast = await view.findByRole('status')
    expect(toast.textContent).toContain('Removed Twilio from competitors.')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.restores).toHaveLength(1))
  })

  it('merges with the picked competitors, the picks on the URL', async () => {
    window.location.hash = '#/competitors?drawer=competitor&competitor=ssimple'
    const { source, calls } = fakeSource()
    const view = render(<Harness source={source} />)
    const drawer = await view.findByRole('dialog', { name: 'Edit SimpleTexting' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Merge with…' }))
    const merge = await view.findByRole('dialog', { name: 'Merge SimpleTexting with…' })
    expect(window.location.hash).toContain('competitor.mode=merge')
    const primary = within(merge).getByRole('button', { name: 'Merge competitors' })
    expect((primary as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(merge).getByRole('checkbox', { name: /Twilio/ }))
    await waitFor(() => expect(window.location.hash).toContain('competitor.ids=stwilio'))
    fireEvent.click(await within(merge).findByRole('button', { name: 'Merge 2 competitors' }))
    await waitFor(() =>
      expect(calls.merges).toEqual([
        { projectId: 'proj-1', ids: ['ssimple', 'stwilio'], intoId: 'ssimple' }
      ])
    )
    expect((await view.findByRole('status')).textContent).toContain(
      'Merged Twilio into SimpleTexting.'
    )
  })

  it('says plainly when the competitor in the link is not saved', async () => {
    window.location.hash = '#/competitors?drawer=competitor&competitor=sgone'
    const { source } = fakeSource()
    const view = render(<Harness source={source} />)
    expect(
      await view.findByText('That competitor is not saved any more, or is not available to you.')
    ).toBeTruthy()
  })
})
