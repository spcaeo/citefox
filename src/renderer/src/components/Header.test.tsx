// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEXTBOLT_PAGE } from '../m3/fixtures'
import { landingHash } from '../shell/routes'
import { axeViolations } from '../ui/axe.test-helper'
import { Chip } from '../ui/Chip'
import { PICKER_NEW_VALUE } from '../ui/PickerSelect'
import { HeaderField, PageHeader, ScreenHeader } from './Header'

afterEach(cleanup)

describe('ScreenHeader', () => {
  it('renders the classic header when given neither nav nor meta', () => {
    const view = render(
      <ScreenHeader title="Settings" actions={<button type="button">Save</button>} />
    )
    const header = view.container.querySelector('header')
    expect(header?.className).toBe('screen-header')
    expect(header?.querySelector('.screen-title h1')?.textContent).toBe('Settings')
    expect(header?.querySelector('.header-actions')?.textContent).toBe('Save')
  })

  it('renders the PageNav row and one title row with chips and actions', async () => {
    const view = render(
      <ScreenHeader
        title="Text alerts for teams"
        nav={{ back: { href: '#/pages', label: 'All pages' } }}
        meta={<Chip size="sm">42%</Chip>}
        actions={
          <HeaderField label="Market">
            <select>
              <option>US · EN</option>
            </select>
          </HeaderField>
        }
      />
    )
    const header = view.container.querySelector('header')
    expect(header?.className).toBe('screen-header ui-head')
    expect(header?.firstElementChild?.className).toBe('ui-pagenav ui-head-nav')
    const row = header?.querySelector('.ui-head-row')
    expect(row?.querySelector('.ui-head-title h1')?.textContent).toBe('Text alerts for teams')
    expect(row?.querySelector('.ui-head-meta')?.textContent).toBe('42%')
    expect(view.getByRole('combobox', { name: 'Market' })).toBeTruthy()
    expect(view.getByRole('link', { name: 'All pages' }).getAttribute('href')).toBe('#/pages')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('takes a rich title with a control on its first line', async () => {
    const onEdit = vi.fn()
    const view = render(
      <ScreenHeader
        title={
          <>
            Which <em>tool</em> sends alerts?
          </>
        }
        titleAction={
          <button type="button" aria-label="Edit question" onClick={onEdit}>
            ✎
          </button>
        }
        subtitle="Buyer question 3"
      />
    )
    const header = view.container.querySelector('header')
    // A title action alone is enough for the v2 header.
    expect(header?.className).toBe('screen-header ui-head')
    const heading = view.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Which tool sends alerts?')
    expect(heading.querySelector('em')?.textContent).toBe('tool')
    const title = header?.querySelector('.ui-head-title')
    expect(title?.className).toContain('ui-head-title-has-action')
    // The control sits after the h1, outside it, so the heading's name stays the prompt.
    const action = title?.querySelector('.ui-head-title-action')
    expect(action?.previousElementSibling).toBe(heading)
    fireEvent.click(view.getByRole('button', { name: 'Edit question' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(header?.querySelector('.ui-head-sub')?.textContent).toBe('Buyer question 3')
    expect(await axeViolations(view.container)).toEqual([])
  })
})

describe('PageHeader', () => {
  const props = {
    projectName: 'TextBolt',
    page: TEXTBOLT_PAGE,
    marketId: TEXTBOLT_PAGE.markets[0]?.id ?? '',
    onMarketChange: vi.fn(),
    checkHref: '#/pages/p/running',
    exportHref: '#/export?page=p'
  }

  it('renders the v2 header: back link, URL with copy and open, chips, one title row', async () => {
    const view = render(<PageHeader {...props} />)
    const header = view.container.querySelector('header')
    expect(header?.className).toContain('ui-head')
    // No in-page breadcrumb: the top bar shows the path.
    expect(header?.querySelector('.crumb')).toBeNull()
    expect(view.getByRole('link', { name: 'TextBolt' }).getAttribute('href')).toBe(landingHash())
    // A long address is cut in the middle, so its text spans the parts of one value.
    expect(header?.querySelector('.ui-url .ui-url-value')?.textContent).toBe(
      TEXTBOLT_PAGE.displayUrl
    )
    expect(view.getByRole('button', { name: `Copy ${TEXTBOLT_PAGE.displayUrl}` })).toBeTruthy()
    const chips = view.getByRole('list', { name: 'Page settings' })
    expect(within(chips).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
    expect(chips.querySelector('.ui-chip')).toBeTruthy()
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe(TEXTBOLT_PAGE.title)
    const market = view.getByRole('combobox', { name: 'Market' })
    fireEvent.change(market, { target: { value: TEXTBOLT_PAGE.markets[1]?.id } })
    expect(props.onMarketChange).toHaveBeenCalledWith(TEXTBOLT_PAGE.markets[1]?.id)
    // Export report is under the header's ⋯.
    fireEvent.click(view.getByRole('button', { name: 'More actions' }))
    expect(view.getByRole('menuitem', { name: 'Export report' })).toBeTruthy()
    fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' })
    const check = view.getByRole('link', { name: /Check now/ })
    expect(check.getAttribute('href')).toBe('#/pages/p/running')
    expect(check.className).toContain('ui-btn-primary')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('takes its own back link and steps Check now back before the first check', () => {
    const view = render(
      <PageHeader {...props} back={{ href: '#/topics/t', label: 'Topic' }} checkPrimary={false} />
    )
    expect(view.getByRole('link', { name: 'Topic' }).getAttribute('href')).toBe('#/topics/t')
    // No green Check now before the first check: it waits under ⋯.
    expect(view.queryByRole('link', { name: /Check now/ })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'More actions' }))
    expect(view.getByRole('menuitem', { name: 'Check now' })).toBeTruthy()
  })

  it('turns the chips into Page settings buttons when it knows the page', async () => {
    window.location.hash = '#/pages/p/results'
    const view = render(<PageHeader {...props} pageId="p" paused />)
    const chips = view.getByRole('list', { name: 'Page settings' })
    fireEvent.click(
      within(chips).getByRole('button', { name: /^Every .*: change in Page settings/ })
    )
    expect(window.location.hash).toContain('drawer=page-settings')
    expect(window.location.hash).toContain('ps.section=schedule')
    fireEvent.click(within(chips).getByRole('button', { name: 'Paused' }))
    expect(window.location.hash).toContain('ps.section=status')
    expect(view.getByRole('button', { name: 'Page settings' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('ends the market picker with + New market…, which opens Add market for the page', () => {
    window.location.hash = '#/pages/p/results'
    const onMarketAdded = vi.fn()
    const view = render(<PageHeader {...props} pageId="p" onMarketAdded={onMarketAdded} />)
    const market = view.getByRole('combobox', { name: 'Market' }) as HTMLSelectElement
    expect(market.options[market.options.length - 1]?.textContent).toBe('+ New market…')
    fireEvent.change(market, { target: { value: PICKER_NEW_VALUE } })
    expect(window.location.hash).toContain('drawer=add-market')
    expect(window.location.hash).toContain('am.page=p')
    expect(market.value).toBe(props.marketId)
  })
})
