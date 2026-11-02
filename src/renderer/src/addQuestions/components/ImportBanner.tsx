import { useState, type DragEvent, type JSX } from 'react'
import { UiIcon } from '../../ui'

/**
 * "Have 100 or more? Drop a CSV or Excel file here, or choose a file." The
 * import itself is the stacked Import a file drawer; a dropped file goes there.
 */
export function ImportBanner({
  onImport,
  onDrop,
  onTemplate,
  large = false
}: {
  onImport: () => void
  onDrop: (file: File) => void
  onTemplate: () => void
  /** The Import a file tab: a taller drop zone. */
  large?: boolean
}): JSX.Element {
  const [over, setOver] = useState(false)

  function drop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (file) onDrop(file)
  }

  return (
    <div
      className={['aq-drop', large ? 'aq-drop-large' : '', over ? 'aq-drop-over' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid="aq-drop"
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <UiIcon name="upload" size={16} />
      <p className="aq-drop-text">
        <strong>Have 100 or more?</strong> Drop a CSV or Excel file here, or{' '}
        <button type="button" className="aq-link" onClick={onImport}>
          choose a file
        </button>
        . You map the columns and check every row before anything is added.
      </p>
      <button type="button" className="aq-link aq-drop-template" onClick={onTemplate}>
        Download a template
      </button>
    </div>
  )
}
