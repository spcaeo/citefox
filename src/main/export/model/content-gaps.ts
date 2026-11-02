import type { CoverageAction, CoverageLevel } from '@shared/domain'
import type { ExportPage } from '../types'
import type { ScopeData } from './rows'
import type { ContentGapsSection, GapMatrixRow, OneByOneItem } from './types'

/** Search results usually cut a title after about this many characters. */
export const TITLE_CUT_CHARS = 60

const ACTION_LABELS: Record<CoverageAction, string> = {
  update_existing: 'Update section or FAQ',
  new_faq: 'New FAQ',
  small_update: 'Small update',
  optional_faq: 'Optional FAQ',
  none: 'No change'
}

const LEVEL_ORDER: readonly CoverageLevel[] = ['strong', 'partial', 'weak', 'none']

export function actionLabel(actions: readonly CoverageAction[]): string {
  return actions.map((action) => ACTION_LABELS[action]).join(' + ')
}

/**
 * "5 strong, 4 partial, 1 weak — 5–6 new FAQs plus edits to 5 sections."
 * Optional FAQs widen the range; update and small-update rows count as section edits.
 */
export function coverageSummary(
  rows: readonly { coverage: CoverageLevel; actions: readonly CoverageAction[] }[]
): string {
  if (rows.length === 0) return ''
  const levels = LEVEL_ORDER.flatMap((level) => {
    const n = rows.filter((row) => row.coverage === level).length
    if (n === 0 && level === 'none') return []
    return [`${n} ${level === 'none' ? 'not covered' : level}`]
  })
  const faqs = rows.filter((row) => row.actions.includes('new_faq')).length
  const optional = rows.filter(
    (row) => row.actions.includes('optional_faq') && !row.actions.includes('new_faq')
  ).length
  const edits = rows.filter(
    (row) => row.actions.includes('update_existing') || row.actions.includes('small_update')
  ).length
  const faqText =
    optional > 0
      ? `${faqs}–${faqs + optional} new FAQs`
      : `${faqs} new ${faqs === 1 ? 'FAQ' : 'FAQs'}`
  const editText = `edits to ${edits} ${edits === 1 ? 'section' : 'sections'}`
  return `${levels.join(', ')} — ${faqText} plus ${editText}.`
}

/** Section 10, Content gaps. Page scope with one page only. */
export function buildContentGaps(scope: ScopeData, page: ExportPage | null): ContentGapsSection {
  if (page === null) {
    return {
      empty: {
        title: 'Page scope only',
        message:
          'Content gaps compare one page with its buyer prompts, so they are in page reports.',
        nextStep: 'Export a single page to see its coverage matrix and FAQ drafts.'
      },
      pageRead: null,
      matrix: [],
      summary: '',
      oneByOne: [],
      pageWide: []
    }
  }
  const matrix = page.gaps
  const promptRows = scope.rows.filter((row) => row.pageId === page.pageId)
  const promptFor = (promptId: string): { number: number; text: string; rowId: string | null } => {
    const row = promptRows.find((item) => item.promptId === promptId)
    return row === undefined
      ? { number: 0, text: '', rowId: null }
      : { number: row.number, text: row.text, rowId: row.id }
  }
  const title = page.title ?? ''
  const findings = matrix?.findings ?? []
  const mismatches = findings
    .filter((finding) => finding.kind === 'title_meta_mismatch')
    .map((finding) => finding.summary)
  if (
    mismatches.length === 0 &&
    page.title !== null &&
    page.h1 !== null &&
    normalize(page.title) !== normalize(page.h1)
  ) {
    mismatches.push('The title and the H1 say different things.')
  }
  const rows: GapMatrixRow[] = (matrix?.rows ?? [])
    .map((record, index) => {
      const prompt = promptFor(record.promptId)
      return {
        number: prompt.number === 0 ? index + 1 : prompt.number,
        rowId: prompt.rowId,
        prompt: prompt.text,
        coverage: record.coverage,
        whereCovered: record.whereCovered,
        mainGap: record.mainGap,
        actions: record.actions,
        actionLabel: actionLabel(record.actions)
      }
    })
    .sort((left, right) => left.number - right.number)
  const oneByOne: OneByOneItem[] = (matrix?.rows ?? [])
    .map((record, index) => {
      const prompt = promptFor(record.promptId)
      return {
        number: prompt.number === 0 ? index + 1 : prompt.number,
        prompt: prompt.text,
        now: record.currentContent,
        update: record.whatToUpdate,
        newFaq: record.suggestedFaq !== null,
        faq:
          record.suggestedFaq === null
            ? null
            : {
                question: record.suggestedFaq.question,
                answer: record.suggestedFaq.answer,
                words: record.suggestedFaq.wordCount
              }
      }
    })
    .sort((left, right) => left.number - right.number)
  return {
    empty:
      matrix === null
        ? {
            title: 'Not measured yet',
            message: 'No coverage matrix is stored for this page.',
            nextStep: 'Run the coverage analysis on the Gaps tab to fill this.'
          }
        : null,
    pageRead: {
      url: page.url,
      title: page.title,
      metaDescription: page.metaDescription,
      h1: page.h1,
      readAt: page.snapshotAt,
      lastModified: page.modifiedAt,
      titleLength: [...title].length,
      titleTruncated: [...title].length > TITLE_CUT_CHARS,
      mismatches
    },
    matrix: rows,
    summary: coverageSummary(rows),
    oneByOne,
    pageWide: findings.map((finding) => ({
      kind: finding.kind,
      summary: finding.summary,
      detail: finding.detail
    }))
  }
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}
