// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/ipc'
import { NO_UPDATE, type UpdatesClient } from '../account/client'
import { UpdateBanner } from './UpdateBanner'
import { resetUpdateStore } from './updateStore'

afterEach(() => {
  cleanup()
  resetUpdateStore()
})

const NEWER: UpdateStatus = {
  available: true,
  dismissed: false,
  failed: false,
  checkedAt: '2026-11-02T13:00:00.000Z',
  latest: {
    version: '0.13.0',
    build: 1500,
    notesUrl: 'https://github.com/spcaeo/citefox/releases/tag/v0.13.0',
    downloadUrl:
      'https://github.com/spcaeo/citefox/releases/download/v0.13.0/CiteFox-0.13.0-universal.dmg'
  }
}

function fake(status: UpdateStatus): UpdatesClient & { dismissed: unknown[] } {
  const dismissed: unknown[] = []
  return {
    dismissed,
    get: () => Promise.resolve(status),
    check: () => Promise.resolve(status),
    dismiss: (request) => {
      dismissed.push(request)
      return Promise.resolve({ ...status, dismissed: true })
    }
  }
}

describe('the new-version banner', () => {
  it('says which version is out, links What’s new and the download for this computer', async () => {
    resetUpdateStore(fake(NEWER))
    const view = render(<UpdateBanner />)
    const banner = await view.findByRole('region', { name: 'New version' })
    expect(banner.textContent).toContain('CiteFox v0.13.0 is out')
    const notes = view.getByRole('link', { name: 'What’s new' })
    expect(notes.getAttribute('href')).toBe(NEWER.latest?.notesUrl)
    expect(notes.getAttribute('target')).toBe('_blank')
    const download = view.getByRole('link', { name: 'Download' })
    expect(download.getAttribute('href')).toBe(NEWER.latest?.downloadUrl)
    expect(download.getAttribute('rel')).toContain('noopener')
  })

  it('closing it hides it until the next version', async () => {
    const client = fake(NEWER)
    resetUpdateStore(client)
    const view = render(<UpdateBanner />)
    await view.findByRole('region', { name: 'New version' })
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Hide until the next version' }))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(view.queryByRole('region', { name: 'New version' })).toBeNull()
    })
    expect(client.dismissed).toEqual([{ version: '0.13.0', build: 1500 }])
  })

  it('shows nothing when this is the newest, when dismissed, or without a bridge', async () => {
    for (const status of [NO_UPDATE, { ...NEWER, dismissed: true }]) {
      const client = fake(status)
      const get = vi.spyOn(client, 'get')
      resetUpdateStore(client)
      const view = render(<UpdateBanner />)
      await waitFor(() => {
        expect(get).toHaveBeenCalled()
      })
      expect(view.container.textContent).toBe('')
      cleanup()
    }
    resetUpdateStore(null)
    expect(render(<UpdateBanner />).container.textContent).toBe('')
  })
})
