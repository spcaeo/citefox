import type { CoverageMatrix, PromptSetView } from '@shared/domain'
import { pageBlob, requireSnapshot } from '../pipeline/page-context'
import { generateBuyerPrompts, generateCoverage, promptCompetitorLists } from '../pipeline/setup'
import { offeredExclusions, unlistedCompanies } from '../pipeline/validate'
import { getLatestBuyerProfile } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { readProjectProfile, updateProjectProfile } from '../storage/project-profile'
import type { PageSmokeHookContext, SmokeHookResult } from './hook-context'
import { SmokeError } from './errors'
import { step } from './live'

/**
 * `npm run smoke:live -- --env <file> --gaps` (Docs/PROMPT-AUDIT.md, package P1).
 * Runs after the page smoke's search, on the same page and market, with no extra
 * search.
 *
 * 1. For textbolt.com, saves the competitor lists the batch 2 pass mark names
 *    (the smoke project starts with none), so the comparison stage has a list.
 * 2. Rewrites the buyer prompts with those lists and prints them.
 * 3. Runs the content gaps (`coverage_matrix`, `page_audit`, `coverage_fixes`) and
 *    prints every row, fix and finding.
 * 4. Runs the content gaps again on the same content: `page_audit` makes 0 calls.
 *
 * Pass marks: no comparison prompt offers a switch-from option or a tool as an
 * alternative; matrix rows equal the prompts; fixes only for rows that are not
 * strong; the second run makes no `page_audit` call.
 */
export async function runGapsSmoke(context: PageSmokeHookContext): Promise<SmokeHookResult> {
  const { setup, push, secrets, io, pageId } = context
  const db = setup.projectDb
  const out = (line: string): void => io.stdout(`  ${line}`)

  await step(push, secrets, 'gaps-competitors', async () => {
    const seeded = seedSmokeLists(db, context.args.url)
    const profile = readProjectProfile(db)
    return `${seeded ? 'seeded textbolt.com lists' : 'project lists'}: competitors=${profile?.competitors.length ?? 0} switching=${profile?.switchingFrom?.length ?? 0} tools=${profile?.integrations?.length ?? 0}`
  })

  const profile = getLatestBuyerProfile(db, pageId)
  if (profile !== null) {
    out(`who: ${oneLine(profile.who)}`)
    out(`environment: ${oneLine(profile.environment)}`)
    for (const trigger of profile.triggers) out(`trigger: ${oneLine(trigger)}`)
    for (const segment of profile.segments) out(`segment: ${segment.name} (${segment.reason})`)
  }

  const prompts = await step(push, secrets, 'gaps-prompts', async () => {
    // The page smoke writes 3 prompts to keep searches low. No search runs after this
    // hook, so the gap steps see a full set: enough for a comparison prompt and two batches of fixes.
    db.prepare('UPDATE pages SET prompt_count = ? WHERE id = ? AND prompt_count < ?').run(
      GAPS_PROMPT_COUNT,
      pageId,
      GAPS_PROMPT_COUNT
    )
    const view = await generateBuyerPrompts(setup, pageId, { rewrite: true })
    printPrompts(view, out)
    const lists = promptCompetitorLists(db, pageId)
    const known = [...lists.competitors, ...lists.switchingFrom, ...lists.integrations]
    const pageText = pageBlob(requireSnapshot(db, pageId))
    for (const prompt of view.prompts) {
      const text = prompt.variants[0]?.text ?? ''
      const offered = offeredExclusions(text, prompt.intentStage, lists)
      if (offered.length > 0) {
        throw new SmokeError(`Prompt ${prompt.position} offers ${offered.join(', ')} as an option.`)
      }
      const unlisted = unlistedCompanies(text, known, pageText)
      if (unlisted.length > 0)
        out(`prompt ${prompt.position} names unlisted: ${unlisted.join(', ')}`)
    }
    const comparison = view.prompts.filter((item) => item.intentStage === 'comparison').length
    return { detail: `prompts=${view.prompts.length} comparison=${comparison}`, view }
  })

  const first = await step(push, secrets, 'gaps-coverage', async () => {
    const before = callsByKind(db)
    const matrix = await generateCoverage(setup, pageId, { force: true })
    const calls = diffCalls(before, callsByKind(db))
    printMatrix(matrix, prompts.view, out)
    checkMatrix(matrix, prompts.view)
    return { detail: `rows=${matrix.rows.length} findings=${matrix.findings.length} ${calls}` }
  })

  await step(push, secrets, 'gaps-coverage-again', async () => {
    const before = callsByKind(db)
    const matrix = await generateCoverage(setup, pageId, { force: true })
    const after = callsByKind(db)
    const audits = (after.get('page_audit') ?? 0) - (before.get('page_audit') ?? 0)
    checkMatrix(matrix, prompts.view)
    if (audits !== 0) throw new SmokeError(`The second run made ${audits} page_audit calls.`)
    return `rows=${matrix.rows.length} ${diffCalls(before, after)} page_audit=0`
  })

  return { ran: true, detail: first.detail }
}

/** Prompts the gap steps run on: one matrix batch and up to two batches of fixes. */
const GAPS_PROMPT_COUNT = 8

/** The textbolt.com lists from the batch 2 item 5 pass mark, saved when the project has none. */
const TEXTBOLT_LISTS = {
  competitors: ['TXTImpact', 'Notifyre', 'Textmagic', 'ClickSend'],
  switchingFrom: [
    'AT&T email-to-text gateway (txt.att.net)',
    'Verizon email-to-text gateway (vtext.com)',
    'T-Mobile email-to-text gateway (tmomail.net)'
  ],
  integrations: ['Gmail', 'Outlook', 'WIN-911']
}

function seedSmokeLists(db: SqliteDatabase, url: string): boolean {
  const profile = readProjectProfile(db)
  if (profile === null || !/(^|\.)textbolt\.com$/iu.test(hostOf(url))) return false
  if (profile.competitors.length > 0) return false
  updateProjectProfile(db, { ...profile, ...TEXTBOLT_LISTS })
  return true
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function printPrompts(view: PromptSetView, out: (line: string) => void): void {
  for (const prompt of [...view.prompts].sort((a, b) => a.position - b.position)) {
    out(
      `${prompt.position}. [${prompt.intentStage}/${prompt.source}] ${prompt.variants[0]?.text ?? ''}`
    )
  }
}

function printMatrix(
  matrix: CoverageMatrix,
  view: PromptSetView,
  out: (line: string) => void
): void {
  const position = new Map(view.prompts.map((prompt) => [prompt.id, prompt.position]))
  const rows = [...matrix.rows].sort(
    (a, b) => (position.get(a.promptId) ?? 0) - (position.get(b.promptId) ?? 0)
  )
  for (const row of rows) {
    out(
      `${position.get(row.promptId) ?? '?'}. ${row.coverage} ${row.priority} [${row.actions.join(',')}] where: ${row.whereCovered.join(' | ') || '-'}`
    )
    out(`   gap: ${oneLine(row.mainGap)}`)
    out(`   now: ${oneLine(row.currentContent)}`)
    out(`   update: ${oneLine(row.whatToUpdate)}`)
    if (row.suggestedFaq !== null) {
      out(`   faq (${row.suggestedFaq.wordCount} words): ${row.suggestedFaq.question}`)
      out(`      ${oneLine(row.suggestedFaq.answer)}`)
    }
  }
  for (const finding of matrix.findings) {
    out(`finding ${finding.kind}: ${finding.summary} :: ${oneLine(finding.detail)}`)
  }
}

function checkMatrix(matrix: CoverageMatrix, view: PromptSetView): void {
  if (matrix.rows.length !== view.prompts.length) {
    throw new SmokeError(`${matrix.rows.length} rows for ${view.prompts.length} prompts.`)
  }
  const strongWithFaq = matrix.rows.filter(
    (row) => row.coverage === 'strong' && row.suggestedFaq !== null
  )
  const weakWithout = matrix.rows.filter(
    (row) => row.coverage !== 'strong' && row.suggestedFaq === null
  )
  if (strongWithFaq.length > 0 || weakWithout.length > 0) {
    throw new SmokeError(
      `Fixes: ${strongWithFaq.length} strong rows have a FAQ draft, ${weakWithout.length} other rows have none.`
    )
  }
  const strongWithEdit = matrix.rows.filter(
    (row) => row.coverage === 'strong' && row.whatToUpdate !== ''
  )
  const openingNone = matrix.rows.filter((row) => /^none\b\s*[.:;,]/iu.test(row.mainGap))
  if (strongWithEdit.length > 0 || openingNone.length > 0) {
    throw new SmokeError(
      `Strong rows: ${strongWithEdit.length} have something to update, ${openingNone.length} gaps open with "None".`
    )
  }
}

/** Claude attempts recorded on `generations`, by kind. Cache hits are not recorded. */
function callsByKind(db: SqliteDatabase): Map<string, number> {
  const rows = db
    .prepare<[], { kind: string; n: number }>(
      'SELECT kind, COUNT(*) AS n FROM generations GROUP BY kind'
    )
    .all()
  return new Map(rows.map((row) => [row.kind, row.n]))
}

function diffCalls(before: Map<string, number>, after: Map<string, number>): string {
  const parts: string[] = []
  for (const [kind, count] of after) {
    const added = count - (before.get(kind) ?? 0)
    if (added > 0) parts.push(`${kind}=${added}`)
  }
  return parts.length === 0 ? 'calls=0' : `calls ${parts.join(' ')}`
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}
