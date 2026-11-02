import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sameTemplateSettings, type TemplateSettings } from '@shared/domain'
import type { TemplateStep, TemplateVersionEntry } from '@shared/ipc'
import type { TemplatesClient } from '../client'
import { readTemplateFailure } from '../name'
import { hasTemplateError } from '../utils/highlight'
import {
  fromSettingsDraft,
  settingsDraftError,
  toSettingsDraft,
  type SettingsDraft
} from '../utils/settingsForm'
import { savedNote } from '../utils/stepCopy'

export const SYNTAX_MESSAGE =
  'The template has a syntax error. Write a variable as {{ name }} and a comment as {# … #}.'

/** What the step editor edits: the project's version, or the app default with no project. */
export interface DraftBase {
  body: string
  settings: TemplateSettings
  /** Changes whenever the saved template changes, so a clean draft follows it. */
  key: string
}

export function draftBase(step: TemplateStep, projectOpen: boolean): DraftBase {
  if (projectOpen) {
    const { effective } = step
    return {
      body: effective.body,
      settings: effective.settings,
      key: `${effective.source}:${effective.id}:${effective.version}:${effective.hash}`
    }
  }
  const template = step.appDefault
  return {
    body: template.body,
    settings: template.settings,
    key: `app:${template.id}:${template.version}:${template.templateHash}`
  }
}

export interface StepDraft {
  body: string
  setBody: (next: string) => void
  settingsDraft: SettingsDraft
  setSettingsDraft: (next: SettingsDraft) => void
  /** Settings as they would be saved. */
  settings: TemplateSettings
  settingsError: string | null
  /** Shipped app default with no project open: duplicate it to edit. */
  readOnly: boolean
  dirty: boolean
  busy: boolean
  note: string | null
  error: string | null
  versions: readonly TemplateVersionEntry[]
  canReset: boolean
  save: () => Promise<void>
  reset: () => Promise<void>
  discard: () => void
  clearMessages: () => void
}

/**
 * The selected step's draft: body and settings, save as a new version (FR-26.4,
 * FR-26.8), Reset to default (FR-26.5) and the version history. A project save
 * goes to `templates:saveOverride`; with no project the app default is updated.
 */
export function useStepDraft(input: {
  client: TemplatesClient
  projectId: string | null
  step: TemplateStep
  onStep: (step: TemplateStep) => void
  onAppChanged: () => Promise<readonly TemplateStep[]>
}): StepDraft {
  const { client, projectId, step, onStep, onAppChanged } = input
  const projectOpen = projectId !== null
  const base = draftBase(step, projectOpen)
  const [body, setBodyState] = useState(base.body)
  const [settingsDraft, setSettingsDraftState] = useState(() => toSettingsDraft(base.settings))
  /** The saved template the draft started from. Dirty is measured against it. */
  const [loaded, setLoaded] = useState(base)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<readonly TemplateVersionEntry[]>([])
  const versionTick = useRef(0)

  const settings = useMemo(
    () => fromSettingsDraft(step.kind, settingsDraft),
    [step.kind, settingsDraft]
  )
  const dirty = body !== loaded.body || !sameTemplateSettings(settings, loaded.settings)
  // A retired step (Docs/PROMPT-AUDIT.md rule 6) keeps its project version read-only.
  const retired = step.retired !== null
  const readOnly = retired || (!projectOpen && step.appDefault.isShipped)
  const canReset =
    !retired && (projectOpen ? step.status === 'project' : !step.appDefault.isShipped)

  const load = useCallback((next: DraftBase) => {
    setBodyState(next.body)
    setSettingsDraftState(toSettingsDraft(next.settings))
    setLoaded(next)
  }, [])

  // A clean draft follows the saved template when it changes elsewhere (App templates).
  if (base.key !== loaded.key && !dirty && !busy) {
    load(base)
  }

  const versionRequest = useMemo(
    () => (projectId ? { projectId, kind: step.kind } : { id: step.appDefault.id }),
    [projectId, step.kind, step.appDefault.id]
  )

  const refreshVersions = useCallback(async () => {
    const tick = ++versionTick.current
    try {
      const list = await client.versions(versionRequest)
      if (tick === versionTick.current) setVersions(list)
    } catch {
      if (tick === versionTick.current) setVersions([])
    }
  }, [client, versionRequest])

  // The history follows the saved template: a new version or a reset reloads it.
  useEffect(() => {
    const tick = ++versionTick.current
    void client.versions(versionRequest).then(
      (list) => {
        if (tick === versionTick.current) setVersions(list)
      },
      () => {
        if (tick === versionTick.current) setVersions([])
      }
    )
  }, [client, versionRequest, base.key])

  const clearMessages = useCallback(() => {
    setNote(null)
    setError(null)
  }, [])

  const setBody = useCallback((next: string) => {
    setBodyState(next)
    setNote(null)
    setError(null)
  }, [])

  const setSettingsDraft = useCallback((next: SettingsDraft) => {
    setSettingsDraftState(next)
    setNote(null)
  }, [])

  async function save(): Promise<void> {
    if (busy || readOnly) return
    const settingsProblem = settingsDraftError(step.kind, settingsDraft)
    if (settingsProblem) {
      setError(settingsProblem)
      return
    }
    if (hasTemplateError(body, step.kind)) {
      setError(SYNTAX_MESSAGE)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (projectId) {
        const saved = await client.saveOverride({ projectId, kind: step.kind, body, settings })
        onStep(saved)
        load(draftBase(saved, true))
        setNote(savedNote(saved.effective))
      } else {
        const result = await client.update({ id: step.appDefault.id, body, settings })
        const steps = await onAppChanged()
        const fresh = steps.find((item) => item.kind === step.kind)
        if (fresh) load(draftBase(fresh, false))
        setNote(savedNote({ version: result.template.version, hash: result.template.templateHash }))
      }
      await refreshVersions()
    } catch (cause: unknown) {
      setError(readTemplateFailure(cause))
    } finally {
      setBusy(false)
    }
  }

  async function reset(): Promise<void> {
    if (busy || !canReset) return
    setBusy(true)
    setError(null)
    try {
      if (projectId) {
        const next = await client.resetOverride({ projectId, kind: step.kind })
        onStep(next)
        load(draftBase(next, true))
        setNote(
          "Reset. This project uses the default again. Its saved versions are kept, and past question sets and checks don't change."
        )
      } else {
        const result = await client.resetToShipped({ id: step.appDefault.id })
        const steps = await onAppChanged()
        const fresh = steps.find((item) => item.kind === step.kind)
        if (fresh) load(draftBase(fresh, false))
        setNote(
          `Reset to the default wording as v${result.template.version}. Earlier versions are kept.`
        )
      }
      await refreshVersions()
    } catch (cause: unknown) {
      setError(readTemplateFailure(cause))
    } finally {
      setBusy(false)
    }
  }

  function discard(): void {
    load(loaded)
    clearMessages()
  }

  return {
    body,
    setBody,
    settingsDraft,
    setSettingsDraft,
    settings,
    settingsError: settingsDraftError(step.kind, settingsDraft),
    readOnly,
    dirty,
    busy,
    note,
    error,
    versions,
    canReset,
    save,
    reset,
    discard,
    clearMessages
  }
}
