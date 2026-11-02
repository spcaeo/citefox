// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetM2Memory, getM2Memory } from '../mocks/m2/memory'
import { rememberTemplateUse } from '../mocks/m2/templates'
import { pageHash } from '../shell/routes'
import { createMockTemplatesClient, type TemplatesClient } from './client'
import { TemplatesScreen } from './TemplatesScreen'

/**
 * Templates drill-downs (REPORT-SPEC "Interaction model", NFR-14): a step's
 * version and last run, and an app template's usage count, each open the
 * shared drawer with exactly the rows behind them.
 */

let client: TemplatesClient

beforeEach(() => {
  resetM2Memory()
  window.location.hash = ''
  client = createMockTemplatesClient()
})
afterEach(cleanup)

async function shippedProfileId(): Promise<string> {
  const list = await client.list({})
  const profile = list.find((item) => item.kind === 'buyer_profile' && item.isDefault)
  if (!profile) throw new Error('no shipped buyer profile template')
  return profile.id
}

function seedUses(templateId: string, pages: readonly string[]): void {
  pages.forEach((pageId, index) => {
    rememberTemplateUse({
      projectId: 'textbolt',
      pageId,
      templateId,
      bucket: 'buyerProfiles',
      at: `2026-10-0${index + 1}T10:00:00.000Z`
    })
  })
}

function drawer(): HTMLElement {
  return screen.getByRole('dialog')
}

function rows(): NodeListOf<Element> {
  return drawer().querySelectorAll('[data-drill-row]')
}

async function showTab(name: RegExp): Promise<void> {
  fireEvent.click(await waitFor(() => screen.getByRole('tab', { name })))
}

function grid(name: string): HTMLElement {
  return screen.getByRole('grid', { name })
}

describe('Templates drill-downs', { timeout: 20_000 }, () => {
  it('a usage count opens exactly the saved artifacts behind it, and rows open the page tab', async () => {
    const id = await shippedProfileId()
    seedUses(id, ['page-a', 'page-b', 'page-c'])
    render(<TemplatesScreen client={client} projectId="textbolt" />)
    await showTab(/^App templates/)
    const opener = await waitFor(() =>
      within(grid('App templates')).getByRole('button', {
        name: /^Where it was used: 3 buyer profiles/
      })
    )
    expect(opener.tagName).toBe('BUTTON')
    fireEvent.click(opener)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(within(drawer()).getByRole('heading', { level: 2 }).textContent).toContain(
      '3 buyer profiles'
    )
    expect(rows()).toHaveLength(3)
    const first = drawer().querySelector<HTMLElement>('[data-drill-row="0"]')
    if (!first) throw new Error('no first row')
    first.focus()
    fireEvent.keyDown(first, { key: 'Enter' })
    expect(window.location.hash).toBe(pageHash('page-c', 'audience'))
    // The new route has no drawer: it closes when the route change lands.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a zero count is plain text, not a drill', async () => {
    render(<TemplatesScreen client={client} projectId="textbolt" />)
    await showTab(/^App templates/)
    const group = await waitFor(() => grid('App templates'))
    await waitFor(() => expect(group.textContent).toContain('0 buyer profiles'))
    expect(within(group).queryByRole('button', { name: /^Where it was used/ })).toBeNull()
  })

  it("a step's last run opens the AI calls behind it", async () => {
    const id = await shippedProfileId()
    seedUses(id, ['page-a', 'page-b'])
    render(<TemplatesScreen client={client} projectId="textbolt" />)
    const list = await waitFor(() => grid('AI steps'))
    const lastRun = await waitFor(
      () => within(list).getAllByRole('button', { name: /^AI calls: Last run/ })[0]
    )
    if (!lastRun) throw new Error('no last-run button')
    fireEvent.click(lastRun)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(within(drawer()).getByRole('heading', { level: 2 }).textContent).toBe(
      'Buyer profile: AI calls · 2 calls'
    )
    expect(rows()).toHaveLength(2)
    expect(drawer().textContent).toContain('v1')
  })

  it("a step's version opens its history; the count in the editor equals the drawer rows", async () => {
    render(<TemplatesScreen client={client} projectId="textbolt" />)
    const list = await waitFor(() => grid('AI steps'))
    const version = within(list).getAllByRole('button', { name: /^Version history: v1/ })[0]
    if (!version) throw new Error('no version button')
    fireEvent.click(version)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(within(drawer()).getByRole('heading', { level: 2 }).textContent).toBe(
      'Buyer profile: version history · 1 version'
    )
    expect(rows()).toHaveLength(1)
    fireEvent.keyDown(drawer(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Without a project, the editor lists the app template's versions.
    cleanup()
    render(<TemplatesScreen client={client} projectId={null} />)
    await showTab(/^Edit · /)
    const editor = await waitFor(() => screen.getByRole('region', { name: 'Template editor' }))
    const count = await waitFor(() =>
      within(editor).getByRole('button', { name: 'Version history: 1 version' })
    )
    const figure = count.querySelector('[data-nfr-figure]')
    fireEvent.click(count)
    expect(rows()).toHaveLength(Number(figure?.textContent))
  })

  it('a deleted template previews its body before restore, and variables show an example', async () => {
    const id = await shippedProfileId()
    const copy = await client.create({
      kind: 'buyer_profile',
      fromId: id,
      name: 'Old profile',
      notes: null
    })
    await client.delete({ id: copy.id })
    render(<TemplatesScreen client={client} projectId="textbolt" />)
    await showTab(/^App templates/)
    const toggle = await waitFor(() => screen.getByRole('button', { name: /deleted/i }))
    fireEvent.click(toggle)
    const preview = screen.getByRole('button', { name: 'Preview Old profile' })
    expect(preview.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(preview)
    expect(preview.getAttribute('aria-expanded')).toBe('true')
    const region = screen.getByRole('region', { name: 'Old profile' })
    expect(region.textContent?.length).toBeGreaterThan(0)

    await showTab(/^Edit · /)
    const example = screen.getByRole('button', { name: 'Example value for url' })
    fireEvent.click(example)
    expect(example.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('https://example.com/blog/business-texting-guide/')).toBeTruthy()
  })

  it('#/templates/<id> opens that template under its step', async () => {
    const id = await shippedProfileId()
    const copy = await client.create({
      kind: 'buyer_profile',
      fromId: id,
      name: 'Focused profile',
      notes: null
    })
    expect(getM2Memory().templates.some((item) => item.id === copy.id)).toBe(true)
    render(<TemplatesScreen client={client} projectId="textbolt" focusId={copy.id} />)
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'App template editor' }).textContent).toContain(
        'Focused profile'
      )
    )
    expect(screen.getByRole('tab', { name: /^App templates/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
    const picked = within(grid('App templates'))
      .getAllByRole('row')
      .find((row) => row.getAttribute('aria-current') === 'true')
    expect(picked?.textContent).toContain('Focused profile')
  })
})
