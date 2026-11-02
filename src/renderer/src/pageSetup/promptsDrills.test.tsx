// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BuyerPrompt, CoverageLevel } from '@shared/domain'
import type { PageDetail } from '@shared/ipc'
import { DrillHost } from '../drill'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import { CLIENT_MODE_STORAGE_KEY } from '../onboarding/flags'
import { createMockShellClient } from '../projects/mockClient'
import { pageHash, promptHash, readHash, templatesHash } from '../shell/routes'
import { createMockTemplatesClient } from '../templates/client'
import { setupScope } from './drills'
import { BrandLine } from './PromptsChecks'
import { brandNamesFromMessage, coverageDrills, promptsNaming } from './promptsDrills'
import { PromptsScreen } from './PromptsScreen'

afterEach(() => {
  cleanup()
  localStorage.removeItem(CLIENT_MODE_STORAGE_KEY)
  window.location.hash = ''
})

function prompt(id: string, position: number, text: string): BuyerPrompt {
  return {
    id,
    position,
    label: `Question **${position}**`,
    source: 'trigger_event',
    intentStage: 'problem',
    mappedElement: 'FAQ: Can I text the crew?',
    enabled: true,
    variants: [{ marketId: 'us', language: 'en', text, originalText: null }]
  }
}

const PROMPTS = [
  prompt('p1', 1, 'How do I text my crew from TextBolt?'),
  prompt('p2', 2, 'How do I text a crew without code?'),
  prompt('p3', 3, 'Does text bolt work in the UK?')
]
const SCOPE = setupScope('page-1', null)

describe('Questions drills (pure)', () => {
  it('reads brand names from both brand sentences', () => {
    expect(brandNamesFromMessage('A question contains TextBolt or Text Bolt.')).toEqual([
      'TextBolt',
      'Text Bolt'
    ])
    expect(
      brandNamesFromMessage(
        'A question contains TextBolt. Remove the brand name before the next check.'
      )
    ).toEqual(['TextBolt'])
    expect(brandNamesFromMessage('No question contains TextBolt.')).toEqual([])
    expect(brandNamesFromMessage('A question contains a brand name.')).toEqual([])
  })

  it('finds the questions that name a brand, case-insensitive', () => {
    expect(promptsNaming(PROMPTS, ['TextBolt', 'Text Bolt']).map((item) => item.id)).toEqual([
      'p1',
      'p3'
    ])
  })

  it('builds one coverage drill per level with exactly that level’s questions', () => {
    const coverage = new Map<string, CoverageLevel>([
      ['p1', 'strong'],
      ['p2', 'weak'],
      ['p3', 'strong'],
      ['gone', 'none']
    ])
    const drills = coverageDrills(PROMPTS, coverage, SCOPE)
    expect(drills.map((entry) => [entry.level, entry.drill.items.length])).toEqual([
      ['strong', 2],
      ['weak', 1]
    ])
    const first = drills[0]?.drill.items[0]
    expect(first?.target).toEqual({
      kind: 'prompt',
      pageId: 'page-1',
      promptId: 'p1',
      marketId: null
    })
  })
})

describe('BrandLine', () => {
  it('opens a drawer of exactly the questions that name a brand', () => {
    const view = render(
      <DrillHost>
        <BrandLine
          prompts={PROMPTS}
          brandsClear={false}
          message="A question contains TextBolt or Text Bolt."
          scope={SCOPE}
        />
      </DrillHost>
    )
    const button = view.getByRole('button', { name: /^2 questions: Questions that name a brand/ })
    fireEvent.click(button)
    const dialog = view.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Questions that name a brand · 2 questions' })
    ).toBeTruthy()
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(2)
  })

  it('offers no drawer when the brands are clear', () => {
    const view = render(
      <DrillHost>
        <BrandLine
          prompts={PROMPTS}
          brandsClear
          message="No question contains TextBolt."
          scope={SCOPE}
        />
      </DrillHost>
    )
    expect(view.queryByRole('button')).toBeNull()
  })
})

function page(pageId: string): PageDetail {
  return createProjectMemory(textboltCatalog()).getPage('textbolt', pageId)
}

function renderScreen(): ReturnType<typeof render> {
  localStorage.setItem(CLIENT_MODE_STORAGE_KEY, 'mock')
  return render(
    <PromptsScreen
      client={createMockShellClient({
        catalog: textboltCatalog(),
        activeStore: memoryActiveProjectStore()
      })}
      templatesClient={createMockTemplatesClient()}
      projectId="textbolt"
      page={page('alerts')}
      marketId="us"
      onChanged={() => undefined}
    />
  )
}

describe('PromptsScreen drills', () => {
  it('each coverage count opens a drawer whose total equals it', async () => {
    const view = renderScreen()
    const line = await view.findByRole('group', { name: 'Coverage against the page' })
    const buttons = within(line).getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
    let sum = 0
    for (const button of buttons) {
      const figure = Number(button.querySelector('[data-nfr-figure]')?.textContent)
      sum += figure
      fireEvent.click(button)
      const dialog = view.getByRole('dialog')
      expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(figure)
      expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toContain(
        `${figure} question`
      )
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    }
    // Every prompt with a stored coverage row is counted once: one gaps link per row.
    const grid = view.getByRole('grid', { name: 'Buyer questions' })
    const links = grid.querySelectorAll('a[href*="/gaps?filter="]')
    expect(sum).toBe(links.length)
  })

  it('rows link to Content gaps; the rail links to History, Templates and the buyer profile', async () => {
    const view = renderScreen()
    const grid = await view.findByRole('grid', { name: 'Buyer questions' })
    const alerts = page('alerts')
    const first = grid.querySelector<HTMLAnchorElement>('a[href*="/gaps?filter="]')
    expect(first?.getAttribute('href')).toMatch(/^#\/pages\/alerts\/gaps\?filter=row/)
    expect(view.getByRole('link', { name: 'Version history' }).getAttribute('href')).toBe(
      pageHash(alerts.id, 'history')
    )
    const template = view.getByRole('link', { name: /^Template: / })
    expect(template.getAttribute('href')).toBe(templatesHash('buyer-prompts'))
    fireEvent.click(view.getByRole('button', { name: /^Details/ }))
    expect(view.container.querySelector('.ps-prov-ids')?.textContent).toContain('…')
    expect(view.getByRole('link', { name: 'Edit the buyer profile' }).getAttribute('href')).toBe(
      pageHash(alerts.id, 'audience')
    )
  })

  it('Enter or a click on a row opens Question detail', async () => {
    const view = renderScreen()
    const grid = await view.findByRole('grid', { name: 'Buyer questions' })
    const row = grid.querySelector<HTMLElement>('.ui-lg-row')
    expect(row).not.toBeNull()
    fireEvent.keyDown(row as HTMLElement, { key: 'Enter' })
    expect(window.location.hash).toMatch(/^#\/pages\/alerts\/prompt\/.+\?market=us$/)
    expect(promptHash('alerts', 'x', { marketId: 'us' })).toContain('?market=us')
    expect(readHash('alerts')).toContain('/read')
  })

  it('the row menu opens the editor at its own URL', async () => {
    const view = renderScreen()
    const grid = await view.findByRole('grid', { name: 'Buyer questions' })
    const menu = within(grid).getAllByRole('button', { name: /^Actions for question / })[0]
    fireEvent.click(menu as HTMLElement)
    fireEvent.click(await view.findByRole('menuitem', { name: 'Edit wording' }))
    expect(window.location.hash).toMatch(/drawer=pt-edit&pt\.edit=/)
    expect(await view.findByRole('dialog', { name: 'Edit question' })).toBeTruthy()
  })
})
