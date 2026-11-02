import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { classifySample } from '../engine/checks/classify'
import { createCapGate, createKeyRotation } from '../engine/checks/key-rotation'
import { marketPlans } from '../engine/checks/plan'
import { aioGapPath, checkReportsRoot, readStoredRunSummary } from '../engine/checks/report-files'
import { resolveCheckTemplates } from '../engine/checks/report-template-choice'
import { writeCheckReports } from '../engine/checks/reports'
import { normalizeUrl } from '../engine/checks/url'
import { generateBrandPrompts, saveBrandPrompts } from '../engine/sentiment/brand-prompts'
import { captureBrandPrompts } from '../engine/sentiment/capture'
import { readRunSentiment } from '../engine/sentiment/read'
import { getLatestBrandPromptSet } from '../storage/brand-records'
import { listPages } from '../storage/pages'
import { readProjectProfile } from '../storage/project-profile'
import { listSentimentClaims, listSentimentReads } from '../storage/sentiment-records'
import type { PageSmokeHookContext, SmokeHookResult } from './hook-context'
import { SmokeError } from './errors'
import { step } from './live'
import { callLines, meteredClaude, seedP6Project, type MeteredCall } from './sentiment-seed'

/**
 * Check reports and brand sentiment in the live smoke (Docs/PROMPT-AUDIT.md,
 * package P6). Both run after the page smoke's search, on its stored run.
 */

/**
 * `--reports`: run `aio_gap` for each searched prompt the page is not cited for,
 * then the run summary, from the stored run. Pass mark: 0 extra searches.
 */
export async function runReportsSmoke(context: PageSmokeHookContext): Promise<SmokeHookResult> {
  const runId = context.runId
  if (runId === null) return { ran: false, detail: 'the search step returned no run' }
  const { io, push, secrets } = context
  await step(push, secrets, 'p6-seed', () => seedP6Project(context))
  const before = context.searches()
  const calls: MeteredCall[] = []
  const db = context.setup.projectDb
  const root = checkReportsRoot(context.storage.paths.root)
  await step(push, secrets, 'reports', async () => {
    const outcome = await writeCheckReports({
      db,
      projectId: context.projectId,
      runId,
      domain: new URL(context.args.url).hostname.replace(/^www\./, ''),
      reportsRoot: root,
      claude: meteredClaude(context.setup.provider, calls),
      secrets,
      logger: context.setup.logger,
      templates: resolveCheckTemplates(context.storage.db, db, context.setup.logger)
    })
    if (outcome !== 'written') throw new SmokeError('The reports were not written.')
    const extra = context.searches() - before
    if (extra !== 0) throw new SmokeError(`The reports sent ${extra} searches; 0 were expected.`)
    return `written searches+0 ${callLines(calls).join(' · ')}`
  })
  const gap = readFileSync(aioGapPath(root, context.projectId, runId), 'utf8')
  for (const line of gapLines(gap)) io.stdout(`  ${line}`)
  const summary = readStoredRunSummary(root, context.projectId, runId)
  io.stdout(`  summary headline: ${summary?.headline ?? 'none'}`)
  io.stdout(`  summary body: ${(summary?.body ?? 'none').split('\n\n')[0] ?? ''}`)
  return { ran: true, detail: 'reports written' }
}

/** The compared prompts with their facts, from the written `aio_gap.md`. */
function gapLines(markdown: string): string[] {
  const lines: string[] = []
  for (const block of markdown.split('\n## Prompt ').slice(1)) {
    const status = /^Status: (.+)$/m.exec(block)?.[1] ?? ''
    const prompt = /^Prompt: (.+)$/m.exec(block)?.[1] ?? ''
    lines.push(`gap [${status}] ${prompt}`)
    const facts = block.split('### Facts the overview states that the page does not')[1] ?? ''
    for (const match of facts
      .split('### References')[0]
      ?.matchAll(/^\d+\. (.+)\n {3}Likely source: (.+)$/gm) ?? []) {
      lines.push(`  - ${match[1] ?? ''} (source: ${match[2] ?? ''})`)
    }
  }
  return lines
}

/**
 * `--sentiment`: write brand prompts, run 1 search on the pricing brand prompt,
 * then read sentiment. Pass marks: claims name TextBolt or a listed competitor
 * only; the fact check runs only when TextBolt has a claim; total searches stay at
 * or under 2 (`context.searches()`).
 */
export async function runSentimentSmoke(context: PageSmokeHookContext): Promise<SmokeHookResult> {
  const runId = context.runId
  if (runId === null) return { ran: false, detail: 'the search step returned no run' }
  const { io, push, secrets } = context
  const db = context.setup.projectDb
  await step(push, secrets, 'p6-seed', () => seedP6Project(context))
  const deps = {
    db,
    appDb: context.storage.db,
    logger: context.setup.logger,
    secrets,
    now: () => context.clock().toISOString(),
    createId: () => `smoke-${randomUUID()}`
  }
  const promptCalls: MeteredCall[] = []
  const set = await step(push, secrets, 'brand-prompts', async () => {
    const view = await generateBrandPrompts(
      { ...deps, claude: meteredClaude(context.setup.provider, promptCalls) },
      { projectId: context.projectId, pageId: context.pageId }
    )
    return { detail: `${view.prompts.length} prompts ${callLines(promptCalls).join(' ')}`, view }
  })
  for (const prompt of set.view.prompts) io.stdout(`  ${prompt.kind}: ${prompt.text}`)
  const pricing = set.view.prompts.find((prompt) => prompt.kind === 'pricing')
  if (pricing === undefined) throw new SmokeError('Claude wrote no pricing brand prompt.')

  const before = context.searches()
  await step(push, secrets, 'brand-search', async () => {
    saveBrandPrompts(deps, {
      projectId: context.projectId,
      pageId: context.pageId,
      prompts: [{ kind: 'pricing', language: pricing.language, text: pricing.text }]
    })
    const outcome = await searchBrandPrompts(context, runId)
    const used = context.searches() - before
    if (used > 2) throw new SmokeError(`The brand search sent ${used} searches; at most 2.`)
    return `${outcome} searches+${used} "${pricing.text}"`
  })

  const readCalls: MeteredCall[] = []
  const started = Date.now()
  await step(push, secrets, 'sentiment-read', async () => {
    const result = await readRunSentiment(
      { ...deps, claude: meteredClaude(context.setup.provider, readCalls) },
      { projectId: context.projectId, runId }
    )
    return `overviews=${result.overviews} read=${result.read} reused=${result.reused} failed=${result.failed} ${((Date.now() - started) / 1000).toFixed(1)} s`
  })
  for (const line of callLines(readCalls)) io.stdout(`  calls ${line}`)
  const profile = readProjectProfile(db)
  const reads = listSentimentReads(db, [runId])
  for (const read of reads) {
    io.stdout(
      `  read ${read.source} named=[${read.brandsNamed.join(', ')}] reason: ${read.reason ?? ''}`
    )
  }
  const claims = listSentimentClaims(db, [runId])
  for (const claim of claims) {
    const problem =
      claim.factProblem === null
        ? ''
        : ` FACT PROBLEM (${claim.factProblem.basis}): ${claim.factProblem.why} → ${claim.factProblem.correction}`
    io.stdout(`  claim ${claim.brand} [${claim.tone}] ${claim.theme}: ${claim.attribute}${problem}`)
  }
  await step(push, secrets, 'sentiment-pass', async () => {
    const own = profile?.brandNames[0] ?? ''
    const allowed = new Set([own.toLowerCase(), ...readCompetitorNames(context)])
    const stray = claims.filter((claim) => !allowed.has(claim.brand.toLowerCase()))
    if (stray.length > 0) {
      throw new SmokeError(
        `Claims name brands that are not listed: ${stray.map((c) => c.brand).join(', ')}`
      )
    }
    const ownClaims = claims.some((claim) => claim.isOwn)
    const checks = readCalls.filter((call) => call.kind === 'sentiment_fact_check').length
    if (!ownClaims && checks > 0) throw new SmokeError('The fact check ran with no TextBolt claim.')
    return `claims=${claims.length} own=${claims.filter((c) => c.isOwn).length} fact checks=${checks} searches+${context.searches() - before}`
  })
  return { ran: true, detail: 'sentiment read' }
}

/** Competitors the claims may name: every name in the project's lists, lower case. */
function readCompetitorNames(context: PageSmokeHookContext): string[] {
  const profile = readProjectProfile(context.setup.projectDb)
  return (profile?.competitors ?? []).map((name) => name.toLowerCase())
}

/** Searches the page's brand prompts into the smoke's run, as a full check would. */
async function searchBrandPrompts(context: PageSmokeHookContext, runId: string): Promise<string> {
  const db = context.setup.projectDb
  const market = marketPlans(db, context.pageId, [context.marketId], false, [])[0]
  if (market === undefined) throw new SmokeError('The smoke market is missing.')
  const profile = readProjectProfile(db)
  const domain = new URL(context.args.url).hostname.replace(/^www\./, '')
  const tracked = listPages(db, context.projectId)
    .map((page) => (page.url === null ? null : normalizeUrl(page.url)))
    .filter((url): url is string => url !== null)
  const rotation = createKeyRotation(
    {
      storage: context.storage,
      secrets: context.setup.secretStore,
      logger: context.setup.logger,
      http: context.setup.transport,
      now: context.clock,
      createId: () => `smoke-${randomUUID()}`
    },
    {
      project: {
        projectId: context.projectId,
        name: 'Smoke',
        cap: null,
        capRule: 'pause',
        dedicatedKeyId: null,
        paused: false
      },
      usageProjectId: context.projectId,
      month: context.clock().toISOString().slice(0, 7),
      chargeUsage: false
    }
  )
  return captureBrandPrompts({
    db,
    runId,
    market,
    prompts: getLatestBrandPromptSet(db, context.pageId)?.prompts ?? [],
    rotation,
    gate: createCapGate({ allowance: null, used: 0 }),
    createId: () => `smoke-${randomUUID()}`,
    now: () => context.clock().toISOString(),
    cancelled: () => false,
    classify: (references) =>
      classifySample({
        failed: false,
        hasAio: true,
        aioText: null,
        references,
        targetUrl: context.args.url,
        ownDomain: domain,
        includeSubdomains: false,
        brandNames: profile?.brandNames ?? [],
        competitors: profile?.competitors ?? [],
        trackedUrls: tracked
      }).references,
    countSearches: () => undefined
  })
}
