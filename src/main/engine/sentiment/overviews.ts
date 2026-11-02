import type { SentimentReference, SentimentSource } from '@shared/domain'
import {
  listStoredAioReferences,
  listStoredMarketPrompts,
  listStoredSerpResults,
  type StoredCheckRun
} from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { listBrandCaptures } from '../../storage/sentiment-records'
import { filterFor } from '../checks/results'
import { rollupSamples } from '../checks/score'
import { BRAND_PROMPT_KIND_LABEL, toSentimentReference } from './context'

/**
 * The overviews of one run that Claude reads for sentiment (FR-16.2): the
 * winning sample of each buyer prompt (the same sample Results shows) and each
 * brand prompt capture. Captures without overview text are listed with no text.
 */
export interface RunOverview {
  source: SentimentSource
  captureId: string
  promptId: string
  promptLabel: string
  promptText: string
  aioText: string | null
  references: readonly SentimentReference[]
}

export function runOverviews(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun
): RunOverview[] {
  return [...buyerOverviews(db, projectId, run), ...brandOverviews(db, run)]
}

function buyerOverviews(db: SqliteDatabase, projectId: string, run: StoredCheckRun): RunOverview[] {
  const filter = filterFor(projectId, run.pageId, run.marketId, run.id)
  const samples = listStoredSerpResults(db, filter)
  const references = listStoredAioReferences(db, filter)
  const overviews: RunOverview[] = []
  for (const prompt of listStoredMarketPrompts(db, run.promptSetId, run.marketId)) {
    const group = samples.filter((sample) => sample.promptId === prompt.id)
    if (group.length === 0) continue
    const rolled = rollupSamples(
      group.map((sample) => ({
        sampleNo: sample.sampleNo,
        status: sample.status,
        named: sample.named,
        citedUrl: sample.citedUrl,
        position: sample.position,
        aioText: sample.aioText,
        references: []
      }))
    )
    const winning = group.find((sample) => sample.sampleNo === rolled.winning?.sampleNo) ?? group[0]
    if (winning === undefined) continue
    const text = winning.aioText?.trim() ?? ''
    overviews.push({
      source: 'buyer',
      captureId: winning.id,
      promptId: prompt.id,
      promptLabel: prompt.label,
      promptText: prompt.text,
      aioText: winning.hasAio && text.length > 0 ? winning.aioText : null,
      references: references
        .filter((reference) => reference.serpResultId === winning.id)
        .map(toSentimentReference)
    })
  }
  return overviews
}

function brandOverviews(db: SqliteDatabase, run: StoredCheckRun): RunOverview[] {
  return listBrandCaptures(db, [run.id]).map((capture) => {
    const text = capture.aioText?.trim() ?? ''
    return {
      source: 'brand' as const,
      captureId: capture.id,
      promptId: capture.brandPromptId,
      promptLabel: BRAND_PROMPT_KIND_LABEL[capture.kind],
      promptText: capture.promptText,
      aioText: capture.status === 'aio' && text.length > 0 ? capture.aioText : null,
      references: capture.references
    }
  })
}
