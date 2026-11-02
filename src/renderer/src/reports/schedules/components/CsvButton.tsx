import { useState, type JSX } from 'react'
import type { GridCsvRequest } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import type { GridCsvExport } from '../../../grid'
import { ToolButton } from '../../../ui'

/** A list toolbar's "Export CSV": writes exactly the rows it is given, then says where. */
export function CsvButton({
  exportCsv,
  build,
  disabled = false
}: {
  exportCsv: GridCsvExport
  /** Built on click, so it holds the rows shown at that moment. */
  build: () => GridCsvRequest
  disabled?: boolean
}): JSX.Element {
  const [note, setNote] = useState<string | null>(null)

  async function run(): Promise<void> {
    setNote(null)
    try {
      const result = await exportCsv(build())
      if (result.ok) {
        setNote(`Saved ${result.rowCount} ${result.rowCount === 1 ? 'row' : 'rows'}.`)
      } else if (result.reason === 'failed') {
        setNote(result.message)
      }
    } catch (cause) {
      setNote(errorText(cause, 'Could not export these rows.'))
    }
  }

  return (
    <>
      {note ? (
        <span className="rpt-csv-note" role="status">
          {note}
        </span>
      ) : null}
      <ToolButton kind="csv" label="Export CSV" disabled={disabled} onClick={() => void run()} />
    </>
  )
}
