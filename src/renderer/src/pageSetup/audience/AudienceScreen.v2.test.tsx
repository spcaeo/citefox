// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageDetail, PagePipeline, SetupProgress } from '@shared/ipc'
import { createMockAssistClient } from '../../assist/client'
import { textboltCatalog } from '../../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../../mocks/m2/memory'
import { createMockShellClient } from '../../projects/mockClient'
import { createMockTemplatesClient } from '../../templates/client'
import { axeViolations } from '../../ui/axe.test-helper'
import { AudienceScreen } from '../AudienceScreen'
import { derivedPipeline, type PipelineSource } from '../pipeline'

afterEach(() => cleanup())

const base = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')

function client(): ReturnType<typeof createMockShellClient> {
  return createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
}

function screen(page: PageDetail, source?: PipelineSource | null): ReturnType<typeof render> {
  return render(
    <AudienceScreen
      assistClient={createMockAssistClient()}
      client={client()}
      templatesClient={createMockTemplatesClient()}
      projectId="textbolt"
      page={page}
      pipelineSource={source ?? null}
    />
  )
}

/** A bridge whose page is still writing its buyer profile. */
function writingProfile(page: PageDetail): PipelineSource {
  const derived = derivedPipeline({ ...page, setupStep: 'profile', promptSetVersion: null })
  const pipeline: PagePipeline = {
    ...derived,
    state: 'running',
    startedAt: new Date(Date.now() - 12_000).toISOString(),
    message: 'CiteFox AI is writing the buyer profile from the page.',
    steps: derived.steps.map((step) =>
      step.id === 'read'
        ? { ...step, state: 'done' }
        : step.id === 'profile'
          ? { ...step, state: 'running' }
          : step
    )
  }
  return {
    page: () => Promise.resolve(pipeline),
    start: () => Promise.resolve(pipeline),
    stop: () => Promise.resolve({ ...pipeline, state: 'stopped' }),
    checkWhenReady: ({ on }) => Promise.resolve({ checkWhenReady: on }),
    onProgress: (listener: (progress: SetupProgress) => void) => {
      void listener
      return () => undefined
    }
  }
}

describe('Buyer profile tab (v2)', () => {
  it('shows the live setup panel while the profile is being written, with no Generate button', async () => {
    const view = screen(base, writingProfile(base))
    const panel = await view.findByRole('region', { name: 'Setting up this page' })
    const steps = within(panel).getByRole('list', { name: 'Setup steps' })
    expect(
      within(steps).getByText('Buyer profile').closest('li')?.getAttribute('aria-current')
    ).toBe('step')
    expect(
      within(panel).getByText('CiteFox AI is writing the buyer profile from the page.')
    ).toBeTruthy()
    expect(view.queryByRole('button', { name: /Generate buyer profile/ })).toBeNull()
    expect(view.queryByRole('grid', { name: 'Buyer profile points' })).toBeNull()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('a page still waiting on setup shows the panel from its own setup step', async () => {
    const view = screen({ ...base, setupStep: 'read', promptSetVersion: null })
    expect(await view.findByRole('region', { name: 'Setting up this page' })).toBeTruthy()
  })

  it('reviews the points grouped by section, with one AI menu and no primary button', async () => {
    const view = screen(base)
    const grid = await view.findByRole('grid', { name: 'Buyer profile points' })
    await waitFor(() => expect(within(grid).getByText('Who they are')).toBeTruthy())
    for (const section of ['Their environment', 'Trigger events', 'What they value']) {
      expect(within(grid).getByText(section)).toBeTruthy()
    }
    expect(view.getAllByRole('button', { name: 'AI actions for the buyer profile' })).toHaveLength(
      1
    )
    expect(view.container.querySelectorAll('.ui-btn-primary')).toHaveLength(0)
    expect(view.queryByRole('combobox', { name: /Template/ })).toBeNull()
    expect(view.getByRole('region', { name: 'This version' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('opens Profile settings with the template and Regenerate', async () => {
    const view = screen(base)
    await view.findByRole('grid', { name: 'Buyer profile points' })
    fireEvent.click(view.getByRole('button', { name: 'Profile settings' }))
    expect(window.location.hash).toContain('drawer=au-settings')
    const dialog = await view.findByRole('dialog', { name: 'Profile settings' })
    expect(within(dialog).getByRole('button', { name: 'Regenerate' })).toBeTruthy()
    expect(within(dialog).getByText(/About 20 s on your AI plan/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Expert options/ }))
    expect(within(dialog).getByLabelText('Template')).toBeTruthy()
    expect(await axeViolations(dialog)).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Profile settings' }))
    expect(view.queryByRole('dialog', { name: 'Profile settings' })).toBeNull()
    await waitFor(() => expect(window.location.hash).not.toContain('drawer='))
  })

  it('adds a point from the editor and removes it from its row menu', async () => {
    const view = screen(base)
    const grid = await view.findByRole('grid', { name: 'Buyer profile points' })
    fireEvent.click(view.getByRole('button', { name: 'Add point' }))
    const editor = view.getByRole('region', { name: 'Add a point' })
    fireEvent.change(within(editor).getByLabelText('Point'), {
      target: { value: 'A weekend outage nobody saw' }
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(grid).getByText('A weekend outage nobody saw')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'Actions for A weekend outage nobody saw' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Remove' }))
    await waitFor(() => expect(within(grid).queryByText('A weekend outage nobody saw')).toBeNull())
  })
})
