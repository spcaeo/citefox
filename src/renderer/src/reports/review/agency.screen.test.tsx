// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildReport, EMPTY_EXTRAS, type ReportExtras } from '@shared/report/review'
import { sampleContext, sampleMetrics } from '@shared/report/review/sample.test-helper'
import { ReportsSection } from '../../projectSettings/components/ReportsSection'
import type { BrandingClient } from '../../projectSettings/utils/branding'
import { axeViolations } from '../../ui/axe.test-helper'
import { BacklinksSection, LostSection, NextSection } from './sections/AgencySections'
import { DeepSection } from './sections/DeepSection'

/** The agency sections and deep dives in the app, and Project settings › Reports. */

const extras: ReportExtras = {
  ...EMPTY_EXTRAS,
  backlinks: [
    {
      url: 'https://textbolt.com/textbolt-for-schools',
      title: 'TextBolt for schools',
      priority: 'first',
      reason: 'Not indexed',
      anchor: 'TextBolt for schools',
      anchorSaved: false,
      daysLive: 5
    }
  ],
  changes: {
    'https://textbolt.com/features': {
      url: 'https://textbolt.com/features',
      changedAt: '2026-10-06T00:00:00.000Z',
      sectionsAdded: 0,
      sectionsRemoved: 1,
      headingsChanged: 0,
      textChanged: 1,
      sections: ['Pricing table'],
      wordsBefore: 1200,
      wordsAfter: 900
    }
  },
  owners: [{ step: 'publish', owner: 'Dana' }]
}

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('agency sections in the app', () => {
  const report = buildReport(sampleMetrics(), sampleContext(), extras)

  it('Lost ground shows what changed, where questions went, and drills on the URL', async () => {
    const view = render(<LostSection report={report} />)
    const card = view.getByRole('region', { name: 'Lost ground: /features' })
    expect(card.textContent).toContain(
      '1 section removed, text changed in 1 place, 1,200 → 900 words.'
    )
    expect(card.textContent).toContain('Pricing table')
    expect(card.textContent).toContain('Recovery plan')
    fireEvent.click(view.getAllByRole('button', { name: /Questions lost/ })[0]!)
    expect(window.location.hash).toContain('drawer=report-drill')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Backlinks lists the ask with its anchor text, copies and saves the CSV', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onCsv = vi.fn()
    const view = render(<BacklinksSection report={report} onCsv={onCsv} />)
    expect(view.getByRole('table', { name: 'Backlink ask list' }).textContent).toContain(
      '“TextBolt for schools”'
    )
    fireEvent.click(view.getByRole('button', { name: 'Copy with anchor text' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://textbolt.com/textbolt-for-schools\tTextBolt for schools'
      )
    )
    fireEvent.click(view.getByRole('button', { name: 'Download CSV' }))
    expect(onCsv).toHaveBeenCalled()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Next round shows the five steps with owners', async () => {
    const view = render(<NextSection report={report} />)
    const steps = view.container.querySelectorAll('.rv-round-step')
    expect(steps).toHaveLength(5)
    expect(view.container.querySelector('[data-step="publish"]')?.textContent).toContain('Dana')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Deep dives: engines agreeing under All, a note for one engine', async () => {
    const view = render(<DeepSection report={report} />)
    expect(view.getByRole('heading', { name: 'Do the engines agree?' })).toBeTruthy()
    expect(view.getByText('No stored answer text to read for these checks.')).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
    view.unmount()
    const one = buildReport(sampleMetrics({ engine: 'chatgpt' }), sampleContext())
    const single = render(<DeepSection report={one} />)
    expect(single.getByText('Pick All engines to compare the engines.')).toBeTruthy()
  })
})

describe('Project settings › Reports', () => {
  it('saves the Prepared for line', async () => {
    const set = vi.fn(async (request: { preparedFor: string; logo: string | null }) => ({
      preparedFor: request.preparedFor.trim(),
      logo: request.logo
    }))
    const client: BrandingClient = {
      get: async () => ({ preparedFor: '', logo: null }),
      set
    }
    const view = render(<ReportsSection projectId="proj-1" client={client} />)
    fireEvent.change(view.getByLabelText('Prepared for'), { target: { value: 'Acme Inc.' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        projectId: 'proj-1',
        preparedFor: 'Acme Inc.',
        logo: null
      })
    )
    await view.findByText('Saved. Downloaded reports now show this line.')
    expect(view.getByLabelText('Preview').textContent).toBe('Prepared for Acme Inc.')
    expect(await axeViolations(view.container)).toEqual([])
  })
})
