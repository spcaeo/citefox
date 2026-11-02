import { useMemo, type JSX } from 'react'
import type { DeliveryRecord, ReportScheduleListItem } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import type { AssistClient } from '../../../assist/client'
import { describeScope, useScopeOptions, type ScopeSource } from '../../../scope'
import { marketLabel } from '../../../shell/model'
import { closeDrawer, setDrawerParams } from '../../../shell/drawers'
import { botParam, Drawer, type HelpFillSource } from '../../../ui'
import type { SchedulesClient } from '../../schedulesClient'
import {
  accountLabel,
  marketSummary,
  mailPreview,
  nextSendLine,
  projectDisplay,
  toScheduleRow,
  type AccountOption,
  type MarketOption,
  type ScheduleDraft
} from '../../scheduleModel'
import type { OwnVoiceState } from '../components/OwnVoiceSummary'
import { PreviewCard } from '../components/PreviewCard'
import { useSummaryPage } from '../useSummaryPage'
import { marketsFor, namedProject } from '../utils/projects'
import { NEW_SCHEDULE, openDuplicate, readScheduleDrawer } from '../utils/scheduleUrl'
import type { SummaryPageLookup } from '../utils/summaryPage'
import { ScheduleView } from './ScheduleView'
import { SendNowConfirm } from './SendNowConfirm'
import { useSendNow } from './useSendNow'
import { SectionsBox } from './sections/SectionsBox'
import { WhatSection } from './sections/WhatSection'
import { WhenSection } from './sections/WhenSection'
import { WhoSection } from './sections/WhoSection'
import { useScheduleEditor } from './useScheduleEditor'

/** What the drawer reads: the screen's loaded schedules, deliveries and accounts. */
export interface ScheduleDrawerData {
  items: readonly ReportScheduleListItem[]
  deliveries: readonly DeliveryRecord[]
  accounts: readonly AccountOption[]
  projects: readonly ProjectDetail[]
  timeZone: string
  loaded: boolean
}

export interface ScheduleDrawerProps {
  depth: number
  params: Readonly<Record<string, string>>
  client: SchedulesClient
  data: ScheduleDrawerData
  /** The open project: a new schedule starts on it. */
  currentProjectId: string | null
  summaryPage?: SummaryPageLookup | null
  reload: () => Promise<void>
  /** Opens one delivery (Reports' Delivery history). Null: deliveries are text. */
  onOpenDelivery?: ((deliveryId: string) => void) | null
  onOpenProject?: ((projectId: string) => void) | null
  /** After Save, before the drawer closes. */
  onSaved?: (row: ReportScheduleListItem) => void
  /** Tests only. */
  assistClient?: AssistClient
  helpSource?: HelpFillSource
  scopeSource?: ScopeSource | null
  now?: Date
}

/**
 * One drawer for a report schedule (`drawer=schedule`): its details
 * (`schedule.mode` view), or the form (edit, and every new one) with the
 * settings on the left (What, When, Who, Sections) and the live email preview
 * on the right. Footer: the next send, Send a test now, Save schedule.
 */
export function ScheduleDrawer({
  depth,
  params,
  client,
  data,
  currentProjectId,
  summaryPage = null,
  reload,
  onOpenDelivery = null,
  onOpenProject = null,
  onSaved,
  assistClient,
  helpSource,
  scopeSource = null,
  now: givenNow
}: ScheduleDrawerProps): JSX.Element {
  const state = readScheduleDrawer(params)
  const now = useMemo(() => givenNow ?? new Date(), [givenNow])
  const named = useMemo(() => data.projects.map(namedProject), [data.projects])
  const editor = useScheduleEditor({
    state,
    items: data.items,
    loaded: data.loaded,
    projects: data.projects,
    currentProjectId,
    zone: data.timeZone,
    client,
    reload
  })
  const item = data.items.find((schedule) => schedule.id === state.id) ?? null
  const projectId =
    state.mode === 'edit' ? (editor.draft?.projectId ?? null) : (item?.projectId ?? null)
  const scope = useScopeOptions(projectId, scopeSource)
  const scopeOptions = scope.options?.projectId === projectId ? scope.options : null
  const summarySource = useSummaryPage(editor.draft?.projectId ?? null, summaryPage)
  const sending = useSendNow(client, data.timeZone, reload)
  const close = (): void => closeDrawer(depth)

  if (state.mode === 'view') {
    if (!item) {
      return (
        <Drawer
          id="schedule"
          title="Report schedule"
          onClose={close}
          loading={!data.loaded}
          {...(data.loaded
            ? {
                error: {
                  message: 'That schedule is not on this computer. It may have been deleted.'
                }
              }
            : {})}
          footer={{ cancel: 'Close' }}
        />
      )
    }
    const row = toScheduleRow(item, named, data.deliveries, data.timeZone)
    return (
      <Drawer
        id="schedule"
        title={item.name}
        subtitle={`Scheduled report · ${row.project}`}
        status={
          <span
            className={`ui-chip ui-chip-sm ${item.status === 'active' ? 'ui-chip-ok' : 'ui-chip-neutral'}`}
          >
            {item.status === 'active' ? 'On' : 'Off'}
          </span>
        }
        focusOnOpen="close"
        onClose={close}
        testId="schedule-drawer"
        attributes={{ 'data-schedule-mode': 'view' }}
        footer={{
          summary: item.status === 'paused' ? 'Off: nothing is sent' : `Next send ${row.next}`,
          cancel: 'Close',
          secondary: { label: 'Duplicate', onClick: () => openDuplicate(item.id) },
          primary: {
            label: 'Edit schedule',
            onClick: () => setDrawerParams(depth, { 'schedule.mode': 'edit' }, { push: true })
          }
        }}
      >
        <ScheduleView
          item={item}
          row={row}
          deliveries={data.deliveries}
          projects={data.projects}
          accounts={data.accounts}
          timeZone={data.timeZone}
          scopeOptions={scopeOptions}
          onSendNow={() => sending.ask(item)}
          onOpenDelivery={(id) => onOpenDelivery?.(id)}
          onOpenProject={onOpenProject}
          sendNote={sending.note}
        />
        {sending.target ? (
          <SendNowConfirm
            item={sending.target}
            from={accountLabel(sending.target.accountId, data.accounts)}
            busy={sending.busy}
            onConfirm={() => void sending.confirm()}
            onCancel={sending.cancel}
          />
        ) : null}
      </Drawer>
    )
  }

  const draft = editor.draft
  const isNew = state.id === NEW_SCHEDULE
  const title = isNew ? (state.from ? 'Duplicate schedule' : 'New schedule') : 'Edit schedule'
  const notFound = !isNew && data.loaded && !item
  return (
    <Drawer
      id="schedule"
      title={title}
      {...(item && !isNew
        ? {
            trail: [
              {
                label: item.name,
                onSelect: () => setDrawerParams(depth, { 'schedule.mode': null })
              }
            ]
          }
        : {})}
      subtitle={
        isNew
          ? 'CiteFox builds the report from the latest check and emails it.'
          : 'Changes apply from the next send.'
      }
      dirty={editor.dirty}
      guard={{
        title: `Discard changes to ${draft?.name.trim() || (isNew ? 'this new schedule' : 'this schedule')}?`,
        body: 'Your changes to this schedule are not saved.',
        keepLabel: 'Keep editing',
        discardLabel: 'Discard'
      }}
      closeDisabled={editor.busy}
      busy={editor.busy}
      loading={draft === null && !notFound}
      {...(notFound
        ? { error: { message: 'That schedule is not on this computer. It may have been deleted.' } }
        : {})}
      onClose={close}
      testId="schedule-drawer"
      attributes={{ 'data-schedule-mode': 'edit' }}
      footer={
        draft
          ? {
              summary: (
                <span className="rpt-sd-foot">
                  <span data-testid="sd-next-send">{nextSendLine(draft, now)}</span>
                  {editor.testNote ? (
                    <span className="rpt-help" role="status">
                      {editor.testNote}
                    </span>
                  ) : (
                    <span className="rpt-help">Tests go only to you.</span>
                  )}
                </span>
              ),
              secondary: {
                label: 'Send a test now',
                onClick: () => void editor.sendTest(),
                disabled: editor.busy
              },
              primary: {
                label: 'Save schedule',
                disabled: editor.issue !== null,
                busy: editor.busy,
                onClick: () =>
                  void editor.save().then((saved) => {
                    if (!saved) return
                    onSaved?.(saved)
                    close()
                  })
              }
            }
          : { cancel: 'Close' }
      }
    >
      {draft ? (
        <EditBody
          draft={draft}
          patch={editor.patch}
          named={named}
          data={data}
          scopeOptions={scopeOptions}
          scopeError={scope.error}
          query={params['schedule.q'] ?? ''}
          onQuery={(query) => setDrawerParams(depth, { 'schedule.q': query || null })}
          message={editor.message}
          issue={editor.issue}
          now={now}
          summarySource={summarySource}
          assistClient={assistClient}
          ownVoice={
            params['schedule.help'] === 'chatbot'
              ? {
                  scheduleId: isNew ? null : state.id,
                  bot: botParam(params['schedule.bot']),
                  onBot: (bot) => setDrawerParams(depth, { 'schedule.bot': bot }),
                  onClose: () =>
                    setDrawerParams(depth, { 'schedule.help': null, 'schedule.bot': null }),
                  ...(helpSource ? { helpSource } : {})
                }
              : null
          }
          onOwnVoice={() => setDrawerParams(depth, { 'schedule.help': 'chatbot' }, { push: true })}
        />
      ) : null}
    </Drawer>
  )
}

function EditBody({
  draft,
  patch,
  named,
  data,
  scopeOptions,
  scopeError,
  query,
  onQuery,
  message,
  issue,
  now,
  summarySource,
  assistClient,
  ownVoice,
  onOwnVoice
}: {
  draft: ScheduleDraft
  patch: (partial: Partial<ScheduleDraft>) => void
  named: ReturnType<typeof namedProject>[]
  data: ScheduleDrawerData
  scopeOptions: ReturnType<typeof useScopeOptions>['options']
  scopeError: string | null
  query: string
  onQuery: (query: string) => void
  message: { reason: string; nextStep: string | null } | null
  issue: string | null
  now: Date
  summarySource: ReturnType<typeof useSummaryPage>
  assistClient?: AssistClient | undefined
  ownVoice: Omit<OwnVoiceState, 'projectId'> | null
  onOwnVoice: () => void
}): JSX.Element {
  const markets: MarketOption[] =
    draft.projectId !== null && scopeOptions
      ? scopeOptions.markets.map((market) => ({ id: market.id, label: marketLabel(market) }))
      : marketsFor(draft.projectId, data.projects)
  const projectName = projectDisplay(draft.projectId, named).name
  const scopeText =
    draft.projectId === null || draft.scope.kind === 'project'
      ? null
      : describeScope({ kind: draft.scope.kind, ids: draft.scope.ids }, scopeOptions)
  const preview = mailPreview(
    draft,
    projectName,
    marketSummary(draft.marketIds, markets),
    accountLabel(draft.accountId, data.accounts),
    scopeText
  )
  const hasTopic =
    draft.scope.kind === 'topic' ||
    (draft.scope.kind === 'project' && (scopeOptions?.topics.length ?? 0) > 0)
  return (
    <div className="rpt-sd-cols">
      <div className="rpt-sd-form rpt-form" id="new-schedule">
        {message ? (
          <p className="rpt-alert" role="alert">
            {message.reason}
            {message.nextStep ? ` ${message.nextStep}` : ''}
          </p>
        ) : issue && draft.name.trim() !== '' && draft.recipients.length > 0 ? (
          <p className="rpt-help" role="status">
            {issue}
          </p>
        ) : null}
        <WhatSection
          draft={draft}
          patch={patch}
          named={named}
          markets={markets}
          scope={{ options: scopeOptions, error: scopeError, query, onQuery }}
        />
        <WhenSection
          draft={draft}
          patch={patch}
          projectName={draft.projectId ? projectName : null}
          now={now}
        />
        <WhoSection draft={draft} patch={patch} accounts={data.accounts} />
        {/* A ready report has its own sections, the same as Reports shows. */}
        {draft.report === null ? (
          <SectionsBox draft={draft} patch={patch} hasTopic={hasTopic} />
        ) : null}
      </div>
      <aside className="rpt-sd-preview" aria-label="Email preview">
        <PreviewCard
          preview={preview}
          source={summarySource}
          {...(assistClient ? { assistClient } : {})}
          onApply={(style) => patch({ summaryStyle: style })}
          ownVoice={ownVoice}
          onOwnVoice={onOwnVoice}
        />
      </aside>
    </div>
  )
}
