import type { SetupRow } from '@shared/ipc'
import { PRODUCT_RULE } from '../../engine/site-outline'
import { sitePathOrNull } from '../../engine/site-grounding'
import { finishBrands } from './ground'
import { cell, clip, pathOrNull, withDetail } from './rows'
import type { ListSectionDef, TextSectionDef } from './types'

/**
 * Step 4: "What X does", brand names and spellings, and what it sells. The wording
 * comes from the site read (`engine/fill-from-website.ts`, `SITE_READ_SHAPE`) and the
 * `project` help-fill kind (`helpfill/kinds/project.ts`).
 */

const role = (domain: string): string => `You help set up AI-search tracking for ${domain}.`

export const SUMMARY_SECTION: TextSectionDef = {
  kind: 'text',
  id: 'summary',
  noun: ['summary', 'summaries'],
  context: ['website', 'market', 'brands', 'products'],
  site: ['paths', 'quotes', 'audiences'],
  webSearch: false,
  usd: 0.01,
  maxChars: 700,
  role: (context) => role(context.domain),
  task: (context) => [
    `Say what ${context.domain} sells, to whom, and for what job, in 2 or 3 plain sentences.`,
    'Name the countries or regions it serves only when the site names them (such as "US and Canada"), never just the market tracked; otherwise say nothing about countries.',
    'Use the facts and pages above, in the words the pages use. No category label such as cloud, platform, AI-powered or enterprise unless the pages use that word for the business. Never a price or a number the pages above do not show.',
    'Write only the description of the business: never about yourself or the pages, never a question.'
  ]
}

export const BRANDS_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'brands',
  noun: ['brand name', 'brand names'],
  context: ['website', 'summary'],
  site: ['brands', 'paths'],
  webSearch: false,
  usd: 0.01,
  columns: ['name'],
  entity: null,
  count: 8,
  maxRows: 10,
  neutral: false,
  role: (context) => role(context.domain),
  task: (context, count) => [
    `List up to ${count} names ${context.domain} uses for itself on its pages: the company name and the names of its own products sold or marketed under their own name, such as "Jira" or "Shop Pay" (start from the names the read found above). A coined product name counts, and so does the brand plus a product word when the menu shows the product (write "Acme Mail" for a "Mail" product of Acme).`,
    'Spell each exactly as the pages do. Add one other spelling of the main name only when buyers often type it that way (such as "Example Co" for ExampleCo).',
    'Never a feature, plan or tier name that is an ordinary word or phrase ("Storage", "Experiments", "Premium", "Session replay"), a legal name (Inc, LLC), a domain variant (example.com), a generic category ("Email API"), a shortened name ("Mail" for Mailchimp) or another company’s product. A short list is fine.',
    'name = one name per row.'
  ],
  toRow(values) {
    const name = clip(cell(values, 'name').replace(/[.;:]+$/u, ''), 80)
    if (name.length < 2) return null
    return { name, detail: '', url: null, tag: null }
  },
  finish: finishBrands,
  keys: (row) => [row.name],
  line: (row) => row.name
}

export const PRODUCTS_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'products',
  noun: ['product', 'products'],
  context: ['website', 'market', 'summary', 'brands'],
  site: ['paths', 'quotes'],
  webSearch: false,
  usd: 0.01,
  columns: ['name', 'job', 'url'],
  entity: 'products',
  count: 5,
  maxRows: 12,
  neutral: false,
  role: (context) => role(context.domain),
  task: (context, count) => [
    `List up to ${count} products or services ${context.domain} sells.`,
    PRODUCT_RULE,
    'name = a short generic category a buyer would use, never the brand',
    'job = what it does for the buyer, in one line',
    'url = its page path from the site paths above, or blank'
  ],
  toRow(values, _context, ground): SetupRow | null {
    const name = clip(cell(values, 'name'), 80)
    if (name.length < 2) return null
    return {
      name,
      detail: clip(cell(values, 'job'), 300),
      url: sitePathOrNull(ground.check, pathOrNull(cell(values, 'url'))),
      tag: null
    }
  },
  keys: (row) => [row.name],
  line: (row) => withDetail(row.name, row.detail)
}
