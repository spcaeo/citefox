import type { JSX } from 'react'
import type { ExportFormat } from '@shared/domain'
import { previewGridRows } from '../formats'

/** The first rows or short text `exports:preview` returns. Not the file. */
export function PreviewBody({
  format,
  preview
}: {
  format: ExportFormat
  preview: string
}): JSX.Element {
  const rows = previewGridRows(preview, format)
  if (rows.length === 0) {
    return (
      <pre
        className="xpt-code"
        tabIndex={0}
        role="region"
        aria-label="Export preview"
        data-testid="export-preview-text"
      >
        {preview}
      </pre>
    )
  }
  const [header, ...data] = rows
  return (
    <div
      className="xpt-grid"
      role="table"
      aria-label="Export preview"
      tabIndex={0}
      data-testid="export-preview-grid"
    >
      <div role="row">
        {(header ?? []).map((cell, index) => (
          <span role="columnheader" key={`${index}-${cell}`}>
            {cell}
          </span>
        ))}
      </div>
      {data.map((row, rowIndex) => (
        <div role="row" key={rowIndex} data-testid="export-preview-row">
          {row.map((cell, index) => (
            <span role="cell" key={`${rowIndex}-${index}`}>
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
