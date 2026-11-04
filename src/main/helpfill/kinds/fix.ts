import type { PromptCheckDetail } from '@shared/domain'
import { formatMoment } from '@shared/moment'
import { ensureShippedAssists } from '../../assist/definitions'
import { runAssist } from '../../assist/run'
import { loadPromptDetail } from '../../engine/checks/results'
import type { EngineHost } from '../../engine/host'
import { withProject } from '../../engine/project-db'
import { PipelineError } from '../../pipeline/errors'
import { getLatestCoverage, getLatestSnapshot } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { pathOf } from '../context'
import type { HelpFillContext, HelpFillKindDef } from '../types'
import { companyLine, questionOf, quoted, sectionFor } from './evidence'

/**
 * Fix drawer → "✦ Draft it for me" or "Rewrite with my ChatGPT" (HelpFill.dc.html
 * panel 5): the new section for one question of one page. The prompt carries the
 * question, what Google's AI Overview said and cited for it in the latest check, and
 * what the page says now (the coverage row's reading, else the page read's closest
 * section). Describe reuses the fix assists: `gaps.draftFix` when the page has a
 * coverage row for the question, else `progress.draftFix` with the question as the gap.
 */

/** Pages of the overview's reference list the prompt names. */
const CITED_MAX = 6

export const FIX_KIND: HelpFillKindDef = {
  kind: 'fix',
  noun: ['section', 'sections'],
  scope: 'page',
  needs: ['promptId'],
  contextBlocks: false,
  text: { evidence: fixEvidence, maxChars: 6000 },
  sections: [{ id: 'main', title: null, columns: ['text'], entity: null }],
  neutral: false,
  defaultCount: 1,
  maxCount: 1,
  chatbotCount: 1,
  // One assist call, the size of a fix draft.
  describeCost: { calls: 1, usd: 0.02 },
  role: () =>
    "You help a company rewrite one section of its own web page so Google's AI Overview can quote it.",
  task: () => [
    'Rewrite my section so it answers the question first: 2 sentences, with one number my page states, then the steps.',
    "Keep my facts. Don't add a price, date, limit or claim my page doesn't make.",
    "Don't name or link the sites Google cites.",
    'Reply with the section only, no notes.'
  ],
  tracked: () => ({ listed: [], merge: {} }),
  describe: describeFix
}

async function fixEvidence(host: EngineHost, context: HelpFillContext): Promise<string[]> {
  const target = context.target
  if (target === null) return []
  return withProject(host, context.projectId, 'helpfill:prompt', ({ project, db }) => {
    const question = questionOf(db, target.id, context.promptId, context.brands)
    const detail = promptDetail(db, host, project.id, project.domain, target.id, question.id)
    const lines = [
      companyLine(context),
      `Question a buyer types into Google: "${question.wording}"`
    ]
    lines.push('', ...overviewLines(detail))
    lines.push('', ...sectionLines(db, target, question.wording, question.id, detail))
    return lines
  })
}

function promptDetail(
  db: SqliteDatabase,
  host: EngineHost,
  projectId: string,
  domain: string,
  pageId: string,
  promptId: string
): PromptCheckDetail | null {
  try {
    return loadPromptDetail(db, {
      projectId,
      pageId,
      marketId: null,
      runId: null,
      builtAt: host.now().toISOString(),
      domain,
      keyLabels: new Map(),
      promptId
    })
  } catch {
    // A page with no market or no check yet: the prompt says nothing about the overview.
    return null
  }
}

/** What the overview said and the pages it cited, or one line when it showed none. */
function overviewLines(detail: PromptCheckDetail | null): string[] {
  const row = detail?.row ?? null
  if (detail === null || row === null) return []
  const when =
    row.checkedAt === null ? '' : ` (check of ${formatMoment(row.checkedAt, { year: true })})`
  const text = detail.samples.find((sample) => (sample.aioText ?? '').trim().length > 0)?.aioText
  if ((text ?? '').trim().length === 0 && row.references.length === 0) {
    return [`Google showed no AI Overview for it in the latest check${when}.`]
  }
  const lines: string[] = []
  const said = quoted(text)
  if (said.length > 0) lines.push(`Google's AI Overview for it${when} says:`, ...said)
  if (row.references.length > 0) {
    lines.push(
      'It cites these pages:',
      ...row.references
        .slice(0, CITED_MAX)
        .map(
          (reference) =>
            `- ${reference.domain}${reference.title ? `: ${reference.title}` : ''} (${reference.url})`
        )
    )
  }
  return lines
}

/** What the page says now: the coverage row's reading of it, else the closest section. */
function sectionLines(
  db: SqliteDatabase,
  target: NonNullable<HelpFillContext['target']>,
  question: string,
  promptId: string,
  detail: PromptCheckDetail | null
): string[] {
  if (target.url === null) return []
  const path = pathOf(target.url) || target.url
  const snapshot = getLatestSnapshot(db, target.id)
  const covered = getLatestCoverage(db, target.id, snapshot?.contentHash ?? null)?.rows.find(
    (row) => row.promptId === promptId
  )
  const reading = covered?.currentContent.trim() ?? ''
  if (reading.length > 0 && !/^(?:nothing|none|not covered)\b/iu.test(reading)) {
    const where = covered?.whereCovered[0] ?? detail?.whereCovered[0] ?? null
    return [`My page ${path} says now${where ? ` (section "${where}")` : ''}:`, ...quoted(reading)]
  }
  const section = snapshot === null ? null : sectionFor(question, snapshot)
  if (section === null) return []
  return [
    `My page ${path} says now${section.heading ? ` (section "${section.heading}")` : ''}:`,
    ...quoted(section.text)
  ]
}

/** The fix assists' blocks to paste, as one draft (the "Fix N" log line left out). */
async function describeFix(
  host: EngineHost,
  context: HelpFillContext,
  input: { sentence: string }
): Promise<{ section: null; values: { text: string } }[]> {
  ensureShippedAssists()
  const target = context.target
  if (target === null || context.promptId === null) return []
  const shape =
    'Write it answer first: 2 sentences with one number the page states, then the steps.'
  const instruction = [input.sentence.trim(), shape].filter(Boolean).join('\n')
  const base = {
    projectId: context.projectId,
    pageId: target.id,
    marketId: null,
    instruction
  }
  let result
  try {
    result = await runAssist(host, {
      ...base,
      assistId: 'gaps.draftFix',
      promptId: context.promptId,
      inputs: {}
    })
  } catch (error) {
    // No coverage row for this question yet: draft from the page and the question instead.
    if (!(error instanceof PipelineError) || error.code !== 'not_found') throw error
    const question = await withProject(host, context.projectId, 'helpfill:describe', ({ db }) =>
      questionOf(db, target.id, context.promptId, context.brands)
    )
    result = await runAssist(host, {
      ...base,
      assistId: 'progress.draftFix',
      promptId: null,
      inputs: { gap: `Answer the question "${question.wording}" on this page.` }
    })
  }
  const blocks = result.items.filter((item) => !/^fix\s*\d+$/iu.test(item.tag ?? ''))
  const text = blocks
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
  return text.length === 0 ? [] : [{ section: null, values: { text } }]
}
