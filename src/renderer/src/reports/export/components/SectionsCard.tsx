import type { JSX } from 'react'
import { Panel, SectionMenu } from '../../../ui'
import { allSections, type ExportForm } from '../model'
import { SectionsPicker } from './SectionsPicker'

/** One checkbox per report section, in report order. */
export function SectionsCard({
  form,
  onPatch,
  hasTopic = false
}: {
  form: ExportForm
  onPatch: (partial: Partial<ExportForm>) => void
  /** The scope holds a topic, so Topic coverage can be picked. */
  hasTopic?: boolean
}): JSX.Element {
  return (
    <Panel
      title="Sections"
      className="xpt-panel"
      actions={
        <SectionMenu
          label="More actions for Sections"
          items={[
            {
              id: 'all',
              label: 'Select all',
              icon: 'check',
              onSelect: () => onPatch({ sections: allSections(true) })
            },
            {
              id: 'none',
              label: 'Select none',
              icon: 'x',
              onSelect: () => onPatch({ sections: allSections(false) })
            }
          ]}
        />
      }
    >
      <p className="xpt-help">
        Each section covers every page and market you picked. The cover (scope, data window, markets
        and questions tracked) is always included.
      </p>
      <SectionsPicker
        value={form.sections}
        onChange={(sections) => onPatch({ sections })}
        scope={form.scope}
        hasTopic={hasTopic}
      />
    </Panel>
  )
}
