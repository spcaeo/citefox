import { useState, type JSX } from 'react'
import type {
  DeliveryRecord,
  DueList,
  EmailSettings,
  ProjectUsageReport,
  QueuePauseScope,
  QueueStatus
} from '@shared/domain'
import type { CheckJob } from '@shared/ipc'
import { DrillButton, DrillNumber, useDrill } from '../../drill'
import { alertsHash, appSettingsHash, navigateHash, sectionHash } from '../../shell/routes'
import {
  Button,
  Chip,
  CopyText,
  EmptyState,
  ListGrid,
  SectionHead,
  type ListColumn
} from '../../ui'
import { formatMoment } from '../../utils/dates'
import {
  checksState,
  count,
  emailAccountState,
  emailState,
  failedSends,
  lastReportSent,
  nextRunLabel,
  queueStateLabel,
  smtpName,
  triggerLabel,
  usagePace
} from '../utils/model'
import {
  dueDrill,
  failedDrill,
  jobsDrill,
  projectUsageDrill,
  sentDrill,
  type ProjectNames
} from '../utils/drills'
import { StateChip, StatusSection, UsageBar } from './StatusSection'
import { pluralize } from '@shared/pluralize'

/** Report deliveries that went out, newest first. */
function sentReports(records: readonly DeliveryRecord[]): DeliveryRecord[] {
  return records
    .filter(
      (record) =>
        record.trigger !== 'account_test' &&
        record.trigger !== 'export' &&
        record.outcome === 'sent'
    )
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** FR-24.2 Email: accounts, last report sent, failed sends with a fix link. */
export function EmailSection({
  email,
  deliveries,
  names
}: {
  email: EmailSettings
  deliveries: readonly DeliveryRecord[]
  names: ProjectNames
}): JSX.Element {
  const last = lastReportSent(deliveries)
  const failed = failedSends(deliveries)
  const sent = sentDrill(sentReports(deliveries), names)
  const failures = failedDrill(failed, names)
  return (
    <StatusSection
      id="st-email"
      title="Email"
      icon="message"
      state={emailState(email.accounts, deliveries)}
      href={alertsHash('email')}
      action="Email setup"
    >
      <span className="muted">
        {email.mode === 'mail_app'
          ? 'Reports open as drafts in your mail app.'
          : 'Reports are sent over SMTP.'}
      </span>
      {email.accounts.length === 0 ? (
        <span className="faint sts-small">No sending account yet.</span>
      ) : (
        <ul className="st-keys" aria-label="Sending accounts">
          {email.accounts.map((account) => (
            <li key={account.id} className="st-key">
              <div className="st-row">
                <span className="st-account">
                  <a
                    className="muted"
                    href={appSettingsHash('email', { account: account.id })}
                    aria-label={`${smtpName(account.provider)} · ${account.fromAddress}: edit in Email setup`}
                  >
                    {smtpName(account.provider)}
                  </a>
                  <span className="muted"> · </span>
                  <CopyText text={account.fromAddress} />
                  {account.isDefault ? <span className="faint"> · default</span> : null}
                </span>
                <StateChip state={emailAccountState(account)} />
              </div>
              {account.lastTestOk === false && account.lastTestMessage ? (
                <span className="st-problem">
                  <CopyText text={account.lastTestMessage} wrap />
                  {account.lastTestNextStep ? ` ${account.lastTestNextStep}` : ''}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <span className="faint sts-small">
        {last ? (
          <>
            Last report sent {formatMoment(last.at)} ·{' '}
            <DrillNumber
              drill={sent}
              className="m3-link"
              suffix={sent.items.length === 1 ? ' report sent' : ' reports sent'}
              label={`${sent.items.length} ${sent.items.length === 1 ? 'report sent' : 'reports sent'}: show them`}
            />
          </>
        ) : (
          'No report sent yet'
        )}
      </span>
      {failed.length > 0 ? (
        <span className="faint sts-small">
          <DrillNumber
            drill={failures}
            className="m3-link"
            suffix={failed.length === 1 ? ' failed send' : ' failed sends'}
            label={`${failed.length} ${failed.length === 1 ? 'failed send' : 'failed sends'}: show them`}
          />{' '}
          since the last good one
        </span>
      ) : null}
      {failed.map((record) => (
        <div key={record.id} className="st-issue" role="note">
          <span>
            <span className="sts-warn">Warning:</span> {triggerLabel(record)} failed{' '}
            {formatMoment(record.at)}
            {record.reason ? `: ${record.reason}` : ''}
          </span>
          <span className="st-buttons">
            <DrillButton
              drill={failures}
              label={`Details of the ${triggerLabel(record)} that failed`}
              untracked
            >
              Details
            </DrillButton>
            <a href={alertsHash('email')}>Fix in Email setup</a>
          </span>
        </div>
      ))}
    </StatusSection>
  )
}

/** FR-24.4: running and waiting, tray and background job, next run, pause and resume. */
export function ChecksSection({
  queue,
  jobs,
  due,
  names,
  onPause,
  onResume
}: {
  queue: QueueStatus
  jobs: readonly CheckJob[] | null
  due: DueList | null
  names: ProjectNames
  onPause: (scope: QueuePauseScope) => Promise<string | null>
  onResume: () => Promise<string | null>
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = queue.running + queue.waiting
  const running = jobs ? jobsDrill(jobs, names) : null
  const dueList = due ? dueDrill(due, names) : null

  async function act(work: () => Promise<string | null>): Promise<void> {
    setBusy(true)
    setError(await work())
    setBusy(false)
  }

  return (
    <StatusSection
      id="st-checks"
      title="Checks"
      icon="activity"
      state={checksState(queue)}
      href={sectionHash('check')}
      action="View queue"
    >
      <span className="muted">
        {queue.trayRunning ? 'Tray running' : 'Tray not running'} · background job{' '}
        {queue.headlessJob ? 'on' : 'off'}
      </span>
      <span>
        Now:{' '}
        {running ? (
          <DrillNumber
            drill={running}
            className="m3-link num"
            suffix={running.items.length === 1 ? ' check running' : ' checks running'}
            label={`${running.items.length} ${running.items.length === 1 ? 'check running' : 'checks running'}: show them`}
          />
        ) : (
          <>
            <span className="num">{queue.running}</span> {queue.running === 1 ? 'check' : 'checks'}{' '}
            running
          </>
        )}
        ,{' '}
        {dueList ? (
          <DrillButton
            drill={dueList}
            label={`${queue.waiting} waiting in the queue: show the pages due`}
            untracked
          >
            <span className="num">{queue.waiting}</span> waiting
          </DrillButton>
        ) : (
          <>
            <span className="num">{queue.waiting}</span> waiting
          </>
        )}
      </span>
      {running ? (
        <DrillButton
          drill={running}
          className="st-bar-btn"
          label={`${pluralize(queue.running, 'check')} running, ${queue.waiting} waiting: show the running checks`}
          untracked
        >
          <UsageBar
            used={queue.running}
            limit={total === 0 ? null : total}
            label={`${pluralize(queue.running, 'check')} running, ${queue.waiting} waiting`}
          />
        </DrillButton>
      ) : (
        <UsageBar
          used={queue.running}
          limit={total === 0 ? null : total}
          label={`${pluralize(queue.running, 'check')} running, ${queue.waiting} waiting`}
        />
      )}
      <span>{queueStateLabel(queue)}</span>
      <span className="faint sts-small">
        {nextRunLabel(queue)} ·{' '}
        {dueList ? (
          <DrillNumber
            drill={dueList}
            className="m3-link num"
            suffix={dueList.items.length === 1 ? ' page due' : ' pages due'}
            label={`${dueList.items.length} ${dueList.items.length === 1 ? 'page due' : 'pages due'}: show them`}
          />
        ) : (
          <>
            <span className="num">{queue.pagesDue}</span> {queue.pagesDue === 1 ? 'page' : 'pages'}{' '}
            due
          </>
        )}
      </span>
      <div className="st-buttons">
        {queue.state === 'running' ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => void act(() => onPause('all'))}>
              Pause all checks
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void act(() => onPause('today'))}>
              Pause for today
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void act(onResume)}>
            Resume checks
          </Button>
        )}
        <a className="sts-act" href={sectionHash('check')}>
          Check due pages now
        </a>
      </div>
      {queue.state !== 'running' && queue.running > 0 ? (
        <span className="faint sts-small">
          The {queue.running} running {queue.running === 1 ? 'check finishes' : 'checks finish'};
          waiting checks stay in the queue.
        </span>
      ) : null}
      {error ? (
        <span className="st-problem" role="alert">
          {error}
        </span>
      ) : null}
    </StatusSection>
  )
}

/** This month's searches per project against its cap, and the month's pace (FR-11.4, FR-24.5). */
export function UsageSection({
  queue,
  now,
  usage,
  names
}: {
  queue: QueueStatus
  now: Date
  usage: ProjectUsageReport | null
  names: ProjectNames
}): JSX.Element {
  const pace = usagePace(queue, now)
  const { open } = useDrill()
  type Row = QueueStatus['projects'][number]
  const settingsHref = (project: Row): string =>
    names.activeId === project.projectId ? sectionHash('project-settings') : sectionHash('projects')
  const usedText = (project: Row): string =>
    project.cap === null
      ? `${count(project.used)} · no cap`
      : `${count(project.used)} of ${count(project.cap)}`
  const columns: readonly ListColumn<Row>[] = [
    {
      id: 'project',
      label: 'Project',
      width: 'fill',
      minWidth: 200,
      sort: (project) => project.name.toLowerCase(),
      render: (project) => (
        <span className="sts-project">
          <a
            href={settingsHref(project)}
            aria-label={
              names.activeId === project.projectId
                ? `${project.name}: open Project settings`
                : `${project.name}: open Projects`
            }
          >
            {project.name}
          </a>
          {project.paused ? <Chip size="sm">Paused</Chip> : null}
          {project.dedicatedKeyId ? <Chip size="sm">Own key</Chip> : null}
        </span>
      )
    },
    {
      id: 'used',
      label: 'Searches',
      width: 150,
      numeric: true,
      sort: (project) => project.used,
      render: (project) => (
        <DrillButton
          drill={projectUsageDrill(project, usage, names)}
          className="m3-link"
          label={`${usedText(project)}: ${project.name} searches this month, show the split`}
          untracked
        >
          {usedText(project)}
        </DrillButton>
      )
    },
    {
      id: 'bar',
      label: 'Of the cap',
      width: 140,
      render: (project) =>
        project.cap !== null ? (
          <UsageBar
            used={project.used}
            limit={project.cap}
            label={`${project.name}: ${count(project.used)} of ${count(project.cap)} searches used this month`}
          />
        ) : (
          <span className="faint">No cap</span>
        )
    },
    {
      id: 'share',
      label: 'Share',
      width: 90,
      numeric: true,
      sort: (project) => project.used,
      render: (project) =>
        pace.used > 0 ? `${Math.round((project.used / pace.used) * 100)}%` : '—'
    },
    {
      id: 'rule',
      label: 'At the cap',
      width: 230,
      render: (project) =>
        project.cap !== null ? capRuleLabel(project.capRule) : <span className="faint">—</span>
    }
  ]
  return (
    <section className="sts-section" aria-labelledby="st-usage">
      <SectionHead
        id="st-usage"
        title="This month's searches by project"
        description={
          <>
            <span className="num">{count(pace.used)}</span> searches in {pace.dayOfMonth}{' '}
            {pace.dayOfMonth === 1 ? 'day' : 'days'} (per calendar month). At this pace, about{' '}
            <span className="num">{count(pace.projected)}</span> by {pace.monthEnd}.
          </>
        }
      />
      <ListGrid<Row>
        urlKey="sq"
        label="Projects"
        noun={['project', 'projects']}
        rows={queue.projects}
        rowKey={(project) => project.projectId}
        rowLabel={(project) => project.name}
        columns={columns}
        initialSort={[{ key: 'used', dir: 'desc' }]}
        rowMenu={(project) => [
          {
            id: 'split',
            label: 'Show the split by key',
            icon: 'layers',
            onSelect: () => open(projectUsageDrill(project, usage, names))
          },
          {
            id: 'settings',
            label: names.activeId === project.projectId ? 'Open Project settings' : 'Open Projects',
            icon: 'sliders',
            onSelect: () => navigateHash(settingsHref(project))
          }
        ]}
        empty={<EmptyState icon="search" title="No project has used a search this month." />}
      />
    </section>
  )
}

function capRuleLabel(rule: QueueStatus['projects'][number]['capRule']): string {
  if (rule === 'pause') return 'pauses until the cap resets'
  if (rule === 'notify') return 'notifies and waits at the cap'
  return 'allows 10% over the cap'
}
