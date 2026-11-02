import type { FillFromWebsiteResult } from '@shared/ipc'
import { competitorContext, type CompetitorContext } from '../engine/competitor-context'
import { openOwned } from '../engine/project-db'
import { resolvePageProduct } from '../engine/products'
import type { EngineContext } from '../handlers/context'
import { productsHandlers } from '../handlers/products'
import { projectsHandlers } from '../handlers/projects'
import { insertPage } from '../storage/pages'
import type { SmokeIo } from './live'

/**
 * `--fill` second half (Docs/PROMPT-AUDIT.md PC live check): save the Fill read to a temp
 * project as if every competitor with a domain was kept (`projects:create`, then
 * `products:saveFill`, the New project path), add a page about the email-to-SMS product,
 * and print `competitorContext` for it and for each product. On textbolt.com it also
 * prints the batch 2 item 5 pass mark. No search; no Claude call.
 */

/** The batch 2 item 5 pass mark for textbolt.com (Docs/FEEDBACK.md). */
export const TEXTBOLT_PASS = {
  direct: ['TXTImpact', 'Notifyre', 'Textmagic', 'ClickSend'],
  partial: ['SimpleTexting', 'Textedly', 'Salesmsg', 'Twilio']
} as const

export async function printFillProducts(
  ctx: EngineContext,
  io: SmokeIo,
  result: FillFromWebsiteResult
): Promise<{ passMark: boolean | null }> {
  const kept = keptEntries(result)
  const project = await projectsHandlers(ctx)['projects:create']({
    name: result.brands[0]?.name ?? result.domain,
    domain: result.domain,
    includeSubdomains: false,
    brandNames: [result.brands[0]?.name ?? result.domain.split('.')[0] ?? result.domain],
    competitors: kept,
    clientName: null,
    country: result.suggestedMarket?.country ?? 'US',
    language: result.suggestedMarket?.language ?? 'en',
    location: null,
    device: 'desktop'
  })
  const saved = await productsHandlers(ctx)['products:saveFill']({
    projectId: project.id,
    fill: { products: result.products ?? [], competitors: result.competitors }
  })
  io.stdout(
    `pc saved products=${saved.products.length} rows=${saved.competitors.length} (kept ${kept.length} competitors)`
  )
  const opened = openOwned(ctx, project.id, 'smoke:fill')
  try {
    const path = emailToSmsPath(saved.products)
    const url = `https://${result.domain}${path}`
    insertPage(opened.db, {
      id: 'page-pc-smoke',
      projectId: project.id,
      url,
      title: 'Email to SMS',
      label: null,
      folder: null,
      status: 'not_tracked',
      setupStep: 'read',
      intervalDays: 14,
      samples: 1,
      promptCount: 10,
      defaultMarketId: null,
      pinned: false,
      score: null,
      promptSetVersion: null
    })
    const mapped = resolvePageProduct(opened.db, 'page-pc-smoke')
    io.stdout(`pc page ${url} -> ${productName(saved.products, mapped?.productId ?? null)}`)
    io.stdout(`pc   why: ${mapped?.reason ?? 'none'}`)
    const page = competitorContext(opened.db, { pageId: 'page-pc-smoke' })
    for (const line of contextLines(page, '  ')) io.stdout(`pc ${line}`)
    for (const product of saved.products) {
      io.stdout(`pc product ${product.name}`)
      for (const line of contextLines(
        competitorContext(opened.db, { productId: product.id }),
        '  '
      ))
        io.stdout(`pc ${line}`)
    }
    io.stdout(`pc whole business`)
    for (const line of contextLines(competitorContext(opened.db, {}), '  ')) io.stdout(`pc ${line}`)
    if (result.domain !== 'textbolt.com') return { passMark: null }
    const missing = passMarkMissing(page)
    io.stdout(
      missing.length === 0
        ? 'pc pass mark ok: the email-to-SMS page reads TXTImpact, Notifyre, Textmagic, ClickSend as direct and SimpleTexting, Textedly, Salesmsg, Twilio as partial'
        : `pc pass mark missing: ${missing.join('; ')}`
    )
    return { passMark: missing.length === 0 }
  } finally {
    opened.close()
  }
}

/** Every Fill competitor the user could add (a domain is needed to add one), once. */
export function keptEntries(result: Pick<FillFromWebsiteResult, 'competitors'>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of result.competitors) {
    if (item.domain === null) continue
    const key = item.domain.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item.domain)
  }
  return out
}

/** The pass-mark names not in the expected tier (by name, ignoring case and spaces). */
export function passMarkMissing(context: Pick<CompetitorContext, 'direct' | 'partial'>): string[] {
  const key = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, '')
  const direct = new Set(context.direct.map((item) => key(item.name)))
  const partial = new Set(context.partial.map((item) => key(item.name)))
  return [
    ...TEXTBOLT_PASS.direct
      .filter((name) => !direct.has(key(name)))
      .map((name) => `${name} not direct`),
    ...TEXTBOLT_PASS.partial
      .filter((name) => !partial.has(key(name)))
      .map((name) => `${name} not partial`)
  ]
}

function emailToSmsPath(
  products: readonly { name: string; job: string; evidencePath?: string | null }[]
): string {
  const match = products.find(
    (item) =>
      /email/iu.test(`${item.name} ${item.job}`) && /sms|text/iu.test(`${item.name} ${item.job}`)
  )
  const path = match?.evidencePath
  return path && path !== '/' ? path : '/email-to-sms/'
}

function productName(products: readonly { id: string; name: string }[], id: string | null): string {
  return products.find((item) => item.id === id)?.name ?? 'whole business'
}

function contextLines(context: CompetitorContext, indent: string): string[] {
  const names = (items: CompetitorContext['direct']): string =>
    items.map((item) => (item.domain ? `${item.name} (${item.domain})` : item.name)).join(', ') ||
    'none'
  return [
    `${indent}product: ${context.product?.name ?? 'whole business'}`,
    `${indent}direct (${context.direct.length}): ${names(context.direct)}`,
    `${indent}partial (${context.partial.length}): ${names(context.partial)}`
  ]
}
