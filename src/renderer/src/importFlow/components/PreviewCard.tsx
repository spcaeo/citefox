import type { JSX, ReactNode } from 'react'
import { TOPIC_STAGES, TOPIC_STAGE_LABEL, type TopicStage } from '@shared/domain'
import { IMPORT_RESULTS, type ImportPreview, type ImportRow } from '@shared/ipc'
import { IMPORT_FIELDS, type ImportEntity } from '@shared/import-fields'
import { Chip, MenuButton, UrlText } from '../../ui'
import { andList, filterRows, RESULT_LABEL, resultPill, type ImportFilter } from '../model'

export interface PreviewCardProps {
  entity: ImportEntity
  preview: ImportPreview | null
  checking: boolean
  filter: ImportFilter
  /** Rows drawn; the rest are counted. */
  limit: number
  /** "first 8 of 112 · every row is checked" (match step) or the full list (check step). */
  title: string
  marketLabel: (id: string) => string
  /** The project's site: paths open on it. */
  site: string | null
  defaultMarket: string | null
  busy: boolean
  onFilter: (filter: ImportFilter) => void
  onAddMarkets: (codes: readonly string[]) => void
  onDropMarketColumn: () => void
  onStageWord: (key: string, stage: TopicStage | null) => void
}

const COLUMN_LIMIT = 4

/** "Preview" / "Check rows": the result chips (counts you can click) and the rows. */
export function PreviewCard({
  entity,
  preview,
  checking,
  filter,
  limit,
  title,
  marketLabel,
  site,
  defaultMarket,
  busy,
  onFilter,
  onAddMarkets,
  onDropMarketColumn,
  onStageWord
}: PreviewCardProps): JSX.Element {
  const rows = preview === null ? [] : filterRows(preview.rows, filter)
  const fields = previewFields(entity, preview)
  const shown = rows.slice(0, limit)
  const unknownStages = (preview?.stageWords ?? []).filter((word) => word.stage === null)
  return (
    <section
      className="ifl-card ifl-preview"
      aria-labelledby="ifl-preview-title"
      aria-busy={checking}
    >
      <header className="ifl-card-head">
        <h3 id="ifl-preview-title">Preview</h3>
        <span className="ifl-hint">{preview === null ? 'Checking every row…' : title}</span>
      </header>
      <div className="ifl-chips" role="group" aria-label="Show rows by result">
        <FilterChip
          on={filter === 'all'}
          label="All"
          count={preview?.counts.total ?? 0}
          onClick={() => onFilter('all')}
        />
        {IMPORT_RESULTS.map((result) => (
          <FilterChip
            key={result}
            result={result}
            on={filter === result}
            label={RESULT_LABEL[result]}
            count={preview?.counts[result] ?? 0}
            onClick={() => onFilter(result)}
          />
        ))}
      </div>
      <div className="ifl-table-wrap">
        <table className="ifl-table" data-testid="import-rows">
          <thead>
            <tr>
              <th scope="col" className="ifl-c-row">
                Row
              </th>
              {fields.map((field) => (
                <th key={field.id} scope="col" className={`ifl-c-${field.id}`}>
                  {field.id === 'page' ? 'Page' : field.label}
                </th>
              ))}
              <th scope="col" className="ifl-c-result">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const pill = resultPill(row)
              return (
                <tr key={row.row} className={rowClass(row)} title={row.reason ?? undefined}>
                  <td className="num ifl-c-row">{row.row}</td>
                  {fields.map((field) => (
                    <td key={field.id} className={`ifl-c-${field.id}`}>
                      {cell(row, field.id, marketLabel, site)}
                    </td>
                  ))}
                  <td className="ifl-c-result">
                    <Chip tone={pill.tone} size="sm">
                      {pill.label}
                    </Chip>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length > shown.length ? (
          <p className="ifl-hint ifl-more">
            Showing {shown.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')}{' '}
            rows. Every row is checked; the counts above are all of them.
          </p>
        ) : null}
        {preview !== null && rows.length === 0 ? (
          <p className="ifl-hint ifl-more">No rows with this result.</p>
        ) : null}
      </div>
      <Fixes>
        {preview && preview.unknownMarkets.length > 0 ? (
          <p>
            {preview.unknownMarkets.length === 1 ? 'Market ' : 'Markets '}
            <strong>{andList(preview.unknownMarkets)}</strong>{' '}
            {preview.unknownMarkets.length === 1 ? 'isn’t' : 'aren’t'} set up for this project.{' '}
            <button
              type="button"
              className="ifl-link"
              disabled={busy}
              onClick={() => onAddMarkets(preview.unknownMarkets)}
            >
              Add {preview.unknownMarkets.length === 1 ? 'it' : 'them'}
            </button>{' '}
            or{' '}
            <button type="button" className="ifl-link" disabled={busy} onClick={onDropMarketColumn}>
              import those rows as{' '}
              {defaultMarket === null ? 'the default market' : marketLabel(defaultMarket)}
            </button>
          </p>
        ) : null}
        {unknownStages.length > 0 ? (
          <p>
            {unknownStages.map((word) => (
              <span key={word.key} className="ifl-fix-stage">
                “{word.word}” ({word.rows} {word.rows === 1 ? 'row' : 'rows'}) means{' '}
                <MenuButton
                  label={`Stage for “${word.word}”`}
                  align="start"
                  items={TOPIC_STAGES.map((stage) => ({
                    id: stage,
                    label: TOPIC_STAGE_LABEL[stage],
                    onSelect: () => onStageWord(word.key, stage)
                  }))}
                  trigger={(props) => (
                    <button type="button" className="ifl-link" {...props}>
                      pick a stage
                    </button>
                  )}
                />
              </span>
            ))}
          </p>
        ) : null}
      </Fixes>
    </section>
  )
}

/**
 * The columns drawn: the entity's first four, and for questions the Topic column
 * too when any row names a topic (W3I-C3), so the rows show where they go.
 */
function previewFields(
  entity: ImportEntity,
  preview: ImportPreview | null
): readonly (typeof IMPORT_FIELDS)[ImportEntity][number][] {
  const first = IMPORT_FIELDS[entity].slice(0, COLUMN_LIMIT)
  if (entity !== 'questions') return first
  const topic = IMPORT_FIELDS.questions.find((field) => field.id === 'topic')
  const named = (preview?.rows ?? []).some((row) => (row.values.topic ?? '').trim().length > 0)
  return named && topic !== undefined && !first.includes(topic) ? [...first, topic] : first
}

function Fixes({ children }: { children: ReactNode }): JSX.Element | null {
  const list = (Array.isArray(children) ? children : [children]).filter(Boolean)
  return list.length === 0 ? null : <div className="ifl-fixes">{list}</div>
}

function FilterChip({
  on,
  label,
  count,
  result,
  onClick
}: {
  on: boolean
  label: string
  count: number
  result?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={['ifl-chip', on ? 'on' : '', result ? `ifl-chip-${result}` : '']
        .filter(Boolean)
        .join(' ')}
      aria-pressed={on}
      onClick={onClick}
    >
      <span>{label}</span>
      <b className="num">{count.toLocaleString('en-US')}</b>
    </button>
  )
}

function rowClass(row: ImportRow): string | undefined {
  if (row.result === 'fix') return 'ifl-row-bad'
  if (row.result === 'duplicate') return 'ifl-row-dup'
  return undefined
}

function cell(
  row: ImportRow,
  field: string,
  marketLabel: (id: string) => string,
  site: string | null
): ReactNode {
  const values = row.values
  if (field === 'stage') {
    if (values.stageRaw) return <span className="ifl-raw">“{values.stageRaw}”</span>
    const stage = values.stage as TopicStage | undefined
    return stage && stage in TOPIC_STAGE_LABEL ? TOPIC_STAGE_LABEL[stage] : '—'
  }
  if (field === 'market') {
    if (values.marketRaw) return <span className="ifl-raw">{values.marketRaw}</span>
    return values.market ? marketLabel(values.market) : '—'
  }
  if (field === 'page' || field === 'url') {
    const value = values[field] ?? ''
    if (!value) return '—'
    return /^https?:\/\//iu.test(value) ? (
      <UrlText url={value} label={pathOf(value)} icon={false} />
    ) : (
      <UrlText path={value} siteBase={site} icon={false} />
    )
  }
  if (field === 'domain' && values.domain) return <UrlText domain={values.domain} icon={false} />
  if (field === 'topic') {
    const topic = (values.topic ?? '').trim()
    if (!topic) return <span className="ifl-empty">The picked one</span>
    return row.fix === 'topic' || values.createTopic === '1' ? (
      <>
        {topic} <span className="ifl-raw">(new)</span>
      </>
    ) : (
      topic
    )
  }
  const value = values[field] ?? ''
  if (value.length === 0) return <span className="ifl-empty">(empty)</span>
  return value
}

function pathOf(value: string): string {
  try {
    const url = new URL(value)
    return `${url.pathname}${url.search}`
  } catch {
    return value
  }
}
