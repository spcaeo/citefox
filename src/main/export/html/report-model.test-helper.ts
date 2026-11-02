import type { ExportRequest } from '@shared/ipc'
import { sampleReportModel } from '../model/sample.test-helper'
import type { ReportModel, ReputationSection } from '../model/types'

/**
 * The rich sample model with the reputation section filled in, the way the brand
 * sentiment builder fills it, so every section renders with data. Tests and sample
 * output only.
 */
export function fullReportModel(overrides: Partial<ExportRequest> = {}): ReportModel {
  const model = structuredClone(sampleReportModel(overrides)) as ReportModel & {
    drills: Record<string, readonly string[]>
  }
  const named = model.rows.filter((row) => row.named)
  const split = {
    positive: named.slice(0, Math.ceil(named.length / 2)),
    neutral: named.slice(Math.ceil(named.length / 2), named.length - 1),
    negative: named.slice(Math.max(named.length - 1, 0))
  }
  const count = (token: string, ids: readonly string[]): { n: number; drill: string } => {
    model.drills[token] = ids
    return { n: ids.length, drill: token }
  }
  const first = named[0]
  const reputation: ReputationSection = {
    empty: null,
    positive: count(
      'tone:positive',
      split.positive.map((row) => row.id)
    ),
    neutral: count(
      'tone:neutral',
      split.neutral.map((row) => row.id)
    ),
    negative: count(
      'tone:negative',
      split.negative.map((row) => row.id)
    ),
    analysed: named.length,
    net:
      named.length >= 5
        ? Math.round(((split.positive.length - split.negative.length) / named.length) * 100)
        : null,
    trend: [
      { at: '2026-10-05T15:00:00.000Z', positive: 2, neutral: 1, negative: 0 },
      {
        at: '2026-10-19T16:00:00.000Z',
        positive: split.positive.length,
        neutral: split.neutral.length,
        negative: split.negative.length
      }
    ],
    issues:
      first === undefined
        ? []
        : [
            {
              rowId: first.id,
              prompt: first.text,
              claim: 'TextBolt requires a developer to connect email alerts.',
              whyWrong: 'The page and brand facts say setup takes about 30 minutes with no code.',
              correction:
                'TextBolt turns emails into texts with no developer and no new app for staff.',
              sourceToFix: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
            }
          ],
    answers: named.map((row, index) => ({
      rowId: row.id,
      prompt: row.text,
      tone:
        index < split.positive.length
          ? 'positive'
          : index === named.length - 1
            ? 'negative'
            : 'neutral',
      theme: index % 2 === 0 ? 'Ease of setup' : 'Price',
      rank: `#${(index % 3) + 1} of 3 brands named`,
      why: 'The overview recommends TextBolt for teams without developers.'
    }))
  }
  model.reputation = reputation
  return model
}
