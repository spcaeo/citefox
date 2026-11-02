import type {
  CheckCompanyDomainRequest,
  CheckCompanyDomainResult,
  CompanySource,
  CompanySuggestion,
  CompetitorTier,
  FillFromWebsiteResult,
  ProductCompetitorsRequest,
  ProductCompetitorsResult,
  ProductSuggestion
} from '@shared/ipc'
import { typedHostname } from '../../fill/domain'

/**
 * Mock `projects:fillFromWebsite` (Docs/FEEDBACK.md row 3, batch 2 row 5). textbolt.com
 * returns what the real read produces for the owner's site: a summary, two products
 * with the competitors a web search finds for each (direct and partial overlap), the
 * carrier gateways buyers switch from, and an integration. Text-Em-All's domain was
 * found by lookup (batch 2 row 3); SimpleTexting's stays unknown, so the user can type
 * it. ClickSend sits under both products.
 */
const TEXTBOLT_PRODUCTS: readonly ProductSuggestion[] = [
  {
    id: 'prod-email-sms',
    name: 'Email-to-SMS gateway',
    job: 'Turns emails into texts and sends replies back to the inbox, with no app or code.',
    buyer: 'US and Canada businesses replacing carrier email-to-text gateways.',
    evidence: { path: '/', quote: 'Send texts from your email.' },
    searchNote: null
  },
  {
    id: 'prod-alarm',
    name: 'Alarm and SCADA alerting',
    job: 'Sends alarm emails from monitoring systems as texts to on-call staff.',
    buyer: 'Plants and facilities with alarm software.',
    evidence: { path: '/', quote: 'Alarm notifications as texts.' },
    searchNote: null
  }
]

function rival(
  product: string,
  tier: CompetitorTier,
  name: string,
  domain: string | null,
  reason: string,
  startingPrice: string | null,
  sources: readonly CompanySource[],
  extra: Partial<CompanySuggestion> = {}
): CompanySuggestion {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return {
    id: `comp-${product}-${slug}`,
    name,
    domain,
    domainSource: domain === null ? null : 'search',
    reason,
    evidence: null,
    checkDomain: false,
    product,
    tier,
    startingPrice,
    sources,
    ...extra
  }
}

const EMAIL = 'prod-email-sms'
const ALARM = 'prod-alarm'

const TEXTBOLT_COMPETITORS: readonly CompanySuggestion[] = [
  rival(
    EMAIL,
    'direct',
    'TXTImpact',
    'txtimpact.com',
    'Email-to-SMS for businesses, replies land back in the inbox.',
    '$29/mo',
    [
      { url: 'https://www.softwareadvice.com/sms-marketing/txtimpact-profile/', biased: false },
      { url: 'https://txtimpact.com/email-to-sms', biased: true }
    ]
  ),
  rival(
    EMAIL,
    'direct',
    'Notifyre',
    'notifyre.com',
    'Sends texts from any email client to US and Canadian numbers.',
    '$0.04/text',
    [{ url: 'https://notifyre.com/us/email-to-sms', biased: true }]
  ),
  rival(
    EMAIL,
    'direct',
    'Textmagic',
    'textmagic.com',
    'Business texting with an email-to-SMS gateway and two-way replies.',
    null,
    [{ url: 'https://www.textmagic.com/email-to-sms/', biased: true }]
  ),
  rival(
    EMAIL,
    'direct',
    'ClickSend',
    'clicksend.com',
    'Email-to-SMS for teams that want texting without an app.',
    '$0.03/text',
    [
      { url: 'https://www.g2.com/products/clicksend/reviews', biased: false },
      { url: 'https://textbolt.com/clicksend-alternative', biased: true },
      { url: 'https://www.clicksend.com/us/email-sms/', biased: true }
    ]
  ),
  rival(
    EMAIL,
    'partial',
    'SimpleTexting',
    null,
    'Marketing texting app; email-to-text is a side feature.',
    '$29/mo',
    [{ url: 'https://textbolt.com/simpletexting-alternative', biased: true }],
    { checkDomain: true }
  ),
  rival(
    EMAIL,
    'partial',
    'Text-Em-All',
    'text-em-all.com',
    'Mass calls and texts to staff; no email gateway.',
    null,
    [],
    { domainSource: 'lookup' }
  ),
  rival(
    EMAIL,
    'partial',
    'Textedly',
    'textedly.com',
    'SMS marketing for small businesses.',
    '$26/mo',
    []
  ),
  rival(
    EMAIL,
    'partial',
    'Salesmsg',
    'salesmessage.com',
    'Two-way texting for sales teams.',
    '$25/mo',
    []
  ),
  rival(
    EMAIL,
    'partial',
    'Twilio',
    'twilio.com',
    'SMS API: needs a developer to build it.',
    null,
    []
  ),
  rival(
    ALARM,
    'direct',
    'SMSEagle',
    'smseagle.eu',
    'On-site SMS gateway hardware that texts alarms without the internet.',
    null,
    [{ url: 'https://www.smseagle.eu/integration-plugins/', biased: true }]
  ),
  rival(
    ALARM,
    'partial',
    'Ozeki SMS Gateway',
    'ozeki-sms-gateway.com',
    'On-premise SMS software that alarm systems can send through.',
    null,
    []
  ),
  rival(
    ALARM,
    'partial',
    'ClickSend',
    'clicksend.com',
    'Email-to-SMS that alarm emails can be sent to; not built for alarms.',
    '$0.03/text',
    []
  )
]

const TEXTBOLT_SWITCHING_FROM: readonly CompanySuggestion[] = [
  {
    id: 'switch-att',
    name: 'AT&T email-to-text',
    domain: null,
    domainSource: null,
    reason: 'The gateway shut down, so teams that emailed alerts to txt.att.net need a new way.',
    evidence: {
      path: '/att-email-to-text-alternative',
      quote: 'AT&T shut down its email-to-text gateway.'
    },
    checkDomain: false
  },
  {
    id: 'switch-verizon',
    name: 'Verizon vText',
    domain: null,
    domainSource: null,
    reason: 'vtext.com email to SMS was discontinued for business senders.',
    evidence: { path: '/verizon-vtext-alternative', quote: 'Verizon discontinued vtext.com.' },
    checkDomain: false
  },
  {
    id: 'switch-tmobile',
    name: 'T-Mobile email-to-text',
    domain: null,
    domainSource: null,
    reason: 'Its gateway was turned off too, so alerts sent to it stopped arriving.',
    evidence: {
      path: '/att-email-to-text-alternative',
      quote: 'T-Mobile also turned off its gateway.'
    },
    checkDomain: false
  }
]

const TEXTBOLT_INTEGRATIONS: readonly CompanySuggestion[] = [
  {
    id: 'integ-win911',
    name: 'WIN-911',
    domain: null,
    domainSource: null,
    reason: 'Alarm software whose users send alarm notifications through TextBolt.',
    evidence: { path: '/win-911', quote: 'Send WIN-911 alarm notifications as texts.' },
    checkDomain: false
  }
]

export function fillFromDomain(domain: string): FillFromWebsiteResult {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (host === 'textbolt.com') {
    return {
      domain: host,
      pagesRead: [
        { url: 'https://textbolt.com/', role: 'home', ok: true },
        { url: 'https://textbolt.com/pricing', role: 'pricing', ok: true },
        { url: 'https://textbolt.com/about', role: 'about', ok: true },
        { url: 'https://textbolt.com/compare', role: 'compare', ok: true }
      ],
      summary:
        'TextBolt is an email-to-SMS gateway: email a phone number and it arrives as a text, replies come back to the inbox. It is for US and Canada businesses replacing the carrier gateways that shut down, from $29/mo.',
      products: TEXTBOLT_PRODUCTS,
      brands: [
        { id: 'brand-textbolt', name: 'TextBolt', reason: 'The site name on the home page.' }
      ],
      competitors: TEXTBOLT_COMPETITORS,
      switchingFrom: TEXTBOLT_SWITCHING_FROM,
      integrations: TEXTBOLT_INTEGRATIONS,
      suggestedMarket: {
        country: 'US',
        language: 'en',
        location: null,
        reason: 'Prices are in US dollars and the pages name US carriers.'
      },
      message: 'Suggestions are ready. Nothing was saved.',
      nextStep: null
    }
  }
  const label = host.split('.')[0] ?? host
  const name = label.length > 0 ? label.charAt(0).toUpperCase() + label.slice(1) : host
  return {
    domain: host,
    pagesRead: [
      { url: `https://${host}/`, role: 'home', ok: true },
      { url: `https://${host}/pricing`, role: 'pricing', ok: false },
      { url: `https://${host}/about`, role: 'about', ok: false },
      { url: `https://${host}/compare`, role: 'compare', ok: false }
    ],
    brands: [
      {
        id: `brand-${
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'project'
        }`,
        name,
        reason: 'Taken from the domain. Confirm it before saving.'
      }
    ],
    competitors: [],
    switchingFrom: [],
    integrations: [],
    suggestedMarket: null,
    message: `Read ${host}: home. Pricing, about, and compare did not load, so no market was suggested.`,
    nextStep: 'Add competitors and a default market yourself, or try another domain.'
  }
}

/**
 * Mock `projects:searchProductCompetitors`: the sample's competitors for the product with
 * the same name (textbolt.com), under the id the screen sent; none for any other product.
 */
export function searchProductInMock(request: ProductCompetitorsRequest): ProductCompetitorsResult {
  const sample = TEXTBOLT_PRODUCTS.find((product) => product.name === request.product.name)
  const competitors =
    sample === undefined
      ? []
      : TEXTBOLT_COMPETITORS.filter((row) => row.product === sample.id).map((row) => ({
          ...row,
          product: request.product.id
        }))
  return { productId: request.product.id, ok: true, competitors, note: null }
}

/** Mock `projects:checkCompanyDomain`: any valid hostname resolves except `*.invalid`. */
export function checkDomainInMock(request: CheckCompanyDomainRequest): CheckCompanyDomainResult {
  const host = typedHostname(request.domain)
  if (host === null) {
    return { ok: false, domain: null, message: 'Enter a domain such as example.com.' }
  }
  if (host.endsWith('.invalid')) {
    return {
      ok: false,
      domain: null,
      message: `${host} was not found. Check the spelling and try again.`
    }
  }
  return { ok: true, domain: host, message: `${host} found.` }
}
