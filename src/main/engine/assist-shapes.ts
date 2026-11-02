/**
 * Reply shapes for the inline assists that call `completeAssist` with no JSON schema.
 *
 * Claude Code (`claude -p`) is not given a schema for these calls, so the prompt has to
 * name the exact JSON keys the parser in `./assist` accepts. Each shape carries an
 * example that `assist-shapes.test.ts` runs through that parser, so the words sent to
 * Claude and the parser cannot drift apart.
 */

export interface AssistShape {
  /** A reply the matching parser accepts. Rendered as JSON in the prompt. */
  example: unknown
  /** Allowed values and limits that the example alone does not show. */
  notes: string
}

/** Batch 2 row 5, step 1 (no tools): what the site sells, its brands and market. */
export const SITE_READ_SHAPE: AssistShape = {
  example: {
    summary:
      'Acme sells invoicing software to small accounting firms in the US. Firms use it to send invoices, take card payments and chase late payers from one place.',
    brands: [
      { name: 'Acme', reason: 'The home page title names it.' },
      { name: 'Acme Pay', reason: 'The menu names its payments product.' }
    ],
    products: [
      {
        name: 'Invoicing software',
        job: 'Sends invoices and reminders and records payments.',
        buyer: 'Small accounting firms',
        evidence: { path: '/invoicing', quote: 'Send an invoice in two clicks.' }
      }
    ],
    audiences: [
      { name: 'Accounting firms', evidence: { path: '/', quote: 'Built for accounting firms' } }
    ],
    comparedWith: ['Example Rival'],
    suggestedMarket: { country: 'US', language: 'en', location: null, reason: 'Prices are in USD.' }
  },
  notes:
    'summary: 2 or 3 plain sentences about the business (never about the pages), naming the countries or regions it serves only when the pages name them. comparedWith: live products the pages compare it with or help buyers switch from by name ("Acme vs X", "X alternative", "switch from X" when X is a live product), else empty. brands: the company name first, then its own products sold or marketed under their own name (such as "Jira" or "Shop Pay"), spelled exactly as on the pages; never a feature, plan or tier name that is an ordinary word or phrase ("Storage", "Experiments", "Premium"), no legal suffixes (Inc) and no domain variants. products: 1 to 3, the main one first; name is a short generic category a buyer would use, never the brand; job and buyer one short sentence each; evidence.path is the page most about that offering: its own page (a use case, solution, integration or migration page, from the pages read or the site menu) before the home page; evidence.quote a short quote copied from the pages read. audiences: up to 8 industries, roles, teams or use cases the pages say it is for, each with evidence copied from the pages; empty when the pages name none. suggestedMarket: a 2-letter country code and a 2-letter language code, location a city or null; null when the pages do not show a market.'
}

/** Batch 2 row 5, step 3 (no tools): what buyers switch from and integrations, from the pages. */
export const SWITCHING_SHAPE: AssistShape = {
  example: {
    switchingFrom: [
      {
        name: 'Old Invoicer',
        domain: null,
        reason: 'Its maker retired it, so the firms that used it need a replacement.',
        evidence: { path: '/old-invoicer-alternative', quote: 'Old Invoicer closes in 2025.' }
      }
    ],
    integrations: [
      {
        name: 'Example Ledger',
        domain: null,
        reason: 'Paid invoices are recorded in it automatically.',
        evidence: { path: '/integrations', quote: 'Syncs with Example Ledger.' }
      }
    ]
  },
  notes:
    'switchingFrom and integrations may each be empty. domain is a bare domain such as "example.com" only when a page read links to or names it, else null. reason: plain sentences for the buyer, never a note about the pages.'
}

/** Batch 2 row 5, step 2 (web search, one call per product): direct and partial competitors. */
export const PRODUCT_COMPETITORS_SHAPE: AssistShape = {
  example: {
    direct: [
      {
        name: 'Example Rival',
        domain: 'examplerival.com',
        why: 'Invoicing software with payment reminders, sold to the same small firms.',
        startingPrice: '$25/mo',
        sources: [
          { url: 'https://www.examplereviews.com/invoicing-software', biased: false },
          { url: 'https://examplerival.com/pricing', biased: true }
        ]
      }
    ],
    partial: [
      {
        name: 'Example API',
        domain: 'exampleapi.com',
        why: 'A developer billing API: it can do the same job, but only with code.',
        startingPrice: null,
        sources: [{ url: 'https://exampleapi.com/billing', biased: true }]
      }
    ]
  },
  notes:
    'direct and partial may each be empty. name: the product as buyers know it (such as "Microsoft Bookings", not "Microsoft"). domain: the company’s official website domain, bare (such as "example.com"), or null when unsure; it is checked before it is shown. why: one plain sentence for a buyer about what it does and why it matches, stated as a fact; never mention your search, your sources or what you could not confirm. startingPrice: the lowest public paid plan, short (such as "$29/mo" or "$5/user/mo"), or null when unknown. sources: up to 3 full https URLs you used; biased is true for a page written by the business itself or by a direct rival (their comparison and "alternatives" lists are marketing).'
}

/** The words appended to the prompt. */
export function renderAssistShape(shape: AssistShape): string {
  return `Reply with JSON only, in this shape:\n${JSON.stringify(shape.example)}\n${shape.notes}`
}
