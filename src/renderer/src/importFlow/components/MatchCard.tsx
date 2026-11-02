import type { JSX } from 'react'
import { TOPIC_STAGES, TOPIC_STAGE_LABEL, type TopicStage } from '@shared/domain'
import type { ImportPreview, ImportReadResult } from '@shared/ipc'
import { IMPORT_FIELDS, type ImportEntity } from '@shared/import-fields'
import { MenuButton } from '../../ui'

export interface PageChoice {
  /** The URL or path rows get. */
  value: string
  label: string
}

export interface MatchCardProps {
  entity: ImportEntity
  read: ImportReadResult
  mapping: readonly (string | null)[]
  preview: ImportPreview | null
  stageWords: Readonly<Record<string, TopicStage | null>>
  pages: readonly PageChoice[]
  defaultPage: string | null
  usePageDefault: boolean
  saveMapping: boolean
  onMap: (column: number, field: string | null) => void
  onStageWord: (key: string, stage: TopicStage | null) => void
  onDefaultPage: (page: string | null) => void
  onUsePageDefault: (on: boolean) => void
  onSaveMapping: (on: boolean) => void
}

/**
 * "Match your columns": each file column → a CiteFox column (guessed or saved),
 * the stage words found and what they mean (each one changeable), and the options
 * for rows without a page and for remembering the match.
 */
export function MatchCard({
  entity,
  read,
  mapping,
  preview,
  stageWords,
  pages,
  defaultPage,
  usePageDefault,
  saveMapping,
  onMap,
  onStageWord,
  onDefaultPage,
  onUsePageDefault,
  onSaveMapping
}: MatchCardProps): JSX.Element {
  const fields = IMPORT_FIELDS[entity]
  const matched = mapping.filter((field) => field !== null).length
  const words = preview?.stageWords ?? []
  const hasPage = fields.some((field) => field.id === 'page')
  return (
    <section className="ifl-card ifl-match" aria-labelledby="ifl-match-title">
      <header className="ifl-card-head">
        <h3 id="ifl-match-title">Match your columns</h3>
        <span className="ifl-hint">
          {read.mappingSaved
            ? 'Saved match for files like this'
            : `${matched} of ${read.columns.length} matched for you`}
        </span>
      </header>
      <div className="ifl-map">
        <span className="ifl-map-head">In your file</span>
        <span aria-hidden="true" />
        <span className="ifl-map-head">In CiteFox</span>
        {read.columns.map((column) => {
          const field = mapping[column.index] ?? null
          const name = column.header || `Column ${column.letter}`
          return (
            <div className="ifl-map-row" key={column.index}>
              <div className="ifl-col">
                <strong>
                  {column.letter} · {name}
                </strong>
                <span>{column.samples.join(', ') || 'empty'}</span>
              </div>
              <span className="ifl-arrow" aria-hidden="true">
                →
              </span>
              <select
                className={
                  field === null ? 'ui-input ifl-to ifl-to-skip' : 'ui-input ifl-to ifl-to-auto'
                }
                aria-label={`CiteFox column for ${name}`}
                value={field ?? ''}
                onChange={(event) => onMap(column.index, event.target.value || null)}
              >
                <option value="">Don’t import</option>
                {fields.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {item.required ? ' *' : ''}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
      {words.length > 0 ? (
        <div className="ifl-opt">
          <p className="ifl-label">Stage values</p>
          <div className="ifl-words">
            {words.map((word) => (
              <span key={word.key} className={word.stage ? 'ifl-word' : 'ifl-word ifl-word-bad'}>
                <span>{word.word}</span>
                <span aria-hidden="true">→</span>
                <MenuButton
                  label={`What “${word.word}” means`}
                  align="start"
                  items={[
                    ...TOPIC_STAGES.map((stage) => ({
                      id: stage,
                      label: TOPIC_STAGE_LABEL[stage],
                      onSelect: () => onStageWord(word.key, stage)
                    })),
                    {
                      id: 'none',
                      label: 'No stage',
                      groupStart: true,
                      onSelect: () => onStageWord(word.key, null)
                    }
                  ]}
                  trigger={(props) => (
                    <button type="button" className="ifl-word-stage" {...props}>
                      {word.stage ? TOPIC_STAGE_LABEL[word.stage] : 'Pick a stage'}
                    </button>
                  )}
                />
                {stageWords[word.key] !== undefined ? (
                  <span className="ifl-hint">saved</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="ifl-opt">
        {hasPage ? (
          <label className="ifl-check">
            <input
              type="checkbox"
              className="ui-check"
              checked={usePageDefault}
              onChange={(event) => onUsePageDefault(event.target.checked)}
            />
            <span>Rows without a page use</span>
            <select
              className="ui-input ui-input-sm ifl-page-pick"
              aria-label="Page for rows without one"
              value={defaultPage ?? ''}
              onChange={(event) => onDefaultPage(event.target.value || null)}
            >
              <option value="">Pick a page</option>
              {pages.map((page) => (
                <option key={page.value} value={page.value}>
                  {page.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {preview && preview.newPages.length > 0 ? (
          <p className="ifl-hint">
            {preview.newPages.length === 1
              ? '1 page isn’t'
              : `${preview.newPages.length} pages aren’t`}{' '}
            tracked yet. Rows keep it as the page to be cited; track it from Import pages to check
            it too.
          </p>
        ) : null}
        <label className="ifl-check">
          <input
            type="checkbox"
            className="ui-check"
            checked={saveMapping}
            disabled={!read.hasHeader}
            onChange={(event) => onSaveMapping(event.target.checked)}
          />
          <span>Save this column match for next time</span>
        </label>
      </div>
    </section>
  )
}
