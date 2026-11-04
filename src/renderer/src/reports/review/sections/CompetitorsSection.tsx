import type { JSX } from 'react'
import type { ReportTable } from '@shared/ipc'
import {
  moversChart,
  rankedChart,
  sovChart,
  type ReviewReport,
  type SiteRow
} from '@shared/report/review'
import { ToolButton, UrlText } from '../../../ui'
import { useQuerySortChoice } from '../../../utils/queryState'
import { DonutChart, GainersLosersChart, RankedBarsChart } from '../../../ui/chart/ReportCharts'
import { ReportSite } from '../copyCells'
import { Change, Fig } from '../Figures'
import { openReportDetail, openReportDrill, siteDetail } from '../drill'
import { PositionCell } from '../QuestionList'
import { Chips, Tiles } from './ListSections'

type SortKey =
  'rank' | 'domain' | 'kind' | 'before' | 'now' | 'change' | 'withYou' | 'gap' | 'position'

const SORT_KEYS: readonly SortKey[] = [
  'rank',
  'domain',
  'kind',
  'before',
  'now',
  'change',
  'withYou',
  'gap',
  'position'
]

const DEFAULT_SORT = { key: 'rank', down: false } as const

function sortValue(site: SiteRow, key: SortKey): string | number {
  switch (key) {
    case 'rank':
      return site.rank
    case 'domain':
      return site.domain
    case 'kind':
      return site.kindLabel
    case 'before':
      return site.before?.n ?? -1
    case 'now':
      return site.now.n
    case 'change':
      return site.change ?? 0
    case 'withYou':
      return site.withYou?.n ?? -1
    case 'gap':
      return site.gap?.n ?? -1
    case 'position':
      return site.positionNow ?? 99
  }
}

/**
 * The Competitors tab of every ready report: five tiles, share of voice, the kinds of
 * site, who gained and lost ground, the ranked bars and every cited site in a sortable
 * table with a kind filter. Every number opens its questions.
 */
export function CompetitorsSection({
  report,
  kind,
  onKind,
  onCsv
}: {
  report: ReviewReport
  kind: string
  onKind: (kind: string) => void
  onCsv: (table: ReportTable) => void
}): JSX.Element {
  const c = report.competition
  // The sort is `?csort=<column>:<asc|desc>`; the default order has none.
  const [urlSort, pickSort] = useQuerySortChoice('csort', SORT_KEYS)
  const sort: { key: SortKey; down: boolean } = urlSort ?? DEFAULT_SORT
  const setSort = (next: { key: SortKey; down: boolean }): void =>
    pickSort(next.key === DEFAULT_SORT.key && !next.down ? null : next)
  if (c.tiles.length === 0) {
    return (
      <p className="rv-note">
        No other site is cited in these AI answers yet. Run a check with AI answers to see who you
        compete with.
      </p>
    )
  }
  const comparing = report.fromLabel !== null
  const chips = [
    { id: 'all', label: 'All', count: c.sites.length },
    ...c.kinds.map((row) => ({ id: row.kind, label: row.label, count: row.sites }))
  ]
  const picked = chips.some((chip) => chip.id === kind) ? kind : 'all'
  const rows = c.sites
    .filter((site) => picked === 'all' || site.kind === picked || site.own)
    .sort((a, b) => {
      const left = sortValue(a, sort.key)
      const right = sortValue(b, sort.key)
      const order = left < right ? -1 : left > right ? 1 : 0
      return sort.down ? -order : order
    })
  const head = (key: SortKey, text: string, right = false): JSX.Element => {
    const on = sort.key === key
    return (
      <th
        className={right ? 'rv-r' : undefined}
        aria-sort={on ? (sort.down ? 'descending' : 'ascending') : undefined}
      >
        <button
          type="button"
          className="rv-sort"
          onClick={() =>
            setSort(
              on
                ? { key, down: !sort.down }
                : {
                    key,
                    down: key !== 'rank' && key !== 'domain' && key !== 'kind' && key !== 'position'
                  }
            )
          }
        >
          {text}
          <span aria-hidden="true">{on ? (sort.down ? ' ▼' : ' ▲') : ''}</span>
        </button>
      </th>
    )
  }
  return (
    <div className="rv-stack">
      <Tiles tiles={c.tiles} />
      <div className="rv-grid2">
        {c.sov !== null ? (
          <section className="rv-panel" aria-labelledby="rv-sov-title">
            <h3 id="rv-sov-title">Share of voice</h3>
            <p className="rv-sub">Who wins each AI answer on {report.toLabel}.</p>
            <DonutChart {...sovChart(report)} onDrill={openReportDrill} />
          </section>
        ) : null}
        <section className="rv-panel" aria-labelledby="rv-kinds-title">
          <div className="rv-panel-head">
            <div>
              <h3 id="rv-kinds-title">Who else the AI answers cite</h3>
              <p className="rv-sub">Click a kind to show only those sites below.</p>
            </div>
            <ToolButton kind="csv" onClick={() => onCsv('sitekinds')} />
          </div>
          <div className="rv-tbl">
            <table aria-label="Who else the AI answers cite">
              <thead>
                <tr>
                  <th>Kind of site</th>
                  <th className="rv-r">Sites</th>
                  {comparing ? <th className="rv-r">{report.fromLabel}</th> : null}
                  <th className="rv-r">{report.toLabel}</th>
                  {comparing ? <th className="rv-r">Change</th> : null}
                </tr>
              </thead>
              <tbody>
                {c.kinds.map((row) => (
                  <tr key={row.kind} className={picked === row.kind ? 'rv-on' : undefined}>
                    <td>
                      <button
                        type="button"
                        className="rv-link"
                        aria-pressed={picked === row.kind}
                        onClick={() => onKind(picked === row.kind ? 'all' : row.kind)}
                      >
                        {row.label}
                      </button>
                    </td>
                    <td className="rv-r num">{row.sites}</td>
                    {comparing ? <td className="rv-r num">{row.before ?? '—'}</td> : null}
                    <td className="rv-r num">
                      <Fig num={row.questions} label={row.label}>
                        {row.now}
                      </Fig>
                    </td>
                    {comparing ? (
                      <td className="rv-r">
                        <Change value={row.change} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {report.comparing ? (
        <section className="rv-panel" aria-labelledby="rv-movers-title">
          <h3 id="rv-movers-title">Gained and lost ground</h3>
          <p className="rv-sub">
            Sites cited on more or fewer questions than on {report.fromLabel}.
          </p>
          <GainersLosersChart {...moversChart(report)} onDrill={openReportDrill} />
        </section>
      ) : null}
      <section className="rv-panel" aria-labelledby="rv-ranked-title">
        <h3 id="rv-ranked-title">Most cited sites, {report.toLabel}</h3>
        <p className="rv-sub">
          Questions citing each site.
          {report.comparing ? ` Faint: ${report.fromLabel}.` : ''}
        </p>
        <RankedBarsChart {...rankedChart(report)} onDrill={openReportDrill} />
      </section>
      <section className="rv-panel" aria-labelledby="rv-sites-title">
        <div className="rv-panel-head">
          <div>
            <h3 id="rv-sites-title">Every cited site</h3>
            <p className="rv-sub">Gap: an answer cites them, not you.</p>
          </div>
          <ToolButton kind="csv" onClick={() => onCsv('competitors')} />
        </div>
        <Chips chips={chips} value={picked} onChange={onKind} label="Kind of site" />
        <div className="rv-tbl">
          <table aria-label="Every cited site">
            <thead>
              <tr>
                {head('rank', '#')}
                {head('domain', 'Site')}
                {head('kind', 'Kind')}
                {comparing ? head('before', report.fromLabel ?? 'Before', true) : null}
                {head('now', report.toLabel, true)}
                {comparing ? head('change', 'Change', true) : null}
                {head('withYou', 'With you', true)}
                {head('gap', 'Gap', true)}
                {head('position', comparing ? 'Avg position before → now' : 'Avg position')}
              </tr>
            </thead>
            <tbody>
              {rows.map((site) => (
                <tr
                  key={site.domain}
                  data-site={site.domain}
                  className={site.own ? 'rv-own' : undefined}
                >
                  <td className="rv-n num">{site.rank}</td>
                  <td>
                    {site.own ? (
                      <ReportSite domain={site.domain} own you />
                    ) : (
                      <UrlText domain={site.domain}>
                        <button
                          type="button"
                          className="rv-link"
                          onClick={() => openReportDetail(siteDetail(site.domain))}
                        >
                          {site.domain}
                        </button>
                      </UrlText>
                    )}
                  </td>
                  <td className="rv-muted">{site.kindLabel}</td>
                  {comparing ? (
                    <td className="rv-r">
                      {site.before === null ? '—' : <Fig num={site.before} />}
                    </td>
                  ) : null}
                  <td className="rv-r">
                    <Fig num={site.now} />
                  </td>
                  {comparing ? (
                    <td className="rv-r">
                      <Change value={site.change} />
                    </td>
                  ) : null}
                  <td className="rv-r">
                    {site.withYou === null ? '—' : <Fig num={site.withYou} />}
                  </td>
                  <td className="rv-r">{site.gap === null ? '—' : <Fig num={site.gap} />}</td>
                  <td>
                    <PositionCell
                      before={site.positionBefore}
                      now={site.positionNow}
                      comparing={comparing}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
