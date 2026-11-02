import { useId, useState, type DragEvent, type JSX } from 'react'
import { IMPORT_MAX_ROWS } from '@shared/ipc'
import type { ImportEntity } from '@shared/import-fields'
import { Button, ExportMenu, UiIcon } from '../../ui'
import { nounOf } from '../model'

export interface ChooseStepProps {
  entity: ImportEntity
  busy: boolean
  onPick: () => void
  onDrop: (file: File) => void
  onPaste: (text: string) => void
  onTemplate: (format: 'csv' | 'xlsx') => void
  /** ✦ Help me find them, for a list with a helper kind (importFlow/help.ts). */
  help?: { label: string; hint: string; onOpen: () => void }
}

/**
 * Step 1: drop a file, choose one through the open dialog, or paste rows from a
 * sheet. The template has every column named, so a file filled from it matches.
 * A list with a helper kind also offers ✦ Help me find them.
 */
export function ChooseStep({
  entity,
  busy,
  onPick,
  onDrop,
  onPaste,
  onTemplate,
  help
}: ChooseStepProps): JSX.Element {
  const [over, setOver] = useState(false)
  const [text, setText] = useState('')
  const pasteId = useId()
  const noun = nounOf(entity)

  function drop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (file) onDrop(file)
  }

  return (
    <div className="ifl-choose">
      <div
        className={over ? 'ifl-drop ifl-drop-over' : 'ifl-drop'}
        data-testid="import-drop"
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <UiIcon name="upload" size={20} />
        <p className="ifl-drop-title">Drop a CSV or Excel file here</p>
        <p className="ifl-hint">
          CSV, TSV or .xlsx, up to 10 MB and {IMPORT_MAX_ROWS.toLocaleString('en-US')} rows. You
          match the columns and every row is checked before anything is added.
        </p>
        <Button variant="primary" icon="folder" busy={busy} onClick={onPick}>
          Choose a file
        </Button>
      </div>
      <div className="ifl-side">
        {help ? (
          <div className="ifl-help">
            <p className="ifl-label">No list yet?</p>
            <p className="ifl-hint">{help.hint}</p>
            <Button
              variant="secondary"
              size="sm"
              icon="sparkle"
              className="hf-spark-btn"
              onClick={help.onOpen}
            >
              {help.label}
            </Button>
          </div>
        ) : null}
        <div className="ifl-paste">
          <label className="ifl-label" htmlFor={pasteId}>
            Or paste rows from a sheet
          </label>
          <textarea
            id={pasteId}
            className="ifl-paste-box"
            rows={7}
            value={text}
            placeholder={`Copy the ${noun} from Google Sheets or Excel, header row too, and paste here.`}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={text.trim().length === 0 || busy}
            onClick={() => onPaste(text)}
          >
            Use these rows
          </Button>
        </div>
        <div className="ifl-template">
          <p className="ifl-label">Download a template</p>
          <p className="ifl-hint">The columns CiteFox reads, with two example rows.</p>
          <div className="ifl-template-actions">
            <ExportMenu
              label="Download a template"
              width={200}
              items={[
                { id: 'csv', label: 'CSV template', onSelect: () => onTemplate('csv') },
                { id: 'xlsx', label: 'Excel template', onSelect: () => onTemplate('xlsx') }
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
