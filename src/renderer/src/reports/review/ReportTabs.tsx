import type { JSX, ReactNode } from 'react'
import {
  groupOfSection,
  groupTabs,
  type ReportKind,
  type ReportSectionEntry,
  type ReviewSectionId
} from '@shared/report/review'
import { Tabs, TabPanel, type TabItem } from '../../ui'

const TABS_ID = 'rv-tabs'
const PILLS_ID = 'rv-pills'

/** A tab's alert dot and greyed mark (what it needs shows on hover). */
function marks(alert: boolean, empty: string | undefined): Pick<TabItem<string>, 'tag' | 'lead'> {
  return {
    ...(alert ? { tag: '•' } : {}),
    ...(empty !== undefined ? { lead: <span className="rv-tab-empty" title={empty} /> } : {})
  }
}

/** A greyed top tab's hover line: its one section's need, or a short line for a group. */
function emptyLine(sections: readonly ReportSectionEntry[]): string {
  return sections.length === 1 ? (sections[0]?.empty ?? '') : 'Nothing to show yet.'
}

/**
 * A ready report's section tabs, grouped (Docs/REPORT-SPEC.md "Grouped tabs"): one line
 * of top tabs, and pill sub-tabs under it when the picked tab holds several sections.
 * `section` (from the URL) picks both; picking a top tab opens its first shown section.
 */
export function ReportTabs({
  kind,
  sections,
  section,
  onSection,
  children
}: {
  kind: ReportKind
  sections: readonly ReportSectionEntry[]
  section: ReviewSectionId
  onSection: (id: ReviewSectionId) => void
  children: ReactNode
}): JSX.Element {
  const groups = groupTabs(kind, sections)
  const group = groupOfSection(groups, section)
  const groupId = group?.id ?? section
  const pills = group !== undefined && group.sections.length > 1 ? group : null
  return (
    <>
      <Tabs
        label="Report sections"
        className="rv-tabs"
        panelId={TABS_ID}
        value={groupId}
        onChange={(id) => {
          const first = groups.find((item) => item.id === id)?.sections[0]
          if (first !== undefined) onSection(first.id)
        }}
        tabs={groups.map((item) => ({
          id: item.id,
          label: item.title,
          ...(item.quiet ? { className: 'rv-tab-quiet' } : {}),
          ...marks(item.alert, item.empty ? emptyLine(item.sections) : undefined)
        }))}
      />
      <TabPanel panelId={TABS_ID} id={groupId} className={pills === null ? 'rv-body' : 'rv-group'}>
        {pills === null ? (
          children
        ) : (
          <>
            <div className="rv-pills-row">
              <Tabs
                label={`${pills.title} sections`}
                className="rv-pills"
                size="sm"
                panelId={PILLS_ID}
                value={section}
                onChange={onSection}
                tabs={pills.sections.map((entry) => ({
                  id: entry.id,
                  label: entry.title,
                  ...marks(entry.alert === true, entry.empty)
                }))}
              />
              {pills.hint !== undefined ? <p className="rv-pills-hint">{pills.hint}</p> : null}
            </div>
            <TabPanel panelId={PILLS_ID} id={section} className="rv-body">
              {children}
            </TabPanel>
          </>
        )}
      </TabPanel>
    </>
  )
}
