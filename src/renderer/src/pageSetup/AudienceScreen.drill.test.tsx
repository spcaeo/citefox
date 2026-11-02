// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PageDetail } from '@shared/ipc'
import { createMockAssistClient } from '../assist/client'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockShellClient } from '../projects/mockClient'
import { pageHash } from '../shell/routes'
import { createMockTemplatesClient } from '../templates/client'
import { AudienceScreen } from './AudienceScreen'

function page(pageId: string): PageDetail {
  return createProjectMemory(textboltCatalog()).getPage('textbolt', pageId)
}

function screen(): ReturnType<typeof render> {
  return render(
    <AudienceScreen
      assistClient={createMockAssistClient()}
      client={createMockShellClient({
        catalog: textboltCatalog(),
        activeStore: memoryActiveProjectStore()
      })}
      templatesClient={createMockTemplatesClient()}
      projectId="textbolt"
      page={page('alerts')}
    />
  )
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => cleanup())

function drillButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[data-nfr-drill^="audience:"]')]
}

describe('Buyer profile drill-downs', () => {
  it('trigger, segment and value counts open a drawer with exactly that many questions', async () => {
    const view = screen()
    await waitFor(() => expect(drillButtons(view.container).length).toBeGreaterThan(0))
    const ids = drillButtons(view.container).map((button) => button.dataset.nfrDrill ?? '')
    expect(ids.some((id) => id.startsWith('audience:trigger:'))).toBe(true)
    for (const id of ids) {
      const button = view.container.querySelector<HTMLButtonElement>(`[data-nfr-drill="${id}"]`)
      if (!button) throw new Error(`missing ${id}`)
      const figure = button.querySelector(`[data-nfr-figure="${id}"]`)?.textContent ?? ''
      button.focus()
      fireEvent.click(button)
      const dialog = view.getByRole('dialog')
      const heading = within(dialog).getByRole('heading', { level: 2 }).textContent ?? ''
      expect(heading).toMatch(new RegExp(`· ${figure} questions?$`))
      expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(Number(figure))
      for (const link of within(dialog).queryAllByRole('link')) {
        expect(link.getAttribute('href')).toMatch(/^#\/pages\/alerts\/prompt\//)
      }
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(view.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(button)
    }
  })

  it('the markets footer links to the Markets tab', async () => {
    const view = screen()
    const link = await waitFor(() => view.getByRole('link', { name: /^all \d+ markets$/ }))
    expect(link.getAttribute('href')).toBe(pageHash('alerts', 'markets'))
  })
})
