import type { JSX } from 'react'
import { REPORT_SECTIONS } from '@shared/domain'
import { DrawerSection, SectionMenu } from '../../../../ui'
import { SectionsPicker } from '../../../export/components/SectionsPicker'
import { EMAIL_SUMMARY_NOTE, type ScheduleDraft } from '../../../scheduleModel'
import { exportScopeOf, sectionList, sectionMap } from '../../utils/sections'

/**
 * Sections: the same list, words and rules as Export, picked right here (no
 * trip to Export). An email-summary schedule attaches no file, so it says so.
 */
export function SectionsBox({
  draft,
  patch,
  hasTopic
}: {
  draft: ScheduleDraft
  patch: (partial: Partial<ScheduleDraft>) => void
  hasTopic: boolean
}): JSX.Element {
  const summaryOnly = draft.format === 'summary'
  const map = sectionMap(draft.sections)
  return (
    <DrawerSection
      title="Sections"
      count={summaryOnly ? undefined : sectionList(map).length}
      description={
        summaryOnly
          ? 'An email summary has no attachment, so it has no sections. Pick a file format to choose them.'
          : 'What the attached report holds. The cover (scope, window, markets) is always in.'
      }
      actions={
        summaryOnly ? undefined : (
          <SectionMenu
            label="More actions for Sections"
            items={[
              {
                id: 'all',
                label: 'Select all',
                icon: 'check',
                onSelect: () => patch({ sections: [...REPORT_SECTIONS] })
              },
              {
                id: 'none',
                label: 'Select none',
                icon: 'x',
                onSelect: () => patch({ sections: [] })
              }
            ]}
          />
        )
      }
      testId="sd-sections"
    >
      {summaryOnly ? null : (
        <SectionsPicker
          value={map}
          onChange={(next) => patch({ sections: sectionList(next) })}
          scope={exportScopeOf(draft)}
          hasTopic={hasTopic}
          label="Report sections"
        />
      )}
      <p className="rpt-help">{EMAIL_SUMMARY_NOTE}</p>
    </DrawerSection>
  )
}
