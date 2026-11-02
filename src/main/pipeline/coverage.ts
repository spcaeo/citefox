import type {
  BuyerPrompt,
  CoverageAction,
  CoverageFinding,
  CoverageMatrix,
  CoverageRecord,
  GenerationTemplate,
  Market
} from '@shared/domain'
import { randomUUID } from 'node:crypto'
import { DATA_FENCE_RULE } from '../prompts/blocks'
import {
  getCachedGeneration,
  getLatestCoverage,
  getLatestPromptSet,
  insertCoverage,
  updateCoverageRow,
  type StoredSnapshot
} from '../storage/content-records'
import {
  keepOnPageFindings,
  validateCoverageFixes,
  validateCoverageMatrix,
  validatePageAudit,
  wrongFacts,
  type AuditDraftFinding,
  type FixDraftRow,
  type MatrixDraftRow,
  type WrongFact
} from './coverage-validate'
import { PipelineError } from './errors'
import { generationCacheKey, llmInputHash, wordCount } from './hash'
import { completeStructured } from './llm'
import {
  defaultPageMarket,
  pageBlob,
  renderPagePrompt,
  requirePage,
  requireProfile,
  requireSnapshot
} from './page-context'
import { COVERAGE_FIXES_SCHEMA, COVERAGE_MATRIX_SCHEMA, PAGE_AUDIT_SCHEMA } from './schemas'
import type { PageSetupDeps } from './setup'
import { unfencePageText } from './template-context'
import { modelFor } from './template-settings'
import { loadGenerationTemplate, templateHash } from './templates'
import { unquoteOffPage } from './validate'

/**
 * Content gaps in three steps, one job each (Docs/PROMPT-AUDIT.md, package P1):
 *
 * - `coverage_matrix` rates up to {@link MATRIX_BATCH_MAX} prompts per call; batches
 *   run side by side through the shared Claude gate.
 * - `page_audit` lists page-wide findings once per page content: a second run on
 *   the same content reuses the stored reply and makes no call.
 * - `coverage_fixes` runs after both, only for rows rated partial, weak or none, up
 *   to {@link FIX_BATCH_MAX} rows per call, with the page sections that matter and
 *   the audit's corrections.
 *
 * Code assembles one `CoverageMatrix` from the three replies; storage is unchanged.
 * Title and meta cut-offs are measured here, not asked of Claude.
 */

export const MATRIX_BATCH_MAX = 10
/** Rows per fixes call: small calls run two at a time through the Claude gate (the fixes step is the slow one). */
export const FIX_BATCH_MAX = 3

/** Title characters Google usually shows before it cuts the title. */
export const TITLE_VISIBLE_CHARS = 60

/** Meta description characters Google usually shows on desktop. */
export const META_VISIBLE_CHARS = 160

/** Most characters of page sections sent with one prompt's fix. */
const FIX_SECTION_CHARS = 1500

/** Most characters of page sections sent in one fixes call. */
const FIX_CALL_CHARS = 9000

/** One prompt as the gap steps see it: its number on the page and its text. */
export interface GapPrompt {
  prompt: BuyerPrompt
  position: number
  text: string
}

/** `items` split into the fewest batches of at most `max`, sizes as even as possible. */
export function evenBatches<T>(items: readonly T[], max: number): T[][] {
  if (items.length === 0) return []
  const count = Math.ceil(items.length / max)
  const size = Math.ceil(items.length / count)
  const out: T[][] = []
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size))
  return out
}

/** Writes the content gaps for the page's latest prompt set and stores the matrix. */
export async function generateCoverage(
  deps: PageSetupDeps,
  pageId: string,
  options?: { force?: boolean; templateId?: string }
): Promise<CoverageMatrix> {
  const snapshot = requireSnapshot(
    deps.projectDb,
    pageId,
    'Read the page before the coverage matrix.'
  )
  const brands = requireProfile(deps.projectDb).brandNames
  const existing = getLatestCoverage(deps.projectDb, pageId, snapshot.contentHash)
  if (existing !== null && existing.contentHash === snapshot.contentHash && !options?.force) {
    return { ...existing, reused: true, stale: false }
  }
  const promptSet = getLatestPromptSet(deps.projectDb, pageId, brands)
  if (promptSet === null || promptSet.prompts.length === 0) {
    throw new PipelineError('Write the prompts before the coverage matrix.', {
      code: 'not_found',
      nextStep: 'Write the buyer prompts, then run the coverage matrix.'
    })
  }
  const force = options?.force ?? false
  const matrixTemplate = loadGenerationTemplate(
    deps.appDb,
    'coverage_matrix',
    options?.templateId,
    'gaps:generate',
    deps.projectDb
  )
  const prompts = gapPrompts(promptSet.prompts)
  const [rows, audit] = await Promise.all([
    Promise.all(
      evenBatches(prompts, MATRIX_BATCH_MAX).map((batch) =>
        rateBatch(deps, matrixTemplate, snapshot, pageId, batch, force)
      )
    ).then((batches) => batches.flat()),
    auditPage(deps, snapshot, pageId)
  ])
  const fixes = await fixRows(deps, snapshot, pageId, prompts, rows, audit, force)
  const recordedAt = (deps.now ?? (() => new Date().toISOString()))()
  const runId = `run-${randomUUID()}`
  const matrix: CoverageMatrix = {
    runId,
    pageId,
    recordedAt,
    templateId: matrixTemplate.id,
    templateName: matrixTemplate.name,
    templateHash: templateHash(matrixTemplate.body),
    templateUpdatedAt: matrixTemplate.updatedAt,
    contentHash: snapshot.contentHash,
    reused: false,
    stale: false,
    rows: prompts.map((item) => {
      const row = rows.find((draft) => draft.position === item.position)
      if (row === undefined) throw rowMismatch()
      return assembleRow(row, fixes.get(item.position) ?? null, item.prompt, {
        id: `cov-${randomUUID()}`,
        runId,
        pageId
      })
    }),
    findings: [...measuredFindings(snapshot), ...audit.map(auditFinding)].map((finding) => ({
      ...finding,
      id: `find-${randomUUID()}`,
      runId,
      pageId
    }))
  }
  insertCoverage(deps.projectDb, matrix)
  return matrix
}

/**
 * FR-4.6. Rates one prompt again and, when it is not strong, writes its fix again.
 * The run id and the page-wide findings stay. `done` is cleared. The audit is not
 * run: its stored reply, when there is one, gives the corrections.
 */
export async function redoCoveragePrompt(
  deps: PageSetupDeps,
  pageId: string,
  promptId: string
): Promise<CoverageMatrix> {
  const snapshot = requireSnapshot(
    deps.projectDb,
    pageId,
    'Read the page before the coverage matrix.'
  )
  const brands = requireProfile(deps.projectDb).brandNames
  const current = getLatestCoverage(deps.projectDb, pageId, snapshot.contentHash)
  if (current === null) {
    throw new PipelineError('There is no coverage matrix yet.', {
      code: 'not_found',
      nextStep: 'Run the coverage matrix, then redo one prompt.'
    })
  }
  const existing = current.rows.find((row) => row.promptId === promptId)
  const promptSet = getLatestPromptSet(deps.projectDb, pageId, brands)
  const item = gapPrompts(promptSet?.prompts ?? []).find((entry) => entry.prompt.id === promptId)
  if (existing === undefined || item === undefined) {
    throw new PipelineError('That prompt is not in this matrix.', {
      code: 'not_found',
      nextStep: 'Choose a prompt from this matrix.'
    })
  }
  const template = loadGenerationTemplate(
    deps.appDb,
    'coverage_matrix',
    undefined,
    'gaps:redo',
    deps.projectDb
  )
  const rows = await rateBatch(deps, template, snapshot, pageId, [item], true)
  const audit = storedAudit(deps, snapshot, pageId)
  const fixes = await fixRows(deps, snapshot, pageId, [item], rows, audit, true)
  const row = rows[0]
  if (row === undefined) throw rowMismatch()
  const fresh = assembleRow(row, fixes.get(item.position) ?? null, item.prompt, {
    id: existing.id,
    runId: existing.runId,
    pageId
  })
  updateCoverageRow(deps.projectDb, { ...fresh, done: false })
  const stored = getLatestCoverage(deps.projectDb, pageId, snapshot.contentHash)
  if (stored === null) {
    throw new PipelineError('The coverage matrix could not be saved.', {
      code: 'not_found',
      nextStep: 'Run the coverage matrix again.'
    })
  }
  return { ...stored, reused: false, stale: stored.stale }
}

export function gapPrompts(prompts: readonly BuyerPrompt[]): GapPrompt[] {
  return [...prompts]
    .sort((left, right) => left.position - right.position)
    .map((prompt) => ({ prompt, position: prompt.position, text: prompt.variants[0]?.text ?? '' }))
}

/** "3. [trigger · trigger_event] …": the number, the stage and source, then the text. */
export function promptLine(item: GapPrompt): string {
  return `${item.position}. [${item.prompt.intentStage} · ${item.prompt.source}] ${item.text}`
}

/** The lines after the matrix template: the batch's numbered prompts. */
export function matrixLines(batch: readonly GapPrompt[]): string {
  return `Buyer prompts:\n${batch.map(promptLine).join('\n')}`
}

async function rateBatch(
  deps: PageSetupDeps,
  template: GenerationTemplate,
  snapshot: StoredSnapshot,
  pageId: string,
  batch: readonly GapPrompt[],
  force: boolean
): Promise<MatrixDraftRow[]> {
  const promptText = batch.map((item) => item.text).join('\n')
  const prompt = renderPagePrompt(deps, template, snapshot, pageId, matrixLines(batch))
  const sources = { pageText: pageBlob(snapshot), promptText }
  const positions = batch.map((item) => item.position)
  const hash = templateHash(template.body)
  const result = await completeStructured({
    db: deps.projectDb,
    pageId,
    provider: deps.provider,
    logger: deps.logger,
    kind: 'coverage_matrix',
    templateId: template.id,
    templateHash: hash,
    prompt,
    schema: COVERAGE_MATRIX_SCHEMA,
    model: modelFor(template.settings, deps.model),
    inputHash: llmInputHash({ templateHash: hash, prompt, schema: COVERAGE_MATRIX_SCHEMA }),
    validate: (value) =>
      validateCoverageMatrix(unquoteOffPage(value, sources), { ...sources, positions }),
    secrets: deps.secrets,
    now: deps.now,
    trace: { source: 'pipeline', projectId: deps.projectId },
    force
  })
  return (unquoteOffPage(result.value, sources) as { rows: MatrixDraftRow[] }).rows
}

/** The audit call, rendered: the same input gives the same cache key. */
function auditRequest(
  deps: PageSetupDeps,
  snapshot: StoredSnapshot,
  pageId: string
): { template: GenerationTemplate; prompt: string; hash: string; model: string | null } {
  const template = loadGenerationTemplate(
    deps.appDb,
    'page_audit',
    undefined,
    'gaps:generate',
    deps.projectDb
  )
  const prompt = renderPagePrompt(deps, template, snapshot, pageId, measuredLines(snapshot))
  return {
    template,
    prompt,
    hash: templateHash(template.body),
    model: modelFor(template.settings, deps.model)
  }
}

/**
 * Page-wide findings, once per page content. Never forced: the stored reply for the
 * same page, template and model is reused. A failed audit leaves the measured
 * findings only, so the matrix is still written.
 */
async function auditPage(
  deps: PageSetupDeps,
  snapshot: StoredSnapshot,
  pageId: string
): Promise<AuditDraftFinding[]> {
  const request = auditRequest(deps, snapshot, pageId)
  const pageText = pageBlob(snapshot)
  try {
    const result = await completeStructured({
      db: deps.projectDb,
      pageId,
      provider: deps.provider,
      logger: deps.logger,
      kind: 'page_audit',
      templateId: request.template.id,
      templateHash: request.hash,
      prompt: request.prompt,
      schema: PAGE_AUDIT_SCHEMA,
      model: request.model,
      inputHash: auditInputHash(request),
      validate: (value) => validatePageAudit(keepOnPageFindings(value, pageText), { pageText }),
      secrets: deps.secrets,
      now: deps.now,
      trace: { source: 'pipeline', projectId: deps.projectId },
      force: false
    })
    return (keepOnPageFindings(result.value, pageText) as { findings: AuditDraftFinding[] })
      .findings
  } catch (error) {
    if (!(error instanceof PipelineError)) throw error
    deps.logger.warn('page audit failed', { pageId, message: error.message })
    return []
  }
}

/** The stored audit for this content, or none. Makes no call. */
function storedAudit(
  deps: PageSetupDeps,
  snapshot: StoredSnapshot,
  pageId: string
): AuditDraftFinding[] {
  const request = auditRequest(deps, snapshot, pageId)
  const cached = getCachedGeneration(
    deps.projectDb,
    'page_audit',
    generationCacheKey({
      inputHash: auditInputHash(request),
      model: request.model,
      connection: deps.provider.id
    })
  )
  if (cached === null) return []
  const pageText = pageBlob(snapshot)
  const kept = keepOnPageFindings(cached.output, pageText)
  if (validatePageAudit(kept, { pageText }) !== null) return []
  return (kept as { findings: AuditDraftFinding[] }).findings
}

function auditInputHash(request: { hash: string; prompt: string }): string {
  return llmInputHash({
    templateHash: request.hash,
    prompt: request.prompt,
    schema: PAGE_AUDIT_SCHEMA
  })
}

/** The title and meta lengths, measured, as facts for the audit. */
export function measuredLines(snapshot: StoredSnapshot): string {
  const title = snapshot.title ?? ''
  const meta = snapshot.metaDescription ?? ''
  return [
    'Measured by CiteFox (facts, not findings):',
    `- Title: ${title.length} characters${title.length > TITLE_VISIBLE_CHARS ? `; search results cut it after about ${TITLE_VISIBLE_CHARS}` : ''}.`,
    `- Meta description: ${meta.length} characters${meta.length > META_VISIBLE_CHARS ? `; search results cut it after about ${META_VISIBLE_CHARS}` : ''}.`,
    `- H1: ${(snapshot.h1 ?? '').trim().length > 0 ? 'present' : 'missing'}.`
  ].join('\n')
}

/** Title and meta cut-offs, from the measured lengths. No Claude. */
export function measuredFindings(
  snapshot: Pick<StoredSnapshot, 'title' | 'metaDescription'>
): Omit<CoverageFinding, 'id' | 'runId' | 'pageId'>[] {
  const findings: Omit<CoverageFinding, 'id' | 'runId' | 'pageId'>[] = []
  const title = (snapshot.title ?? '').trim()
  if (title.length > TITLE_VISIBLE_CHARS) {
    findings.push({
      kind: 'title_length',
      summary: `The title is ${title.length} characters, so search results cut it`,
      detail: `Search results show about ${TITLE_VISIBLE_CHARS} characters of a title. This one is cut after "${visiblePart(title, TITLE_VISIBLE_CHARS)}". Put the strongest differentiator before that point.`
    })
  }
  const meta = (snapshot.metaDescription ?? '').trim()
  if (meta.length > META_VISIBLE_CHARS) {
    findings.push({
      kind: 'other',
      summary: `The meta description is ${meta.length} characters, so search results cut it`,
      detail: `Search results show about ${META_VISIBLE_CHARS} characters of a meta description. This one is cut after "${visiblePart(meta, META_VISIBLE_CHARS)}".`
    })
  }
  return findings
}

/** The words of `text` that fit in `max` characters, cut at a word. */
function visiblePart(text: string, max: number): string {
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : cut).trim()
}

/** An audit finding as the stored page-wide finding. */
function auditFinding(
  finding: AuditDraftFinding
): Omit<CoverageFinding, 'id' | 'runId' | 'pageId'> {
  const parts = [`The page says "${finding.quote}".`]
  if (finding.correction !== null) parts.push(`Correct: ${finding.correction}`)
  if (finding.verify !== null) parts.push(`Verify: ${finding.verify}`)
  return { kind: finding.type, summary: finding.text, detail: parts.join(' ') }
}

/** Fixes for rows rated partial, weak or none, by position. */
async function fixRows(
  deps: PageSetupDeps,
  snapshot: StoredSnapshot,
  pageId: string,
  prompts: readonly GapPrompt[],
  rows: readonly MatrixDraftRow[],
  audit: readonly AuditDraftFinding[],
  force: boolean
): Promise<Map<number, FixDraftRow>> {
  const needing = prompts.filter(
    (item) =>
      (rows.find((row) => row.position === item.position)?.coverage ?? 'strong') !== 'strong'
  )
  const fixes = new Map<number, FixDraftRow>()
  if (needing.length === 0) return fixes
  const template = loadGenerationTemplate(
    deps.appDb,
    'coverage_fixes',
    undefined,
    'gaps:generate',
    deps.projectDb
  )
  const page = requirePage(deps.projectDb, pageId, deps.projectId)
  const market = defaultPageMarket(deps.projectDb, page)
  const replies = await Promise.all(
    evenBatches(needing, FIX_BATCH_MAX).map((batch) =>
      fixBatch(deps, template, snapshot, pageId, batch, rows, audit, market, force)
    )
  )
  for (const row of replies.flat()) fixes.set(row.position, row)
  return fixes
}

async function fixBatch(
  deps: PageSetupDeps,
  template: GenerationTemplate,
  snapshot: StoredSnapshot,
  pageId: string,
  batch: readonly GapPrompt[],
  rows: readonly MatrixDraftRow[],
  audit: readonly AuditDraftFinding[],
  market: Market | null,
  force: boolean
): Promise<FixDraftRow[]> {
  const brands = requireProfile(deps.projectDb).brandNames
  const promptText = batch.map((item) => item.text).join('\n')
  const prompt = renderPagePrompt(
    deps,
    template,
    snapshot,
    pageId,
    fixLines(snapshot, batch, rows, audit),
    { market }
  )
  const sources = { pageText: pageBlob(snapshot), promptText }
  const positions = batch.map((item) => item.position)
  const facts: WrongFact[] = wrongFacts(audit)
  const hash = templateHash(template.body)
  const result = await completeStructured({
    db: deps.projectDb,
    pageId,
    provider: deps.provider,
    logger: deps.logger,
    kind: 'coverage_fixes',
    templateId: template.id,
    templateHash: hash,
    prompt,
    schema: COVERAGE_FIXES_SCHEMA,
    model: modelFor(template.settings, deps.model),
    inputHash: llmInputHash({ templateHash: hash, prompt, schema: COVERAGE_FIXES_SCHEMA }),
    validate: (value) =>
      validateCoverageFixes(unquoteOffPage(value, sources), {
        ...sources,
        positions,
        brands,
        wrongFacts: facts
      }),
    secrets: deps.secrets,
    now: deps.now,
    trace: { source: 'pipeline', projectId: deps.projectId },
    force
  })
  return (unquoteOffPage(result.value, sources) as { rows: FixDraftRow[] }).rows
}

/** The lines after the fixes template: each prompt with its row, the sections, the corrections. */
export function fixLines(
  snapshot: StoredSnapshot,
  batch: readonly GapPrompt[],
  rows: readonly MatrixDraftRow[],
  audit: readonly AuditDraftFinding[]
): string {
  const prompts: string[] = []
  const sections = new Map<string, { text: string; positions: number[] }>()
  let budget = FIX_CALL_CHARS
  for (const item of batch) {
    const row = rows.find((entry) => entry.position === item.position)
    if (row === undefined) continue
    prompts.push(
      [
        promptLine(item),
        `   Rating: ${row.coverage}. Priority: ${row.priority}. Actions: ${row.actions.join(', ')}.`,
        `   Where the page covers it now: ${row.whereCovered.length > 0 ? row.whereCovered.join(' | ') : 'nowhere'}.`,
        `   Main gap: ${row.mainGap}`
      ].join('\n')
    )
    for (const section of sectionsFor(snapshot, row.whereCovered)) {
      const known = sections.get(section.label)
      if (known !== undefined) {
        known.positions.push(item.position)
        continue
      }
      if (budget <= 0) continue
      const text = section.text.slice(0, Math.min(FIX_SECTION_CHARS, budget))
      budget -= text.length
      sections.set(section.label, { text, positions: [item.position] })
    }
  }
  const sectionText = [...sections.entries()]
    .map(
      ([label, section]) =>
        `${label} (for prompt ${section.positions.join(', ')}):\n${section.text.trim()}`
    )
    .join('\n\n')
  const corrections = audit
    .filter((finding) => finding.type === 'factual_claim')
    .map(
      (finding) =>
        `- The page says "${finding.quote}". ${finding.correction === null ? `Unconfirmed: ${finding.text}` : `Correct fact: ${finding.correction}`}`
    )
  return [
    'Prompts to fix:',
    prompts.join('\n'),
    '',
    'Page sections for these prompts:',
    `<page_text>\n${unfencePageText(sectionText.length > 0 ? sectionText : 'None.')}\n</page_text>`,
    DATA_FENCE_RULE,
    '',
    'Corrections from the page audit:',
    corrections.length > 0 ? corrections.join('\n') : 'None.'
  ].join('\n')
}

/** Page parts that point at the start of the page rather than quote it. */
const INTRO_PARTS = new Set(['h1', 'intro', 'introduction', 'title', 'meta description'])

/**
 * The page text behind each place a row names: a heading's section (up to the next
 * heading), an FAQ's answer, or the paragraph holding a quoted sentence. The intro
 * when the row names nothing or only the H1 or intro.
 */
export function sectionsFor(
  snapshot: Pick<StoredSnapshot, 'bodyText' | 'outline' | 'faqs'>,
  places: readonly string[]
): { label: string; text: string }[] {
  const body = snapshot.bodyText
  const lower = body.toLowerCase()
  const headingStarts = snapshot.outline
    .map((entry) => lower.indexOf(entry.text.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)
  const intro = (): { label: string; text: string } => ({
    label: 'Intro',
    text: body.slice(
      0,
      headingStarts[0] !== undefined && headingStarts[0] > 200 ? headingStarts[0] : 1200
    )
  })
  const out: { label: string; text: string }[] = []
  for (const raw of places) {
    const place = raw
      .replace(/^[^:"]{1,40}:\s*/u, '')
      .replace(/^"|"$/gu, '')
      .trim()
    const key = place.toLowerCase()
    if (key.length === 0) continue
    if (INTRO_PARTS.has(key) || INTRO_PARTS.has(raw.trim().toLowerCase())) {
      out.push(intro())
      continue
    }
    const faq = snapshot.faqs.find((item) => item.question.toLowerCase().includes(key))
    if (faq !== undefined && faq.answer.trim().length > 0) {
      out.push({ label: `FAQ "${faq.question}"`, text: faq.answer })
      continue
    }
    const heading = snapshot.outline.find((entry) => entry.text.toLowerCase() === key)
    const start = lower.indexOf(key)
    if (heading !== undefined && start >= 0) {
      const next = headingStarts.find((index) => index > start)
      out.push({
        label: `Section "${heading.text}"`,
        text: body.slice(start, next ?? start + FIX_SECTION_CHARS)
      })
      continue
    }
    if (start >= 0) {
      const from = body.lastIndexOf('\n\n', start)
      const to = body.indexOf('\n\n', start + key.length)
      out.push({
        label: `Paragraph "${clipLabel(place)}"`,
        text: body.slice(from < 0 ? 0 : from, to < 0 ? start + FIX_SECTION_CHARS : to)
      })
    }
  }
  return out.length > 0 ? out : [intro()]
}

function clipLabel(text: string): string {
  return text.length <= 60 ? text : `${text.slice(0, 57).trimEnd()}…`
}

/** One stored row from the matrix rating and, for a row that is not strong, its fix. */
function assembleRow(
  row: MatrixDraftRow,
  fix: FixDraftRow | null,
  prompt: BuyerPrompt,
  ids: { id: string; runId: string; pageId: string }
): CoverageRecord {
  const strong = row.coverage === 'strong'
  if (!strong && fix === null) {
    throw new PipelineError('A prompt the page does not fully answer has no fix.', {
      code: 'schema_validation',
      nextStep: 'Run the coverage matrix again.'
    })
  }
  const trigger = prompt.source === 'trigger_event' || prompt.intentStage === 'trigger'
  const priority =
    trigger && (row.coverage === 'weak' || row.coverage === 'none') ? 'high' : row.priority
  const mainGap = withoutLeadingNone(row.mainGap)
  return {
    ...ids,
    promptId: prompt.id,
    coverage: row.coverage,
    whereCovered: row.whereCovered,
    currentContent:
      fix === null
        ? `Covered in: ${row.whereCovered.join('; ')}.`
        : withoutLeadingNone(fix.currentContent),
    // A strong row has nothing to update; its one small change, if any, is the main gap.
    whatToUpdate: strong || fix === null ? '' : withoutLeadingNone(fix.whatToUpdate),
    mainGap: mainGap.length > 0 ? mainGap : 'Answered directly.',
    priority,
    actions: rowActions(row.actions, strong),
    suggestedFaq:
      fix === null
        ? null
        : {
            question: fix.suggestedFaq.question,
            answer: fix.suggestedFaq.answer,
            wordCount: wordCount(fix.suggestedFaq.answer)
          },
    done: false
  }
}

/**
 * `text` without a leading "None." (or "N/A", "Nothing"), which Claude sometimes puts
 * before the real sentence: "None. A plain-language line would help." becomes
 * "A plain-language line would help.", and a bare "None." becomes "".
 */
export function withoutLeadingNone(text: string): string {
  const trimmed = text.trim()
  // "Answered directly." alone is the strong-row answer; before a change it is filler.
  const filler = /^answered directly\.\s+(?=\S)/iu
  const rest = trimmed
    .replace(filler, '')
    .replace(/^(?:none|n\/a|nothing)\b\s*(?:[.:;,!—–-]+\s*|$)/iu, '')
  return rest === trimmed ? rest : rest.charAt(0).toUpperCase() + rest.slice(1)
}

/** A strong row gets no FAQ draft, so it never recommends one. */
function rowActions(
  actions: readonly CoverageAction[],
  strong: boolean
): CoverageRecord['actions'] {
  const kept = strong
    ? actions.filter((action) => action !== 'new_faq' && action !== 'optional_faq')
    : [...actions]
  const unique = [...new Set(kept)]
  const [first, ...rest] = unique
  return first === undefined ? ['none'] : [first, ...rest]
}

function rowMismatch(): PipelineError {
  return new PipelineError('A coverage row does not match a prompt.', {
    code: 'schema_validation',
    nextStep: 'Run the coverage matrix again.'
  })
}
