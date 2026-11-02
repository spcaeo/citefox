import {
  FIX_BATCH_MAX,
  MATRIX_BATCH_MAX,
  fixLines,
  gapPrompts,
  matrixLines,
  measuredLines
} from '../../pipeline/coverage'
import {
  keepOnPageFindings,
  validateCoverageFixes,
  validateCoverageMatrix,
  validatePageAudit
} from '../../pipeline/coverage-validate'
import { PipelineError } from '../../pipeline/errors'
import { pageBlob, pageBlockValues, pageTemplateValues } from '../../pipeline/page-context'
import { marketPromptSuffix, promptCompetitorLists } from '../../pipeline/setup'
import { withSettingsInstructions } from '../../pipeline/template-settings'
import { renderTemplate } from '../../pipeline/templates'
import {
  unquoteOffPage,
  validateBuyerProfile,
  validateBuyerPrompts,
  validateCoverage
} from '../../pipeline/validate'
import {
  getLatestBuyerProfile,
  getLatestCoverage,
  getLatestPromptSet,
  getLatestSnapshot,
  type StoredSnapshot
} from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { readProjectProfile } from '../../storage/project-profile'
import type { TryDraft, TryInput } from './types'

/**
 * A page step's draft rendered exactly as page setup renders it (`setup.ts`,
 * `coverage.ts`): the latest snapshot, the project's brand names, the context
 * blocks, the buyer profile and prompts where the step reads them, then the
 * settings lines. Nothing is read live and nothing is written. A kind this module
 * does not know renders with the page values and accepts any JSON object.
 */
export function pageStepDraft(input: TryInput): TryDraft {
  const snapshot = getLatestSnapshot(input.db, input.page.id)
  if (snapshot === null) {
    throw new PipelineError('This page has not been read yet.', {
      code: 'not_found',
      nextStep: 'Read the page first.'
    })
  }
  const profile = readProjectProfile(input.db)
  if (profile === null) {
    throw new PipelineError('This project has no profile yet.', {
      code: 'not_found',
      nextStep: 'Save the project profile first.'
    })
  }
  const brands = profile.brandNames
  const count = input.settings.promptCount ?? input.page.promptCount
  const pageText = pageBlob(snapshot)
  let suffix = ''
  let validate: TryDraft['validate'] = anyObject
  if (input.kind === 'buyer_profile') {
    validate = (value) => validateBuyerProfile(value, { brands })?.message ?? null
  } else if (input.kind === 'buyer_prompts') {
    const buyer = getLatestBuyerProfile(input.db, input.page.id)
    if (buyer === null) {
      throw new PipelineError('This page has no buyer profile yet.', {
        code: 'not_found',
        nextStep: 'Write the buyer profile first.'
      })
    }
    suffix = marketPromptSuffix(input.market, buyer, null, count)
    const language = input.settings.language ?? input.market.language
    const lists = promptCompetitorLists(input.db, input.page.id)
    validate = (value) =>
      validateBuyerPrompts(value, {
        count,
        brands,
        canonical: null,
        language,
        canonicalLanguage: language,
        lists
      })?.message ?? null
  } else if (input.kind === 'coverage') {
    const prompts = requirePrompts(input.db, input.page.id, brands)
    const lines = prompts.map((item) => `${item.position}. ${item.text}`).join('\n')
    suffix = `Buyer prompts:\n${lines}`
    validate = (value) =>
      validateCoverage(value, { count: prompts.length, pageText })?.message ?? null
  } else if (input.kind === 'coverage_matrix') {
    const batch = requirePrompts(input.db, input.page.id, brands).slice(0, MATRIX_BATCH_MAX)
    suffix = matrixLines(batch)
    const sources = { pageText, promptText: batch.map((item) => item.text).join('\n') }
    const positions = batch.map((item) => item.position)
    validate = (value) =>
      validateCoverageMatrix(unquoteOffPage(value, sources), { ...sources, positions })?.message ??
      null
  } else if (input.kind === 'page_audit') {
    suffix = measuredLines(snapshot)
    validate = (value) =>
      validatePageAudit(keepOnPageFindings(value, pageText), { pageText })?.message ?? null
  } else if (input.kind === 'coverage_fixes') {
    const draft = fixesDraft(input, snapshot, brands)
    suffix = draft.suffix
    validate = draft.validate
  }
  const rendered = renderTemplate(input.body, {
    ...pageTemplateValues(input.page, snapshot, brands, count),
    ...pageBlockValues({
      db: input.db,
      pageId: input.page.id,
      domain: input.domain,
      pageUrl: input.page.url,
      brandNames: brands,
      market: input.market,
      language: input.settings.language
    })
  })
  const text = suffix.length === 0 ? rendered.text : `${rendered.text}\n${suffix}`
  return { prompt: withSettingsInstructions(text, input.kind, input.settings), validate }
}

/** The page's prompts in order, or a typed error when there are none. */
function requirePrompts(
  db: SqliteDatabase,
  pageId: string,
  brands: readonly string[]
): ReturnType<typeof gapPrompts> {
  const promptSet = getLatestPromptSet(db, pageId, brands)
  if (promptSet === null || promptSet.prompts.length === 0) {
    throw new PipelineError('This page has no buyer prompts yet.', {
      code: 'not_found',
      nextStep: 'Write the buyer prompts first.'
    })
  }
  return gapPrompts(promptSet.prompts)
}

/** The fixes step on the stored matrix's rows that are not strong (up to one batch). */
function fixesDraft(
  input: TryInput,
  snapshot: StoredSnapshot,
  brands: readonly string[]
): { suffix: string; validate: TryDraft['validate'] } {
  const matrix = getLatestCoverage(input.db, input.page.id, snapshot.contentHash)
  const prompts = requirePrompts(input.db, input.page.id, brands)
  const rows = (matrix?.rows ?? [])
    .filter((row) => row.coverage !== 'strong')
    .flatMap((row) => {
      const item = prompts.find((entry) => entry.prompt.id === row.promptId)
      return item === undefined
        ? []
        : [
            {
              item,
              row: {
                position: item.position,
                coverage: row.coverage,
                whereCovered: [...row.whereCovered],
                mainGap: row.mainGap,
                priority: row.priority,
                actions: [...row.actions]
              }
            }
          ]
    })
    .slice(0, FIX_BATCH_MAX)
  if (rows.length === 0) {
    throw new PipelineError('This page has no coverage rows to fix yet.', {
      code: 'not_found',
      nextStep: 'Write the content gaps first.'
    })
  }
  const batch = rows.map((entry) => entry.item)
  const sources = { pageText: pageBlob(snapshot), promptText: batch.map((i) => i.text).join('\n') }
  return {
    suffix: fixLines(
      snapshot,
      batch,
      rows.map((entry) => entry.row),
      []
    ),
    validate: (value) =>
      validateCoverageFixes(unquoteOffPage(value, sources), {
        ...sources,
        positions: batch.map((item) => item.position),
        brands,
        wrongFacts: []
      })?.message ?? null
  }
}

function anyObject(value: unknown): string | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? null
    : 'The reply was not a JSON object.'
}
