import type { PromptCheckRow } from '@shared/domain'
import type { AssistResult } from '@shared/ipc'
import { ensureShippedAssists } from '../assist/definitions'
import { runAssist } from '../assist/run'
import { competitorContext } from '../engine/competitor-context'
import { toContext, type EngineContext } from '../handlers/context'
import { generateCoverage } from '../pipeline/setup'
import { loadGenerationTemplate } from '../pipeline/templates'
import { getLatestPromptSet } from '../storage/content-records'
import { getLatestSnapshot } from '../storage/snapshot-records'
import type { SqliteDatabase } from '../storage/database'
import {
  listProducts,
  replaceProductCatalog,
  setPageProduct,
  type ProductCatalog
} from '../storage/products'
import { readProjectProfile, updateProjectProfile } from '../storage/project-profile'
import { brandIn, competitorNamedAsOption } from '../assist/definitions/rules'
import { notWrittenYet, type PageSmokeHookContext, type SmokeHookResult } from './hook-context'
import { SmokeError, step } from './live'

/**
 * `npm run smoke:live -- --env <file> --assist <id>[,<id>…]` (Docs/PROMPT-AUDIT.md).
 * Runs assists on the page smoke's project, page and run, one after another.
 *
 * Routes, each filled by the package that owns it:
 * - `ask` (P8): `askQuestion` on the smoke project, not the assist framework.
 * - `structure.import` (P8): after a sitemap sync, page ids from the list only.
 * - every other id: the real assist framework (`src/main/assist/run.ts`), for example
 *   `audience.triggers`, `prompts.more`, `page.verifyClaims` (P7) and
 *   `results.whyNotFirst` (P5: every reason's tag is a cited domain or "page").
 *
 * Before the first P7 assist, the smoke project gets TextBolt's email-to-SMS product and
 * its competitors (the batch 2 item 5 pass mark), so per-product context is real. A run
 * prints each reply's items and fails on the pass marks the audit gives for that id.
 */
export async function runAssistSmoke(
  context: PageSmokeHookContext,
  assistIds: string
): Promise<SmokeHookResult> {
  const requested = assistIds.trim()
  if (requested === 'ask' || requested === 'structure.import') {
    const { runP8Smoke } = await import('./ask-structure')
    return runP8Smoke(context, requested)
  }
  const ids = assistIds
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
  const others = ids.filter((id) => !onFramework(id))
  const mine = ids.filter((id) => onFramework(id) && id !== COVERAGE_STEP)
  if (mine.length === 0) return notWrittenYet(assistPackage(others[0] ?? 'ask'))
  ensureShippedAssists()
  const ctx = smokeHost(context)
  try {
    seedTextBoltProduct(context.setup.projectDb, context.pageId)
    if (ids.includes(COVERAGE_STEP)) {
      // `prompts.checkPage` and `page.checkFacts` answer from a current saved matrix.
      await step(context.push, context.secrets, 'coverage', async () => {
        const matrix = await generateCoverage(context.setup, context.pageId)
        return `${matrix.rows.length} rows, ${matrix.findings.length} findings`
      })
    }
    for (const id of mine) {
      await step(context.push, context.secrets, `assist ${id}`, async () => {
        if (id === 'results.whyNotFirst' && citedRow(context) === null) {
          throw new SmokeError(
            'results.whyNotFirst: no overview in this check cited a source. Run again with --prompts 3.'
          )
        }
        const result = await runAssist(ctx, requestFor(context, id))
        printResult(context, result)
        const problem = passMark(context, result)
        if (problem !== null) throw new SmokeError(`${id}: ${problem}`)
        const seconds = (result.durationMs / 1000).toFixed(1)
        return `${result.items.length} items in ${seconds}s (${result.model ?? 'model not reported'})`
      })
    }
  } finally {
    try {
      ctx.email.close()
    } catch {
      // Closing the temp email store should not hide the result.
    }
  }
  const skipped = others.length > 0 ? `; ${others.join(', ')} not written yet` : ''
  return { ran: true, detail: `${mine.length} assists${skipped}` }
}

/** `--assist coverage,prompts.checkPage` writes the coverage matrix first. */
const COVERAGE_STEP = 'coverage'

/** True for an id this route runs through the assist framework (all but P8's). */
function onFramework(assistId: string): boolean {
  return assistPackage(assistId) !== 'P8'
}

/** The package that owns an assist id's prompt (and its pass marks). */
export function assistPackage(assistId: string): string {
  if (assistId === 'ask' || assistId === 'structure.import') return 'P8'
  if (assistId === 'results.whyNotFirst') return 'P5'
  return 'P7'
}

/** An engine host over the smoke's storage, with the smoke's Claude Code provider. */
function smokeHost(context: PageSmokeHookContext): EngineContext {
  const refuse = (): never => {
    throw new SmokeError('The assist smoke runs Claude through the smoke provider only.')
  }
  return toContext({
    appInfo: () => ({ name: 'CiteFox', version: 'smoke' }),
    storage: context.storage,
    secrets: context.setup.secretStore,
    logger: context.setup.logger,
    http: context.setup.transport,
    claudeCommand: { run: () => Promise.resolve(refuse()) },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => context.secrets,
    now: context.clock,
    claude: context.setup.provider
  })
}

/** TextBolt's email-to-SMS product and its competitors, as PC's pass mark lists them. */
export const TEXTBOLT_PRODUCT = {
  id: 'prod-email-sms',
  name: 'Email to SMS gateway',
  job: 'send and receive business text messages from an email inbox or any tool that sends email',
  buyer:
    'small businesses, IT and operations teams that need text alerts without a developer or an API',
  evidencePath: '/email-to-sms/'
} as const

function seedTextBoltProduct(db: SqliteDatabase, pageId: string): void {
  if (listProducts(db).length > 0) return
  const profile = readProjectProfile(db)
  if (profile !== null) {
    updateProjectProfile(db, {
      ...profile,
      switchingFrom: [
        'Verizon vtext.com email-to-text gateway',
        'AT&T txt.att.net email-to-text gateway',
        'T-Mobile tmomail.net gateway'
      ],
      integrations: ['Gmail', 'Outlook', 'WIN-911', 'Zapier']
    })
  }
  const row = (
    name: string,
    domain: string,
    tier: 'direct' | 'partial'
  ): ProductCatalog['competitors'][number] => ({
    name,
    domain,
    productId: TEXTBOLT_PRODUCT.id,
    tier,
    startingPrice: null,
    sources: []
  })
  replaceProductCatalog(db, {
    products: [{ ...TEXTBOLT_PRODUCT }],
    competitors: [
      row('TXTImpact', 'txtimpact.com', 'direct'),
      row('Notifyre', 'notifyre.com', 'direct'),
      row('Textmagic', 'textmagic.com', 'direct'),
      row('ClickSend', 'clicksend.com', 'direct'),
      row('SimpleTexting', 'simpletexting.com', 'partial'),
      row('Textedly', 'textedly.com', 'partial'),
      row('Salesmsg', 'salesmessage.com', 'partial'),
      row('Twilio', 'twilio.com', 'partial')
    ]
  })
  setPageProduct(db, pageId, TEXTBOLT_PRODUCT.id, true)
}

function requestFor(
  context: PageSmokeHookContext,
  assistId: string
): Parameters<typeof runAssist>[1] {
  const db = context.setup.projectDb
  const base = {
    assistId,
    projectId: context.projectId,
    pageId: context.pageId,
    marketId: context.marketId,
    promptId: null as string | null,
    inputs: {} as Record<string, string | number | boolean | null>,
    instruction: null as string | null
  }
  if (assistId === 'results.whyNotFirst') base.promptId = citedRow(context)?.promptId ?? null
  if (assistId === 'prompts.rephrase') {
    const set = getLatestPromptSet(db, context.pageId, readProjectProfile(db)?.brandNames ?? [])
    base.promptId = set?.prompts[0]?.id ?? null
  }
  if (assistId === 'template.improve') {
    const template = loadGenerationTemplate(
      context.setup.appDb,
      'buyer_prompts',
      undefined,
      undefined,
      db
    )
    base.inputs = { kind: 'buyer_prompts', body: template.body }
    base.instruction = 'Make the comparison-stage prompts follow the competitor rule.'
  }
  return base
}

/** The smoke check's first prompt whose overview cited sources. */
function citedRow(context: PageSmokeHookContext): PromptCheckRow | null {
  const results = context.engine.results({
    projectId: context.projectId,
    pageId: context.pageId,
    marketId: context.marketId,
    runId: context.runId
  })
  return results.prompts.find((row) => row.references.length > 0) ?? null
}

function printResult(context: PageSmokeHookContext, result: AssistResult): void {
  const out = (line: string): void => context.io.stdout(`  ${line}`)
  out(`summary: ${result.summary ?? '(none)'}`)
  result.items.forEach((item, index) => {
    out(
      `${index + 1}. [${item.tag ?? '-'}${item.sign === null ? '' : ` ${item.sign}`}] ${item.text}`
    )
    if (item.detail !== null) out(`   detail: ${item.detail}`)
    if (item.verify !== null) out(`   verify: ${item.verify}`)
  })
  if (result.caution !== null) out(`caution: ${result.caution}`)
  out(`saved data only: ${result.savedDataOnly ? 'yes' : 'no (web search)'}`)
}

/** The audit's pass marks for an id, as a sentence when one fails. */
function passMark(context: PageSmokeHookContext, result: AssistResult): string | null {
  const db = context.setup.projectDb
  const brands = readProjectProfile(db)?.brandNames ?? []
  const texts = result.items.map((item) => item.text)
  if (['audience.triggers', 'prompts.more', 'prompts.rephrase'].includes(result.assistId)) {
    const named = texts.map((text) => brandIn(text, brands)).find((brand) => brand !== null)
    if (named !== undefined && named !== null) return `an item names the brand "${named}"`
  }
  if (result.assistId === 'prompts.more') {
    const competitors = competitorContext(db, { pageId: context.pageId })
    for (const item of result.items) {
      if (item.tag?.toLowerCase() !== 'comparison') continue
      const option = competitorNamedAsOption(item.text, competitors)
      if (option !== null) return `a comparison prompt offers "${option}" as an option`
    }
  }
  if (result.assistId === 'results.whyNotFirst') {
    // P5's pass mark: every reason names a source the overview cited, or the page itself.
    const cited = new Set(citedRow(context)?.references.map((ref) => ref.domain.toLowerCase()))
    const loose = result.items.find((item) => {
      const tag = (item.tag ?? '').toLowerCase().replace(/^www\./u, '')
      return tag !== 'page' && !cited.has(tag)
    })
    if (loose !== undefined) return `a reason is tagged "${loose.tag ?? ''}", not a cited domain`
  }
  if (result.assistId === 'page.verifyClaims') {
    const body = getLatestSnapshot(db, context.pageId)?.bodyText ?? ''
    if (/\b155 characters\b/iu.test(body) && !texts.some((text) => /\b155\b/u.test(text))) {
      return 'the page says 155 characters, but that claim was not checked'
    }
    for (const item of result.items) {
      if (!/\b155\b/u.test(item.text)) continue
      if (!['wrong', 'outdated'].includes(item.tag ?? '')) {
        return 'the 155-character claim was not marked wrong'
      }
      if (!/\b160\b/u.test(item.detail ?? '')) return 'the 155-character fix does not give 160'
      if (!/https?:\/\//u.test(item.verify ?? '')) return 'the 155-character verdict has no source'
    }
  }
  return null
}
