// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistClient } from '../assist/client'
import { describeMockAssist, runMockAssist } from '../assist/mock'
import { fakeLoopSource, NOW } from '../fixes/fixtures'
import { FixesScreen } from '../fixes'
import { row } from '../progress/fixtures'
import { LostGroundCallout } from './LostGroundCallout'

const AXE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const assist: AssistClient = { describe: describeMockAssist, run: runMockAssist }

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('Fixes screen: Lost ground', () => {
  it('shows where the questions went, the outline and the lost questions by stage', async () => {
    window.location.hash = '#/fixes?view=lost&lost=page-alerts'
    const { source, calls } = fakeLoopSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} now={NOW} />)
    expect(
      await view.findByRole('heading', {
        name: 'How to set up text alerts for business: what happened'
      })
    ).toBeTruthy()
    expect(calls.lost).toEqual([{ projectId: 'proj-1', pageId: 'page-alerts', vsRunId: null }])
    // Lost ground sits under Did it work?, with the way back.
    const tabs = view.getByRole('tablist', { name: 'Fixes views' })
    expect(
      within(tabs)
        .getByRole('tab', { name: /^Did it work\?/ })
        .getAttribute('aria-selected')
    ).toBe('true')
    expect(view.getByRole('link', { name: '← Did it work?' })).toBeTruthy()
    expect(view.getByText(/Rewrite and live since/)).toBeTruthy()
    expect(view.getByRole('button', { name: '5 questions cited this page' })).toBeTruthy()
    const tiles = view.getByRole('region', { name: 'Where the questions went' })
    const tile = (name: string): string =>
      within(tiles).getByRole('region', { name }).querySelector('[data-nfr-figure]')?.textContent ??
      ''
    expect(tile('Still citing this page')).toBe('1')
    expect(tile('Moved to your other tracked pages')).toBe('2')
    expect(tile('Moved to other pages on your site')).toBe('1')
    expect(tile('No longer cited')).toBe('1')
    const outline = view.getByRole('region', { name: 'Why it most likely happened' })
    expect(
      within(outline).getByRole('heading', { name: /^Before: “Text alerts: the complete guide”/ })
    ).toBeTruthy()
    expect(within(outline).getByText('Alerts vs notifications vs reminders').className).toContain(
      'lg-gone'
    )
    expect(within(outline).getAllByText('New')).toHaveLength(2)
    const stages = view.getByRole('grid', { name: 'Lost questions by stage' })
    expect(within(stages).getByText('Comparison')).toBeTruthy()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('a tile opens exactly its questions', async () => {
    window.location.hash = '#/fixes?view=lost&lost=page-alerts'
    const { source } = fakeLoopSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} now={NOW} />)
    fireEvent.click(
      await view.findByRole('button', { name: '2 questions: Moved to your other tracked pages' })
    )
    const drawer = await view.findByRole('dialog', { name: /Moved to your other tracked pages/ })
    expect(drawer.textContent).toContain('alerts question 2')
    expect(drawer.textContent).toContain('alerts question 3')
    expect(drawer.textContent).not.toContain('alerts question 4')
  })

  it('Compare with sets the older check in the URL; Back returns to Changes', async () => {
    window.location.hash = '#/fixes?view=lost&lost=page-alerts'
    const { source, calls } = fakeLoopSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} now={NOW} />)
    const select = await view.findByRole('combobox', { name: 'Compare with' })
    fireEvent.change(select, { target: { value: 'run-alerts-0' } })
    await waitFor(() =>
      expect(window.location.hash).toBe('#/fixes?view=lost&lost=page-alerts&vs=run-alerts-0')
    )
    await waitFor(() => expect(calls.lost.at(-1)?.vsRunId).toBe('run-alerts-0'))
    fireEvent.click(view.getByRole('button', { name: 'Back to changes' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=changes'))
  })

  it('writes and saves the recovery plan, with the edit in the URL', async () => {
    window.location.hash = '#/fixes?view=lost&lost=page-alerts'
    const { source, calls } = fakeLoopSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} now={NOW} />)
    fireEvent.click(await view.findByRole('button', { name: 'Write the plan' }))
    await waitFor(() =>
      expect(window.location.hash).toBe('#/fixes?view=lost&lost=page-alerts&plan=edit')
    )
    fireEvent.change(view.getByLabelText('The plan'), {
      target: { value: '1. Bring back the **comparison** section' }
    })
    fireEvent.click(view.getByRole('button', { name: 'Save plan' }))
    await waitFor(() =>
      expect(calls.plans).toEqual([
        {
          projectId: 'proj-1',
          pageId: 'page-alerts',
          inputKey: 'run-alerts-1|run-alerts-2',
          text: '1. Bring back the **comparison** section'
        }
      ])
    )
    expect((await view.findByText('comparison')).tagName).toBe('STRONG')
    expect(window.location.hash).toBe('#/fixes?view=lost&lost=page-alerts')
    fireEvent.click(view.getByRole('button', { name: 'Edit the plan' }))
    expect((view.getByLabelText('The plan') as HTMLTextAreaElement).value).toBe(
      '1. Bring back the **comparison** section'
    )
  })

  it('an applied recovery-plan suggestion is saved as the plan', async () => {
    window.location.hash = '#/fixes?view=lost&lost=page-alerts'
    const { source, calls } = fakeLoopSource()
    const view = render(
      <FixesScreen projectId="proj-1" source={source} now={NOW} assistClient={assist} />
    )
    fireEvent.click(await view.findByRole('button', { name: 'AI actions for the recovery plan' }))
    fireEvent.click(await view.findByRole('menuitem', { name: /Write a recovery plan/ }))
    fireEvent.click(await view.findByRole('button', { name: 'Save as the plan' }))
    await waitFor(() => expect(calls.plans).toHaveLength(1))
    expect(calls.plans[0]?.inputKey).toBe('run-alerts-1|run-alerts-2')
    expect(calls.plans[0]?.text).toContain('1. Bring back the comparison section')
  })
})

describe('Results: lost ground callout', () => {
  it('shows one line linking to Lost ground only when the rule says so', () => {
    const was = { previousStatus: 'page_cited' as const }
    const lost = [row(1, 'not_cited', was), row(2, 'not_cited', was), row(3, 'no_aio', was)]
    const view = render(<LostGroundCallout pageId="page-alerts" rows={lost} />)
    expect(view.getByRole('note').textContent).toContain(
      'This page lost ground since the last check'
    )
    expect(view.getByRole('link', { name: 'See what happened' }).getAttribute('href')).toBe(
      '#/fixes?view=lost&lost=page-alerts'
    )
    cleanup()
    const fine = render(
      <LostGroundCallout pageId="page-alerts" rows={[row(1, 'page_cited', was)]} />
    )
    expect(fine.container.textContent).toBe('')
  })
})
