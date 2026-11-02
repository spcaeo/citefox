import { useMemo, type JSX } from 'react'
import { ENGINE_LABEL, ENGINE_SHORT_LABEL, type EngineId } from '@shared/domain'
import type { MetricRow } from '@shared/metrics'
import { DrillButton, DrillNumber, opaqueId, targetHref, type ItemDrill } from '../../drill'
import { EngineLogo } from '../../engines/EngineLogo'
import { promptHash } from '../../shell/routes'
import { BarFill, UrlText } from '../../ui'
import { useWidgetMetrics } from './env'
import {
  engineWords,
  metricRowsDrill,
  promptIdOf,
  RESULT_WORD,
  rowsOf,
  rowTarget,
  widgetScope
} from './metricDrills'
import type { WidgetProps } from './SummaryWidgets'
import { WidgetCard, WidgetNote } from './WidgetCard'

/**
 * Widgets over the shared metrics (`reports:metrics`), so their numbers match Reports:
 * cited rate, engines side by side, competitor watch and a pinned question. Each follows
 * its own engine filter; every count opens exactly its rows.
 */

const CITED = new Set(['target', 'other'])

function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

export function CitedRateWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const metrics = useWidgetMetrics(env, { kind: 'project' }, widget.engine)
  const result = metrics.data
  const words = engineWords(widget.engine)
  const drills = useMemo(() => {
    if (result === null) return null
    const scope = widgetScope(env.data, env.marketLabel)
    return {
      cited: metricRowsDrill(
        rowsOf(result, result.now.cited.ids),
        {
          id: `w:rate:${widget.engine}:cited`,
          title: `Answers ${words} that cite you`,
          description: `Questions whose latest AI answer ${words} cites a page of yours.`
        },
        scope
      ),
      answered: metricRowsDrill(
        rowsOf(result, result.now.answered.ids),
        {
          id: `w:rate:${widget.engine}:answered`,
          title: `AI answers ${words}`,
          description: `Questions where an AI answer showed ${words} at the latest check.`
        },
        scope
      )
    }
  }, [result, env.data, env.marketLabel, widget.engine, words])
  const before = result?.comparison?.before.rate ?? null
  const after = result?.comparison?.after.rate ?? null
  const change = before === null || after === null ? null : Math.round((after - before) * 100)
  return (
    <WidgetCard title="Cited rate" tools={tools}>
      {result === null || drills === null ? (
        <WidgetNote loading={metrics.loading} error={metrics.error} />
      ) : (
        <div className="wb-stat">
          <p className="wb-stat-value num">{pct(result.now.rate)}</p>
          <p className="wb-stat-line">
            <DrillNumber
              drill={drills.cited}
              label={`${drills.cited.items.length} answers ${words} cite you`}
            />{' '}
            of{' '}
            <DrillNumber
              drill={drills.answered}
              label={`of ${drills.answered.items.length} AI answers ${words}`}
            />{' '}
            answers cite you
          </p>
          {change !== null && change !== 0 ? (
            <p className="wb-delta" data-tone={change > 0 ? 'up' : 'down'}>
              {change > 0 ? '+' : '−'}
              {Math.abs(change)} pts since the check before
            </p>
          ) : null}
        </div>
      )}
    </WidgetCard>
  )
}

export function EnginesWidget({ env, tools }: WidgetProps): JSX.Element {
  const metrics = useWidgetMetrics(env, { kind: 'project' }, 'all')
  const result = metrics.data
  const rows = useMemo(() => {
    if (result === null) return null
    const scope = widgetScope(env.data, env.marketLabel)
    return result.engines.map((row) => {
      const words = engineWords(row.engine)
      return {
        engine: row.engine,
        cited: metricRowsDrill(
          rowsOf(result, row.cited.now.ids),
          {
            id: `w:engines:${row.engine}:cited`,
            title: `Answers ${words} that cite you`,
            description: `Questions whose latest answer ${words} cites a page of yours.`
          },
          scope
        ),
        answered: metricRowsDrill(
          rowsOf(result, row.answered.now.ids),
          {
            id: `w:engines:${row.engine}:answered`,
            title: `AI answers ${words}`,
            description: `Questions where ${ENGINE_LABEL[row.engine]} gave an answer at the latest check.`
          },
          scope
        )
      }
    })
  }, [result, env.data, env.marketLabel])
  return (
    <WidgetCard title="Engines side by side" tools={tools}>
      {rows === null ? (
        <WidgetNote loading={metrics.loading} error={metrics.error} />
      ) : rows.length === 0 ? (
        <WidgetNote>No answers yet.</WidgetNote>
      ) : (
        <ul className="wb-engines" aria-label="Cited on each engine">
          {rows.map((row) => {
            const answered = row.answered.items.length
            const cited = row.cited.items.length
            return (
              <li key={row.engine} className="wb-engine-row">
                <span className="wb-engine-name">
                  <EngineLogo engine={row.engine} size={16} className="eng-filter-logo" />
                  {ENGINE_SHORT_LABEL[row.engine]}
                </span>
                <span className="wb-meter" aria-hidden="true">
                  <BarFill share={answered === 0 ? 0 : cited / answered} tone="cited" />
                </span>
                <span className="wb-engine-count num">
                  <DrillNumber
                    drill={row.cited}
                    label={`${cited} cited on ${ENGINE_SHORT_LABEL[row.engine]}`}
                  />
                  {' of '}
                  <DrillNumber
                    drill={row.answered}
                    label={`of ${answered} answers on ${ENGINE_SHORT_LABEL[row.engine]}`}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}

/** A short list of questions, each opening its question. */
function QuestionLinks({ drill, max }: { drill: ItemDrill; max: number }): JSX.Element | null {
  if (drill.items.length === 0) return null
  return (
    <ul className="wb-list">
      {drill.items.slice(0, max).map((item) => {
        const href = item.target ? targetHref(item.target) : null
        return (
          <li key={item.id} className="wb-list-row">
            {href === null ? (
              <span className="wb-list-text">{item.primary}</span>
            ) : (
              <a className="wb-list-text wb-list-link" href={href}>
                {item.primary}
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function sameSite(host: string, domain: string): boolean {
  const a = host.toLowerCase().replace(/^www\./, '')
  const b = domain.toLowerCase().replace(/^www\./, '')
  return a === b || a.endsWith(`.${b}`)
}

export function CompetitorWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const domain = widget.config.domain ?? null
  const label = widget.config.label ?? domain ?? 'Competitor'
  const metrics = useWidgetMetrics(env, { kind: 'project' }, widget.engine)
  const result = metrics.data
  const words = engineWords(widget.engine)
  const drills = useMemo(() => {
    if (result === null || domain === null) return null
    const scope = widgetScope(env.data, env.marketLabel)
    const rows = rowsOf(result, result.now.checked.ids)
    const theirs = rows.filter((row) => row.domains.some((host) => sameSite(host, domain)))
    const wins = theirs.filter((row) => !CITED.has(row.result))
    const key = opaqueId(domain)
    return {
      cited: metricRowsDrill(
        theirs,
        {
          id: `w:rival:${widget.engine}:${key}:cited`,
          title: `Questions citing ${label} ${words}`,
          description: `Questions whose latest AI answer ${words} cites ${domain}.`
        },
        scope
      ),
      wins: metricRowsDrill(
        wins,
        {
          id: `w:rival:${widget.engine}:${key}:wins`,
          title: `Where ${label} is cited and you’re not ${words}`,
          description: `The answer cites ${domain} and no page of ${env.data.domain}: the questions to win back first.`
        },
        scope
      )
    }
  }, [result, domain, label, env.data, env.marketLabel, widget.engine, words])
  const title = `Competitor watch: ${label}`
  if (domain === null) {
    return (
      <WidgetCard title="Competitor watch" tools={tools}>
        <WidgetNote>Pin a competitor from Competitors.</WidgetNote>
      </WidgetCard>
    )
  }
  return (
    <WidgetCard title={title} tools={tools}>
      {drills === null ? (
        <WidgetNote loading={metrics.loading} error={metrics.error} />
      ) : (
        <>
          <p className="wb-line">
            Cited in{' '}
            <DrillNumber
              drill={drills.cited}
              suffix={drills.cited.items.length === 1 ? ' question' : ' questions'}
              label={`${drills.cited.items.length} questions cite ${label}`}
            />
            {' · '}
            <DrillNumber
              drill={drills.wins}
              suffix=" without you"
              label={`${drills.wins.items.length} without you: ${label} cited and you’re not`}
            />
          </p>
          {drills.wins.items.length > 0 ? (
            <>
              <p className="wb-sub">Where they win and you don’t</p>
              <QuestionLinks drill={drills.wins} max={widget.size === 'l' ? 8 : 3} />
            </>
          ) : (
            <WidgetNote>You’re cited wherever {label} is.</WidgetNote>
          )}
        </>
      )}
    </WidgetCard>
  )
}

/** The question's rows: one per engine (an All row stands for its engines' rows). */
function questionRows(
  result: {
    rows: Readonly<Record<string, MetricRow>>
    now: { checked: { ids: readonly string[] } }
  },
  pageId: string,
  promptId: string
): MetricRow[] {
  const all = rowsOf(result, result.now.checked.ids)
  const match = all.find(
    (row) =>
      row.sourceId === pageId &&
      (promptIdOf(row) === promptId || row.questionId === `${pageId}|${promptId}`)
  )
  if (match === undefined) return []
  const same = all.filter((row) => row.questionId === match.questionId)
  return same.flatMap((row) => (row.parts ? rowsOf(result, row.parts) : [row]))
}

export function QuestionWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const { pageId, promptId } = widget.config
  const metrics = useWidgetMetrics(env, { kind: 'project' }, widget.engine)
  const result = metrics.data
  const rows = useMemo(
    () =>
      result === null || pageId === undefined || promptId === undefined
        ? null
        : questionRows(result, pageId, promptId),
    [result, pageId, promptId]
  )
  const sites = useMemo<ItemDrill | null>(() => {
    if (rows === null) return null
    const hosts = [...new Set(rows.flatMap((row) => row.domains))]
    return {
      kind: 'items',
      id: `w:question:${opaqueId(`${pageId}|${promptId}`)}:${widget.engine}:sites`,
      title: 'Sites this answer cites',
      description: `The other sites the latest answer ${engineWords(widget.engine)} cites, each once.`,
      noun: ['site', 'sites'],
      primaryLabel: 'Site',
      items: hosts.map((host) => ({
        id: host,
        primary: host,
        mono: true,
        url: `https://${host}`,
        target: { kind: 'url', url: `https://${host}` }
      })),
      scope: widgetScope(env.data, env.marketLabel)
    }
  }, [rows, pageId, promptId, widget.engine, env.data, env.marketLabel])
  const text = rows?.[0]?.text ?? widget.config.label ?? 'A pinned question'
  const href =
    pageId !== undefined && promptId !== undefined && rows?.[0]?.sourceKind !== 'topic'
      ? promptHash(pageId, promptId)
      : rows?.[0]
        ? targetHref(rowTarget(rows[0]) ?? { kind: 'hash', hash: '#/overview' })
        : null
  return (
    <WidgetCard title="Pinned question" tools={tools}>
      {rows === null ? (
        <WidgetNote loading={metrics.loading} error={metrics.error}>
          Pin a question from its page to watch it here.
        </WidgetNote>
      ) : (
        <>
          <p className="wb-question">
            {href ? (
              <a className="wb-list-link" href={href}>
                {text}
              </a>
            ) : (
              text
            )}
          </p>
          {rows.length === 0 ? (
            <WidgetNote>Not checked {engineWords(widget.engine)} yet.</WidgetNote>
          ) : (
            <ul className="wb-engines">
              {rows.map((row) => (
                <li key={row.id} className="wb-answer-row">
                  <span className="wb-engine-name">
                    {row.engine === 'all' ? null : (
                      <EngineLogo
                        engine={row.engine as EngineId}
                        size={16}
                        className="eng-filter-logo"
                      />
                    )}
                    {row.engine === 'all' ? 'All' : ENGINE_SHORT_LABEL[row.engine as EngineId]}
                  </span>
                  <span
                    className="wb-chip"
                    data-tone={
                      CITED.has(row.result)
                        ? 'gained'
                        : row.result === 'not_cited'
                          ? 'lost'
                          : 'none'
                    }
                  >
                    {RESULT_WORD[row.result]}
                  </span>
                  {row.citedUrl ? (
                    <span className="wb-answer-url">
                      <UrlText url={row.citedUrl} site={env.data.domain} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {sites !== null && sites.items.length > 0 ? (
            <p className="wb-line">
              Cites{' '}
              <DrillButton
                drill={sites}
                className="drill-num"
                label={`${sites.items.length} other sites: open them`}
              >
                <span data-nfr-figure={sites.id}>{sites.items.length}</span>
              </DrillButton>{' '}
              other {sites.items.length === 1 ? 'site' : 'sites'}
            </p>
          ) : null}
        </>
      )}
    </WidgetCard>
  )
}
