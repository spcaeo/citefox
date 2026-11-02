import { useMemo, type JSX, type ReactNode } from 'react'
import { askColumn } from '../../../assistant/sparkle/askColumn'
import { DrillLink, DrillNumber } from '../../../drill'
import { engineLabel, isAnswerFilter, type EngineFilter } from '../../../engines/model'
import { topicHash } from '../../../shell/routes'
import { AiMenu, EmptyState, ListGrid, Panel, type ListColumn } from '../../../ui'
import { withEngine } from '../../views/model/engine'
import { GRID_BODY_HEIGHT } from '../constants'
import type { TopicCall } from '../hooks/useTopicCall'
import type { TopicDrills } from '../model/drills'
import { formatCheckTime, formatPct } from '../model/format'
import type { TopicProgressPoint, TopicResults } from '../types'
import { ProgressChart, type ProgressSeries } from './ProgressChart'
import { topicAiActions } from './topicAi'
import { useGridQueryState } from '../../../utils/queryState'
import { fixEvents, fixesFor, subjectLabels, topicSubjectIds } from '../../../fixes/chartEvents'
import { openChartEvent } from '../../../pageChanges/actions'
import { usePageChangeEvents } from '../../../pageChanges/hooks'
import { useChartFixes } from '../../../fixes/hooks/useChartFixes'
import { PinToSummary } from '../../../overview/board/PinToSummary'

function seriesOf(results: TopicResults): ProgressSeries[] {
  const full = results.progress.filter((point) => !point.partial)
  const make = (
    id: 'target' | 'questions' | 'keywords',
    label: string,
    color: string,
    marker: ProgressSeries['marker']
  ): ProgressSeries => ({
    id,
    label,
    color,
    marker,
    points: full.flatMap((point) => {
      const part = point[id]
      return part
        ? [
            {
              runId: point.runId,
              at: point.finishedAt,
              rate: part.rate,
              cited: part.cited,
              withAio: part.withAio
            }
          ]
        : []
    })
  })
  // The headline first (the sidebar's and the header's number), then the goals, named as goals.
  const out: ProgressSeries[] = [
    make('target', 'Right page cited', 'var(--result-target)', 'diamond')
  ]
  if (results.goals.questions.prompts > 0) {
    out.push(make('questions', 'Questions goal', 'var(--chart-past)', 'circle'))
  }
  if (results.goals.keywords.prompts > 0) {
    out.push(make('keywords', 'Keywords goal', 'var(--chart-2)', 'square'))
  }
  return out.filter((line) => line.points.length > 0)
}

/**
 * Progress: goal % per full check over real dates, and the same numbers in a
 * table. The latest check's counts open their rows; an earlier check opens
 * the topic as of that check. The tab's one AI menu sits on the chart.
 */
export function ProgressTab({
  results,
  drills,
  call,
  engine,
  engineValue = 'all',
  projectId = null
}: {
  results: TopicResults
  /** For the fix markers under the chart. None: Google updates only. */
  projectId?: string | null
  drills: TopicDrills
  call: TopicCall
  /**
   * The engine filter, logo plus word, above the chart it changes (second monday
   * review #8), not in the Checks toolbar under it.
   */
  engine?: ReactNode
  /** The picked engine: the points are its checks, and a check's link keeps it. */
  engineValue?: EngineFilter
}): JSX.Element {
  // Search and sort ride in the URL (`prog.q`, `prog.sort`): a link keeps them.
  const grid = useGridQueryState('prog')
  const series = seriesOf(results)
  const lead = results.goals.questions.prompts > 0 ? 'questions' : 'keywords'
  const band = results.goals[lead].band
  const points = [...results.progress].reverse()
  const latest = results.progress[results.progress.length - 1]
  const { topic } = results
  const fixList = useChartFixes(projectId)
  const subjects = useMemo(
    () => topicSubjectIds(fixList, topic.id, topic.targetPage),
    [fixList, topic.id, topic.targetPage]
  )
  // Changes seen on the topic's target page that nobody logged: the dashed "?" markers.
  const pageMarks = usePageChangeEvents(projectId, subjects)
  const events = [
    ...fixEvents(fixesFor(fixList, subjects), {
      marketId: topic.marketId,
      now: new Date(),
      pageLabel: subjectLabels(fixList)
    }),
    ...pageMarks
  ]

  if (series.length === 0) {
    return (
      <div className="tr-stack">
        {engine}
        <Panel label="Progress">
          <EmptyState
            icon="trend"
            title={
              isAnswerFilter(engineValue)
                ? `No full check on ${engineLabel(engineValue)} yet`
                : 'No full check yet'
            }
            body="Progress shows the goal per full check once the first one finishes."
          />
        </Panel>
      </div>
    )
  }

  const isLatest = (point: TopicProgressPoint): boolean => point.runId === latest?.runId
  const cell = (
    point: TopicProgressPoint,
    kind: 'questions' | 'keywords'
  ): JSX.Element | string => {
    const part = point[kind]
    if (!part) return '—'
    if (isLatest(point) && !point.partial) {
      const noun = kind === 'questions' ? 'question' : 'keyword'
      return (
        <>
          <DrillNumber drill={drills.cited(noun)} />
          <span className="tr-ratio-sep"> / </span>
          <DrillNumber drill={drills.aio(noun)} />
        </>
      )
    }
    return `${part.cited} / ${part.withAio}`
  }

  const columns: ListColumn<TopicProgressPoint>[] = [
    {
      id: 'date',
      label: 'Check',
      width: 'fill',
      minWidth: 160,
      sort: (point) => point.finishedAt,
      render: (point) => (
        <DrillLink
          target={{
            kind: 'hash',
            hash: withEngine(
              topicHash(topic.id, { marketId: topic.marketId, runId: point.runId }),
              engineValue
            )
          }}
          className="tr-link"
        >
          {formatCheckTime(point.finishedAt)}
        </DrillLink>
      )
    },
    {
      id: 'scope',
      label: 'Scope',
      width: 120,
      render: (point) => (point.partial ? 'Batch' : 'Full check')
    },
    {
      // The topic's headline, the same number as the sidebar and the header.
      id: 'tg',
      label: 'Right page cited',
      width: 152,
      numeric: true,
      sort: (point: TopicProgressPoint) => point.target?.rate ?? null,
      render: (point: TopicProgressPoint) =>
        point.target ? (
          <>
            {formatPct(point.target.rate)}
            <span className="tr-muted num">
              {' '}
              ({point.target.cited} / {point.target.withAio})
            </span>
          </>
        ) : (
          '—'
        )
    },
    ...(results.goals.questions.prompts > 0
      ? [
          {
            id: 'q',
            label: 'Questions cited',
            width: 144,
            numeric: true,
            render: (point: TopicProgressPoint) => cell(point, 'questions')
          },
          {
            id: 'qr',
            label: 'Questions goal',
            width: 132,
            numeric: true,
            sort: (point: TopicProgressPoint) => point.questions?.rate ?? null,
            render: (point: TopicProgressPoint) => formatPct(point.questions?.rate ?? null)
          }
        ]
      : []),
    ...(results.goals.keywords.prompts > 0
      ? [
          {
            id: 'k',
            label: 'Keywords cited',
            width: 140,
            numeric: true,
            render: (point: TopicProgressPoint) => cell(point, 'keywords')
          },
          {
            id: 'kr',
            label: 'Keywords goal',
            width: 128,
            numeric: true,
            sort: (point: TopicProgressPoint) => point.keywords?.rate ?? null,
            render: (point: TopicProgressPoint) => formatPct(point.keywords?.rate ?? null)
          }
        ]
      : [])
  ]

  const withAio =
    series.find((line) => line.id === lead)?.points.map((point) => point.withAio) ?? []
  const changed = new Set(withAio).size > 1

  return (
    <div className="tr-stack">
      {engine}
      <Panel
        title="Right page cited and goals per full check"
        actions={
          <>
            <span className="tr-help">Spacing follows real dates</span>
            {projectId ? (
              <PinToSummary
                projectId={projectId}
                name="this topic’s trend"
                spec={{
                  kind: 'trend',
                  size: 'm',
                  engine: engineValue,
                  config: { scope: { kind: 'topic', id: topic.id }, label: topic.name }
                }}
              />
            ) : null}
            <AiMenu
              label="AI actions for progress"
              size="sm"
              actions={topicAiActions(results, call)}
            />
          </>
        }
      >
        <ProgressChart
          series={series}
          band={band}
          bandLabel={`The band is the ${band.lo}–${band.hi}% ${lead === 'questions' ? 'questions' : 'keywords'} goal.`}
          topicId={topic.id}
          marketId={topic.marketId}
          events={events}
          trackingPages={subjects}
          onOpenEvent={openChartEvent}
        />
        {changed ? (
          <p className="tr-help">
            {isAnswerFilter(engineValue)
              ? `Searches ${engineLabel(engineValue)} answered changed between checks`
              : 'Overviews shown changed between checks'}{' '}
            ({withAio.join(', ')}), so the rate moves even when citations hold.
          </p>
        ) : null}
      </Panel>
      <ListGrid
        {...grid.listProps}
        label="Checks"
        noun={['check', 'checks']}
        rows={points}
        rowKey={(point) => point.runId}
        rowLabel={(point) => formatCheckTime(point.finishedAt)}
        columns={[
          ...columns,
          askColumn<TopicProgressPoint>((point) => ({
            kind: 'check',
            id: point.runId,
            label: formatCheckTime(point.finishedAt),
            detail: point.partial ? 'Batch' : 'Full check'
          }))
        ]}
        initialSort={[{ key: 'date', dir: 'desc' }]}
        maxBodyHeight={GRID_BODY_HEIGHT}
        empty={<p className="tr-empty">No checks yet.</p>}
      />
    </div>
  )
}
