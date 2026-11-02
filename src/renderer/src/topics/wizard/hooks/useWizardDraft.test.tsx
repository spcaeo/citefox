// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT, recordingClient, resetMockStore, savedDraft } from '../harness.test-helper'
import { useWizardDraft } from './useWizardDraft'

beforeEach(resetMockStore)
afterEach(cleanup)

describe('useWizardDraft', () => {
  it('loads the draft, shows edits at once and saves them as one merged patch', async () => {
    const { client, calls } = recordingClient()
    const draft = await savedDraft(client, 'seed')
    const before = calls.length
    const { result } = renderHook(() => useWizardDraft(client, PROJECT.id, draft.id))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.draft?.id).toBe(draft.id))
    act(() => {
      result.current.patch({ name: 'One' })
      result.current.patch({ name: 'Two', about: 'Alerts' })
    })
    expect(result.current.draft?.name).toBe('Two')
    await waitFor(() => expect(result.current.saveState).toBe('saved'))
    const saves = calls.slice(before).filter((call) => call.channel === 'topics:updateDraft')
    expect(saves).toHaveLength(1)
    expect(saves[0]?.request).toMatchObject({
      draftId: draft.id,
      patch: { name: 'Two', about: 'Alerts' }
    })
  })

  it('survives a restart: a new hook reads the saved draft back', async () => {
    const { client } = recordingClient()
    const draft = await savedDraft(client, 'seed')
    const first = renderHook(() => useWizardDraft(client, PROJECT.id, draft.id))
    await waitFor(() => expect(first.result.current.draft).not.toBeNull())
    act(() => first.result.current.patch({ step: 'profile', name: 'Kept' }))
    await act(async () => {
      await first.result.current.flush()
    })
    first.unmount()
    const second = renderHook(() => useWizardDraft(recordingClient().client, PROJECT.id, draft.id))
    await waitFor(() => expect(second.result.current.draft?.name).toBe('Kept'))
    expect(second.result.current.draft?.step).toBe('profile')
  })

  it('keeps unsaved edits on top of a draft a AI step returns', async () => {
    const { client } = recordingClient()
    const draft = await savedDraft(client, 'seed')
    const { result } = renderHook(() => useWizardDraft(client, PROJECT.id, draft.id))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const written = await client['topics:writeProfile']({
      projectId: PROJECT.id,
      draftId: draft.id
    })
    act(() => {
      result.current.patch({ name: 'Mine' })
      result.current.replace(written)
    })
    expect(result.current.draft?.name).toBe('Mine')
    expect(result.current.draft?.profile?.current).toBe(1)
  })

  it('says why a missing draft cannot open', async () => {
    const { client } = recordingClient()
    const { result } = renderHook(() => useWizardDraft(client, PROJECT.id, 'draft-gone'))
    await waitFor(() => expect(result.current.loadError).toMatch(/gone/))
    expect(result.current.loading).toBe(false)
  })
})
