// @vitest-environment happy-dom
import type { JSX } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_SENDER, type ReportSender } from '@shared/report/review/sender'
import { ReportsSection } from '../../projectSettings/components/ReportsSection'
import type { BrandingClient } from '../../projectSettings/utils/branding'
import { axeViolations } from '../../ui/axe.test-helper'
import { BrandingStrip, BylineLine } from './BrandingStrip'
import {
  configureSenderClient,
  primeReportSender,
  useBrandingMode,
  type SenderClient
} from './senderStore'

/** Settings › Reports in the app: the Reports home strip, the drawer, the header line. */

const AGENCY: ReportSender = {
  mode: 'agency',
  name: 'Northwind SEO',
  logo: null,
  website: 'northwindseo.com',
  email: 'hello@northwindseo.com',
  preparedBy: ''
}

afterEach(() => {
  cleanup()
  configureSenderClient(null)
  window.location.hash = ''
})

function fakeClient(start: ReportSender): SenderClient & { set: ReturnType<typeof vi.fn> } {
  let saved = start
  return {
    get: vi.fn(async () => saved),
    set: vi.fn(async (next: ReportSender) => {
      saved = next
      return next
    })
  }
}

function Mode(): JSX.Element {
  return <span data-testid="mode">{useBrandingMode()}</span>
}

describe('report branding strip', () => {
  it('agency: "Prepared by <agency> for <client>", the client defaulting to the brand', async () => {
    primeReportSender(AGENCY)
    const view = render(
      <BrandingStrip branding={{ preparedFor: '', logo: null }} brand="TextBolt" />
    )
    const strip = view.getByTestId('branding-strip')
    expect(strip.textContent).toContain('Prepared by Northwind SEO for TextBolt')
    expect(view.getByRole('link', { name: 'Edit branding' }).getAttribute('href')).toBe(
      '#/settings?tab=reports'
    )
    expect(await axeViolations(view.container)).toEqual([])
    view.rerender(<BrandingStrip branding={{ preparedFor: 'Acme', logo: null }} brand="TextBolt" />)
    expect(view.getByTestId('branding-strip').textContent).toContain('for Acme')
  })

  it('in-house: "<Company> · reports for <team>", never "client"', () => {
    primeReportSender({ ...NO_SENDER, mode: 'company' })
    const view = render(
      <>
        <BrandingStrip branding={{ preparedFor: 'Leadership', logo: null }} brand="TextBolt" />
        <BylineLine branding={{ preparedFor: 'Leadership', logo: null }} brand="TextBolt" />
      </>
    )
    expect(view.getByTestId('branding-strip').textContent).toContain(
      'TextBolt · reports for Leadership'
    )
    expect(view.getByTestId('report-byline').textContent).toBe('TTextBolt · reports for Leadership')
    expect(view.container.textContent).not.toMatch(/client/i)
  })

  it('none: a quiet prompt; Edit asks the three-way question, then only that mode’s fields', async () => {
    const client = fakeClient(NO_SENDER)
    configureSenderClient(client)
    const view = render(
      <>
        <BrandingStrip branding={null} brand="TextBolt" />
        <BylineLine branding={null} brand="TextBolt" />
        <Mode />
      </>
    )
    await waitFor(() =>
      expect(view.getByTestId('branding-strip').textContent).toContain(
        'Add your logo to every report'
      )
    )
    expect(view.queryByTestId('report-byline')).toBeNull()
    expect(view.getByTestId('mode').textContent).toBe('none')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    const drawer = await view.findByTestId('branding-drawer')
    const group = view.getByRole('radiogroup', { name: 'Who are these reports from?' })
    expect(group.textContent).toContain('An agency, for clients')
    expect(drawer.querySelector('input[type="text"], input:not([type])')).toBeNull()
    fireEvent.click(view.getByRole('radio', { name: /My own company/ }))
    expect(view.getByLabelText('Company name').getAttribute('placeholder')).toBe('TextBolt')
    expect(view.queryByLabelText('Website')).toBeNull()
    fireEvent.click(view.getByRole('radio', { name: /An agency/ }))
    fireEvent.change(view.getByLabelText('Agency name'), { target: { value: 'Northwind SEO' } })
    fireEvent.change(view.getByLabelText('Contact email'), { target: { value: 'nope' } })
    expect(view.getByText('Type an email such as hello@example.com.')).toBeTruthy()
    fireEvent.change(view.getByLabelText('Contact email'), {
      target: { value: 'hello@northwindseo.com' }
    })
    expect(await axeViolations(drawer)).toEqual([])
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Save' }))
    })
    expect(client.set).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'agency', name: 'Northwind SEO' })
    )
    await waitFor(() => expect(view.queryByTestId('branding-drawer')).toBeNull())
    expect(view.getByTestId('branding-strip').textContent).toContain(
      'Prepared by Northwind SEO for TextBolt'
    )
    expect(view.getByTestId('report-byline').textContent).toContain('Prepared by Northwind SEO')
    expect(view.getByTestId('mode').textContent).toBe('agency')
  })
})

describe('Project settings › Reports follows the mode', () => {
  const branding: BrandingClient = {
    get: vi.fn(async () => ({ preparedFor: '', logo: null })),
    set: vi.fn(async (request) => ({ preparedFor: request.preparedFor, logo: request.logo }))
  }

  it('agency: the client name, defaulting to the brand', async () => {
    primeReportSender(AGENCY)
    const view = render(<ReportsSection projectId="proj-1" client={branding} brand="TextBolt" />)
    await waitFor(() => expect(branding.get).toHaveBeenCalled())
    expect(view.getByLabelText('Client name').getAttribute('placeholder')).toBe('TextBolt')
    expect(view.container.textContent).toContain('Empty: TextBolt.')
  })

  it('in-house: Prepared for and Prepared by, no logo', async () => {
    primeReportSender({ ...NO_SENDER, mode: 'company', preparedBy: 'Growth team' })
    const view = render(<ReportsSection projectId="proj-1" client={branding} brand="TextBolt" />)
    await waitFor(() => expect(branding.get).toHaveBeenCalled())
    expect(view.getByLabelText('Prepared for').getAttribute('placeholder')).toBe('Leadership team')
    expect(view.getByLabelText('Prepared by').getAttribute('placeholder')).toBe('Growth team')
    expect(view.container.textContent).not.toMatch(/client/i)
  })
})
