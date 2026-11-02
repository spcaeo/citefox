import type { JSX } from 'react'
import {
  historyChart,
  MOVEMENT_LABELS,
  VERDICT_WAIT_DAYS,
  type Chip,
  type ReviewReport,
  type Tile
} from '@shared/report/review'
import { HistoryStripChart } from '../../../ui/chart/ReportCharts'
import { ReportPage, ReportText } from '../copyCells'
import { Fig } from '../Figures'
import { openReportDetail, openReportDrill, questionDetail } from '../drill'
import { CoveragePanel, MoveLists, SentimentCard, WaitingPanel } from './ChangedParts'
import { DaysTable, KindTable, PublishedTable } from './PublishedExtras'
import { HistoryLegend } from './QuestionsSection'

/** A number reads big; a word or name (a topic, a site) reads at body size. */
function tileValueClass(value: string | number): string {
  return /^[\d.,%+−\-—#→\s]*$/.test(String(value)) ? 'num' : 'num rv-tile-text'
}

/** Tiles that open their list; a tile with a chip filters the table below instead. */
export function Tiles({
  tiles,
  onChip
}: {
  tiles: readonly Tile[]
  onChip?: (chip: string) => void
}): JSX.Element {
  return (
    <div className={`rv-tiles rv-tiles-${Math.min(tiles.length, 6)}`}>
      {tiles.map((tile) =>
        tile.drill === null ? (
          <div key={tile.label} className="rv-tile">
            <b className={tileValueClass(tile.value)}>{tile.value}</b>
            <small>{tile.label}</small>
          </div>
        ) : (
          <button
            key={tile.label}
            type="button"
            className={`rv-tile rv-tile-${tile.tone ?? 'neutral'}`}
            data-rd={tile.drill}
            onClick={() => {
              if (tile.chip !== undefined && onChip) onChip(tile.chip)
              openReportDrill(tile.drill as string)
            }}
          >
            <b className={tileValueClass(tile.value)}>{tile.value}</b>
            <small>{tile.label}</small>
          </button>
        )
      )}
    </div>
  )
}

export function Chips({
  chips,
  value,
  onChange,
  label
}: {
  chips: readonly Chip[]
  value: string
  onChange: (id: string) => void
  label: string
}): JSX.Element {
  return (
    <div className="rv-chips" role="group" aria-label={label}>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          aria-pressed={chip.id === value}
          className={chip.id === value ? 'on' : undefined}
          onClick={() => onChange(chip.id)}
        >
          {chip.label}
          <em className="num">{chip.count}</em>
        </button>
      ))}
    </div>
  )
}

export function PublishedSection({
  report,
  chip,
  onChip
}: {
  report: ReviewReport
  chip: string
  onChip: (chip: string) => void
}): JSX.Element {
  const { published } = report
  const rows =
    chip === 'all'
      ? published.rows
      : chip === 'new' || chip === 'rewrite'
        ? published.rows.filter((row) => row.kind === chip)
        : published.rows.filter((row) => row.status === chip)
  const kindChips = (['new', 'rewrite'] as const).flatMap((kind) => {
    const count = published.rows.filter((row) => row.kind === kind).length
    return count === 0 ? [] : [{ id: kind, label: kind === 'new' ? 'New' : 'Rewrites', count }]
  })
  return (
    <div className="rv-stack">
      <Tiles tiles={published.tiles} />
      <p className="rv-note">
        <b>The {VERDICT_WAIT_DAYS}-day rule.</b> AI answers take time to pick up a page. Pages live
        under {VERDICT_WAIT_DAYS} days are shown but not judged yet.
      </p>
      <div className="rv-grid2">
        <KindTable report={report} />
        <DaysTable report={report} />
      </div>
      <section className="rv-panel" aria-labelledby="rv-pub-title">
        <h3 id="rv-pub-title">Every published page</h3>
        <p className="rv-sub">Click a page for its before and after. Click a heading to sort.</p>
        <div className="rv-toolbar">
          <Chips
            chips={[...published.chips, ...kindChips]}
            value={chip}
            onChange={onChip}
            label="Page status"
          />
        </div>
        <PublishedTable report={report} rows={rows} label="Every published page" />
      </section>
    </div>
  )
}

export function ChangedSection({ report }: { report: ReviewReport }): JSX.Element {
  const { changed } = report
  if (report.kind === 'changed') {
    // What changed: one panel until there is a second check; then the 4 movement lists.
    if (report.whatChanged.waiting !== null) return <WaitingPanel report={report} />
    return (
      <div className="rv-stack">
        <Tiles tiles={[...changed.tiles, ...report.named.tiles]} />
        <p className="rv-note">
          <b>The net hides movement.</b> {changed.net >= 0 ? '+' : '−'}
          {Math.abs(changed.net)} looks simple, but {changed.moved} questions moved to make it.
        </p>
        <MoveLists report={report} />
        <SentimentCard report={report} />
        <CoveragePanel report={report} />
      </div>
    )
  }
  return (
    <div className="rv-stack">
      <Tiles tiles={changed.tiles} />
      {report.comparing ? (
        <p className="rv-note">
          <b>The net hides movement.</b> {changed.net >= 0 ? '+' : '−'}
          {Math.abs(changed.net)} looks simple, but {changed.moved} questions moved to make it.{' '}
          <Fig num={changed.compared} /> questions were checked at both ends
          {changed.excluded.n > 0 ? (
            <>
              ; <Fig num={changed.excluded} /> could not be compared (new, removed or failed)
            </>
          ) : null}
          .
        </p>
      ) : (
        <p className="rv-note">Pick an earlier check in From to see what moved.</p>
      )}
      <section className="rv-panel" aria-labelledby="rv-moved-title">
        <h3 id="rv-moved-title">Every question that moved</h3>
        <p className="rv-sub">
          One square per check{changed.dates.length > 0 ? `: ${changed.dates.join(', ')}` : ''}.
          Click a row for its answers.
        </p>
        <HistoryLegend />
        {changed.movers.length === 0 ? (
          <p className="rv-muted">No question moved between these checks.</p>
        ) : (
          <div className="rv-tbl">
            <table aria-label="Every question that moved">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Topic</th>
                  <th>History</th>
                  <th>Your page</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {changed.movers.map((mover) => (
                  <tr
                    key={mover.question.id}
                    className="rv-click"
                    data-row={mover.question.id}
                    tabIndex={0}
                    onClick={() => openReportDetail(questionDetail(mover.question.id))}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter') openReportDetail(questionDetail(mover.question.id))
                    }}
                  >
                    <td className="rv-q">
                      <ReportText text={mover.question.text} inRow />
                    </td>
                    <td className="rv-muted">{mover.question.topic}</td>
                    <td>
                      <HistoryStripChart {...historyChart(mover)} />
                    </td>
                    <td>
                      {mover.question.page === null ? (
                        '—'
                      ) : (
                        <ReportPage url={mover.question.page} />
                      )}
                    </td>
                    <td>
                      <span
                        className={`rv-pill rv-pill-${mover.question.change === 'gained' ? 'up' : 'down'}`}
                      >
                        {MOVEMENT_LABELS[mover.question.change ?? 'lost']}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
