import { useState, type JSX } from 'react'
import { shapeBlocksChart, type ReviewReport } from '@shared/report/review'
import { Button } from '../../../ui'
import { RankedBarsChart } from '../../../ui/chart/ReportCharts'
import { Fig } from '../Figures'
import { openReportDrill } from '../drill'
import { NumTiles, SimpleTable } from './SourcesSection'

/**
 * Answer shape: what the AI answers are made of, the recurring journeys (the order of
 * blocks) and a collapsible legend. A journey row opens a drawer with its steps, its
 * questions and "Write a page in this order".
 */
export function ShapeSection({ report }: { report: ReviewReport }): JSX.Element {
  const shape = report.answerShape
  if (shape.withText === 0) {
    return (
      <p className="rv-note" data-testid="rv-shape-empty">
        No stored answer text to read for this check yet.
      </p>
    )
  }
  if (shape.analysed.n === 0) {
    return (
      <div className="rv-stack" data-testid="rv-shape-empty">
        <p className="rv-note">
          CiteFox AI has not read these answers yet. <Fig num={shape.waiting} />{' '}
          {shape.waiting.n === 1 ? 'answer waits' : 'answers wait'}; they are read after a check.
        </p>
        <Legend report={report} />
      </div>
    )
  }
  const most = shape.mostCommon
  return (
    <div className="rv-stack" data-testid="rv-shape">
      <NumTiles
        tiles={[
          { label: 'Answers analysed', num: shape.analysed },
          ...(most
            ? [
                {
                  label: `Most common shape (${most.answers.n} ${most.answers.n === 1 ? 'answer' : 'answers'})`,
                  num: most.answers,
                  text: most.label
                }
              ]
            : []),
          ...(shape.waiting.n > 0 ? [{ label: 'Not read yet', num: shape.waiting }] : []),
          ...(shape.changed !== null ? [{ label: 'Changed shape', num: shape.changed }] : [])
        ]}
      />
      <section className="rv-panel" aria-labelledby="rv-shape-made">
        <h3 id="rv-shape-made">What the answers are made of</h3>
        <p className="rv-sub">
          Answers that hold each kind of block. Click a bar for its questions.
        </p>
        <RankedBarsChart {...shapeBlocksChart(report)} onDrill={openReportDrill} />
      </section>
      <section className="rv-panel" aria-labelledby="rv-shape-journeys">
        <h3 id="rv-shape-journeys">Recurring answer journeys</h3>
        <p className="rv-sub">The order the blocks come in, with a page outline.</p>
        <SimpleTable
          label="Recurring answer journeys"
          rows={shape.journeys}
          rowKey={(row) => row.fingerprint}
          cols={[
            {
              head: 'Journey',
              cell: (row) => (
                <button
                  type="button"
                  className="rv-link rv-journey"
                  data-rd={row.answers.drill}
                  onClick={() => openReportDrill(row.answers.drill)}
                >
                  {row.label}
                </button>
              )
            },
            { head: 'Opens with', cell: (row) => row.opensWith },
            { head: 'Answers', right: true, cell: (row) => <Fig num={row.answers} /> }
          ]}
        />
      </section>
      <Legend report={report} />
    </div>
  )
}

function Legend({ report }: { report: ReviewReport }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <section className="rv-panel" aria-labelledby="rv-shape-legend">
      <div className="rv-panel-head">
        <h3 id="rv-shape-legend">What each block means</h3>
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      {open ? (
        <div className="rv-shape-legend">
          {report.answerShape.legend.map((group) => (
            <div key={group.label}>
              <h4 className="rv-h4">{group.label}</h4>
              <ul className="rv-list">
                {group.items.map((item) => (
                  <li key={item.code}>
                    <b>{item.name}</b>: {item.meaning}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
