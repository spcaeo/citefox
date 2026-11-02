import { allowedNumbers, sentences, unknownNumbers } from '../../assistant/numbers'
import { reportModelRequest } from '../../email/reports/export-request'
import { reportFactLines } from '../../email/reports/summary-body'
import type { EngineHost } from '../../engine/host'
import { withProject } from '../../engine/project-db'
import { storageReportBuilders } from '../../export/report-builders'
import { loadReportModel } from '../../export/service'
import { createStorageExportSource } from '../../export/source'
import { scheduleScopePageIds } from '../../headless/report-scope'
import { getReportSchedule } from '../../storage/email-records'
import { readProjectProfile } from '../../storage/project-profile'
import { HelpFillEvidenceMissing, type HelpFillContext, type HelpFillKindDef } from '../types'
import { companyLine, quoted } from './evidence'

/**
 * Reports → schedule → Email preview → "Write it in your own voice with my ChatGPT"
 * (HelpFill.dc.html panel 7, Reports summary). The prompt carries the report's own
 * numbers: the headline, the score, what changed (the top movers) and what to do
 * next, built from the same report model as the scheduled email (`reportFactLines`),
 * for the saved schedule (`scope.subject`) or, for a new one, the whole project in
 * its default market. The pasted summary goes through the report's number check:
 * a sentence with a number the report does not hold is taken out, and the banner
 * says which. In-app Claude already has its own buttons here (`report.summary`), so
 * this kind has no Describe.
 */

/** Characters of report lines the prompt carries. */
const REPORT_CHARS = 4000

export const REPORT_SUMMARY_KIND: HelpFillKindDef = {
  kind: 'reportSummary',
  noun: ['summary', 'summaries'],
  scope: 'project',
  contextBlocks: false,
  text: { evidence: reportEvidence, maxChars: 3000, check: checkReportNumbers },
  sections: [{ id: 'main', title: null, columns: ['text'], entity: null }],
  neutral: false,
  defaultCount: 1,
  maxCount: 1,
  chatbotCount: 1,
  describeCost: { calls: 0, usd: 0 },
  role: () => 'You help a marketer write the summary of an AI search report in their own voice.',
  task: () => [
    'Write a short summary of this report in my voice: where we stand, what changed and what we do next.',
    "Use only the numbers in the report above. Don't round them, add any or work out new ones.",
    'Keep it under 150 words, in plain words a client understands.',
    'Reply with the summary only, no notes.'
  ],
  tracked: () => ({ listed: [], merge: {} })
}

async function reportEvidence(host: EngineHost, context: HelpFillContext): Promise<string[]> {
  const record =
    context.subject === null ? null : getReportSchedule(host.storage.db, context.subject)
  const schedule =
    record !== null && (record.projectId === null || record.projectId === context.projectId)
      ? record
      : null
  const marketIds =
    schedule !== null && schedule.marketIds.length > 0
      ? [...schedule.marketIds]
      : await defaultMarket(host, context.projectId)
  const timeZone = schedule?.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const pageIds =
    schedule === null
      ? null
      : scheduleScopePageIds(
          host.storage,
          { id: schedule.id, scope: schedule.scope ?? null, projectId: schedule.projectId },
          context.projectId,
          host.logger
        )
  const now = host.now()
  const deps = {
    app: host.storage.db,
    projectsDirectory: host.storage.paths.projectsDirectory,
    now: () => now
  }
  const loaded = await loadReportModel({
    request: reportModelRequest(
      { marketIds, sections: schedule?.sections ?? [], timeZone },
      context.projectId,
      pageIds
    ),
    source: createStorageExportSource(deps),
    now: () => now,
    builders: storageReportBuilders({ ...deps, logger: host.logger }, context.projectId)
  })
  if (!loaded.ok) throw new HelpFillEvidenceMissing(loaded.reason, loaded.nextStep)
  return [
    companyLine(context),
    'The report (use only these numbers):',
    ...quoted(reportFactLines(loaded.model).join('\n'), REPORT_CHARS)
  ]
}

/** The project's default market, as the schedule form's "Each project's default market". */
async function defaultMarket(host: EngineHost, projectId: string): Promise<string[]> {
  return withProject(host, projectId, 'helpfill:prompt', ({ db }) => {
    const market = readProjectProfile(db)?.market
    return market === undefined ? [] : [market.id]
  })
}

/**
 * The report's number check on a pasted summary (deep audit crosscut §3.5 rule 2, as
 * Ask CiteFox and `report.summary` apply it): every number must be in the report's
 * lines. A sentence holding another number is taken out; a line left empty goes.
 */
export function checkReportNumbers(
  text: string,
  evidence: readonly string[]
): { text: string; warnings: string[] } {
  const allowed = allowedNumbers(...evidence)
  const flagged: string[] = []
  let removed = 0
  const lines = text.split('\n').flatMap((line) => {
    if (unknownNumbers(line, allowed).length === 0) return [line]
    const kept = sentences(line).filter((sentence) => {
      const bad = unknownNumbers(sentence, allowed)
      for (const value of bad) if (!flagged.includes(value)) flagged.push(value)
      if (bad.length > 0) removed += 1
      return bad.length === 0
    })
    return kept.length === 0 ? [] : [kept.join(' ')]
  })
  if (removed === 0) return { text, warnings: [] }
  const cleaned = lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  const noun = removed === 1 ? 'sentence' : 'sentences'
  const numbers = flagged.length === 1 ? 'a number' : 'numbers'
  return {
    text: cleaned,
    warnings: [
      `Took out ${removed} ${noun} with ${numbers} not in the report: ${flagged.join(', ')}.`
    ]
  }
}
