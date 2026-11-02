import type { JSX } from 'react'
import type { DeliveryRecord, ReportScheduleListItem } from '@shared/domain'
import { alertsHash } from '../../../shell/routes'
import { Chip, CopyText, Drawer, DrawerFacts, DrawerGrid, DrawerSection } from '../../../ui'
import { formatLabel, resendAria, resendLabel, type DeliveryRow } from '../../scheduleModel'
import { ProjectName } from './ProjectName'

function attachment(record: DeliveryRecord, schedule: ReportScheduleListItem | null): string {
  if (record.trigger === 'account_test') return 'None. This was a test of the sending account.'
  if (!schedule) return 'The report this schedule sent'
  if (schedule.format === 'summary') return 'None. The summary is in the email.'
  return formatLabel(schedule.format)
}

function outcomeTone(record: DeliveryRecord): 'ok' | 'bad' | 'neutral' {
  if (record.outcome === 'failed') return 'bad'
  if (record.outcome === 'draft') return 'neutral'
  return 'ok'
}

/**
 * One delivery (`#/reports?view=history&delivery=<id>`) on the shared 80%
 * drawer: who it went to, what was attached, what happened, and Resend.
 */
export function DeliveryDetail({
  record,
  row,
  items,
  resent,
  loading,
  onClose,
  onResend,
  onOpenSchedule,
  onOpenProject
}: {
  record: DeliveryRecord | null
  row: DeliveryRow | null
  items: readonly ReportScheduleListItem[]
  resent: boolean
  loading: boolean
  onClose: () => void
  onResend: (row: DeliveryRow) => void
  onOpenSchedule: (scheduleId: string) => void
  onOpenProject: ((projectId: string) => void) | null
}): JSX.Element {
  if (!record || !row) {
    return (
      <Drawer
        id="delivery"
        title="Delivery"
        onClose={onClose}
        loading={loading}
        {...(loading
          ? {}
          : { error: { message: 'That delivery is not on this computer any more.' } })}
        footer={{ cancel: 'Close' }}
      />
    )
  }
  const schedule = items.find((item) => item.id === record.scheduleId) ?? null
  const projectId = record.projectId ?? schedule?.projectId ?? null
  return (
    <Drawer
      id="delivery"
      title={`${row.name} · ${row.dateLabel}`}
      subtitle={`Delivery · ${row.trigger}`}
      status={
        <Chip size="sm" tone={outcomeTone(record)} dot>
          {row.result}
        </Chip>
      }
      focusOnOpen="close"
      onClose={onClose}
      testId="delivery-drawer"
      attributes={{ 'data-report-detail': `delivery:${record.id}` }}
      footer={{
        cancel: 'Close',
        ...(schedule
          ? { secondary: { label: 'Open schedule', onClick: () => onOpenSchedule(schedule.id) } }
          : {}),
        primary: {
          label: resendLabel(record.outcome, resent),
          ariaLabel: resendAria(row, resent),
          onClick: () => onResend(row)
        }
      }}
    >
      <DrawerGrid>
        <DrawerSection title="What was sent" span={8}>
          <DrawerFacts
            label="Delivery"
            items={[
              {
                label: 'Schedule',
                value: schedule ? (
                  <button
                    type="button"
                    className="rpt-text-btn"
                    aria-label={`${schedule.name}: open schedule`}
                    onClick={() => onOpenSchedule(schedule.id)}
                  >
                    {schedule.name}
                  </button>
                ) : (
                  row.name
                )
              },
              {
                label: 'Project',
                value: (
                  <ProjectName
                    projectId={projectId}
                    name={row.project}
                    onOpenProject={onOpenProject}
                  />
                )
              },
              { label: 'Trigger', value: row.trigger },
              { label: 'Attachment', value: attachment(record, schedule) },
              { label: 'Date', value: row.dateLabel }
            ]}
          />
        </DrawerSection>
        <DrawerSection title={`Sent to · ${record.recipients.length}`} span={4}>
          {record.recipients.length === 0 ? (
            <p className="muted">No recipients</p>
          ) : (
            <ul className="rpt-plain mono">
              {record.recipients.map((address) => (
                <li key={address}>
                  <CopyText text={address} />
                </li>
              ))}
            </ul>
          )}
        </DrawerSection>
        <DrawerSection title="Result" span={12}>
          <DrawerFacts
            label="Result"
            items={[
              { label: 'Result', value: row.result },
              ...(record.reason ? [{ label: 'What happened', value: record.reason }] : []),
              ...(record.nextStep ? [{ label: 'Next step', value: record.nextStep }] : [])
            ]}
          />
          {record.outcome === 'failed' ? (
            <p>
              <a href={alertsHash('email')}>Fix in Email setup</a>
            </p>
          ) : null}
        </DrawerSection>
      </DrawerGrid>
    </Drawer>
  )
}
