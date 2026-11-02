// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoveSiteTypeDefRequest, SaveSiteTypeDefRequest } from '@shared/ipc'
import type { CustomSiteType, SiteOverride } from '@shared/site-overrides'
import { resetDrawersForTests } from '../shell/drawers'
import { axeViolations } from '../ui/axe.test-helper'
import { openSiteTypes } from './model'
import { SiteTypesDrawer } from './SiteTypesDrawer'
import type { SiteTypesSource } from './source'

interface Calls {
  saves: SaveSiteTypeDefRequest[]
  removes: RemoveSiteTypeDefRequest[]
}

function fakeSource(calls: Calls): SiteTypesSource {
  let types: CustomSiteType[] = [{ id: 't1', name: 'Carrier', tone: 'info' }]
  let overrides: SiteOverride[] = [{ domain: 'att.com', type: 'custom:t1', role: null }]
  return {
    'competitors:siteTypes': async () => ({ overrides, customTypes: types }),
    'competitors:setSiteType': () => Promise.reject(new Error('unused')),
    'competitors:saveSiteTypeDef': async (request) => {
      calls.saves.push(request)
      const type = { id: request.id ?? 't2', name: request.name.trim(), tone: request.tone }
      types = [...types.filter((item) => item.id !== type.id), type]
      return type
    },
    'competitors:removeSiteTypeDef': async (request) => {
      calls.removes.push(request)
      types = types.filter((item) => item.id !== request.id)
      overrides = []
      return { cleared: 1 }
    }
  }
}

afterEach(() => {
  cleanup()
  resetDrawersForTests()
  window.location.hash = ''
})

describe('Types of site drawer', () => {
  it('adds, renames, recolours and deletes a type of your own', async () => {
    const calls: Calls = { saves: [], removes: [] }
    const view = render(
      <SiteTypesDrawer
        projectId="textbolt"
        create={false}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        source={fakeSource(calls)}
      />
    )
    const list = await view.findByRole('list', { name: 'Your types of site' })
    expect(within(list).getByText('On 1 site')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Add type' }))
    expect(await view.findByText('Give the type a name.')).toBeTruthy()
    fireEvent.change(view.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Partner' }
    })
    fireEvent.click(view.getByRole('radio', { name: 'Green' }))
    fireEvent.click(view.getByRole('button', { name: 'Add type' }))
    await waitFor(() =>
      expect(calls.saves).toEqual([
        { projectId: 'textbolt', id: null, name: 'Partner', tone: 'ok' }
      ])
    )
    await waitFor(() => expect(view.getByRole('textbox', { name: 'Name of Partner' })).toBeTruthy())

    const name = view.getByRole('textbox', { name: 'Name of Carrier' })
    fireEvent.change(name, { target: { value: 'Mobile carrier' } })
    fireEvent.blur(name)
    await waitFor(() =>
      expect(calls.saves[1]).toEqual({
        projectId: 'textbolt',
        id: 't1',
        name: 'Mobile carrier',
        tone: 'info'
      })
    )

    fireEvent.click(await view.findByRole('button', { name: 'Delete Partner' }))
    const dialog = await view.findByRole('alertdialog', { name: 'Delete “Partner”?' })
    expect(dialog.textContent).toContain('No site has it yet.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete type' }))
    await waitFor(() => expect(calls.removes).toEqual([{ projectId: 'textbolt', id: 't2' }]))
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('a new type for a site closes with its id, and the site never goes on the URL', async () => {
    const calls: Calls = { saves: [], removes: [] }
    const onCreated = vi.fn()
    openSiteTypes({ create: true, domain: 'att.com' })
    expect(window.location.hash).toContain('st.new=1')
    expect(window.location.hash).not.toContain('att.com')
    const view = render(
      <SiteTypesDrawer
        projectId="textbolt"
        create
        onClose={vi.fn()}
        onCreated={onCreated}
        source={fakeSource(calls)}
      />
    )
    await view.findByRole('list', { name: 'Your types of site' })
    fireEvent.change(view.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Reseller' }
    })
    fireEvent.click(view.getByRole('button', { name: 'Add and use for att.com' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('t2'))
  })
})
