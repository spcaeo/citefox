// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CheckCompanyDomainRequest, CompanySuggestion, ProductSuggestion } from '@shared/ipc'
import { CompanyGroups } from './CompanyGroups'

afterEach(cleanup)

function company(name: string, domain: string | null, path: string): CompanySuggestion {
  return {
    id: name,
    name,
    domain,
    domainSource: domain === null ? null : 'site',
    reason: `Why ${name}.`,
    evidence: { path, quote: `${name} quote` },
    checkDomain: false
  }
}

const noop = (): void => undefined

describe('CompanyGroups (feedback 3)', () => {
  it('shows nothing when CiteFox AI found no companies', () => {
    const view = render(
      <CompanyGroups
        site="textbolt.com"
        competitors={[]}
        switchingFrom={[]}
        integrations={[]}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
      />
    )
    expect(view.container.innerHTML).toBe('')
  })

  it('without an add handler, lists competitors with the hint and no add button', () => {
    const used: string[][] = []
    const noted: string[][] = []
    const view = render(
      <CompanyGroups
        site="textbolt.com"
        competitors={[company('Text-Em-All', 'text-em-all.com', '/compare')]}
        switchingFrom={[
          company('AT&T email-to-text', null, '/att-email-to-text-alternative'),
          company('Verizon vText', null, '/verizon-vtext-alternative')
        ]}
        integrations={[company('WIN-911', null, '/win-911'), company('Gmail', null, '/')]}
        headingLevel={4}
        competitorHint="Add them in Project settings to track them."
        onUseSwitchingFrom={(names) => used.push(names)}
        onNoteIntegrations={(names) => noted.push(names)}
      />
    )
    expect(view.getAllByRole('heading', { level: 4 }).map((node) => node.textContent)).toEqual([
      'Competitors',
      'What buyers switch from',
      'Integrations & partners'
    ])
    expect(view.queryByRole('button', { name: /Add competitor/ })).toBeNull()
    expect(view.container.textContent).toContain('Add them in Project settings to track them.')
    fireEvent.click(view.getByRole('button', { name: 'Use in buyer questions' }))
    fireEvent.click(view.getByRole('button', { name: 'Note as integrations' }))
    expect(used).toEqual([['AT&T email-to-text', 'Verizon vText']])
    expect(noted).toEqual([['WIN-911', 'Gmail']])
    expect(view.queryByRole('button', { name: 'Use in buyer questions' })).toBeNull()
    expect(view.getByText('Noted as integrations')).toBeTruthy()
    const open = view.getByRole('link', {
      name: 'Open textbolt.com/att-email-to-text-alternative in a new tab'
    })
    expect(open.getAttribute('href')).toBe('https://textbolt.com/att-email-to-text-alternative')
  })

  it('adds a competitor once and marks it added', () => {
    const added: string[] = []
    const view = render(
      <CompanyGroups
        site="textbolt.com"
        competitors={[company('Text-Em-All', 'text-em-all.com', '/compare')]}
        switchingFrom={[]}
        integrations={[]}
        onAddCompetitor={(domain) => added.push(domain)}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
      />
    )
    fireEvent.click(view.getByRole('button', { name: 'Add competitor Text-Em-All' }))
    expect(added).toEqual(['text-em-all.com'])
    expect(view.getByRole('button', { name: 'Added' }).hasAttribute('disabled')).toBe(true)
  })

  it('tags a looked-up domain "found by lookup" with a tooltip; a site domain has no tag', () => {
    const view = render(
      <CompanyGroups
        site="textbolt.com"
        competitors={[
          { ...company('Text-Em-All', 'text-em-all.com', '/compare'), domainSource: 'lookup' },
          company('SimpleTexting', 'simpletexting.com', '/pricing')
        ]}
        switchingFrom={[]}
        integrations={[]}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
      />
    )
    const tags = view.container.querySelectorAll('.fill-domain-tag')
    expect(tags).toHaveLength(1)
    expect(tags[0]?.textContent).toContain('found by lookup')
    expect(tags[0]?.getAttribute('title')).toMatch(/looked up and checked/)
  })

  it('an unknown domain can be typed: invalid text and a domain that does not resolve say so', async () => {
    const asked: CheckCompanyDomainRequest[] = []
    const added: string[] = []
    const view = render(
      <CompanyGroups
        site="textbolt.com"
        competitors={[{ ...company('SimpleTexting', null, '/pricing'), checkDomain: true }]}
        switchingFrom={[]}
        integrations={[]}
        onAddCompetitor={(domain) => added.push(domain)}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
        onCheckDomain={(request) => {
          asked.push(request)
          return Promise.resolve(
            request.domain === 'simpletexting.com'
              ? { ok: true, domain: 'simpletexting.com', message: 'found.' }
              : { ok: false, domain: null, message: `${request.domain} was not found.` }
          )
        }}
      />
    )
    expect(view.container.textContent).toContain('Domain unknown · check it')
    expect(view.queryByRole('button', { name: 'Add competitor SimpleTexting' })).toBeNull()
    const input = view.getByRole('textbox', { name: 'Domain for SimpleTexting' })
    fireEvent.change(input, { target: { value: 'not a domain' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    expect(view.getByRole('alert').textContent).toBe('Enter a domain such as example.com.')
    expect(asked).toEqual([])

    fireEvent.change(input, { target: { value: 'simpletext.invalid' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe('simpletext.invalid was not found.')
    )

    fireEvent.change(input, { target: { value: 'https://www.SimpleTexting.com/' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(view.container.textContent).toContain('added by you'))
    expect(asked.map((item) => item.domain)).toEqual(['simpletext.invalid', 'simpletexting.com'])
    expect(view.queryByText(/Domain unknown/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Add competitor SimpleTexting' }))
    expect(added).toEqual(['simpletexting.com'])
  })

  it('without a check handler an unknown domain only says so', () => {
    const view = render(
      <CompanyGroups
        site="textbolt.com"
        competitors={[company('SimpleTexting', null, '/pricing')]}
        switchingFrom={[]}
        integrations={[]}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
      />
    )
    expect(view.container.textContent).toContain('Domain unknown')
    expect(view.queryByRole('textbox')).toBeNull()
  })
})

const PRODUCTS: ProductSuggestion[] = [
  {
    id: 'p-sms',
    name: 'Email-to-SMS gateway',
    job: 'Emails become texts.',
    buyer: 'US businesses.',
    evidence: null,
    searchNote: null
  },
  {
    id: 'p-alarm',
    name: 'Alarm alerting',
    job: 'Alarm emails become texts.',
    buyer: 'Plants.',
    evidence: null,
    searchNote: 'The web search could not run, so this list is from CiteFox AI’s knowledge only.'
  }
]

function rival(
  name: string,
  domain: string,
  product: string,
  tier: 'direct' | 'partial',
  extra: Partial<CompanySuggestion> = {}
): CompanySuggestion {
  return {
    id: `${product}-${name}`,
    name,
    domain,
    domainSource: 'search',
    reason: `Why ${name}.`,
    evidence: null,
    checkDomain: false,
    product,
    tier,
    startingPrice: null,
    sources: [],
    ...extra
  }
}

describe('CompanyGroups products (batch 2 row 5)', () => {
  const competitors = [
    rival('TXTImpact', 'txtimpact.com', 'p-sms', 'direct', {
      startingPrice: '$29/mo',
      sources: [
        { url: 'https://www.softwareadvice.com/sms/txtimpact/', biased: false },
        { url: 'https://txtimpact.com/email-to-sms', biased: true }
      ]
    }),
    rival('Twilio', 'twilio.com', 'p-sms', 'partial'),
    rival('ClickSend', 'clicksend.com', 'p-sms', 'direct'),
    rival('ClickSend', 'clicksend.com', 'p-alarm', 'partial'),
    { ...company('Old Rival', 'old.example', '/compare') }
  ]

  function renderProducts(added: string[] = []): ReturnType<typeof render> {
    return render(
      <CompanyGroups
        site="textbolt.com"
        products={PRODUCTS}
        competitors={competitors}
        switchingFrom={[]}
        integrations={[]}
        onAddCompetitor={(domain) => added.push(domain)}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
      />
    )
  }

  it('groups competitors by product into direct and partial, with price and sources', () => {
    const view = renderProducts()
    const sms = view.getByRole('region', { name: 'Competitors for Email-to-SMS gateway' })
    const headings = [...sms.querySelectorAll('h4, h5')].map((node) => node.textContent)
    expect(headings).toEqual(['Email-to-SMS gateway', 'Direct competitors', 'Partial overlap'])
    expect(sms.querySelector('.fill-rival .fill-price')?.textContent).toBe('Starting price $29/mo')
    expect(sms.textContent).toContain('Not listed')
    const sources = sms.querySelector('details.fill-sources')
    expect(sources?.querySelector('summary')?.textContent).toBe('Sources (2)')
    expect(sources?.textContent).toContain('softwareadvice.com/sms/txtimpact')
    expect(sources?.querySelectorAll('.fill-biased')).toHaveLength(1)
    expect(
      view.getByRole('link', { name: 'Open txtimpact.com/email-to-sms in a new tab' })
    ).toBeTruthy()
    const alarm = view.getByRole('region', { name: 'Competitors for Alarm alerting' })
    expect(alarm.textContent).toContain('from CiteFox AI’s knowledge only')
    // A competitor without a known product keeps the flat group.
    expect(view.getByRole('heading', { level: 3, name: 'Competitors' })).toBeTruthy()
    // A web-search domain has no chip, only a tooltip.
    expect(view.container.querySelectorAll('.fill-domain-tag')).toHaveLength(0)
  })

  it('shows the cheapest price of a group in green, per unit, with what was compared', () => {
    const priced = [
      rival('text.email', 'text.email', 'p-sms', 'direct', { startingPrice: 'From $20/mo' }),
      rival('SMSGlobal', 'smsglobal.com', 'p-sms', 'direct', { startingPrice: '$0.019/text' }),
      rival('ClickSend', 'clicksend.com', 'p-sms', 'direct', { startingPrice: '$0.02/text' }),
      rival('TXTImpact', 'txtimpact.com', 'p-sms', 'direct', { startingPrice: 'From $29/mo' }),
      rival('Plivo', 'plivo.com', 'p-sms', 'partial', { startingPrice: '$0.0077/text' })
    ]
    const view = render(
      <CompanyGroups
        site="textbolt.com"
        products={[PRODUCTS[0] as ProductSuggestion]}
        competitors={priced}
        switchingFrom={[]}
        integrations={[]}
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
      />
    )
    const low = [...view.container.querySelectorAll('.fill-price-low')]
    expect(low.map((node) => node.querySelector('.fill-price-value')?.textContent)).toEqual([
      'Starting price From $20/mo',
      'Starting price $0.019/text'
    ])
    expect(low[1]?.getAttribute('title')).toBe(
      'Cheapest per message among the 2 direct competitors that list a price per message.'
    )
    expect(low[1]?.textContent).toContain('Lowest per text')
    // One price in partial overlap: nothing to compare, so no green there.
    expect(view.container.querySelectorAll('.fill-price-low')).toHaveLength(2)
    const line = view.container.querySelector('.fill-cheapest')
    expect(line?.textContent).toBe(
      'Cheapest direct rivals: text.email From $20/mo · SMSGlobal $0.019/text'
    )
    // Each company carries its site icon (a letter tile until the icon arrives).
    expect(view.container.querySelector('[data-site-icon="smsglobal.com"]')).toBeTruthy()
  })

  it('shows one section only when asked (the Fill card tabs)', () => {
    const view = render(
      <CompanyGroups
        site="textbolt.com"
        products={PRODUCTS}
        competitors={competitors}
        switchingFrom={[company('Old Gateway', null, '/old')]}
        integrations={[company('Gmail', null, '/gmail')]}
        only="switching"
        onUseSwitchingFrom={noop}
        onNoteIntegrations={noop}
      />
    )
    expect(view.getAllByRole('heading').map((node) => node.textContent)).toEqual([
      'What buyers switch from'
    ])
  })

  it('adding a company under one product marks it added under the other', () => {
    const added: string[] = []
    const view = renderProducts(added)
    const buttons = view.getAllByRole('button', { name: 'Add competitor ClickSend' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0] as HTMLElement)
    expect(added).toEqual(['clicksend.com'])
    expect(view.queryAllByRole('button', { name: 'Add competitor ClickSend' })).toHaveLength(0)
    expect(view.getAllByRole('button', { name: 'Added' })).toHaveLength(2)
  })

  it('renames a product label and removes a product with its competitors', () => {
    const view = renderProducts()
    fireEvent.click(view.getByRole('button', { name: 'Rename product Email-to-SMS gateway' }))
    const input = view.getByRole('textbox', { name: 'Rename product Email-to-SMS gateway' })
    fireEvent.change(input, { target: { value: 'Email to text' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(view.getByRole('region', { name: 'Competitors for Email to text' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Remove product Alarm alerting' }))
    expect(view.queryByRole('region', { name: 'Competitors for Alarm alerting' })).toBeNull()
    expect(view.getAllByRole('button', { name: 'Add competitor ClickSend' })).toHaveLength(1)
  })
})
