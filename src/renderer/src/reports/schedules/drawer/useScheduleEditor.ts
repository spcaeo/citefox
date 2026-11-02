import { useCallback, useMemo, useState } from 'react'
import type { ReportScheduleListItem } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import type { SchedulesClient } from '../../schedulesClient'
import {
  buildSchedule,
  draftFromSchedule,
  draftIssues,
  duplicateDraft,
  emptyDraft,
  type Explained,
  type ScheduleDraft
} from '../../scheduleModel'
import { NEW_SCHEDULE, type ScheduleDrawerState } from '../utils/scheduleUrl'

export interface ScheduleEditor {
  /** Null until the schedule it edits has loaded. */
  draft: ScheduleDraft | null
  patch: (partial: Partial<ScheduleDraft>) => void
  dirty: boolean
  issue: string | null
  message: Explained | null
  testNote: string | null
  busy: boolean
  /** Saves; resolves with the stored row, or null when it was not saved. */
  save: () => Promise<ReportScheduleListItem | null>
  /** Saves, then sends a test to the sending account only. */
  sendTest: () => Promise<void>
}

/** The first draft of a new schedule: the open project, then Export's starting values. */
export function newDraft(
  zone: string,
  currentProjectId: string | null,
  projects: readonly ProjectDetail[],
  seed: Partial<ScheduleDraft>
): ScheduleDraft {
  const base = emptyDraft(zone)
  const inProject =
    currentProjectId !== null && projects.some((project) => project.id === currentProjectId)
      ? currentProjectId
      : (projects[0]?.id ?? null)
  return { ...base, projectId: inProject, ...seed }
}

interface Identity {
  id: string
  createdAt: string
}

/**
 * Where a draft starts: `wait` while the schedule it needs is loading, null
 * for none (view mode, or a schedule that is gone), else the draft and the id
 * it saves under.
 */
function startDraft(
  state: ScheduleDrawerState,
  items: readonly ReportScheduleListItem[],
  loaded: boolean,
  fresh: () => ScheduleDraft
): { draft: ScheduleDraft; identity: Identity } | null | 'wait' {
  if (state.mode !== 'edit') return null
  if (state.id === NEW_SCHEDULE) {
    const source = state.from ? items.find((item) => item.id === state.from) : undefined
    if (state.from && !source && !loaded) return 'wait'
    return {
      draft: source ? duplicateDraft(source) : fresh(),
      identity: { id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    }
  }
  const item = items.find((schedule) => schedule.id === state.id)
  if (!item) return loaded ? null : 'wait'
  return { draft: draftFromSchedule(item), identity: { id: item.id, createdAt: item.createdAt } }
}

/**
 * The schedule drawer's form state: the draft (from the stored schedule, a
 * copy for Duplicate, or a new one), its unsaved changes, and Save / Send a
 * test. The id stays the same between a test and Save, so a test of a new
 * schedule saves it once and Save updates that one.
 */
export function useScheduleEditor({
  state,
  items,
  loaded,
  projects,
  currentProjectId,
  zone,
  client,
  reload
}: {
  state: ScheduleDrawerState
  items: readonly ReportScheduleListItem[]
  loaded: boolean
  projects: readonly ProjectDetail[]
  currentProjectId: string | null
  zone: string
  client: SchedulesClient
  reload: () => Promise<void>
}): ScheduleEditor {
  const [draft, setDraft] = useState<ScheduleDraft | null>(null)
  const [initial, setInitial] = useState<string>('')
  const [message, setMessage] = useState<Explained | null>(null)
  const [testNote, setTestNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [startedKey, setStartedKey] = useState<string | null>(null)
  const key = `${state.id}|${state.from ?? ''}|${state.mode}`

  // A new URL (another schedule, a copy, view or edit) starts a new draft once
  // its schedule has loaded. Set while rendering, so the form never shows the
  // previous schedule's values.
  if (startedKey !== key) {
    const start = startDraft(state, items, loaded, () =>
      newDraft(zone, currentProjectId, projects, state.seed)
    )
    if (start !== 'wait') {
      setStartedKey(key)
      setDraft(start?.draft ?? null)
      setIdentity(start?.identity ?? null)
      setInitial(start ? JSON.stringify(start.draft) : '')
      setMessage(null)
      setTestNote(null)
    }
  }

  const patch = useCallback((partial: Partial<ScheduleDraft>) => {
    setDraft((current) => (current ? { ...current, ...partial } : current))
  }, [])

  const issue = useMemo(() => (draft ? draftIssues(draft) : null), [draft])
  const dirty = draft !== null && JSON.stringify(draft) !== initial

  const save = useCallback(async (): Promise<ReportScheduleListItem | null> => {
    if (!draft || !identity) return null
    const problem = draftIssues(draft)
    if (problem) {
      setMessage({ reason: problem, nextStep: null })
      return null
    }
    setBusy(true)
    try {
      const saved = await client.saveSchedule(buildSchedule(draft, identity.id, identity.createdAt))
      if (saved.unavailable || !saved.row) {
        setMessage(saved.unavailable ?? { reason: 'Could not save the schedule.', nextStep: null })
        return null
      }
      setMessage(null)
      setInitial(JSON.stringify(draft))
      await reload()
      return saved.row
    } finally {
      setBusy(false)
    }
  }, [draft, identity, client, reload])

  const sendTest = useCallback(async (): Promise<void> => {
    const accountId = draft?.accountId ?? null
    const saved = await save()
    if (!saved) return
    const sent = await client.sendTest({ scheduleId: saved.id, accountId })
    // The test send is a delivery row (sent or failed): Delivery history shows it now.
    await reload()
    if (sent.unavailable) {
      setMessage(sent.unavailable)
      return
    }
    if (sent.result) {
      setTestNote(
        sent.result.nextStep
          ? `${sent.result.message} ${sent.result.nextStep}`
          : sent.result.message
      )
    }
  }, [draft, save, client, reload])

  return { draft, patch, dirty, issue, message, testNote, busy, save, sendTest }
}
