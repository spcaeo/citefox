import type { ClaudeProvider } from '../providers/claude/claude-code'
import { readPage } from '../pipeline/page-reader'
import { insertPage } from '../storage/pages'
import { readProductCatalog, replaceProductCatalog, setPageProduct } from '../storage/products'
import { readProjectProfile, updateProjectProfile } from '../storage/project-profile'
import type { PageSmokeHookContext } from './hook-context'
import { TEXTBOLT_PASS } from './fill-products'

/**
 * What the `--reports` and `--sentiment` smokes need beyond the page smoke
 * (Docs/PROMPT-AUDIT.md, package P6): the brand spelled as the business writes it,
 * products with their own competitors (so a prompt can show it reads the page's
 * product, not the whole list), and on textbolt.com the pricing page as a tracked
 * own page for the fact check. No search; at most one page read.
 */

const EMAIL_TO_SMS = 'prod-email-sms'
const TWO_WAY = 'prod-two-way'
export const PRICING_PAGE_ID = 'page-smoke-pricing'

/** Seeds once per smoke. Returns a line for the stage detail. */
export async function seedP6Project(context: PageSmokeHookContext): Promise<string> {
  const db = context.setup.projectDb
  if (readProductCatalog(db).products.length > 0) return 'already seeded'
  const profile = readProjectProfile(db)
  if (profile === null) return 'no profile'
  const domain = new URL(context.args.url).hostname.replace(/^www\./, '')
  if (domain !== 'textbolt.com') return `no catalog for ${domain}`
  updateProjectProfile(db, {
    ...profile,
    brandNames: ['TextBolt'],
    switchingFrom: ['carrier email-to-SMS gateways such as vtext.com and txt.att.net'],
    integrations: ['Outlook', 'Gmail', 'Zapier']
  })
  replaceProductCatalog(db, {
    products: [
      {
        id: EMAIL_TO_SMS,
        name: 'Email to SMS',
        job: 'send SMS text alerts to staff and customers from email, Outlook or any system that sends email, with no code',
        buyer: 'small businesses and IT, facilities and operations teams without a developer'
      },
      {
        id: TWO_WAY,
        name: 'Two-way business texting',
        job: 'text customers back and forth from a shared business number and inbox',
        buyer: 'local service businesses and front-desk teams'
      }
    ],
    competitors: [
      ...TEXTBOLT_PASS.direct.map((name) => row(name, EMAIL_TO_SMS, 'direct')),
      ...TEXTBOLT_PASS.partial.map((name) => row(name, EMAIL_TO_SMS, 'partial')),
      row('Podium', TWO_WAY, 'direct'),
      row('Heymarket', TWO_WAY, 'direct')
    ]
  })
  setPageProduct(db, context.pageId, EMAIL_TO_SMS, true)
  const pricing = await readPricingPage(context)
  return `brand=TextBolt products=2 page product=Email to SMS${pricing}`
}

const DOMAINS: Readonly<Record<string, string>> = {
  TXTImpact: 'txtimpact.com',
  Notifyre: 'notifyre.com',
  Textmagic: 'textmagic.com',
  ClickSend: 'clicksend.com',
  SimpleTexting: 'simpletexting.com',
  Textedly: 'textedly.com',
  Salesmsg: 'salesmessage.com',
  Twilio: 'twilio.com',
  Podium: 'podium.com',
  Heymarket: 'heymarket.com'
}

function row(
  name: string,
  productId: string,
  tier: 'direct' | 'partial'
): {
  name: string
  domain: string | null
  productId: string
  tier: 'direct' | 'partial'
  startingPrice: null
  sources: []
} {
  return { name, domain: DOMAINS[name] ?? null, productId, tier, startingPrice: null, sources: [] }
}

/** The pricing page, tracked and read, so claims about price have an own page to check. */
async function readPricingPage(context: PageSmokeHookContext): Promise<string> {
  const db = context.setup.projectDb
  insertPage(db, {
    id: PRICING_PAGE_ID,
    projectId: context.projectId,
    url: 'https://textbolt.com/pricing/',
    title: 'Pricing',
    label: 'Pricing',
    folder: null,
    status: 'tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 3,
    defaultMarketId: context.marketId,
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  try {
    await readPage({
      db,
      transport: context.setup.transport,
      logger: context.setup.logger,
      secretStore: context.setup.secretStore,
      jinaKeychainRef: context.setup.jinaKeychainRef,
      reader: 'jina',
      jinaMode: 'always',
      pageId: PRICING_PAGE_ID,
      projectId: context.projectId,
      now: () => context.clock().toISOString(),
      clock: () => context.clock().getTime(),
      secrets: context.secrets
    })
    return ' pricing page read'
  } catch {
    return ' pricing page not read'
  }
}

/** One Claude call as the smoke measured it. */
export interface MeteredCall {
  kind: string
  promptChars: number
  inputTokens: number
  outputTokens: number
  ms: number
}

/** Wraps the smoke's Claude so each call's size, tokens and time are recorded. */
export function meteredClaude(provider: ClaudeProvider, calls: MeteredCall[]): ClaudeProvider {
  return {
    id: provider.id,
    async complete(request) {
      const started = Date.now()
      const completion = await provider.complete(request)
      const usage = completion.usage
      calls.push({
        kind: request.trace?.templateKind ?? request.prompt.split('\n', 1)[0] ?? '',
        promptChars: request.prompt.length,
        inputTokens: (usage.inputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0),
        outputTokens: usage.outputTokens ?? 0,
        ms: Date.now() - started
      })
      return completion
    }
  }
}

/** "sentiment_claims_v2 ×2 chars=5400 in=3100 out=420 12.3 s" per kind. */
export function callLines(calls: readonly MeteredCall[]): string[] {
  const kinds = [...new Set(calls.map((call) => call.kind))]
  return kinds.map((kind) => {
    const of = calls.filter((call) => call.kind === kind)
    const sum = (pick: (call: MeteredCall) => number): number =>
      of.reduce((total, call) => total + pick(call), 0)
    return `${kind} ×${of.length} chars=${sum((c) => c.promptChars)} in=${sum((c) => c.inputTokens)} out=${sum((c) => c.outputTokens)} ${(sum((c) => c.ms) / 1000).toFixed(1)} s`
  })
}
