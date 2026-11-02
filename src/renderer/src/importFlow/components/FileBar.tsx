import type { JSX } from 'react'
import type { ImportReadResult } from '@shared/ipc'
import { Button, UiIcon } from '../../ui'

export interface FileBarProps {
  read: ImportReadResult
  busy: boolean
  onSheet: (sheet: string) => void
  onHeader: (hasHeader: boolean) => void
  onAnother: () => void
}

/** "buyer-questions-q4.xlsx · sheet “Questions” · 112 rows · first row is a header ✓ · Choose another file". */
export function FileBar({ read, busy, onSheet, onHeader, onAnother }: FileBarProps): JSX.Element {
  return (
    <div className="ifl-file" data-testid="import-file">
      <UiIcon name="file" size={16} />
      <strong className="ifl-file-name">{read.name}</strong>
      {read.sheets.length > 1 ? (
        <label className="ifl-file-sheet">
          <span>sheet</span>
          <select
            className="ui-input ui-input-sm"
            value={read.sheet ?? ''}
            disabled={busy}
            aria-label="Sheet"
            onChange={(event) => onSheet(event.target.value)}
          >
            {read.sheets.map((sheet) => (
              <option key={sheet} value={sheet}>
                {sheet}
              </option>
            ))}
          </select>
        </label>
      ) : read.sheet !== null ? (
        <span>· sheet “{read.sheet}”</span>
      ) : null}
      <span className="num">· {read.rowCount.toLocaleString('en-US')} rows</span>
      <label className="ifl-file-header">
        <input
          type="checkbox"
          className="ui-check"
          checked={read.hasHeader}
          disabled={busy}
          onChange={(event) => onHeader(event.target.checked)}
        />
        first row is a header
      </label>
      <span className="ifl-file-end">
        <Button variant="text" size="sm" disabled={busy} onClick={onAnother}>
          Choose another file
        </Button>
      </span>
      {read.warnings.length > 0 ? (
        <ul className="ifl-warnings">
          {read.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
