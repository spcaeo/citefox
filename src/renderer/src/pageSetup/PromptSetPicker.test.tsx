// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PromptSetRef, PromptSetView } from '@shared/domain'
import type { PromptSetList, SetActivePromptSetRequest } from '@shared/ipc'
import { PromptSetPicker } from './PromptSetPicker'
import { promptSetLabel, type PromptSetsClient } from './promptSets'

afterEach(cleanup)

function ref(
  id: string,
  createdAt: string,
  isActive: boolean,
  templateName: string | null
): PromptSetRef {
  return {
    id,
    createdAt,
    templateId: templateName === null ? null : 'tpl-buyer-prompts',
    templateName,
    promptCount: 10,
    isActive
  }
}

function view(promptSetId: string, dirty = false): PromptSetView {
  return {
    pageId: 'page-1',
    promptSetId,
    version: 3,
    savedAt: '2026-10-20T12:00:00.000Z',
    icpId: 'icp-1',
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: 'a'.repeat(64),
    templateUpdatedAt: null,
    dirty,
    nextVersion: dirty ? 4 : null,
    prompts: [],
    brandsClear: true,
    brandMessage: '',
    nextCheck: { prompts: 0, markets: 0, samples: 1, minSearches: 0, maxSearches: 0 }
  }
}

const SETS: readonly PromptSetRef[] = [
  ref('pset-3', '2026-10-20T12:00:00.000Z', true, 'CiteFox default'),
  ref('pset-2', '2026-10-18T09:30:00.000Z', false, null),
  ref('pset-1', '2026-10-15T08:00:00.000Z', false, 'Field teams')
]

function fakeClient(sets: readonly PromptSetRef[]): PromptSetsClient & {
  setActive: ReturnType<
    typeof vi.fn<(request: SetActivePromptSetRequest) => Promise<PromptSetView>>
  >
} {
  return {
    listSets: (): Promise<PromptSetList> => Promise.resolve({ pageId: 'page-1', sets }),
    setActive: vi.fn((request: SetActivePromptSetRequest) =>
      Promise.resolve(view(request.promptSetId))
    )
  }
}

describe('PromptSetPicker', () => {
  it('lists saved sets newest first with template and date, and switches the set in use', async () => {
    const client = fakeClient(SETS)
    const switched: string[] = []
    render(
      <PromptSetPicker
        client={client}
        projectId="proj-1"
        pageId="page-1"
        view={view('pset-3')}
        onSwitched={(next) => switched.push(next.promptSetId ?? '')}
      />
    )
    const select = await screen.findByLabelText('Question set version')
    const options = [...(select as HTMLSelectElement).options].map((option) => option.text)
    expect(options).toEqual(SETS.map((set) => promptSetLabel(set)))
    expect(options[0]).toContain('CiteFox default · 10 questions (in use)')
    expect(options[1]).toContain('Written by hand')
    expect((select as HTMLSelectElement).value).toBe('pset-3')
    fireEvent.change(select, { target: { value: 'pset-1' } })
    await waitFor(() => expect(switched).toEqual(['pset-1']))
    expect(client.setActive).toHaveBeenCalledWith({
      projectId: 'proj-1',
      pageId: 'page-1',
      promptSetId: 'pset-1'
    })
    expect(document.body.textContent?.toLowerCase().includes('lock')).toBe(false)
  })

  it('stays hidden with one saved set and is disabled while edits are unsaved', async () => {
    const single = render(
      <PromptSetPicker
        client={fakeClient(SETS.slice(0, 1))}
        projectId="proj-1"
        pageId="page-1"
        view={view('pset-3')}
        onSwitched={() => undefined}
      />
    )
    await waitFor(() => expect(single.container.innerHTML).toBe(''))
    single.unmount()

    render(
      <PromptSetPicker
        client={fakeClient(SETS)}
        projectId="proj-1"
        pageId="page-1"
        view={view('pset-3', true)}
        onSwitched={() => undefined}
      />
    )
    const select = await screen.findByLabelText('Question set version')
    expect((select as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('Save or discard your edits before you switch versions.')).toBeTruthy()
  })
})
