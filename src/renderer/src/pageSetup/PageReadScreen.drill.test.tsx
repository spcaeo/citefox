// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PageDetail } from '@shared/ipc'
import { createMockAssistClient } from '../assist/client'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockShellClient } from '../projects/mockClient'
import { pageHash, promptHash } from '../shell/routes'
import { resetAutoReads } from './autoRead'
import { PageReadScreen } from './PageReadScreen'

function page(pageId: string): PageDetail {
  return createProjectMemory(textboltCatalog()).getPage('textbolt', pageId)
}

function screen(): ReturnType<typeof render> {
  return render(
    <PageReadScreen
      assistClient={createMockAssistClient()}
      client={createMockShellClient({
        catalog: textboltCatalog(),
        activeStore: memoryActiveProjectStore()
      })}
      projectId="textbolt"
      page={page('alerts')}
    />
  )
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  resetAutoReads()
})

function drillButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[data-nfr-drill^="read:"]')]
}

describe('Page read drill-downs', () => {
  it('every question count opens a drawer whose total equals the number clicked', async () => {
    const view = screen()
    await waitFor(() => expect(drillButtons(view.container).length).toBeGreaterThan(2))
    const ids = drillButtons(view.container).map((button) => button.dataset.nfrDrill ?? '')
    expect(ids).toContain('read:promises')
    expect(ids.some((id) => id.startsWith('read:section:'))).toBe(true)
    expect(ids.some((id) => id.startsWith('read:faq:'))).toBe(true)
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
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(view.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(button)
    }
  }, 30_000)

  it('a drawer row opens Question detail in the page market', async () => {
    const view = screen()
    await waitFor(() =>
      expect(view.container.querySelector('[data-nfr-drill="read:promises"]')).not.toBeNull()
    )
    fireEvent.click(view.container.querySelector('[data-nfr-drill="read:promises"]') as Element)
    const dialog = view.getByRole('dialog')
    const row = dialog.querySelector<HTMLElement>('[data-drill-row="0"]')
    if (!row) throw new Error('no row')
    fireEvent.keyDown(row, { key: 'Enter' })
    const detail = page('alerts')
    expect(window.location.hash).toBe(
      promptHash(detail.id, 'p1', { marketId: detail.defaultMarketId })
    )
  })

  it('market tags, snapshot and fingerprint link to their tabs', async () => {
    const view = screen()
    const detail = page('alerts')
    await waitFor(() => expect(view.getByText(/content fingerprint/)).toBeTruthy())
    const markets = within(view.getByRole('group', { name: 'Markets' })).getAllByRole('link')
    expect(markets).toHaveLength(detail.markets.length)
    expect(markets[0]?.getAttribute('href')).toBe(
      pageHash(detail.id, 'markets', { marketId: detail.markets[0]?.id ?? null })
    )
    expect(
      view.getByRole('link', { name: 'Compare content in History' }).getAttribute('href')
    ).toBe(pageHash(detail.id, 'history'))
  })

  it('a flag expands to explain itself with both values, and Escape closes it', async () => {
    const view = screen()
    await waitFor(() => expect(view.getByText(/content fingerprint/)).toBeTruthy())
    const flag = view.getByRole('button', { name: /title tag$/ })
    expect(flag.getAttribute('aria-expanded')).toBe('false')
    flag.focus()
    fireEvent.click(flag)
    expect(flag.getAttribute('aria-expanded')).toBe('true')
    const note = view.getAllByRole('note')[0]
    expect(note?.textContent).toContain('Title tag')
    expect(note?.textContent).toContain('H1')
    fireEvent.keyDown(flag, { key: 'Escape' })
    expect(flag.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(flag)
  })

  it('the outline filter shows H3s only, and the FAQs list every question', async () => {
    const view = screen()
    await waitFor(() => expect(view.getByText(/content fingerprint/)).toBeTruthy())
    const outline = view.getByRole('region', { name: 'Outline' })
    const rows = (): HTMLElement[] => within(outline).getAllByRole('row').slice(1)
    const all = rows().length
    const h3 = within(outline).getByRole('button', { name: /^H3 headings/ })
    fireEvent.click(h3)
    expect(h3.getAttribute('aria-pressed')).toBe('true')
    const shown = rows()
    expect(shown.length).toBeLessThan(all)
    for (const row of shown) expect(row.textContent).toContain('H3')
    fireEvent.click(within(outline).getByRole('button', { name: /^All/ }))
    expect(rows()).toHaveLength(all)

    const faqs = view.getByRole('region', { name: 'FAQs' })
    expect(view.getByRole('heading', { name: /^FAQs found \(\d+\)$/ })).toBeTruthy()
    expect(within(faqs).getAllByRole('row').length).toBeGreaterThan(1)
  })
})
