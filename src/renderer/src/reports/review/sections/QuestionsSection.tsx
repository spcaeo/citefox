import { useMemo, type JSX } from 'react'
import { historyLegendWords } from '@shared/charts'
import { NOT_COMPARED_CHIP, type ReviewReport } from '@shared/report/review'
import { SearchBox } from '../../../ui'
import { knownPagesOf } from '../drawerModel'
import { QuestionList } from '../QuestionList'
import { Chips } from './ListSections'

/**
 * Every question: change chips (with "Not compared" for questions not measured at both
 * ends), a topic filter and a search, then the sortable table with the target page,
 * funnel, intent, results, position before → now and the page cited.
 */
export function QuestionsSection({
  report,
  chip,
  onChip,
  search,
  onSearch,
  topic,
  onTopic
}: {
  report: ReviewReport
  chip: string
  onChip: (chip: string) => void
  search: string
  onSearch: (value: string) => void
  topic: string
  onTopic: (value: string) => void
}): JSX.Element {
  const words = search.trim().toLowerCase()
  const topics = useMemo(
    () =>
      [...new Set(report.questions.rows.map((row) => row.topic))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [report]
  )
  const known = useMemo(() => knownPagesOf(report), [report])
  const pickedTopic = topics.includes(topic) ? topic : ''
  const rows = report.questions.rows.filter(
    (row) =>
      (chip === 'all' ||
        (chip === NOT_COMPARED_CHIP ? row.change === null : row.change === chip)) &&
      (pickedTopic === '' || row.topic === pickedTopic) &&
      (words === '' || `${row.text} ${row.topic}`.toLowerCase().includes(words))
  )
  return (
    <section className="rv-panel" aria-labelledby="rv-q-title">
      <h3 id="rv-q-title">Every question</h3>
      <p className="rv-sub">
        {report.questions.rows.length} questions
        {report.fromLabel !== null
          ? `, checked on ${report.fromLabel} and ${report.toLabel}`
          : `, checked on ${report.toLabel}`}
        . Click a row for its answers on each engine, or a page for its questions.
      </p>
      <div className="rv-toolbar">
        <Chips chips={report.questions.chips} value={chip} onChange={onChip} label="Change" />
        <div className="rv-toolbar-right">
          {topics.length > 1 ? (
            <label className="ui-head-field">
              <span className="ui-head-field-label">Topic</span>
              <select
                className="select"
                value={pickedTopic}
                onChange={(event) => onTopic(event.target.value)}
              >
                <option value="">Every topic</option>
                {topics.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <SearchBox label="Find a question" value={search} onChange={onSearch} />
        </div>
      </div>
      <QuestionList
        rows={rows}
        fromLabel={report.fromLabel}
        toLabel={report.toLabel}
        label="Every question"
        options={{ targets: true, funnel: true, knownPages: known, sortKey: 'qsort' }}
      />
    </section>
  )
}

/** The history strip's legend: every state a square can show. */
export function HistoryLegend(): JSX.Element {
  return (
    <div className="rv-legend-line" data-testid="rv-history-legend">
      {historyLegendWords().map((item) => (
        <span key={item.state}>
          <i className={`rv-sw rv-sw-${item.state}`} aria-hidden="true" />
          {item.words}
        </span>
      ))}
    </div>
  )
}
