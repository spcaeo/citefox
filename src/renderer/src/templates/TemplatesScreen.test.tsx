// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GENERATION_TEMPLATE_KINDS, isListedTemplateStep } from '@shared/domain'
import type { AssistClient } from '../assist/client'
import { resetM2Memory } from '../mocks/m2/memory'
import { createMockTemplatesClient } from './client'
import { TemplatesScreen } from './TemplatesScreen'

/** The steps the screen lists: planned kinds (Docs/PROMPT-AUDIT.md) stay hidden. */
const LISTED_KINDS = GENERATION_TEMPLATE_KINDS.filter((kind) => isListedTemplateStep(kind, false))

const ADDED = 'Cover every segment in the buyer profile at least once.'

const assistClient: AssistClient = {
  describe: async (request) => ({
    assistId: request.assistId,
    title: 'Improve this template with CiteFox AI',
    label: {
      connection: 'claude-code',
      connectionText: 'CiteFox AI · on your plan',
      expectedSeconds: 10,
      text: 'CiteFox AI · on your plan · about 10 s'
    },
    savedDataOnly: true,
    searchCost: 0,
    acceptsInstruction: true
  }),
  run: async (request) => ({
    runId: 'run-1',
    assistId: request.assistId,
    title: 'Improve this template with CiteFox AI',
    summary: 'One addition.',
    items: [{ id: 'i1', text: ADDED, detail: null, tag: null, verify: null, sign: 'add' }],
    caution: null,
    label: {
      connection: 'claude-code',
      connectionText: 'CiteFox AI · on your plan',
      expectedSeconds: 10,
      text: 'CiteFox AI · on your plan · about 10 s'
    },
    savedDataOnly: true,
    searchesUsed: 0,
    durationMs: 9000,
    model: null
  })
}

beforeEach(() => resetM2Memory())
afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function renderScreen(projectId: string | null = 'textbolt'): void {
  render(
    <TemplatesScreen
      client={createMockTemplatesClient()}
      projectId={projectId}
      assistClient={assistClient}
    />
  )
}

/** The step grid's body rows, in run order. */
// Plain selectors, not role queries: the screen keeps all three tab panels
// mounted (23 steps, the editor and the library), and full-tree role scans
// made these tests slow. Accessible names are checked where it matters.
function stepButtons(): HTMLElement[] {
  const grid = document.querySelector('[role="grid"][aria-label="AI steps"]')
  if (!grid) throw new Error('No step grid yet')
  return Array.from(grid.querySelectorAll<HTMLElement>('[data-row]'))
}

function showTab(name: RegExp): void {
  const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((item) =>
    name.test(item.textContent ?? '')
  )
  if (!tab) throw new Error(`No tab ${String(name)}`)
  fireEvent.click(tab)
}

function editor(): HTMLElement {
  const found = document.querySelector<HTMLElement>('section[aria-label="Template editor"]')
  if (!found) throw new Error('No step editor yet')
  return found
}

/** Opens a step from the Steps tab: its editor tab shows. */
async function openStep(name: RegExp): Promise<void> {
  await waitFor(() => showTab(/^Steps/))
  const row = await waitFor(() => {
    const found = stepButtons().find((item) => name.test(item.textContent ?? ''))
    if (!found) throw new Error(`No step row ${String(name)}`)
    return found
  })
  fireEvent.click(row)
}

async function editBody(next: (current: string) => string): Promise<void> {
  fireEvent.click(within(editor()).getByRole('button', { name: 'Edit' }))
  const area = within(editor()).getByRole('textbox', { name: 'Template' }) as HTMLTextAreaElement
  fireEvent.change(area, { target: { value: next(area.value) } })
}

// Each test drives the whole screen (three mounted tabs, 23 steps, async mock
// client), so give it room on a loaded machine instead of the 5 s default.
describe('TemplatesScreen', { timeout: 20_000 }, () => {
  it('lists every AI step in run order with its status', async () => {
    renderScreen()
    await waitFor(() => expect(stepButtons()).toHaveLength(LISTED_KINDS.length))
    const names = stepButtons().map((button) => button.textContent ?? '')
    expect(names[0]).toContain('Buyer profile')
    expect(names[1]).toContain('Buyer questions')
    expect(names[2]).toContain('Brand questions')
    // Content gaps run as three steps (P1); the combined step is retired and hidden.
    expect(names[3]).toContain('Coverage matrix')
    expect(names[4]).toContain('Page audit')
    expect(names[5]).toContain('Coverage fixes')
    expect(names.some((name) => name.includes('Content gaps'))).toBe(false)
    expect(names[6]).toContain('Overview gap')
    expect(names[7]).toContain('Answer shape')
    expect(names[8]).toContain('Sentiment claims')
    expect(names[9]).toContain('Sentiment fact check')
    expect(names[10]).toContain('Video brief')
    // Topic steps follow in their own group, numbered from 1; Reports comes last.
    expect(names[11]).toContain('Topic seed ideas')
    // The file name is in the name's tooltip, not beside it.
    expect(stepButtons()[11]?.querySelector('[title]')?.getAttribute('title')).toContain(
      'topic_seed_discover'
    )
    expect(stepButtons()[11]?.querySelector('[role="gridcell"]')?.textContent).toBe('1')
    // Ask CiteFox's answer steps come last, in their own group.
    expect(names[names.length - 1]).toContain('Ask: how this screen works')
    expect(names.some((name) => name.includes('Check summary'))).toBe(true)
    const groups = Array.from(
      screen
        .getByRole('grid', { name: 'AI steps', hidden: true })
        .querySelectorAll<HTMLElement>('.ui-lg-gbtn')
    ).map((button) => button.textContent)
    expect(groups).toEqual(['Pages', 'Topics', 'Reports', 'Ask CiteFox'])
    for (const name of names) expect(name).toContain('Default')
    expect(screen.getByText(`${LISTED_KINDS.length} steps`).getAttribute('role')).toBe('status')
    expect(screen.getByRole('tab', { name: /^Edit · Buyer profile/ })).toBeTruthy()
    showTab(/^Edit · /)
    expect(within(editor()).getByRole('heading', { name: 'Buyer profile' })).toBeTruthy()
    expect(
      within(editor()).getByText(
        'Your edits apply to this project only; the default stays available.'
      )
    ).toBeTruthy()
  })

  it('saves a project version, compares it with the default, and resets it', async () => {
    renderScreen()
    await openStep(/Buyer questions/)
    await waitFor(() =>
      expect(within(editor()).getByRole('heading', { name: 'Buyer questions' })).toBeTruthy()
    )
    await editBody((current) => `${current}\nKeep each question under 30 words.`)
    expect(within(editor()).getByText('Unsaved changes')).toBeTruthy()

    fireEvent.click(within(editor()).getByRole('button', { name: 'Compare with default' }))
    const compare = within(editor()).getByRole('region', {
      name: 'Your version compared with the default'
    })
    expect(compare.textContent).toContain('Added: Keep each question under 30 words.')
    expect(compare.textContent).toContain('1 line added')

    fireEvent.click(within(editor()).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(within(editor()).getByText(/^Saved as v1 · hash [0-9a-f]{4}…\. Existing/)).toBeTruthy()
    )
    await waitFor(() =>
      expect(stepButtons()[1]?.textContent).toContain('Overridden for this project')
    )
    expect(stepButtons()[1]?.getAttribute('aria-current')).toBe('true')
    expect(
      within(editor()).getByRole('button', { name: 'Version history: 1 version' })
    ).toBeTruthy()

    fireEvent.click(within(editor()).getByRole('button', { name: 'Reset to default' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Reset Buyer questions to the default?'
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(stepButtons()[1]?.textContent).toContain('Default'))
    expect(within(editor()).getByText(/This project uses the default again/)).toBeTruthy()
    expect(compare.isConnected ? compare.textContent : '').not.toContain('Added:')
  })

  it('shows only the tones buyer prompts allow, and blocks a bad prompt count', async () => {
    renderScreen()
    await openStep(/Buyer questions/)
    const tone = (await waitFor(() => within(editor()).getByLabelText('Tone'))) as HTMLSelectElement
    const options = Array.from(tone.options).map((option) => option.textContent)
    expect(options).toEqual(['As written', 'Plain', 'Conversational'])
    expect(
      within(editor()).getByText(/Buyer questions stay long situational questions/)
    ).toBeTruthy()
    fireEvent.change(within(editor()).getByLabelText('Questions to write'), {
      target: { value: '45' }
    })
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save' }))
    expect(within(editor()).getAllByRole('alert')[0]?.textContent).toMatch(
      /whole number from 1 to 30/
    )
  })

  it('shows output fields and variables for a check step', async () => {
    renderScreen()
    await openStep(/Coverage matrix/)
    const fields = await waitFor(() =>
      screen.getByRole('region', { name: 'Output fields as JSON schema' })
    )
    expect(fields.textContent).toContain('"rows"')
    expect(screen.getByText(/retries once if they don't match/)).toBeTruthy()
    await openStep(/Overview gap/)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Insert {{ aio.text }}' })).toBeTruthy()
    )
    expect(screen.queryByLabelText('Tone')).toBeNull()
    expect(screen.queryByLabelText('Questions to write')).toBeNull()
  })

  it('applies CiteFox AI suggestions to the draft and undoes them', async () => {
    renderScreen()
    await openStep(/Buyer questions/)
    const menu = await waitFor(() =>
      within(editor()).getByRole('button', { name: 'AI actions for this template' })
    )
    fireEvent.click(menu)
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: /Improve this template with CiteFox AI/ })
    )
    const card = await waitFor(() =>
      within(editor()).getByRole('region', { name: 'Improve this template with CiteFox AI' })
    )
    const apply = await waitFor(() => within(card).getByRole('button', { name: 'Apply' }))
    fireEvent.click(apply)
    const area = await waitFor(
      () => within(editor()).getByRole('textbox', { name: 'Template' }) as HTMLTextAreaElement
    )
    await waitFor(() => expect(area.value).toContain(ADDED))
    expect(
      within(editor()).getByText(/Added to the template below\. Review the wording/)
    ).toBeTruthy()
    fireEvent.click(within(editor()).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(area.value).not.toContain(ADDED))
  })

  it('tries the draft on a page and saves nothing', async () => {
    renderScreen()
    await waitFor(() => showTab(/^Edit · /))
    const page = (await waitFor(() => screen.getByLabelText('Page'))) as HTMLSelectElement
    await waitFor(() => expect(page.value).toBe('alerts'))
    await waitFor(() =>
      expect((screen.getByLabelText('Market') as HTMLSelectElement).value).not.toBe('')
    )
    expect(screen.getByText('Uses your AI plan · about 15 s')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run on sample' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'CiteFox AI returned a buyer profile in 12 s. It matched the output fields.'
        )
      ).toBeTruthy()
    )
    expect(screen.getAllByText(/Nothing is saved to the page\./).length).toBeGreaterThan(0)
    expect(screen.getByText('The prompt CiteFox sent')).toBeTruthy()
    expect(stepButtons()[0]?.textContent).toContain('Default')
  })

  it('without a project, the shipped default is read-only and duplicates to edit', async () => {
    renderScreen(null)
    await waitFor(() => expect(stepButtons()).toHaveLength(LISTED_KINDS.length))
    showTab(/^Edit · /)
    expect(within(editor()).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(editor()).getByRole('button', { name: 'Reset to default' })).toHaveProperty(
      'disabled',
      true
    )
    expect(
      screen.getByText('Open a project to try this template on one of its pages.')
    ).toBeTruthy()
    fireEvent.click(within(editor()).getByRole('button', { name: 'Duplicate to edit' }))
    const library = screen.getByRole('region', { name: 'App template editor' })
    await waitFor(() =>
      expect(
        within(library).getByRole('heading', { name: 'Duplicate CiteFox default' })
      ).toBeTruthy()
    )
  })

  it('without a project, a user default is edited in place as the next app version', async () => {
    renderScreen(null)
    await waitFor(() => expect(stepButtons()).toHaveLength(LISTED_KINDS.length))
    showTab(/^Edit · /)
    fireEvent.click(within(editor()).getByRole('button', { name: 'Duplicate to edit' }))
    const library = screen.getByRole('region', { name: 'App template editor' })
    const name = await waitFor(() => within(library).getByLabelText('Name'))
    fireEvent.change(name, { target: { value: 'Night shift' } })
    fireEvent.click(within(library).getByRole('button', { name: 'Duplicate' }))
    await waitFor(() =>
      expect(within(library).getByRole('button', { name: 'Template actions' })).toBeTruthy()
    )
    fireEvent.click(within(library).getByRole('button', { name: 'Template actions' }))
    fireEvent.click(within(library).getByRole('menuitem', { name: 'Set as default' }))
    await waitFor(() => expect(stepButtons()[0]?.textContent).toContain('Edited'))
    showTab(/^Edit · /)
    await editBody((current) => `${current}\nName the region.`)
    fireEvent.change(within(editor()).getByLabelText('Model'), {
      target: { value: 'claude-haiku-5-5' }
    })
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(editor()).getByText(/^Saved as v2 · hash/)).toBeTruthy())
    expect((within(editor()).getByLabelText('Model') as HTMLSelectElement).value).toBe(
      'claude-haiku-5-5'
    )
    showTab(/^App templates/)
    const row = within(screen.getByRole('grid', { name: 'App templates' })).getByRole('row', {
      name: /Night shift/
    })
    await waitFor(() => expect(row.querySelector('[title^="v2 · "]')?.textContent).toBe('v2'))
  })
})
