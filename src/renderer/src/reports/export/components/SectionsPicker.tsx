import { useId, type JSX } from 'react'
import { REPORT_SECTIONS, type ReportSectionId } from '@shared/domain'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import { Chip } from '../../../ui'
import { sectionNote, sectionUnavailable, type ExportScopeChoice } from '../model'

/** The section added with topic tracking (Docs/TOPICS-SPEC.md section 5), marked New. */
const NEW_SECTION = 'topic_coverage'

/**
 * One checkbox per report section, in report order, each with its plain-words
 * description and why it cannot be picked in this scope. Export's Sections card
 * and the schedule drawer's Sections box both draw this list.
 */
export function SectionsPicker({
  value,
  onChange,
  scope,
  hasTopic = false,
  label = 'Sections'
}: {
  value: Readonly<Record<ReportSectionId, boolean>>
  onChange: (next: Record<ReportSectionId, boolean>) => void
  scope: ExportScopeChoice
  /** The scope holds a topic, so Topic coverage can be picked. */
  hasTopic?: boolean
  label?: string
}): JSX.Element {
  const base = useId()
  return (
    <div className="xpt-secs" role="group" aria-label={label}>
      {REPORT_SECTIONS.map((id) => {
        const copy = REPORT_SECTION_COPY[id]
        const unavailable = sectionUnavailable(id, scope, hasTopic)
        const note = unavailable ?? sectionNote(id)
        const on = value[id] && unavailable === null
        const inputId = `${base}-${id}`
        // The label holds only the title (so "Name" or "Project" never matches a
        // section's description); it stretches over the whole row, so a click
        // anywhere on the row still toggles it.
        return (
          <div
            className={['xpt-sec', on ? 'on' : '', unavailable ? 'off' : ''].join(' ').trim()}
            key={id}
          >
            <input
              id={inputId}
              type="checkbox"
              className="ui-check"
              checked={on}
              disabled={unavailable !== null}
              aria-describedby={note ? `${inputId}-d ${inputId}-n` : `${inputId}-d`}
              onChange={() => onChange({ ...value, [id]: !value[id] })}
            />
            <span className="xpt-sec-copy">
              <span className="xpt-sec-name">
                <label htmlFor={inputId} className="xpt-sec-label">
                  {copy.title}
                </label>
                {id === NEW_SECTION ? (
                  <Chip size="sm" tone="info">
                    New
                  </Chip>
                ) : null}
              </span>
              <span className="xpt-sub" id={`${inputId}-d`}>
                {copy.description}
              </span>
              {note ? (
                <span id={`${inputId}-n`} className={unavailable ? 'xpt-sub xpt-why' : 'xpt-sub'}>
                  {note}
                </span>
              ) : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}
