import { useCallback, useEffect, useMemo, type JSX, type ReactNode } from 'react'
import type { BoardWidget, WidgetEngine } from '@shared/summary-board'
import {
  DrillButton,
  DrillNumber,
  opaqueId,
  targetHref,
  useDrill,
  type ItemDrill
} from '../../drill'
import { isAnswerFilter } from '../../engines/model'
import { openChartEvent } from '../../pageChanges/actions'
import { drawerHref } from '../../shell/drawers'
import { BarFill, ResultBar, resultWords, type ResultCounts } from '../../ui'
import { ResultWordsContext, type ResultWords } from '../../ui/resultWords'
import { compareLabel, kpiDrill, questionFilterFrom, type QuestionFilter } from '../compare'
import { ChangesSection } from '../components/ChangesSection'
import { EngineSummaryKpis } from '../components/EngineSummary'
import { OverviewKpis } from '../components/OverviewKpis'
import { CitedSitesPanel, NextFixesPanel } from '../components/RailPanels'
import { ResultsPanel } from '../components/ResultsPanel'
import { WeeklyChart } from '../components/WeeklyChart'
import { citedSiteDrill, engineDrill } from '../drills'
import { countNoun } from '../model'
import { fixSearchesDrill, pageFixesDrill, weekChangeDrill, weekDrill } from '../moreDrills'
import { AllHeadline } from './AllHeadline'
import { readsSummaryNumbers, useWidgetMetrics, type WidgetEnv } from './env'
import { engineWords, metricRowsDrill, rowsOf, widgetScope } from './metricDrills'
import { MetricTrend } from './MetricTrend'
import { WidgetCard, WidgetNote } from './WidgetCard'

/**
 * Today's Summary cards as widgets. Under Google AI Overview each shows Summary's own
 * numbers and drills. Under All (owner option A: a question counts once, cited when any
 * engine cites you) and under another engine each reads the shared metrics, the same
 * numbers as Reports.
 */

/** The result words under All: an AI answer on any engine, not an AI Overview. */
const ALL_WORDS: ResultWords = {
  engine: null,
  none: 'No AI answer',
  noneLegend: 'no AI answer',
  noneYet: 'No AI answer yet',
  answered: 'AI answer',
  withAnswer: 'with an AI answer',
  noneTodo: 'Nothing to do: no engine gave an AI answer.'
}
export interface WidgetProps {
  widget: BoardWidget
  env: WidgetEnv
  /** The engine filter control, for the widget's head. */
  tools: ReactNode
}

/** A slim head over a widget that has no card head of its own (the number strips). */
function StripHead({ title, tools }: { title: string; tools: ReactNode }): JSX.Element {
  return (
    <div className="wb-strip-head">
      <h2 className="wb-strip-title">{title}</h2>
      <div className="wb-strip-tools">{tools}</div>
    </div>
  )
}

export function HeadlineWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const { data, engineCounts, engineQuestions, marketLabel } = env
  const engine = widget.engine
  return (
    <div className="wb-strip">
      <StripHead title="Headline numbers" tools={tools} />
      {isAnswerFilter(engine) ? (
        <EngineSummaryKpis
          engine={engine}
          count={engineCounts.find((count) => count.engine === engine)}
          marketLabel={marketLabel}
          drillFor={(set) => engineDrill(data, engineQuestions, engine, set)}
        />
      ) : readsSummaryNumbers(env, engine) ? (
        <OverviewKpis data={data} marketLabel={marketLabel} />
      ) : (
        <AllHeadline env={env} />
      )}
    </div>
  )
}

export function ResultsWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const { data, allFixes, pageFixes } = env
  const fixesDrill = useMemo(
    () => (allFixes === null ? null : pageFixesDrill(allFixes, data)),
    [allFixes, data]
  )
  return (
    <section className="wb-strip ov-verdict" aria-label="Results at a glance">
      <StripHead title="Results at a glance" tools={tools} />
      {readsSummaryNumbers(env, widget.engine) ? (
        <ResultsPanel data={data} pageFixes={pageFixes} fixesDrill={fixesDrill} />
      ) : (
        <EngineResults env={env} engine={widget.engine} fixesDrill={fixesDrill} />
      )}
    </section>
  )
}

/**
 * Where the latest answers on one engine (or, under All, on any engine) ended, each count
 * opening its questions.
 */
function EngineResults({
  env,
  engine,
  fixesDrill
}: {
  env: WidgetEnv
  engine: WidgetEngine
  /** Every page fix to do, which "N page fixes" opens. Null while loading. */
  fixesDrill: ItemDrill | null
}): JSX.Element {
  const metrics = useWidgetMetrics(env, { kind: 'project' }, engine)
  const { register } = useDrill()
  const drills = useMemo(() => {
    const result = metrics.data
    if (result === null) return null
    const scope = widgetScope(env.data, env.marketLabel)
    const words = engineWords(engine)
    const make = (id: string, title: string, ids: readonly string[]): ItemDrill =>
      metricRowsDrill(
        rowsOf(result, ids),
        {
          id: `w:results:${engine}:${id}`,
          title: `${title} ${words}`,
          description:
            engine === 'all'
              ? 'Each question counted once: cited when any engine’s latest answer cites you.'
              : `Questions whose latest answer ${words} ended this way.`
        },
        scope
      )
    return {
      not_cited: make('not_cited', 'Not cited', result.now.notCited.ids),
      other_page: make('other_page', 'Your other page cited', result.now.other.ids),
      target: make('target', 'Right page cited', result.now.target.ids),
      no_overview: make('no_overview', 'No AI answer', result.now.noAnswer.ids),
      work: metricRowsDrill(
        rowsOf(result, [...result.now.notCited.ids, ...result.now.other.ids]),
        {
          id: `w:results:${engine}:work`,
          title: `Questions that need work ${words}`,
          description: `Not cited ${words}, or another page of yours cited instead of the target page.`
        },
        scope
      )
    }
  }, [metrics.data, env.data, env.marketLabel, engine])
  useEffect(() => {
    if (drills !== null) for (const drill of Object.values(drills)) register(drill)
  }, [drills, register])
  if (drills === null) return <WidgetNote loading={metrics.loading} error={metrics.error} />
  const counts: ResultCounts = {
    not_cited: drills.not_cited.items.length,
    other_page: drills.other_page.items.length,
    target: drills.target.items.length,
    no_overview: drills.no_overview.items.length
  }
  const total = counts.not_cited + counts.other_page + counts.target + counts.no_overview
  if (total === 0) return <WidgetNote>No answers {engineWords(engine)} yet.</WidgetNote>
  const words = engine === 'all' ? ALL_WORDS : resultWords(engine)
  return (
    <ResultWordsContext.Provider value={words}>
      <div className="ov-results">
        <ResultBar
          counts={counts}
          size="header"
          label={`${total} ${total === 1 ? 'question' : 'questions'} ${engineWords(engine)}`}
          hrefFor={(key) => drawerHref('drill', { drill: drills[key].id })}
        />
        <p className="ov-results-work">
          Needs work:{' '}
          <DrillNumber
            drill={drills.work}
            className="ov-finding-num"
            label={`${drills.work.items.length} questions need work`}
          />{' '}
          {drills.work.items.length === 1 ? 'question' : 'questions'}
          {drills.work.items.length > 0 && fixesDrill !== null && fixesDrill.items.length > 0 ? (
            <>
              {' '}
              ·{' '}
              <DrillButton
                drill={fixesDrill}
                className="ov-link ov-link-button"
                label={`${fixesDrill.items.length} page ${fixesDrill.items.length === 1 ? 'fix' : 'fixes'}: open them`}
              >
                <span data-nfr-figure={fixesDrill.id}>{fixesDrill.items.length}</span> page{' '}
                {fixesDrill.items.length === 1 ? 'fix' : 'fixes'} →
              </DrillButton>
            </>
          ) : null}
        </p>
      </div>
    </ResultWordsContext.Provider>
  )
}

export function TrendWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const scope = widget.config.scope
  const project = scope === undefined || scope.kind === 'project'
  if (project && readsSummaryNumbers(env, widget.engine)) {
    return <WeeklyTrend env={env} tools={tools} />
  }
  return <MetricTrend widget={widget} env={env} tools={tools} />
}

function WeeklyTrend({ env, tools }: { env: WidgetEnv; tools: ReactNode }): JSX.Element {
  const { data, marks } = env
  const weekDrillFor = useCallback((index: number) => weekDrill(data, data.weeks, index), [data])
  const change = useMemo(() => weekChangeDrill(data, data.weeks), [data])
  return (
    <WeeklyChart
      weeks={data.weeks}
      aio={kpiDrill(data, 'aio')}
      weekDrill={weekDrillFor}
      change={change}
      noun={countNoun(data)}
      events={marks}
      onOpenEvent={openChartEvent}
      tools={tools}
    />
  )
}

export function CitedSitesWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const { data } = env
  if (readsSummaryNumbers(env, widget.engine)) {
    return (
      <CitedSitesPanel
        sites={data.citedSites}
        compared={compareLabel(data)}
        drillFor={(site) => citedSiteDrill(data, site)}
        tools={tools}
      />
    )
  }
  return <EngineSites env={env} engine={widget.engine} tools={tools} />
}

/** The sites one engine cites most, each count opening its questions. */
function EngineSites({
  env,
  engine,
  tools
}: {
  env: WidgetEnv
  engine: WidgetEngine
  tools: ReactNode
}): JSX.Element {
  const metrics = useWidgetMetrics(env, { kind: 'project' }, engine)
  const result = metrics.data
  const rows = useMemo(() => {
    if (result === null) return null
    const scope = widgetScope(env.data, env.marketLabel)
    const words = engineWords(engine)
    return result.domains
      .filter((row) => row.cited.now.n > 0)
      .slice(0, 6)
      .map((row) => ({
        row,
        drill: metricRowsDrill(
          rowsOf(result, row.cited.now.ids),
          {
            id: `w:site:${engine}:${opaqueId(row.domain)}`,
            title: row.own
              ? `Questions where you’re cited ${words}`
              : `Questions citing ${row.domain} ${words}`,
            description: `Questions whose latest answer ${words} cites ${row.own ? env.data.domain : row.domain}.`
          },
          scope
        )
      }))
  }, [result, env.data, env.marketLabel, engine])
  const top = Math.max(1, ...(rows ?? []).map((item) => item.drill.items.length))
  return (
    <WidgetCard title="Who gets cited" tools={tools}>
      {rows === null ? (
        <WidgetNote loading={metrics.loading} error={metrics.error} />
      ) : rows.length === 0 ? (
        <WidgetNote>No answer {engineWords(engine)} cites a site yet.</WidgetNote>
      ) : (
        <ul className="ov-sites" aria-label="Questions citing each site">
          {rows.map(({ row, drill }) => (
            <li key={row.domain} className="ov-site">
              <span className={row.own ? 'ov-site-name ov-own' : 'ov-site-name'}>
                <span title={row.domain}>{row.own ? env.data.brand : row.domain}</span>
              </span>
              <span className="ov-site-bars" aria-hidden="true">
                <BarFill share={drill.items.length / top} tone={row.own ? 'cited' : 'other'} />
              </span>
              <span className="ov-site-count num">
                <DrillNumber
                  drill={drill}
                  label={`${row.domain}: ${drill.items.length} questions`}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  )
}

export function NextFixesWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const { data, allFixes, pageFixes } = env
  const noun = countNoun(data)
  const fixesDrill = useMemo(
    () => (allFixes === null ? null : pageFixesDrill(allFixes, data)),
    [allFixes, data]
  )
  const shown = widget.size === 'm' ? 3 : 6
  return (
    <NextFixesPanel
      fixes={allFixes?.slice(0, shown) ?? null}
      total={pageFixes}
      domain={data.domain}
      allDrill={fixesDrill}
      searchesDrillFor={(fix) => fixSearchesDrill(fix, data, noun)}
      tools={tools}
    />
  )
}

export function ChangesWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const { data, query, setQuery, addHref } = env
  if (!readsSummaryNumbers(env, widget.engine)) {
    return <EngineChanges env={env} engine={widget.engine} tools={tools} />
  }
  const compared = compareLabel(data)
  return (
    <ChangesSection
      questions={data.questions}
      filter={questionFilterFrom(query.change, compared !== null)}
      comparing={compared !== null}
      previous={data.compare.mode === 'previous'}
      addHref={addHref}
      noun={countNoun(data)}
      onFilter={(value: QuestionFilter) => setQuery({ change: value === 'changed' ? null : value })}
      tools={tools}
    />
  )
}

/** Questions gained and lost on one engine since each one's previous check. */
function EngineChanges({
  env,
  engine,
  tools
}: {
  env: WidgetEnv
  engine: WidgetEngine
  tools: ReactNode
}): JSX.Element {
  const metrics = useWidgetMetrics(env, { kind: 'project' }, engine)
  const result = metrics.data
  const drills = useMemo(() => {
    if (result === null || result.comparison === null) return null
    const scope = widgetScope(env.data, env.marketLabel)
    const words = engineWords(engine)
    const { gained, lost } = result.comparison.movement
    return {
      gained: metricRowsDrill(
        rowsOf(result, gained.ids),
        {
          id: `w:changes:${engine}:gained`,
          title: `Questions gained ${words}`,
          description: `Not cited ${words} at the check before, cited now.`
        },
        scope
      ),
      lost: metricRowsDrill(
        rowsOf(result, lost.ids),
        {
          id: `w:changes:${engine}:lost`,
          title: `Questions lost ${words}`,
          description: `Cited ${words} at the check before, not now.`
        },
        scope
      )
    }
  }, [result, env.data, env.marketLabel, engine])
  return (
    <WidgetCard title="Questions that changed" tools={tools}>
      {result === null ? (
        <WidgetNote loading={metrics.loading} error={metrics.error} />
      ) : drills === null ? (
        <WidgetNote>Shows after the next check.</WidgetNote>
      ) : (
        <>
          <p className="wb-line">
            <DrillNumber
              drill={drills.gained}
              suffix=" gained"
              label={`${drills.gained.items.length} gained ${engineWords(engine)}`}
            />
            {' · '}
            <DrillNumber
              drill={drills.lost}
              suffix=" lost"
              label={`${drills.lost.items.length} lost ${engineWords(engine)}`}
            />
          </p>
          {drills.gained.items.length + drills.lost.items.length === 0 ? (
            <WidgetNote>No question moved {engineWords(engine)} since its check before.</WidgetNote>
          ) : null}
          <ul className="wb-list">
            {[
              ...drills.gained.items.map((item) => ({ item, tone: 'gained' as const })),
              ...drills.lost.items.map((item) => ({ item, tone: 'lost' as const }))
            ]
              .slice(0, 8)
              .map(({ item, tone }) => (
                <li key={item.id} className="wb-list-row">
                  <span className="wb-chip" data-tone={tone}>
                    {tone === 'gained' ? 'Gained' : 'Lost'}
                  </span>
                  {item.target && targetHref(item.target) ? (
                    <a
                      className="wb-list-text wb-list-link"
                      href={targetHref(item.target) ?? undefined}
                    >
                      {item.primary}
                    </a>
                  ) : (
                    <span className="wb-list-text">{item.primary}</span>
                  )}
                </li>
              ))}
          </ul>
        </>
      )}
    </WidgetCard>
  )
}
