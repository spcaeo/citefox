import type { JSX } from 'react'
import type { DeliveryRecord, ReportScheduleListItem } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { ScopeOptions } from '../../../scope'
import { Button, CopyText, DrawerFacts, DrawerGrid, DrawerSection } from '../../../ui'
import {
  accountLabel,
  formatLabel,
  marketSummary,
  resultPhrase,
  sectionTitles,
  type AccountOption,
  type ScheduleRow
} from '../../scheduleModel'
import { ProjectName } from '../components/ProjectName'
import { deliveriesOf } from '../utils/drills'
import { scopeLine } from '../utils/scopeLine'
import { upcomingSends } from '../utils/occurrences'
import { marketsFor } from '../utils/projects'
import { zoneLabel } from '../../../ui/timeZones'

/** Deliveries listed in a schedule's drawer. The rest are in Delivery history. */
const SHOWN_DELIVERIES = 10

function nextNote(item: ReportScheduleListItem, row: ScheduleRow): string {
  if (item.status === 'paused') return 'This schedule is off. Turn it on to send again.'
  if (item.timing.kind === 'on_change') {
    return `${row.when}. It sends after the check that finds it.`
  }
  return 'Its project is paused, so nothing is due until the project runs again.'
}

/** A schedule's details: its settings, the next sends and its last deliveries. */
export function ScheduleView({
  item,
  row,
  deliveries,
  projects,
  accounts,
  timeZone,
  scopeOptions,
  onSendNow,
  onOpenDelivery,
  onOpenProject,
  sendNote
}: {
  item: ReportScheduleListItem
  row: ScheduleRow
  deliveries: readonly DeliveryRecord[]
  projects: readonly ProjectDetail[]
  accounts: readonly AccountOption[]
  timeZone: string
  scopeOptions: ScopeOptions | null
  onSendNow: () => void
  onOpenDelivery: (deliveryId: string) => void
  onOpenProject: ((projectId: string) => void) | null
  /** What the last Send now did, shown under the actions. */
  sendNote: string | null
}): JSX.Element {
  const sends = upcomingSends(item)
  const sent = deliveriesOf(item.id, deliveries)
  const sections = item.format === 'summary' ? [] : sectionTitles(item.sections)
  const markets = marketsFor(item.projectId, projects)
  return (
    <DrawerGrid className="rpt-sd-view">
      <DrawerSection
        span={8}
        title="Settings"
        description={`${row.when} · ${formatLabel(item.format)}`}
        actions={
          <Button size="sm" onClick={onSendNow} data-testid="sd-send-now">
            Send now
          </Button>
        }
        testId="sd-settings"
      >
        {sendNote ? (
          <p className="rpt-help" role="status">
            {sendNote}
          </p>
        ) : null}
        <DrawerFacts
          label="Schedule settings"
          items={[
            {
              label: 'Project',
              value: (
                <>
                  <ProjectName
                    projectId={item.projectId}
                    name={row.project}
                    onOpenProject={onOpenProject}
                  />
                  {row.projectTag ? <span className="rpt-sub"> · {row.projectTag}</span> : null}
                </>
              )
            },
            { label: 'Covers', value: scopeLine(item, scopeOptions) },
            item.report
              ? { label: 'Report', value: row.sectionsLabel }
              : {
                  label: 'Sections',
                  value:
                    item.format === 'summary' ? (
                      row.sectionsLabel
                    ) : sections.length === 0 ? (
                      'No sections'
                    ) : (
                      <ul className="rpt-plain">
                        {sections.map((title) => (
                          <li key={title}>{title}</li>
                        ))}
                      </ul>
                    )
                },
            {
              label: 'Markets',
              value:
                item.marketIds.length === 0
                  ? "Each project's default market"
                  : marketSummary(item.marketIds, markets) ||
                    pluralize(item.marketIds.length, 'market')
            },
            {
              label: 'Recipients',
              value: (
                <ul className="rpt-plain mono">
                  {item.recipients.map((address) => (
                    <li key={address}>
                      <CopyText text={address} />
                    </li>
                  ))}
                </ul>
              )
            },
            { label: 'Send from', value: accountLabel(item.accountId, accounts) },
            { label: 'Time zone', value: zoneLabel(item.timeZone) },
            { label: 'Subject', value: <CopyText text={item.subject} /> }
          ]}
        />
      </DrawerSection>
      <div className="ui-drawer-rail ui-drawer-span-4">
        <DrawerSection title="Next sends" testId="sd-next">
          {sends.length === 0 ? (
            <p className="rpt-muted">{nextNote(item, row)}</p>
          ) : (
            <ol className="rpt-plain">
              {sends.map((send) => (
                <li key={send.day}>
                  {send.dayLabel} · <span className="mono">{send.time}</span>
                </li>
              ))}
            </ol>
          )}
        </DrawerSection>
        <DrawerSection title="Deliveries" count={sent.length} testId="sd-deliveries">
          {sent.length === 0 ? (
            <p className="rpt-muted">Not sent yet.</p>
          ) : (
            <ul className="rpt-plain rpt-sends">
              {sent.slice(0, SHOWN_DELIVERIES).map((record) => {
                const phrase = resultPhrase(record, timeZone)
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      className="rpt-text-btn"
                      aria-label={`${phrase}: open delivery`}
                      onClick={() => onOpenDelivery(record.id)}
                    >
                      {phrase}
                    </button>
                    <span className="rpt-sub">
                      {' '}
                      · {pluralize(record.recipients.length, 'recipient')}
                      {record.outcome === 'failed' && record.reason ? ` · ${record.reason}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {sent.length > SHOWN_DELIVERIES ? (
            <p className="rpt-help">
              Showing the last {SHOWN_DELIVERIES} of {sent.length}. Search Delivery history for the
              rest.
            </p>
          ) : null}
        </DrawerSection>
      </div>
    </DrawerGrid>
  )
}
