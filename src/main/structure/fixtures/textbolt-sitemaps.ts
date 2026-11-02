/**
 * A deterministic synthetic copy of the TextBolt sitemaps (SRS FR-20.1: the
 * real one has 2,014 pages). No randomness: a seeded LCG picks slugs and
 * dates, so every run builds the same files. Test-only data.
 *
 * `base` is the site as first read: 2,014 page URLs in six included sitemaps
 * plus a low-value tag sitemap. `next` is the same site a day later: 6 new
 * pages, 1 removed page, and 14 pages with a newer `lastmod`.
 */

export const TEXTBOLT_FIXTURE_NOW = '2026-10-19T09:00:00.000Z'

export interface SitemapFixture {
  /** Absolute URL → response body (robots.txt, the index, each sitemap). */
  files: ReadonlyMap<string, string>
  /** Own-domain page URLs in the included (non-tag) sitemaps. */
  pageUrls: readonly string[]
}

const ORIGIN = 'https://textbolt.com'
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const CHANGED_LASTMOD = '2026-10-19T08:30:00+00:00'

const COUNTS = { blog: 1420, feature: 96, useCase: 210, integration: 120, compare: 48, page: 120 }

const BLOG_REQUIRED = [
  'how-to-set-up-text-alerts-for-business',
  'how-to-set-up-text-alerts-for-businesses',
  'carrier-email-to-text-list-2024',
  'carrier-email-to-text-stopped-working',
  'email-to-sms',
  '10dlc-registration-guide',
  '10dlc-campaign-rejected',
  'tcpa-business-texting',
  'schedule-text-messages-gmail',
  'outlook-delay-delivery-sms',
  'datadog-sms-alerts',
  'server-down-text-alerts',
  'uptime-alerts-without-pagerduty',
  'monitoring-alerts-to-sms',
  'sms-marketing-small-business',
  'appointment-reminder-text',
  'text-message-open-rates'
]

/** Topic stems by theme. Bare stems are never generated, only stems with a modifier. */
// prettier-ignore
const BLOG_STEMS = [
  ['email-to-sms', 'email-to-text', 'carrier-email-gateway', 'vtext-com', 'txt-att-net',
    'tmomail-net', 'sms-gateway-address'],
  ['10dlc-registration', '10dlc-campaign', 'tcpa-compliance', 'sms-opt-in',
    'toll-free-verification', 'a2p-messaging', 'sms-consent'],
  ['schedule-text-messages', 'appointment-reminder-texts', 'recurring-sms', 'delayed-sms',
    'shift-reminder-sms', 'reminder-text-templates'],
  ['monitoring-sms-alerts', 'server-down-alerts', 'uptime-alerts', 'it-incident-sms',
    'nagios-text-alerts', 'on-call-text-alerts'],
  ['sms-marketing', 'text-message-marketing', 'sms-campaigns', 'promotional-texts', 'sms-coupons'],
  ['two-way-texting', 'business-texting', 'text-customer-support', 'shared-inbox-sms'],
  ['group-texting', 'mass-texting', 'bulk-sms', 'broadcast-sms'],
  ['sms-for-churches', 'sms-for-schools', 'sms-for-restaurants', 'sms-for-real-estate',
    'sms-for-contractors', 'sms-for-salons']
].flat()

// prettier-ignore
const BLOG_PREFIXES = [
  '', 'how-to-use', 'guide-to', 'best', 'what-is', 'why-use', 'beginners-guide-to', 'tips-for',
  'mistakes-with', 'cost-of', 'setting-up', 'troubleshooting'
]
// prettier-ignore
const BLOG_SUFFIXES = [
  '', 'for-small-business', 'in-2026', 'examples', 'templates', 'checklist', 'faq', 'vs-email',
  'for-teams', 'best-practices', 'explained', 'step-by-step'
]

// prettier-ignore
const FEATURES = [
  'bulk-sms', 'two-way-texting', 'scheduled-texts', 'autoresponder', 'group-texting',
  'email-to-sms', 'sms-api', 'keywords', 'contact-import', 'link-tracking', 'mms', 'shared-inbox',
  'templates', 'analytics', 'integrations-hub', 'opt-out-management', 'short-links',
  'drip-campaigns', 'sms-surveys', 'appointment-reminders', 'webhooks', 'team-permissions',
  'zapier-sms', 'toll-free-numbers'
]
const FEATURE_VARIANTS = ['', 'for-teams', 'for-agencies', 'for-enterprise']

// prettier-ignore
const TEMPLATE_INDUSTRIES = [
  'churches', 'schools', 'dentists', 'restaurants', 'gyms', 'salons', 'plumbers', 'electricians',
  'roofers', 'landscapers', 'auto-repair', 'law-firms', 'accountants', 'insurance-agents',
  'realtors', 'veterinarians', 'nonprofits', 'hotels', 'car-dealers', 'pharmacies', 'clinics',
  'daycares', 'tutors', 'cleaners', 'movers', 'caterers', 'florists', 'spas', 'chiropractors',
  'optometrists', 'photographers', 'event-planners', 'banks', 'credit-unions', 'utilities',
  'government', 'universities', 'staffing-agencies', 'logistics', 'warehouses'
]
const USE_CASE_FOLDERS = ['healthcare', 'field-service', 'retail', 'education', 'hospitality']
// prettier-ignore
const USE_CASE_TOPICS = [
  'appointment-reminders', 'staff-alerts', 'shift-swaps', 'customer-updates', 'emergency-alerts',
  'review-requests', 'payment-reminders', 'surveys', 'promotions', 'onboarding-texts',
  'no-show-reduction', 'two-way-chat', 'closing-alerts', 'waitlist-texts', 'delivery-updates',
  'crew-dispatch', 'safety-alerts'
]
const USE_CASE_MODIFIERS = ['', 'guide', 'templates']

// prettier-ignore
const TOOLS = [
  'zapier', 'hubspot', 'salesforce', 'slack', 'google-sheets', 'gmail', 'outlook', 'datadog',
  'grafana', 'pagerduty', 'jira', 'shopify', 'woocommerce', 'mailchimp', 'calendly', 'acuity',
  'square', 'stripe', 'quickbooks', 'zoho', 'pipedrive', 'monday', 'asana', 'trello', 'airtable',
  'make', 'microsoft-teams', 'servicetitan', 'jobber', 'housecall-pro', 'clio', 'mindbody',
  'vagaro', 'opentable', 'toast', 'freshdesk', 'zendesk', 'intercom', 'prometheus', 'new-relic'
]
const TOOL_VARIANTS = ['', 'sms-alerts', 'two-way-sync']

// prettier-ignore
const COMPETITORS = [
  'simpletexting', 'clicksend', 'textmagic', 'twilio', 'eztexting', 'textedly', 'slicktext',
  'podium', 'textline', 'heymarket', 'salesmsg', 'callhub', 'trumpia', 'sakari',
  'mobile-text-alerts', 'textgrid', 'plivo', 'vonage', 'messagebird', 'sinch', 'bandwidth',
  'telnyx', 'emitrr', 'quo'
]

// prettier-ignore
const CORE_PAGES = [
  '', 'pricing', 'about', 'contact', 'help', 'careers', 'privacy', 'terms', 'security', 'status',
  'partners', 'affiliates', 'press', 'customers', 'reviews', 'demo', 'signup', 'login'
]
// prettier-ignore
const HELP_ACTIONS = [
  'add', 'import', 'export', 'delete', 'edit', 'schedule', 'send', 'verify', 'connect', 'set-up'
]
// prettier-ignore
const HELP_OBJECTS = [
  'contacts', 'groups', 'a-number', 'keywords', 'templates', 'a-campaign', 'an-integration',
  'billing', 'users', 'autoresponder', 'opt-outs'
]

// prettier-ignore
const TAG_WORDS = [
  'sms', 'texting', 'alerts', 'marketing', 'compliance', 'scheduling', 'monitoring', 'email',
  'carriers', 'industries', 'tips', 'guides', 'news', 'product', 'api', 'reminders', 'groups',
  'two-way', 'mms', 'bulk', 'templates', 'support', 'sales', 'retail', 'healthcare', 'education'
]

const NEW_PAGES = {
  blog: [
    'verizon-vtext-com-shutdown',
    'schedule-text-from-outlook',
    'grafana-sms-alerts',
    'sms-alerts-for-hvac-teams'
  ],
  useCase: 'property-management',
  compare: 'textbolt-vs-pagerduty'
}
const REMOVED_URL = `${ORIGIN}/blog/carrier-email-to-text-list-2024/`

const CHANGED_URLS = [
  `${ORIGIN}/blog/how-to-set-up-text-alerts-for-business/`,
  `${ORIGIN}/blog/10dlc-registration-guide/`,
  `${ORIGIN}/features/scheduled-texts/`,
  `${ORIGIN}/compare/textbolt-vs-simpletexting/`,
  `${ORIGIN}/pricing/`
]

interface Entry {
  url: string
  lastmod: string
}

interface SitemapFile {
  name: string
  entries: Entry[]
}

/** Park–Miller LCG. Deterministic across runs and platforms. */
function lcg(seed: number): () => number {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return () => {
    state = (state * 16807) % 2147483647
    return state
  }
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const next = lcg(seed)
  const out = [...items]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1)
    const held = out[index] as T
    out[index] = out[swap] as T
    out[swap] = held
  }
  return out
}

function joinSlug(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('-')
}

function take(
  required: readonly string[],
  pool: readonly string[],
  count: number,
  seed: number
): string[] {
  const chosen = new Set(required)
  for (const slug of shuffled(pool, seed)) {
    if (chosen.size >= count) break
    chosen.add(slug)
  }
  if (chosen.size !== count) throw new Error(`fixture pool too small for ${count}`)
  return [...chosen]
}

function blogSlugs(): string[] {
  const reserved = new Set([...BLOG_REQUIRED, ...NEW_PAGES.blog])
  const pool: string[] = []
  for (const stem of BLOG_STEMS) {
    for (const prefix of BLOG_PREFIXES) {
      for (const suffix of BLOG_SUFFIXES) {
        if (prefix === '' && suffix === '') continue
        const slug = joinSlug(prefix, stem, suffix)
        if (!reserved.has(slug)) pool.push(slug)
      }
    }
  }
  return take(BLOG_REQUIRED, pool, COUNTS.blog, 11)
}

function caseStudyPaths(): string[] {
  const templates = TEMPLATE_INDUSTRIES.map((industry) => `text-messaging-for-${industry}`)
  const nested: string[] = []
  for (const folder of USE_CASE_FOLDERS) {
    for (const topic of USE_CASE_TOPICS) {
      for (const modifier of USE_CASE_MODIFIERS)
        nested.push(`${folder}/${joinSlug(topic, modifier)}`)
    }
  }
  return take(templates, nested, COUNTS.useCase, 23)
}

function pagePaths(): string[] {
  const help: string[] = []
  for (const action of HELP_ACTIONS) {
    for (const object of HELP_OBJECTS) help.push(`help/how-to-${action}-${object}`)
  }
  return take(CORE_PAGES, help, COUNTS.page, 31)
}

function tagPaths(): string[] {
  const pool: string[] = []
  for (const first of TAG_WORDS) {
    for (const second of TAG_WORDS) if (first !== second) pool.push(`tag/${first}-${second}`)
  }
  return take(
    TAG_WORDS.map((word) => `tag/${word}`),
    pool,
    312,
    41
  )
}

function pageUrl(path: string): string {
  return path.length === 0 ? `${ORIGIN}/` : `${ORIGIN}/${path}/`
}

function dated(paths: readonly string[], next: () => number): Entry[] {
  const nowMs = Date.parse(TEXTBOLT_FIXTURE_NOW)
  return paths.map((path) => {
    const roll = next()
    const daysAgo = 1 + (roll % 900)
    const day = new Date(nowMs - daysAgo * 86_400_000).toISOString().slice(0, 10)
    const lastmod = roll % 7 === 0 ? `${day}T09:00:00+00:00` : day
    return { url: pageUrl(path), lastmod }
  })
}

function baseFiles(): SitemapFile[] {
  const next = lcg(2014)
  const compare = [
    ...COMPETITORS.map((name) => `compare/textbolt-vs-${name}`),
    ...COMPETITORS.map((name) => `alternatives/${name}-alternatives`)
  ]
  const features: string[] = []
  for (const feature of FEATURES) {
    for (const variant of FEATURE_VARIANTS) features.push(`features/${joinSlug(feature, variant)}`)
  }
  const integrations: string[] = []
  for (const tool of TOOLS) {
    for (const variant of TOOL_VARIANTS)
      integrations.push(`integrations/${joinSlug(tool, variant)}`)
  }
  const files: SitemapFile[] = [
    {
      name: 'post-sitemap.xml',
      entries: dated(
        blogSlugs().map((slug) => `blog/${slug}`),
        next
      )
    },
    { name: 'page-sitemap.xml', entries: dated(pagePaths(), next) },
    { name: 'feature-sitemap.xml', entries: dated(features, next) },
    {
      name: 'use-case-sitemap.xml',
      entries: dated(
        caseStudyPaths().map((path) => `use-cases/${path}`),
        next
      )
    },
    { name: 'integration-sitemap.xml', entries: dated(integrations, next) },
    { name: 'compare-sitemap.xml', entries: dated(compare, next) },
    { name: 'tag-sitemap.xml', entries: dated(tagPaths(), next) }
  ]
  const alerts = files[0]?.entries.find((entry) => entry.url === CHANGED_URLS[0])
  if (alerts !== undefined) alerts.lastmod = '2026-10-16'
  return files
}

function nextFiles(files: readonly SitemapFile[]): SitemapFile[] {
  const changed = new Set(CHANGED_URLS)
  const blog = files[0]?.entries ?? []
  for (let index = 0; changed.size < 14; index += 97) {
    const entry = blog[index % blog.length]
    if (entry !== undefined && entry.url !== REMOVED_URL) changed.add(entry.url)
  }
  const added: Record<string, string[]> = {
    'post-sitemap.xml': NEW_PAGES.blog.map((slug) => `blog/${slug}`),
    'use-case-sitemap.xml': [`use-cases/${NEW_PAGES.useCase}`],
    'compare-sitemap.xml': [`compare/${NEW_PAGES.compare}`]
  }
  return files.map((file) => {
    const entries = file.entries
      .filter((entry) => entry.url !== REMOVED_URL)
      .map((entry) => (changed.has(entry.url) ? { ...entry, lastmod: CHANGED_LASTMOD } : entry))
    for (const path of added[file.name] ?? []) {
      entries.push({ url: pageUrl(path), lastmod: '2026-10-18' })
    }
    return { name: file.name, entries }
  })
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function urlsetXml(entries: readonly Entry[]): string {
  const rows = entries.map(
    (entry) => `  <url><loc>${escapeXml(entry.url)}</loc><lastmod>${entry.lastmod}</lastmod></url>`
  )
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${NS}">\n${rows.join('\n')}\n</urlset>\n`
}

function newest(entries: readonly Entry[]): string {
  let best = ''
  for (const entry of entries) if (entry.lastmod > best) best = entry.lastmod
  return best
}

export function textboltSitemapFixture(variant: 'base' | 'next' = 'base'): SitemapFixture {
  const base = baseFiles()
  const sitemaps = variant === 'next' ? nextFiles(base) : base
  const files = new Map<string, string>()
  files.set(
    `${ORIGIN}/robots.txt`,
    `User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: ${ORIGIN}/sitemap_index.xml\n`
  )
  const index = sitemaps.map(
    (file) =>
      `  <sitemap><loc>${ORIGIN}/${file.name}</loc><lastmod>${newest(file.entries)}</lastmod></sitemap>`
  )
  files.set(
    `${ORIGIN}/sitemap_index.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="${NS}">\n${index.join('\n')}\n</sitemapindex>\n`
  )
  for (const file of sitemaps) files.set(`${ORIGIN}/${file.name}`, urlsetXml(file.entries))
  const pageUrls = sitemaps
    .filter((file) => file.name !== 'tag-sitemap.xml')
    .flatMap((file) => file.entries.map((entry) => entry.url))
  return { files, pageUrls }
}
