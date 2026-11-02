// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SetupDraft, SetupSectionId, SetupSectionResult } from '@shared/ipc'
import { BuyersStep } from '../steps/BuyersStep'
import { CompetitorsStep } from '../steps/CompetitorsStep'
import { BrandStep } from '../steps/BrandStep'
import { fakeSectionClient, item, row, textboltDraft } from './fakeClient.test-helper'
import { StepHarness } from './StepHarness.test-helper'
import { parseOpen } from './useSectionUrl'

afterEach(cleanup)

beforeEach(() => {
  window.location.hash = '#/setup/buyers'
})

function query(key: string): string | null {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return at < 0 ? null : new URLSearchParams(hash.slice(at + 1)).get(key)
}

function text(el: Element | null | undefined): string {
  return el?.textContent ?? ''
}

function value(el: Element | null | undefined): string {
  return (el as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? ''
}

function buyersDraft(): SetupDraft {
  return textboltDraft({
    buyers: [
      item('IT sysadmin', { id: 'b1', detail: 'Datadog alerts stopped.' }),
      item('Practice manager', { id: 'b2' }),
      item('Library admin', { id: 'b3', kept: false }),
      item('Property manager', { id: 'b4', origin: 'user' })
    ],
    triggers: [item('AT&T gateway shut down', { id: 'g1' })]
  })
}

function card(name: string): HTMLElement {
  return screen.getByTestId(`section-${name}`)
}

function names(rows: readonly { name: string }[]): string[] {
  return rows.map((entry) => entry.name)
}

describe('parseOpen', () => {
  it('reads <section>.<panel> and refuses anything else', () => {
    expect(parseOpen('buyers.redo')).toEqual({ section: 'buyers', panel: 'redo' })
    expect(parseOpen('switchingFrom.menu')).toEqual({ section: 'switchingFrom', panel: 'menu' })
    expect(parseOpen('buyers.nope')).toBeNull()
    expect(parseOpen('redo')).toBeNull()
    expect(parseOpen(null)).toBeNull()
  })
})

describe('list section: Find more', () => {
  it('puts new rows on top marked "new"; the next action clears the marks', async () => {
    const client = fakeSectionClient({
      rows: { buyers: [row('Alarm installer'), row('IT sysadmin')] }
    })
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BuyersStep}
        initial={buyersDraft()}
        client={client}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const buyers = card('buyers')
    await waitFor(() => expect(client.sectionEstimate).toHaveBeenCalled())
    fireEvent.click(within(buyers).getByRole('button', { name: /Find more/ }))
    await waitFor(() => expect(within(buyers).getAllByTestId('section-row')).toHaveLength(5))
    const rows = within(buyers).getAllByTestId('section-row')
    expect(text(rows[0])).toContain('Alarm installer')
    expect(text(within(rows[0]!).getByTestId('row-tag'))).toBe('new')
    expect(within(buyers).getByText(/1 buyer added at the top/)).toBeTruthy()
    const call = client.sectionRun.mock.calls[0]![0]
    expect(call.mode).toBe('more')
    expect(call.instruction).toBeNull()
    expect(names(call.current)).toContain('Library admin')
    expect(call.context.domain).toBe('textbolt.com')

    fireEvent.click(within(buyers).getByRole('checkbox', { name: 'Keep Practice manager' }))
    expect(seen!.lists.buyers.some((entry) => entry.fresh)).toBe(false)
    expect(within(buyers).queryByText('new')).toBeNull()
  })
})

describe('list section: working while ✦ runs', () => {
  it('shows the top bar, the busy line with its timer and a busy button that cannot run twice', async () => {
    const client = fakeSectionClient({ rows: { buyers: [row('Alarm installer')] } })
    let answer: () => void = () => undefined
    client.sectionRun.mockImplementation(
      ({ section }: { section: SetupSectionId }) =>
        new Promise<SetupSectionResult>((resolve) => {
          answer = () =>
            resolve({ section, rows: [row('Alarm installer')], text: null, warnings: [] })
        })
    )
    render(<StepHarness Step={BuyersStep} initial={buyersDraft()} client={client} />)
    const buyers = card('buyers')
    await waitFor(() => expect(client.sectionEstimate).toHaveBeenCalled())
    expect(buyers.getAttribute('aria-busy')).toBeNull()
    fireEvent.click(within(buyers).getByRole('button', { name: /Find more/ }))

    const busyButton = within(buyers).getByRole('button', { name: 'Finding…' })
    expect(busyButton.querySelector('.ui-btn-spin')).not.toBeNull()
    fireEvent.click(busyButton)
    expect(client.sectionRun).toHaveBeenCalledTimes(1)
    expect(buyers.getAttribute('aria-busy')).toBe('true')
    expect(buyers.querySelector('.ui-busy-bar')).not.toBeNull()
    const line = buyers.querySelector('.osc-running')
    expect(line?.querySelector('.ui-busy-mark.is-running')).not.toBeNull()
    expect(text(line?.querySelector('.ui-busy-label'))).toBe(
      'CiteFox AI is looking for more buyers'
    )
    expect(text(line?.querySelector('.ui-busy-time'))).toMatch(/^· \d+ s · usually 10–30 s$/)
    expect(text(line)).toContain('You can keep working')

    await act(async () => answer())
    await waitFor(() => expect(buyers.getAttribute('aria-busy')).toBeNull())
    expect(buyers.querySelector('.ui-busy-bar, .osc-running')).toBeNull()
    expect(within(buyers).getByRole('button', { name: /Find more/ })).toBeTruthy()
  })
})

describe('list section: ✎ edit in place', () => {
  it('opens the row in the URL, saves it as the user’s own and closes', async () => {
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BuyersStep}
        initial={buyersDraft()}
        client={fakeSectionClient()}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit IT sysadmin' }))
    expect(query('edit')).toBe('b1')
    const editor = await screen.findByTestId('section-row-edit')
    fireEvent.change(within(editor).getByLabelText('Who they are'), {
      target: { value: 'IT lead at a hospital' }
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(query('edit')).toBeNull())
    const saved = seen!.lists.buyers.find((entry) => entry.id === 'b1')
    expect(saved).toMatchObject({ name: 'IT lead at a hospital', origin: 'user', edited: true })
    const rowEl = (await screen.findByText('IT lead at a hospital')).closest('li')!
    expect(text(within(rowEl).getByTestId('row-tag'))).toBe('yours')
  })

  it('opens the editor when the URL already names the row (a copied link)', async () => {
    window.location.hash = '#/setup/buyers?edit=b2'
    render(<StepHarness Step={BuyersStep} initial={buyersDraft()} client={fakeSectionClient()} />)
    const editor = await screen.findByTestId('section-row-edit')
    expect(editor.getAttribute('data-item-id')).toBe('b2')
  })
})

describe('list section: ✕ remove with Undo, + Add', () => {
  it('removes a row, offers Undo, and puts it back in place', () => {
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BuyersStep}
        initial={buyersDraft()}
        client={fakeSectionClient()}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Practice manager' }))
    expect(seen!.lists.buyers.map((entry) => entry.id)).toEqual(['b1', 'b3', 'b4'])
    const undo = screen.getByTestId('section-undo')
    expect(text(undo)).toContain('Removed “Practice manager”.')
    fireEvent.click(within(undo).getByRole('button', { name: 'Undo' }))
    expect(seen!.lists.buyers.map((entry) => entry.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
    expect(screen.queryByTestId('section-undo')).toBeNull()
  })

  it('adds the user’s row at the end, splits who and situation, refuses a repeat', () => {
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BuyersStep}
        initial={buyersDraft()}
        client={fakeSectionClient()}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const input = screen.getByLabelText('Add a buyer')
    fireEvent.change(input, { target: { value: 'Alarm installer: panels email a dead gateway' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(seen!.lists.buyers.at(-1)).toMatchObject({
      name: 'Alarm installer',
      detail: 'panels email a dead gateway',
      origin: 'user',
      kept: true
    })
    fireEvent.change(input, { target: { value: 'it sysadmin' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('“it sysadmin” is already listed.')).toBeTruthy()
  })
})

describe('⋯ menu and ✦ Redo this section', () => {
  it('opens from the menu, sends the user’s words and keeps their rows', async () => {
    const client = fakeSectionClient({
      rows: { buyers: [row('Alarm installer'), row('Practice manager')] }
    })
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BuyersStep}
        initial={buyersDraft()}
        client={client}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const buyers = card('buyers')
    fireEvent.click(within(buyers).getByRole('button', { name: 'AI actions for Buyers' }))
    expect(query('open')).toBe('buyers.menu')
    const menu = await within(buyers).findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((el) => el.textContent)
    ).toEqual([
      expect.stringContaining('Find more…'),
      expect.stringContaining('Redo this section…'),
      expect.stringContaining('Edit the prompt…'),
      expect.stringContaining('Use my own ChatGPT for this section')
    ])
    await waitFor(() => expect(within(menu).getByText('1 AI call · on your AI plan')).toBeTruthy())
    fireEvent.click(within(menu).getByTestId('menu-redo'))
    expect(query('open')).toBe('buyers.redo')
    const box = await within(buyers).findByTestId('redo-box')
    expect(within(box).getByText(/1 AI call · on your AI plan/)).toBeTruthy()
    fireEvent.change(within(box).getByRole('textbox'), {
      target: { value: 'Also cover alarm installers; skip libraries' }
    })
    fireEvent.click(within(box).getByRole('button', { name: /Redo buyers/ }))
    await waitFor(() => expect(query('open')).toBeNull())
    const call = client.sectionRun.mock.calls[0]![0]
    expect(call).toMatchObject({
      mode: 'redo',
      instruction: 'Also cover alarm installers; skip libraries'
    })
    expect(names(call.current)).toEqual(['Property manager'])
    expect(seen!.lists.buyers.map((entry) => [entry.name, entry.kept])).toEqual([
      ['Alarm installer', true],
      ['Practice manager', true],
      ['Property manager', true]
    ])
    // The returned row kept its id.
    expect(seen!.lists.buyers.find((entry) => entry.name === 'Practice manager')?.id).toBe('b2')
    // "Save as a project rule" is on by default: the words are kept as a rule, and
    // the next run sends them.
    expect(seen!.rules).toEqual(['Also cover alarm installers; skip libraries'])
    fireEvent.click(within(buyers).getByRole('button', { name: /Find more/ }))
    await waitFor(() => expect(client.sectionRun.mock.calls).toHaveLength(2))
    expect(client.sectionRun.mock.calls[1]![0]).toMatchObject({
      rules: ['Also cover alarm installers; skip libraries']
    })
  })

  it('keeps no rule when "Save as a project rule" is unticked', async () => {
    window.location.hash = '#/setup/buyers?open=buyers.redo'
    const client = fakeSectionClient()
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BuyersStep}
        initial={buyersDraft()}
        client={client}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const box = screen.getByTestId('redo-box')
    const keep = within(box).getByRole('checkbox', { name: /Save as a project rule/ })
    expect((keep as HTMLInputElement).checked).toBe(true)
    fireEvent.click(keep)
    fireEvent.change(within(box).getByRole('textbox'), { target: { value: 'Only US buyers' } })
    fireEvent.click(within(box).getByRole('button', { name: /Redo buyers/ }))
    await waitFor(() => expect(client.sectionRun.mock.calls).toHaveLength(1))
    expect(seen!.rules ?? []).toEqual([])
  })

  it('shows the panel the URL names, and closes it when the URL drops it (Back)', async () => {
    window.location.hash = '#/setup/buyers?open=buyers.redo'
    render(<StepHarness Step={BuyersStep} initial={buyersDraft()} client={fakeSectionClient()} />)
    expect(screen.getByTestId('redo-box')).toBeTruthy()
    act(() => {
      window.history.replaceState(null, '', '#/setup/buyers')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await waitFor(() => expect(screen.queryByTestId('redo-box')).toBeNull())
  })
})

describe('✎ Edit the prompt', () => {
  it('runs the edited prompt, saves it for later runs, and Reset forgets it', async () => {
    window.location.hash = '#/setup/competitors'
    const client = fakeSectionClient({
      rows: { competitors: [row('Notifyre', { url: 'notifyre.com' })] }
    })
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={CompetitorsStep}
        initial={textboltDraft({ competitors: [item('Textmagic', { url: 'textmagic.com' })] })}
        client={client}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const competitors = card('competitors')
    const edited = 'Only self-serve plans under $100 a month.'
    fireEvent.click(within(competitors).getByRole('button', { name: 'AI actions for Competitors' }))
    fireEvent.click(await within(competitors).findByTestId('menu-prompt'))
    expect(query('open')).toBe('competitors.prompt')
    const editor = await within(competitors).findByTestId('prompt-editor')
    const box = within(editor).getByRole('textbox')
    await waitFor(() => expect(value(box)).toBe('Find more competitors for this business.'))
    expect(within(editor).getByText(/web search/)).toBeTruthy()
    fireEvent.change(box, { target: { value: edited } })
    fireEvent.click(within(editor).getByRole('button', { name: /Run again/ }))
    await waitFor(() => expect(client.sectionRun).toHaveBeenCalledTimes(1))
    expect(client.sectionRun.mock.calls[0]![0]).toMatchObject({ mode: 'redo', prompt: edited })
    expect(seen!.prompts.competitors).toBe(edited)
    await waitFor(() => expect(query('open')).toBeNull())

    // A later Find more uses the saved prompt.
    fireEvent.click(within(competitors).getByRole('button', { name: /Find more/ }))
    await waitFor(() => expect(client.sectionRun).toHaveBeenCalledTimes(2))
    expect(client.sectionRun.mock.calls[1]![0].prompt).toBe(edited)

    // Reset goes back to the default.
    fireEvent.click(within(competitors).getByRole('button', { name: 'AI actions for Competitors' }))
    fireEvent.click(await within(competitors).findByTestId('menu-prompt'))
    const again = await within(competitors).findByTestId('prompt-editor')
    await waitFor(() => expect(value(within(again).getByRole('textbox'))).toBe(edited))
    fireEvent.click(within(again).getByRole('button', { name: 'Reset' }))
    expect(value(within(again).getByRole('textbox'))).toBe(
      'Find more competitors for this business.'
    )
    expect(seen!.prompts.competitors).toBeUndefined()
  })
})

describe('no Claude: the ✦ actions go the ChatGPT way', () => {
  it('Find more opens the ChatGPT panel; a pasted answer merges like Find more', async () => {
    window.location.hash = '#/setup/brand'
    const client = fakeSectionClient({ available: false, rows: { brands: [row('TextBolt SMS')] } })
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BrandStep}
        initial={textboltDraft({ brands: [item('TextBolt', { id: 'br1' })] })}
        client={client}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const brands = card('brands')
    await waitFor(() =>
      expect(
        within(brands)
          .getByRole('button', { name: /Find more/ })
          .getAttribute('title')
      ).toBe('No AI is connected: opens your own ChatGPT')
    )
    fireEvent.click(within(brands).getByRole('button', { name: /Find more/ }))
    expect(query('open')).toBe('brands.chatgpt')
    expect(client.sectionRun).not.toHaveBeenCalled()
    const panel = await within(brands).findByTestId('chatgpt-panel')
    await waitFor(() =>
      expect(text(within(panel).getByTestId('hf-prompt'))).toContain('Find more brands')
    )
    expect(text(within(panel).getByTestId('hf-prompt'))).toContain(
      'Reply with CSV only, this header: name,detail'
    )
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: 'name\nText Bolt' } })
    fireEvent.click(within(panel).getByTestId('hf-read'))
    await waitFor(() => expect(client.sectionRead).toHaveBeenCalledTimes(1))
    expect(client.sectionRead.mock.calls[0]![0]).toMatchObject({
      section: 'brands',
      text: 'name\nText Bolt'
    })
    await waitFor(() => expect(names(seen!.lists.brands)).toEqual(['TextBolt SMS', 'TextBolt']))
    expect(seen!.lists.brands[0]!.fresh).toBe(true)
  })

  it('the Redo box offers the ChatGPT way with the user’s words', async () => {
    window.location.hash = '#/setup/buyers?open=buyers.redo'
    const client = fakeSectionClient({ available: false })
    render(<StepHarness Step={BuyersStep} initial={buyersDraft()} client={client} />)
    const box = screen.getByTestId('redo-box')
    await waitFor(() => expect(within(box).getByText(/No AI is set up/)).toBeTruthy())
    fireEvent.change(within(box).getByRole('textbox'), { target: { value: 'only B2B buyers' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Use my own ChatGPT' }))
    expect(query('open')).toBe('buyers.chatgpt')
    await waitFor(() => expect(client.sectionPrompt).toHaveBeenCalled())
    expect(client.sectionPrompt.mock.calls.at(-1)![0]).toMatchObject({
      mode: 'redo',
      instruction: 'only B2B buyers'
    })
  })
})

describe('chips', () => {
  it('removes a chip with Undo and adds one with + Add', async () => {
    window.location.hash = '#/setup/brand'
    let seen: SetupDraft | null = null
    render(
      <StepHarness
        Step={BrandStep}
        initial={textboltDraft({ brands: [item('TextBolt'), item('Text Bolt')] })}
        client={fakeSectionClient()}
        onDraftSeen={(draft) => (seen = draft)}
      />
    )
    const brands = card('brands')
    fireEvent.click(within(brands).getByRole('button', { name: 'Remove Text Bolt' }))
    expect(seen!.lists.brands).toHaveLength(1)
    fireEvent.click(within(brands).getByRole('button', { name: 'Undo' }))
    expect(seen!.lists.brands).toHaveLength(2)
    fireEvent.click(within(brands).getByRole('button', { name: '+ Add' }))
    expect(query('edit')).toBe('brands.add')
    const input = await within(brands).findByLabelText('Add a name')
    fireEvent.change(input, { target: { value: 'TB Messaging' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(seen!.lists.brands.map((entry) => [entry.name, entry.origin])).toEqual([
      ['TextBolt', 'ai'],
      ['Text Bolt', 'ai'],
      ['TB Messaging', 'user']
    ])
  })
})
