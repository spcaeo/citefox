import type { JSX } from 'react'
import type { QuestionRow, QuestionSource } from '@shared/ipc'
import { DrillNumber, type ItemDrill } from '../../../drill'
import { topicHash } from '../../../shell/routes'
import type { EngineFilter } from '../../../engines/model'
import { KpiStrip, KpiTile, resultWords } from '../../../ui'
import {
  needsWork,
  resultOfStatus,
  type DashKpis as Kpis,
  type DashTopic,
  type SearchResult,
  withEngine
} from '../../views/model'
import { questionsDrill } from '../drills'
import { fixesLink } from './fixesLink'

/**
 * The Topics dashboard's KPI strip (board Main): target page cited, needs work (as page
 * fixes in Fixes), and, once there are two topics to compare, the topic furthest behind
 * and the most improved one. Each value opens what it counts.
 */
export function DashKpis({
  kpis,
  topics,
  rows,
  sources,
  marketId,
  pageFixes: counted = null,
  allPageFixes = null,
  engine = 'all'
}: {
  kpis: Kpis
  /** The listed topics: one opens Fixes cut to it; two or more show the comparison tiles. */
  topics: readonly DashTopic[]
  /** Every topic's searches (all of them, as the board counts), so each number opens its list. */
  rows: readonly QuestionRow[]
  sources: ReadonlyMap<string, QuestionSource>
  marketId: string | null
  /** The topics' page fixes as Fixes counts them; the local estimate until it loads. */
  pageFixes?: number | null
  /** Every page fix Fixes shows (topics and tracked pages), for "14 of the 15". */
  allPageFixes?: number | null
  /** The picked engine: an answer engine counts searches that got an answer (audit #4). */
  engine?: EngineFilter
}): JSX.Element {
  const words = resultWords(engine)
  const pageFixes = counted ?? kpis.pageFixes
  const fixes = fixesLink(topics, pageFixes, allPageFixes)
  // Searches, like the board counts them, so each drawer lists as many rows as its number.
  const drill = (
    id: string,
    title: string,
    description: string,
    keep: (result: SearchResult) => boolean
  ): ItemDrill => ({
    ...questionsDrill({
      id,
      title,
      description,
      rows: rows.filter((row) => keep(resultOfStatus(row.status))),
      sources,
      marketId,
      words
    }),
    noun: ['search', 'searches']
  })
  const targetDrill = drill(
    'topics:kpi:target',
    'Right page cited',
    words.engine
      ? `The searches whose ${words.engine} answer cites the page that should be cited.`
      : 'The searches whose AI Overview cites the page that should be cited.',
    (result) => result === 'target'
  )
  const aioDrill = drill(
    'topics:kpi:aio',
    `Searches ${words.withAnswer}`,
    words.engine
      ? `The searches ${words.engine} answered in its latest check.`
      : 'The searches that showed an AI Overview in their latest check.',
    (result) => result === 'target' || needsWork(result)
  )
  const workDrill = drill(
    'topics:kpi:work',
    'Searches that need work',
    'Not cited, or cited from another of your pages instead of the target.',
    needsWork
  )
  const behind = kpis.furthestBehind
  const improved = kpis.mostImproved
  return (
    <KpiStrip label="Topics summary">
      <KpiTile
        label="Right page cited"
        value={kpis.targetPct === null ? '—' : `${kpis.targetPct}%`}
        sub={
          kpis.withAio === 0 ? (
            words.noneYet
          ) : (
            <>
              <DrillNumber drill={targetDrill} /> of <DrillNumber drill={aioDrill} /> searches{' '}
              {words.withAnswer}
            </>
          )
        }
      />
      <KpiTile
        label="Needs work"
        value={kpis.needsWork === 0 ? '0' : <DrillNumber drill={workDrill} />}
        suffix={kpis.needsWork === 1 ? ' search' : ' searches'}
        sub={kpis.needsWork === 0 ? 'Nothing to fix now' : <a href={fixes.href}>{fixes.text}</a>}
      />
      {topics.length >= 2 ? (
        <>
          <KpiTile
            label="Furthest behind"
            value={
              behind ? <a href={withEngine(topicHash(behind.id), engine)}>{behind.name}</a> : '—'
            }
            sub={
              behind ? `${behind.totals.targetPct ?? 0}% right page cited` : 'No topic checked yet'
            }
          />
          <KpiTile
            label="Most improved"
            value={
              improved ? (
                <a href={withEngine(topicHash(improved.id), engine)}>{improved.name}</a>
              ) : (
                '—'
              )
            }
            sub={
              improved
                ? `+${improved.changePts ?? 0} pts right page cited since the last check`
                : 'Shows after a second check'
            }
          />
        </>
      ) : null}
    </KpiStrip>
  )
}
