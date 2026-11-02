import { useId, useMemo, useState, type JSX } from 'react'
import type { CsvColumnsResult, TopicCsvMapping } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { ListGrid, Panel, type ListColumn } from '../../../ui'
import { StepFrame } from '../components/StepFrame'
import { questionsOf } from '../utils/draft'
import { parsePasted } from '../utils/importParse'
import { usePrimary, type StepProps } from './shared'

interface CsvState {
  fileName: string
  content: string
  columns: CsvColumnsResult
  mapping: TopicCsvMapping
}

/** Largest CSV read in the window; bigger files are refused with a plain message. */
const MAX_CSV_BYTES = 2_000_000

/** Rows of the CSV preview. */
const SAMPLE_ROWS = 3

interface SampleRow {
  key: string
  cells: readonly string[]
}

/** The CSV preview's columns: one per CSV column, the picked question column tinted and widest. */
function sampleColumns(names: readonly string[], question: number): ListColumn<SampleRow>[] {
  return names.map((name, index) => ({
    id: `c${index}`,
    label: name,
    width: index === question ? 'fill' : 112,
    minWidth: 160,
    ...(index === question ? { cellClassName: 'tw-sample-on' } : {}),
    render: (row: SampleRow) => <span className="tw-clamp">{row.cells[index] ?? ''}</span>
  }))
}

/** My own questions, step 1: paste lines or pick a CSV and its columns. */
export function ImportStep(props: StepProps): JSX.Element {
  const { draft, project, client, patch } = props
  const primary = usePrimary(props)
  const [text, setText] = useState('')
  const [csv, setCsv] = useState<CsvState | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const existing = questionsOf(draft).length
  const [append, setAppend] = useState(existing > 0)
  const ids = { name: useId(), paste: useId(), file: useId(), q: useId(), s: useId(), n: useId() }
  const lines = parsePasted(text).length
  const ready = lines > 0 || (csv?.columns.rows ?? 0) > 0

  async function readFile(file: File | undefined): Promise<void> {
    setFileError(null)
    if (!file) return
    if (file.size > MAX_CSV_BYTES) {
      setFileError('That file is over 2 MB. Split it or paste the questions instead.')
      return
    }
    try {
      const content = await file.text()
      const columns = await client['topics:readCsvColumns']({ projectId: project.id, content })
      setCsv({ fileName: file.name, content, columns, mapping: columns.guess })
    } catch (cause) {
      setFileError(errorText(cause, 'Could not read that file.'))
    }
  }

  function setMapping(change: Partial<TopicCsvMapping>): void {
    setCsv((current) =>
      current ? { ...current, mapping: { ...current.mapping, ...change } } : current
    )
  }

  function onPrimary(): void {
    if (!ready) {
      if (existing > 0) void primary.advance('cleanup')
      else primary.setError('Paste questions or choose a CSV file.')
      return
    }
    void primary.advance('cleanup', async (draftId) => {
      const result = await client['topics:importQuestions']({
        projectId: project.id,
        draftId,
        text: text.trim() ? text : null,
        csv: csv ? { fileName: csv.fileName, content: csv.content, mapping: csv.mapping } : null,
        append
      })
      return result.draft
    })
  }

  const columnOptions =
    csv?.columns.columns.map((name, index) => ({ value: String(index), label: name })) ?? []
  const sampleNames = csv?.columns.columns
  const sampleQuestion = csv?.mapping.question ?? 0
  const sampleCols = useMemo(
    () => sampleColumns(sampleNames ?? [], sampleQuestion),
    [sampleNames, sampleQuestion]
  )
  const sampleRows = useMemo<SampleRow[]>(
    () =>
      (csv?.columns.sample ?? [])
        .slice(0, SAMPLE_ROWS)
        .map((cells, index) => ({ key: String(index), cells })),
    [csv?.columns.sample]
  )

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Add your own questions"
      aside="Lines from sales calls, support tickets and forms. Their wording is kept."
      headerEnd={
        <label className="tw-inline-field" htmlFor={ids.name}>
          <span className="tw-label">Topic name</span>
          <input
            id={ids.name}
            className="ui-input"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
      }
      footer={{
        onBack: props.back,
        note:
          primary.error ??
          (ready
            ? `${lines + (csv?.columns.rows ?? 0)} lines to clean up · no searches used`
            : existing > 0
              ? `${existing} questions already added`
              : 'Nothing is checked until you start.'),
        noteTone: primary.error ? 'warn' : 'neutral',
        primary: { label: 'Clean up', busy: primary.busy, onClick: onPrimary }
      }}
    >
      <div className="tw-pair">
        <Panel title="Paste questions">
          <label className="tw-label" htmlFor={ids.paste}>
            One question per line
          </label>
          <textarea
            id={ids.paste}
            className="ui-input tw-textarea tw-paste"
            rows={12}
            value={text}
            placeholder={
              'How do I text staff from Outlook?\nAlerts don’t reach whoever is on call at night'
            }
            onChange={(event) => setText(event.target.value)}
          />
          <p className="tw-help num">
            {lines} {lines === 1 ? 'line' : 'lines'} · Search Console queries can be pasted here too
          </p>
        </Panel>
        <Panel title="Or a CSV file">
          <label className="tw-label" htmlFor={ids.file}>
            CSV file
          </label>
          <input
            id={ids.file}
            type="file"
            accept=".csv,text/csv"
            className="tw-file"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
          {fileError ? (
            <p className="tw-help tw-warn" role="alert">
              {fileError}
            </p>
          ) : null}
          {csv ? (
            <div className="tw-columns">
              <p className="tw-help num">
                {csv.fileName} · {csv.columns.rows} rows
              </p>
              <div className="tw-row">
                <label className="tw-field" htmlFor={ids.q}>
                  <span className="tw-label">Question column</span>
                  <select
                    id={ids.q}
                    className="ui-input tw-select"
                    value={String(csv.mapping.question)}
                    onChange={(event) => setMapping({ question: Number(event.target.value) })}
                  >
                    {columnOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tw-field" htmlFor={ids.s}>
                  <span className="tw-label">Source (optional)</span>
                  <select
                    id={ids.s}
                    className="ui-input tw-select"
                    value={
                      csv.mapping.source === null || csv.mapping.source === undefined
                        ? ''
                        : String(csv.mapping.source)
                    }
                    onChange={(event) =>
                      setMapping({
                        source: event.target.value === '' ? null : Number(event.target.value)
                      })
                    }
                  >
                    <option value="">None</option>
                    {columnOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tw-field" htmlFor={ids.n}>
                  <span className="tw-label">Notes (optional)</span>
                  <select
                    id={ids.n}
                    className="ui-input tw-select"
                    value={
                      csv.mapping.notes === null || csv.mapping.notes === undefined
                        ? ''
                        : String(csv.mapping.notes)
                    }
                    onChange={(event) =>
                      setMapping({
                        notes: event.target.value === '' ? null : Number(event.target.value)
                      })
                    }
                  >
                    <option value="">None</option>
                    {columnOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="tw-check">
                <input
                  type="checkbox"
                  className="ui-check"
                  checked={csv.mapping.hasHeader}
                  onChange={() => setMapping({ hasHeader: !csv.mapping.hasHeader })}
                />
                The first row is a header
              </label>
              <ListGrid
                label={`First rows of ${csv.fileName}`}
                noun={['row', 'rows']}
                rows={sampleRows}
                rowKey={(row) => row.key}
                rowLabel={(row) => `Row ${Number(row.key) + 1}`}
                columns={sampleCols}
                className="tw-sample"
                empty={<p className="tw-help">No rows in this file.</p>}
              />
            </div>
          ) : (
            <p className="tw-help">Pick the question column next; source and notes are optional.</p>
          )}
        </Panel>
      </div>
      {existing > 0 ? (
        <label className="tw-check">
          <input
            type="checkbox"
            className="ui-check"
            checked={append}
            onChange={() => setAppend((value) => !value)}
          />
          Add to the {existing} questions already here
        </label>
      ) : null}
    </StepFrame>
  )
}
