// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { PageNav } from './PageNav'

afterEach(cleanup)

const PAGER = {
  label: 'Step through questions',
  position: 1,
  total: 10,
  previous: { href: null, label: 'Previous question' },
  next: { href: '#/pages/p/prompt/2', label: 'Next question' }
} as const

describe('PageNav', () => {
  it('shows the back link, the path and the pager in one row', () => {
    const view = render(
      <PageNav
        back={{ href: '#/pages/p/results', label: 'Results' }}
        crumbs={[
          { label: 'TextBolt', href: '#/pages' },
          { label: 'Replacing a carrier email-to-text gateway', href: '#/pages/p/results' },
          { label: 'Question 1' }
        ]}
        pager={PAGER}
      />
    )
    expect(view.getByRole('link', { name: 'Results' }).getAttribute('href')).toBe(
      '#/pages/p/results'
    )
    const path = view.getByRole('list', { name: 'Path' })
    const steps = within(path).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      'TextBolt',
      'Replacing a carrier email-to-text gateway',
      'Question 1'
    ])
    // Every step's full text is its title, so a cut middle step still reads on hover.
    expect(steps[1]?.getAttribute('title')).toBe('Replacing a carrier email-to-text gateway')
    expect(within(path).getByText('Question 1').getAttribute('aria-current')).toBe('page')
    expect(within(path).queryByRole('link', { name: 'Question 1' })).toBeNull()
    const pager = view.getByRole('navigation', { name: 'Step through questions' })
    expect(pager.textContent).toContain('1 of 10')
    expect(within(pager).getByRole('button', { name: 'Previous question' })).toHaveProperty(
      'disabled',
      true
    )
    expect(within(pager).getByRole('link', { name: 'Next question' }).getAttribute('href')).toBe(
      '#/pages/p/prompt/2'
    )
  })

  it('leaves out the path and the pager when not given', () => {
    const view = render(<PageNav back={{ href: '#/pages', label: 'All pages' }} />)
    expect(view.queryByRole('list')).toBeNull()
    expect(view.queryByRole('navigation')).toBeNull()
  })

  it('puts the detail after the path and the end slot before the pager', () => {
    const view = render(
      <PageNav
        back={{ href: '#/pages', label: 'All pages' }}
        detail={<span>textbolt.com/pricing</span>}
        end={<span>2 markets</span>}
        pager={PAGER}
      />
    )
    const root = view.container.firstElementChild
    expect(root?.querySelector('.ui-pagenav-path .ui-pagenav-detail')?.textContent).toBe(
      'textbolt.com/pricing'
    )
    const end = root?.querySelector('.ui-pagenav-end')
    expect(end?.textContent).toBe('2 markets')
    expect(end?.nextElementSibling?.className).toBe('ui-pagenav-pager')
  })

  it('is axe clean', async () => {
    const view = render(
      <PageNav
        back={{ href: '#/pages/p/results', label: 'Results' }}
        crumbs={[{ label: 'TextBolt', href: '#/pages' }, { label: 'Question 1' }]}
        pager={PAGER}
      />
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
