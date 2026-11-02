import type { JSX } from 'react'
import type {
  ProjectImportSectionResult,
  ProjectTransferSectionCount,
  SettingsTransferField,
  SettingsTransferFieldResult
} from '@shared/ipc'
import './transfer.css'

function Count({ value }: { value: number }): JSX.Element {
  return <span className={value === 0 ? 'tf-zero' : undefined}>{value.toLocaleString()}</span>
}

/** What a project file holds (or would hold), one row per part. */
export function SectionCountTable({
  sections,
  label,
  testId
}: {
  sections: readonly ProjectTransferSectionCount[]
  label: string
  testId?: string
}): JSX.Element {
  return (
    <div className="tf-table-wrap">
      <table className="tf-table" aria-label={label} data-testid={testId}>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col" className="tf-num">
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <tr key={section.section} data-section={section.section}>
              <td>{section.label}</td>
              <td className="tf-num">
                <Count value={section.count} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** What an import did, per part: added, skipped as duplicates, failed, with the reasons. */
export function ImportResultTable({
  sections
}: {
  sections: readonly ProjectImportSectionResult[]
}): JSX.Element {
  return (
    <div className="tf-table-wrap">
      <table className="tf-table" aria-label="What was imported" data-testid="import-result">
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col" className="tf-num">
              Added
            </th>
            <th scope="col" className="tf-num">
              Skipped
            </th>
            <th scope="col" className="tf-num">
              Failed
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <tr key={section.section} data-section={section.section}>
              <td>
                {section.label}
                {section.notes.length > 0 ? (
                  <ul className="tf-notes">
                    {section.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </td>
              <td className="tf-num">
                <Count value={section.added} />
              </td>
              <td className="tf-num">
                <Count value={section.skipped} />
              </td>
              <td className="tf-num">
                <Count value={section.failed} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A settings file against this Mac's settings: changed rows are tinted. */
export function SettingsFieldTable({
  fields
}: {
  fields: readonly SettingsTransferField[]
}): JSX.Element {
  return (
    <div className="tf-table-wrap">
      <table className="tf-table" aria-label="Settings in the file" data-testid="settings-fields">
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">On this Mac</th>
            <th scope="col">In the file</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr
              key={field.key}
              className={field.changed ? 'tf-changed' : undefined}
              data-field={field.key}
              data-changed={field.changed ? 'true' : 'false'}
            >
              <td>{field.label}</td>
              <td className="tf-value">{field.current || '—'}</td>
              <td className="tf-value">{field.incoming || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const OUTCOME: Readonly<Record<SettingsTransferFieldResult['outcome'], string>> = {
  applied: 'Applied',
  unchanged: 'Already the same',
  failed: 'Not applied'
}

/** What applying a settings file did, per setting. */
export function SettingsResultTable({
  results
}: {
  results: readonly SettingsTransferFieldResult[]
}): JSX.Element {
  return (
    <div className="tf-table-wrap">
      <table className="tf-table" aria-label="What was applied" data-testid="settings-result">
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {results.map((field) => (
            <tr key={field.key} data-field={field.key} data-outcome={field.outcome}>
              <td>{field.label}</td>
              <td className={`tf-outcome-${field.outcome}`}>
                {OUTCOME[field.outcome]}
                {field.reason ? `: ${field.reason}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
