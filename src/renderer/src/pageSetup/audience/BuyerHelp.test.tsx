// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HelpFillResult } from '@shared/ipc'
import { createMockAssistClient } from '../../assist/client'
import { textboltCatalog } from '../../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore, resetM2Memory } from '../../mocks/m2/memory'
import { createMockShellClient } from '../../projects/mockClient'
import { resetDrawersForTests } from '../../shell/drawers'
import { createMockTemplatesClient } from '../../templates/client'
import { UndoToastHost, type HelpFillSource } from '../../ui'
import { axeViolations } from '../../ui/axe.test-helper'
import { AudienceScreen } from '../AudienceScreen'

/** ✦ Help me fill this on the buyer profile, with the helper's channels faked. */

const ANSWER: HelpFillResult = {
  kind: 'buyers',
  rows: [
    {
      id: 'row-1',
      section: null,
      values: {
        who: 'Clinic office managers',
        problem: 'Shift changes get lost in email',
        trigger: 'A nurse missed a shift change',
        need: 'Texts from Outlook'
      }
    }
  ],
  setAside: [],
  counts: { read: 2, tracked: 1, repeats: 0, setAside: 0, ready: 1 },
  noun: ['buyer type', 'buyer types'],
  brand: 'TextBolt',
  warnings: []
}

function fakeSource(): HelpFillSource & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    'helpfill:estimate': async ({ kind }) => {
      calls.push(`estimate:${kind}`)
      return {
        kind,
        available: true,
        calls: 2,
        costText: '2 AI calls · about $0.03',
        reason: null
      }
    },
    'helpfill:prompt': async ({ kind, scope }) => {
      calls.push(`prompt:${kind}:${scope.pageId ?? ''}`)
      return { kind, prompt: 'You help a company describe…', columns: ['who'], tracked: 1 }
    },
    'helpfill:read': async ({ kind, text }) => {
      calls.push(`read:${kind}:${text}`)
      return ANSWER
    },
    'helpfill:describe': async ({ kind, sentence }) => {
      calls.push(`describe:${kind}:${sentence}`)
      return ANSWER
    }
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

function renderScreen(source: HelpFillSource): ReturnType<typeof render> {
  const client = createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
  const page = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')
  return render(
    <>
      <AudienceScreen
        assistClient={createMockAssistClient()}
        client={client}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page}
        pipelineSource={null}
        helpFillSource={source}
      />
      <UndoToastHost />
    </>
  )
}

beforeEach(() => {
  resetM2Memory()
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/pages/alerts/audience')
})

afterEach(() => cleanup())

describe('Buyer profile → Help me fill this', () => {
  it('opens from the AI menu onto the URL and closes again', async () => {
    renderScreen(fakeSource())
    await screen.findByRole('grid', { name: 'Buyer profile points' })
    fireEvent.click(screen.getByRole('button', { name: 'AI actions for the buyer profile' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Help me fill this/u }))
    await waitFor(() => expect(window.location.hash).toContain('au.help=describe'))
    expect(await screen.findByLabelText(/best customers/u)).toBeTruthy()
    expect(await screen.findByText('2 AI calls · about $0.03')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close the helper' }))
    await waitFor(() => expect(window.location.hash).not.toContain('au.help'))
    expect(screen.queryByLabelText(/best customers/u)).toBeNull()
  })

  it('reads a pasted answer into the review card; Add saves the ticked points', async () => {
    window.history.replaceState(
      null,
      '',
      '#/pages/alerts/audience?au.help=chatbot&au.bot=perplexity'
    )
    const source = fakeSource()
    const { container } = renderScreen(source)
    const box = await screen.findByRole('textbox', { name: 'Paste its answer below' })
    await waitFor(() => expect(source.calls).toContain('prompt:buyers:alerts'))
    fireEvent.change(box, {
      target: { value: 'who,problem,trigger,need\nClinic office managers,…' }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Read the answer' }))
      await settle()
    })
    expect(source.calls.some((call) => call.startsWith('read:buyers:who,problem'))).toBe(true)
    const card = await screen.findByRole('region', { name: 'Buyer types to add' })
    expect(within(card).getByText('1 segment · 1 trigger event · 1 value')).toBeTruthy()
    expect(within(card).getAllByRole('checkbox')).toHaveLength(3)
    // Untick the value, then add the rest.
    fireEvent.click(within(card).getByRole('checkbox', { name: /Texts from Outlook/u }))
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Add to the profile' }))
      await settle()
    })
    const grid = screen.getByRole('grid', { name: 'Buyer profile points' })
    await waitFor(() => expect(within(grid).getByText('Clinic office managers')).toBeTruthy())
    expect(within(grid).getByText('A nurse missed a shift change')).toBeTruthy()
    expect(within(grid).queryByText('Texts from Outlook')).toBeNull()
    expect(within(card).getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(await axeViolations(container)).toEqual([])
  })
})
