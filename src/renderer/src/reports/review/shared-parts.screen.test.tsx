// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTRAS } from '@shared/report/review'
import { sampleMetrics } from '@shared/report/review/sample.test-helper'
import { resetDrawersForTests } from '../../shell/drawers'
import { createMockSchedulesClient } from '../schedulesMock'
import { ReportsScreen } from '../ReportsScreen'
import type { ReviewClient } from './client'
import type { ReviewProject } from './ReviewView'

/**
 * The parts every ready report shares (Docs/REPORT-SPEC.md): the Competitors tab, the
 * Questions table, the drill drawers and the report-wide search.
 */

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetDrawersForTests()
})

const PROJECT: ReviewProject = {
  id: 'proj-1',
  name: 'TextBolt',
  domain: 'textbolt.com',
  brand: 'TextBolt',
  defaultMarket: null,
  markets: []
}

const CLIENT: ReviewClient = {
  metrics: async () => sampleMetrics(),
  review: async (request) => ({
    metrics: sampleMetrics({ from: request.from === null ? null : undefined }),
    extras: {
      ...EMPTY_EXTRAS,
      siteKinds: { 'twilio.com': 'competitors', 'simpletexting.com': 'competitors' },
      questionTargets: {
        'topic-1|q1': ['https://textbolt.com/email-to-sms-outlook', 'https://textbolt.com/features']
      }
    }
  }),
  download: async () => ({ ok: true, filePath: '/tmp/x.csv', filename: 'x.csv', bytes: 1 })
}

function screen(): ReturnType<typeof render> {
  return render(
    <ReportsScreen
      client={createMockSchedulesClient()}
      timeZone="America/Chicago"
      reviewClient={CLIENT}
      project={PROJECT}
      pages={[]}
    />
  )
}

describe('Reports › shared parts', () => {
  it('Competitors: five tiles, share of voice, kinds that filter, every site with position', async () => {
    window.location.hash = '#/?report=impact&section=competitors'
    const view = screen()
    const table = await view.findByRole('table', { name: 'Every cited site' })
    expect(view.getByText('Gap questions')).toBeTruthy()
    expect(view.getByRole('heading', { name: 'Share of voice' })).toBeTruthy()
    expect(view.getByRole('heading', { name: 'Who else the AI answers cite' })).toBeTruthy()
    expect(within(table).getByText('textbolt.com').closest('.ui-url-own')).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: /Avg position/ })).toBeTruthy()
    const all = within(table).getAllByRole('row').length
    // A kind filters the table (your own row stays for comparison).
    const kinds = view.getByRole('table', { name: 'Who else the AI answers cite' })
    fireEvent.click(within(kinds).getByRole('button', { name: 'Competitors' }))
    await waitFor(() => expect(window.location.hash).toContain('kind=competitors'))
    const filtered = view.getByRole('table', { name: 'Every cited site' })
    expect(within(filtered).getAllByRole('row').length).toBe(1 + 2 + 1)
    expect(within(filtered).getAllByRole('row').length).toBeLessThan(all)
    // Sorting by a header reorders the rows.
    fireEvent.click(within(filtered).getByRole('button', { name: /^Site/ }))
    const names = within(view.getByRole('table', { name: 'Every cited site' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.getAttribute('data-site'))
    expect(names).toEqual([...names].sort())
  })

  it('Questions: target page, funnel, intent, position, cited through, topic filter, Not compared', async () => {
    window.location.hash = '#/?report=impact&section=questions'
    const view = screen()
    const table = await view.findByRole('table', { name: 'Every question' })
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    for (const words of [
      'Target page',
      'Funnel',
      'Intent',
      'Position before → now',
      'Cited through'
    ]) {
      expect(
        heads.some((head) => head?.startsWith(words)),
        words
      ).toBe(true)
    }
    expect(within(table).getByText('+1')).toBeTruthy()
    const chips = view.getByRole('group', { name: 'Change' })
    expect(within(chips).getByRole('button', { name: /^All/ })).toBeTruthy()
    const topic = view.getByRole('combobox', { name: 'Topic' }) as HTMLSelectElement
    fireEvent.change(topic, { target: { value: 'Pricing' } })
    await waitFor(() => expect(window.location.hash).toContain('qt=Pricing'))
    const rows = within(view.getByRole('table', { name: 'Every question' })).getAllByRole('row')
    expect(rows.length).toBe(1 + 3)
    // A page cell opens the page drawer.
    const page = within(rows[1] as HTMLElement).getAllByRole('button', { name: '/pricing' })[0]
    fireEvent.click(page as HTMLElement)
    await waitFor(() => expect(document.querySelector('[data-rd2^="page:"]')).not.toBeNull())
  })

  it('drawers: the strip, change tabs, engine columns and named before → now', async () => {
    window.location.hash = '#/?report=impact&drawer=report-drill&rd=dom%3Atwilio.com%3Aa'
    const view = screen()
    const drawer = await view.findByRole('dialog', { name: /twilio\.com/ })
    const strip = within(drawer).getByTestId('rv-dstats').textContent ?? ''
    for (const words of ['questions', 'AI answer shown', 'cite you', 'brand named', 'gap']) {
      expect(strip).toContain(words)
    }
    const tabs = within(drawer).getByTestId('rv-dtabs')
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((tab) => tab.textContent?.replace(/\d+$/, ''))
    ).toEqual(['All', 'Gained', 'Kept', 'Lost', 'Not cited'])
    const heads = within(drawer)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent ?? '')
    expect(heads).toContain('You in the same answer')
    expect(heads.some((head) => head.startsWith('Named before'))).toBe(true)
    expect(heads.some((head) => head.includes('ChatGPT'))).toBe(true)
    const all = within(drawer).getAllByRole('row').length
    const lost = within(tabs).getByRole('button', { name: /^Lost/ })
    fireEvent.click(lost)
    const count = Number(lost.textContent?.replace(/\D+/g, '') ?? '0')
    expect(within(drawer).queryAllByRole('row').length).toBe(count === 0 ? 0 : 1 + count)
    expect(count).toBeLessThan(all)
  })

  it('the header search opens a question, a site or a page in its drawer', async () => {
    window.location.hash = '#/?report=visibility'
    const view = screen()
    const box = await view.findByRole('searchbox', { name: 'Search this report' })
    fireEvent.change(box, { target: { value: 'twilio' } })
    const list = view.getByRole('listbox', { name: 'Search results' })
    expect(within(list).getByText('Sites')).toBeTruthy()
    fireEvent.click(within(list).getByRole('option', { name: /twilio\.com/ }))
    await waitFor(() =>
      expect(document.querySelector('[data-rd2="site:twilio.com"]')).not.toBeNull()
    )
  })

  it('the history legend names every state, named-not-cited and not checked included', async () => {
    window.location.hash = '#/?report=impact&section=changed'
    const view = screen()
    const legend = await view.findByTestId('rv-history-legend')
    expect(legend.textContent).toContain('Named, not cited')
    expect(legend.textContent).toContain('Not checked')
  })
})
