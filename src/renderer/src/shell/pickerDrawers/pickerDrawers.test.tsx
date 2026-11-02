// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { textboltCatalog } from '../../mocks/m2/catalog'
import { memoryActiveProjectStore, resetM2Memory } from '../../mocks/m2/memory'
import { createMockShellClient } from '../../projects/mockClient'
import { UndoToastHost } from '../../ui'
import { axeViolations } from '../../ui/axe.test-helper'
import { DrawerHost } from '../DrawerHost'
import { openDrawer, resetDrawersForTests } from '../drawers'
import { keyProviderOf, looksLikePageAddress, openTrackPage, readTrackUrl } from './model'

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)))
}

function client(): ReturnType<typeof createMockShellClient> {
  return createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
}

function host(shell = client(), onPagesChanged = vi.fn()): ReturnType<typeof render> {
  return render(
    <>
      <DrawerHost projectId="textbolt" client={shell} onPagesChanged={onPagesChanged} />
      <UndoToastHost />
    </>
  )
}

beforeEach(async () => {
  resetM2Memory()
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/start-of-test')
  window.location.hash = '#/settings/project'
  await settle()
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
  vi.restoreAllMocks()
})

describe('picker drawer helpers', () => {
  it('reads a path, host path or full address on the project’s site only', () => {
    expect(readTrackUrl('/pricing', 'textbolt.com', false).url).toBe('https://textbolt.com/pricing')
    expect(readTrackUrl('textbolt.com/a', 'textbolt.com', false).url).toBe('https://textbolt.com/a')
    expect(readTrackUrl('https://www.textbolt.com/b', 'textbolt.com', false).error).toBeNull()
    expect(readTrackUrl('https://help.textbolt.com/b', 'textbolt.com', false).error).toMatch(
      /Only pages on textbolt.com/
    )
    expect(readTrackUrl('https://help.textbolt.com/b', 'textbolt.com', true).error).toBeNull()
    expect(readTrackUrl('https://example.com/', 'textbolt.com', true).error).toMatch(/Only pages/)
    expect(readTrackUrl('', 'textbolt.com', false).error).toMatch(/Enter/)
  })

  it('knows text that looks like an address, and the key provider from the URL', () => {
    expect(looksLikePageAddress('/pricing')).toBe(true)
    expect(looksLikePageAddress('textbolt.com/pricing')).toBe(true)
    expect(looksLikePageAddress('https://textbolt.com')).toBe(true)
    expect(looksLikePageAddress('weekend outages')).toBe(false)
    expect(looksLikePageAddress('gateway')).toBe(false)
    expect(keyProviderOf('anthropic')).toBe('anthropic')
    expect(keyProviderOf('nope')).toBe('serpapi')
    expect(keyProviderOf(undefined)).toBe('serpapi')
  })
})

describe('Track a page drawer', () => {
  it('tracks a path on the site and hands the new page id back', async () => {
    const shell = client()
    const added = vi.spyOn(shell, 'addPage')
    const onPagesChanged = vi.fn()
    host(shell, onPagesChanged)
    const onResult = vi.fn()
    act(() => openTrackPage('/brand-new-page', { onResult }))
    expect(window.location.hash).toBe('#/settings/project?drawer=track-page')
    const drawer = await screen.findByRole('dialog', { name: /Track a page/ })
    const address = await within(drawer).findByRole('textbox', { name: 'Address' })
    expect((address as HTMLInputElement).value).toBe('/brand-new-page')
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Label (optional)' }), {
      target: { value: 'Brand new' }
    })
    expect(await axeViolations(drawer)).toEqual([])
    fireEvent.click(within(drawer).getByRole('button', { name: 'Track page' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(added.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'textbolt',
      url: 'https://textbolt.com/brand-new-page'
    })
    expect(typeof onResult.mock.calls[0]?.[0]).toBe('string')
    expect(onPagesChanged).toHaveBeenCalled()
    expect(window.location.hash).toBe('#/settings/project')
  })

  it('refuses an address on another site before saving', async () => {
    const shell = client()
    const added = vi.spyOn(shell, 'addPage')
    host(shell)
    act(() => openDrawer('track-page'))
    const drawer = await screen.findByRole('dialog', { name: /Track a page/ })
    const address = await within(drawer).findByRole('textbox', { name: 'Address' })
    fireEvent.change(address, { target: { value: 'https://example.com/pricing' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Track page' }))
    await settle()
    expect(within(drawer).getByText(/Only pages on textbolt.com/)).toBeTruthy()
    expect(added).not.toHaveBeenCalled()
  })
})

describe('Add an API key drawer', () => {
  it('adds a SerpApi key, never shows it again, and hands the new key id back', async () => {
    const shell = client()
    const added = vi.spyOn(shell, 'addKey')
    const tested = vi.spyOn(shell, 'testKey')
    host(shell)
    const onResult = vi.fn()
    act(() => openDrawer('add-key', { 'key.provider': 'serpapi' }, { onResult }))
    expect(window.location.hash).toBe('#/settings/project?drawer=add-key&key.provider=serpapi')
    const drawer = await screen.findByRole('dialog', { name: /Add a SerpApi key/ })
    const secret = within(drawer).getByLabelText('API key') as HTMLInputElement
    expect(secret.type).toBe('password')
    fireEvent.change(secret, { target: { value: 'fake-serp-key-123456' } })
    fireEvent.change(
      within(drawer).getByRole('textbox', { name: 'Monthly cap (searches, optional)' }),
      {
        target: { value: '500' }
      }
    )
    // The 3-step key card: sign up and the dashboard open in the browser.
    expect(
      within(drawer)
        .getByRole('link', { name: /^Sign up at SerpApi/ })
        .getAttribute('href')
    ).toBe('https://serpapi.com/users/sign_up')
    expect(await axeViolations(drawer)).toEqual([])
    fireEvent.click(within(drawer).getByRole('button', { name: 'Test and save' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(added.mock.calls[0]?.[0]).toMatchObject({
      provider: 'serpapi',
      name: 'SerpApi key',
      secret: 'fake-serp-key-123456',
      cap: 500,
      projectIds: []
    })
    // Tested before it stays: SerpApi keys are not tested by keys:add itself.
    expect(tested).toHaveBeenCalledTimes(1)
    const toast = await screen.findByTestId('add-key-toast')
    expect(toast.textContent).toContain('SerpApi key tested and saved.')
    expect(document.body.textContent).not.toContain('fake-serp-key-123456')
    expect(window.location.hash).toBe('#/settings/project')
  })

  it('a failed save names the problem without repeating the key', async () => {
    const shell = client()
    vi.spyOn(shell, 'addKey').mockRejectedValue(new Error('keys:add: bad key fake-serp-key-999'))
    host(shell)
    act(() => openDrawer('add-key', { 'key.provider': 'serpapi' }))
    const drawer = await screen.findByRole('dialog', { name: /Add a SerpApi key/ })
    fireEvent.change(within(drawer).getByLabelText('API key'), {
      target: { value: 'fake-serp-key-999' }
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Test and save' }))
    const alert = await within(drawer).findByRole('alert')
    expect(alert.textContent).not.toContain('fake-serp-key-999')
    expect((within(drawer).getByLabelText('API key') as HTMLInputElement).value).toBe('')
  })
})
