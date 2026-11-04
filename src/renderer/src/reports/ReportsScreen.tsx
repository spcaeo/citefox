import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { PageSummary } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import type { ReportKind } from '@shared/report/review'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { ScreenHeader } from '../components/Header'
import { LoadError } from '../components/LoadError'
import { Button, Confirm, EmptyState, LinkButton, TabPanel, Tabs, type HelpFillSource } from '../ui'
import { DrillHost } from '../drill'
import { createGridCsvExport, type GridCsvExport } from '../grid'
import type { ScopeSource } from '../scope'
import { DrawerLevel, ScreenDrawerLevel } from '../shell/DrawerLevel'
import { closeDrawersThen, useDrawerStack } from '../shell/drawers'
import { alertsHash, sectionHash } from '../shell/routes'
import { useHashQuery } from '../utils/hashQuery'
import {
  DEFAULT_ON_SUFFIX,
  accountLabel,
  toDeliveryRow,
  toScheduleRow,
  userTimeZone,
  withoutDeletedSchedule,
  type DeliveryRow,
  type Explained,
  type ScheduleRow
} from './scheduleModel'
import { reportNotFound, toReportsDeleteRequest } from './reportsDelete'
import type { SchedulesClient } from './schedulesClient'
import { namedProject } from './schedules/utils/projects'
import { nextDrill, recipientsDrill, sectionsDrill } from './schedules/utils/drills'
import { SchedulesSection, type ScheduleDrills } from './schedules/components/SchedulesSection'
import type { SummaryPageLookup } from './schedules/utils/summaryPage'
import { HistorySection } from './schedules/components/HistorySection'
import { DeliveryDetail } from './schedules/components/DeliveryDetail'
import { ScheduleDrawer } from './schedules/drawer/ScheduleDrawer'
import { SendNowConfirm } from './schedules/drawer/SendNowConfirm'
import { useSendNow } from './schedules/drawer/useSendNow'
import {
  IMPACT_PRESET,
  SCHEDULE_DRAWER,
  deliveryHash,
  openDuplicate,
  openNewSchedule,
  openSchedule,
  readyReportScheduleParams
} from './schedules/utils/scheduleUrl'
import { AllSendsSection } from './sends/AllSendsSection'
import { sendRows } from './sends/sendsModel'
import { useProjectSends, type SendsSource } from './sends/useProjectSends'
import { useReportsData } from './useReportsData'
import type { ReviewClient } from './review/client'
import { ReportsHome } from './review/ReportsHome'
import { ReviewView, type ReviewProject } from './review/ReviewView'
import { homeTabOf, reportOf, REVIEW_KEYS, type HomeTab, type ReviewQuery } from './review/urlState'
import './schedules.css'
import './review/review.css'
import './review/shared-parts.css'

type ReportsTab = 'schedules' | 'history' | 'sends'

const TABS_ID = 'rpt-tabs'
const HOME_TABS_ID = 'rpt-home'

/** The report's own values: they leave the URL when the report closes. */
const REPORT_VALUES = {
  report: null,
  section: null,
  scope: null,
  from: null,
  to: null,
  market: null,
  seg: null,
  show: null,
  pshow: null,
  q: null,
  rival: null,
  qsort: null,
  csort: null,
  pq: null,
  psort: null
} as const

/** Scheduled emails' list filters: they leave the URL when another list opens. */
const LIST_VALUES = { sf: null, hf: null, hv: null, af: null } as const

function tabOf(view: string | null | undefined): ReportsTab {
  return view === 'history' || view === 'sends' ? view : 'schedules'
}

export function ReportsScreen({
  client,
  projects = [],
  currentProjectId = null,
  timeZone,
  exportCsv,
  onOpenProject = null,
  summaryPage = null,
  assistClient,
  helpSource,
  sendsSource = null,
  scopeSource = null,
  reviewClient = null,
  project = null,
  pages = []
}: {
  client: SchedulesClient
  /** Where the ready reports read their numbers. Null: Ready reports shows a note. */
  reviewClient?: ReviewClient | null
  /** The open project, for the ready reports. */
  project?: ReviewProject | null
  /** Its pages and topics, for the report's Scope picker. */
  pages?: readonly Pick<PageSummary, 'id' | 'label' | 'title' | 'url' | 'kind'>[]
  projects?: readonly ProjectDetail[]
  /** The open project: a new schedule starts on it. */
  currentProjectId?: string | null
  timeZone?: string
  /** Export CSV for the schedules grid. Unset uses `grid:exportCsv`; null hides it. */
  exportCsv?: GridCsvExport | null
  /** Switches to a project and opens it. Null: project names are text. */
  onOpenProject?: ((projectId: string) => void) | null
  /** Finds the page the AI summary preview reads. Null: the AI actions stay off. */
  summaryPage?: SummaryPageLookup | null
  /** Tests only. Production picks the assist client from the client mode. */
  assistClient?: AssistClient
  /** Tests only: the Email preview's "own voice" ✦ channels. */
  helpSource?: HelpFillSource
  /** Tests only: where All sends reads alerts and automatic export. */
  sendsSource?: SendsSource | null
  /** Tests only: where the scope picker reads pages, groups and topics. */
  scopeSource?: ScopeSource | null
}): JSX.Element {
  const schedules = client
  const csv = useMemo(
    () => (exportCsv === undefined ? createGridCsvExport() : exportCsv),
    [exportCsv]
  )
  const zone = timeZone ?? userTimeZone()
  const named = useMemo(() => projects.map(namedProject), [projects])
  const data = useReportsData(schedules)
  const { items, deliveries, accounts, loaded, reload } = data
  const loadProblem = data.problem
  const [unavailable, setUnavailable] = useState<Explained | null>(null)
  const [resent, setResent] = useState<Readonly<Record<string, true>>>({})
  const [deleteTarget, setDeleteTarget] = useState<ScheduleRow | null>(null)
  const [focusScheduleId, setFocusScheduleId] = useState<string | null | undefined>(undefined)
  const [query, setQuery] = useHashQuery(REVIEW_KEYS)
  // With no project open there is no ready report: Scheduled emails (every project) leads.
  const homeTab = homeTabOf(query, reviewClient !== null && project !== null)
  const openReport = reportOf(query)
  const tab = tabOf(query.view)
  const setTab = (next: ReportsTab): void =>
    setQuery({
      ...LIST_VALUES,
      tab: 'emails',
      view: next === 'schedules' ? null : next,
      delivery: null
    })
  const setHomeTab = (next: HomeTab): void =>
    setQuery({
      ...REPORT_VALUES,
      ...LIST_VALUES,
      tab: next === 'ready' ? null : 'emails',
      view: null,
      delivery: null
    })
  const showReport = (kind: ReportKind, extra: Readonly<Record<string, string>> = {}): void =>
    setQuery({
      ...REPORT_VALUES,
      tab: null,
      view: null,
      layout: null,
      report: kind,
      ...(extra as ReviewQuery)
    })
  // A card's or report's "Email on a schedule": a new schedule of that ready report
  // (Head-to-head keeps the rival picked on the URL; none is the top competitor).
  const scheduleReport = (kind: ReportKind): void => {
    const rival = kind === 'rival' ? (query.rival ?? null) : null
    setQuery({ ...REPORT_VALUES, tab: 'emails', view: null, delivery: null })
    openNewSchedule(readyReportScheduleParams(kind, rival, currentProjectId))
  }
  const deleteOpener = useRef<HTMLElement | null>(null)
  const neighborAfterDelete = useRef<string | null>(null)
  const pendingAlertFocus = useRef(false)
  const { stack } = useDrawerStack()
  const sending = useSendNow(schedules, zone, reload)

  const projectIds = useMemo(() => projects.map((project) => project.id), [projects])
  const sends = useProjectSends(projectIds, sendsSource, tab === 'sends')
  const allSends = useMemo(
    () => sendRows(items, sends.sends, projects, named),
    [items, sends.sends, projects, named]
  )
  const sendProblems = useMemo(
    () =>
      sends.sends.flatMap((entry) => {
        if (!entry.problem) return []
        const name = projects.find((project) => project.id === entry.projectId)?.name ?? 'A project'
        return [`${name}: ${entry.problem}`]
      }),
    [sends.sends, projects]
  )

  useEffect(() => {
    if (!pendingAlertFocus.current || !unavailable) return
    pendingAlertFocus.current = false
    document.getElementById('rpt-alert')?.focus()
  }, [unavailable])

  const scheduleRows = useMemo(
    () => items.map((item) => toScheduleRow(item, named, deliveries, zone)),
    [items, named, deliveries, zone]
  )
  const deliveryRows = useMemo(
    () => deliveries.map((item) => toDeliveryRow(item, items, named, zone)),
    [deliveries, items, named, zone]
  )
  const drills = useMemo(
    () =>
      new Map<string, ScheduleDrills>(
        items.map((item) => [
          item.id,
          {
            sections: sectionsDrill(item),
            recipients: recipientsDrill(item, deliveries, zone),
            next: nextDrill(item)
          }
        ])
      ),
    [items, deliveries, zone]
  )
  const activeCount = scheduleRows.filter((row) => row.status === 'active').length
  // What Ask CiteFox knows here: the schedule open in its drawer, the open delivery and
  // the totals (feat/assistant, on the drawer-based screen).
  const scheduleEntry = stack.find((entry) => entry.id === SCHEDULE_DRAWER)
  const openScheduleId = scheduleEntry?.params['schedule.id'] ?? null
  const openScheduleRow =
    openScheduleId === null ? undefined : scheduleRows.find((row) => row.id === openScheduleId)
  const openDeliveryRow =
    query.delivery == null ? undefined : deliveryRows.find((row) => row.id === query.delivery)
  const scheduleEditing =
    scheduleEntry !== undefined && scheduleEntry.params['schedule.mode'] === 'edit'
  useAiContext({
    entities: [
      ...(openScheduleRow
        ? [
            {
              kind: 'report' as const,
              id: openScheduleRow.id,
              label: openScheduleRow.name,
              detail: openScheduleRow.when
            }
          ]
        : []),
      ...(openDeliveryRow
        ? [
            {
              kind: 'report' as const,
              id: openDeliveryRow.id,
              label: openDeliveryRow.name,
              detail: `${openDeliveryRow.result} · ${openDeliveryRow.dateLabel}`
            }
          ]
        : [])
    ],
    numbers: [
      { label: 'Schedules', value: String(scheduleRows.length) },
      { label: 'Active schedules', value: String(activeCount) },
      { label: 'Deliveries', value: String(deliveryRows.length) },
      {
        label: 'Failed deliveries',
        value: String(deliveryRows.filter((row) => row.result === 'Failed').length)
      }
    ],
    facts:
      openScheduleId === 'new'
        ? ['Making a new schedule']
        : scheduleEditing
          ? [`Editing the schedule ${openScheduleRow?.name || 'without a name'}`]
          : []
  })

  async function toggle(row: ScheduleRow): Promise<void> {
    const status = row.status === 'active' ? 'paused' : 'active'
    const saved = await schedules.setStatus({ id: row.id, status })
    if (saved.unavailable) {
      setUnavailable(saved.unavailable)
      return
    }
    setUnavailable(null)
    await reload()
  }

  async function resend(row: DeliveryRow): Promise<void> {
    const saved = await schedules.resend({ id: row.id })
    if (saved.unavailable || !saved.row) {
      setUnavailable(saved.unavailable)
      return
    }
    setResent((current) => ({ ...current, [row.id]: true }))
    await reload()
  }

  function askDelete(row: ScheduleRow, opener: HTMLElement, neighborId: string | null): void {
    deleteOpener.current = opener
    neighborAfterDelete.current = neighborId
    setDeleteTarget(row)
  }

  function closeDelete(): void {
    setDeleteTarget(null)
    const opener = deleteOpener.current
    deleteOpener.current = null
    opener?.focus()
  }

  function showNotFound(reason: string): void {
    pendingAlertFocus.current = true
    setUnavailable({ reason, nextStep: null })
  }

  async function confirmDelete(neighborId: string | null): Promise<void> {
    const row = deleteTarget
    if (!row) return
    setDeleteTarget(null)
    deleteOpener.current = null
    const item = items.find((schedule) => schedule.id === row.id)
    if (!item) {
      await reload()
      showNotFound(reportNotFound().message)
      return
    }
    const saved = await schedules.deleteSchedule(toReportsDeleteRequest(item))
    if (saved.notFound) {
      await reload()
      showNotFound(saved.unavailable?.reason ?? reportNotFound().message)
      return
    }
    if (saved.unavailable || !saved.result) {
      setUnavailable(
        saved.unavailable ?? { reason: 'Could not delete that schedule.', nextStep: null }
      )
      return
    }
    setUnavailable(null)
    data.setItems((current) => withoutDeletedSchedule(current, row.id))
    await reload()
    setFocusScheduleId(neighborId)
  }

  async function setStatuses(
    rows: readonly ScheduleRow[],
    status: 'active' | 'paused'
  ): Promise<void> {
    for (const row of rows) {
      if (row.status === status) continue
      const saved = await schedules.setStatus({ id: row.id, status })
      if (saved.unavailable) {
        setUnavailable(saved.unavailable)
        break
      }
    }
    await reload()
  }

  function openProject(projectId: string): void {
    setQuery({ delivery: null }, { replace: true })
    onOpenProject?.(projectId)
  }
  const projectOpener = onOpenProject ? openProject : null

  function openDelivery(deliveryId: string): void {
    setQuery({ tab: 'emails', view: 'history', delivery: deliveryId })
  }

  function scheduleFromDelivery(scheduleId: string): void {
    setQuery({ delivery: null }, { replace: true })
    openSchedule(scheduleId)
  }

  const deliveryId = query.delivery ?? null
  const deliveryRecord = deliveryId
    ? (deliveries.find((delivery) => delivery.id === deliveryId) ?? null)
    : null
  const deliveryRow = deliveryId
    ? (deliveryRows.find((delivery) => delivery.id === deliveryId) ?? null)
    : null

  return (
    <DrillHost>
      <div className="rpt">
        <ScreenHeader
          title="Reports"
          subtitle={
            homeTab === 'emails' ? (
              <p className="muted">
                Reports CiteFox emails for you, through the accounts in{' '}
                <a href={alertsHash('email')}>Email setup</a>.
              </p>
            ) : (
              <p className="muted">
                Ready-made reports of your checks. Open one here, or download it as one file.
              </p>
            )
          }
          {...(homeTab === 'emails'
            ? {
                primary: (
                  <Button
                    id="rpt-new-schedule"
                    variant="primary"
                    icon="plus"
                    onClick={() => openNewSchedule()}
                  >
                    New schedule
                  </Button>
                )
              }
            : {})}
        />
        {openReport === null ? (
          <Tabs
            label="Reports"
            panelId={HOME_TABS_ID}
            value={homeTab}
            onChange={setHomeTab}
            tabs={[
              { id: 'ready', label: 'Ready reports' },
              { id: 'emails', label: 'Scheduled emails', count: scheduleRows.length }
            ]}
          />
        ) : null}
        {homeTab === 'ready' ? (
          <TabPanel panelId={HOME_TABS_ID} id="ready" className="rpt-tabpanel">
            {reviewClient === null || project === null ? (
              <div className="ui-panel rpt-empty">
                <EmptyState
                  title="Open a project first."
                  body="Ready reports are built from a project's checks."
                  level={2}
                />
              </div>
            ) : openReport === null ? (
              <ReportsHome
                client={reviewClient}
                project={project}
                onOpen={showReport}
                onSchedule={scheduleReport}
              />
            ) : (
              <ReviewView
                key={`${project.id}:${openReport}`}
                kind={openReport}
                client={reviewClient}
                project={project}
                pages={pages}
                query={query}
                setQuery={setQuery}
                onHome={() => setHomeTab('ready')}
                onSchedule={() => scheduleReport(openReport)}
              />
            )}
          </TabPanel>
        ) : null}
        {homeTab === 'emails' ? (
          <TabPanel panelId={HOME_TABS_ID} id="emails" className="rpt-tabpanel">
            {unavailable ? (
              <p id="rpt-alert" className="rpt-alert" role="alert" tabIndex={-1}>
                {unavailable.reason}
                {unavailable.nextStep ? ` ${unavailable.nextStep}` : ''}
              </p>
            ) : null}
            {sending.note ? (
              <p className="rpt-help" role="status" data-testid="rpt-sendnow-note">
                {sending.note}
              </p>
            ) : null}
            {loaded && projects.length > 0 ? (
              <div className="rpt-preset" data-testid="impact-preset">
                <span>
                  <b>Impact review every 14 days.</b> After each check, email what your fixes did:
                  the verdict, pages published, what changed and what to do next.
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    openNewSchedule({
                      'schedule.preset': IMPACT_PRESET,
                      ...(currentProjectId ? { 'schedule.project': currentProjectId } : {})
                    })
                  }
                >
                  Set it up
                </Button>
              </div>
            ) : null}
            {!loaded ? <p role="status">Loading schedules…</p> : null}
            {loadProblem ? (
              <LoadError
                title={loadProblem.title}
                message={loadProblem.message}
                onRetry={() => void reload()}
              />
            ) : null}
            {loaded && projects.length === 0 ? (
              <div className="ui-panel rpt-empty">
                <EmptyState
                  title="Create a project first."
                  body="Reports are built from a project's checks."
                  level={2}
                  action={
                    <LinkButton size="sm" href={sectionHash('new-project')}>
                      New project
                    </LinkButton>
                  }
                />
              </div>
            ) : null}
            <Tabs
              label="Scheduled emails"
              size="sm"
              panelId={TABS_ID}
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'schedules', label: 'Schedules', count: scheduleRows.length },
                { id: 'history', label: 'Delivery history', count: deliveryRows.length },
                {
                  id: 'sends',
                  label: 'All sends',
                  ...(sends.loaded ? { count: allSends.length } : {})
                }
              ]}
            />
            {tab === 'schedules' ? (
              <TabPanel panelId={TABS_ID} id="schedules" className="rpt-tabpanel">
                <SchedulesSection
                  rows={scheduleRows}
                  activeCount={activeCount}
                  onSuffix={DEFAULT_ON_SUFFIX}
                  loaded={loaded && !loadProblem?.schedules}
                  onToggle={(row) => void toggle(row)}
                  onSetStatus={(rows, status) => void setStatuses(rows, status)}
                  onEdit={(row) => openSchedule(row.id, 'edit')}
                  onDuplicate={(row) => openDuplicate(row.id)}
                  onSendNow={(row) => {
                    const item = items.find((schedule) => schedule.id === row.id)
                    if (item) sending.ask(item)
                  }}
                  onDelete={(row, neighborId, opener) => askDelete(row, opener, neighborId)}
                  focusScheduleId={focusScheduleId}
                  onFocusHandled={() => setFocusScheduleId(undefined)}
                  drills={drills}
                  open={{
                    schedule: (row) => openSchedule(row.id),
                    delivery: openDelivery,
                    project: projectOpener
                  }}
                  exportCsv={csv}
                  onNew={() => openNewSchedule()}
                />
              </TabPanel>
            ) : tab === 'history' ? (
              <TabPanel panelId={TABS_ID} id="history" className="rpt-tabpanel">
                <HistorySection
                  exportCsv={csv}
                  rows={deliveryRows}
                  loaded={loaded && !loadProblem?.deliveries}
                  resent={resent}
                  onResend={(row) => void resend(row)}
                  open={{
                    delivery: (row) => openDelivery(row.id),
                    schedule: (id) => openSchedule(id),
                    project: projectOpener
                  }}
                />
              </TabPanel>
            ) : (
              <TabPanel panelId={TABS_ID} id="sends" className="rpt-tabpanel">
                <AllSendsSection
                  rows={allSends}
                  loaded={loaded && sends.loaded}
                  problems={sendProblems}
                />
              </TabPanel>
            )}
          </TabPanel>
        ) : null}
        {deleteTarget ? (
          <Confirm
            title="Delete this schedule?"
            body={`${deleteTarget.name} will leave this list. It will not send again. Past deliveries stay in history.`}
            confirmLabel="Delete"
            onCancel={closeDelete}
            onConfirm={() => void confirmDelete(neighborAfterDelete.current)}
          />
        ) : null}
        {sending.target ? (
          <SendNowConfirm
            item={sending.target}
            from={accountLabel(sending.target.accountId, accounts)}
            busy={sending.busy}
            onConfirm={() => void sending.confirm()}
            onCancel={sending.cancel}
          />
        ) : null}
        {/* The drawers sit inside the screen, so `.rpt #new-schedule` finds the form. */}
        {deliveryId ? (
          <ScreenDrawerLevel onClose={() => setQuery({ delivery: null })}>
            <DeliveryDetail
              record={deliveryRecord}
              row={deliveryRow}
              items={items}
              resent={Boolean(resent[deliveryId])}
              loading={!loaded}
              onClose={() => setQuery({ delivery: null })}
              onResend={(row) => void resend(row)}
              onOpenSchedule={scheduleFromDelivery}
              onOpenProject={projectOpener}
            />
          </ScreenDrawerLevel>
        ) : null}
        {stack.map((entry, depth) =>
          entry.id === SCHEDULE_DRAWER ? (
            <DrawerLevel key={`${depth}:${entry.id}`} depth={depth}>
              <ScheduleDrawer
                depth={depth}
                params={entry.params}
                client={schedules}
                data={{ items, deliveries, accounts, projects, timeZone: zone, loaded }}
                currentProjectId={currentProjectId}
                summaryPage={summaryPage}
                reload={reload}
                onOpenDelivery={(id) => closeDrawersThen(deliveryHash(id))}
                onOpenProject={projectOpener}
                {...(assistClient ? { assistClient } : {})}
                {...(helpSource ? { helpSource } : {})}
                scopeSource={scopeSource}
              />
            </DrawerLevel>
          ) : null
        )}
      </div>
    </DrillHost>
  )
}
