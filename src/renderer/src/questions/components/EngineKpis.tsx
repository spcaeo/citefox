import type { JSX, ReactNode } from 'react'
import type { EngineId } from '@shared/domain'
import type { QuestionSource, QuestionsList } from '@shared/ipc'
import { DrillNumber } from '../../drill'
import { engineLabel, type StatusMap } from '../../engines/model'
import { KpiStrip, KpiTile } from '../../ui'
import { questionsEngineDrill } from '../drills'
import { engineKpiRows, unavailableCount, type EngineKpiPart } from '../engineView'
import { shareText } from '../model'

/**
 * The Questions headline numbers on one answer engine (ChatGPT, Perplexity…): the same
 * Tracked tile as Google's view, then how many tracked questions that engine answered,
 * cited you in, and named you in. Each number opens its questions.
 */
export function EngineKpis({
  engine,
  tracked,
  list,
  sources,
  statuses,
  marketLabel
}: {
  engine: EngineId
  /** Google's view's Tracked tile, unchanged. */
  tracked: ReactNode
  list: QuestionsList
  sources: ReadonlyMap<string, QuestionSource>
  statuses: StatusMap
  marketLabel: string
}): JSX.Element {
  const label = engineLabel(engine)
  const trackedCount = list.rows.filter((row) => row.enabled).length
  const count = (part: EngineKpiPart): number =>
    engineKpiRows(list.rows, statuses, engine, part).length
  const number = (part: EngineKpiPart, headline: string): JSX.Element => {
    const drill = questionsEngineDrill({ engine, part, statuses, list, sources, marketLabel })
    return (
      <DrillNumber
        drill={drill}
        label={`${drill.items.length.toLocaleString('en-US')} questions: ${headline}`}
      />
    )
  }
  const answered = count('answered')
  const down = unavailableCount(list.rows, statuses, engine)
  return (
    <KpiStrip label={`Questions summary on ${label}`}>
      {tracked}
      <KpiTile
        label={`${label} answered`}
        value={number('answered', `${label} answered`)}
        sub={
          down > 0
            ? `Unavailable for ${down.toLocaleString('en-US')} · tried again at the next check`
            : `${shareText(answered, trackedCount)} in ${marketLabel}`
        }
      />
      <KpiTile
        label="Cited"
        value={number('cited', `${label} cites you`)}
        sub={`${shareText(count('cited'), answered)} of answers`}
      />
      <KpiTile
        label="Named"
        value={number('named', `${label} names you`)}
        sub={`${shareText(count('named'), answered)} of answers`}
      />
    </KpiStrip>
  )
}
