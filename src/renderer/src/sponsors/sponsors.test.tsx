// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import { SPONSOR_UTM } from '@shared/sponsors'
import { SidebarSponsor } from './SidebarSponsor'
import { SponsorCard } from './SponsorCard'
import { SponsorList } from './SponsorList'
import { SponsorStrip } from './SponsorStrip'
import { resetSponsorStrip } from './stripState'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

afterEach(() => {
  cleanup()
  resetSponsorStrip()
})

/** Every sponsor link: https, the sponsor's own host, only CiteFox's utm query, a new window. */
function expectSafeLinks(root: HTMLElement, host: string): void {
  const links = within(root).getAllByRole('link')
  expect(links.length).toBeGreaterThan(0)
  for (const link of links) {
    const url = new URL(link.getAttribute('href') ?? '')
    expect(url.protocol).toBe('https:')
    expect(url.host).toBe(host)
    expect(Object.fromEntries(url.searchParams)).toEqual(SPONSOR_UTM)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  }
}

describe('gold sponsor strip', () => {
  it('shows FoxCue with its line and one call to action, linking with the utm query only', async () => {
    const view = render(<SponsorStrip />)
    const strip = view.getByRole('complementary', { name: 'Gold sponsor' })
    expect(strip.textContent).toContain('Sponsored by')
    expect(strip.textContent).toContain('Get cited in AI answers, with you on camera')
    expect(within(strip).getByRole('link', { name: /Join the waitlist at FoxCue/ })).toBeTruthy()
    expect(within(strip).getByRole('img', { name: 'FoxCue' }).getAttribute('src')).not.toMatch(
      /^https?:/
    )
    expectSafeLinks(strip, 'foxcue.com')
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('folds to a thin line for the session with Hide for now, and comes back', () => {
    const view = render(<SponsorStrip />)
    fireEvent.click(view.getByRole('button', { name: 'Hide for now' }))
    expect(view.queryByText('Sponsored by')).toBeNull()
    const show = view.getByRole('button', { name: /Show the FoxCue sponsor line again/ })
    fireEvent.click(show)
    expect(view.getByText('Sponsored by')).toBeTruthy()
  })
})

describe('gold sponsor card (end of every screen)', () => {
  it('shows Sponsor, the FoxCue logo, its line and the waitlist link with the utm query only', async () => {
    const view = render(<SponsorCard />)
    const card = view.getByRole('complementary', { name: 'Gold sponsor' })
    expect(card.textContent).toContain('Sponsor')
    expect(card.textContent).toContain('Get cited in AI answers, with you on camera')
    expect(card.textContent).toContain('FoxCue turns your pages into videos AI Overviews cite.')
    expect(within(card).getByRole('link', { name: /Join the waitlist at FoxCue/ })).toBeTruthy()
    expect(within(card).getByRole('img', { name: 'FoxCue' })).toBeTruthy()
    expectSafeLinks(card, 'foxcue.com')
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('hides for now to a thin line, shared with the strip, and comes back', () => {
    const view = render(
      <>
        <SponsorCard />
        <SponsorStrip />
      </>
    )
    const [cardHide] = view.getAllByRole('button', { name: 'Hide for now' })
    fireEvent.click(cardHide as HTMLElement)
    expect(view.queryByRole('link', { name: /Join the waitlist/ })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /Show the FoxCue sponsor again/ }))
    expect(view.getAllByRole('link', { name: /Join the waitlist/ })).toHaveLength(2)
  })
})

describe('silver sponsor card', () => {
  it('shows FreshlyCited as the silver sponsor with a safe link', async () => {
    const view = render(<SidebarSponsor />)
    const card = view.getByRole('complementary', { name: 'Silver sponsor' })
    expect(card.textContent).toContain('FreshlyCited')
    expect(card.textContent).toContain('Check my pages free')
    expectSafeLinks(card, 'freshlycited.com')
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('shows only the mark in the collapsed rail, still named', () => {
    const view = render(<SidebarSponsor collapsed />)
    const link = view.getByRole('link', { name: /FreshlyCited, silver sponsor/ })
    expect(link.getAttribute('data-tip')).toBe('FreshlyCited · Silver sponsor')
    expectSafeLinks(view.container, 'freshlycited.com')
  })
})

describe('sponsor list', () => {
  it('lists both sponsors with their tier and says why there are sponsors', async () => {
    const view = render(<SponsorList />)
    expect(view.getByText('Gold sponsor')).toBeTruthy()
    expect(view.getByText('Silver sponsor')).toBeTruthy()
    expect(view.getByText('Why sponsors?')).toBeTruthy()
    expect(view.getAllByRole('link')).toHaveLength(2)
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })
})
